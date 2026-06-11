import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import {
  AgentAutoTriggerController,
  createAgentObservedTaskRepository,
} from "../src/agent/autoTriggers";
import type { AgentSettings } from "../src/agent/settings";
import type { AgentTaskContextSnapshot } from "../src/agent/context";
import type { AgentAuditRecord } from "../src/agent/actions";
import { fakeTaskRepository, taskFixture, taskListFixture } from "./taskFixtures";

describe("Agent 自动触发", () => {
  it("自动触发关闭时不扫描 runtime，也不写入待确认操作", async () => {
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: false });
    const repository = fakeTaskRepository();
    const triggerScan = vi.fn();
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      throttleMs: 0,
      triggerScan,
    });

    const envelope = controller.requestTaskUpdated("task-1", "2026-05-16T12:00:00.000Z");
    await Promise.resolve();

    expect(envelope).toBeNull();
    expect(triggerScan).not.toHaveBeenCalled();
    expect(repository.createAgentPendingActionFromTool).not.toHaveBeenCalled();
  });

  it("任务创建成功后扫描 runtime，并把建议写入确认队列", async () => {
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: true });
    const repository = fakeTaskRepository({
      activeTasks: [taskFixture({ id: "task-1", title: "整理报告" })],
      lists: [taskListFixture({ id: "inbox", name: "收件箱" })],
      agentInbox: { pendingActions: [], audits: [] },
    });
    const buildSnapshot = vi.fn().mockResolvedValue(snapshotFixture());
    const action = { type: "task.update" as const, taskId: "task-1", patch: { priority: 2 } };
    const triggerScan = vi.fn().mockResolvedValue({
      status: "ready",
      diagnostic: "自动扫描完成，生成 1 条待确认建议。",
      suggestions: [{
        action_type: "task.update",
        summary: "提高任务优先级",
        risk: "medium",
        action,
        task_ids: ["task-1"],
        codex_thread_id: "thread-1",
        codex_turn_id: "turn-1",
      }],
    });
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      throttleMs: 0,
      buildSnapshot,
      triggerScan,
      getRuntimeStatus: runningRuntimeStatus,
    });
    const observedRepository = createAgentObservedTaskRepository(repository, controller);

    await observedRepository.createTask({ title: "整理报告" });
    await vi.waitFor(() => expect(triggerScan).toHaveBeenCalledTimes(1));

    expect(buildSnapshot).toHaveBeenCalledWith(repository);
    expect(repository.createAgentPendingActionFromTool).toHaveBeenCalledWith(action, expect.objectContaining({
      trigger: "task.created",
      envelopeId: expect.any(String),
      summary: "任务创建：整理报告",
      taskIds: ["task-1"],
      codexThreadId: "thread-1",
      codexTurnId: "turn-1",
    }));
    expect(controller.diagnostics.value.lastRun).toEqual(expect.objectContaining({
      trigger: "task.created",
      summary: "任务创建：整理报告",
      status: "ready",
      diagnostic: "自动扫描完成，生成 1 条待确认建议。",
      suggestionCount: 1,
      enqueuedCount: 1,
    }));
    expect(controller.diagnostics.value.lastError).toBeNull();
    expect(repository.approveAgentPendingAction).not.toHaveBeenCalled();
  });

  it("同一任务连续更新在节流窗口内只触发一次扫描，并使用合并后的 envelope", async () => {
    vi.useFakeTimers();
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: true });
    const repository = fakeTaskRepository();
    const action = { type: "task.update" as const, taskId: "task-1", patch: { priority: 2 } };
    const triggerScan = vi.fn().mockResolvedValue({
      status: "ready",
      diagnostic: "自动扫描完成。",
      suggestions: [{
        action_type: "task.update",
        summary: "提高任务优先级",
        risk: "medium",
        action,
        task_ids: ["task-1"],
      }],
    });
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      throttleMs: 60_000,
      buildSnapshot: vi.fn().mockResolvedValue(snapshotFixture()),
      triggerScan,
      getRuntimeStatus: runningRuntimeStatus,
    });

    controller.requestTrigger({
      trigger: "task.updated",
      taskId: "task-1",
      summary: "第一次更新",
      createdAt: "2026-05-16T12:00:00.000Z",
    });
    controller.requestTrigger({
      trigger: "task.updated",
      taskId: "task-1",
      summary: "第二次更新",
      createdAt: "2026-05-16T12:00:30.000Z",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(triggerScan).toHaveBeenCalledTimes(1);
    expect(repository.createAgentPendingActionFromTool).toHaveBeenCalledWith(action, expect.objectContaining({
      trigger: "task.updated",
      summary: "第二次更新",
      taskIds: ["task-1"],
    }));
    vi.useRealTimers();
  });

  it("每日首次启动同一天只触发一次，隔天重新触发", async () => {
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: true });
    const repository = fakeTaskRepository();
    const storage = new MemoryStorage();
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      storage,
      throttleMs: 0,
      triggerScan: vi.fn().mockResolvedValue({
        status: "ready",
        diagnostic: "自动扫描完成。",
        suggestions: [],
      }),
    });

    expect(controller.requestDailyStartup(new Date("2026-05-16T08:00:00.000Z"))).not.toBeNull();
    expect(controller.requestDailyStartup(new Date("2026-05-16T12:00:00.000Z"))).toBeNull();
    expect(controller.requestDailyStartup(new Date("2026-05-17T08:00:00.000Z"))).not.toBeNull();
  });

  it("逾期任务按任务和截止时间去重，截止时间变化后可再次触发", async () => {
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: true });
    const first = taskFixture({
      id: "task-1",
      title: "逾期任务",
      dueAt: "2026-05-15T08:00:00.000Z",
    });
    const second = taskFixture({
      id: "task-1",
      title: "逾期任务",
      dueAt: "2026-05-15T09:00:00.000Z",
    });
    const repository = fakeTaskRepository({
      today: { overdue: [first], dueToday: [], completedToday: [] },
    });
    const triggerScan = vi.fn().mockResolvedValue({
      status: "ready",
      diagnostic: "自动扫描完成。",
      suggestions: [],
    });
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      throttleMs: 0,
      triggerScan,
      getRuntimeStatus: runningRuntimeStatus,
    });

    await controller.scanOverdueTasks(new Date("2026-05-16T08:00:00.000Z"));
    await vi.waitFor(() => expect(triggerScan).toHaveBeenCalledTimes(1));
    await controller.scanOverdueTasks(new Date("2026-05-16T08:10:00.000Z"));
    expect(triggerScan).toHaveBeenCalledTimes(1);
    vi.mocked(repository.listToday).mockResolvedValueOnce({
      overdue: [second],
      dueToday: [],
      completedToday: [],
    });
    await controller.scanOverdueTasks(new Date("2026-05-16T08:20:00.000Z"));

    await vi.waitFor(() => expect(triggerScan).toHaveBeenCalledTimes(2));
  });

  it("提醒通知的 bookkeeping 更新不会额外触发任务更新扫描", async () => {
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: true });
    const repository = fakeTaskRepository();
    const triggerScan = vi.fn().mockResolvedValue({
      status: "ready",
      diagnostic: "自动扫描完成。",
      suggestions: [],
    });
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      throttleMs: 0,
      triggerScan,
    });
    const observedRepository = createAgentObservedTaskRepository(repository, controller);

    await observedRepository.updateTask("task-1", {
      lastReminderNotifiedAt: "2026-05-16T12:00:00.000Z",
    });
    await Promise.resolve();

    expect(triggerScan).not.toHaveBeenCalled();
  });

  it("确认队列执行时使用原始仓库方法，不让 Agent 写入回触发自动扫描", async () => {
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: true });
    const repository = fakeTaskRepository();
    const triggerScan = vi.fn().mockResolvedValue({
      status: "ready",
      diagnostic: "自动扫描完成。",
      suggestions: [],
    });
    vi.mocked(repository.approveAgentPendingAction).mockImplementation(function (
      this: typeof repository,
      actionId: string,
    ) {
      void this.updateTask("task-1", { priority: 2 });
      return Promise.resolve({
        id: "audit-1",
        batchId: "batch-1",
        actionId,
        actionType: "task.update",
        payload: { type: "task.update", taskId: "task-1", patch: { priority: 2 } },
        summary: "更新任务 task-1：优先级",
        status: "applied",
        reversible: true,
        before: null,
        after: null,
        source: {
          trigger: "manual_scan",
          envelopeId: "envelope-1",
          summary: "手动扫描",
          taskIds: ["task-1"],
        },
        error: null,
        createdAt: "2026-05-16T12:00:00.000Z",
        undoneAt: null,
      } satisfies AgentAuditRecord);
    });
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      throttleMs: 0,
      triggerScan,
    });
    const observedRepository = createAgentObservedTaskRepository(repository, controller);

    await observedRepository.approveAgentPendingAction("agent-action-1");
    await Promise.resolve();

    expect(repository.updateTask).toHaveBeenCalledWith("task-1", { priority: 2 });
    expect(triggerScan).not.toHaveBeenCalled();
  });

  it("runtime 未运行时不构建快照、不扫描、不写入待确认操作", async () => {
    const settings = ref<AgentSettings>({ automaticTriggersEnabled: true });
    const repository = fakeTaskRepository();
    const buildSnapshot = vi.fn().mockResolvedValue(snapshotFixture());
    const triggerScan = vi.fn();
    const controller = new AgentAutoTriggerController(repository, {
      settings,
      throttleMs: 0,
      buildSnapshot,
      triggerScan,
      getRuntimeStatus: () => Promise.resolve({
        lifecycle: "disabled",
        agent_id: "momo-agent",
        agent_phase: "stop",
        backend_configured: false,
        disabled_reason: "尚未配置 backend，Agent 已禁用。",
        buffered_event_count: 2,
      }),
    });

    controller.requestTaskUpdated("task-1", "2026-05-16T12:00:00.000Z");
    await vi.waitFor(() => expect(controller.lastError).toBe("尚未配置 backend，Agent 已禁用。"));

    expect(controller.diagnostics.value.lastRun).toEqual(expect.objectContaining({
      trigger: "task.updated",
      summary: "任务更新",
      status: "skipped",
      diagnostic: "尚未配置 backend，Agent 已禁用。",
      suggestionCount: 0,
      enqueuedCount: 0,
    }));
    expect(controller.diagnostics.value.lastError).toBe("尚未配置 backend，Agent 已禁用。");
    expect(buildSnapshot).not.toHaveBeenCalled();
    expect(triggerScan).not.toHaveBeenCalled();
    expect(repository.createAgentPendingActionFromTool).not.toHaveBeenCalled();
  });
});

function snapshotFixture(): AgentTaskContextSnapshot {
  return {
    generatedAt: "2026-05-16T12:00:00.000Z",
    truncated: false,
    limits: { maxTasks: 120, maxTextLength: 240 },
    tasks: [],
    lists: [],
    categories: [],
  };
}

function runningRuntimeStatus() {
  return Promise.resolve({
    lifecycle: "running" as const,
    agent_id: "momo-agent",
    agent_phase: "awake" as const,
    backend_configured: true,
    disabled_reason: null,
    buffered_event_count: 3,
  });
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
