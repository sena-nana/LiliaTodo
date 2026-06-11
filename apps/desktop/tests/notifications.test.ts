import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyDueReminders } from "../src/notifications";
import { fakeTaskRepository, taskFixture } from "./taskFixtures";

const mocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  registerActionTypes: vi.fn(),
  onAction: vi.fn(),
  listen: vi.fn(),
  actionHandler: null as ((notification: { actionId?: string; extra?: Record<string, unknown>; title: string }) => void) | null,
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
  sendNotification: mocks.sendNotification,
  registerActionTypes: mocks.registerActionTypes,
  onAction: mocks.onAction,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

describe("系统通知提醒", () => {
  beforeEach(() => {
    mocks.isPermissionGranted.mockResolvedValue(true);
    mocks.requestPermission.mockResolvedValue("granted");
    mocks.sendNotification.mockClear();
    mocks.registerActionTypes.mockResolvedValue(undefined);
    mocks.onAction.mockImplementation((handler) => {
      mocks.actionHandler = handler;
      return Promise.resolve({ unregister: vi.fn() });
    });
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.actionHandler = null;
  });

  it("到期提醒发送系统通知并支持稍后提醒动作", async () => {
    const repository = fakeTaskRepository({
      dueReminders: [
        taskFixture({
          id: "task-1",
          title: "提醒任务",
          reminders: [
            {
              id: "reminder-1",
              triggerAt: "2026-05-16T08:00:00.000Z",
              status: "pending",
              message: "该处理任务了",
            },
          ],
        }),
      ],
    });

    const onReminderDue = vi.fn();
    const count = await notifyDueReminders(repository, { onReminderDue });

    expect(count).toBe(1);
    expect(mocks.registerActionTypes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "liliatodo-reminder",
        actions: expect.arrayContaining([
          expect.objectContaining({ id: "open", title: "打开任务" }),
          expect.objectContaining({ id: "snooze", title: "稍后提醒" }),
          expect.objectContaining({ id: "dismiss", title: "关闭提醒" }),
        ]),
      }),
    ]);
    expect(mocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "提醒：提醒任务",
      body: "该处理任务了",
      actionTypeId: "liliatodo-reminder",
      extra: { taskId: "task-1", reminderId: "reminder-1" },
    }));
    expect(repository.updateTask).toHaveBeenCalledWith("task-1", {
      lastReminderNotifiedAt: expect.any(String),
    });
    expect(onReminderDue).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ id: "task-1", title: "提醒任务" }),
      reminderId: "reminder-1",
      notifiedAt: expect.any(String),
    }));

    mocks.actionHandler?.({
      title: "提醒：提醒任务",
      actionId: "snooze",
      extra: { taskId: "task-1", reminderId: "reminder-1" },
    });

    await vi.waitFor(() =>
      expect(repository.snoozeReminder).toHaveBeenCalledWith(
        "task-1",
        "reminder-1",
        expect.any(String),
      ),
    );
  });

  it("已通知过的到期提醒不会重复触发 Agent 回调", async () => {
    const repository = fakeTaskRepository({
      dueReminders: [
        taskFixture({
          id: "task-1",
          title: "已提醒任务",
          lastReminderNotifiedAt: "2026-05-16T08:01:00.000Z",
          reminders: [
            {
              id: "reminder-1",
              triggerAt: "2026-05-16T08:00:00.000Z",
              status: "pending",
              message: null,
            },
          ],
        }),
      ],
    });
    const onReminderDue = vi.fn();

    const count = await notifyDueReminders(repository, { onReminderDue });

    expect(count).toBe(1);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(onReminderDue).not.toHaveBeenCalled();
    expect(repository.updateTask).not.toHaveBeenCalledWith("task-1", {
      lastReminderNotifiedAt: expect.any(String),
    });
  });
});
