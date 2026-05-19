import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import {
  TaskRepositoryKey,
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "../src/data/TaskRepositoryContext";
import type {
  DatabaseStats,
  LocalChange,
  SyncRun,
  SyncState,
  TaskRepository,
} from "../src/data/taskRepository";
import type { CreateTaskInput, Task, TodayTaskGroups } from "../src/domain/tasks";
import type { WebdavSyncController } from "../src/sync/defaultSettingsSyncRuntime";
import type {
  WebdavRunOnceResult,
  WebdavRuntimeResolution,
  WebdavSecretsStore,
} from "../src/sync/webdav";
import Today from "../src/pages/Today.vue";
import Inbox from "../src/pages/Inbox.vue";
import Calendar from "../src/pages/Calendar.vue";
import Settings from "../src/pages/Settings.vue";
import Widget from "../src/pages/Widget.vue";
import App from "../src/App.vue";
import { createMomoRouter } from "../src/router";

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
    await fireEvent.update(screen.getByLabelText("编辑 Inbox task 标题"), "Updated task");
    await fireEvent.update(screen.getByLabelText("编辑 Inbox task 备注"), "Deeper detail");
    await fireEvent.update(screen.getByLabelText("编辑 Inbox task 优先级"), "2");
    await fireEvent.click(screen.getByRole("button", { name: "保存 Inbox task" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", {
      title: "Updated task",
      notes: "Deeper detail",
      priority: 2,
    });
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
    await fireEvent.update(screen.getByLabelText("编辑 Inbox task 截止时间"), "2026-05-19T14:15");
    await fireEvent.update(screen.getByLabelText("编辑 Inbox task 估时分钟"), "30");
    await fireEvent.click(screen.getByRole("button", { name: "保存 Inbox task" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", {
      title: "Inbox task",
      notes: "",
      priority: 0,
      dueAt: expect.any(String),
      estimateMin: 30,
    });
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
    await fireEvent.update(screen.getByLabelText("编辑 Inbox task 截止时间"), "");
    await fireEvent.update(screen.getByLabelText("编辑 Inbox task 估时分钟"), "");
    await fireEvent.click(screen.getByRole("button", { name: "保存 Inbox task" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", {
      title: "Inbox task",
      notes: "",
      priority: 0,
      dueAt: null,
      estimateMin: null,
    });
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
    expect(screen.getByText("未来 7 天")).toBeInTheDocument();
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

  it("在设置页显示本地数据库状态", async () => {
    const repository = fakeRepository({
      stats: {
        databasePath: "sqlite:momo.db",
        totalTasks: 4,
        activeTasks: 2,
        completedTasks: 1,
        pendingLocalChanges: 3,
      },
    });

    renderWithRepository(Settings, repository);

    expect(await screen.findByText("sqlite:momo.db")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    const pendingRow = screen.getByText("待同步").closest("li");
    expect(pendingRow).not.toBeNull();
    expect(within(pendingRow as HTMLElement).getByText("3")).toBeInTheDocument();
  });

  it("在设置页显示本地同步 cursor 状态", async () => {
    const repository = fakeRepository({
      syncState: {
        serverCursor: "cursor-7",
        lastSyncedAt: "2026-05-16T12:00:00.000Z",
        lastError: "previous sync failure",
        updatedAt: "2026-05-16T12:01:00.000Z",
      },
    });

    renderWithRepository(Settings, repository);

    expect(await screen.findByText("同步状态")).toBeInTheDocument();
    expect(screen.getByText("cursor-7")).toBeInTheDocument();
    expect(screen.getByText("2026-05-16T12:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("previous sync failure")).toBeInTheDocument();
  });

  it("在设置页显示最近同步运行历史", async () => {
    const repository = fakeRepository({
      syncRuns: [
        {
          id: "run-2",
          status: "failed",
          startedAt: "2026-05-16T12:03:00.000Z",
          finishedAt: "2026-05-16T12:03:05.000Z",
          message: "transport unavailable",
          serverCursor: null,
        },
        {
          id: "run-1",
          status: "succeeded",
          startedAt: "2026-05-16T12:00:00.000Z",
          finishedAt: "2026-05-16T12:00:05.000Z",
          message: "已完成同步",
          serverCursor: "cursor-8",
        },
      ],
    });

    renderWithRepository(Settings, repository);

    expect(await screen.findByText("同步历史")).toBeInTheDocument();
    expect(repository.listRecentSyncRuns).toHaveBeenCalledWith(3);
    const failedRun = screen.getByText("transport unavailable").closest("li");
    const succeededRun = screen.getByText("已完成同步").closest("li");
    expect(failedRun).not.toBeNull();
    expect(succeededRun).not.toBeNull();
    expect(within(failedRun as HTMLElement).getByText("failed")).toBeInTheDocument();
    expect(within(failedRun as HTMLElement).getByText("无")).toBeInTheDocument();
    expect(within(succeededRun as HTMLElement).getByText("succeeded")).toBeInTheDocument();
    expect(within(succeededRun as HTMLElement).getByText("cursor-8")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sync history/i })).not.toBeInTheDocument();
  });

  it("同步运行历史加载失败时仍保持设置状态可见", async () => {
    const repository = fakeRepository({
      stats: {
        databasePath: "sqlite:momo.db",
        totalTasks: 4,
        activeTasks: 2,
        completedTasks: 1,
        pendingLocalChanges: 3,
      },
      syncState: {
        serverCursor: "cursor-7",
        lastSyncedAt: "2026-05-16T12:00:00.000Z",
        lastError: null,
        updatedAt: "2026-05-16T12:01:00.000Z",
      },
    });
    vi.mocked(repository.listRecentSyncRuns)
      .mockRejectedValueOnce(new Error("history unavailable"))
      .mockResolvedValueOnce([
        {
          id: "run-1",
          status: "succeeded",
          startedAt: "2026-05-16T12:00:00.000Z",
          finishedAt: "2026-05-16T12:00:05.000Z",
          message: "已完成同步",
          serverCursor: "cursor-8",
        },
      ]);

    renderWithRepository(Settings, repository);

    expect(await screen.findByText("sqlite:momo.db")).toBeInTheDocument();
    expect(screen.getByText("cursor-7")).toBeInTheDocument();
    expect(screen.getByText("错误：history unavailable")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试同步历史" }));

    expect(await screen.findByText("同步历史")).toBeInTheDocument();
    expect(screen.getByText("cursor-8")).toBeInTheDocument();
    expect(repository.listRecentSyncRuns).toHaveBeenCalledTimes(2);
  });

  it("在设置页显示待同步本地变更摘要", async () => {
    const repository = fakeRepository({
      pendingChanges: [
        localChange({
          id: "change-1",
          entityId: "task-1",
          action: "task.update",
          payload: {
            id: "task-1",
            baseVersion: 4,
            patch: { title: "Draft plan" },
            updatedAt: "2026-05-16T10:00:00.000Z",
          },
        }),
      ],
    });

    renderWithRepository(Settings, repository);

    expect(await screen.findByText("待同步变更")).toBeInTheDocument();
    const pendingRow = screen.getByText("change-1").closest("li");
    expect(pendingRow).not.toBeNull();
    expect(within(pendingRow as HTMLElement).getByText("task.update")).toBeInTheDocument();
    expect(
      within(pendingRow as HTMLElement).getByText('patch: {"title":"Draft plan"}'),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete change/i })).not.toBeInTheDocument();
  });

  it("待同步本地变更加载失败时仍保持设置状态可见", async () => {
    const repository = fakeRepository({
      stats: {
        databasePath: "sqlite:momo.db",
        totalTasks: 4,
        activeTasks: 2,
        completedTasks: 1,
        pendingLocalChanges: 3,
      },
      syncState: {
        serverCursor: "cursor-7",
        lastSyncedAt: "2026-05-16T12:00:00.000Z",
        lastError: null,
        updatedAt: "2026-05-16T12:01:00.000Z",
      },
    });
    vi.mocked(repository.listPendingChanges)
      .mockRejectedValueOnce(new Error("pending changes unavailable"))
      .mockResolvedValueOnce([
        localChange({ id: "change-2", entityId: "task-2", action: "task.delete" }),
      ]);

    renderWithRepository(Settings, repository);

    expect(await screen.findByText("sqlite:momo.db")).toBeInTheDocument();
    expect(screen.getByText("cursor-7")).toBeInTheDocument();
    expect(screen.getByText("错误：pending changes unavailable")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试待同步变更" }));

    expect(await screen.findByText("待同步变更")).toBeInTheDocument();
    expect(screen.getByText("change-2")).toBeInTheDocument();
    expect(repository.listPendingChanges).toHaveBeenCalledTimes(2);
  });

  it("WebDAV 立即同步成功后刷新设置页顶层卡片", async () => {
    const repository = fakeRepository({
      stats: {
        databasePath: "sqlite:momo.db",
        totalTasks: 4,
        activeTasks: 2,
        completedTasks: 1,
        pendingLocalChanges: 2,
      },
      syncState: {
        serverCursor: "cursor-before",
        lastSyncedAt: "2026-05-16T11:59:00.000Z",
        lastError: "previous error",
        updatedAt: "2026-05-16T11:59:00.000Z",
      },
    });
    vi.mocked(repository.getStats)
      .mockResolvedValueOnce({
        databasePath: "sqlite:momo.db",
        totalTasks: 4,
        activeTasks: 2,
        completedTasks: 1,
        pendingLocalChanges: 2,
      })
      .mockResolvedValueOnce({
        databasePath: "sqlite:momo.db",
        totalTasks: 5,
        activeTasks: 3,
        completedTasks: 1,
        pendingLocalChanges: 0,
      });
    vi.mocked(repository.getSyncState)
      .mockResolvedValueOnce({
        serverCursor: "cursor-before",
        lastSyncedAt: "2026-05-16T11:59:00.000Z",
        lastError: "previous error",
        updatedAt: "2026-05-16T11:59:00.000Z",
      })
      .mockResolvedValueOnce({
        serverCursor: "cursor-after",
        lastSyncedAt: "2026-05-16T12:00:00.000Z",
        lastError: null,
        updatedAt: "2026-05-16T12:00:00.000Z",
      });
    vi.mocked(repository.listRecentSyncRuns)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "run-1",
          status: "succeeded",
          startedAt: "2026-05-16T12:00:00.000Z",
          finishedAt: "2026-05-16T12:00:05.000Z",
          message: "WebDAV 同步完成（无新增变更）",
          serverCursor: "cursor-after",
        },
      ]);

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

    renderWithRepository(Settings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    expect(await screen.findByText("cursor-before")).toBeInTheDocument();
    const syncButton = await screen.findByRole("button", { name: /立即同步/ });
    await fireEvent.click(syncButton);

    await waitFor(() => expect(controller.runOnce).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(repository.getStats).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(repository.getSyncState).toHaveBeenCalledTimes(2));
    const serverCursorRow = (await screen.findByText("服务端游标")).closest("li");
    await waitFor(() =>
      expect(
        within(serverCursorRow as HTMLElement).getByText("cursor-after"),
      ).toBeInTheDocument(),
    );
    const pendingRow = (await screen.findByText("待同步")).closest("li");
    await waitFor(() =>
      expect(within(pendingRow as HTMLElement).getByText("0")).toBeInTheDocument(),
    );
    expect(
      await screen.findByText("已上传 1 条本地变更"),
    ).toBeInTheDocument();
  });

  it("WebDAV 立即同步失败后也刷新设置页顶层卡片以暴露 lastError", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.getSyncState)
      .mockResolvedValueOnce({
        serverCursor: "cursor-before",
        lastSyncedAt: "2026-05-16T11:59:00.000Z",
        lastError: null,
        updatedAt: "2026-05-16T11:59:00.000Z",
      })
      .mockResolvedValueOnce({
        serverCursor: null,
        lastSyncedAt: null,
        lastError: "WebDAV 401 Unauthorized",
        updatedAt: "2026-05-16T12:00:00.000Z",
      });
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

    renderWithRepository(Settings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    expect(await screen.findByText("cursor-before")).toBeInTheDocument();
    const syncButton = await screen.findByRole("button", { name: /立即同步/ });
    await fireEvent.click(syncButton);

    await waitFor(() => expect(repository.getSyncState).toHaveBeenCalledTimes(2));
    const lastErrorRow = (await screen.findByText("最近错误")).closest("li");
    await waitFor(() =>
      expect(
        within(lastErrorRow as HTMLElement).getByText("WebDAV 401 Unauthorized"),
      ).toBeInTheDocument(),
    );
  });

  it("默认设置页路由展示 WebDAV 凭据卡片而非旧本地模拟入口", async () => {
    const repository = fakeRepository();

    await renderAppAt("/settings", repository);

    expect(screen.getByRole("button", { name: "打开小组件" })).toBeInTheDocument();
    expect(
      await screen.findByText("WebDAV 同步（坚果云优先）"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /本地同步模拟/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/远程同步配置/)).not.toBeInTheDocument();
  });

  it("保持登录占位路由接入 Vue router", async () => {
    const repository = fakeRepository();

    await renderAppAt("/login", repository);

    await fireEvent.update(screen.getByLabelText("邮箱"), "you@example.com");
    await fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(await screen.findByText("今日到期")).toBeInTheDocument();
  });

  it("使用重试恢复设置页数据库状态错误", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.getStats)
      .mockRejectedValueOnce(new Error("stats unavailable"))
      .mockResolvedValueOnce({
        databasePath: "sqlite:momo.db",
        totalTasks: 5,
        activeTasks: 3,
        completedTasks: 2,
        pendingLocalChanges: 1,
      });

    renderWithRepository(Settings, repository);

    expect(await screen.findByText("错误：stats unavailable")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("sqlite:momo.db")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
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
): WebdavSyncController & { runOnce: ReturnType<typeof vi.fn> } {
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
  return {
    inspect: vi.fn().mockResolvedValue(resolution),
    runOnce,
  };
}

function fakeSecretsStore(saved: Parameters<WebdavSecretsStore["save"]>[0] | null): WebdavSecretsStore {
  return {
    load: vi.fn().mockResolvedValue(saved),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeRepository(overrides: {
  today?: TodayTaskGroups;
  inbox?: Task[];
  agenda?: Task[];
  stats?: DatabaseStats;
  syncState?: SyncState;
  syncRuns?: SyncRun[];
  pendingChanges?: LocalChange[];
} = {}): TaskRepository {
  const today = overrides.today ?? {
    overdue: [],
    dueToday: [],
    completedToday: [],
  };
  const stats = overrides.stats ?? {
    databasePath: "sqlite:momo.db",
    totalTasks: 0,
    activeTasks: 0,
    completedTasks: 0,
    pendingLocalChanges: 0,
  };
  const syncState = overrides.syncState ?? {
    serverCursor: null,
    lastSyncedAt: null,
    lastError: null,
    updatedAt: null,
  };

  return {
    databasePath: "sqlite:momo.db",
    init: vi.fn().mockResolvedValue(undefined),
    createTask: vi
      .fn()
      .mockImplementation((input: CreateTaskInput) =>
        Promise.resolve(task({ title: input.title, dueAt: input.dueAt ?? null })),
      ),
    updateTask: vi.fn(),
    setStatus: vi.fn().mockResolvedValue(task({ status: "completed" })),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    applyRemoteTask: vi.fn().mockResolvedValue(undefined),
    deleteRemoteTask: vi.fn().mockResolvedValue(undefined),
    listToday: vi.fn().mockResolvedValue(today),
    listInbox: vi.fn().mockResolvedValue(overrides.inbox ?? []),
    listAgenda: vi.fn().mockResolvedValue(overrides.agenda ?? []),
    getStats: vi.fn().mockResolvedValue(stats),
    listPendingChanges: vi.fn().mockResolvedValue(overrides.pendingChanges ?? []),
    markChangeSynced: vi.fn().mockResolvedValue(undefined),
    getSyncState: vi.fn().mockResolvedValue(syncState),
    saveSyncState: vi.fn().mockResolvedValue(syncState),
    recordSyncRun: vi.fn().mockResolvedValue({
      id: "run-1",
      status: "succeeded",
      startedAt: "2026-05-16T12:00:00.000Z",
      finishedAt: "2026-05-16T12:00:00.000Z",
      message: "WebDAV 同步完成（无新增变更）",
      serverCursor: "cursor-0",
    }),
    listRecentSyncRuns: vi.fn().mockResolvedValue(overrides.syncRuns ?? []),
  };
}

function localChange(overrides: Partial<LocalChange> = {}): LocalChange {
  return {
    id: "change",
    entityType: "task",
    entityId: "task",
    action: "task.create",
    payload: { id: "task", title: "Task" },
    createdAt: "2026-05-16T10:00:00.000Z",
    syncedAt: null,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task",
    title: "Task",
    notes: null,
    status: "active",
    priority: 0,
    dueAt: null,
    estimateMin: null,
    tags: [],
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

