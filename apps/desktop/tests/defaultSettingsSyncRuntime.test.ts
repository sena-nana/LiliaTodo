import { describe, expect, it, vi } from "vitest";
import type { TaskRepository } from "../src/data/taskRepository";
import { createDefaultSettingsSyncRuntime } from "../src/sync/defaultSettingsSyncRuntime";
import { createLocalSyncRunner } from "../src/sync/localSyncRunner";
import type { RemoteSyncConfig } from "../src/sync/remoteSyncConfig";
import type {
  WebdavRunOnceResult,
  WebdavRuntimeResolution,
} from "../src/sync/webdav";

vi.mock("../src/sync/localSyncRunner", () => ({
  createLocalSyncRunner: vi.fn(() => ({
    runOnce: vi.fn().mockResolvedValue({
      ok: true,
      result: null,
    }),
  })),
}));

describe("默认设置页同步运行时", () => {
  it("未注入 WebDAV factory 时仅装配本地 runner，webdav 为 null", () => {
    const repository = stubRepository();
    const remoteSyncConfig: RemoteSyncConfig = {
      enabled: true,
      baseUrl: "https://api.example.test/momo",
      headers: async () => ({ authorization: "Bearer remote-token" }),
    };

    const runtime = createDefaultSettingsSyncRuntime({
      repository,
      remoteSyncConfig,
    });

    expect(createLocalSyncRunner).toHaveBeenCalledWith(repository);
    expect(runtime.remoteSyncConfig).toBe(remoteSyncConfig);
    expect(runtime.runLocalSyncSimulation).toEqual(expect.any(Function));
    expect(runtime.webdav).toBeNull();
  });

  it("注入 WebDAV factory 时，inspect/runOnce 委派到 factory", async () => {
    const repository = stubRepository();
    const runOnce = vi.fn<() => Promise<WebdavRunOnceResult>>().mockResolvedValue({
      ok: true,
      report: {
        pushedOpsCount: 1,
        markedSyncedCount: 1,
        pulledOpsCount: 0,
        appliedTaskCount: 0,
        deletedTaskCount: 0,
        serverCursor: "{}",
        message: "ok",
      },
    });
    const resolution: WebdavRuntimeResolution = {
      kind: "enabled",
      runner: { runOnce },
      secrets: {
        baseUrl: "https://dav.jianguoyun.com/dav",
        root: "/momo",
        username: "u",
        password: "p",
        deviceId: "desk-a",
      },
      // 测试只看 runner 委派，下面这些字段在 controller 路径用不上但仍要类型对齐。
      layout: {} as never,
      provider: {} as never,
      client: {} as never,
    };
    const factory = vi.fn().mockResolvedValue(resolution);

    const runtime = createDefaultSettingsSyncRuntime({
      repository,
      remoteSyncConfig: { enabled: false, reason: "未配置" },
      webdavRuntimeFactory: factory,
    });

    expect(runtime.webdav).not.toBeNull();
    const inspected = await runtime.webdav!.inspect();
    expect(inspected).toBe(resolution);
    const result = await runtime.webdav!.runOnce();
    expect(result).toEqual({
      ok: true,
      report: expect.objectContaining({ markedSyncedCount: 1 }),
    });
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("factory 抛错时 runOnce 包成 ok:false", async () => {
    const runtime = createDefaultSettingsSyncRuntime({
      repository: stubRepository(),
      remoteSyncConfig: { enabled: false, reason: "未配置" },
      webdavRuntimeFactory: () => Promise.reject(new Error("装配崩了")),
    });
    const result = await runtime.webdav!.runOnce();
    expect(result).toEqual({
      ok: false,
      error: "WebDAV runtime 装配失败：装配崩了",
    });
  });

  it("factory 返回 disabled 时 runOnce 直接返回 reason", async () => {
    const runtime = createDefaultSettingsSyncRuntime({
      repository: stubRepository(),
      remoteSyncConfig: { enabled: false, reason: "未配置" },
      webdavRuntimeFactory: async () => ({
        kind: "disabled",
        reason: "尚未配置 WebDAV 凭据",
      }),
    });
    const result = await runtime.webdav!.runOnce();
    expect(result).toEqual({ ok: false, error: "尚未配置 WebDAV 凭据" });
  });
});

function stubRepository(): TaskRepository {
  return {
    listPendingChanges: vi.fn(),
    markChangeSynced: vi.fn(),
    getSyncState: vi.fn(),
    applyRemoteTask: vi.fn(),
    deleteRemoteTask: vi.fn(),
    saveSyncState: vi.fn(),
  } as unknown as TaskRepository;
}
