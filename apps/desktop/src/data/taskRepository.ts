import type {
  AgentActionDraft,
  AgentActionSource,
  AgentAuditRecord,
  AgentInboxSnapshot,
  AgentPendingAction,
  AgentToolInput,
} from '../agent/actions';
import {
  type BatchTaskOperation,
  type BatchTaskResult,
  type CreateTaskCategoryInput,
  type CreateTaskInput,
  type CreateTaskListInput,
  type ReorderTasksInput,
  type Task,
  type TaskCategory,
  type TaskList,
  type TaskSearchQuery,
  type TaskStatus,
  type TodayTaskGroups,
  type UpdateTaskCategoryInput,
  type UpdateTaskInput,
  type UpdateTaskListInput,
} from '../domain/tasks';
import { LILIATODO_DATABASE_PATH } from './taskRepositorySql';
import {
  createRepositoryContext,
  type DatabaseLoader,
  type EntitySyncVersionRow,
  type LocalChange,
  type LocalChangeEntityType,
  type RecordSyncRunInput,
  type RepositoryOptions,
  type SaveSyncStateInput,
  type SqlDatabase,
  type SyncRun,
  type SyncState,
  type TaskSyncVersionRow,
} from './taskRepositoryCore';
import { createTaskRepositoryAgent } from './taskRepositoryAgent';
import { createTaskRepositoryLists } from './taskRepositoryLists';
import { createTaskRepositorySync } from './taskRepositorySync';
import { createTaskRepositoryTasks } from './taskRepositoryTasks';

export type {
  SqlDatabase,
  LocalChange,
  LocalChangeRow,
  SyncState,
  SaveSyncStateInput,
  SyncStateRow,
  SyncRun,
  RecordSyncRunInput,
  SyncRunRow,
} from './taskRepositoryCore';

export interface TaskRepository {
  databasePath: string;
  init(): Promise<void>;
  findTaskById(id: string): Promise<Task | null>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  setStatus(id: string, status: TaskStatus): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  restoreTask(id: string): Promise<Task>;
  purgeTask(id: string): Promise<void>;
  listTasksByStatus(status: TaskStatus | "deleted"): Promise<Task[]>;
  searchTasks(query: TaskSearchQuery): Promise<Task[]>;
  batchUpdateTasks(input: BatchTaskOperation): Promise<BatchTaskResult>;
  reorderTasks(input: ReorderTasksInput): Promise<Task[]>;
  snoozeReminder(taskId: string, reminderId: string, until: string): Promise<Task>;
  dismissReminder(taskId: string, reminderId: string): Promise<Task>;
  applyRemoteTask(task: Task, remoteVersion?: number): Promise<void>;
  deleteRemoteTask(id: string): Promise<void>;
  applyRemoteList(list: TaskList, remoteVersion?: number): Promise<void>;
  deleteRemoteList(id: string): Promise<void>;
  applyRemoteCategory(category: TaskCategory, remoteVersion?: number): Promise<void>;
  deleteRemoteCategory(id: string): Promise<void>;
  listActiveTasks(): Promise<Task[]>;
  listTasksByList(listId: string): Promise<Task[]>;
  listTaskChildren(parentId: string): Promise<Task[]>;
  listLists(): Promise<TaskList[]>;
  createList(input: CreateTaskListInput): Promise<TaskList>;
  updateList(id: string, patch: UpdateTaskListInput): Promise<TaskList>;
  archiveList(id: string): Promise<TaskList>;
  listCategoriesByList(listId: string): Promise<TaskCategory[]>;
  createCategory(input: CreateTaskCategoryInput): Promise<TaskCategory>;
  updateCategory(id: string, patch: UpdateTaskCategoryInput): Promise<TaskCategory>;
  deleteCategory(id: string): Promise<void>;
  listPendingChanges(): Promise<LocalChange[]>;
  markChangeSynced(id: string, syncedAt?: Date): Promise<void>;
  getSyncState(): Promise<SyncState>;
  saveSyncState(input: SaveSyncStateInput): Promise<SyncState>;
  recordSyncRun(input: RecordSyncRunInput): Promise<SyncRun>;
  listRecentSyncRuns(limit: number): Promise<SyncRun[]>;
  listToday(now: Date): Promise<TodayTaskGroups>;
  listInbox(): Promise<Task[]>;
  listAgenda(start: Date, end: Date): Promise<Task[]>;
  listDueReminders(now: Date): Promise<Task[]>;
  getStats(): Promise<DatabaseStats>;
  createAgentPendingAction(draft: AgentActionDraft): Promise<AgentPendingAction>;
  createAgentPendingActionFromTool(action: AgentToolInput, source: AgentActionSource): Promise<AgentPendingAction>;
  getAgentInboxSnapshot(): Promise<AgentInboxSnapshot>;
  approveAgentPendingAction(id: string): Promise<AgentAuditRecord>;
  rejectAgentPendingAction(id: string, reason?: string | null): Promise<AgentPendingAction>;
  undoAgentAuditBatch(batchId: string): Promise<AgentAuditRecord[]>;
}

