import { fireEvent, screen, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { drawerRole, renderAppAt, resetPageTestMocks, sectionByHeading } from "./pageTestUtils";
import { fakeTaskRepository as fakeRepository, taskListFixture, taskFixture as task } from "./taskFixtures";

afterEach(resetPageTestMocks);

describe("pages.taskViews", () => {
  it("全局四象限视图按重要和紧急分组", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "project", name: "项目", order: 1 })],
      activeTasks: [
        task({ id: "important-urgent", title: "重要且紧急任务", listId: "project", priority: 2, dueAt: "2026-01-01T00:00:00.000Z" }),
        task({ id: "important-not-urgent", title: "重要不紧急任务", listId: "project", priority: 1, dueAt: "2099-01-01T00:00:00.000Z" }),
        task({ id: "not-important-urgent", title: "不重要但紧急任务", listId: "project", priority: 0, dueAt: "2026-01-01T00:00:00.000Z" }),
        task({ id: "not-important-not-urgent", title: "不重要不紧急任务", listId: "project", priority: 0, dueAt: null }),
      ],
    });

    await renderAppAt("/tasks/quadrant", repository);

    expect(await sectionByHeading("重要且紧急")).toHaveTextContent("重要且紧急任务");
    expect(await sectionByHeading("重要不紧急")).toHaveTextContent("重要不紧急任务");
    expect(await sectionByHeading("不重要但紧急")).toHaveTextContent("不重要但紧急任务");
    expect(await sectionByHeading("不重要不紧急")).toHaveTextContent("不重要不紧急任务");
  });


  it("全局时间线视图显示全部 active 任务并按时间排序", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "project", name: "项目", order: 1 })],
      activeTasks: [
        task({ id: "created-task", title: "无时间任务", listId: "project", createdAt: "2026-05-20T00:00:00.000Z" }),
        task({ id: "start-task", title: "开始任务", listId: "project", startAt: "2026-05-18T00:00:00.000Z" }),
        task({ id: "due-task", title: "截止任务", listId: "project", dueAt: "2026-05-19T00:00:00.000Z" }),
      ],
    });

    await renderAppAt("/tasks/timeline", repository);

    await screen.findByText("开始任务");
    const titles = screen.getAllByText(/^(开始任务|截止任务|无时间任务)$/).map((item) => item.textContent);
    expect(titles).toEqual(["开始任务", "截止任务", "无时间任务"]);
  });


  it("全局任务视图点击任务能打开详情", async () => {
    const repository = fakeRepository({
      lists: [taskListFixture(), taskListFixture({ id: "project", name: "项目", order: 1 })],
      activeTasks: [
        task({ id: "view-task", title: "视图任务", listId: "project", priority: 1, dueAt: "2026-01-01T00:00:00.000Z" }),
      ],
    });

    await renderAppAt("/tasks/all", repository);

    await fireEvent.click(await screen.findByText("视图任务"));

    expect(await screen.findByRole(drawerRole, { name: "任务详情" })).toBeInTheDocument();
    expect(repository.listActiveTasks).toHaveBeenCalled();
  });


  it("最近删除页支持恢复和彻底删除", async () => {
    const repository = fakeRepository({
      statusTasks: {
        deleted: [
          task({ id: "deleted-1", title: "可恢复任务", deletedAt: "2026-06-01T00:00:00.000Z" }),
          task({ id: "deleted-2", title: "可清理任务", deletedAt: "2026-06-02T00:00:00.000Z" }),
        ],
      },
    });

    await renderAppAt("/tasks/deleted", repository);

    await fireEvent.click(await screen.findByRole("button", { name: "恢复 可恢复任务" }));
    await fireEvent.click(await screen.findByRole("button", { name: "彻底删除 可清理任务" }));

    await waitFor(() => expect(repository.restoreTask).toHaveBeenCalledWith("deleted-1"));
    expect(repository.purgeTask).toHaveBeenCalledWith("deleted-2");
  });


});
