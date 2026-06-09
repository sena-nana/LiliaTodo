import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useTaskDetailDrawer } from "../src/composables/useTaskDetailDrawer";
import { fakeTaskRepository, taskFixture, taskListFixture } from "./taskFixtures";

describe("任务详情抽屉逻辑", () => {
  it("打开任务时选中任务并加载子任务和清单", async () => {
    const parent = taskFixture({ id: "parent", title: "父任务" });
    const child = taskFixture({ id: "child", title: "子任务", parentId: "parent" });
    const list = taskListFixture({ id: "project", name: "项目" });
    const repository = fakeTaskRepository({
      children: { parent: [child] },
      lists: [list],
    });
    const drawer = useTaskDetailDrawer({
      repository,
      reload: vi.fn(),
      getParentCandidates: () => [parent, child],
    });

    await drawer.openTask(parent);

    expect(drawer.selectedTask.value).toEqual(parent);
    expect(drawer.childTasks.value).toEqual([child]);
    expect(drawer.lists.value).toEqual([list]);
    expect(repository.listTaskChildren).toHaveBeenCalledWith("parent");
    expect(repository.listLists).toHaveBeenCalledTimes(1);
    expect(drawer.parentCandidates.value).toEqual([child]);
  });

  it("保存任务后刷新页面数据并重新打开更新后的任务", async () => {
    const original = taskFixture({ id: "task-1", title: "旧任务" });
    const updated = taskFixture({ id: "task-1", title: "新任务" });
    const reload = vi.fn().mockResolvedValue(undefined);
    const repository = fakeTaskRepository({
      inbox: [original],
      children: { "task-1": [] },
    });
    vi.mocked(repository.updateTask).mockResolvedValueOnce(updated);
    const drawer = useTaskDetailDrawer({
      repository,
      reload,
      getParentCandidates: () => [updated],
    });

    await drawer.saveTask("task-1", { title: "新任务" });

    expect(repository.updateTask).toHaveBeenCalledWith("task-1", { title: "新任务" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(repository.listTaskChildren).toHaveBeenCalledWith("task-1");
    expect(drawer.selectedTask.value).toEqual(updated);
    expect(drawer.saving.value).toBe(false);
  });

  it("完成任务后关闭抽屉并刷新页面数据", async () => {
    const task = taskFixture({ id: "task-1", title: "待完成" });
    const reload = vi.fn().mockResolvedValue(undefined);
    const repository = fakeTaskRepository({ inbox: [task] });
    const drawer = useTaskDetailDrawer({
      repository,
      reload,
      getParentCandidates: () => [task],
    });

    await drawer.openTask(task);
    await drawer.completeTask(task);

    expect(repository.setStatus).toHaveBeenCalledWith("task-1", "completed");
    expect(drawer.selectedTask.value).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("仓库异常会写入抽屉错误", async () => {
    const task = taskFixture({ id: "task-1", title: "异常任务" });
    const repository = fakeTaskRepository({ inbox: [task] });
    vi.mocked(repository.listTaskChildren).mockRejectedValueOnce(new Error("children unavailable"));
    const drawer = useTaskDetailDrawer({
      repository,
      reload: vi.fn(),
      getParentCandidates: () => [task],
    });

    await drawer.openTask(task);
    await nextTick();

    expect(drawer.drawerError.value).toBe("Error: children unavailable");
  });
});
