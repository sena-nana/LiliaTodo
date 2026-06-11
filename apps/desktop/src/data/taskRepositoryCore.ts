import Database from "@tauri-apps/plugin-sql";
import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  type TaskListRow,
} from "../domain/tasks";
import {
  LILIATODO_DATABASE_PATH,
  SCHEMA,
  ensureDefaultList,
  runTaskMigrations,
} from "./taskRepositorySql";

export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

export type DatabaseLoader = (path: string) => Promise<SqlDatabase>;

export interface RepositoryOptions {
  now?: () => Date;
  id?: () => string;
  changeId?: () => string;
  syncRunId?: () => string;
}

export type LocalChangeAction =
  | "task.create"
  | "task.update"
  | "task.status"
  | "task.delete"
  | "taskList.create"
  | "taskList.update"
  | "taskList.archive"
  | "taskList.delete"
  | "taskCategory.create"
  | "taskCategory.update"
  | "taskCategory.delete";

export type LocalChangeEntityType = "task" | "taskList" | "taskCategory";

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

export type SyncRunStatus = "succeeded" | "failed";

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

export interface RepositoryContext {
  now: () => Date;
  id: () => string;
  changeId: () => string;
  syncRunId: () => string;
  getDb(): Promise<SqlDatabase>;
  init(): Promise<void>;
}

export function createRepositoryContext(
  loadDatabase: DatabaseLoader = (path) => Database.load(path),
  options: RepositoryOptions = {},
): RepositoryContext {
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

  return { now, id, changeId, syncRunId, getDb, init };
}

export async function ensureListExists(
  db: SqlDatabase,
  listId: string,
  timestamp: string,
) {
  const rows = await db.select<TaskListRow>("SELECT * FROM task_lists WHERE id = $1 LIMIT 1", [listId]);
  if (rows.length > 0) return;
  await db.execute(
    `INSERT INTO task_lists (
      id, name, color, archived, list_order, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [listId, listId === DEFAULT_TASK_LIST_ID ? DEFAULT_TASK_LIST_NAME : "未命名清单", null, 0, 0, timestamp, timestamp],
  );
}

export async function recordLocalChange(
  ctx: RepositoryContext,
  db: SqlDatabase,
  entityType: LocalChangeEntityType,
  entityId: string,
  action: LocalChangeAction,
  payload: unknown,
  createdAt = ctx.now().toISOString(),
) {
  await db.execute(
    `INSERT INTO local_changes (
      id, entity_type, entity_id, action, payload, created_at, synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.changeId(), entityType, entityId, action, JSON.stringify(payload), createdAt, null],
  );
}

export function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
