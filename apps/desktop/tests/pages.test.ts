import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred, clickPageTask, drawerPageScenarios, drawerRole, expectDrawerError, expectDrawerHeading, expectPageReloaded, fakeSecretsStore, fakeWebdavController, getDrawer, invokeMock, notificationMocks, openDrawerTask, renderAppAt, renderWithRepository, resetPageTestMocks, saveCommonDrawerFields } from "./pageTestUtils";
import type { TaskRepository } from "../src/data/taskRepository";
import { AgentAutoTriggerKey } from "../src/agent/autoTriggers";
import Calendar from "../src/pages/Calendar.vue";
import SyncSettings from "../src/pages/settings/SyncSettings.vue";
import Widget from "../src/pages/Widget.vue";
import Settings from "../src/pages/Settings.vue";
import App from "../src/App.vue";
import { TASK_LISTS_CHANGED_EVENT } from "../src/data/taskListEvents";
import { fakeTaskRepository as fakeRepository, taskCategoryFixture, taskListFixture, taskFixture as task } from "./taskFixtures";

afterEach(resetPageTestMocks);

describe("页面 MVP 行为", () => {
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


  it("清单页面按分类分组显示数量并支持折叠", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "project", name: "项目", order: 1 })],
      categories: {
        project: [taskCategoryFixture({ id: "category-1", listId: "project", name: "工作" })],
      },
      listTasks: {
        project: [
          task({ id: "work-task", title: "工作任务", listId: "project", categoryId: "category-1" }),
          task({ id: "plain-task", title: "未分类任务", listId: "project" }),
        ],
      },
    });

    await renderAppAt("/lists/project", repository);

    expect(await screen.findByText("工作任务")).toBeInTheDocument();
    const workSection = screen.getByRole("button", { name: /工作\s*1/ });
    expect(screen.getByRole("button", { name: /未分类\s*1/ })).toBeInTheDocument();
    expect(screen.getByText("未分类任务")).toBeInTheDocument();

    await fireEvent.click(workSection);

    expect(screen.queryByText("工作任务")).toBeNull();
    expect(screen.getByText("未分类任务")).toBeInTheDocument();
  });


  it("清单页面按选中分组新增任务", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "project", name: "项目", order: 1 })],
      categories: {
        project: [taskCategoryFixture({ id: "category-1", listId: "project", name: "工作" })],
      },
    });

    await renderAppAt("/lists/project", repository);

    await fireEvent.click(await screen.findByRole("button", { name: /工作\s*0/ }));
    await fireEvent.update(screen.getByLabelText("添加清单任务"), "分组任务");
    await fireEvent.click(screen.getByRole("button", { name: "添加任务" }));

    await waitFor(() =>
      expect(repository.createTask).toHaveBeenCalledWith({
        title: "分组任务",
        listId: "project",
        categoryId: "category-1",
      }),
    );
  });


  it("清单页面完成按钮不会打开任务详情", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "project", name: "项目", order: 1 })],
      listTasks: {
        project: [task({ id: "task-1", title: "清单任务", listId: "project" })],
      },
    });

    await renderAppAt("/lists/project", repository);

    await fireEvent.click(await screen.findByRole("button", { name: "完成 清单任务" }));

    await waitFor(() => expect(repository.setStatus).toHaveBeenCalledWith("task-1", "completed"));
    expect(screen.queryByRole(drawerRole, { name: "任务详情" })).toBeNull();
  });


  it("搜索页提交完整筛选条件", async () => {
    const repository = fakeRepository({
      lists: [
        taskListFixture(),
        taskListFixture({ id: "project", name: "项目", order: 1 }),
      ],
      categories: {
        project: [taskCategoryFixture({ id: "category-1", listId: "project", name: "工作" })],
      },
      searchResults: [task({ id: "search-1", title: "搜索结果", listId: "project", categoryId: "category-1" })],
    });

    await renderAppAt("/search", repository);

    await screen.findByText("搜索结果");
    await fireEvent.update(screen.getByLabelText("搜索任务"), "报告");
    await fireEvent.update(screen.getByLabelText("筛选状态"), "completed");
    await fireEvent.update(screen.getByLabelText("筛选标签"), "客户, 复盘");
    await fireEvent.update(screen.getByLabelText("筛选清单"), "project");
    await fireEvent.update(screen.getByLabelText("筛选分类"), "category-1");
    await fireEvent.update(screen.getByLabelText("筛选优先级"), "2");
    await fireEvent.update(screen.getByLabelText("筛选计划状态"), "scheduled");
    await fireEvent.update(screen.getByLabelText("筛选开始时间"), "2026-06-01T00:00");
    await fireEvent.update(screen.getByLabelText("筛选结束时间"), "2026-06-30T23:59");
    await fireEvent.update(screen.getByLabelText("筛选提醒状态"), "due");
    await fireEvent.click(screen.getByLabelText("含最近删除"));

    await waitFor(() =>
      expect(repository.searchTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        text: "报告",
        tags: ["客户", "复盘"],
        listId: "project",
        categoryId: "category-1",
        statuses: ["completed"],
        priorities: [2],
        timeMode: "scheduled",
        timeFrom: expect.any(String),
        timeTo: expect.any(String),
        reminderStatus: "due",
        includeDeleted: true,
      })),
    );
  });


  it("搜索页支持保存、应用和删除自定义筛选视图", async () => {
    const repository = fakeRepository({
      lists: [
        taskListFixture(),
        taskListFixture({ id: "project", name: "项目", order: 1 }),
      ],
      categories: {
        project: [taskCategoryFixture({ id: "category-1", listId: "project", name: "工作" })],
      },
      searchResults: [task({ id: "search-1", title: "搜索结果", listId: "project", categoryId: "category-1" })],
    });

    window.localStorage.clear();
    await renderAppAt("/search", repository);

    await screen.findByText("搜索结果");
    await fireEvent.update(screen.getByLabelText("搜索任务"), "报告");
    await fireEvent.update(screen.getByLabelText("筛选状态"), "completed");
    await fireEvent.update(screen.getByLabelText("筛选标签"), "客户");
    await fireEvent.update(screen.getByLabelText("筛选清单"), "project");
    await fireEvent.update(screen.getByLabelText("筛选分类"), "category-1");
    await fireEvent.update(screen.getByLabelText("筛选计划状态"), "unscheduled");
    await fireEvent.update(screen.getByLabelText("视图名称"), "客户复盘");
    await fireEvent.click(screen.getByRole("button", { name: "保存视图" }));

    expect(screen.getByRole("option", { name: "客户复盘" })).toBeInTheDocument();
    expect(window.localStorage.getItem("liliatodo.savedTaskViews.v1")).toContain("客户复盘");

    await fireEvent.update(screen.getByLabelText("搜索任务"), "临时搜索");
    await fireEvent.update(screen.getByLabelText("筛选状态"), "active");
    await fireEvent.update(screen.getByLabelText("已保存视图"), screen.getByRole("option", { name: "客户复盘" }).getAttribute("value") ?? "");
    await fireEvent.click(screen.getByRole("button", { name: "应用视图" }));

    await waitFor(() =>
      expect(repository.searchTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        text: "报告",
        tags: ["客户"],
        listId: "project",
        categoryId: "category-1",
        statuses: ["completed"],
        timeMode: "unscheduled",
      })),
    );

    await fireEvent.update(screen.getByLabelText("已保存视图"), screen.getByRole("option", { name: "内置：无计划任务" }).getAttribute("value") ?? "");
    await fireEvent.click(screen.getByRole("button", { name: "应用视图" }));

    await waitFor(() =>
      expect(repository.searchTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        statuses: ["active"],
        timeMode: "unscheduled",
      })),
    );

    await fireEvent.update(screen.getByLabelText("已保存视图"), screen.getByRole("option", { name: "客户复盘" }).getAttribute("value") ?? "");
    await fireEvent.click(screen.getByRole("button", { name: "删除视图" }));

    expect(screen.queryByRole("option", { name: "客户复盘" })).toBeNull();
  });


  it("搜索页应用内置本周高优先级视图时提交本周范围", async () => {
    const expectedRange = currentLocalWeekIsoRange();
    const repository = fakeRepository({
      searchResults: [task({ id: "weekly-high", title: "本周重点", priority: 2 })],
    });

    await renderAppAt("/search", repository);

    await screen.findByText("本周重点");
    await fireEvent.update(screen.getByLabelText("已保存视图"), screen.getByRole("option", { name: "内置：本周高优先级" }).getAttribute("value") ?? "");
    await fireEvent.click(screen.getByRole("button", { name: "应用视图" }));

    await waitFor(() =>
      expect(repository.searchTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        statuses: ["active"],
        priorities: [2],
        timeMode: "scheduled",
        timeFrom: expectedRange.start,
        timeTo: expectedRange.end,
      })),
    );
  });

  it("搜索页应用非法时间视图时显示中文错误且不提交查询", async () => {
    const repository = fakeRepository({
      searchResults: [task({ id: "search-1", title: "搜索结果" })],
    });
    window.localStorage.setItem("liliatodo.savedTaskViews.v1", JSON.stringify([
      {
        id: "view-invalid-time",
        name: "非法时间视图",
        builtIn: false,
        createdAt: "2026-06-12T00:00:00.000Z",
        query: {
          keyword: "",
          status: "all",
          tagText: "",
          listId: "",
          categoryId: "",
          priority: "all",
          timeMode: "scheduled",
          timeFrom: "bad-time",
          timeTo: "",
          reminderStatus: "all",
          includeDeleted: false,
        },
      },
    ]));

    await renderAppAt("/search", repository);

    await screen.findByText("搜索结果");
    const initialCalls = vi.mocked(repository.searchTasks).mock.calls.length;
    await fireEvent.update(screen.getByLabelText("已保存视图"), "view-invalid-time");
    await fireEvent.click(screen.getByRole("button", { name: "应用视图" }));

    expect(await screen.findByText("错误：筛选开始时间不合法")).toBeInTheDocument();
    expect(repository.searchTasks).toHaveBeenCalledTimes(initialCalls);
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



  it("App 启动时安装 Agent 自动触发并把提醒到期回调接回 controller", async () => {
    const repository = fakeRepository();
    const agentAutoTrigger = {
      runStartupChecks: vi.fn().mockResolvedValue(undefined),
      requestReminderDue: vi.fn(),
      stop: vi.fn(),
    };

    await renderAppAt("/today", repository, {
      [AgentAutoTriggerKey as symbol]: agentAutoTrigger,
    });

    await screen.findByText("今日到期");
    const notifyRepository = notificationMocks.notifyDueReminders.mock.calls[0]?.[0];
    const tickRepository = notificationMocks.listenReminderTicks.mock.calls[0]?.[0];
    expect(notifyRepository).toEqual(expect.objectContaining({ databasePath: repository.databasePath, updateTask: expect.any(Function) }));
    expect(tickRepository).toEqual(expect.objectContaining({ databasePath: repository.databasePath, updateTask: expect.any(Function) }));
    expect(notificationMocks.notifyDueReminders.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      onReminderDue: expect.any(Function),
    }));
    expect(notificationMocks.listenReminderTicks.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      onReminderDue: expect.any(Function),
    }));

    const notifyOptions = notificationMocks.notifyDueReminders.mock.calls[0]?.[1] as {
      onReminderDue?: (event: unknown) => void;
    };
    const event = { task: task({ id: "task-1" }), reminderId: "reminder-1", notifiedAt: "2026-05-16T08:00:00.000Z" };
    notifyOptions.onReminderDue?.(event);

    expect(agentAutoTrigger.requestReminderDue).toHaveBeenCalledWith(event);
  });


  it("主窗口 shell 展示任务导航和设置入口", async () => {
    const repository = fakeRepository();

    await renderAppAt("/today", repository);

    const mainNav = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(mainNav).queryByText("任务")).not.toBeInTheDocument();
    expect(within(mainNav).getByRole("link", { name: /今日/ })).toBeInTheDocument();
    expect(within(mainNav).getByRole("link", { name: /^收件箱$/ })).toBeInTheDocument();
    expect(within(mainNav).getByRole("link", { name: /Agent 收件箱/ })).toBeInTheDocument();
    expect(within(mainNav).getByRole("link", { name: /日历/ })).toBeInTheDocument();
    expect(within(mainNav).getByRole("link", { name: /所有/ })).toBeInTheDocument();
    expect(within(mainNav).getByRole("link", { name: /四象限/ })).toBeInTheDocument();
    expect(within(mainNav).getByRole("link", { name: /时间线/ })).toBeInTheDocument();
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


  it("清单页面提供分类管理入口并可创建分类", async () => {
    const project = taskListFixture({ id: "list-1", name: "项目", order: 1 });
    const repository = fakeRepository({
      lists: [taskListFixture(), project],
      categories: { "list-1": [taskCategoryFixture({ id: "category-1", listId: "list-1", name: "工作" })] },
    });

    await renderAppAt("/lists/list-1", repository);

    expect(await screen.findByRole("button", { name: /工作\s*0/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "新增分类" }));
    await fireEvent.update(screen.getByLabelText("分类名称"), "生活");
    await fireEvent.click(screen.getByRole("button", { name: "保存分类" }));

    await waitFor(() =>
      expect(repository.createCategory).toHaveBeenCalledWith({ listId: "list-1", name: "生活" }),
    );
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


  it("侧边栏支持拖拽排序清单", async () => {
    const inbox = taskListFixture();
    const first = taskListFixture({ id: "list-1", name: "项目一", order: 0 });
    const second = taskListFixture({ id: "list-2", name: "项目二", order: 1 });
    const repository = fakeRepository({
      lists: [inbox, first, second],
    });

    await renderAppAt("/calendar", repository);

    const firstRow = (await screen.findByRole("link", { name: "项目一" })).closest(".sb-tree__row");
    const secondRow = screen.getByRole("link", { name: "项目二" }).closest(".sb-tree__row");
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();

    await fireEvent.dragStart(firstRow as HTMLElement);
    await fireEvent.drop(secondRow as HTMLElement);

    await waitFor(() => expect(repository.updateList).toHaveBeenCalledWith("list-2", { order: 0 }));
    expect(repository.updateList).toHaveBeenCalledWith("list-1", { order: 1 });
  });


  it("清单页面显示空分类分组并可折叠", async () => {
    const first = taskCategoryFixture({ id: "category-1", listId: "list-1", name: "工作", order: 0 });
    const second = taskCategoryFixture({ id: "category-2", listId: "list-1", name: "生活", order: 1 });
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "list-1", name: "项目", order: 1 })],
      categories: { "list-1": [first, second] },
    });

    await renderAppAt("/lists/list-1", repository);

    const workSection = await screen.findByRole("button", { name: /工作\s*0/ });

    expect(screen.getByRole("button", { name: /生活\s*0/ })).toBeInTheDocument();
    expect(screen.getAllByText("暂无任务。").length).toBeGreaterThan(0);

    await fireEvent.click(workSection);

    expect(repository.updateCategory).not.toHaveBeenCalled();
    expect(repository.deleteCategory).not.toHaveBeenCalled();
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

function currentLocalWeekIsoRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 0, 0);
  return {
    start: new Date(toLocalDateTimeInput(start)).toISOString(),
    end: new Date(toLocalDateTimeInput(end)).toISOString(),
  };
}

function toLocalDateTimeInput(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 16);
}
