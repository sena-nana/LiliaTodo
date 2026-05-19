import { describe, expect, it } from "vitest";
import type { Entity } from "../src/sync/types/entity";
import type { Op } from "../src/sync/types/op";
import type {
  LocalChange,
  RecordSyncRunInput,
  SaveSyncStateInput,
  SyncRun,
  SyncState,
  TaskRepository,
} from "../src/data/taskRepository";
import type { Task } from "../src/domain/tasks";
import type {
  SyncProvider,
  SyncPullResult,
  SyncPushResult,
} from "../src/sync/webdav/provider";
import { createWebdavTaskSyncRunner } from "../src/sync/webdav/taskSyncRunner";

interface FakeRepositoryState {
  pending: LocalChange[];
  markedIds: string[];
  syncState: SyncState;
  savedStates: SaveSyncStateInput[];
  appliedTasks: Array<{ task: Task; remoteVersion?: number }>;
  deletedIds: string[];
  syncRuns: RecordSyncRunInput[];
}

function makeRepositoryStub(
  state: FakeRepositoryState,
): Pick<
  TaskRepository,
  | "listPendingChanges"
  | "markChangeSynced"
  | "getSyncState"
  | "applyRemoteTask"
  | "deleteRemoteTask"
  | "saveSyncState"
  | "recordSyncRun"
> {
  return {
    async listPendingChanges() {
      return state.pending;
    },
    async markChangeSynced(id) {
      state.markedIds.push(id);
    },
    async getSyncState() {
      return state.syncState;
    },
    async applyRemoteTask(task, remoteVersion) {
      state.appliedTasks.push({ task, remoteVersion });
    },
    async deleteRemoteTask(id) {
      state.deletedIds.push(id);
    },
    async saveSyncState(input) {
      state.savedStates.push(input);
      return {
        serverCursor: input.serverCursor,
        lastSyncedAt: input.lastSyncedAt,
        lastError: input.lastError,
        updatedAt: "2026-05-19T13:00:00.000Z",
      };
    },
    async recordSyncRun(input) {
      state.syncRuns.push(input);
      return { id: `run-${state.syncRuns.length}`, ...input } as SyncRun;
    },
  };
}

interface FakeProviderHooks {
  pushResult?: SyncPushResult;
  pullResult?: SyncPullResult;
  entities?: Map<string, Entity<Record<string, unknown>>>;
  onPushEntity?: (entity: Entity<Record<string, unknown>>) => void;
  pushSpy?: { lastOps: Op[] | null };
}

function makeProviderStub(hooks: FakeProviderHooks = {}): SyncProvider {
  const entities = hooks.entities ?? new Map();
  return {
    async push(ops) {
      if (hooks.pushSpy) hooks.pushSpy.lastOps = [...ops];
      return hooks.pushResult ?? { acceptedCount: ops.length, chunkPath: "x" };
    },
    async pull() {
      return hooks.pullResult ?? { ops: [], cursor: "{}" };
    },
    async snapshot() {
      return { entities: [], cursor: "{}" };
    },
    async pushEntity(entity) {
      hooks.onPushEntity?.(entity as Entity<Record<string, unknown>>);
      entities.set(`${entity.type}:${entity.id}`, entity as Entity<Record<string, unknown>>);
    },
    async getEntity<T>(entityType: string, entityId: string) {
      const found = entities.get(`${entityType}:${entityId}`);
      return (found ?? null) as Entity<T> | null;
    },
  };
}

function freshState(overrides: Partial<FakeRepositoryState> = {}): FakeRepositoryState {
  return {
    pending: [],
    markedIds: [],
    syncState: {
      serverCursor: null,
      lastSyncedAt: null,
      lastError: null,
      updatedAt: null,
    },
    savedStates: [],
    appliedTasks: [],
    deletedIds: [],
    syncRuns: [],
    ...overrides,
  };
}

