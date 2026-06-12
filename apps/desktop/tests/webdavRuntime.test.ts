import { describe, expect, it, vi } from "vitest";
import type { TaskRepository } from "../src/data/taskRepository";
import type { HttpFetcher } from "../src/sync/webdav/httpClient";
import { createSnapshotCompactingRunner, createWebdavRuntime } from "../src/sync/webdav/runtime";
import {
  createInMemoryWebdavSecretsStore,
  type WebdavSecrets,
  type WebdavSecretsStore,
} from "../src/sync/webdav/secretsStore";
import type { WebdavRunOnceResult } from "../src/sync/webdav/taskSyncRunner";
import type { WebdavClient } from "../src/sync/webdav/types";

const noopFetcher: HttpFetcher = {
  async request() {
    return { status: 200, headers: {}, body: "" };
  },
};

function stubRepository(): TaskRepository {
  return {
    databasePath: "sqlite:test.db",
    async init() {},
    async createTask() {
      throw new Error("not used");
    },
    async updateTask() {
      throw new Error("not used");
    },
    async setStatus() {
      throw new Error("not used");
    },
    async deleteTask() {},
    async applyRemoteTask() {},
    async deleteRemoteTask() {},
    async listPendingChanges() {
      return [];
    },
    async markChangeSynced() {},
    async getSyncState() {
      return {
        serverCursor: null,
        lastSyncedAt: null,
        lastError: null,
        updatedAt: null,
      };
    },
    async saveSyncState(input) {
      return {
        serverCursor: input.serverCursor,
        lastSyncedAt: input.lastSyncedAt,
        lastError: input.lastError,
        updatedAt: "2026-05-19T13:00:00.000Z",
      };
    },
    async recordSyncRun(input) {
      return { id: "run-1", ...input };
    },
    async listRecentSyncRuns() {
      return [];
    },
    async listToday() {
      return { overdue: [], dueToday: [], completedToday: [] };
    },
    async listInbox() {
      return [];
    },
    async listAgenda() {
      return [];
    },
    async getStats() {
      return {
        totalTasks: 0,
        activeTasks: 0,
        completedTasks: 0,
        pendingLocalChanges: 0,
        databasePath: "sqlite:test.db",
      };
    },
  };
}

const validSecrets: WebdavSecrets = {
  baseUrl: "https://dav.jianguoyun.com/dav",
  root: "/liliatodo",
  username: "user@example.com",
  password: "app-secret",
  deviceId: "desk-a",
};

describe("createWebdavRuntime", () => {
  it("secretsStore 返回 null 时 runtime 为 disabled，理由清晰", async () => {
    const resolution = await createWebdavRuntime({
      repository: stubRepository(),
      secretsStore: createInMemoryWebdavSecretsStore(null),
      httpFetcher: noopFetcher,
    });
    expect(resolution).toEqual({
      kind: "disabled",
      reason: "尚未配置 WebDAV 凭据",
    });
  });

  it("secretsStore.load 抛错时返回 disabled，不冒泡破坏冷启动", async () => {
    const broken: WebdavSecretsStore = {
      async load() {
        throw new Error("plugin-store 不可用");
      },
      async save() {},
      async clear() {},
    };
    const resolution = await createWebdavRuntime({
      repository: stubRepository(),
      secretsStore: broken,
      httpFetcher: noopFetcher,
    });
    expect(resolution.kind).toBe("disabled");
    if (resolution.kind === "disabled") {
      expect(resolution.reason).toContain("plugin-store 不可用");
    }
  });

  it("凭据完整时返回 enabled 并装配 runner/provider/client/secrets/layout", async () => {
    const resolution = await createWebdavRuntime({
      repository: stubRepository(),
      secretsStore: createInMemoryWebdavSecretsStore(validSecrets),
      httpFetcher: noopFetcher,
      userAgent: "LiliaTodo/0.1 (+webdav-test)",
    });
    expect(resolution.kind).toBe("enabled");
    if (resolution.kind === "enabled") {
      expect(resolution.secrets).toEqual(validSecrets);
      // layout 由 root 推出；确认根路径包含用户配置
      expect(resolution.layout.root.startsWith("/liliatodo")).toBe(true);
      expect(typeof resolution.runner.runOnce).toBe("function");
      expect(typeof resolution.provider.push).toBe("function");
      expect(typeof resolution.client.ensureCollection).toBe("function");
    }
  });

  it("root 为空字符串时退化到默认 /liliatodo，仍能装配 runtime", async () => {
    // in-memory store 的 load 不会再校验初始值，把损坏 secrets 直接送进 runtime；
    // runtime 用 `secrets.root || WEBDAV_DEFAULT_ROOT` 兜底，避免冷启动崩页。
    const resolution = await createWebdavRuntime({
      repository: stubRepository(),
      secretsStore: createInMemoryWebdavSecretsStore({
        ...validSecrets,
        root: "",
      } as WebdavSecrets),
      httpFetcher: noopFetcher,
    });
    expect(resolution.kind).toBe("enabled");
    if (resolution.kind === "enabled") {
      expect(resolution.layout.root).toBe("/liliatodo");
    }
  });
});

