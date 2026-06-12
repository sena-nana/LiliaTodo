import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Op } from "../src/sync/types/op";
import {
  createWebdavSyncScheduler,
  DEFAULT_IDLE_DEBOUNCE_MS,
  DEFAULT_PULL_INTERVAL_MS,
  type SchedulerTimers,
  type TimerHandle,
} from "../src/sync/webdav/scheduler";
import type { SyncProvider } from "../src/sync/webdav/provider";

// 受控 timer：测试用，直接由 advance(ms) 推进；不依赖 vitest fake timers，
// 避免与 await microtask 的微妙交互。
interface ControlledTimers extends SchedulerTimers {
  advance(ms: number): void;
  readonly pendingTimeoutCount: number;
  readonly pendingIntervalCount: number;
}

function createControlledTimers(): ControlledTimers {
  let now = 0;
  let nextId = 1;
  const timeouts = new Map<
    number,
    { fireAt: number; handler: () => void; cancelled: boolean }
  >();
  const intervals = new Map<
    number,
    { intervalMs: number; nextFireAt: number; handler: () => void; cancelled: boolean }
  >();

  return {
    setTimeout(handler, ms) {
      const id = nextId++;
      timeouts.set(id, { fireAt: now + ms, handler, cancelled: false });
      return id as TimerHandle;
    },
    clearTimeout(handle) {
      const entry = timeouts.get(handle as number);
      if (entry) {
        entry.cancelled = true;
        timeouts.delete(handle as number);
      }
    },
    setInterval(handler, ms) {
      const id = nextId++;
      intervals.set(id, {
        intervalMs: ms,
        nextFireAt: now + ms,
        handler,
        cancelled: false,
      });
      return id as TimerHandle;
    },
    clearInterval(handle) {
      const entry = intervals.get(handle as number);
      if (entry) {
        entry.cancelled = true;
        intervals.delete(handle as number);
      }
    },
    advance(ms) {
      const target = now + ms;
      while (now < target) {
        let nextFire = target;
        for (const entry of timeouts.values()) {
          if (!entry.cancelled && entry.fireAt < nextFire) {
            nextFire = entry.fireAt;
          }
        }
        for (const entry of intervals.values()) {
          if (!entry.cancelled && entry.nextFireAt < nextFire) {
            nextFire = entry.nextFireAt;
          }
        }
        now = nextFire;
        for (const [id, entry] of [...timeouts.entries()]) {
          if (!entry.cancelled && entry.fireAt <= now) {
            timeouts.delete(id);
            entry.handler();
          }
        }
        for (const entry of intervals.values()) {
          while (!entry.cancelled && entry.nextFireAt <= now) {
            entry.nextFireAt += entry.intervalMs;
            entry.handler();
          }
        }
      }
    },
    get pendingTimeoutCount() {
      let n = 0;
      for (const entry of timeouts.values()) {
        if (!entry.cancelled) n += 1;
      }
      return n;
    },
    get pendingIntervalCount() {
      let n = 0;
      for (const entry of intervals.values()) {
        if (!entry.cancelled) n += 1;
      }
      return n;
    },
  };
}

function makeOp(overrides: Partial<Op> = {}): Op {
  return {
    op: "put",
    target: { entityType: "task", entityId: "t1" },
    params: { title: "x" },
    ts: "2026-05-19T10:00:00.000Z",
    actor: "user:wjx",
    originDevice: "deviceA",
    ...overrides,
  };
}

interface ProviderStubs {
  push: ReturnType<typeof vi.fn>;
  pull: ReturnType<typeof vi.fn>;
}

function createProviderStub(): { provider: SyncProvider; stubs: ProviderStubs } {
  const stubs: ProviderStubs = {
    push: vi.fn(async (_ops: Op[]) => ({
      acceptedCount: _ops.length,
      chunkPath: "/liliatodo/oplog/deviceA/20260519/000000.jsonl",
    })),
    pull: vi.fn(async (_since: string | null) => ({
      ops: [] as Op[],
      cursor: "cursor-v1",
    })),
  };
  const provider: SyncProvider = {
    push: stubs.push as unknown as SyncProvider["push"],
    pull: stubs.pull as unknown as SyncProvider["pull"],
    snapshot: vi.fn(),
    pushEntity: vi.fn(),
    getEntity: vi.fn(),
  };
  return { provider, stubs };
}

function createCursorStore() {
  let value: string | null = null;
  return {
    load: vi.fn(async () => value),
    save: vi.fn(async (next: string) => {
      value = next;
    }),
    get current() {
      return value;
    },
  };
}

interface SchedulerHarness {
  timers: ControlledTimers;
  pendingOps: Op[];
  onPushed: ReturnType<typeof vi.fn>;
  onPulled: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  provider: SyncProvider;
  providerStubs: ProviderStubs;
  cursor: ReturnType<typeof createCursorStore>;
  flushMicrotasks(): Promise<void>;
}

function makeHarness(): SchedulerHarness {
  const { provider, stubs } = createProviderStub();
  return {
    timers: createControlledTimers(),
    pendingOps: [],
    onPushed: vi.fn(async () => {}),
    onPulled: vi.fn(async () => {}),
    onError: vi.fn(),
    provider,
    providerStubs: stubs,
    cursor: createCursorStore(),
    flushMicrotasks: async () => {
      // 让 await 链穿过所有挂起的 microtask
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    },
  };
}

let harness: SchedulerHarness;

