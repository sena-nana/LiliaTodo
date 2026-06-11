import Database from '@tauri-apps/plugin-sql';
import {
  createAgentActionDraft,
  type AgentActionDraft,
  type AgentActionSource,
  type AgentActionType,
  type AgentAuditRecord,
  type AgentAuditStatus,
  type AgentInboxSnapshot,
  type AgentPendingAction,
  type AgentPendingActionStatus,
  type AgentRiskLevel,
  type AgentToolInput,
} from '../agent/actions';
import { executeAgentAction, undoAgentAction } from '../agent/executor';
import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  getDayBounds,
  groupTodayTasks,
  mapTaskCategoryRow,
  mapTaskListRow,
  mapTaskRow,
  normalizeCreateTaskCategoryInput,
  normalizeCreateTaskInput,
  normalizeCreateTaskListInput,
  normalizeUpdateTaskCategoryInput,
  normalizeUpdateTaskInput,
  normalizeUpdateTaskListInput,
  taskHasDueReminder,
  type BatchTaskOperation,
  type BatchTaskResult,
  type CreateTaskCategoryInput,
  type CreateTaskInput,
  type CreateTaskListInput,
  type ReorderTasksInput,
  type Task,
  type TaskCategory,
  type TaskCategoryRow,
  type TaskList,
  type TaskListRow,
  type TaskRow,
  type TaskSearchQuery,
  type TaskStatus,
  type TodayTaskGroups,
  type UpdateTaskCategoryInput,
  type UpdateTaskInput,
  type UpdateTaskListInput,
} from '../domain/tasks';
import {
  INSERT_TASK_LIST_SQL,
  INSERT_TASK_CATEGORY_SQL,
  INSERT_TASK_SQL,
  LILIATODO_DATABASE_PATH,
  SCHEMA,
  SYNC_STATE_ID,
  appendUpdate,
  ensureDefaultList,
  runTaskMigrations,
  taskCategoryParams,
  taskCategorySyncPatch,
  taskCategorySyncPayload,
  taskListParams,
  taskListSyncPatch,
  taskListSyncPayload,
  taskParams,
} from './taskRepositorySql';
import {
  emptySyncState,
  mapLocalChangeRow,
  mapSyncRunRow,
  mapSyncStateRow,
} from './taskRepositoryRows';

export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

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

export type LocalChangeAction =
  | 'task.create'
  | 'task.update'
  | 'task.status'
  | 'task.delete'
  | 'taskList.create'
  | 'taskList.update'
  | 'taskList.archive'
  | 'taskList.delete'
  | 'taskCategory.create'
  | 'taskCategory.update'
  | 'taskCategory.delete';

export type LocalChangeEntityType = 'task' | 'taskList' | 'taskCategory';

export interface LocalChange {
  id: string;
  entityType: LocalChangeEntityType;
  entityId: string;
  action: LocalChangeAction;
  payload: unknown;
  createdAt: string;
  syncedAt: string | null;
}

export interface LocalChangeRow {
  id: string;
  entity_type: LocalChangeEntityType;
  entity_id: string;
  action: LocalChangeAction;
  payload: string;
  created_at: string;
  synced_at: string | null;
}

export interface EntitySyncVersionRow {
  entity_type: LocalChangeEntityType;
  entity_id: string;
  remote_version: number;
  updated_at: string;
}

export interface TaskSyncVersionRow {
  task_id: string;
  remote_version: number;
  updated_at: string;
}

