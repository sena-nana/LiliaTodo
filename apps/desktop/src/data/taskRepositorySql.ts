import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  type Task,
  type TaskCategory,
  type TaskList,
  type UpdateTaskCategoryInput,
  type UpdateTaskListInput,
} from "../domain/tasks";
import type { SqlDatabase } from "./taskRepository";

export const LILIATODO_DATABASE_PATH = "sqlite:liliatodo.db";
export const SYNC_STATE_ID = "default";

export const INSERT_TASK_SQL = `INSERT INTO tasks (
  id, title, notes, status, priority, start_at, due_at, estimate_min,
  resources, reminders, checklist, parent_id, child_order, tags, list_id,
  category_id, recurrence, deleted_at, last_reminder_notified_at, created_at, updated_at, completed_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`;

export const INSERT_TASK_LIST_SQL = `INSERT INTO task_lists (
  id, name, color, archived, list_order, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)`;

export const INSERT_TASK_CATEGORY_SQL = `INSERT INTO task_categories (
  id, list_id, name, category_order, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6)`;

export const SCHEMA = [
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS task_categories (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category_order INTEGER NOT NULL DEFAULT 0 CHECK (category_order >= 0),
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
    category_id TEXT,
    recurrence TEXT,
    deleted_at TEXT,
    last_reminder_notified_at TEXT,
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
  `CREATE TABLE IF NOT EXISTS agent_pending_actions (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'failed')),
    summary TEXT NOT NULL,
    risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    dry_run TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decision_reason TEXT,
    audit_batch_id TEXT,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS agent_audit_records (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_payload TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('applied', 'undone', 'undo_failed')),
    reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
    before_payload TEXT NOT NULL,
    after_payload TEXT NOT NULL,
    source TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    undone_at TEXT
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
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (9, 'create_task_categories', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (10, 'create_agent_queue_audit', datetime('now'))`,
  `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
   VALUES (11, 'p1_task_recurrence_delete_notification', datetime('now'))`,
];

const TASK_COLUMN_MIGRATIONS = [
  `ALTER TABLE tasks ADD COLUMN start_at TEXT`,
  `ALTER TABLE tasks ADD COLUMN resources TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN reminders TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN parent_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN child_order INTEGER NOT NULL DEFAULT 0 CHECK (child_order >= 0)`,
  `ALTER TABLE tasks ADD COLUMN list_id TEXT NOT NULL DEFAULT 'inbox'`,
  `ALTER TABLE tasks ADD COLUMN category_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN recurrence TEXT`,
  `ALTER TABLE tasks ADD COLUMN deleted_at TEXT`,
  `ALTER TABLE tasks ADD COLUMN last_reminder_notified_at TEXT`,
];

const TASK_LIST_COLUMN_MIGRATIONS = [
  `ALTER TABLE task_lists DROP COLUMN group_id`,
];

const CATEGORY_MIGRATIONS = [
  `DROP TABLE IF EXISTS task_list_groups`,
];

const AGENT_AUDIT_COLUMN_MIGRATIONS = [
  `ALTER TABLE agent_audit_records ADD COLUMN action_payload TEXT NOT NULL DEFAULT '{}'`,
];

export function appendUpdate(
  updates: string[],
  values: unknown[],
  column: string,
  value: unknown,
) {
  if (value === undefined) return;
  values.push(value);
  updates.push(`${column} = $${values.length}`);
}

export function taskParams(task: Task) {
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
    task.categoryId ?? null,
    task.recurrence ? JSON.stringify(task.recurrence) : null,
    task.deletedAt ?? null,
    task.lastReminderNotifiedAt ?? null,
    task.createdAt,
    task.updatedAt,
    task.completedAt,
  ];
}

export function taskListParams(list: TaskList) {
  return [
    list.id,
    list.name,
    list.color,
    list.archived ? 1 : 0,
    list.order,
    list.createdAt,
    list.updatedAt,
  ];
}

export function taskListSyncPayload(list: TaskList) {
  return { ...list };
}

export function taskListSyncPatch(patch: UpdateTaskListInput) {
  return { ...patch };
}

export function taskCategoryParams(category: TaskCategory) {
  return [
    category.id,
    category.listId,
    category.name,
    category.order,
    category.createdAt,
    category.updatedAt,
  ];
}

export function taskCategorySyncPayload(category: TaskCategory) {
  return { ...category };
}

export function taskCategorySyncPatch(patch: UpdateTaskCategoryInput) {
  return { ...patch };
}

export async function runTaskMigrations(db: SqlDatabase) {
  for (const statement of TASK_COLUMN_MIGRATIONS) {
    await runIgnorableMigration(db, statement);
  }
  for (const statement of TASK_LIST_COLUMN_MIGRATIONS) {
    await runIgnorableMigration(db, statement);
  }
  for (const statement of CATEGORY_MIGRATIONS) {
    await runIgnorableMigration(db, statement);
  }
  for (const statement of AGENT_AUDIT_COLUMN_MIGRATIONS) {
    await runIgnorableMigration(db, statement);
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

export async function ensureDefaultList(db: SqlDatabase, timestamp: string) {
  await db.execute(
    `INSERT OR IGNORE INTO task_lists (
      id, name, color, archived, list_order, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [DEFAULT_TASK_LIST_ID, DEFAULT_TASK_LIST_NAME, null, 0, 0, timestamp, timestamp],
  );
}

async function runIgnorableMigration(db: SqlDatabase, statement: string) {
  try {
    await db.execute(statement);
  } catch (error) {
    const message = String((error as Error).message ?? error).toLowerCase();
    if (!message.includes("duplicate") && !message.includes("exists") && !message.includes("no such column")) {
      throw error;
    }
  }
}
