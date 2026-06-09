import Database from '@tauri-apps/plugin-sql';
import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  getDayBounds,
  groupTodayTasks,
  mapTaskListGroupRow,
  mapTaskListRow,
  mapTaskRow,
  normalizeCreateTaskListGroupInput,
  normalizeCreateTaskInput,
  normalizeCreateTaskListInput,
  normalizeUpdateTaskListGroupInput,
  normalizeUpdateTaskInput,
  normalizeUpdateTaskListInput,
  taskHasDueReminder,
  type CreateTaskListGroupInput,
  type CreateTaskInput,
  type CreateTaskListInput,
  type Task,
  type TaskListGroup,
  type TaskListGroupRow,
  type TaskList,
  type TaskListRow,
  type TaskRow,
  type TaskStatus,
  type TodayTaskGroups,
  type UpdateTaskListGroupInput,
  type UpdateTaskInput,
  type UpdateTaskListInput,
} from '../domain/tasks';

export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

export interface TaskRepository {
  databasePath: string;
  init(): Promise<void>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  setStatus(id: string, status: TaskStatus): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  applyRemoteTask(task: Task, remoteVersion?: number): Promise<void>;
  deleteRemoteTask(id: string): Promise<void>;
  applyRemoteList(list: TaskList, remoteVersion?: number): Promise<void>;
  deleteRemoteList(id: string): Promise<void>;
  listTasksByList(listId: string): Promise<Task[]>;
  listTaskChildren(parentId: string): Promise<Task[]>;
  listLists(): Promise<TaskList[]>;
  createList(input: CreateTaskListInput): Promise<TaskList>;
  updateList(id: string, patch: UpdateTaskListInput): Promise<TaskList>;
  archiveList(id: string): Promise<TaskList>;
  listListGroups(): Promise<TaskListGroup[]>;
  createListGroup(input: CreateTaskListGroupInput): Promise<TaskListGroup>;
  updateListGroup(id: string, patch: UpdateTaskListGroupInput): Promise<TaskListGroup>;
  deleteListGroup(id: string): Promise<void>;
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
}

export type LocalChangeAction =
  | 'task.create'
  | 'task.update'
  | 'task.status'
  | 'task.delete'
  | 'taskList.create'
  | 'taskList.update'
  | 'taskList.archive'
  | 'taskList.delete';

export type LocalChangeEntityType = 'task' | 'taskList';

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

interface RepositoryOptions {
  now?: () => Date;
  id?: () => string;
  changeId?: () => string;
  syncRunId?: () => string;
}

type DatabaseLoader = (path: string) => Promise<SqlDatabase>;

