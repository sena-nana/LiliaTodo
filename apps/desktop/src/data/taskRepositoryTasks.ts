import {
  DEFAULT_TASK_LIST_ID,
  getDayBounds,
  groupTodayTasks,
  mapTaskRow,
  normalizeCreateTaskInput,
  normalizeUpdateTaskInput,
  taskHasDueReminder,
  type BatchTaskResult,
  type Task,
  type TaskCategoryRow,
  type TaskRow,
  type TaskSearchQuery,
} from "../domain/tasks";
import type { TaskRepository, DatabaseStats } from "./taskRepository";
import {
  INSERT_TASK_SQL,
  LILIATODO_DATABASE_PATH,
  appendUpdate,
  taskParams,
} from "./taskRepositorySql";
import {
  ensureListExists,
  recordLocalChange,
  type LocalChangeEntityType,
  type RepositoryContext,
  type SqlDatabase,
} from "./taskRepositoryCore";
import { readableError, shiftIso } from "./taskRepositoryUtils";

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

export type TaskRepositoryTaskMethods = Pick<
  TaskRepository,
  | "findTaskById"
  | "createTask"
  | "updateTask"
  | "setStatus"
  | "deleteTask"
  | "restoreTask"
  | "purgeTask"
  | "listTasksByStatus"
  | "searchTasks"
  | "batchUpdateTasks"
  | "reorderTasks"
  | "snoozeReminder"
  | "dismissReminder"
  | "applyRemoteTask"
  | "deleteRemoteTask"
  | "listActiveTasks"
  | "listTasksByList"
  | "listTaskChildren"
  | "listToday"
  | "listInbox"
  | "listAgenda"
  | "listDueReminders"
  | "getStats"
>;

interface TaskRepositoryTaskOptions {
  withBaseVersion: WithBaseVersion;
  upsertEntityRemoteVersion: RemoteVersionWriter;
  deleteEntityRemoteVersion: RemoteVersionWriter;
  repository: () => TaskRepository;
}

