import { inject, type App, type InjectionKey, type Ref } from "vue";
import type { AgentTriggerEvent, AgentTriggerEnvelope } from "./triggers";
import { AgentTriggerBuffer, triggerEnvelopeToSource } from "./triggers";
import { useAgentSettings, type AgentSettings } from "./settings";
import { buildAgentTaskContextSnapshot, type AgentTaskContextSnapshot } from "./context";
import type { AgentRunnerTriggerResult } from "../agentRuntime";
import { triggerAgentRuntimeScan } from "../agentRuntime";
import type { TaskRepository } from "../data/taskRepository";
import type { Task, UpdateTaskInput } from "../domain/tasks";

export interface AgentReminderDueEvent {
  task: Task;
  reminderId: string;
  notifiedAt: string;
}

export interface AgentAutoTriggerOptions {
  settings?: Ref<AgentSettings>;
  throttleMs?: number;
  now?: () => Date;
  storage?: Storage | null;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  buildSnapshot?: (repository: TaskRepository) => Promise<AgentTaskContextSnapshot>;
  triggerScan?: (snapshot: AgentTaskContextSnapshot) => Promise<AgentRunnerTriggerResult>;
}

const DEFAULT_THROTTLE_MS = 60_000;
const DAILY_STARTUP_STORAGE_KEY = "liliatodo.agentAutoTriggers.lastDailyStartupDate";

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export class AgentAutoTriggerController {
  private readonly settings: Ref<AgentSettings>;
  private readonly buffer: AgentTriggerBuffer;
  private readonly timers = new Map<string, TimerHandle>();
  private readonly envelopeIdsByKey = new Map<string, string>();
  private readonly overdueKeys = new Set<string>();
  private readonly now: () => Date;
  private readonly storage: Storage | null;
  private readonly setTimer: typeof globalThis.setTimeout;
  private readonly clearTimer: typeof globalThis.clearTimeout;
  private readonly buildSnapshot: (repository: TaskRepository) => Promise<AgentTaskContextSnapshot>;
  private readonly triggerScan: (snapshot: AgentTaskContextSnapshot) => Promise<AgentRunnerTriggerResult>;
  private readonly throttleMs: number;

  lastError: string | null = null;

  constructor(
    private readonly repository: TaskRepository,
    options: AgentAutoTriggerOptions = {},
  ) {
    this.settings = options.settings ?? useAgentSettings();
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.buffer = new AgentTriggerBuffer({
      automaticTriggersEnabled: this.settings.value.automaticTriggersEnabled,
      throttleMs: this.throttleMs,
    });
    this.now = options.now ?? (() => new Date());
    this.storage = options.storage === undefined ? safeLocalStorage() : options.storage;
    this.setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.buildSnapshot = options.buildSnapshot ?? buildAgentTaskContextSnapshot;
    this.triggerScan = options.triggerScan ?? triggerAgentRuntimeScan;
  }

  requestTrigger(event: AgentTriggerEvent): AgentTriggerEnvelope | null {
    this.buffer.updateSettings({
      automaticTriggersEnabled: this.settings.value.automaticTriggersEnabled,
      throttleMs: this.throttleMs,
    });
    const envelope = this.buffer.push(event);
    if (!envelope) return null;

    const key = triggerKey(event.trigger, event.taskId);
    this.envelopeIdsByKey.set(key, envelope.id);
    if (!this.timers.has(key)) {
      const timer = this.setTimer(() => {
        this.timers.delete(key);
        void this.flush(key);
      }, this.throttleMs);
      this.timers.set(key, timer);
    }
    return envelope;
  }

  requestTaskCreated(task: Task, createdAt = this.now().toISOString()) {
    return this.requestTrigger({
      trigger: "task.created",
      taskId: task.id,
      summary: `任务创建：${task.title}`,
      createdAt,
    });
  }

  requestTaskUpdated(taskId: string, createdAt = this.now().toISOString()) {
    return this.requestTrigger({
      trigger: "task.updated",
      taskId,
      summary: "任务更新",
      createdAt,
    });
  }

  requestReminderDue(event: AgentReminderDueEvent) {
    return this.requestTrigger({
      trigger: "task.reminder_due",
      taskId: event.task.id,
      summary: `提醒到期：${event.task.title}`,
      createdAt: event.notifiedAt,
    });
  }

  requestDailyStartup(currentDate = this.now()) {
    if (!this.settings.value.automaticTriggersEnabled) return null;
    const todayKey = localDateKey(currentDate);
    if (this.storage?.getItem(DAILY_STARTUP_STORAGE_KEY) === todayKey) return null;
    const envelope = this.requestTrigger({
      trigger: "daily_startup",
      summary: "每日首次启动",
      createdAt: currentDate.toISOString(),
    });
    if (envelope) {
      this.storage?.setItem(DAILY_STARTUP_STORAGE_KEY, todayKey);
    }
    return envelope;
  }

  async runStartupChecks(currentDate = this.now()) {
    this.requestDailyStartup(currentDate);
    await this.scanOverdueTasks(currentDate);
  }

  async scanOverdueTasks(currentDate = this.now()) {
    if (!this.settings.value.automaticTriggersEnabled) return;
    try {
      const today = await this.repository.listToday(currentDate);
      for (const task of today.overdue) {
        const overdueKey = `${task.id}:${task.dueAt ?? "no-due"}`;
        if (this.overdueKeys.has(overdueKey)) continue;
        this.overdueKeys.add(overdueKey);
        this.requestTrigger({
          trigger: "task.overdue",
          taskId: task.id,
          summary: `任务逾期：${task.title}`,
          createdAt: currentDate.toISOString(),
        });
      }
    } catch (error) {
      this.lastError = readableError(error);
    }
  }

  stop() {
    for (const timer of this.timers.values()) {
      this.clearTimer(timer);
    }
    this.timers.clear();
  }

  private async flush(key: string) {
    if (!this.settings.value.automaticTriggersEnabled) return;
    const envelopeId = this.envelopeIdsByKey.get(key);
    const envelope = this.buffer.list().find((item) => item.id === envelopeId);
    if (!envelope) return;

    try {
      const snapshot = await this.buildSnapshot(this.repository);
      const result = await this.triggerScan(snapshot);
      if (result.status !== "ready" || result.suggestions.length === 0) return;
      await Promise.all(result.suggestions.map((suggestion) =>
        this.repository.createAgentPendingActionFromTool(suggestion.action, {
          ...triggerEnvelopeToSource(envelope),
          taskIds: suggestion.task_ids?.length ? suggestion.task_ids : envelope.taskIds,
          codexThreadId: suggestion.codex_thread_id ?? null,
          codexTurnId: suggestion.codex_turn_id ?? null,
        }),
      ));
    } catch (error) {
      this.lastError = readableError(error);
    }
  }
}

