import { describe, expect, it, vi } from "vitest";
import type { TaskRepository } from "../src/data/taskRepository";
import { taskFixture } from "./taskFixtures";

describe("懒加载任务仓储", () => {
  it("代理调用保留真实仓储的 this 绑定", async () => {
    vi.resetModules();
    const inboxTask = taskFixture({ id: "inbox-task", title: "收件箱任务" });
    const repository = {
      databasePath: "sqlite:liliatodo.db",
      listTasksByList: vi.fn().mockResolvedValue([inboxTask]),
      async listInbox(this: TaskRepository) {
        return this.listTasksByList("inbox");
      },
    } as Partial<TaskRepository> as TaskRepository;
    vi.doMock("../src/data/taskRepository", () => ({
      createTaskRepository: vi.fn(() => repository),
    }));
    const { createLazyTaskRepository } = await import("../src/data/lazyTaskRepository");
    const lazyRepository = createLazyTaskRepository();

    await expect(lazyRepository.listInbox()).resolves.toEqual([inboxTask]);

    expect(repository.listTasksByList).toHaveBeenCalledWith("inbox");
  });
});
