// BE-12 sprint-4.3b：默认设置页同步运行时。
//
// 此前只承载本地内存 router 模拟（localSyncRunner），sprint-4.3b 起：
//   - 凡是注入了 `webdavRuntimeFactory` 的场景，"运行同步"按钮经 WebDAV runner；
//   - 仍保留本地模拟作为离线诊断兜底（未来 AP-01 完全摘除 apps/api 时再清理）。
//
// `webdavRuntimeFactory` 改为 async 工厂而不是直接的 resolution，原因：
//   - plugin-store / plugin-http 在 App.vue 顶层为 async 装配，
//     一次同步 setup 无法拿到 ready 的 runner；
//   - 每次按钮点击都重新跑工厂，可拿到最新凭据并照常 fast-fail；
//   - 单测里直接注入 in-memory secretsStore，无需 Tauri 运行时。

import type { TaskRepository } from "../data/taskRepository";
import { createLocalSyncRunner } from "./localSyncRunner";
import type { RemoteSyncConfig } from "./remoteSyncConfig";
import type { SyncRunnerRunOnceResult } from "./syncClient";
import type {
  WebdavRunOnceResult,
  WebdavRuntimeResolution,
} from "./webdav";

export interface WebdavSyncController {
  /** 探测当前 WebDAV runtime 状态（凭据/装配是否就绪），UI 用来显示提示。 */
  inspect(): Promise<WebdavRuntimeResolution>;
  /** 执行一次 push+pull；凭据缺失或装配失败时返回 ok:false。 */
  runOnce(): Promise<WebdavRunOnceResult>;
}

export interface DefaultSettingsSyncRuntimeOptions {
  repository: TaskRepository;
  remoteSyncConfig: RemoteSyncConfig;
  /** WebDAV runtime 工厂；缺省则不暴露 WebDAV 通路。 */
  webdavRuntimeFactory?: () => Promise<WebdavRuntimeResolution>;
}

export interface DefaultSettingsSyncRuntime {
  remoteSyncConfig: RemoteSyncConfig;
  runLocalSyncSimulation: () => Promise<SyncRunnerRunOnceResult>;
  /** 未注入 WebDAV 工厂时为 null，UI 可借此隐藏按钮。 */
  webdav: WebdavSyncController | null;
}

export function createDefaultSettingsSyncRuntime({
  repository,
  remoteSyncConfig,
  webdavRuntimeFactory,
}: DefaultSettingsSyncRuntimeOptions): DefaultSettingsSyncRuntime {
  const localSyncRunner = createLocalSyncRunner(repository);

  return {
    remoteSyncConfig,
    runLocalSyncSimulation: () => localSyncRunner.runOnce(),
    webdav: webdavRuntimeFactory
      ? createWebdavController(webdavRuntimeFactory)
      : null,
  };
}

function createWebdavController(
  factory: () => Promise<WebdavRuntimeResolution>,
): WebdavSyncController {
  return {
    inspect() {
      return factory().catch((error) => ({
        kind: "disabled" as const,
        reason: error instanceof Error
          ? `WebDAV runtime 装配失败：${error.message}`
          : "WebDAV runtime 装配失败",
      }));
    },
    async runOnce() {
      let resolution: WebdavRuntimeResolution;
      try {
        resolution = await factory();
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error
            ? `WebDAV runtime 装配失败：${error.message}`
            : "WebDAV runtime 装配失败",
        };
      }
      if (resolution.kind === "disabled") {
        return { ok: false, error: resolution.reason };
      }
      return resolution.runner.runOnce();
    },
  };
}