describe("WebDAV task 同步 runner", () => {
  it("无待推无待拉时返回空报告，serverCursor 仍写回", async () => {
    const state = freshState();
    const pushSpy = { lastOps: null as Op[] | null };
    const provider = makeProviderStub({
      pullResult: { ops: [], cursor: "cursor-empty" },
      pushSpy,
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
      now: () => new Date("2026-05-19T14:00:00.000Z"),
    });
    const result = await runner.runOnce();
    expect(result).toEqual({
      ok: true,
      report: {
        pushedOpsCount: 0,
        markedSyncedCount: 0,
        pulledOpsCount: 0,
        appliedTaskCount: 0,
        deletedTaskCount: 0,
        serverCursor: "cursor-empty",
        message: "WebDAV 同步完成（无新增变更）",
      },
    });
    expect(pushSpy.lastOps).toBeNull();
    expect(state.savedStates).toEqual([
      {
        serverCursor: "cursor-empty",
        lastSyncedAt: "2026-05-19T14:00:00.000Z",
        lastError: null,
      },
    ]);
    expect(state.syncRuns).toHaveLength(1);
    expect(state.syncRuns[0].status).toBe("succeeded");
  });

  it("纯 push：本地 task 变更转 Op 并 markChangeSynced 全部条目", async () => {
    const pending: LocalChange[] = [
      {
        id: "lc-1",
        entityType: "task",
        entityId: "t-1",
        action: "task.create",
        payload: { id: "t-1", title: "新任务" },
        createdAt: "2026-05-19T10:00:00.000Z",
        syncedAt: null,
      },
      {
        id: "lc-2",
        entityType: "task",
        entityId: "t-1",
        action: "task.update",
        payload: {
          patch: { title: "改名" },
          updatedAt: "2026-05-19T10:05:00.000Z",
        },
        createdAt: "2026-05-19T10:05:00.000Z",
        syncedAt: null,
      },
    ];
    const state = freshState({ pending });
    const pushSpy = { lastOps: null as Op[] | null };
    const provider = makeProviderStub({
      pushResult: { acceptedCount: 2, chunkPath: "/oplog/desk-a/.." },
      pullResult: { ops: [], cursor: "{}" },
      pushSpy,
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
      now: () => new Date("2026-05-19T14:00:00.000Z"),
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
    expect(pushSpy.lastOps).toHaveLength(2);
    expect(pushSpy.lastOps?.[0]).toMatchObject({
      op: "put",
      originDevice: "desk-a",
      actor: "desk-a",
    });
    expect(state.markedIds).toEqual(["lc-1", "lc-2"]);
    if (result.ok) {
      expect(result.report.pushedOpsCount).toBe(2);
      expect(result.report.markedSyncedCount).toBe(2);
    }
  });

  it("acceptedCount 为 0 时不 markChangeSynced", async () => {
    const pending: LocalChange[] = [
      {
        id: "lc-1",
        entityType: "task",
        entityId: "t-1",
        action: "task.delete",
        payload: null,
        createdAt: "2026-05-19T10:00:00.000Z",
        syncedAt: null,
      },
    ];
    const state = freshState({ pending });
    const provider = makeProviderStub({
      pushResult: { acceptedCount: 0, chunkPath: null },
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
    expect(state.markedIds).toEqual([]);
  });

  it("非 task entity 的 pending 在 push 阶段被忽略", async () => {
    const pending: LocalChange[] = [
      {
        id: "lc-x",
        entityType: "project" as unknown as "task",
        entityId: "p-1",
        action: "task.create",
        payload: { id: "p-1" },
        createdAt: "2026-05-19T10:00:00.000Z",
        syncedAt: null,
      },
    ];
    const state = freshState({ pending });
    const pushSpy = { lastOps: null as Op[] | null };
    const provider = makeProviderStub({ pushSpy });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
    expect(pushSpy.lastOps).toBeNull();
    expect(state.markedIds).toEqual([]);
  });

  it("纯 pull：remote put op 经 LWW 合并 → pushEntity + applyRemoteTask", async () => {
    const state = freshState();
    const remoteOps: Op[] = [
      {
        op: "put",
        target: { entityType: "task", entityId: "t-9" },
        params: {
          id: "t-9",
          title: "远端任务",
          status: "active",
          priority: 1,
          createdAt: "2026-05-19T09:00:00.000Z",
        },
        ts: "2026-05-19T10:00:00.000Z",
        actor: "desk-b",
        originDevice: "desk-b",
      },
    ];
    const onPushEntityCalls: Entity<Record<string, unknown>>[] = [];
    const provider = makeProviderStub({
      pullResult: { ops: remoteOps, cursor: "cursor-after" },
      onPushEntity: (entity) => onPushEntityCalls.push(entity),
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
      now: () => new Date("2026-05-19T14:00:00.000Z"),
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
    expect(onPushEntityCalls).toHaveLength(1);
    expect(onPushEntityCalls[0]).toMatchObject({
      id: "t-9",
      type: "task",
      originDevice: "desk-b",
    });
    expect(state.appliedTasks).toHaveLength(1);
    expect(state.appliedTasks[0].task).toMatchObject({
      id: "t-9",
      title: "远端任务",
      status: "active",
      priority: 1,
    });
    if (result.ok) {
      expect(result.report.appliedTaskCount).toBe(1);
      expect(result.report.deletedTaskCount).toBe(0);
      expect(result.report.serverCursor).toBe("cursor-after");
    }
  });

  it("pull 到 delete op 时 deleteRemoteTask 被调用而非 applyRemoteTask", async () => {
    const state = freshState();
    const remoteOps: Op[] = [
      {
        op: "delete",
        target: { entityType: "task", entityId: "t-3" },
        params: null,
        ts: "2026-05-19T10:00:00.000Z",
        actor: "desk-b",
        originDevice: "desk-b",
      },
    ];
    const provider = makeProviderStub({
      pullResult: { ops: remoteOps, cursor: "cursor-del" },
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
    expect(state.deletedIds).toEqual(["t-3"]);
    expect(state.appliedTasks).toEqual([]);
    if (result.ok) {
      expect(result.report.deletedTaskCount).toBe(1);
    }
  });

  it("非 task entityType 的 remote ops 在 pull 阶段直接忽略", async () => {
    const state = freshState();
    const remoteOps: Op[] = [
      {
        op: "put",
        target: { entityType: "project", entityId: "p-9" },
        params: { name: "x" },
        ts: "2026-05-19T10:00:00.000Z",
        actor: "desk-b",
        originDevice: "desk-b",
      },
    ];
    const provider = makeProviderStub({
      pullResult: { ops: remoteOps, cursor: "cursor-x" },
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
    expect(state.appliedTasks).toEqual([]);
    expect(state.deletedIds).toEqual([]);
    if (result.ok) {
      expect(result.report.serverCursor).toBe("cursor-x");
    }
  });

  it("provider.push 抛错时记录 failed run、lastError，不滚动 cursor", async () => {
    const pending: LocalChange[] = [
      {
        id: "lc-1",
        entityType: "task",
        entityId: "t-1",
        action: "task.delete",
        payload: null,
        createdAt: "2026-05-19T10:00:00.000Z",
        syncedAt: null,
      },
    ];
    const state = freshState({ pending });
    const provider: SyncProvider = {
      async push() {
        throw new Error("远端 423 Locked");
      },
      async pull() {
        return { ops: [], cursor: "should-not-write" };
      },
      async snapshot() {
        return { entities: [], cursor: "{}" };
      },
      async pushEntity() {},
      async getEntity() {
        return null;
      },
    };
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
      now: () => new Date("2026-05-19T14:00:00.000Z"),
    });
    const result = await runner.runOnce();
    expect(result).toEqual({ ok: false, error: "远端 423 Locked" });
    expect(state.markedIds).toEqual([]);
    expect(state.savedStates).toEqual([
      {
        serverCursor: null,
        lastSyncedAt: null,
        lastError: "远端 423 Locked",
      },
    ]);
    expect(state.syncRuns).toHaveLength(1);
    expect(state.syncRuns[0].status).toBe("failed");
    expect(state.syncRuns[0].message).toBe("远端 423 Locked");
  });

  it("recordSyncRun 写失败不影响主结果（best-effort）", async () => {
    const state = freshState();
    const repository = makeRepositoryStub(state);
    const repositoryWithBadRun: typeof repository = {
      ...repository,
      async recordSyncRun() {
        throw new Error("写历史失败");
      },
    };
    const provider = makeProviderStub({
      pullResult: { ops: [], cursor: "cursor-ok" },
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: repositoryWithBadRun,
      deviceId: "desk-a",
    });
    const result = await runner.runOnce();
    expect(result.ok).toBe(true);
  });
});
