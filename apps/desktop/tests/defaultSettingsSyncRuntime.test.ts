import { describe, expect, it, vi } from "vitest";
import { createDefaultSettingsSyncRuntime } from "../src/sync/defaultSettingsSyncRuntime";
import type {
  WebdavRunOnceResult,
  WebdavRuntimeResolution,
} from "../src/sync/webdav";

describe("默认设置页 WebDAV 同步装配", () => {
  it("未注入 WebDAV factory 时 webdav 为 null", () => {
    const runtime = createDefaultSettingsSyncRuntime();
    expect(runtime.webdav).toBeNull();
  });

  it("注入 WebDAV factory 时，inspect/runOnce 委派到 factory", async () => {
    const runOnce = vi
      .fn<() => Promise<WebdavRunOnceResult>>()
      .mockResolvedValue({
        ok: true,
        report: {
          pushedOpsCount: 1,
          pushedTaskChangeCount: 1,
          pushedTaskListChangeCount: 0,
          markedSyncedCount: 1,
          markedTaskChangeSyncedCount: 1,
          markedTaskListChangeSyncedCount: 0,
          pulledOpsCount: 0,
          appliedTaskCount: 0,
          deletedTaskCount: 0,
          appliedTaskListCount: 0,
          deletedTaskListCount: 0,
          serverCursor: "{}",
          message: "ok",
        },
      });
    const resolution: WebdavRuntimeResolution = {
      kind: "enabled",
      runner: { runOnce },
      secrets: {
        baseUrl: "https://dav.jianguoyun.com/dav",
        root: "/liliatodo",
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

  it("WebDAV runOnce 成功后通知订阅者", async () => {
    const report = {
      pushedOpsCount: 1,
      pushedTaskChangeCount: 1,
      pushedTaskListChangeCount: 0,
      markedSyncedCount: 1,
      markedTaskChangeSyncedCount: 1,
      markedTaskListChangeSyncedCount: 0,
      pulledOpsCount: 0,
      appliedTaskCount: 0,
      deletedTaskCount: 0,
      appliedTaskListCount: 0,
      deletedTaskListCount: 0,
      serverCursor: "cursor-after",
      message: "已上传 1 条本地任务变更",
    };
    const runOnce = vi
      .fn<() => Promise<WebdavRunOnceResult>>()
      .mockResolvedValue({ ok: true, report });
    const runtime = createDefaultSettingsSyncRuntime({
      webdavRuntimeFactory: async () => ({
        kind: "enabled",
        runner: { runOnce },
        secrets: {
          baseUrl: "https://dav.jianguoyun.com/dav",
          root: "/liliatodo",
          username: "u",
          password: "p",
          deviceId: "desk-a",
        },
        layout: {} as never,
        provider: {} as never,
        client: {} as never,
      }),
    });
    const listener = vi.fn();

    const unsubscribe = runtime.webdav!.onRunCompleted(listener);
    await runtime.webdav!.runOnce();

    expect(listener).toHaveBeenCalledWith(report);

    unsubscribe();
    await runtime.webdav!.runOnce();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("factory 抛错时 runOnce 包成 ok:false", async () => {
    const runtime = createDefaultSettingsSyncRuntime({
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
      webdavRuntimeFactory: async () => ({
        kind: "disabled",
        reason: "尚未配置 WebDAV 凭据",
      }),
    });
    const result = await runtime.webdav!.runOnce();
    expect(result).toEqual({ ok: false, error: "尚未配置 WebDAV 凭据" });
  });
});
