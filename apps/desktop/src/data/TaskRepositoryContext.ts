import { inject, type App, type InjectionKey } from "vue";
import { createLazyTaskRepository } from "./lazyTaskRepository";
import type { TaskRepository } from "./taskRepository";

const defaultRepository = createLazyTaskRepository();

export const TaskRepositoryKey: InjectionKey<TaskRepository> = Symbol(
  "TaskRepository",
);

export function installTaskRepository(
  app: App,
  repository: TaskRepository = defaultRepository,
) {
  app.provide(TaskRepositoryKey, repository);
}

export function useTaskRepository() {
  const repository = inject(TaskRepositoryKey);
  if (!repository) {
    throw new Error("Task repository is not provided");
  }
  return repository;
}
