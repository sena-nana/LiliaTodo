// BE-12 sprint-4.3b：把 WebdavSyncProvider 接到 TaskRepository 的 task 通路。
//
// runOnce() 一次完整循环：
//   1. push：listPendingChanges() → filter(task) → 折算 Op → provider.push() → markChangeSynced。
//   2. pull：getSyncState().serverCursor → provider.pull(since) → LWW 合并 → 写回 Entity 文件
//      → repository.applyRemoteTask / deleteRemoteTask → saveSyncState(newCursor)。
//   3. recordSyncRun（best-effort）。
//
// 失败语义：
//   - WebdavUnreachableError / WebdavConflictError 等都被 caller 当作普通 Error；
//     本 runner 自身不做重试或缓冲，由上层 scheduler 决定（后续 sprint）。
//   - 中间步骤失败时 saveSyncState 仅记录 lastError，不滚动 serverCursor，避免漏拉。

import type { TaskRepository } from "../../data/taskRepository";
import type { Op } from "../types/op";
import {
  mergeOpsAcrossEntities,
  type EntityWithUnknownPayload,
  type MergeOpsAcrossEntitiesResult,
} from "./merge";
import type { SyncProvider } from "./provider";
import {
  entityToTask,
  localChangeToOp,
  TASK_ENTITY_TYPE,
  TASK_SCHEMA_VERSION,
} from "./taskBridge";

export interface WebdavRunReport {
  readonly pushedOpsCount: number;
  readonly markedSyncedCount: number;
  readonly pulledOpsCount: number;
  readonly appliedTaskCount: number;
  readonly deletedTaskCount: number;
  readonly serverCursor: string;
  readonly message: string;
}

export type WebdavRunOnceResult =
  | { readonly ok: true; readonly report: WebdavRunReport }
  | { readonly ok: false; readonly error: string };

export interface WebdavTaskSyncRunner {
  runOnce(): Promise<WebdavRunOnceResult>;
}

export interface CreateWebdavTaskSyncRunnerOptions {
  readonly provider: SyncProvider;
  readonly repository: Pick<
    TaskRepository,
    | "listPendingChanges"
    | "markChangeSynced"
    | "getSyncState"
    | "applyRemoteTask"
    | "deleteRemoteTask"
    | "saveSyncState"
    | "recordSyncRun"
  >;
  readonly deviceId: string;
  readonly actor?: string;
  readonly now?: () => Date;
}

export function createWebdavTaskSyncRunner({
  provider,
  repository,
  deviceId,
  actor,
  now = () => new Date(),
}: CreateWebdavTaskSyncRunnerOptions): WebdavTaskSyncRunner {
  const resolvedActor = actor ?? deviceId;

  return {
    async runOnce(): Promise<WebdavRunOnceResult> {
      const startedAt = now();
      try {
        const pushReport = await pushPending({
          provider,
          repository,
          deviceId,
          actor: resolvedActor,
          syncedAt: startedAt,
        });
        const pullReport = await pullAndApply({
          provider,
          repository,
        });
        await repository.saveSyncState({
          serverCursor: pullReport.serverCursor,
          lastSyncedAt: startedAt.toISOString(),
          lastError: null,
        });
        const report: WebdavRunReport = {
          pushedOpsCount: pushReport.pushedOpsCount,
          markedSyncedCount: pushReport.markedSyncedCount,
          pulledOpsCount: pullReport.pulledOpsCount,
          appliedTaskCount: pullReport.appliedTaskCount,
          deletedTaskCount: pullReport.deletedTaskCount,
          serverCursor: pullReport.serverCursor,
          message: buildMessage({ pushReport, pullReport }),
        };
        await recordRunBestEffort(repository, {
          status: "succeeded",
          startedAt: startedAt.toISOString(),
          finishedAt: now().toISOString(),
          message: report.message,
          serverCursor: report.serverCursor,
        });
        return { ok: true, report };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await saveStateBestEffort(repository, {
          serverCursor: null,
          lastSyncedAt: null,
          lastError: error,
        });
        await recordRunBestEffort(repository, {
          status: "failed",
          startedAt: startedAt.toISOString(),
          finishedAt: now().toISOString(),
          message: error,
          serverCursor: null,
        });
        return { ok: false, error };
      }
    },
  };
}

interface PushReport {
  readonly pushedOpsCount: number;
  readonly markedSyncedCount: number;
}