export function createTaskRepositoryTasks(
  ctx: RepositoryContext,
  options: TaskRepositoryTaskOptions,
): TaskRepositoryTaskMethods {
  const { getDb, init, now, id } = ctx;
  const { withBaseVersion, upsertEntityRemoteVersion, deleteEntityRemoteVersion, repository } = options;

  async function selectTask(taskId: string) {
    const db = await getDb();
    const rows = await db.select<TaskRow>("SELECT * FROM tasks WHERE id = $1 LIMIT 1", [taskId]);
    const row = rows[0];
    if (!row) {
      throw new Error("任务不存在");
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
      status: "active",
      startAt: nextStartAt,
      dueAt: nextDueAt,
      reminders: task.reminders.map((reminder) => ({
        ...reminder,
        triggerAt: shiftIso(reminder.triggerAt, task.recurrence!) ?? reminder.triggerAt,
        status: "pending",
      })),
      completedAt: null,
      deletedAt: null,
      lastReminderNotifiedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.execute(INSERT_TASK_SQL, taskParams(nextTask));
    await recordLocalChange(ctx, db, "task", nextTask.id, "task.create", nextTask, timestamp);
    return nextTask;
  }

  function filterTasks(tasks: Task[], query: TaskSearchQuery) {
    const needle = query.text?.trim().toLowerCase() ?? "";
    const statuses = query.statuses?.length ? new Set(query.statuses) : null;
    const priorities = query.priorities?.length ? new Set(query.priorities) : null;
    const tags = query.tags?.length ? new Set(query.tags.map((tag) => tag.trim()).filter(Boolean)) : null;
    const fromTime = parseSearchTime(query.timeFrom, "筛选开始时间");
    const toTime = parseSearchTime(query.timeTo, "筛选结束时间");

    return tasks.filter((task) => {
      if (!query.includeDeleted && task.deletedAt) return false;
      if (needle) {
        const haystack = [task.title, task.notes ?? "", task.tags.join(" ")].join("\n").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (tags && ![...tags].every((tag) => task.tags.includes(tag))) return false;
      if (query.listId && task.listId !== query.listId) return false;
      if (query.categoryId && task.categoryId !== query.categoryId) return false;
      if (statuses && !statuses.has(task.status)) return false;
      if (priorities && !priorities.has(task.priority)) return false;
      if (query.timeMode === "scheduled" && !task.startAt && !task.dueAt) return false;
      if (query.timeMode === "unscheduled" && (task.startAt || task.dueAt)) return false;
      if (fromTime != null || toTime != null) {
        const target = task.startAt ?? task.dueAt ?? task.completedAt ?? task.createdAt;
        const time = new Date(target).getTime();
        if (fromTime != null && time < fromTime) return false;
        if (toTime != null && time > toTime) return false;
      }
      if (query.reminderStatus) {
        const hasReminders = task.reminders.length > 0;
        if (query.reminderStatus === "none" && hasReminders) return false;
        if (query.reminderStatus === "pending" && !task.reminders.some((item) => item.status === "pending")) return false;
        if (query.reminderStatus === "due" && !taskHasDueReminder(task, now())) return false;
        if (query.reminderStatus === "fired" && !task.reminders.some((item) => item.status === "fired")) return false;
        if (query.reminderStatus === "dismissed" && !task.reminders.some((item) => item.status === "dismissed")) return false;
      }
      return true;
    });
  }

  function parseSearchTime(value: string | null | undefined, label: string) {
    if (!value) return null;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) {
      throw new Error(`${label}不合法`);
    }
    return time;
  }

  async function ensureCategoryExists(db: SqlDatabase, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const rows = await db.select<TaskCategoryRow>("SELECT * FROM task_categories WHERE id = $1 LIMIT 1", [categoryId]);
    if (rows.length === 0) {
      throw new Error("分类不存在");
    }
  }

  async function assertValidParent(db: SqlDatabase, taskId: string, parentId: string | null | undefined) {
    if (!parentId) return;
    if (parentId === taskId) {
      throw new Error("父任务不能是当前任务或其子任务");
    }
    let currentParentId: string | null = parentId;
    const visited = new Set<string>();
    while (currentParentId) {
      if (visited.has(currentParentId)) {
        throw new Error("父任务关系不能形成循环");
      }
      visited.add(currentParentId);
      if (currentParentId === taskId) {
        throw new Error("父任务不能是当前任务或其子任务");
      }
      const parentRows: Array<{ parent_id: string | null }> = await db.select(
        "SELECT parent_id FROM tasks WHERE id = $1 LIMIT 1",
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
      throw new Error("还有未完成的子任务或检查项");
    }
    const task = await selectTask(taskId);
    if (task.checklist.some((item) => !item.done)) {
      throw new Error("还有未完成的子任务或检查项");
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
    async findTaskById(taskId: string) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>("SELECT * FROM tasks WHERE id = $1 LIMIT 1", [taskId]);
      return rows[0] ? mapTaskRow(rows[0]) : null;
    },

    async createTask(input) {
      await init();
      const normalized = normalizeCreateTaskInput(input);
      const timestamp = now().toISOString();
      const task: Task = {
        id: id(),
        title: normalized.title,
        notes: normalized.notes,
        status: "active",
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
      await recordLocalChange(ctx, db, "task", task.id, "task.create", task, timestamp);
      return task;
    },

    async updateTask(taskId, patch) {
      await init();
      const normalized = normalizeUpdateTaskInput(patch);
      const updates: string[] = [];
      const values: unknown[] = [];

      appendUpdate(updates, values, "title", normalized.title);
      appendUpdate(updates, values, "notes", normalized.notes);
      appendUpdate(updates, values, "priority", normalized.priority);
      appendUpdate(updates, values, "start_at", normalized.startAt);
      appendUpdate(updates, values, "due_at", normalized.dueAt);
      appendUpdate(updates, values, "estimate_min", normalized.estimateMin);
      if ("resources" in normalized) appendUpdate(updates, values, "resources", JSON.stringify(normalized.resources));
      if ("reminders" in normalized) appendUpdate(updates, values, "reminders", JSON.stringify(normalized.reminders));
      if ("checklist" in normalized) appendUpdate(updates, values, "checklist", JSON.stringify(normalized.checklist));
      appendUpdate(updates, values, "parent_id", normalized.parentId);
      appendUpdate(updates, values, "child_order", normalized.childOrder);
      if ("tags" in normalized) appendUpdate(updates, values, "tags", JSON.stringify(normalized.tags));
      appendUpdate(updates, values, "list_id", normalized.listId);
      appendUpdate(updates, values, "category_id", normalized.categoryId);
      if ("recurrence" in normalized) appendUpdate(updates, values, "recurrence", normalized.recurrence ? JSON.stringify(normalized.recurrence) : null);
      appendUpdate(updates, values, "deleted_at", normalized.deletedAt);
      appendUpdate(updates, values, "last_reminder_notified_at", normalized.lastReminderNotifiedAt);

      if (updates.length > 0) {
        const timestamp = now().toISOString();
        const db = await getDb();
        if (normalized.listId) {
          await ensureListExists(db, normalized.listId, timestamp);
        }
        if ("categoryId" in normalized) {
          await ensureCategoryExists(db, normalized.categoryId);
        }
        if ("parentId" in normalized) {
          await assertValidParent(db, taskId, normalized.parentId);
        }
        appendUpdate(updates, values, "updated_at", timestamp);
        values.push(taskId);
        await db.execute(`UPDATE tasks SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
        await recordLocalChange(
          ctx,
          db,
          "task",
          taskId,
          "task.update",
          await withBaseVersion(db, "task", taskId, { id: taskId, patch: normalized, updatedAt: timestamp }),
          timestamp,
        );
      }

      return selectTask(taskId);
    },

    async setStatus(taskId, status) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      if (status === "completed") {
        await assertCanCompleteTask(db, taskId);
      }
      const completedAt = status === "completed" ? timestamp : null;
      await db.execute(
        "UPDATE tasks SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4",
        [status, completedAt, timestamp, taskId],
      );
      await recordLocalChange(
        ctx,
        db,
        "task",
        taskId,
        "task.status",
        await withBaseVersion(db, "task", taskId, { id: taskId, status, completedAt, updatedAt: timestamp }),
        timestamp,
      );
      const task = await selectTask(taskId);
      if (status === "completed" && task.recurrence) {
        await createNextRecurringTask(db, task, timestamp);
      }
      return task;
    },

    async deleteTask(taskId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute("UPDATE tasks SET deleted_at = $1, updated_at = $2 WHERE id = $3", [timestamp, timestamp, taskId]);
      await recordLocalChange(
        ctx,
        db,
        "task",
        taskId,
        "task.update",
        await withBaseVersion(db, "task", taskId, { id: taskId, patch: { deletedAt: timestamp }, updatedAt: timestamp }),
        timestamp,
      );
    },

    async restoreTask(taskId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute("UPDATE tasks SET deleted_at = $1, updated_at = $2 WHERE id = $3", [null, timestamp, taskId]);
      await recordLocalChange(
        ctx,
        db,
        "task",
        taskId,
        "task.update",
        await withBaseVersion(db, "task", taskId, { id: taskId, patch: { deletedAt: null }, updatedAt: timestamp }),
        timestamp,
      );
      return selectTask(taskId);
    },

    async purgeTask(taskId) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute("DELETE FROM tasks WHERE id = $1", [taskId]);
      await recordLocalChange(ctx, db, "task", taskId, "task.delete", await withBaseVersion(db, "task", taskId, { id: taskId }), timestamp);
    },

    async listTasksByStatus(status) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        status === "deleted"
          ? "SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, updated_at DESC"
          : "SELECT * FROM tasks WHERE status = $1 AND deleted_at IS NULL ORDER BY COALESCE(completed_at, updated_at, created_at) DESC",
        status === "deleted" ? [] : [status],
      );
      return rows.map(mapTaskRow);
    },

    async searchTasks(query) {
      await init();
      const db = await getDb();
      const rows = await db.select<TaskRow>(
        "SELECT * FROM tasks ORDER BY COALESCE(start_at, due_at, completed_at, updated_at, created_at) DESC",
      );
      return filterTasks(rows.map(mapTaskRow), query);
    },

    async batchUpdateTasks(input) {
      await init();
      const taskIds = [...new Set(input.taskIds)].filter(Boolean);
      const result: BatchTaskResult = { succeeded: [], failed: [] };
      for (const taskId of taskIds) {
        try {
          if (input.type === "complete") {
            await repository().setStatus(taskId, "completed");
          } else if (input.type === "reschedule") {
            await repository().updateTask(taskId, { startAt: input.startAt ?? null, dueAt: input.dueAt ?? null });
          } else if (input.type === "move") {
            await repository().updateTask(taskId, { listId: input.listId, categoryId: input.categoryId ?? null });
          } else if (input.type === "tag") {
            const current = await selectTask(taskId);
            const nextTags = input.mode === "merge"
              ? [...new Set([...current.tags, ...input.tags])]
              : input.tags;
            await repository().updateTask(taskId, { tags: nextTags });
          } else if (input.type === "delete") {
            await repository().deleteTask(taskId);
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
        tasks.push(await repository().updateTask(taskId, {
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
      return repository().updateTask(taskId, {
        reminders: task.reminders.map((reminder) =>
          reminder.id === reminderId
            ? { ...reminder, triggerAt: until, status: "pending" }
            : reminder,
        ),
        lastReminderNotifiedAt: null,
      });
    },

    async dismissReminder(taskId, reminderId) {
      const task = await selectTask(taskId);
      return repository().updateTask(taskId, {
        reminders: task.reminders.map((reminder) =>
          reminder.id === reminderId ? { ...reminder, status: "dismissed" } : reminder,
        ),
        lastReminderNotifiedAt: now().toISOString(),
      });
    },

    async applyRemoteTask(task, remoteVersion) {
      await init();
      const db = await getDb();
      await ensureListExists(db, task.listId, now().toISOString());
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
          recurrence = excluded.recurrence,
          deleted_at = excluded.deleted_at,
          last_reminder_notified_at = excluded.last_reminder_notified_at,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at`,
        taskParams(task),
      );
      await upsertEntityRemoteVersion(db, "task", task.id, remoteVersion);
    },

    async deleteRemoteTask(taskId) {
      await init();
      const db = await getDb();
      await db.execute("DELETE FROM tasks WHERE id = $1", [taskId]);
      await deleteEntityRemoteVersion(db, "task", taskId);
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

    async getStats(): Promise<DatabaseStats> {
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
  };
}
