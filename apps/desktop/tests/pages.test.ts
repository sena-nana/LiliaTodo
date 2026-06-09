import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import { TaskRepositoryKey } from "../src/data/TaskRepositoryContext";
import {
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "../src/sync/settingsSyncContext";
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
import { createLiliaTodoRouter } from "../src/router";
import { normalizeSettingsTab } from "../src/config/appShell";
import { TASK_LISTS_CHANGED_EVENT } from "../src/data/taskListEvents";
import {
  fakeTaskRepository as fakeRepository,
  taskCategoryFixture,
  taskListFixture,
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

  it("收件箱页面支持直接新增任务", async () => {
    const repository = fakeRepository();

    renderWithRepository(Inbox, repository);

    await fireEvent.update(await screen.findByLabelText("添加收件箱任务"), "收集灵感");
    await fireEvent.click(screen.getByRole("button", { name: "添加任务" }));

    await waitFor(() =>
      expect(repository.createTask).toHaveBeenCalledWith({
        title: "收集灵感",
        listId: "inbox",
      }),
    );
  });

  it("清单页面支持直接新增任务到当前清单", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture({ id: "project", name: "项目", order: 1 })],
    });

    await renderAppAt("/lists/project", repository);

    await fireEvent.update(await screen.findByLabelText("添加清单任务"), "清单任务");
    await fireEvent.click(screen.getByRole("button", { name: "添加任务" }));

    await waitFor(() =>
      expect(repository.createTask).toHaveBeenCalledWith({
        title: "清单任务",
        listId: "project",
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

  it("收件箱任务支持上下移动", async () => {
    const repository = fakeRepository({
      inbox: [
        task({ id: "task-1", title: "任务一", childOrder: 0 }),
        task({ id: "task-2", title: "任务二", childOrder: 1 }),
      ],
    });

    renderWithRepository(Inbox, repository);

    const item = await screen.findByText("任务一");
    const row = item.closest("li");
    expect(row).not.toBeNull();

    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "下移 任务一" }),
    );

    await waitFor(() => expect(repository.updateTask).toHaveBeenCalledWith("task-2", { childOrder: 0 }));
    expect(repository.updateTask).toHaveBeenCalledWith("task-1", { childOrder: 1 });
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
    const drawer = await screen.findByRole(drawerRole, { name: "任务详情" });
    await fireEvent.update(within(drawer).getByLabelText("任务名"), "Updated task");
    await fireEvent.update(within(drawer).getByLabelText("详细内容"), "Deeper detail");
    await fireEvent.update(within(drawer).getByLabelText("优先级"), "2");
    await fireEvent.click(within(drawer).getByRole("button", { name: "保存" }));

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
    const drawer = await screen.findByRole(drawerRole, { name: "任务详情" });
    await fireEvent.update(within(drawer).getByLabelText("截止时间"), "2026-05-19T14:15");
    await fireEvent.update(within(drawer).getByLabelText("估时分钟"), "30");
    await fireEvent.click(within(drawer).getByRole("button", { name: "保存" }));

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
    const drawer = await screen.findByRole(drawerRole, { name: "任务详情" });
    await fireEvent.update(within(drawer).getByLabelText("截止时间"), "");
    await fireEvent.update(within(drawer).getByLabelText("估时分钟"), "");
    await fireEvent.click(within(drawer).getByRole("button", { name: "保存" }));

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
    const drawer = await screen.findByRole(drawerRole, { name: "任务详情" });
    await fireEvent.update(within(drawer).getByPlaceholderText("数量"), "");
    await fireEvent.click(within(drawer).getByRole("button", { name: "保存" }));

    expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", expect.objectContaining({
      resources: [
        { id: "res-1", type: "budget", label: "预算", amount: null, unit: "元" },
      ],
    }));
  });

  it("检查清单项支持上移下移并保存顺序", async () => {
    const repository = fakeRepository({
      inbox: [
        task({
          id: "inbox-1",
          title: "Inbox task",
          checklist: [
            { id: "check-1", title: "第一项", done: false, order: 0 },
            { id: "check-2", title: "第二项", done: false, order: 1 },
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
    const drawer = await screen.findByRole(drawerRole, { name: "任务详情" });
    await fireEvent.click(within(drawer).getByRole("button", { name: "下移检查项 1" }));
    await fireEvent.click(within(drawer).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(repository.updateTask).toHaveBeenCalledWith("inbox-1", expect.objectContaining({
      checklist: [
        { id: "check-2", title: "第二项", done: false, order: 0 },
        { id: "check-1", title: "第一项", done: false, order: 1 },
      ],
    })));
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

  describe("TaskDetailDrawer 页面接入一致性", () => {
    for (const scenario of drawerPageScenarios()) {
      it(`${scenario.name}打开任务时加载抽屉依赖数据`, async () => {
        const repository = scenario.makeRepository();

        const drawer = await openDrawerTask(scenario, repository);

        expect(repository.listTaskChildren).toHaveBeenCalledWith(scenario.taskId);
        expect(repository.listLists).toHaveBeenCalled();
        expectDrawerHeading(drawer, scenario.taskTitle);
      });

      it(`${scenario.name}在抽屉保存通用字段并刷新页面数据`, async () => {
        const repository = scenario.makeRepository();
        const drawer = await openDrawerTask(scenario, repository);

        await saveCommonDrawerFields(drawer, scenario);

        await waitFor(() => expect(repository.updateTask).toHaveBeenCalledWith(
          scenario.taskId,
          expect.objectContaining({
            title: `${scenario.name}已更新`,
            notes: `${scenario.name}详细内容`,
            priority: 2,
            listId: "project",
          }),
        ));
        await expectPageReloaded(scenario, repository);
      });

      it(`${scenario.name}在抽屉完成任务后关闭抽屉并刷新页面`, async () => {
        const repository = scenario.makeRepository();
        const drawer = await openDrawerTask(scenario, repository);

        await fireEvent.click(within(drawer).getByRole("button", { name: "完成" }));

        await waitFor(() => expect(repository.setStatus).toHaveBeenCalledWith(
          scenario.taskId,
          "completed",
        ));
        await waitFor(() => expect(
          screen.queryByRole(drawerRole, { name: "任务详情" }),
        ).not.toBeInTheDocument());
        await expectPageReloaded(scenario, repository);
      });

      it(`${scenario.name}在抽屉删除任务后关闭抽屉并刷新页面`, async () => {
        const repository = scenario.makeRepository();
        const drawer = await openDrawerTask(scenario, repository);

        await fireEvent.click(within(drawer).getByRole("button", { name: `删除任务 ${scenario.taskTitle}` }));

        await waitFor(() => expect(repository.deleteTask).toHaveBeenCalledWith(scenario.taskId));
        await waitFor(() => expect(
          screen.queryByRole(drawerRole, { name: "任务详情" }),
        ).not.toBeInTheDocument());
        await expectPageReloaded(scenario, repository);
      });

      it(`${scenario.name}在抽屉点击子任务会跳转到子任务详情`, async () => {
        const child = task({
          id: `${scenario.taskId}-child`,
          title: `${scenario.name}子任务`,
          parentId: scenario.taskId,
        });
        const repository = scenario.makeRepository({
          children: {
            [scenario.taskId]: [child],
            [child.id]: [],
          },
        });
        const drawer = await openDrawerTask(scenario, repository);

        await fireEvent.click(
          within(drawer).getByRole("button", { name: new RegExp(child.title) }),
        );

        await waitFor(() => expect(repository.listTaskChildren).toHaveBeenCalledWith(child.id));
        expectDrawerHeading(getDrawer(), child.title);
      });

      it(`${scenario.name}打开任务失败时在抽屉显示错误且保持打开`, async () => {
        const repository = scenario.makeRepository();
        vi.mocked(repository.listTaskChildren).mockRejectedValueOnce(
          new Error("children unavailable"),
        );

        await scenario.render(repository);
        await clickPageTask(scenario);

        await expectDrawerError("children unavailable");
      });

      it(`${scenario.name}保存失败时在抽屉显示错误且保持打开`, async () => {
        const repository = scenario.makeRepository();
        const drawer = await openDrawerTask(scenario, repository);
        vi.mocked(repository.updateTask).mockRejectedValueOnce(
          new Error("save unavailable"),
        );

        await fireEvent.update(within(drawer).getByLabelText("任务名"), `${scenario.name}保存失败`);
        await fireEvent.click(within(drawer).getByRole("button", { name: "保存" }));

        await expectDrawerError("save unavailable");
      });

      it(`${scenario.name}完成失败时在抽屉显示错误且保持打开`, async () => {
        const repository = scenario.makeRepository();
        const drawer = await openDrawerTask(scenario, repository);
        vi.mocked(repository.setStatus).mockRejectedValueOnce(
          new Error("complete unavailable"),
        );

        await fireEvent.click(within(drawer).getByRole("button", { name: "完成" }));

        await expectDrawerError("complete unavailable");
      });
    }
  });

  it("WebDAV 立即同步成功后在卡片上展示同步结果摘要", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({
      kind: "enabled",
      result: {
        ok: true,
        report: {
          pushedOpsCount: 2,
          pushedTaskChangeCount: 1,
          pushedTaskListChangeCount: 1,
          markedSyncedCount: 2,
          markedTaskChangeSyncedCount: 1,
          markedTaskListChangeSyncedCount: 1,
          pulledOpsCount: 0,
          appliedTaskCount: 0,
          deletedTaskCount: 0,
          appliedTaskListCount: 0,
          deletedTaskListCount: 0,
          serverCursor: "cursor-after",
          message: "已上传 1 条本地任务变更，已上传 1 个本地清单变更",
        },
      },
    });
    const secretsStore = fakeSecretsStore({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/liliatodo",
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
      await screen.findByText("已上传 1 条本地任务变更，已上传 1 个本地清单变更"),
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
      root: "/liliatodo",
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
      root: "/liliatodo",
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
        root: "/liliatodo",
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
    const router = createLiliaTodoRouter(createMemoryHistory());
    await router.push("/settings?tab=sync");
    await router.isReady();

    renderWithRepository(Settings, repository, {
      global: {
        plugins: [router],
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: fakeSecretsStore({
            baseUrl: "https://dav.jianguoyun.com/dav",
            root: "/liliatodo",
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
      pushedTaskChangeCount: 0,
      pushedTaskListChangeCount: 0,
      markedSyncedCount: 0,
      markedTaskChangeSyncedCount: 0,
      markedTaskListChangeSyncedCount: 0,
      pulledOpsCount: 2,
      appliedTaskCount: 2,
      deletedTaskCount: 0,
      appliedTaskListCount: 0,
      deletedTaskListCount: 0,
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

  it("侧边栏支持新增清单并广播清单刷新事件", async () => {
    const inbox = taskListFixture();
    const project = taskListFixture({ id: "list-1", name: "项目", order: 1 });
    const repository = fakeRepository();
    const listChangeListener = vi.fn();
    vi.mocked(repository.listLists)
      .mockResolvedValueOnce([inbox])
      .mockResolvedValueOnce([inbox, project]);
    window.addEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);

    try {
      await renderAppAt("/calendar", repository);

      await fireEvent.click(await screen.findByRole("button", { name: "新增清单" }));
      await fireEvent.update(screen.getByLabelText("清单名称"), "项目");
      await fireEvent.click(screen.getByRole("button", { name: "保存清单" }));

      await waitFor(() =>
        expect(repository.createList).toHaveBeenCalledWith({ name: "项目" }),
      );
      expect(await screen.findByRole("link", { name: "项目" })).toBeInTheDocument();
      expect(repository.listLists).toHaveBeenCalledTimes(2);
      expect(listChangeListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);
    }
  });

  it("清单页面支持新增清单内分类", async () => {
    const project = taskListFixture({ id: "list-1", name: "项目", order: 1 });
    const category = taskCategoryFixture({ id: "category-1", listId: "list-1", name: "工作" });
    const repository = fakeRepository({
      lists: [taskListFixture(), project],
      categories: { "list-1": [] },
    });
    vi.mocked(repository.listCategoriesByList)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([category]);
    vi.mocked(repository.createCategory).mockResolvedValue(category);

    await renderAppAt("/lists/list-1", repository);

    await fireEvent.click(await screen.findByRole("button", { name: "新增分类" }));
    await fireEvent.update(screen.getByLabelText("分类名称"), "工作");
    await fireEvent.click(screen.getByRole("button", { name: "保存分类" }));

    await waitFor(() =>
      expect(repository.createCategory).toHaveBeenCalledWith({ listId: "list-1", name: "工作" }),
    );
    expect(await screen.findByRole("button", { name: "工作" })).toBeInTheDocument();
  });

  it("侧边栏支持重命名清单并广播清单刷新事件", async () => {
    const inbox = taskListFixture();
    const project = taskListFixture({ id: "list-1", name: "项目", order: 1 });
    const renamed = taskListFixture({ id: "list-1", name: "项目二", order: 1 });
    const repository = fakeRepository();
    const listChangeListener = vi.fn();
    vi.mocked(repository.listLists)
      .mockResolvedValueOnce([inbox, project])
      .mockResolvedValueOnce([inbox, renamed]);
    window.addEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);

    try {
      await renderAppAt("/calendar", repository);

      await fireEvent.click(await screen.findByRole("button", { name: "重命名 项目" }));
      await fireEvent.update(screen.getByLabelText("重命名 项目"), "项目二");
      await fireEvent.click(screen.getByRole("button", { name: "保存 项目" }));

      await waitFor(() =>
        expect(repository.updateList).toHaveBeenCalledWith("list-1", { name: "项目二" }),
      );
      expect(await screen.findByRole("link", { name: "项目二" })).toBeInTheDocument();
      expect(repository.listLists).toHaveBeenCalledTimes(2);
      expect(listChangeListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);
    }
  });

  it("侧边栏支持清单上下移动", async () => {
    const inbox = taskListFixture();
    const first = taskListFixture({ id: "list-1", name: "项目一", order: 0 });
    const second = taskListFixture({ id: "list-2", name: "项目二", order: 1 });
    const repository = fakeRepository({
      lists: [inbox, first, second],
    });

    await renderAppAt("/calendar", repository);

    await fireEvent.click(await screen.findByRole("button", { name: "下移清单 项目一" }));

    await waitFor(() => expect(repository.updateList).toHaveBeenCalledWith("list-2", { order: 0 }));
    expect(repository.updateList).toHaveBeenCalledWith("list-1", { order: 1 });
  });

  it("清单页面支持分类上下移动和删除分类", async () => {
    const first = taskCategoryFixture({ id: "category-1", listId: "list-1", name: "工作", order: 0 });
    const second = taskCategoryFixture({ id: "category-2", listId: "list-1", name: "生活", order: 1 });
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "list-1", name: "项目", order: 1 })],
      categories: { "list-1": [first, second] },
    });

    await renderAppAt("/lists/list-1", repository);

    await fireEvent.click(await screen.findByRole("button", { name: "下移分类 工作" }));

    await waitFor(() => expect(repository.updateCategory).toHaveBeenCalledWith("category-2", { order: 0 }));
    expect(repository.updateCategory).toHaveBeenCalledWith("category-1", { order: 1 });

    await fireEvent.click(screen.getByRole("button", { name: "删除分类 工作" }));

    await waitFor(() => expect(repository.deleteCategory).toHaveBeenCalledWith("category-1"));
  });

  it("侧边栏支持归档清单并广播清单刷新事件", async () => {
    const inbox = taskListFixture();
    const project = taskListFixture({ id: "list-1", name: "项目", order: 1 });
    const repository = fakeRepository();
    const listChangeListener = vi.fn();
    vi.mocked(repository.listLists)
      .mockResolvedValueOnce([inbox, project])
      .mockResolvedValueOnce([inbox]);
    window.addEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);

    try {
      await renderAppAt("/calendar", repository);

      await fireEvent.click(await screen.findByRole("button", { name: "删除清单 项目" }));

      await waitFor(() => expect(repository.archiveList).toHaveBeenCalledWith("list-1"));
      await waitFor(() =>
        expect(screen.queryByRole("link", { name: "项目" })).not.toBeInTheDocument(),
      );
      expect(repository.listLists).toHaveBeenCalledTimes(2);
      expect(listChangeListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);
    }
  });

  it("侧边栏归档成功但刷新失败时仍广播清单刷新事件", async () => {
    const inbox = taskListFixture();
    const project = taskListFixture({ id: "list-1", name: "项目", order: 1 });
    const repository = fakeRepository();
    const listChangeListener = vi.fn();
    vi.mocked(repository.listLists)
      .mockResolvedValueOnce([inbox, project])
      .mockRejectedValueOnce(new Error("清单刷新失败"));
    window.addEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);

    try {
      await renderAppAt("/calendar", repository);

      await fireEvent.click(await screen.findByRole("button", { name: "删除清单 项目" }));

      await waitFor(() => expect(repository.archiveList).toHaveBeenCalledWith("list-1"));
      expect(await screen.findByText("错误：清单刷新失败")).toBeInTheDocument();
      expect(listChangeListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);
    }
  });

  it("侧边栏清单操作失败时显示错误且不广播成功事件", async () => {
    const repository = fakeRepository();
    const listChangeListener = vi.fn();
    vi.mocked(repository.listLists).mockResolvedValue([taskListFixture()]);
    vi.mocked(repository.createList).mockRejectedValueOnce(new Error("清单名称重复"));
    window.addEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);

    try {
      await renderAppAt("/calendar", repository);

      await fireEvent.click(await screen.findByRole("button", { name: "新增清单" }));
      await fireEvent.update(screen.getByLabelText("清单名称"), "项目");
      await fireEvent.click(screen.getByRole("button", { name: "保存清单" }));

      expect(await screen.findByText("错误：清单名称重复")).toBeInTheDocument();
      expect(listChangeListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(TASK_LISTS_CHANGED_EVENT, listChangeListener);
    }
  });

  it("清单变更事件会触发收件箱重新加载迁移任务", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.listInbox)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        task({ id: "moved-1", title: "迁移任务", listId: "inbox" }),
      ]);

    await renderAppAt("/inbox", repository);

    expect(await screen.findByText("收件箱暂无任务。可在今日页添加任务并选择收件箱。")).toBeInTheDocument();
    window.dispatchEvent(new CustomEvent(TASK_LISTS_CHANGED_EVENT));

    expect(await screen.findByText("迁移任务")).toBeInTheDocument();
    expect(repository.listInbox).toHaveBeenCalledTimes(2);
  });

  it("收件箱清单刷新不会被较慢的旧加载覆盖", async () => {
    const repository = fakeRepository();
    const initialLoad = deferred<ReturnType<TaskRepository["listInbox"]> extends Promise<infer T> ? T : never>();
    vi.mocked(repository.listInbox)
      .mockReturnValueOnce(initialLoad.promise)
      .mockResolvedValueOnce([
        task({ id: "moved-1", title: "迁移任务", listId: "inbox" }),
      ]);

    await renderAppAt("/inbox", repository);
    await waitFor(() => expect(repository.listInbox).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent(TASK_LISTS_CHANGED_EVENT));

    expect(await screen.findByText("迁移任务")).toBeInTheDocument();
    initialLoad.resolve([]);

    await waitFor(() => expect(repository.listInbox).toHaveBeenCalledTimes(2));
    expect(screen.getByText("迁移任务")).toBeInTheDocument();
    expect(
      screen.queryByText("收件箱暂无任务。可在今日页添加任务并选择收件箱。"),
    ).not.toBeInTheDocument();
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

  it("当前清单页刷新不会被较慢的旧加载覆盖", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture({ id: "list-1", name: "项目", order: 1 })],
    });
    const initialLoad = deferred<ReturnType<TaskRepository["listTasksByList"]> extends Promise<infer T> ? T : never>();
    vi.mocked(repository.listTasksByList)
      .mockReturnValueOnce(initialLoad.promise)
      .mockResolvedValueOnce([
        task({ id: "new-task", title: "新任务", listId: "list-1" }),
      ]);

    await renderAppAt("/lists/list-1", repository);
    await waitFor(() => expect(repository.listTasksByList).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent(TASK_LISTS_CHANGED_EVENT));

    expect(await screen.findByText("新任务")).toBeInTheDocument();
    initialLoad.resolve([
      task({ id: "old-task", title: "旧任务", listId: "list-1" }),
    ]);

    await waitFor(() => expect(repository.listTasksByList).toHaveBeenCalledTimes(2));
    expect(screen.getByText("新任务")).toBeInTheDocument();
    expect(screen.queryByText("旧任务")).not.toBeInTheDocument();
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

    expect(await screen.findByText("LiliaTodo 小组件")).toBeInTheDocument();
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

    await screen.findByText("LiliaTodo 小组件");
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

interface DrawerPageScenario {
  name: string;
  taskId: string;
  taskTitle: string;
  makeRepository: (overrides?: { children?: DrawerChildren }) => TaskRepository;
  render: (repository: TaskRepository) => Promise<unknown> | unknown;
  loadCount: (repository: TaskRepository) => number;
}

type DrawerTask = ReturnType<typeof task>;
type DrawerChildren = Record<string, DrawerTask[]>;
type FakeRepositoryOptions = Parameters<typeof fakeRepository>[0];

const drawerRole = "complementary";

function drawerPageScenarios(): DrawerPageScenario[] {
  const lists = [
    taskListFixture({ id: "inbox", name: "收件箱", order: 0 }),
    taskListFixture({ id: "project", name: "项目", order: 1 }),
  ];
  const todayTask = task({ id: "today-task", title: "今日任务" });
  const inboxTask = task({ id: "inbox-task", title: "收件箱任务" });
  const calendarTask = task({
    id: "calendar-task",
    title: "日历任务",
    dueAt: "2026-05-17T02:30:00.000Z",
  });
  const listTask = task({ id: "list-task", title: "清单任务", listId: "project" });
  const createDrawerScenario = (
    options: Omit<DrawerPageScenario, "taskId" | "taskTitle" | "makeRepository"> & {
      task: DrawerTask;
      repositoryOptions: (task: DrawerTask, children?: DrawerChildren) => FakeRepositoryOptions;
    },
  ): DrawerPageScenario => ({
    name: options.name,
    taskId: options.task.id,
    taskTitle: options.task.title,
    makeRepository: ({ children } = {}) => fakeRepository({
      lists,
      ...options.repositoryOptions(options.task, children),
    }),
    render: options.render,
    loadCount: options.loadCount,
  });

  return [
    createDrawerScenario({
      name: "Today",
      task: todayTask,
      repositoryOptions: (item, children) => ({
        today: { overdue: [], dueToday: [item], completedToday: [] },
        children,
      }),
      render: (repository) => renderWithRepository(Today, repository),
      loadCount: (repository) => vi.mocked(repository.listToday).mock.calls.length,
    }),
    createDrawerScenario({
      name: "Inbox",
      task: inboxTask,
      repositoryOptions: (item, children) => ({ inbox: [item], children }),
      render: (repository) => renderWithRepository(Inbox, repository),
      loadCount: (repository) => vi.mocked(repository.listInbox).mock.calls.length,
    }),
    createDrawerScenario({
      name: "Calendar",
      task: calendarTask,
      repositoryOptions: (item, children) => ({ agenda: [item], children }),
      render: (repository) => renderWithRepository(Calendar, repository),
      loadCount: (repository) => vi.mocked(repository.listAgenda).mock.calls.length,
    }),
    createDrawerScenario({
      name: "TaskListPage",
      task: listTask,
      repositoryOptions: (item, children) => ({
        listTasks: { project: [item] },
        children,
      }),
      render: (repository) => renderAppAt("/lists/project", repository),
      loadCount: (repository) => vi.mocked(repository.listTasksByList).mock.calls.length,
    }),
  ];
}

async function openDrawerTask(scenario: DrawerPageScenario, repository: TaskRepository) {
  await scenario.render(repository);
  await clickPageTask(scenario);
  return screen.findByRole(drawerRole, { name: "任务详情" });
}

async function clickPageTask(scenario: DrawerPageScenario) {
  const item = await screen.findByText(scenario.taskTitle);
  await fireEvent.click(item);
}

function getDrawer() {
  return screen.getByRole(drawerRole, { name: "任务详情" });
}

function expectDrawerHeading(drawer: HTMLElement, title: string) {
  expect(within(drawer).getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
}

async function saveCommonDrawerFields(drawer: HTMLElement, scenario: DrawerPageScenario) {
  const controls = within(drawer);
  await fireEvent.update(controls.getByLabelText("任务名"), `${scenario.name}已更新`);
  await fireEvent.update(controls.getByLabelText("详细内容"), `${scenario.name}详细内容`);
  await fireEvent.update(controls.getByLabelText("优先级"), "2");
  await fireEvent.update(controls.getByLabelText("所属清单"), "project");
  await fireEvent.click(controls.getByRole("button", { name: "保存" }));
}

async function expectPageReloaded(scenario: DrawerPageScenario, repository: TaskRepository) {
  await waitFor(() => expect(scenario.loadCount(repository)).toBeGreaterThan(1));
}

async function expectDrawerError(message: string) {
  expect(await screen.findByText(`错误：${message}`)).toBeInTheDocument();
  expect(getDrawer()).toBeInTheDocument();
}

async function renderAppAt(path: string, repository: TaskRepository) {
  const router = createLiliaTodoRouter(createMemoryHistory());
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
          root: "/liliatodo",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