async function pushPending(input: {
  provider: SyncProvider;
  repository: CreateWebdavTaskSyncRunnerOptions["repository"];
  deviceId: string;
  actor: string;
  syncedAt: Date;
}): Promise<PushReport> {
  const { provider, repository, deviceId, actor, syncedAt } = input;
  const pending = await repository.listPendingChanges();
  const taskChanges = pending.filter((c) => c.entityType === TASK_ENTITY_TYPE);
  if (taskChanges.length === 0) {
    return { pushedOpsCount: 0, markedSyncedCount: 0 };
  }
  const ops: Op[] = taskChanges.map((change) =>
    localChangeToOp(change, { deviceId, actor })
  );
  const result = await provider.push(ops);
  let markedSyncedCount = 0;
  if (result.acceptedCount > 0) {
    for (const change of taskChanges) {
      await repository.markChangeSynced(change.id, syncedAt);
      markedSyncedCount += 1;
    }
  }
  return { pushedOpsCount: ops.length, markedSyncedCount };
}

interface PullReport {
  readonly pulledOpsCount: number;
  readonly appliedTaskCount: number;
  readonly deletedTaskCount: number;
  readonly serverCursor: string;
}

async function pullAndApply(input: {
  provider: SyncProvider;
  repository: CreateWebdavTaskSyncRunnerOptions["repository"];
}): Promise<PullReport> {
  const { provider, repository } = input;
  const syncState = await repository.getSyncState();
  const { ops, cursor } = await provider.pull(syncState.serverCursor);
  const taskOps = ops.filter((op) => op.target.entityType === TASK_ENTITY_TYPE);
  if (taskOps.length === 0) {
    return {
      pulledOpsCount: 0,
      appliedTaskCount: 0,
      deletedTaskCount: 0,
      serverCursor: cursor,
    };
  }
  const merged: MergeOpsAcrossEntitiesResult = await mergeOpsAcrossEntities(
    taskOps,
    {
      async loadEntity(entityType, entityId) {
        if (entityType !== TASK_ENTITY_TYPE) return null;
        const fetched = await provider.getEntity<Record<string, unknown>>(
          entityType,
          entityId,
        );
        return (fetched as EntityWithUnknownPayload | null) ?? null;
      },
    },
  );

  let appliedTaskCount = 0;
  let deletedTaskCount = 0;
  for (const entry of merged.entries) {
    const { entity } = entry.result;
    if (entity === null) {
      await repository.deleteRemoteTask(entry.entityId);
      deletedTaskCount += 1;
      continue;
    }
    const normalizedEntity: EntityWithUnknownPayload = {
      ...entity,
      schemaVersion: entity.schemaVersion || TASK_SCHEMA_VERSION,
    };
    await provider.pushEntity(normalizedEntity);
    const task = entityToTask(normalizedEntity);
    await repository.applyRemoteTask(task, normalizedEntity.schemaVersion);
    appliedTaskCount += 1;
  }
  return {
    pulledOpsCount: taskOps.length,
    appliedTaskCount,
    deletedTaskCount,
    serverCursor: cursor,
  };
}

function buildMessage(input: {
  pushReport: PushReport;
  pullReport: PullReport;
}): string {
  const { pushReport, pullReport } = input;
  const segments: string[] = [];
  if (pushReport.markedSyncedCount > 0) {
    segments.push(`已上传 ${pushReport.markedSyncedCount} 条本地变更`);
  }
  if (pullReport.appliedTaskCount > 0) {
    segments.push(`已应用 ${pullReport.appliedTaskCount} 条远端任务`);
  }
  if (pullReport.deletedTaskCount > 0) {
    segments.push(`已删除 ${pullReport.deletedTaskCount} 条远端任务`);
  }
  if (segments.length === 0) {
    return "WebDAV 同步完成（无新增变更）";
  }
  return segments.join("，");
}

async function recordRunBestEffort(
  repository: Pick<TaskRepository, "recordSyncRun">,
  input: Parameters<TaskRepository["recordSyncRun"]>[0],
): Promise<void> {
  try {
    await repository.recordSyncRun(input);
  } catch {
    // 同步历史仅诊断用，不应遮蔽本次同步主要结果。
  }
}

async function saveStateBestEffort(
  repository: Pick<TaskRepository, "saveSyncState">,
  state: Parameters<TaskRepository["saveSyncState"]>[0],
): Promise<void> {
  try {
    await repository.saveSyncState(state);
  } catch {
    // 状态写不进去也要让 caller 拿到原始失败。
  }
}