export interface DatabaseStats {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  pendingLocalChanges: number;
  databasePath: string;
}

export function createTaskRepository(
  loadDatabase?: DatabaseLoader,
  options: RepositoryOptions = {},
): TaskRepository {
  const ctx = createRepositoryContext(loadDatabase, options);
  const { init, now } = ctx;

  async function selectEntityRemoteVersion(db: SqlDatabase, entityType: LocalChangeEntityType, entityId: string) {
    const rows = await db.select<EntitySyncVersionRow>(
      `SELECT * FROM entity_sync_versions
       WHERE entity_type = $1 AND entity_id = $2
       LIMIT 1`,
      [entityType, entityId],
    );
    let version = rows[0]?.remote_version;
    if (version == null && entityType === 'task') {
      const legacyRows = await db.select<TaskSyncVersionRow>(
        'SELECT * FROM task_sync_versions WHERE task_id = $1 LIMIT 1',
        [entityId],
      );
      version = legacyRows[0]?.remote_version;
    }
    return typeof version === 'number' ? version : null;
  }

  async function upsertEntityRemoteVersion(
    db: SqlDatabase,
    entityType: LocalChangeEntityType,
    entityId: string,
    remoteVersion: number | undefined,
  ) {
    if (typeof remoteVersion !== 'number') return;
    await db.execute(
      `INSERT INTO entity_sync_versions (
        entity_type, entity_id, remote_version, updated_at
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        remote_version = excluded.remote_version,
        updated_at = excluded.updated_at`,
      [entityType, entityId, remoteVersion, now().toISOString()],
    );
  }

  async function deleteEntityRemoteVersion(db: SqlDatabase, entityType: LocalChangeEntityType, entityId: string) {
    await db.execute('DELETE FROM entity_sync_versions WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
  }

  async function withBaseVersion(
    db: SqlDatabase,
    entityType: LocalChangeEntityType,
    entityId: string,
    payload: Record<string, unknown>,
  ) {
    const baseVersion = await selectEntityRemoteVersion(db, entityType, entityId);
    return baseVersion == null ? payload : { id: entityId, baseVersion, ...payload };
  }

  let repository!: TaskRepository;
  const agentMethods = createTaskRepositoryAgent(ctx, () => repository);
  const taskMethods = createTaskRepositoryTasks(ctx, {
    withBaseVersion,
    upsertEntityRemoteVersion,
    deleteEntityRemoteVersion,
    repository: () => repository,
  });
  const listMethods = createTaskRepositoryLists(ctx, {
    withBaseVersion,
    upsertEntityRemoteVersion,
    deleteEntityRemoteVersion,
  });
  const syncMethods = createTaskRepositorySync(ctx);

  repository = {
    databasePath: LILIATODO_DATABASE_PATH,
    init,
    ...taskMethods,

    ...listMethods,

    ...syncMethods,

    ...agentMethods,
  };

  return repository;
}
