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
  type WebdavServerInfo,
  type WebdavStat,
} from "./types";
export {
  SNAPSHOT_EXTENSION,
  WEBDAV_DEFAULT_ROOT,
  createWebdavLayout,
  parseSnapshotFileName,
  type WebdavLayout,
} from "./paths";
export {
  DEFAULT_SNAPSHOT_OPLOG_THRESHOLD,
  listSnapshots,
  loadSnapshot,
  mergeOpsIntoSnapshot,
  parseSnapshot,
  pickLatestSnapshot,
  serializeSnapshot,
  shouldCompactSnapshot,
  writeSnapshot,
  type ListSnapshotsResult,
  type LoadSnapshotResult,
  type MergeOpsIntoSnapshotOptions,
  type MergeOpsIntoSnapshotResult,
  type ShouldCompactSnapshotInput,
  type SnapshotEntry,
  type SnapshotMeta,
  type WriteSnapshotOptions,
} from "./snapshot";
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
export {
  DEFAULT_IDLE_DEBOUNCE_MS,
  DEFAULT_PULL_INTERVAL_MS,
  createWebdavSyncScheduler,
  type SchedulerTimers,
  type SyncReason,
  type SyncRunReport,
  type TimerHandle,
  type WebdavSyncScheduler,
  type WebdavSyncSchedulerOptions,
} from "./scheduler";
export {
  applyOpToEntity,
  compareOpsForReplay,
  dedupeOps,
  groupOpsByEntity,
  mergeOpsAcrossEntities,
  mergeOpsForEntity,
  sortOpsForReplay,
  type ApplyOpToEntityOptions,
  type EntityWithUnknownPayload,
  type MergeOpsAcrossEntitiesEntry,
  type MergeOpsAcrossEntitiesOptions,
  type MergeOpsAcrossEntitiesResult,
  type MergeOpsForEntityOptions,
  type MergeOpsForEntityResult,
} from "./merge";
export {
  lastWriteWinsFieldMergePolicy,
  noopSemanticConflictDetector,
  type FieldMergeInput,
  type FieldMergePolicy,
  type SemanticConflict,
  type SemanticConflictDetector,
  type SemanticConflictInspectInput,
} from "./conflict";
export {
  conservativeWebdavCapabilities,
  detectWebdavCapabilities,
  inferVendor,
  type DetectWebdavCapabilitiesInput,
  type WebdavCapabilities,
  type WebdavVendor,
} from "./capabilities";
export {
  createEtagOptimisticLockStrategy,
  createReadBeforeWriteLockStrategy,
  pickLockStrategy,
  type LockStrategy,
  type LockStrategyKind,
  type LockToken,
  type PickLockStrategyInput,
} from "./lock";
