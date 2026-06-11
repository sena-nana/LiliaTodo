import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  mapTaskCategoryRow,
  mapTaskListRow,
  normalizeCreateTaskCategoryInput,
  normalizeCreateTaskListInput,
  normalizeUpdateTaskCategoryInput,
  normalizeUpdateTaskListInput,
  type TaskCategory,
  type TaskCategoryRow,
  type TaskList,
  type TaskListRow,
  type TaskRow,
} from "../domain/tasks";
import type { TaskRepository } from "./taskRepository";
import {
  INSERT_TASK_CATEGORY_SQL,
  INSERT_TASK_LIST_SQL,
  appendUpdate,
  taskCategoryParams,
  taskCategorySyncPatch,
  taskCategorySyncPayload,
  taskListParams,
  taskListSyncPatch,
  taskListSyncPayload,
} from "./taskRepositorySql";
import {
  ensureListExists,
  recordLocalChange,
  type LocalChangeEntityType,
  type RepositoryContext,
  type SqlDatabase,
} from "./taskRepositoryCore";

type WithBaseVersion = (
  db: SqlDatabase,
  entityType: LocalChangeEntityType,
  entityId: string,
  payload: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type RemoteVersionWriter = (
  db: SqlDatabase,
  entityType: LocalChangeEntityType,
  entityId: string,
  remoteVersion?: number,
) => Promise<void>;

export type TaskRepositoryListMethods = Pick<
  TaskRepository,
  | "applyRemoteList"
  | "deleteRemoteList"
  | "applyRemoteCategory"
  | "deleteRemoteCategory"
  | "listLists"
  | "createList"
  | "updateList"
  | "archiveList"
  | "listCategoriesByList"
  | "createCategory"
  | "updateCategory"
  | "deleteCategory"
>;

interface TaskRepositoryListOptions {
  withBaseVersion: WithBaseVersion;
  upsertEntityRemoteVersion: RemoteVersionWriter;
  deleteEntityRemoteVersion: RemoteVersionWriter;
}

export function createTaskRepositoryLists(
  ctx: RepositoryContext,
  options: TaskRepositoryListOptions,
): TaskRepositoryListMethods {
  const { getDb, init, now, id } = ctx;
  const { withBaseVersion, upsertEntityRemoteVersion, deleteEntityRemoteVersion } = options;

  async function selectList(listId: string) {
    const db = await getDb();
    const rows = await db.select<TaskListRow>("SELECT * FROM task_lists WHERE id = $1 LIMIT 1", [listId]);
    const row = rows[0];
    if (!row) {
      throw new Error("清单不存在");
    }
    return mapTaskListRow(row);
  }

  async function selectCategory(categoryId: string) {
    const db = await getDb();
    const rows = await db.select<TaskCategoryRow>("SELECT * FROM task_categories WHERE id = $1 LIMIT 1", [categoryId]);
    const row = rows[0];
    if (!row) {
      throw new Error("分类不存在");
    }
    return mapTaskCategoryRow(row);
  }

  return {
    async applyRemoteList(list: TaskList, remoteVersion?: number) {
      await init();
      if (list.id === DEFAULT_TASK_LIST_ID && (list.archived || list.name !== DEFAULT_TASK_LIST_NAME)) {
        throw new Error("默认收件箱不能重命名或归档");
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
        await db.execute("UPDATE tasks SET list_id = $1, category_id = $2, updated_at = $3 WHERE list_id = $4", [
          DEFAULT_TASK_LIST_ID,
          null,
          list.updatedAt,
          list.id,
        ]);
      }
      await upsertEntityRemoteVersion(db, "taskList", list.id, remoteVersion);
      await ensureListExists(db, DEFAULT_TASK_LIST_ID, now().toISOString());
    },

    async deleteRemoteList(listId: string) {
      await init();
      if (listId === DEFAULT_TASK_LIST_ID) {
        await ensureListExists(await getDb(), DEFAULT_TASK_LIST_ID, now().toISOString());
        return;
      }
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute("UPDATE task_lists SET archived = $1, updated_at = $2 WHERE id = $3", [1, timestamp, listId]);
      await db.execute("UPDATE tasks SET list_id = $1, category_id = $2, updated_at = $3 WHERE list_id = $4", [DEFAULT_TASK_LIST_ID, null, timestamp, listId]);
      await deleteEntityRemoteVersion(db, "taskList", listId);
    },

    async applyRemoteCategory(category: TaskCategory, remoteVersion?: number) {
      await init();
      const db = await getDb();
      await ensureListExists(db, category.listId, now().toISOString());
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
      await upsertEntityRemoteVersion(db, "taskCategory", category.id, remoteVersion);
    },

    async deleteRemoteCategory(categoryId: string) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute("UPDATE tasks SET category_id = $1, updated_at = $2 WHERE category_id = $3", [null, timestamp, categoryId]);
      await db.execute("DELETE FROM task_categories WHERE id = $1", [categoryId]);
      await deleteEntityRemoteVersion(db, "taskCategory", categoryId);
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
      await recordLocalChange(ctx, db, "taskList", list.id, "taskList.create", taskListSyncPayload(list), timestamp);
      return list;
    },

    async updateList(listId, patch) {
      await init();
      if (listId === DEFAULT_TASK_LIST_ID) {
        if (patch.name && patch.name.trim() !== DEFAULT_TASK_LIST_NAME) {
          throw new Error("默认收件箱不能重命名");
        }
        if ("order" in patch) {
          throw new Error("默认收件箱不能移动");
        }
      }
      const normalized = normalizeUpdateTaskListInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];
      appendUpdate(updates, values, "name", normalized.name);
      appendUpdate(updates, values, "color", normalized.color);
      appendUpdate(updates, values, "list_order", normalized.order);
      if (updates.length > 0) {
        const timestamp = now().toISOString();
        appendUpdate(updates, values, "updated_at", timestamp);
        values.push(listId);
        const db = await getDb();
        await db.execute(`UPDATE task_lists SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
        const syncPatch = taskListSyncPatch(normalized);
        if (Object.keys(syncPatch).length > 0) {
          await recordLocalChange(
            ctx,
            db,
            "taskList",
            listId,
            "taskList.update",
            await withBaseVersion(db, "taskList", listId, { id: listId, patch: syncPatch, updatedAt: timestamp }),
            timestamp,
          );
        }
      }
      return selectList(listId);
    },

    async archiveList(listId) {
      await init();
      if (listId === DEFAULT_TASK_LIST_ID) {
        throw new Error("默认收件箱不能归档");
      }
      const timestamp = now().toISOString();
      const db = await getDb();
      const affectedRows = await db.select<TaskRow>(
        `SELECT * FROM tasks
         WHERE list_id = $1`,
        [listId],
      );
      await db.execute("UPDATE task_lists SET archived = $1, updated_at = $2 WHERE id = $3", [1, timestamp, listId]);
      await db.execute("UPDATE tasks SET list_id = $1, category_id = $2, updated_at = $3 WHERE list_id = $4", [DEFAULT_TASK_LIST_ID, null, timestamp, listId]);
      await recordLocalChange(
        ctx,
        db,
        "taskList",
        listId,
        "taskList.archive",
        await withBaseVersion(db, "taskList", listId, { id: listId, archived: true, updatedAt: timestamp }),
        timestamp,
      );
      for (const row of affectedRows) {
        await recordLocalChange(
          ctx,
          db,
          "task",
          row.id,
          "task.update",
          await withBaseVersion(db, "task", row.id, {
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
      await recordLocalChange(ctx, db, "taskCategory", category.id, "taskCategory.create", taskCategorySyncPayload(category), timestamp);
      return category;
    },

    async updateCategory(categoryId, patch) {
      await init();
      const normalized = normalizeUpdateTaskCategoryInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];
      appendUpdate(updates, values, "name", normalized.name);
      appendUpdate(updates, values, "category_order", normalized.order);
      if (updates.length > 0) {
        const timestamp = now().toISOString();
        appendUpdate(updates, values, "updated_at", timestamp);
        values.push(categoryId);
        const db = await getDb();
        await db.execute(`UPDATE task_categories SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
        const syncPatch = taskCategorySyncPatch(normalized);
        if (Object.keys(syncPatch).length > 0) {
          await recordLocalChange(
            ctx,
            db,
            "taskCategory",
            categoryId,
            "taskCategory.update",
            await withBaseVersion(db, "taskCategory", categoryId, { id: categoryId, patch: syncPatch, updatedAt: timestamp }),
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
      await db.execute("UPDATE tasks SET category_id = $1, updated_at = $2 WHERE category_id = $3", [null, timestamp, categoryId]);
      await db.execute("DELETE FROM task_categories WHERE id = $1", [categoryId]);
      await recordLocalChange(
        ctx,
        db,
        "taskCategory",
        categoryId,
        "taskCategory.delete",
        await withBaseVersion(db, "taskCategory", categoryId, { id: categoryId }),
        timestamp,
      );
    },
  };
}
