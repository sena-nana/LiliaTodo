import { inject, type App, type InjectionKey } from "vue";
import {
  createTaskRepository,
  type TaskRepository,
} from "./taskRepository";
import type { WebdavSyncController } from "../sync/defaultSettingsSyncRuntime";
import type { WebdavSecretsStore } from "../sync/webdav";

const defaultRepository = createTaskRepository();

export const TaskRepositoryKey: InjectionKey<TaskRepository> = Symbol(
  "TaskRepository",
);
export const WebdavSyncControllerKey: InjectionKey<WebdavSyncController | null> =
  Symbol("WebdavSyncController");
export const WebdavSecretsStoreKey: InjectionKey<WebdavSecretsStore | null> =
  Symbol("WebdavSecretsStore");

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