export function createAgentAutoTriggerController(
  repository: TaskRepository,
  options: AgentAutoTriggerOptions = {},
) {
  return new AgentAutoTriggerController(repository, options);
}

export function createAgentObservedTaskRepository(
  repository: TaskRepository,
  controller: AgentAutoTriggerController,
): TaskRepository {
  return {
    ...repository,
    async createTask(input) {
      const task = await repository.createTask(input);
      controller.requestTaskCreated(task);
      return task;
    },
    async updateTask(taskId, patch) {
      const task = await repository.updateTask(taskId, patch);
      if (!isReminderBookkeepingPatch(patch)) {
        controller.requestTaskUpdated(task.id);
      }
      return task;
    },
    async setStatus(taskId, status) {
      const task = await repository.setStatus(taskId, status);
      controller.requestTaskUpdated(task.id);
      return task;
    },
    async deleteTask(taskId) {
      await repository.deleteTask(taskId);
      controller.requestTaskUpdated(taskId);
    },
    async restoreTask(taskId) {
      const task = await repository.restoreTask(taskId);
      controller.requestTaskUpdated(task.id);
      return task;
    },
    async batchUpdateTasks(input) {
      const result = await repository.batchUpdateTasks(input);
      for (const taskId of result.succeeded) {
        controller.requestTaskUpdated(taskId);
      }
      return result;
    },
    async reorderTasks(input) {
      const tasks = await repository.reorderTasks(input);
      for (const task of tasks) {
        controller.requestTaskUpdated(task.id);
      }
      return tasks;
    },
    async snoozeReminder(taskId, reminderId, until) {
      const task = await repository.snoozeReminder(taskId, reminderId, until);
      controller.requestTaskUpdated(task.id);
      return task;
    },
    async dismissReminder(taskId, reminderId) {
      const task = await repository.dismissReminder(taskId, reminderId);
      controller.requestTaskUpdated(task.id);
      return task;
    },
    createAgentPendingAction(draft) {
      return repository.createAgentPendingAction(draft);
    },
    createAgentPendingActionFromTool(action, source) {
      return repository.createAgentPendingActionFromTool(action, source);
    },
    approveAgentPendingAction(actionId) {
      return repository.approveAgentPendingAction(actionId);
    },
    rejectAgentPendingAction(actionId, reason = null) {
      return repository.rejectAgentPendingAction(actionId, reason);
    },
    undoAgentAuditBatch(batchId) {
      return repository.undoAgentAuditBatch(batchId);
    },
  };
}

export const AgentAutoTriggerKey: InjectionKey<AgentAutoTriggerController> =
  Symbol("AgentAutoTrigger");

export function installAgentAutoTriggerController(
  app: App,
  controller: AgentAutoTriggerController,
) {
  app.provide(AgentAutoTriggerKey, controller);
}

export function useAgentAutoTriggerController() {
  const controller = inject(AgentAutoTriggerKey);
  if (!controller) {
    throw new Error("Agent auto trigger controller is not provided");
  }
  return controller;
}

function triggerKey(trigger: AgentTriggerEvent["trigger"], taskId: string | undefined) {
  return `${trigger}:${taskId ?? "global"}`;
}

function isReminderBookkeepingPatch(patch: UpdateTaskInput) {
  const keys = Object.keys(patch);
  return keys.length === 1 && keys[0] === "lastReminderNotifiedAt";
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeLocalStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readableError(error: unknown) {
  return String((error as Error)?.message ?? error);
}
