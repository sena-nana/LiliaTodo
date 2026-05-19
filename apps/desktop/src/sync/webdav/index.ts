// BE-12：WebDAV 同步层统一出口。
//
// 暴露给上层 SyncRunner 与 Settings 配置面板，不暴露内部子模块的辅助函数。
// 仅依赖 `@momo/schema` 与 `backend/contracts/{entity,op}`，详见 paths.ts 边界注释。

export {
  WebdavConflictError,
  WebdavUnreachableError,
  type WebdavClient,
  type WebdavConfig,
  type WebdavCredentials,
  type WebdavGetResult,
  type WebdavPutOptions,
  type WebdavPutResult,
  type WebdavStat,
} from "./types";
export {
  WEBDAV_DEFAULT_ROOT,
  createWebdavLayout,
  type WebdavLayout,
} from "./paths";
export {
  createWebdavSyncProvider,
  type CreateWebdavSyncProviderOptions,
  type SyncProvider,
  type SyncPullResult,
  type SyncPushResult,
  type SyncSnapshot,
} from "./provider";
export {
  EMPTY_CURSOR,
  decodeCursor,
  encodeCursor,
  type DevicePullPosition,
  type PullCursor,
} from "./cursor";