beforeEach(() => {
  harness = makeHarness();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BE-12 sprint-2 WebdavSyncScheduler", () => {
  it("默认 idle 防抖 5s、周期 30s", () => {
    expect(DEFAULT_IDLE_DEBOUNCE_MS).toBe(5000);
    expect(DEFAULT_PULL_INTERVAL_MS).toBe(30000);
  });

  it("start() 立即跑一次 initial 同步", async () => {
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    const report = await scheduler.start();
    expect(report?.reason).toBe("initial");
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(1);
    expect(harness.cursor.current).toBe("cursor-v1");
    scheduler.stop();
  });

  it("notifyLocalChange 防抖：连续触发只在最后一次后 5s 跑同步", async () => {
    harness.pendingOps = [makeOp()];
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    scheduler.notifyLocalChange();
    harness.timers.advance(2000);
    scheduler.notifyLocalChange();
    harness.timers.advance(2000);
    scheduler.notifyLocalChange();
    await harness.flushMicrotasks();
    expect(harness.providerStubs.push).not.toHaveBeenCalled();

    harness.timers.advance(4999);
    await harness.flushMicrotasks();
    expect(harness.providerStubs.push).not.toHaveBeenCalled();

    harness.timers.advance(1);
    await harness.flushMicrotasks();
    expect(harness.providerStubs.push).toHaveBeenCalledTimes(1);
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("周期触发 pull 与 push", async () => {
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
      pullIntervalMs: 30000,
    });

    await scheduler.start();
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(1);

    harness.timers.advance(30000);
    await harness.flushMicrotasks();
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(2);

    harness.timers.advance(30000);
    await harness.flushMicrotasks();
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("triggerNow(manual) 立即跑并返回报告", async () => {
    harness.pendingOps = [makeOp(), makeOp({ ts: "2026-05-19T10:01:00.000Z" })];
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    const report = await scheduler.triggerNow("manual");
    expect(report.reason).toBe("manual");
    expect(report.idleWindow).toBe(false);
    expect(report.pushedCount).toBe(2);
    expect(report.error).toBeNull();
    expect(harness.onPushed).toHaveBeenCalledWith(harness.pendingOps);
    scheduler.stop();
  });

  it("重入抑制：同步中再次 triggerNow 不并发，只排一个挂起", async () => {
    let resolvePush!: () => void;
    harness.providerStubs.push.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolvePush = resolve;
      });
      return { acceptedCount: 1, chunkPath: "/p" };
    });
    harness.pendingOps = [makeOp()];

    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    const firstRun = scheduler.triggerNow("manual");
    await harness.flushMicrotasks();
    // 二次/三次触发都被收编为同一个挂起
    const secondRun = scheduler.triggerNow("manual");
    const thirdRun = scheduler.triggerNow("manual");
    await harness.flushMicrotasks();
    expect(harness.providerStubs.push).toHaveBeenCalledTimes(1);

    resolvePush();
    await firstRun;
    await secondRun;
    await thirdRun;
    await harness.flushMicrotasks();
    // 第二次 run 在第一次完成后启动
    expect(harness.providerStubs.push).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("provider.pull 抛错时上报 onError 并 cursor 保持不变", async () => {
    harness.providerStubs.pull.mockRejectedValueOnce(new Error("offline"));
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    const report = await scheduler.triggerNow("manual");
    expect(report.error).toBe("offline");
    expect(harness.onError).toHaveBeenCalledOnce();
    expect(harness.cursor.save).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("stop 后 notifyLocalChange/triggerNow 不再启动同步", async () => {
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    await scheduler.start();
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(1);

    scheduler.stop();
    scheduler.notifyLocalChange();
    harness.timers.advance(10000);
    await harness.flushMicrotasks();
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(1);

    await expect(scheduler.triggerNow("manual")).rejects.toThrow(/已停止/);
    expect(harness.timers.pendingTimeoutCount).toBe(0);
    expect(harness.timers.pendingIntervalCount).toBe(0);
  });

  it("空 pending ops 时不调用 push，但仍执行 pull", async () => {
    harness.pendingOps = [];
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    const report = await scheduler.triggerNow("manual");
    expect(harness.providerStubs.push).not.toHaveBeenCalled();
    expect(harness.providerStubs.pull).toHaveBeenCalledTimes(1);
    expect(report.pushedCount).toBe(0);
    scheduler.stop();
  });

  it("pull 返回 ops 时调 onPulled 并保存 cursor", async () => {
    const inbound: Op[] = [
      makeOp({ originDevice: "deviceB", params: { title: "remote" } }),
    ];
    harness.providerStubs.pull.mockResolvedValueOnce({
      ops: inbound,
      cursor: "next-cursor",
    });
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    const report = await scheduler.triggerNow("manual");
    expect(report.pulledCount).toBe(1);
    expect(report.cursor).toBe("next-cursor");
    expect(harness.onPulled).toHaveBeenCalledWith(inbound);
    expect(harness.cursor.current).toBe("next-cursor");
    scheduler.stop();
  });

  it("pull 把已存 cursor 传给 provider", async () => {
    await harness.cursor.save("prior-cursor");
    harness.providerStubs.pull.mockResolvedValueOnce({
      ops: [],
      cursor: "prior-cursor",
    });
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });

    await scheduler.triggerNow("manual");
    expect(harness.providerStubs.pull).toHaveBeenCalledWith("prior-cursor");
    scheduler.stop();
  });

  it("isRunning 反映周期 timer 是否在跑", async () => {
    const scheduler = createWebdavSyncScheduler({
      provider: harness.provider,
      getPendingOps: async () => harness.pendingOps,
      onPushed: harness.onPushed,
      onPulled: harness.onPulled,
      loadCursor: harness.cursor.load,
      saveCursor: harness.cursor.save,
      onError: harness.onError,
      timers: harness.timers,
    });
    expect(scheduler.isRunning()).toBe(false);
    await scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});
