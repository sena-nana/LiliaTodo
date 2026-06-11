import {
  isPermissionGranted,
  onAction,
  registerActionTypes,
  requestPermission,
  sendNotification,
  type Options,
} from "@tauri-apps/plugin-notification";
import { listen } from "@tauri-apps/api/event";
import type { AgentReminderDueEvent } from "./agent/autoTriggers";
import type { TaskRepository } from "./data/taskRepository";

const REMINDER_TICK_EVENT = "liliatodo:reminder-tick";
const REMINDER_ACTION_TYPE = "liliatodo-reminder";
export const OPEN_TASK_EVENT = "liliatodo:open-task";
const SNOOZE_MINUTES = 10;

let actionTypesReady: Promise<void> | null = null;
let actionListenerReady: Promise<unknown> | null = null;

export interface ReminderNotificationOptions {
  onReminderDue?: (event: AgentReminderDueEvent) => void;
}

export async function notifyDueReminders(
  repository: TaskRepository,
  options: ReminderNotificationOptions = {},
) {
  const granted = await ensureNotificationPermission();
  if (!granted) {
    throw new Error("系统通知权限不足");
  }
  await ensureReminderActions(repository);
  const now = new Date();
  const notifiedAt = now.toISOString();
  const tasks = await repository.listDueReminders(now);
  for (const task of tasks) {
    if (task.lastReminderNotifiedAt) continue;
    const dueReminder = task.reminders.find((reminder) =>
      reminder.status === "pending" && new Date(reminder.triggerAt).getTime() <= now.getTime(),
    );
    if (!dueReminder) continue;
    await sendNotification({
      id: notificationId(task.id, dueReminder.id),
      title: `提醒：${task.title}`,
      body: dueReminder.message ?? task.notes ?? "任务提醒已到",
      actionTypeId: REMINDER_ACTION_TYPE,
      autoCancel: true,
      extra: {
        taskId: task.id,
        reminderId: dueReminder.id,
      },
    });
    options.onReminderDue?.({
      task,
      reminderId: dueReminder.id,
      notifiedAt,
    });
    await repository.updateTask(task.id, { lastReminderNotifiedAt: notifiedAt });
  }
  return tasks.length;
}

export async function ensureNotificationPermission() {
  const granted = await isPermissionGranted();
  if (granted) return true;
  const permission = await requestPermission();
  return permission === "granted";
}

export async function listenReminderTicks(
  repository: TaskRepository,
  options: ReminderNotificationOptions = {},
) {
  await ensureReminderActions(repository);
  return listen(REMINDER_TICK_EVENT, () => {
    void notifyDueReminders(repository, options).catch(() => undefined);
  });
}

export async function ensureReminderActions(repository: TaskRepository) {
  actionTypesReady ??= registerActionTypes([
    {
      id: REMINDER_ACTION_TYPE,
      actions: [
        { id: "open", title: "打开任务", foreground: true },
        { id: "snooze", title: "稍后提醒" },
        { id: "dismiss", title: "关闭提醒", destructive: true },
      ],
      customDismissAction: true,
    },
  ]);
  await actionTypesReady;
  actionListenerReady ??= onAction((notification) => {
    void handleReminderAction(repository, notification).catch(() => undefined);
  });
  await actionListenerReady;
}

async function handleReminderAction(repository: TaskRepository, notification: Options & { actionId?: string }) {
  const taskId = typeof notification.extra?.taskId === "string" ? notification.extra.taskId : null;
  const reminderId = typeof notification.extra?.reminderId === "string" ? notification.extra.reminderId : null;
  if (!taskId || !reminderId) return;
  if (notification.actionId === "snooze") {
    const until = new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000).toISOString();
    await repository.snoozeReminder(taskId, reminderId, until);
  } else if (notification.actionId === "dismiss") {
    await repository.dismissReminder(taskId, reminderId);
  } else {
    window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: { taskId } }));
  }
}

function notificationId(taskId: string, reminderId: string) {
  let hash = 0;
  for (const char of `${taskId}:${reminderId}`) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}