describe("createSnapshotCompactingRunner", () => {
  it("同步成功但 oplog 未达阈值时不 compact", async () => {
    const compactCalls: unknown[] = [];
    const runner = createSnapshotCompactingRunner({
      runner: fixedRunner({ ok: true, report: emptyRunReport("同步完成") }),
      client: {} as WebdavClient,
      layout: {} as never,
      deviceId: "desk-a",
      threshold: 3,
      countOplogChunks: async () => ({ chunkCount: 2 }),
      compactSnapshot: async (options) => {
        compactCalls.push(options);
        return compactResult();
      },
    });

    await expect(runner.runOnce()).resolves.toEqual({ ok: true, report: emptyRunReport("同步完成") });
    expect(compactCalls).toEqual([]);
  });

  it("同步成功且 oplog 达阈值时先标记待 compact，下一次 idle 窗口再执行", async () => {
    const compactCalls: unknown[] = [];
    let idle = false;
    const runner = createSnapshotCompactingRunner({
      runner: fixedRunner({ ok: true, report: emptyRunReport("同步完成") }),
      client: {} as WebdavClient,
      layout: { snapshots: "/liliatodo/snapshots" } as never,
      deviceId: "desk-a",
      threshold: 3,
      isIdleWindow: () => idle,
      countOplogChunks: async () => ({ chunkCount: 3 }),
      compactSnapshot: async (options) => {
        compactCalls.push(options);
        return compactResult();
      },
    });

    await expect(runner.runOnce()).resolves.toEqual({ ok: true, report: emptyRunReport("同步完成") });
    expect(compactCalls).toEqual([]);

    await expect(runner.runOnce()).resolves.toEqual({ ok: true, report: emptyRunReport("同步完成") });
    expect(compactCalls).toEqual([]);

    idle = true;
    const result = await runner.runOnce();

    expect(result.ok).toBe(true);
    expect(compactCalls).toHaveLength(1);
  });

  it("compact 失败不影响本次同步成功结果，后续 idle 窗口继续重试", async () => {
    const compact = vi
      .fn()
      .mockRejectedValueOnce(new Error("snapshot 写入失败"))
      .mockResolvedValueOnce(compactResult());
    const runner = createSnapshotCompactingRunner({
      runner: fixedRunner({ ok: true, report: emptyRunReport("同步完成") }),
      client: {} as WebdavClient,
      layout: {} as never,
      deviceId: "desk-a",
      threshold: 1,
      countOplogChunks: async () => ({ chunkCount: 1 }),
      compactSnapshot: compact,
    });

    await expect(runner.runOnce()).resolves.toEqual({ ok: true, report: emptyRunReport("同步完成") });
    expect(compact).not.toHaveBeenCalled();
    await expect(runner.runOnce()).resolves.toEqual({ ok: true, report: emptyRunReport("同步完成") });
    expect(compact).toHaveBeenCalledTimes(1);
    await expect(runner.runOnce()).resolves.toEqual({ ok: true, report: emptyRunReport("同步完成") });
    expect(compact).toHaveBeenCalledTimes(2);
  });

  it("同步失败时不统计 oplog 也不 compact", async () => {
    const count = vi.fn().mockResolvedValue({ chunkCount: 10 });
    const compact = vi.fn().mockResolvedValue(compactResult());
    const runner = createSnapshotCompactingRunner({
      runner: fixedRunner({ ok: false, error: "远端失败" }),
      client: {} as WebdavClient,
      layout: {} as never,
      deviceId: "desk-a",
      threshold: 1,
      countOplogChunks: count,
      compactSnapshot: compact,
    });

    await expect(runner.runOnce()).resolves.toEqual({ ok: false, error: "远端失败" });
    expect(count).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
  });
});

function fixedRunner(result: WebdavRunOnceResult) {
  return {
    async runOnce() {
      return result;
    },
  };
}

function emptyRunReport(message: string) {
  return {
    pushedOpsCount: 0,
    pushedTaskChangeCount: 0,
    pushedTaskListChangeCount: 0,
    pushedTaskCategoryChangeCount: 0,
    markedSyncedCount: 0,
    markedTaskChangeSyncedCount: 0,
    markedTaskListChangeSyncedCount: 0,
    markedTaskCategoryChangeSyncedCount: 0,
    pulledOpsCount: 0,
    appliedTaskCount: 0,
    deletedTaskCount: 0,
    appliedTaskListCount: 0,
    deletedTaskListCount: 0,
    appliedTaskCategoryCount: 0,
    deletedTaskCategoryCount: 0,
    serverCursor: "{}",
    message,
  };
}

function compactResult() {
  return {
    meta: { timestamp: "202605191230", path: "/liliatodo/snapshots/202605191230.jsonl" },
    entries: [],
    cursor: "cursor-after",
    pulledOpsCount: 0,
    cleanedOplogChunkCount: 0,
  };
}
