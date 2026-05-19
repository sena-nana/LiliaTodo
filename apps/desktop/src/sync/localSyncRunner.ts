// TODO(AP-01 → BE-12)：本运行器目前借 apps/api 内存 router 跑通本地同步骨架；
// 阶段 3 将整体替换为 apps/desktop/src/sync/webdav/ 实现，届时移除对 ../../../api/src 的运行时依赖。
import {
  createApiRouter,
  createInMemorySyncStore,
  createInMemoryTaskRepository,
  createSyncApi,
  createTaskService,
} from "../../../api/src";
import type { TaskRepository } from "../data/taskRepository";
import { createHttpLikeSyncTransport } from "./httpLikeSyncTransport";
import { createSyncRunner, type SyncRunner } from "./syncClient";

const LOCAL_WORKSPACE_ID = "local";
const LOCAL_DEVICE_ID = "desktop-1";
const localStore = createInMemorySyncStore();
const localTaskRepository = createInMemoryTaskRepository();

export function createLocalSyncRunner(repository: TaskRepository): SyncRunner {
  const router = createApiRouter({
    taskService: createTaskService({
      repository: localTaskRepository,
      now: () => new Date(),
    }),
    syncApi: createSyncApi({
      store: localStore,
      now: () => new Date(),
    }),
  });

  return createSyncRunner({
    repository,
    transport: createHttpLikeSyncTransport({ router }),
    workspaceId: LOCAL_WORKSPACE_ID,
    deviceId: LOCAL_DEVICE_ID,
    now: () => new Date(),
  });
}
