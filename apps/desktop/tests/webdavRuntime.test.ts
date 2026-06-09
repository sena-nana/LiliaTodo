import { describe, expect, it } from "vitest";
import type { TaskRepository } from "../src/data/taskRepository";
import type { HttpFetcher } from "../src/sync/webdav/httpClient";
import { createWebdavRuntime } from "../src/sync/webdav/runtime";
import {
  createInMemoryWebdavSecretsStore,
  type WebdavSecrets,
  type WebdavSecretsStore,
} from "../src/sync/webdav/secretsStore";

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
