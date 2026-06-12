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
  WebdavRunReport,
  WebdavRunOnceResult,
  WebdavRuntimeResolution,
} from "./webdav";

export type WebdavRunCompletedListener = (report: WebdavRunReport) => void;

export interface WebdavSyncController {
  /** 探测当前 WebDAV runtime 状态（凭据/装配是否就绪），UI 用来显示提示。 */
  inspect(): Promise<WebdavRuntimeResolution>;
  /** 执行一次 push+pull；凭据缺失或装配失败时返回 ok:false。 */
  runOnce(): Promise<WebdavRunOnceResult>;
  getAutoSyncStatus(): WebdavAutoSyncStatus;
  setAutoSyncEnabled(enabled: boolean): Promise<WebdavAutoSyncStatus>;
  restoreAutoSync(): Promise<WebdavAutoSyncStatus>;
  notifyLocalChange(): void;
  /** 订阅成功完成的同步报告；返回取消订阅函数。 */
  onRunCompleted(listener: WebdavRunCompletedListener): () => void;
}

export interface WebdavAutoSyncStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  lastError: string | null;
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
  const completedListeners = new Set<WebdavRunCompletedListener>();
  const autoSyncStorageKey = 'liliatodo.webdavAutoSync';
  const autoSyncIntervalMs = 5 * 60 * 1000;
  const autoSyncIdleMs = 5 * 1000;
  let autoSyncEnabled = loadAutoSyncEnabled(autoSyncStorageKey);
  let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  let autoSyncIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSyncRunning = false;
  let autoSyncLastRunAt: string | null = null;
  let autoSyncLastError: string | null = null;

  function notifyRunCompleted(report: WebdavRunReport) {
    completedListeners.forEach((listener) => {
      try {
        listener(report);
      } catch {
        // UI 订阅者异常不应反向破坏同步结果。
      }
    });
  }

  function getAutoSyncStatus(): WebdavAutoSyncStatus {
    return {
      enabled: autoSyncEnabled,
      running: autoSyncTimer !== null,
      intervalMs: autoSyncIntervalMs,
      lastRunAt: autoSyncLastRunAt,
      lastError: autoSyncLastError,
    };
  }

  async function runAutoSync() {
    if (autoSyncRunning) return;
    autoSyncRunning = true;
    try {
      const result = await runOnceInternal();
      autoSyncLastRunAt = new Date().toISOString();
      autoSyncLastError = result.ok ? null : result.error;
    } catch (error) {
      autoSyncLastRunAt = new Date().toISOString();
      autoSyncLastError = error instanceof Error ? error.message : String(error);
    } finally {
      autoSyncRunning = false;
    }
  }

  function stopAutoSyncTimer() {
    if (autoSyncIdleTimer !== null) {
      clearTimeout(autoSyncIdleTimer);
      autoSyncIdleTimer = null;
    }
    if (autoSyncTimer !== null) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
  }

  function scheduleAutoSyncIdle() {
    if (!autoSyncEnabled || autoSyncTimer === null) return;
    if (autoSyncIdleTimer !== null) clearTimeout(autoSyncIdleTimer);
    autoSyncIdleTimer = setTimeout(() => {
      autoSyncIdleTimer = null;
      void runAutoSync();
    }, autoSyncIdleMs);
  }

  async function startAutoSyncTimer() {
    if (autoSyncTimer === null) {
      autoSyncTimer = setInterval(() => {
        void runAutoSync();
      }, autoSyncIntervalMs);
    }
    await runAutoSync();
    return getAutoSyncStatus();
  }

  async function runOnceInternal() {
    let resolution: WebdavRuntimeResolution;
    try {
      resolution = await factory();
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error
          ? `WebDAV runtime 装配失败：${error.message}`
          : 'WebDAV runtime 装配失败',
      };
    }
    if (resolution.kind === 'disabled') {
      return { ok: false as const, error: resolution.reason };
    }
    const result = await resolution.runner.runOnce();
    if (result.ok) notifyRunCompleted(result.report);
    return result;
  }

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
      return runOnceInternal();
    },
    getAutoSyncStatus,
    async setAutoSyncEnabled(enabled) {
      autoSyncEnabled = enabled;
      saveAutoSyncEnabled(autoSyncStorageKey, enabled);
      if (!enabled) {
        stopAutoSyncTimer();
        return getAutoSyncStatus();
      }
      return startAutoSyncTimer();
    },
    async restoreAutoSync() {
      autoSyncEnabled = loadAutoSyncEnabled(autoSyncStorageKey);
      if (!autoSyncEnabled) {
        stopAutoSyncTimer();
        return getAutoSyncStatus();
      }
      return startAutoSyncTimer();
    },
    notifyLocalChange() {
      scheduleAutoSyncIdle();
    },
    onRunCompleted(listener) {
      completedListeners.add(listener);
      return () => {
        completedListeners.delete(listener);
      };
    },
  };
}

function loadAutoSyncEnabled(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function saveAutoSyncEnabled(key: string, enabled: boolean) {
  try {
    if (enabled) {
      globalThis.localStorage?.setItem(key, 'true');
    } else {
      globalThis.localStorage?.removeItem(key);
    }
  } catch {
    // 设置持久化失败不应影响本轮用户操作。
  }
}
