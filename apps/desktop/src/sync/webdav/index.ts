// BE-12：WebDAV 同步层统一出口。
//
// 暴露给上层 SyncRunner 与 Settings 配置面板，不暴露内部子模块的辅助函数。
// 仅依赖 `@liliatodo/schema` 与 `sync/types/{entity,op}`，详见 paths.ts 边界注释。

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
  buildCompactedSnapshot,
  countOplogChunks,
  listSnapshots,
  loadSnapshot,
  mergeOpsIntoSnapshot,
  parseSnapshot,
  parseSnapshotDocument,
  pickLatestSnapshot,
  serializeSnapshotDocument,
  serializeSnapshot,
  shouldCompactSnapshot,
  writeCompactedSnapshot,
  writeSnapshot,
  type BuildCompactedSnapshotOptions,
  type BuildCompactedSnapshotResult,
  type CountOplogChunksResult,
  type ListSnapshotsResult,
  type LoadSnapshotResult,
  type MergeOpsIntoSnapshotOptions,
  type MergeOpsIntoSnapshotResult,
  type ParseSnapshotDocumentResult,
  type ShouldCompactSnapshotInput,
  type SnapshotEntry,
  type SnapshotMeta,
  type WriteCompactedSnapshotOptions,
  type WriteCompactedSnapshotResult,
  type WriteSnapshotOptions,
} from "./snapshot";
export {
  compactWebdavSnapshot,
  createWebdavSyncProvider,
  type CompactWebdavSnapshotOptions,
  type CompactWebdavSnapshotResult,
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
export {
  createWebdavHttpClient,
  type CreateWebdavHttpClientOptions,
  type HttpFetcher,
  type HttpHeaders,
  type HttpRequest,
  type HttpResponse,
} from "./httpClient";
export {
  buildWebdavRuntimeConfig,
  type WebdavRuntimeConfig,
} from "./config";
export {
  createTauriHttpFetcher,
  type CreateTauriHttpFetcherOptions,
} from "./tauriHttpFetcher";
export {
  createInMemoryWebdavSecretsStore,
  createPluginStoreWebdavSecretsStore,
  type CreatePluginStoreWebdavSecretsStoreOptions,
  type WebdavSecrets,
  type WebdavSecretsStore,
} from "./secretsStore";
export {
  entityToTask,
  getTaskEntityBridge,
  isSupportedTaskEntityType,
  localChangeToOp,
  schemaVersionForTaskEntity,
  TASK_ENTITY_BRIDGES,
  TASK_ENTITY_TYPE,
  TASK_SCHEMA_VERSION,
  type EntityBridge,
  type LocalChangeToOpOptions,
  type TaskEntityBridge,
  type TaskEntityBridgeKind,
} from "./taskBridge";
export {
  createWebdavTaskSyncRunner,
  type CreateWebdavTaskSyncRunnerOptions,
  type WebdavRunOnceResult,
  type WebdavRunReport,
  type WebdavTaskSyncRunner,
} from "./taskSyncRunner";
export {
  createSnapshotCompactingRunner,
  createWebdavRuntime,
  type CreateSnapshotCompactingRunnerOptions,
  type CreateWebdavRuntimeOptions,
  type WebdavRuntimeResolution,
} from "./runtime";
