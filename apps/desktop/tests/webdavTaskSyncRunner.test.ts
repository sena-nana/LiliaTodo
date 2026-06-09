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
import type { Task, TaskList } from "../src/domain/tasks";
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
  appliedLists: Array<{ list: TaskList; remoteVersion?: number }>;
  deletedIds: string[];
  deletedListIds: string[];
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
  | "applyRemoteList"
  | "deleteRemoteList"
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
    async applyRemoteList(list, remoteVersion) {
      state.appliedLists.push({ list, remoteVersion });
    },
    async deleteRemoteList(id) {
      state.deletedListIds.push(id);
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
    appliedLists: [],
    deletedIds: [],
    deletedListIds: [],
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
        pushedTaskChangeCount: 0,
        pushedTaskListChangeCount: 0,
        markedSyncedCount: 0,
        markedTaskChangeSyncedCount: 0,
        markedTaskListChangeSyncedCount: 0,
        pulledOpsCount: 0,
        appliedTaskCount: 0,
        deletedTaskCount: 0,
        appliedTaskListCount: 0,
        deletedTaskListCount: 0,
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
      expect(result.report.pushedTaskChangeCount).toBe(2);
      expect(result.report.pushedTaskListChangeCount).toBe(0);
      expect(result.report.markedSyncedCount).toBe(2);
      expect(result.report.markedTaskChangeSyncedCount).toBe(2);
      expect(result.report.markedTaskListChangeSyncedCount).toBe(0);
      expect(result.report.message).toBe("已上传 2 条本地任务变更");
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

  it("非支持实体的 pending 在 push 阶段被忽略", async () => {
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

  it("纯 push：本地 taskList 变更转 Op 并 markChangeSynced", async () => {
    const pending: LocalChange[] = [
      {
        id: "lc-list",
        entityType: "taskList",
        entityId: "list-1",
        action: "taskList.create",
        payload: {
          id: "list-1",
          name: "项目",
          color: null,
          archived: false,
          order: 0,
          createdAt: "2026-05-19T09:00:00.000Z",
          updatedAt: "2026-05-19T09:00:00.000Z",
        },
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
    expect(pushSpy.lastOps?.[0]).toMatchObject({
      op: "put",
      target: { entityType: "taskList", entityId: "list-1" },
    });
    expect(state.markedIds).toEqual(["lc-list"]);
    if (result.ok) {
      expect(result.report.pushedTaskChangeCount).toBe(0);
      expect(result.report.pushedTaskListChangeCount).toBe(1);
      expect(result.report.markedTaskListChangeSyncedCount).toBe(1);
      expect(result.report.message).toBe("已上传 1 个本地清单变更");
    }
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

  it("旧 v1 task entity 收到 patch 后按 v2 写回并应用", async () => {
    const state = freshState();
    const entities = new Map<string, Entity<Record<string, unknown>>>([
      [
        "task:t-v1",
        {
          id: "t-v1",
          type: "task",
          schemaVersion: 1,
          payload: {
            title: "旧任务",
            status: "active",
            priority: 1,
            createdAt: "2026-05-19T09:00:00.000Z",
          },
          updatedAt: "2026-05-19T09:00:00.000Z",
          originDevice: "desk-old",
        },
      ],
    ]);
    const pushedEntities: Entity<Record<string, unknown>>[] = [];
    const provider = makeProviderStub({
      entities,
      pullResult: {
        ops: [
          {
            op: "patch",
            target: { entityType: "task", entityId: "t-v1" },
            params: { listId: "inbox", resources: [] },
            ts: "2026-05-19T10:00:00.000Z",
            actor: "desk-b",
            originDevice: "desk-b",
          },
        ],
        cursor: "cursor-v2",
      },
      onPushEntity: (entity) => pushedEntities.push(entity),
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
    });

    const result = await runner.runOnce();

    expect(result.ok).toBe(true);
    expect(pushedEntities[0].schemaVersion).toBe(2);
    expect(state.appliedTasks[0].remoteVersion).toBe(2);
    expect(state.appliedTasks[0].task.listId).toBe("inbox");
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

  it("远端 taskList put、archive patch 和 delete 会分派到清单仓储接口", async () => {
    const state = freshState();
    const entities = new Map<string, Entity<Record<string, unknown>>>([
      [
        "taskList:list-remote",
        {
          id: "list-remote",
          type: "taskList",
          schemaVersion: 1,
          payload: {
            name: "远端清单",
            color: null,
            archived: false,
            order: 1,
            createdAt: "2026-05-19T09:00:00.000Z",
          },
          updatedAt: "2026-05-19T10:00:00.000Z",
          originDevice: "desk-b",
        },
      ],
    ]);
    const remoteOps: Op[] = [
      {
        op: "put",
        target: { entityType: "taskList", entityId: "list-remote" },
        params: {
          name: "远端清单",
          color: null,
          archived: false,
          order: 1,
          createdAt: "2026-05-19T09:00:00.000Z",
        },
        ts: "2026-05-19T10:00:00.000Z",
        actor: "desk-b",
        originDevice: "desk-b",
      },
      {
        op: "patch",
        target: { entityType: "taskList", entityId: "list-remote" },
        params: {
          archived: true,
          updatedAt: "2026-05-19T10:30:00.000Z",
        },
        ts: "2026-05-19T10:30:00.000Z",
        actor: "desk-b",
        originDevice: "desk-b",
      },
      {
        op: "delete",
        target: { entityType: "taskList", entityId: "list-old" },
        params: null,
        ts: "2026-05-19T11:00:00.000Z",
        actor: "desk-b",
        originDevice: "desk-b",
      },
    ];
    const provider = makeProviderStub({
      entities,
      pullResult: { ops: remoteOps, cursor: "cursor-lists" },
    });
    const runner = createWebdavTaskSyncRunner({
      provider,
      repository: makeRepositoryStub(state),
      deviceId: "desk-a",
    });

    const result = await runner.runOnce();

    expect(result.ok).toBe(true);
    expect(state.appliedLists[0]).toMatchObject({
      list: {
        id: "list-remote",
        name: "远端清单",
        archived: true,
        order: 1,
        updatedAt: "2026-05-19T10:30:00.000Z",
      },
      remoteVersion: 1,
    });
    expect(state.deletedListIds).toEqual(["list-old"]);
    if (result.ok) {
      expect(result.report.appliedTaskListCount).toBe(1);
      expect(result.report.deletedTaskListCount).toBe(1);
      expect(result.report.message).toBe("已应用 1 个远端清单，已删除 1 个远端清单");
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
