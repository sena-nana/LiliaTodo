// BE-12 sprint-2：WebDAV 同步调度器。
//
// 三种触发源统一收口：
//   - notifyLocalChange()：业务侧写 op 时通知；idle 防抖 5s 后跑一次同步
//   - 周期 timer：start() 后每 pullIntervalMs（默认 30s）跑一次同步
//   - triggerNow(reason)：tray 立即按钮或测试触发
//
// 同步语义固定：先 push 本地待发 ops（caller 通过 getPendingOps 提供），
// 再带 cursor 拉取远端 ops 应用到本地，最后持久化 cursor。任意阶段失败
// 走 onError，不向上抛；调用方自行决定告警/重试策略。
//
// 重入抑制：同步进行中再次触发只排一个挂起请求，当前结束后自动跑一次，
// 防止 idle/periodic/manual 三源叠加引发并发 push。

import type { Op } from "../../backend/contracts/op";
import type { SyncProvider } from "./provider";

export const DEFAULT_IDLE_DEBOUNCE_MS = 5000;
export const DEFAULT_PULL_INTERVAL_MS = 30000;

export type SyncReason = "idle" | "periodic" | "manual" | "initial";

export interface SyncRunReport {
  readonly reason: SyncReason;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly pushedCount: number;
  readonly pulledCount: number;
  readonly cursor: string | null;
  readonly error: string | null;
}

export type TimerHandle = unknown;

export interface SchedulerTimers {
  setTimeout(handler: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(handler: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export interface WebdavSyncSchedulerOptions {
  readonly provider: SyncProvider;
  /** 必须仅返回本设备产生的待 push ops；scheduler 全量提交，不再过滤。 */
  getPendingOps(): Promise<Op[]>;
  /** push 全部 acceptedCount === pending.length 时调用，用于标记已发送。 */
  onPushed(ops: Op[]): Promise<void>;
  /** 拉到远端 ops 后调用，由 caller 落地到本地存储。 */
  onPulled(ops: Op[]): Promise<void>;
  loadCursor(): Promise<string | null>;
  saveCursor(cursor: string): Promise<void>;
  onError(error: unknown, context: { reason: SyncReason }): void;
  readonly idleDebounceMs?: number;
  readonly pullIntervalMs?: number;
  readonly clock?: () => Date;
  readonly timers?: SchedulerTimers;
}

export interface WebdavSyncScheduler {
  start(): Promise<SyncRunReport | null>;
  stop(): void;
  notifyLocalChange(): void;
  triggerNow(reason: Exclude<SyncReason, "initial" | "idle">): Promise<SyncRunReport>;
  /** 仅用于测试/诊断，反映周期 timer 是否在跑。 */
  isRunning(): boolean;
}

const defaultTimers: SchedulerTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (handle) =>
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createWebdavSyncScheduler(
  options: WebdavSyncSchedulerOptions,
): WebdavSyncScheduler {
  const timers = options.timers ?? defaultTimers;
  const clock = options.clock ?? (() => new Date());
  const idleMs = options.idleDebounceMs ?? DEFAULT_IDLE_DEBOUNCE_MS;
  const pullMs = options.pullIntervalMs ?? DEFAULT_PULL_INTERVAL_MS;

  let idleTimer: TimerHandle | null = null;
  let periodicTimer: TimerHandle | null = null;
  let currentRun: Promise<SyncRunReport> | null = null;
  let queuedReason: SyncReason | null = null;
  let stopped = false;

  function clearIdle(): void {
    if (idleTimer !== null) {
      timers.clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdle(): void {
    if (stopped) {
      return;
    }
    clearIdle();
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      void run("idle");
    }, idleMs);
  }

  async function run(reason: SyncReason): Promise<SyncRunReport> {
    if (currentRun) {
      // 排队挂起：只保留最后一次触发原因，避免无限叠队
      queuedReason = reason;
      return currentRun;
    }

    clearIdle();
    const startedAt = clock().toISOString();
    let pushedCount = 0;
    let pulledCount = 0;
    let cursor: string | null = null;
    let error: string | null = null;

    const runPromise: Promise<SyncRunReport> = (async () => {
      try {
        const pending = await options.getPendingOps();
        if (pending.length > 0) {
          const pushResult = await options.provider.push(pending);
          pushedCount = pushResult.acceptedCount;
          if (pushResult.acceptedCount > 0) {
            await options.onPushed(pending);
          }
        }
        const stored = await options.loadCursor();
        const pullResult = await options.provider.pull(stored);
        pulledCount = pullResult.ops.length;
        cursor = pullResult.cursor;
        if (pullResult.ops.length > 0) {
          await options.onPulled(pullResult.ops);
        }
        await options.saveCursor(pullResult.cursor);
      } catch (caught) {
        error = toErrorMessage(caught);
        try {
          options.onError(caught, { reason });
        } catch {
          // onError 自身抛错不应再次失败掉整次同步报告
        }
      }
      return {
        reason,
        startedAt,
        finishedAt: clock().toISOString(),
        pushedCount,
        pulledCount,
        cursor,
        error,
      } satisfies SyncRunReport;
    })();

    currentRun = runPromise;
    try {
      return await runPromise;
    } finally {
      currentRun = null;
      if (queuedReason !== null && !stopped) {
        const next = queuedReason;
        queuedReason = null;
        // 不 await，让上一次 run 的调用方拿到 report；挂起任务自行推进
        void run(next);
      }
    }
  }

  return {
    async start() {
      if (stopped) {
        throw new Error("WebDAV 同步调度器已停止，不能再次 start");
      }
      if (periodicTimer === null) {
        periodicTimer = timers.setInterval(() => {
          void run("periodic");
        }, pullMs);
      }
      return run("initial");
    },
    stop() {
      stopped = true;
      clearIdle();
      if (periodicTimer !== null) {
        timers.clearInterval(periodicTimer);
        periodicTimer = null;
      }
      queuedReason = null;
    },
    notifyLocalChange() {
      scheduleIdle();
    },
    async triggerNow(reason) {
      if (stopped) {
        throw new Error("WebDAV 同步调度器已停止，不能 triggerNow");
      }
      return run(reason);
    },
    isRunning() {
      return periodicTimer !== null && !stopped;
    },
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
