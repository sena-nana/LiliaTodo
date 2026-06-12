import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred, drawerRole, renderWithRepository, resetPageTestMocks } from "./pageTestUtils";
import Inbox from "../src/pages/Inbox.vue";
import type { TaskRepository } from "../src/data/taskRepository";
import { TASK_LISTS_CHANGED_EVENT } from "../src/data/taskListEvents";
import { fakeTaskRepository as fakeRepository, taskFixture as task } from "./taskFixtures";

afterEach(resetPageTestMocks);

describe("pages.inbox", () => {
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
    await waitFor(() => expect(repository.setStatus).toHaveBeenCalledWith("inbox-1", "completed"));
    const refreshedRow = (await screen.findByText("Inbox task")).closest("li");
    expect(refreshedRow).not.toBeNull();
    await fireEvent.click(
      within(refreshedRow as HTMLElement).getByRole("button", {
        name: "删除 Inbox task",
      }),
    );

    expect(repository.deleteTask).toHaveBeenCalledWith("inbox-1");
  });


  it("收件箱任务支持拖拽重排", async () => {
    const repository = fakeRepository({
      inbox: [
        task({ id: "task-1", title: "任务一", childOrder: 0 }),
        task({ id: "task-2", title: "任务二", childOrder: 1 }),
      ],
    });

    renderWithRepository(Inbox, repository);

    const firstRow = (await screen.findByText("任务一")).closest("li");
    const secondRow = screen.getByText("任务二").closest("li");
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();

    await fireEvent.dragStart(firstRow as HTMLElement);
    await fireEvent.drop(secondRow as HTMLElement);

    await waitFor(() =>
      expect(repository.reorderTasks).toHaveBeenCalledWith({
        taskIds: ["task-2", "task-1"],
        listId: "inbox",
        categoryId: null,
      }),
    );
  });


  it("收件箱批量工具条支持改期", async () => {
    const repository = fakeRepository({
      inbox: [
        task({ id: "task-1", title: "任务一" }),
        task({ id: "task-2", title: "任务二" }),
      ],
    });

    renderWithRepository(Inbox, repository);

    await fireEvent.click(await screen.findByLabelText("选择 任务一"));
    await fireEvent.click(screen.getByLabelText("选择 任务二"));
    await fireEvent.update(screen.getByLabelText("批量截止时间"), "2026-06-12T09:30");
    await fireEvent.click(screen.getByRole("button", { name: /改期/ }));

    await waitFor(() =>
      expect(repository.batchUpdateTasks).toHaveBeenCalledWith({
        type: "reschedule",
        taskIds: ["task-1", "task-2"],
        dueAt: expect.any(String),
      }),
    );
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


  it("打开含不存在日期的任务详情时不会崩溃", async () => {
    const repository = fakeRepository({
      inbox: [
        task({
          id: "inbox-1",
          title: "坏日期任务",
          startAt: "2026-02-31T09:00:00.000Z",
          dueAt: "2026-02-31T10:00:00.000Z",
          reminders: [
            { id: "reminder-1", triggerAt: "2026-02-31T08:00:00.000Z", status: "pending", message: null },
          ],
        }),
      ],
    });

    renderWithRepository(Inbox, repository);

    const row = (await screen.findByText("坏日期任务")).closest("li");
    expect(row).not.toBeNull();
    await fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "编辑 坏日期任务" }));

    const drawer = await screen.findByRole(drawerRole, { name: "任务详情" });
    expect(within(drawer).getByLabelText("开始时间")).toHaveValue("");
    expect(within(drawer).getByLabelText("截止时间")).toHaveValue("");
    expect(within(drawer).getByText("坏日期任务")).toBeInTheDocument();
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


  it("清单变更事件会触发收件箱重新加载迁移任务", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.listInbox)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        task({ id: "moved-1", title: "迁移任务", listId: "inbox" }),
      ]);

    renderWithRepository(Inbox, repository);

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

    renderWithRepository(Inbox, repository);
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


});
