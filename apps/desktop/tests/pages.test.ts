import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import {
  TaskRepositoryKey,
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "../src/data/TaskRepositoryContext";
import type { TaskRepository } from "../src/data/taskRepository";
import type { WebdavSyncController } from "../src/sync/defaultSettingsSyncRuntime";
import type {
  WebdavRunOnceResult,
  WebdavRunReport,
  WebdavRuntimeResolution,
  WebdavSecretsStore,
} from "../src/sync/webdav";
import Today from "../src/pages/Today.vue";
import Inbox from "../src/pages/Inbox.vue";
import Calendar from "../src/pages/Calendar.vue";
import SyncSettings from "../src/pages/settings/SyncSettings.vue";
import Widget from "../src/pages/Widget.vue";
import App from "../src/App.vue";
import Settings from "../src/pages/Settings.vue";
import { createMomoRouter } from "../src/router";
import { normalizeSettingsTab } from "../src/config/appShell";
import { TASK_LISTS_CHANGED_EVENT } from "../src/data/taskListEvents";
import {
  fakeTaskRepository as fakeRepository,
  taskFixture as task,
} from "./taskFixtures";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("桌面端 MVP 页面", () => {
  it("显示今日分组并快速添加今日任务", async () => {
    const repository = fakeRepository({
      today: {
        overdue: [task({ id: "late", title: "Late invoice" })],
        dueToday: [task({ id: "focus", title: "Focus block" })],
        completedToday: [
          task({ id: "done", title: "Done review", status: "completed" }),
        ],
      },
    });

    renderWithRepository(Today, repository);

    expect(await screen.findByText("Late invoice")).toBeInTheDocument();
    expect(screen.getByText("Focus block")).toBeInTheDocument();
    expect(screen.getByText("Done review")).toBeInTheDocument();

    await fireEvent.update(screen.getByLabelText("快速添加任务"), "Write brief");
    await fireEvent.click(screen.getByRole("button", { name: "添加到今日" }));

    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Write brief",
        dueAt: expect.any(String),
      }),
    );
  });

  it("快速添加无截止日期任务到收件箱", async () => {
    const repository = fakeRepository();

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("任务归属"), "inbox");
    await fireEvent.update(screen.getByLabelText("快速添加任务"), "Capture idea");
    await fireEvent.click(screen.getByRole("button", { name: "添加任务" }));

    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Capture idea",
        dueAt: null,
      }),
    );
  });

  it("快速添加带估时和明确截止时间的任务", async () => {
    const repository = fakeRepository();

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("快速添加任务"), "Deep work");
    await fireEvent.update(screen.getByLabelText("任务截止时间"), "2026-05-18T09:30");
    await fireEvent.update(screen.getByLabelText("任务估时分钟"), "45");
    await fireEvent.click(screen.getByRole("button", { name: "添加到今日" }));

    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Deep work",
        dueAt: expect.any(String),
        estimateMin: 45,
      }),
    );
  });

  it("显示收件箱任务并支持完成和删除操作", async () => {
    const repository = fakeRepository({
      inbox: [task({ id: "inbox-1", title: "Inbox task" })],
    });

    renderWithRepository(Inbox, repository);

    const item = await screen.findByText("Inbox task");
    const row = item.closest("li");
    expect(row).not.toBeNull();

    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: "完成 Inbox task",
      }),
    );
    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: "删除 Inbox task",
      }),
    );

    expect(repository.setStatus).toHaveBeenCalledWith("inbox-1", "completed");
    expect(repository.deleteTask).toHaveBeenCalledWith("inbox-1");
  });

  it("编辑收件箱任务标题、备注和优先级", async () => {
    const repository = fakeRepository({
      inbox: [task({ id: "inbox-1", title: "Inbox task", notes: "old", priority: 0 })],
    });

    renderWithRepository(Inbox, repository);

    const item = await screen.findByText("Inbox task");
    const row = item.closest("li");
    expect(row).not.toBeNull();

    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: "编辑 Inbox task",
      }),
    );
    await fireEvent.update(screen.getByLabelText("任务名"), "Updated task");
    await fireEvent.update(screen.getByLabelText("详细内容"), "Deeper detail");
    await fireEvent.update(screen.getByLabelText("优先级"), "2");
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", expect.objectContaining({
      title: "Updated task",
      notes: "Deeper detail",
      priority: 2,
    }));
  });

  it("编辑收件箱任务截止时间和估时", async () => {
    const repository = fakeRepository({
      inbox: [task({ id: "inbox-1", title: "Inbox task" })],
    });

    renderWithRepository(Inbox, repository);

    const item = await screen.findByText("Inbox task");
    const row = item.closest("li");
    expect(row).not.toBeNull();

    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: "编辑 Inbox task",
      }),
    );
    await fireEvent.update(screen.getByLabelText("截止时间"), "2026-05-19T14:15");
    await fireEvent.update(screen.getByLabelText("估时分钟"), "30");
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", expect.objectContaining({
      title: "Inbox task",
      notes: "",
      priority: 0,
      dueAt: expect.any(String),
      estimateMin: 30,
    }));
  });

  it("清除收件箱任务截止时间和估时", async () => {
    const repository = fakeRepository({
      inbox: [
        task({
          id: "inbox-1",
          title: "Inbox task",
          dueAt: "2026-05-19T14:15:00.000Z",
          estimateMin: 30,
        }),
      ],
    });

    renderWithRepository(Inbox, repository);

    const item = await screen.findByText("Inbox task");
    const row = item.closest("li");
    expect(row).not.toBeNull();

    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: "编辑 Inbox task",
      }),
    );
    await fireEvent.update(screen.getByLabelText("截止时间"), "");
    await fireEvent.update(screen.getByLabelText("估时分钟"), "");
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", expect.objectContaining({
      title: "Inbox task",
      notes: "",
      priority: 0,
      dueAt: null,
      estimateMin: null,
    }));
  });

  it("清空资源数量后保存为 null", async () => {
    const repository = fakeRepository({
      inbox: [
        task({
          id: "inbox-1",
          title: "Inbox task",
          resources: [
            { id: "res-1", type: "budget", label: "预算", amount: 100, unit: "元" },
          ],
        }),
      ],
    });

    renderWithRepository(Inbox, repository);

    const item = await screen.findByText("Inbox task");
    const row = item.closest("li");
    expect(row).not.toBeNull();
    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "编辑 Inbox task" }),
    );
    await fireEvent.update(screen.getByPlaceholderText("数量"), "");
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", expect.objectContaining({
      resources: [
        { id: "res-1", type: "budget", label: "预算", amount: null, unit: "元" },
      ],
    }));
  });

  it("使用重试恢复收件箱加载错误", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.listInbox)
      .mockRejectedValueOnce(new Error("database locked"))
      .mockResolvedValueOnce([task({ id: "inbox-1", title: "Recovered task" })]);

    renderWithRepository(Inbox, repository);

    expect(await screen.findByText("错误：database locked")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("Recovered task")).toBeInTheDocument();
  });

  it("显示只读七日日程", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "agenda-1",
          title: "Planning session",
          dueAt: "2026-05-17T02:30:00.000Z",
        }),
      ],
    });

    renderWithRepository(Calendar, repository);

    expect(await screen.findByText("Planning session")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "日历" })).toBeNull();
    expect(repository.listAgenda).toHaveBeenCalledTimes(1);
  });

  it("使用重试恢复日历加载错误", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.listAgenda)
      .mockRejectedValueOnce(new Error("agenda unavailable"))
      .mockResolvedValueOnce([
        task({
          id: "agenda-1",
          title: "Recovered agenda",
          dueAt: "2026-05-17T02:30:00.000Z",
        }),
      ]);

    renderWithRepository(Calendar, repository);

    expect(await screen.findByText("错误：agenda unavailable")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("Recovered agenda")).toBeInTheDocument();
  });

  it("WebDAV 立即同步成功后在卡片上展示同步结果摘要", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({
      kind: "enabled",
      result: {
        ok: true,
        report: {
          pushedOpsCount: 1,
          markedSyncedCount: 1,
          pulledOpsCount: 0,
          appliedTaskCount: 0,
          deletedTaskCount: 0,
          serverCursor: "cursor-after",
          message: "已上传 1 条本地变更",
        },
      },
    });
    const secretsStore = fakeSecretsStore({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/momo",
      username: "demo",
      password: "secret",
      deviceId: "desk-1",
    });

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    const syncButton = await screen.findByRole("button", { name: /立即同步/ });
    await fireEvent.click(syncButton);

    await waitFor(() => expect(controller.runOnce).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("已上传 1 条本地变更"),
    ).toBeInTheDocument();
  });

  it("WebDAV 立即同步失败后在卡片上展示错误", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({
      kind: "enabled",
      result: { ok: false, error: "WebDAV 401 Unauthorized" },
    });
    const secretsStore = fakeSecretsStore({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/momo",
      username: "demo",
      password: "secret",
      deviceId: "desk-1",
    });

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    const syncButton = await screen.findByRole("button", { name: /立即同步/ });
    await fireEvent.click(syncButton);

    await waitFor(() => expect(controller.runOnce).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("错误：WebDAV 401 Unauthorized"),
    ).toBeInTheDocument();
  });

  it("WebDAV 凭据表单保存时留空应用密码会沿用既有密码", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({ kind: "enabled" });
    const secretsStore = fakeSecretsStore({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/momo",
      username: "demo",
      password: "secret",
      deviceId: "desk-1",
    });

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    await screen.findByDisplayValue("demo");
    await fireEvent.update(screen.getByLabelText("用户名"), "demo-updated");
    await fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));

    await waitFor(() =>
      expect(secretsStore.save).toHaveBeenCalledWith({
        baseUrl: "https://dav.jianguoyun.com/dav",
        root: "/momo",
        username: "demo-updated",
        password: "secret",
        deviceId: "desk-1",
      }),
    );
    expect(await screen.findByText("已保存到本机安全存储")).toBeInTheDocument();
  });

  it("WebDAV 首次保存缺少应用密码时提示错误且不写入凭据", async () => {
    const repository = fakeRepository();
    const secretsStore = fakeSecretsStore(null);

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    await screen.findByLabelText("用户名");
    await fireEvent.update(screen.getByLabelText("用户名"), "demo");
    await fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));

    expect(
      await screen.findByText("错误：首次保存必须填写应用密码"),
    ).toBeInTheDocument();
    expect(secretsStore.save).not.toHaveBeenCalled();
  });

  it("默认设置页路由展示 WebDAV 凭据卡片而非旧本地模拟入口", async () => {
    const repository = fakeRepository();

    await renderAppAt("/settings", repository);

    expect(
      await screen.findByText("WebDAV 同步（坚果云优先）"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /本地同步模拟/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/远程同步配置/)).not.toBeInTheDocument();
  });

  it("设置页通过 WebDAV controller 订阅同步完成通知", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({ kind: "enabled" });
    const router = createMomoRouter(createMemoryHistory());
    await router.push("/settings?tab=sync");
    await router.isReady();

    renderWithRepository(Settings, repository, {
      global: {
        plugins: [router],
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: fakeSecretsStore({
            baseUrl: "https://dav.jianguoyun.com/dav",
            root: "/momo",
            username: "demo",
            password: "secret",
            deviceId: "desk-1",
          }),
        },
      },
    });

    expect(await screen.findByText("WebDAV 同步（坚果云优先）")).toBeInTheDocument();
    expect(controller.onRunCompleted).toHaveBeenCalledTimes(1);

    controller.emitRunCompleted({
      pushedOpsCount: 0,
      markedSyncedCount: 0,
      pulledOpsCount: 2,
      appliedTaskCount: 2,
      deletedTaskCount: 0,
      serverCursor: "cursor-after",
      message: "已拉取 2 条远端变更",
    });

    expect(await screen.findByText("已拉取 2 条远端变更")).toBeInTheDocument();
  });

  it("设置 tab 使用同步作为默认回退", () => {
    expect(normalizeSettingsTab("sync")).toBe("sync");
    expect(normalizeSettingsTab("appearance")).toBe("appearance");
    expect(normalizeSettingsTab("about")).toBe("about");
    expect(normalizeSettingsTab("missing")).toBe("sync");
  });

  it("主窗口 shell 展示任务导航和设置入口", async () => {
    const repository = fakeRepository();

    await renderAppAt("/today", repository);

    expect(await screen.findByRole("link", { name: /今日/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /收件箱/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /日历/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeInTheDocument();
  });

  it("清单变更事件会触发当前清单页重新加载", async () => {
    const repository = fakeRepository({
      lists: [{ id: "list-1", name: "项目", color: null, archived: false, order: 1, createdAt: "2026-05-16T00:00:00.000Z", updatedAt: "2026-05-16T00:00:00.000Z" }],
      listTasks: {
        "list-1": [task({ id: "task-1", title: "项目任务", listId: "list-1" })],
      },
    });

    await renderAppAt("/lists/list-1", repository);

    expect(await screen.findByText("项目任务")).toBeInTheDocument();
    await waitFor(() => expect(repository.listTasksByList).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent(TASK_LISTS_CHANGED_EVENT));

    await waitFor(() => expect(repository.listTasksByList).toHaveBeenCalledTimes(2));
    expect(repository.listTasksByList).toHaveBeenLastCalledWith("list-1");
  });

  it("未知路由回到今日页", async () => {
    const repository = fakeRepository();

    await renderAppAt("/login", repository);

    expect(await screen.findByText("今日到期")).toBeInTheDocument();
  });

  it("显示今日任务的紧凑小组件视图", async () => {
    const repository = fakeRepository({
      today: {
        overdue: [task({ id: "late", title: "Late invoice" })],
        dueToday: [task({ id: "focus", title: "Focus block" })],
        completedToday: [],
      },
    });

    renderWithRepository(Widget, repository);

    expect(await screen.findByText("Momo 小组件")).toBeInTheDocument();
    expect(await screen.findByText("Late invoice")).toBeInTheDocument();
    expect(screen.getByText("Focus block")).toBeInTheDocument();
  });

  it("小组件从全库到期提醒显示提醒数量", async () => {
    const repository = fakeRepository({
      today: {
        overdue: [],
        dueToday: [],
        completedToday: [],
      },
      dueReminders: [
        task({
          id: "future-reminder",
          title: "Future reminder",
          dueAt: "2026-05-30T10:00:00.000Z",
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

    renderWithRepository(Widget, repository);

    expect(await screen.findByText(/1 个提醒已到/)).toBeInTheDocument();
  });

  it("小组件加载今日任务和到期提醒时复用同一个时间点", async () => {
    const repository = fakeRepository();

    renderWithRepository(Widget, repository);

    await screen.findByText("Momo 小组件");
    await waitFor(() => expect(repository.listDueReminders).toHaveBeenCalledTimes(1));

    const todayNow = vi.mocked(repository.listToday).mock.calls[0]?.[0];
    const reminderNow = vi.mocked(repository.listDueReminders).mock.calls[0]?.[0];
    expect(todayNow).toBeInstanceOf(Date);
    expect(reminderNow).toBe(todayNow);
  });

  it("小组件到期提醒查询失败时进入错误态", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.listDueReminders).mockRejectedValueOnce(
      new Error("reminder unavailable"),
    );

    renderWithRepository(Widget, repository);

    expect(await screen.findByText("Error: reminder unavailable")).toBeInTheDocument();
  });
});

function renderWithRepository(
  component: Component,
  repository: TaskRepository,
  options: Record<string, unknown> = {},
) {
  return render(component, {
    ...options,
    global: {
      ...(options.global as Record<string, unknown> | undefined),
      provide: {
        [TaskRepositoryKey as symbol]: repository,
        ...(((options.global as { provide?: Record<symbol, unknown> } | undefined)?.provide) ?? {}),
      },
    },
  });
}

async function renderAppAt(path: string, repository: TaskRepository) {
  const router = createMomoRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();

  return renderWithRepository(App, repository, {
    global: {
      plugins: [router],
    },
  });
}

interface FakeWebdavControllerOptions {
  kind: "enabled" | "disabled";
  result?: WebdavRunOnceResult;
}

function fakeWebdavController(
  options: FakeWebdavControllerOptions,
): WebdavSyncController & {
  runOnce: ReturnType<typeof vi.fn>;
  onRunCompleted: ReturnType<typeof vi.fn>;
  emitRunCompleted(report: WebdavRunReport): void;
} {
  const result: WebdavRunOnceResult =
    options.result ?? { ok: false, error: "尚未配置 WebDAV 凭据" };
  const resolution: WebdavRuntimeResolution =
    options.kind === "enabled"
      ? {
        kind: "enabled",
        runner: { runOnce: vi.fn() },
        secrets: {
          baseUrl: "https://dav.jianguoyun.com/dav",
          root: "/momo",
          username: "u",
          password: "p",
          deviceId: "desk-1",
        },
        layout: {} as never,
        provider: {} as never,
        client: {} as never,
      }
      : { kind: "disabled", reason: "尚未配置 WebDAV 凭据" };
  const runOnce = vi.fn().mockResolvedValue(result);
  const listeners = new Set<(report: WebdavRunReport) => void>();
  return {
    inspect: vi.fn().mockResolvedValue(resolution),
    runOnce,
    onRunCompleted: vi.fn((listener: (report: WebdavRunReport) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emitRunCompleted(report: WebdavRunReport) {
      listeners.forEach((listener) => listener(report));
    },
  };
}

function fakeSecretsStore(saved: Parameters<WebdavSecretsStore["save"]>[0] | null): WebdavSecretsStore {
  return {
    load: vi.fn().mockResolvedValue(saved),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