export interface SyncState {
  serverCursor: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export interface SaveSyncStateInput {
  serverCursor: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SyncStateRow {
  id: string;
  server_cursor: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export type SyncRunStatus = 'succeeded' | 'failed';

export interface SyncRun {
  id: string;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string;
  message: string;
  serverCursor: string | null;
}

export interface RecordSyncRunInput {
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string;
  message: string;
  serverCursor: string | null;
}

export interface SyncRunRow {
  id: string;
  status: SyncRunStatus;
  started_at: string;
  finished_at: string;
  message: string;
  server_cursor: string | null;
}

export interface DatabaseStats {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  pendingLocalChanges: number;
  databasePath: string;
}

interface AgentPendingActionRow {
  id: string;
  action_type: AgentActionType;
  status: AgentPendingActionStatus;
  summary: string;
  risk: AgentRiskLevel;
  source: string;
  payload: string;
  dry_run: string;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  audit_batch_id: string | null;
  error: string | null;
}

interface AgentAuditRecordRow {
  id: string;
  batch_id: string;
  action_id: string;
  action_type: AgentActionType;
  action_payload?: string;
  summary: string;
  status: AgentAuditStatus;
  reversible: number | boolean;
  before_payload: string;
  after_payload: string;
  source: string;
  error: string | null;
  created_at: string;
  undone_at: string | null;
}

interface RepositoryOptions {
  now?: () => Date;
  id?: () => string;
  changeId?: () => string;
  syncRunId?: () => string;
}

type DatabaseLoader = (path: string) => Promise<SqlDatabase>;

export function createTaskRepository(
  loadDatabase: DatabaseLoader = (path) => Database.load(path),
  options: RepositoryOptions = {},
): TaskRepository {
  let dbPromise: Promise<SqlDatabase> | null = null;
  let initialized = false;
  const now = options.now ?? (() => new Date());
  const id = options.id ?? createId;
  const changeId = options.changeId ?? createId;
  const syncRunId = options.syncRunId ?? createId;

  async function getDb() {
    dbPromise ??= loadDatabase(LILIATODO_DATABASE_PATH);
    return dbPromise;
  }

  async function init() {
    if (initialized) return;
    const db = await getDb();
    for (const statement of SCHEMA) {
      await db.execute(statement);
    }
    await runTaskMigrations(db);
    await ensureDefaultList(db, now().toISOString());
    initialized = true;
  }

  async function selectTask(taskId: string) {
    const db = await getDb();
    const rows = await db.select<TaskRow>('SELECT * FROM tasks WHERE id = $1 LIMIT 1', [taskId]);
    const row = rows[0];
    if (!row) {
      throw new Error('任务不存在');
    }
    return mapTaskRow(row);
  }

  async function createNextRecurringTask(db: SqlDatabase, task: Task, timestamp: string) {
    if (!task.recurrence?.enabled) return null;
    const nextDueAt = shiftIso(task.dueAt, task.recurrence);
    const nextStartAt = shiftIso(task.startAt, task.recurrence);
    const nextTask: Task = {
      ...task,
      id: id(),
      status: 'active',
      startAt: nextStartAt,
      dueAt: nextDueAt,
      reminders: task.reminders.map((reminder) => ({
        ...reminder,
        triggerAt: shiftIso(reminder.triggerAt, task.recurrence!) ?? reminder.triggerAt,
        status: 'pending',
      })),
      completedAt: null,
      deletedAt: null,
      lastReminderNotifiedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.execute(INSERT_TASK_SQL, taskParams(nextTask));
    await recordLocalChange(db, 'task', nextTask.id, 'task.create', nextTask, timestamp);
    return nextTask;
  }

  function filterTasks(tasks: Task[], query: TaskSearchQuery) {
    const needle = query.text?.trim().toLowerCase() ?? '';
    const statuses = query.statuses?.length ? new Set(query.statuses) : null;
    const priorities = query.priorities?.length ? new Set(query.priorities) : null;
    const tags = query.tags?.length ? new Set(query.tags.map((tag) => tag.trim()).filter(Boolean)) : null;
    const fromTime = query.timeFrom ? new Date(query.timeFrom).getTime() : null;
    const toTime = query.timeTo ? new Date(query.timeTo).getTime() : null;

    return tasks.filter((task) => {
      if (!query.includeDeleted && task.deletedAt) return false;
      if (needle) {
        const haystack = [task.title, task.notes ?? '', task.tags.join(' ')].join('\n').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (tags && ![...tags].every((tag) => task.tags.includes(tag))) return false;
      if (query.listId && task.listId !== query.listId) return false;
      if (query.categoryId && task.categoryId !== query.categoryId) return false;
      if (statuses && !statuses.has(task.status)) return false;
      if (priorities && !priorities.has(task.priority)) return false;
      if (fromTime != null || toTime != null) {
        const target = task.startAt ?? task.dueAt ?? task.completedAt ?? task.createdAt;
        const time = new Date(target).getTime();
        if (fromTime != null && time < fromTime) return false;
        if (toTime != null && time > toTime) return false;
      }
      if (query.reminderStatus) {
        const hasReminders = task.reminders.length > 0;
        const nowTime = now().getTime();
        if (query.reminderStatus === 'none' && hasReminders) return false;
        if (query.reminderStatus === 'pending' && !task.reminders.some((item) => item.status === 'pending')) return false;
        if (query.reminderStatus === 'due' && !task.reminders.some((item) => item.status === 'pending' && new Date(item.triggerAt).getTime() <= nowTime)) return false;
        if (query.reminderStatus === 'fired' && !task.reminders.some((item) => item.status === 'fired')) return false;
        if (query.reminderStatus === 'dismissed' && !task.reminders.some((item) => item.status === 'dismissed')) return false;
      }
      return true;
    });
  }

  async function findTaskById(taskId: string) {
    await init();
    const db = await getDb();
    const rows = await db.select<TaskRow>('SELECT * FROM tasks WHERE id = $1 LIMIT 1', [taskId]);
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  async function selectPendingAction(actionId: string) {
    const db = await getDb();
    const rows = await db.select<AgentPendingActionRow>(
      'SELECT * FROM agent_pending_actions WHERE id = $1 LIMIT 1',
      [actionId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Agent 待确认操作不存在');
    }
    return mapAgentPendingActionRow(row);
  }

  async function insertAgentAuditRecord(
    action: AgentPendingAction,
    execution: Awaited<ReturnType<typeof executeAgentAction>>,
    batchId: string,
    createdAt: string,
  ) {
    const db = await getDb();
    const audit: AgentAuditRecord = {
      id: id(),
      batchId,
      actionId: action.id,
      actionType: action.actionType,
      payload: action.payload,
      summary: action.summary,
      status: 'applied',
      reversible: execution.reversible,
      before: execution.before,
      after: execution.after,
      source: action.source,
      error: null,
      createdAt,
      undoneAt: null,
    };
    await db.execute(
      `INSERT INTO agent_audit_records (
        id, batch_id, action_id, action_type, action_payload, summary, status, reversible,
        before_payload, after_payload, source, error, created_at, undone_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        audit.id,
        audit.batchId,
        audit.actionId,
        audit.actionType,
        JSON.stringify(action.payload),
        audit.summary,
        audit.status,
        audit.reversible ? 1 : 0,
        JSON.stringify(audit.before),
        JSON.stringify(audit.after),
        JSON.stringify(audit.source),
        audit.error,
        audit.createdAt,
        audit.undoneAt,
      ],
    );
    return audit;
  }

  async function selectList(listId: string) {
    const db = await getDb();
    const rows = await db.select<TaskListRow>('SELECT * FROM task_lists WHERE id = $1 LIMIT 1', [listId]);
    const row = rows[0];
    if (!row) {
      throw new Error('清单不存在');
    }
    return mapTaskListRow(row);
  }

  async function selectCategory(categoryId: string) {
    const db = await getDb();
    const rows = await db.select<TaskCategoryRow>('SELECT * FROM task_categories WHERE id = $1 LIMIT 1', [categoryId]);
    const row = rows[0];
    if (!row) {
      throw new Error('分类不存在');
    }
    return mapTaskCategoryRow(row);
  }

  async function ensureCategoryExists(db: SqlDatabase, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const rows = await db.select<TaskCategoryRow>('SELECT * FROM task_categories WHERE id = $1 LIMIT 1', [categoryId]);
    if (rows.length === 0) {
      throw new Error('分类不存在');
    }
  }

  async function ensureListExists(db: SqlDatabase, listId: string, timestamp = now().toISOString()) {
    const rows = await db.select<TaskListRow>('SELECT * FROM task_lists WHERE id = $1 LIMIT 1', [listId]);
    if (rows.length > 0) return;
    await db.execute(
      `INSERT INTO task_lists (
        id, name, color, archived, list_order, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [listId, listId === DEFAULT_TASK_LIST_ID ? DEFAULT_TASK_LIST_NAME : '未命名清单', null, 0, 0, timestamp, timestamp],
    );
  }

  async function recordLocalChange(
    db: SqlDatabase,
    entityType: LocalChangeEntityType,
    entityId: string,
    action: LocalChangeAction,
    payload: unknown,
    createdAt = now().toISOString(),
  ) {
    await db.execute(
      `INSERT INTO local_changes (
        id, entity_type, entity_id, action, payload, created_at, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [changeId(), entityType, entityId, action, JSON.stringify(payload), createdAt, null],
    );
  }

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

  async function assertValidParent(db: SqlDatabase, taskId: string, parentId: string | null | undefined) {
    if (!parentId) return;
    if (parentId === taskId) {
      throw new Error('父任务不能是当前任务或其子任务');
    }
    let currentParentId: string | null = parentId;
    const visited = new Set<string>();
    while (currentParentId) {
      if (visited.has(currentParentId)) {
        throw new Error('父任务关系不能形成循环');
      }
      visited.add(currentParentId);
      if (currentParentId === taskId) {
        throw new Error('父任务不能是当前任务或其子任务');
      }
      const parentRows: Array<{ parent_id: string | null }> = await db.select(
        'SELECT parent_id FROM tasks WHERE id = $1 LIMIT 1',
        [currentParentId],
      );
      currentParentId = parentRows[0]?.parent_id ?? null;
    }
  }

  async function assertCanCompleteTask(db: SqlDatabase, taskId: string) {
    const childRows = await db.select<{ id: string }>(
      `SELECT id FROM tasks
       WHERE parent_id = $1 AND status = 'active'
         AND deleted_at IS NULL
       LIMIT 1`,
      [taskId],
    );
    if (childRows.some((row) => row.id !== taskId)) {
      throw new Error('还有未完成的子任务或检查项');
    }
    const task = await selectTask(taskId);
    if (task.checklist.some((item) => !item.done)) {
      throw new Error('还有未完成的子任务或检查项');
    }
  }

  async function listTasksByList(listId: string) {
    await init();
    const db = await getDb();
    const rows = await db.select<TaskRow>(
      `SELECT * FROM tasks
       WHERE status = 'active' AND deleted_at IS NULL AND list_id = $1
       ORDER BY child_order ASC, COALESCE(start_at, due_at, created_at) ASC, priority DESC`,
      [listId],
    );
    return rows.map(mapTaskRow);
  }

  async function listActiveTasks() {
    await init();
    const db = await getDb();
    const rows = await db.select<TaskRow>(
      `SELECT * FROM tasks
       WHERE status = 'active' AND deleted_at IS NULL
       ORDER BY child_order ASC, COALESCE(start_at, due_at, created_at) ASC, priority DESC`,
    );
    return rows.map(mapTaskRow);
  }

  return {
    databasePath: LILIATODO_DATABASE_PATH,
    init,
    findTaskById,

    async createTask(input) {
      await init();
      const normalized = normalizeCreateTaskInput(input);
      const timestamp = now().toISOString();
      const task: Task = {
        id: id(),
        title: normalized.title,
        notes: normalized.notes,
        status: 'active',
        priority: normalized.priority,
        startAt: normalized.startAt,
        dueAt: normalized.dueAt,
        estimateMin: normalized.estimateMin,
        resources: normalized.resources,
        reminders: normalized.reminders,
        checklist: normalized.checklist,
        parentId: normalized.parentId,
        childOrder: normalized.childOrder,
        tags: normalized.tags,
        listId: normalized.listId,
        categoryId: normalized.categoryId,
        recurrence: normalized.recurrence ?? null,
        deletedAt: normalized.deletedAt ?? null,
        lastReminderNotifiedAt: normalized.lastReminderNotifiedAt ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };

      const db = await getDb();
      await ensureListExists(db, task.listId, timestamp);
      await ensureCategoryExists(db, task.categoryId);
      await assertValidParent(db, task.id, task.parentId);
      await db.execute(INSERT_TASK_SQL, taskParams(task));
      await recordLocalChange(db, 'task', task.id, 'task.create', task, timestamp);
      return task;
    },

    async updateTask(taskId, patch) {
      await init();
      const normalized = normalizeUpdateTaskInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];

      appendUpdate(updates, values, 'title', normalized.title);
      appendUpdate(updates, values, 'notes', normalized.notes);
      appendUpdate(updates, values, 'priority', normalized.priority);
      appendUpdate(updates, values, 'start_at', normalized.startAt);
      appendUpdate(updates, values, 'due_at', normalized.dueAt);
      appendUpdate(updates, values, 'estimate_min', normalized.estimateMin);
      if ('resources' in normalized) appendUpdate(updates, values, 'resources', JSON.stringify(normalized.resources));
      if ('reminders' in normalized) appendUpdate(updates, values, 'reminders', JSON.stringify(normalized.reminders));
      if ('checklist' in normalized) appendUpdate(updates, values, 'checklist', JSON.stringify(normalized.checklist));
      appendUpdate(updates, values, 'parent_id', normalized.parentId);
      appendUpdate(updates, values, 'child_order', normalized.childOrder);
      if ('tags' in normalized) appendUpdate(updates, values, 'tags', JSON.stringify(normalized.tags));
      appendUpdate(updates, values, 'list_id', normalized.listId);
      appendUpdate(updates, values, 'category_id', normalized.categoryId);
      if ('recurrence' in normalized) appendUpdate(updates, values, 'recurrence', normalized.recurrence ? JSON.stringify(normalized.recurrence) : null);
      appendUpdate(updates, values, 'deleted_at', normalized.deletedAt);
      appendUpdate(updates, values, 'last_reminder_notified_at', normalized.lastReminderNotifiedAt);

      if (updates.length > 0) {
        const timestamp = now().toISOString();
        const db = await getDb();
        if (normalized.listId) {
          await ensureListExists(db, normalized.listId, timestamp);
        }
        if ('categoryId' in normalized) {
          await ensureCategoryExists(db, normalized.categoryId);
        }
        if ('parentId' in normalized) {
          await assertValidParent(db, taskId, normalized.parentId);
        }
        appendUpdate(updates, values, 'updated_at', timestamp);
        values.push(taskId);
        await db.execute(`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
        await recordLocalChange(
          db,
          'task',
          taskId,
          'task.update',
          await withBaseVersion(db, 'task', taskId, { id: taskId, patch: normalized, updatedAt: timestamp }),
          timestamp,
        );
      }

      return selectTask(taskId);
    },

    async setStatus(taskId, status) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      if (status === 'completed') {
        await assertCanCompleteTask(db, taskId);
      }
      const completedAt = status === 'completed' ? timestamp : null;
      await db.execute(
        'UPDATE tasks SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4',
        [status, completedAt, timestamp, taskId],
      );
      await recordLocalChange(
        db,
        'task',
        taskId,
        'task.status',
        await withBaseVersion(db, 'task', taskId, { id: taskId, status, completedAt, updatedAt: timestamp }),
        timestamp,
      );
      const task = await selectTask(taskId);
      if (status === 'completed' && task.recurrence) {
        await createNextRecurringTask(db, task, timestamp);
      }
      return task;
    },

    async deleteTask(taskId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('UPDATE tasks SET deleted_at = $1, updated_at = $2 WHERE id = $3', [timestamp, timestamp, taskId]);
      await recordLocalChange(
        db,
        'task',
        taskId,
        'task.update',
        await withBaseVersion(db, 'task', taskId, { id: taskId, patch: { deletedAt: timestamp }, updatedAt: timestamp }),
        timestamp,
      );
    },

    async restoreTask(taskId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('UPDATE tasks SET deleted_at = $1, updated_at = $2 WHERE id = $3', [null, timestamp, taskId]);
      await recordLocalChange(
        db,
        'task',
        taskId,
        'task.update',
        await withBaseVersion(db, 'task', taskId, { id: taskId, patch: { deletedAt: null }, updatedAt: timestamp }),
        timestamp,
      );
      return selectTask(taskId);
    },

    async purgeTask(taskId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('DELETE FROM tasks WHERE id = $1', [taskId]);
      await recordLocalChange(db, 'task', taskId, 'task.delete', await withBaseVersion(db, 'task', taskId, { id: taskId }), timestamp);
    },

    async listTasksByStatus(status) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        status === 'deleted'
          ? `SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, updated_at DESC`
          : `SELECT * FROM tasks WHERE status = $1 AND deleted_at IS NULL ORDER BY COALESCE(completed_at, updated_at, created_at) DESC`,
        status === 'deleted' ? [] : [status],
      );
      return rows.map(mapTaskRow);
    },

    async searchTasks(query) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks ORDER BY COALESCE(start_at, due_at, completed_at, updated_at, created_at) DESC`,
      );
      return filterTasks(rows.map(mapTaskRow), query);
    },

    async batchUpdateTasks(input) {
      await init();
      const taskIds = [...new Set(input.taskIds)].filter(Boolean);
      const result: BatchTaskResult = { succeeded: [], failed: [] };
      for (const taskId of taskIds) {
        try {
          if (input.type === 'complete') {
            await this.setStatus(taskId, 'completed');
          } else if (input.type === 'reschedule') {
            await this.updateTask(taskId, { startAt: input.startAt ?? null, dueAt: input.dueAt ?? null });
          } else if (input.type === 'move') {
            await this.updateTask(taskId, { listId: input.listId, categoryId: input.categoryId ?? null });
          } else if (input.type === 'tag') {
            const current = await selectTask(taskId);
            const nextTags = input.mode === 'merge'
              ? [...new Set([...current.tags, ...input.tags])]
              : input.tags;
            await this.updateTask(taskId, { tags: nextTags });
          } else if (input.type === 'delete') {
            await this.deleteTask(taskId);
          }
          result.succeeded.push(taskId);
        } catch (error) {
          result.failed.push({ id: taskId, error: readableError(error) });
        }
      }
      return result;
    },

    async reorderTasks(input) {
      await init();
      const tasks: Task[] = [];
      for (const [order, taskId] of input.taskIds.entries()) {
        tasks.push(await this.updateTask(taskId, {
          childOrder: order,
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.listId ? { listId: input.listId } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        }));
      }
      return tasks;
    },

    async snoozeReminder(taskId, reminderId, until) {
      const task = await selectTask(taskId);
      return this.updateTask(taskId, {
        reminders: task.reminders.map((reminder) =>
          reminder.id === reminderId
            ? { ...reminder, triggerAt: new Date(until).toISOString(), status: 'pending' }
            : reminder,
        ),
        lastReminderNotifiedAt: null,
      });
    },

    async dismissReminder(taskId, reminderId) {
      const task = await selectTask(taskId);
      return this.updateTask(taskId, {
        reminders: task.reminders.map((reminder) =>
          reminder.id === reminderId ? { ...reminder, status: 'dismissed' } : reminder,
        ),
        lastReminderNotifiedAt: now().toISOString(),
      });
    },

    async applyRemoteTask(task, remoteVersion) {
      await init();
      const db = await getDb();
      await ensureListExists(db, task.listId);
      await ensureCategoryExists(db, task.categoryId);
      await assertValidParent(db, task.id, task.parentId);
      await db.execute(
        `${INSERT_TASK_SQL}
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          notes = excluded.notes,
          status = excluded.status,
          priority = excluded.priority,
          start_at = excluded.start_at,
          due_at = excluded.due_at,
          estimate_min = excluded.estimate_min,
          resources = excluded.resources,
          reminders = excluded.reminders,
          checklist = excluded.checklist,
          parent_id = excluded.parent_id,
          child_order = excluded.child_order,
          tags = excluded.tags,
          list_id = excluded.list_id,
          category_id = excluded.category_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at`,
        taskParams(task),
      );
      await upsertEntityRemoteVersion(db, 'task', task.id, remoteVersion);
    },

    async deleteRemoteTask(taskId) {
      await init();
      const db = await getDb();
      await db.execute('DELETE FROM tasks WHERE id = $1', [taskId]);
      await deleteEntityRemoteVersion(db, 'task', taskId);
    },

    async applyRemoteList(list, remoteVersion) {
      await init();
      if (list.id === DEFAULT_TASK_LIST_ID && (list.archived || list.name !== DEFAULT_TASK_LIST_NAME)) {
        throw new Error('默认收件箱不能重命名或归档');
      }
      const db = await getDb();
      await db.execute(
        `${INSERT_TASK_LIST_SQL}
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          color = excluded.color,
          archived = excluded.archived,
          list_order = excluded.list_order,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
        taskListParams(list),
      );
      if (list.archived && list.id !== DEFAULT_TASK_LIST_ID) {
        await db.execute('UPDATE tasks SET list_id = $1, category_id = $2, updated_at = $3 WHERE list_id = $4', [
          DEFAULT_TASK_LIST_ID,
          null,
          list.updatedAt,
          list.id,
        ]);
      }
      await upsertEntityRemoteVersion(db, 'taskList', list.id, remoteVersion);
      await ensureDefaultList(db, now().toISOString());
    },

    async deleteRemoteList(listId) {
      await init();
      if (listId === DEFAULT_TASK_LIST_ID) {
        await ensureDefaultList(await getDb(), now().toISOString());
        return;
      }
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('UPDATE task_lists SET archived = $1, updated_at = $2 WHERE id = $3', [1, timestamp, listId]);
      await db.execute('UPDATE tasks SET list_id = $1, category_id = $2, updated_at = $3 WHERE list_id = $4', [DEFAULT_TASK_LIST_ID, null, timestamp, listId]);
      await deleteEntityRemoteVersion(db, 'taskList', listId);
    },

    async applyRemoteCategory(category, remoteVersion) {
      await init();
      const db = await getDb();
      await ensureListExists(db, category.listId);
      await db.execute(
        `${INSERT_TASK_CATEGORY_SQL}
        ON CONFLICT(id) DO UPDATE SET
          list_id = excluded.list_id,
          name = excluded.name,
          category_order = excluded.category_order,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
        taskCategoryParams(category),
      );
      await upsertEntityRemoteVersion(db, 'taskCategory', category.id, remoteVersion);
    },

    async deleteRemoteCategory(categoryId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('UPDATE tasks SET category_id = $1, updated_at = $2 WHERE category_id = $3', [null, timestamp, categoryId]);
      await db.execute('DELETE FROM task_categories WHERE id = $1', [categoryId]);
      await deleteEntityRemoteVersion(db, 'taskCategory', categoryId);
    },

    listActiveTasks,
    listTasksByList,

    async listTaskChildren(parentId) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE status != 'archived' AND deleted_at IS NULL AND parent_id = $1
         ORDER BY child_order ASC, COALESCE(start_at, due_at, created_at) ASC`,
        [parentId],
      );
      return rows.map(mapTaskRow);
    },

    async listLists() {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskListRow>(
        `SELECT * FROM task_lists
         WHERE archived = 0
         ORDER BY list_order ASC, created_at ASC`,
      );
      return rows.map(mapTaskListRow);
    },

    async createList(input) {
      await init();
      const normalized = normalizeCreateTaskListInput(input);
      const timestamp = now().toISOString();
      const list: TaskList = {
        id: id(),
        name: normalized.name,
        color: normalized.color,
        archived: false,
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const db = await getDb();
      await db.execute(INSERT_TASK_LIST_SQL, taskListParams(list));
      await recordLocalChange(db, 'taskList', list.id, 'taskList.create', taskListSyncPayload(list), timestamp);
      return list;
    },

    async updateList(listId, patch) {
      await init();
      if (listId === DEFAULT_TASK_LIST_ID) {
        if (patch.name && patch.name.trim() !== DEFAULT_TASK_LIST_NAME) {
          throw new Error('默认收件箱不能重命名');
        }
        if ('order' in patch) {
          throw new Error('默认收件箱不能移动');
        }
      }
      const normalized = normalizeUpdateTaskListInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];
      appendUpdate(updates, values, 'name', normalized.name);
      appendUpdate(updates, values, 'color', normalized.color);
      appendUpdate(updates, values, 'list_order', normalized.order);
      if (updates.length > 0) {
        const timestamp = now().toISOString();
        appendUpdate(updates, values, 'updated_at', timestamp);
        values.push(listId);
        const db = await getDb();
        await db.execute(`UPDATE task_lists SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
        const syncPatch = taskListSyncPatch(normalized);
        if (Object.keys(syncPatch).length > 0) {
          await recordLocalChange(
            db,
            'taskList',
            listId,
            'taskList.update',
            await withBaseVersion(db, 'taskList', listId, { id: listId, patch: syncPatch, updatedAt: timestamp }),
            timestamp,
          );
        }
      }
      return selectList(listId);
    },

    async archiveList(listId) {
      await init();
      if (listId === DEFAULT_TASK_LIST_ID) {
        throw new Error('默认收件箱不能归档');
      }
      const timestamp = now().toISOString();
      const db = await getDb();
      const affectedRows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE list_id = $1`,
        [listId],
      );
      await db.execute('UPDATE task_lists SET archived = $1, updated_at = $2 WHERE id = $3', [1, timestamp, listId]);
      await db.execute('UPDATE tasks SET list_id = $1, category_id = $2, updated_at = $3 WHERE list_id = $4', [DEFAULT_TASK_LIST_ID, null, timestamp, listId]);
      await recordLocalChange(
        db,
        'taskList',
        listId,
        'taskList.archive',
        await withBaseVersion(db, 'taskList', listId, { id: listId, archived: true, updatedAt: timestamp }),
        timestamp,
      );
      for (const row of affectedRows) {
        await recordLocalChange(
          db,
          'task',
          row.id,
          'task.update',
          await withBaseVersion(db, 'task', row.id, {
            id: row.id,
            patch: { listId: DEFAULT_TASK_LIST_ID, categoryId: null },
            updatedAt: timestamp,
          }),
          timestamp,
        );
      }
      return selectList(listId);
    },

    async listCategoriesByList(listId) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskCategoryRow>(
        `SELECT * FROM task_categories
         WHERE list_id = $1
         ORDER BY category_order ASC, created_at ASC`,
        [listId],
      );
      return rows.map(mapTaskCategoryRow);
    },

    async createCategory(input) {
      await init();
      const normalized = normalizeCreateTaskCategoryInput(input);
      const timestamp = now().toISOString();
      const category: TaskCategory = {
        id: id(),
        listId: normalized.listId,
        name: normalized.name,
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const db = await getDb();
      await ensureListExists(db, category.listId, timestamp);
      await db.execute(INSERT_TASK_CATEGORY_SQL, taskCategoryParams(category));
      await recordLocalChange(db, 'taskCategory', category.id, 'taskCategory.create', taskCategorySyncPayload(category), timestamp);
      return category;
    },

    async updateCategory(categoryId, patch) {
      await init();
      const normalized = normalizeUpdateTaskCategoryInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];
      appendUpdate(updates, values, 'name', normalized.name);
      appendUpdate(updates, values, 'category_order', normalized.order);
      if (updates.length > 0) {
        const timestamp = now().toISOString();
        appendUpdate(updates, values, 'updated_at', timestamp);
        values.push(categoryId);
        const db = await getDb();
        await db.execute(`UPDATE task_categories SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
        const syncPatch = taskCategorySyncPatch(normalized);
        if (Object.keys(syncPatch).length > 0) {
          await recordLocalChange(
            db,
            'taskCategory',
            categoryId,
            'taskCategory.update',
            await withBaseVersion(db, 'taskCategory', categoryId, { id: categoryId, patch: syncPatch, updatedAt: timestamp }),
            timestamp,
          );
        }
      }
      return selectCategory(categoryId);
    },

    async deleteCategory(categoryId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('UPDATE tasks SET category_id = $1, updated_at = $2 WHERE category_id = $3', [null, timestamp, categoryId]);
      await db.execute('DELETE FROM task_categories WHERE id = $1', [categoryId]);
      await recordLocalChange(
        db,
        'taskCategory',
        categoryId,
        'taskCategory.delete',
        await withBaseVersion(db, 'taskCategory', categoryId, { id: categoryId }),
        timestamp,
      );
    },

    async listPendingChanges() {
      await init();
      const db = await getDb();
      const rows = await db.select<LocalChangeRow>(
        `SELECT * FROM local_changes
         WHERE synced_at IS NULL
         ORDER BY created_at ASC`,
      );
      return rows.map(mapLocalChangeRow);
    },

    async markChangeSynced(changeIdToMark, syncedAt = now()) {
      await init();
      const db = await getDb();
      await db.execute('UPDATE local_changes SET synced_at = $1 WHERE id = $2', [syncedAt.toISOString(), changeIdToMark]);
    },

    async getSyncState() {
      await init();
      const db = await getDb();
      const rows = await db.select<SyncStateRow>('SELECT * FROM sync_state WHERE id = $1 LIMIT 1', [SYNC_STATE_ID]);
      return rows[0] ? mapSyncStateRow(rows[0]) : emptySyncState();
    },

    async saveSyncState(input) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute(
        `INSERT INTO sync_state (
          id, server_cursor, last_synced_at, last_error, updated_at
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(id) DO UPDATE SET
          server_cursor = excluded.server_cursor,
          last_synced_at = excluded.last_synced_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`,
        [SYNC_STATE_ID, input.serverCursor, input.lastSyncedAt, input.lastError, timestamp],
      );
      return { ...input, updatedAt: timestamp };
    },

    async recordSyncRun(input) {
      await init();
      const run: SyncRun = { id: syncRunId(), ...input };
      const db = await getDb();
      await db.execute(
        `INSERT INTO sync_runs (
          id, status, started_at, finished_at, message, server_cursor
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [run.id, run.status, run.startedAt, run.finishedAt, run.message, run.serverCursor],
      );
      return run;
    },

    async listRecentSyncRuns(limit) {
      await init();
      const normalizedLimit = Math.max(0, Math.floor(limit));
      if (normalizedLimit === 0) return [];
      const db = await getDb();
      const rows = await db.select<SyncRunRow>(
        `SELECT * FROM sync_runs
         ORDER BY started_at DESC
         LIMIT $1`,
        [normalizedLimit],
      );
      return rows.map(mapSyncRunRow);
    },

    async listToday(currentDate) {
      await init();
      const { start, end } = getDayBounds(currentDate);
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE (status = 'active' AND deleted_at IS NULL AND (
              (due_at IS NOT NULL AND due_at <= $1)
              OR (start_at IS NOT NULL AND start_at >= $2 AND start_at <= $1)
            ))
            OR (status = 'completed' AND deleted_at IS NULL AND completed_at >= $2 AND completed_at <= $1)
         ORDER BY COALESCE(start_at, due_at, completed_at, created_at), priority DESC`,
        [end.toISOString(), start.toISOString()],
      );
      return groupTodayTasks(rows.map(mapTaskRow), currentDate);
    },

    async listInbox() {
      return listTasksByList(DEFAULT_TASK_LIST_ID);
    },

    async listAgenda(start, end) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE status != 'archived' AND deleted_at IS NULL
           AND (
             (start_at IS NOT NULL AND start_at >= $1 AND start_at <= $2)
             OR (due_at IS NOT NULL AND due_at >= $1 AND due_at <= $2)
           )
         ORDER BY COALESCE(start_at, due_at) ASC, priority DESC`,
        [start.toISOString(), end.toISOString()],
      );
      return rows.map(mapTaskRow);
    },

    async listDueReminders(currentDate) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE status = 'active' AND deleted_at IS NULL AND reminders != '[]'
         ORDER BY COALESCE(start_at, due_at, created_at), priority DESC`,
      );
      return rows.map(mapTaskRow).filter((task) => taskHasDueReminder(task, currentDate));
    },

    async getStats() {
      await init();
      const db = await getDb();
      const rows = await db.select<{
        total_tasks: number;
        active_tasks: number;
        completed_tasks: number;
        pending_local_changes: number;
      }>(
        `SELECT
          COUNT(*) AS total_tasks,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_tasks,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks,
          (
            SELECT COUNT(*)
            FROM local_changes
            WHERE synced_at IS NULL
          ) AS pending_local_changes
         FROM tasks`,
      );
      const stats = rows[0] ?? { total_tasks: 0, active_tasks: 0, completed_tasks: 0, pending_local_changes: 0 };
      return {
        totalTasks: Number(stats.total_tasks ?? 0),
        activeTasks: Number(stats.active_tasks ?? 0),
        completedTasks: Number(stats.completed_tasks ?? 0),
        pendingLocalChanges: Number(stats.pending_local_changes ?? 0),
        databasePath: LILIATODO_DATABASE_PATH,
      };
    },

    async createAgentPendingAction(draft) {
      await init();
      const timestamp = now().toISOString();
      const action: AgentPendingAction = {
        id: id(),
        actionType: draft.action.type,
        status: 'pending',
        summary: draft.summary,
        risk: draft.risk,
        source: draft.source,
        payload: draft.action,
        dryRun: draft.dryRun,
        createdAt: timestamp,
        decidedAt: null,
        decisionReason: null,
        auditBatchId: null,
        error: null,
      };
      const db = await getDb();
      await db.execute(
        `INSERT INTO agent_pending_actions (
          id, action_type, status, summary, risk, source, payload, dry_run,
          created_at, decided_at, decision_reason, audit_batch_id, error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          action.id,
          action.actionType,
          action.status,
          action.summary,
          action.risk,
          JSON.stringify(action.source),
          JSON.stringify(action.payload),
          JSON.stringify(action.dryRun),
          action.createdAt,
          action.decidedAt,
          action.decisionReason,
          action.auditBatchId,
          action.error,
        ],
      );
      return action;
    },

    async createAgentPendingActionFromTool(action, source) {
      return this.createAgentPendingAction(createAgentActionDraft(action, source));
    },

    async getAgentInboxSnapshot() {
      await init();
      const db = await getDb();
      const [pendingRows, auditRows] = await Promise.all([
        db.select<AgentPendingActionRow>(
          `SELECT * FROM agent_pending_actions
           ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`,
        ),
        db.select<AgentAuditRecordRow>(
          `SELECT * FROM agent_audit_records
           ORDER BY created_at DESC
           LIMIT 80`,
        ),
      ]);
      return {
        pendingActions: pendingRows.map(mapAgentPendingActionRow),
        audits: auditRows.map(mapAgentAuditRecordRow),
      };
    },

    async approveAgentPendingAction(actionId) {
      await init();
      const action = await selectPendingAction(actionId);
      if (action.status !== 'pending') {
        throw new Error('Agent 操作已处理');
      }
      const timestamp = now().toISOString();
      const batchId = id();
      const db = await getDb();
      try {
        const execution = await executeAgentAction(this, action.payload);
        const audit = await insertAgentAuditRecord(action, execution, batchId, timestamp);
        await db.execute(
          `UPDATE agent_pending_actions
           SET status = $1, decided_at = $2, audit_batch_id = $3, error = $4
           WHERE id = $5`,
          ['approved', timestamp, batchId, null, action.id],
        );
        return audit;
      } catch (error) {
        const message = readableError(error);
        await db.execute(
          `UPDATE agent_pending_actions
           SET status = $1, decided_at = $2, error = $3
           WHERE id = $4`,
          ['failed', timestamp, message, action.id],
        );
        throw new Error(message);
      }
    },

    async rejectAgentPendingAction(actionId, reason = null) {
      await init();
      const action = await selectPendingAction(actionId);
      if (action.status !== 'pending') {
        throw new Error('Agent 操作已处理');
      }
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute(
        `UPDATE agent_pending_actions
         SET status = $1, decided_at = $2, decision_reason = $3
         WHERE id = $4`,
        ['rejected', timestamp, reason, action.id],
      );
      return {
        ...action,
        status: 'rejected',
        decidedAt: timestamp,
        decisionReason: reason,
      };
    },

    async undoAgentAuditBatch(batchId) {
      await init();
      const db = await getDb();
      const rows = await db.select<AgentAuditRecordRow>(
        `SELECT * FROM agent_audit_records
         WHERE batch_id = $1
         ORDER BY created_at DESC`,
        [batchId],
      );
      const audits = rows.map(mapAgentAuditRecordRow);
      if (audits.length === 0) {
        throw new Error('Agent 审计批次不存在');
      }
      const timestamp = now().toISOString();
      const results: AgentAuditRecord[] = [];
      for (const audit of audits) {
        if (audit.status !== 'applied') {
          results.push(audit);
          continue;
        }
        if (!audit.reversible) {
          await db.execute(
            `UPDATE agent_audit_records
             SET status = $1, error = $2
             WHERE id = $3`,
            ['undo_failed', '该操作不可撤销', audit.id],
          );
          results.push({ ...audit, status: 'undo_failed', error: '该操作不可撤销' });
          continue;
        }
        try {
          await undoAgentAction(this, auditActionPayload(audit), audit.before, audit.after);
          await db.execute(
            `UPDATE agent_audit_records
             SET status = $1, undone_at = $2, error = $3
             WHERE id = $4`,
            ['undone', timestamp, null, audit.id],
          );
          results.push({ ...audit, status: 'undone', undoneAt: timestamp, error: null });
        } catch (error) {
          const message = readableError(error);
          await db.execute(
            `UPDATE agent_audit_records
             SET status = $1, error = $2
             WHERE id = $3`,
            ['undo_failed', message, audit.id],
          );
          results.push({ ...audit, status: 'undo_failed', error: message });
        }
      }
      return results;
    },
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mapAgentPendingActionRow(row: AgentPendingActionRow): AgentPendingAction {
  return {
    id: row.id,
    actionType: row.action_type,
    status: row.status,
    summary: row.summary,
    risk: row.risk,
    source: parseJson(row.source, fallbackSource()),
    payload: parseJson(row.payload, { type: row.action_type } as AgentToolInput),
    dryRun: parseJson(row.dry_run, {
      reversible: false,
      requiresConfirmation: true,
      affectedTaskIds: [],
      impact: '缺少 dry-run 结果',
    }),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    auditBatchId: row.audit_batch_id,
    error: row.error,
  };
}

function mapAgentAuditRecordRow(row: AgentAuditRecordRow): AgentAuditRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    actionId: row.action_id,
    actionType: row.action_type,
    payload: parseJson(row.action_payload ?? '{}', { type: row.action_type } as AgentToolInput),
    summary: row.summary,
    status: row.status,
    reversible: row.reversible === true || row.reversible === 1,
    before: parseJson(row.before_payload, null),
    after: parseJson(row.after_payload, null),
    source: parseJson(row.source, fallbackSource()),
    error: row.error,
    createdAt: row.created_at,
    undoneAt: row.undone_at,
  };
}

function auditActionPayload(audit: AgentAuditRecord): AgentToolInput {
  return audit.payload;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fallbackSource(): AgentActionSource {
  return {
    trigger: 'manual_scan',
    envelopeId: 'unknown',
    summary: '未知来源',
    taskIds: [],
  };
}

function readableError(error: unknown) {
  return String((error as Error)?.message ?? error);
}

function shiftIso(value: string | null, recurrence: NonNullable<Task['recurrence']>) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (recurrence.unit === 'day') {
    date.setDate(date.getDate() + recurrence.interval);
  } else if (recurrence.unit === 'week') {
    date.setDate(date.getDate() + recurrence.interval * 7);
  } else {
    date.setMonth(date.getMonth() + recurrence.interval);
  }
  return date.toISOString();
}