const MOMO_DATABASE_PATH = 'sqlite:momo.db';
const SYNC_STATE_ID = 'default';

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
    dbPromise ??= loadDatabase(MOMO_DATABASE_PATH);
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

  async function selectList(listId: string) {
    const db = await getDb();
    const rows = await db.select<TaskListRow>('SELECT * FROM task_lists WHERE id = $1 LIMIT 1', [listId]);
    const row = rows[0];
    if (!row) {
      throw new Error('清单不存在');
    }
    return mapTaskListRow(row);
  }

  async function selectListGroup(groupId: string) {
    const db = await getDb();
    const rows = await db.select<TaskListGroupRow>('SELECT * FROM task_list_groups WHERE id = $1 LIMIT 1', [groupId]);
    const row = rows[0];
    if (!row) {
      throw new Error('分类不存在');
    }
    return mapTaskListGroupRow(row);
  }

  async function ensureListGroupExists(db: SqlDatabase, groupId: string | null | undefined) {
    if (!groupId) return;
    const rows = await db.select<TaskListGroupRow>('SELECT * FROM task_list_groups WHERE id = $1 LIMIT 1', [groupId]);
    if (rows.length === 0) {
      throw new Error('分类不存在');
    }
  }

  async function ensureListExists(db: SqlDatabase, listId: string, timestamp = now().toISOString()) {
    const rows = await db.select<TaskListRow>('SELECT * FROM task_lists WHERE id = $1 LIMIT 1', [listId]);
    if (rows.length > 0) return;
    await db.execute(
      `INSERT INTO task_lists (
        id, name, color, archived, list_order, group_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [listId, listId === DEFAULT_TASK_LIST_ID ? DEFAULT_TASK_LIST_NAME : '未命名清单', null, 0, 0, null, timestamp, timestamp],
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

  return {
    databasePath: MOMO_DATABASE_PATH,
    init,

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
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };

      const db = await getDb();
      await ensureListExists(db, task.listId, timestamp);
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

      if (updates.length > 0) {
        const timestamp = now().toISOString();
        const db = await getDb();
        if (normalized.listId) {
          await ensureListExists(db, normalized.listId, timestamp);
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
      return selectTask(taskId);
    },

    async deleteTask(taskId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('DELETE FROM tasks WHERE id = $1', [taskId]);
      await recordLocalChange(db, 'task', taskId, 'task.delete', await withBaseVersion(db, 'task', taskId, { id: taskId }), timestamp);
    },

    async applyRemoteTask(task, remoteVersion) {
      await init();
      const db = await getDb();
      await ensureListExists(db, task.listId);
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
          group_id = COALESCE(task_lists.group_id, excluded.group_id),
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
        taskListParams(list),
      );
      if (list.archived && list.id !== DEFAULT_TASK_LIST_ID) {
        await db.execute('UPDATE tasks SET list_id = $1, updated_at = $2 WHERE list_id = $3', [
          DEFAULT_TASK_LIST_ID,
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
      await db.execute('UPDATE tasks SET list_id = $1, updated_at = $2 WHERE list_id = $3', [DEFAULT_TASK_LIST_ID, timestamp, listId]);
      await deleteEntityRemoteVersion(db, 'taskList', listId);
    },

    async listTasksByList(listId) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE status = 'active' AND list_id = $1
         ORDER BY child_order ASC, COALESCE(start_at, due_at, created_at) ASC, priority DESC`,
        [listId],
      );
      return rows.map(mapTaskRow);
    },

    async listTaskChildren(parentId) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE status != 'archived' AND parent_id = $1
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
        groupId: normalized.groupId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const db = await getDb();
      await ensureListGroupExists(db, list.groupId);
      await db.execute(
        `INSERT INTO task_lists (
          id, name, color, archived, list_order, group_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [list.id, list.name, list.color, 0, list.order, list.groupId, list.createdAt, list.updatedAt],
      );
      await recordLocalChange(db, 'taskList', list.id, 'taskList.create', taskListSyncPayload(list), timestamp);
      return list;
    },

    async updateList(listId, patch) {
      await init();
      if (listId === DEFAULT_TASK_LIST_ID) {
        if (patch.name && patch.name.trim() !== DEFAULT_TASK_LIST_NAME) {
          throw new Error('默认收件箱不能重命名');
        }
        if ('order' in patch || 'groupId' in patch) {
          throw new Error('默认收件箱不能移动');
        }
      }
      const normalized = normalizeUpdateTaskListInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];
      appendUpdate(updates, values, 'name', normalized.name);
      appendUpdate(updates, values, 'color', normalized.color);
      appendUpdate(updates, values, 'list_order', normalized.order);
      appendUpdate(updates, values, 'group_id', normalized.groupId);
      if (updates.length > 0) {
        const timestamp = now().toISOString();
        appendUpdate(updates, values, 'updated_at', timestamp);
        values.push(listId);
        const db = await getDb();
        if ('groupId' in normalized) {
          await ensureListGroupExists(db, normalized.groupId);
        }
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
      await db.execute('UPDATE tasks SET list_id = $1, updated_at = $2 WHERE list_id = $3', [DEFAULT_TASK_LIST_ID, timestamp, listId]);
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
            patch: { listId: DEFAULT_TASK_LIST_ID },
            updatedAt: timestamp,
          }),
          timestamp,
        );
      }
      return selectList(listId);
    },

    async listListGroups() {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskListGroupRow>(
        `SELECT * FROM task_list_groups
         ORDER BY group_order ASC, created_at ASC`,
      );
      return rows.map(mapTaskListGroupRow);
    },

    async createListGroup(input) {
      await init();
      const normalized = normalizeCreateTaskListGroupInput(input);
      const timestamp = now().toISOString();
      const group: TaskListGroup = {
        id: id(),
        name: normalized.name,
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_list_groups (
          id, name, group_order, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [group.id, group.name, group.order, group.createdAt, group.updatedAt],
      );
      return group;
    },

    async updateListGroup(groupId, patch) {
      await init();
      const normalized = normalizeUpdateTaskListGroupInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];
      appendUpdate(updates, values, 'name', normalized.name);
      appendUpdate(updates, values, 'group_order', normalized.order);
      if (updates.length > 0) {
        const timestamp = now().toISOString();
        appendUpdate(updates, values, 'updated_at', timestamp);
        values.push(groupId);
        const db = await getDb();
        await db.execute(`UPDATE task_list_groups SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
      }
      return selectListGroup(groupId);
    },

    async deleteListGroup(groupId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute('UPDATE task_lists SET group_id = $1, updated_at = $2 WHERE group_id = $3', [null, timestamp, groupId]);
      await db.execute('DELETE FROM task_list_groups WHERE id = $1', [groupId]);
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
         WHERE (status = 'active' AND (
              (due_at IS NOT NULL AND due_at <= $1)
              OR (start_at IS NOT NULL AND start_at >= $2 AND start_at <= $1)
            ))
            OR (status = 'completed' AND completed_at >= $2 AND completed_at <= $1)
         ORDER BY COALESCE(start_at, due_at, completed_at, created_at), priority DESC`,
        [end.toISOString(), start.toISOString()],
      );
      return groupTodayTasks(rows.map(mapTaskRow), currentDate);
    },

    async listInbox() {
      return this.listTasksByList(DEFAULT_TASK_LIST_ID);
    },

    async listAgenda(start, end) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE status != 'archived'
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
         WHERE status = 'active' AND reminders != '[]'
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
        databasePath: MOMO_DATABASE_PATH,
      };
    },
  };
}

function appendUpdate(updates: string[], values: unknown[], column: string, value: unknown) {
  if (value === undefined) return;
  values.push(value);
  updates.push(`${column} = $${values.length}`);
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function taskParams(task: Task) {
  return [
    task.id,
    task.title,
    task.notes,
    task.status,
    task.priority,
    task.startAt ?? null,
    task.dueAt,
    task.estimateMin,
    JSON.stringify(task.resources ?? []),
    JSON.stringify(task.reminders ?? []),
    JSON.stringify(task.checklist ?? []),
    task.parentId ?? null,
    task.childOrder ?? 0,
    JSON.stringify(task.tags ?? []),
    task.listId ?? DEFAULT_TASK_LIST_ID,
    task.createdAt,
    task.updatedAt,
    task.completedAt,
  ];
}

function taskListParams(list: TaskList) {
  return [
    list.id,
    list.name,
    list.color,
    list.archived ? 1 : 0,
    list.order,
    list.groupId ?? null,
    list.createdAt,
    list.updatedAt,
  ];
}

function taskListSyncPayload(list: TaskList) {
  const { groupId: _groupId, ...payload } = list;
  return payload;
}

function taskListSyncPatch(patch: UpdateTaskListInput) {
  const { groupId: _groupId, ...syncPatch } = patch;
  return syncPatch;
}

const INSERT_TASK_SQL = `INSERT INTO tasks (
  id, title, notes, status, priority, start_at, due_at, estimate_min,
  resources, reminders, checklist, parent_id, child_order, tags, list_id,
  created_at, updated_at, completed_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`;

const INSERT_TASK_LIST_SQL = `INSERT INTO task_lists (
  id, name, color, archived, list_order, group_id, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS task_lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    list_order INTEGER NOT NULL DEFAULT 0 CHECK (list_order >= 0),
    group_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS task_list_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_order INTEGER NOT NULL DEFAULT 0 CHECK (group_order >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'archived')),
    priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
    start_at TEXT,
    due_at TEXT,
    estimate_min INTEGER CHECK (estimate_min IS NULL OR estimate_min > 0),
    resources TEXT NOT NULL DEFAULT '[]',
    reminders TEXT NOT NULL DEFAULT '[]',
    checklist TEXT NOT NULL DEFAULT '[]',
    parent_id TEXT,
    child_order INTEGER NOT NULL DEFAULT 0 CHECK (child_order >= 0),
    tags TEXT NOT NULL DEFAULT '[]',
    list_id TEXT NOT NULL DEFAULT 'inbox',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS local_changes (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synced_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    server_cursor TEXT,
    last_synced_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    message TEXT NOT NULL,
    server_cursor TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS task_sync_versions (
    task_id TEXT PRIMARY KEY,
    remote_version INTEGER NOT NULL CHECK (remote_version >= 0),
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entity_sync_versions (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    remote_version INTEGER NOT NULL CHECK (remote_version >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
  )`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (1, 'create_tasks', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (2, 'create_local_changes', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (3, 'create_sync_state', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (4, 'create_sync_runs', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (5, 'create_task_sync_versions', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (6, 'expand_task_concept', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (7, 'create_entity_sync_versions', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (8, 'create_task_list_groups', datetime('now'))`,
];

const TASK_COLUMN_MIGRATIONS = [
  `ALTER TABLE tasks ADD COLUMN start_at TEXT`,
  `ALTER TABLE tasks ADD COLUMN resources TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN reminders TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN parent_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN child_order INTEGER NOT NULL DEFAULT 0 CHECK (child_order >= 0)`,
  `ALTER TABLE tasks ADD COLUMN list_id TEXT NOT NULL DEFAULT 'inbox'`,
];

const TASK_LIST_COLUMN_MIGRATIONS = [
  `ALTER TABLE task_lists ADD COLUMN group_id TEXT`,
];

async function runTaskMigrations(db: SqlDatabase) {
  for (const statement of TASK_COLUMN_MIGRATIONS) {
    try {
      await db.execute(statement);
    } catch (error) {
      const message = String((error as Error).message ?? error).toLowerCase();
      if (!message.includes('duplicate') && !message.includes('exists')) {
        throw error;
      }
    }
  }
  for (const statement of TASK_LIST_COLUMN_MIGRATIONS) {
    try {
      await db.execute(statement);
    } catch (error) {
      const message = String((error as Error).message ?? error).toLowerCase();
      if (!message.includes('duplicate') && !message.includes('exists')) {
        throw error;
      }
    }
  }
  await db.execute(`UPDATE tasks SET list_id = 'inbox' WHERE list_id IS NULL OR list_id = ''`);
  await db.execute(
    `INSERT OR IGNORE INTO entity_sync_versions (
      entity_type, entity_id, remote_version, updated_at
    )
    SELECT 'task', task_id, remote_version, updated_at
    FROM task_sync_versions`,
  );
}

async function ensureDefaultList(db: SqlDatabase, timestamp: string) {
  await db.execute(
    `INSERT OR IGNORE INTO task_lists (
      id, name, color, archived, list_order, group_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [DEFAULT_TASK_LIST_ID, DEFAULT_TASK_LIST_NAME, null, 0, 0, null, timestamp, timestamp],
  );
}

function mapLocalChangeRow(row: LocalChangeRow): LocalChange {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  };
}

function parsePayload(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function mapSyncStateRow(row: SyncStateRow): SyncState {
  return {
    serverCursor: row.server_cursor,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function mapSyncRunRow(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    message: row.message,
    serverCursor: row.server_cursor,
  };
}

function emptySyncState(): SyncState {
  return {
    serverCursor: null,
    lastSyncedAt: null,
    lastError: null,
    updatedAt: null,
  };
}
