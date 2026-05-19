// 默认设置页 WebDAV 同步装配。
//
// 阶段 80 起本运行时只承载 WebDAV 通路；旧的本地内存 runner 与远程 HTTP runner
// 已与 syncClient / remoteSyncRunner / httpSyncTransport 等一同下线。
//
// `webdavRuntimeFactory` 改为 async 工厂而不是直接的 resolution，原因：
//   - plugin-store / plugin-http 在 App.vue 顶层为 async 装配，
//     一次同步 setup 无法拿到 ready 的 runner；
//   - 每次按钮点击都重新跑工厂，可拿到最新凭据并照常 fast-fail；
//   - 单测里直接注入 in-memory secretsStore，无需 Tauri 运行时。

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
  /** WebDAV runtime 工厂；缺省则不暴露 WebDAV 通路。 */
  webdavRuntimeFactory?: () => Promise<WebdavRuntimeResolution>;
}

export interface DefaultSettingsSyncRuntime {
  /** 未注入 WebDAV 工厂时为 null，UI 可借此隐藏按钮。 */
  webdav: WebdavSyncController | null;
}

export function createDefaultSettingsSyncRuntime({
  webdavRuntimeFactory,
}: DefaultSettingsSyncRuntimeOptions = {}): DefaultSettingsSyncRuntime {
  return {
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
