import { describe, expect, it } from "vitest";
import {
  groupTodayTasks,
  mapTaskRow,
  normalizeCreateTaskInput,
  normalizeUpdateTaskInput,
  type TaskCategoryRow,
  type TaskListRow,
  type TaskRow,
} from "../src/domain/tasks";
import {
  createTaskRepository,
  type LocalChangeRow,
  type EntitySyncVersionRow,
  type SqlDatabase,
  type TaskSyncVersionRow,
  type SyncRunRow,
  type SyncStateRow,
} from "../src/data/taskRepository";

describe("任务领域", () => {
  it("规范化创建输入并拒绝空白标题", () => {
    expect(normalizeCreateTaskInput({ title: "  Draft plan  " })).toMatchObject({
      title: "Draft plan",
      notes: null,
      priority: 0,
      dueAt: null,
      estimateMin: null,
      tags: [],
    });

    expect(() => normalizeCreateTaskInput({ title: "   " })).toThrow(
      "任务标题不能为空",
    );
  });

  it("规范化提醒时间并拒绝空提醒时间", () => {
    expect(
      normalizeCreateTaskInput({
        title: "提醒任务",
        reminders: [
          {
            id: " reminder-1 ",
            triggerAt: "2026-05-16T03:00:00.000Z",
            status: "pending",
            message: "  出门  ",
          },
        ],
      }).reminders,
    ).toEqual([
      {
        id: "reminder-1",
        triggerAt: "2026-05-16T03:00:00.000Z",
        status: "pending",
        message: "出门",
      },
    ]);

    expect(() =>
      normalizeCreateTaskInput({
        title: "提醒任务",
        reminders: [
          { id: "reminder-1", triggerAt: "", status: "pending", message: null },
        ],
      }),
    ).toThrow("提醒时间必须是有效的 ISO 日期");
    expect(() =>
      normalizeUpdateTaskInput({
        reminders: [
          { id: "reminder-1", triggerAt: "不是日期", status: "pending", message: null },
        ],
      }),
    ).toThrow("提醒时间必须是有效的 ISO 日期");
  });

  it("将 SQLite 行映射为任务对象", () => {
    expect(
      mapTaskRow({
        id: "task-1",
        title: "Today plan",
        notes: null,
        status: "active",
        priority: 2,
        start_at: null,
        due_at: "2026-05-16T03:00:00.000Z",
        estimate_min: 45,
        resources: "[]",
        reminders: "[]",
        checklist: "[]",
        parent_id: null,
        child_order: 0,
        tags: '["focus","writing"]',
        list_id: "inbox",
        created_at: "2026-05-15T01:00:00.000Z",
        updated_at: "2026-05-15T01:30:00.000Z",
        completed_at: null,
      }),
    ).toEqual({
      id: "task-1",
      title: "Today plan",
      notes: null,
      status: "active",
      priority: 2,
      startAt: null,
      dueAt: "2026-05-16T03:00:00.000Z",
      estimateMin: 45,
      resources: [],
      reminders: [],
      checklist: [],
      parentId: null,
      childOrder: 0,
      tags: ["focus", "writing"],
      listId: "inbox",
      categoryId: null,
      createdAt: "2026-05-15T01:00:00.000Z",
      updatedAt: "2026-05-15T01:30:00.000Z",
      completedAt: null,
    });
  });

  it("分组今日未完成、逾期和已完成任务", () => {
    const now = new Date("2026-05-16T12:00:00+08:00");
    const groups = groupTodayTasks(
      [
        task({ id: "overdue", dueAt: "2026-05-15T04:00:00.000Z" }),
        task({ id: "today", dueAt: "2026-05-16T05:00:00.000Z" }),
        task({
          id: "done",
          status: "completed",
          dueAt: "2026-05-16T02:00:00.000Z",
          completedAt: "2026-05-16T06:00:00.000Z",
        }),
      ],
      now,
    );

    expect(groups.overdue.map((item) => item.id)).toEqual(["overdue"]);
    expect(groups.dueToday.map((item) => item.id)).toEqual(["today"]);
    expect(groups.completedToday.map((item) => item.id)).toEqual(["done"]);
  });
});

describe("TaskRepository 仓储", () => {
  it("初始化 schema 并加载固定 momo 数据库", async () => {
    const db = new RecordingDatabase();
    const repository = createTaskRepository(() => Promise.resolve(db));

    await repository.init();

    expect(repository.databasePath).toBe("sqlite:momo.db");
    expect(db.executedSql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS tasks");
    expect(db.executedSql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(db.executedSql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS local_changes");
    expect(db.executedSql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS sync_state");
    expect(db.executedSql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS sync_runs");
    expect(db.executedSql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS task_sync_versions");
    expect(db.executedSql.join("\n")).toContain("CREATE TABLE IF NOT EXISTS entity_sync_versions");
  });

  it("创建规范化 active 任务行并记录本地变更", async () => {
    const db = new RecordingDatabase();
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T04:00:00.000Z"),
      id: () => "task-1",
      changeId: () => "change-1",
    });

    const task = await repository.createTask({
      title: "  Read inbox  ",
      dueAt: "2026-05-16T09:30:00.000Z",
      priority: 1,
      tags: ["work"],
    });

    expect(task).toMatchObject({
      id: "task-1",
      title: "Read inbox",
      status: "active",
      dueAt: "2026-05-16T09:30:00.000Z",
      priority: 1,
      tags: ["work"],
      createdAt: "2026-05-16T04:00:00.000Z",
    });
    expect(db.paramsForSql("INSERT INTO tasks")).toEqual([
      "task-1",
      "Read inbox",
      null,
      "active",
      1,
      null,
      "2026-05-16T09:30:00.000Z",
      null,
      "[]",
      "[]",
      "[]",
      null,
      0,
      '["work"]',
      "inbox",
      null,
      "2026-05-16T04:00:00.000Z",
      "2026-05-16T04:00:00.000Z",
      null,
    ]);
    expect(db.paramsForSql("INSERT INTO local_changes")).toEqual([
      "change-1",
      "task",
      "task-1",
      "task.create",
      JSON.stringify(task),
      "2026-05-16T04:00:00.000Z",
      null,
    ]);
  });

  it("日程查询分别按开始和截止时间匹配窗口", async () => {
    const db = new RecordingDatabase({
      taskRows: [
        taskRow({
          id: "task-due-in-window",
          start_at: "2026-06-01T00:00:00.000Z",
          due_at: "2026-06-10T00:00:00.000Z",
        }),
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db));

    const tasks = await repository.listAgenda(
      new Date("2026-06-09T00:00:00.000Z"),
      new Date("2026-06-16T00:00:00.000Z"),
    );

    const query = db.calls.find((call) => call.sql.includes("FROM tasks") && call.sql.includes("due_at IS NOT NULL"));
    expect(query?.sql).toContain("start_at IS NOT NULL AND start_at >= $1 AND start_at <= $2");
    expect(query?.sql).toContain("due_at IS NOT NULL AND due_at >= $1 AND due_at <= $2");
    expect(query?.sql).not.toContain("AND COALESCE(start_at, due_at) >=");
    expect(query?.params).toEqual([
      "2026-06-09T00:00:00.000Z",
      "2026-06-16T00:00:00.000Z",
    ]);
    expect(tasks.map((task) => task.id)).toEqual(["task-due-in-window"]);
  });

  it("列出待同步本地变更并标记 synced", async () => {
    const db = new RecordingDatabase({
      localChanges: [
        {
          id: "change-1",
          entity_type: "task",
          entity_id: "task-1",
          action: "task.update",
          payload: '{"title":"Updated"}',
          created_at: "2026-05-16T04:00:00.000Z",
          synced_at: null,
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T05:00:00.000Z"),
    });

    await expect(repository.listPendingChanges()).resolves.toEqual([
      {
        id: "change-1",
        entityType: "task",
        entityId: "task-1",
        action: "task.update",
        payload: { title: "Updated" },
        createdAt: "2026-05-16T04:00:00.000Z",
        syncedAt: null,
      },
    ]);

    await repository.markChangeSynced("change-1");

    expect(db.paramsForSql("UPDATE local_changes")).toEqual([
      "2026-05-16T05:00:00.000Z",
      "change-1",
    ]);
  });

  it("加载带待同步本地变更的数据库统计", async () => {
    const db = new RecordingDatabase({
      stats: [
        {
          total_tasks: 4,
          active_tasks: 2,
          completed_tasks: 1,
          pending_local_changes: 3,
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db));

    await expect(repository.getStats()).resolves.toEqual({
      databasePath: "sqlite:momo.db",
      totalTasks: 4,
      activeTasks: 2,
      completedTasks: 1,
      pendingLocalChanges: 3,
    });
  });

  it("加载并保存本地同步 cursor 状态", async () => {
    const db = new RecordingDatabase({
      syncState: [
        {
          id: "default",
          server_cursor: "cursor-7",
          last_synced_at: "2026-05-16T12:00:00.000Z",
          last_error: "previous failure",
          updated_at: "2026-05-16T12:01:00.000Z",
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:02:00.000Z"),
    });

    await expect(repository.getSyncState()).resolves.toEqual({
      serverCursor: "cursor-7",
      lastSyncedAt: "2026-05-16T12:00:00.000Z",
      lastError: "previous failure",
      updatedAt: "2026-05-16T12:01:00.000Z",
    });

    await expect(
      repository.saveSyncState({
        serverCursor: "cursor-8",
        lastSyncedAt: "2026-05-16T12:03:00.000Z",
        lastError: null,
      }),
    ).resolves.toEqual({
      serverCursor: "cursor-8",
      lastSyncedAt: "2026-05-16T12:03:00.000Z",
      lastError: null,
      updatedAt: "2026-05-16T12:02:00.000Z",
    });

    expect(db.paramsForSql("INSERT INTO sync_state")).toEqual([
      "default",
      "cursor-8",
      "2026-05-16T12:03:00.000Z",
      null,
      "2026-05-16T12:02:00.000Z",
    ]);
  });

  it("首次同步前返回空本地同步状态", async () => {
    const repository = createTaskRepository(
      () => Promise.resolve(new RecordingDatabase()),
    );

    await expect(repository.getSyncState()).resolves.toEqual({
      serverCursor: null,
      lastSyncedAt: null,
      lastError: null,
      updatedAt: null,
    });
  });

  it("记录并列出最近同步运行", async () => {
    const db = new RecordingDatabase({
      syncRuns: [
        {
          id: "run-2",
          status: "failed",
          started_at: "2026-05-16T12:03:00.000Z",
          finished_at: "2026-05-16T12:03:05.000Z",
          message: "transport unavailable",
          server_cursor: null,
        },
        {
          id: "run-1",
          status: "succeeded",
          started_at: "2026-05-16T12:00:00.000Z",
          finished_at: "2026-05-16T12:00:05.000Z",
          message: "已完成同步",
          server_cursor: "cursor-8",
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db), {
      id: () => "task-id",
      changeId: () => "change-id",
      syncRunId: () => "run-3",
    });

    await expect(
      repository.recordSyncRun({
        status: "succeeded",
        startedAt: "2026-05-16T12:05:00.000Z",
        finishedAt: "2026-05-16T12:05:04.000Z",
        message: "已同步 1 个本地变更",
        serverCursor: "cursor-9",
      }),
    ).resolves.toEqual({
      id: "run-3",
      status: "succeeded",
      startedAt: "2026-05-16T12:05:00.000Z",
      finishedAt: "2026-05-16T12:05:04.000Z",
      message: "已同步 1 个本地变更",
      serverCursor: "cursor-9",
    });
    expect(db.paramsForSql("INSERT INTO sync_runs")).toEqual([
      "run-3",
      "succeeded",
      "2026-05-16T12:05:00.000Z",
      "2026-05-16T12:05:04.000Z",
      "已同步 1 个本地变更",
      "cursor-9",
    ]);

    await expect(repository.listRecentSyncRuns(2)).resolves.toEqual([
      {
        id: "run-2",
        status: "failed",
        startedAt: "2026-05-16T12:03:00.000Z",
        finishedAt: "2026-05-16T12:03:05.000Z",
        message: "transport unavailable",
        serverCursor: null,
      },
      {
        id: "run-1",
        status: "succeeded",
        startedAt: "2026-05-16T12:00:00.000Z",
        finishedAt: "2026-05-16T12:00:05.000Z",
        message: "已完成同步",
        serverCursor: "cursor-8",
      },
    ]);
    expect(db.paramsForSql("SELECT * FROM sync_runs")).toEqual([2]);
  });

  it("应用拉取的远端任务变更且不记录本地变更", async () => {
    const db = new RecordingDatabase();
    const repository = createTaskRepository(() => Promise.resolve(db));

    await repository.applyRemoteTask({
      id: "task-remote",
      title: "Remote task",
      notes: "From sync",
      status: "active",
      priority: 2,
      dueAt: "2026-05-17T02:30:00.000Z",
      estimateMin: 25,
      tags: ["sync"],
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T11:00:00.000Z",
      completedAt: null,
    });

    expect(db.paramsForSql("INSERT INTO tasks")).toEqual([
      "task-remote",
      "Remote task",
      "From sync",
      "active",
      2,
      null,
      "2026-05-17T02:30:00.000Z",
      25,
      "[]",
      "[]",
      "[]",
      null,
      0,
      '["sync"]',
      "inbox",
      null,
      "2026-05-16T10:00:00.000Z",
      "2026-05-16T11:00:00.000Z",
      null,
    ]);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO local_changes")))
      .toBe(false);
  });

  it("在任务 UI 模型外存储拉取的远端任务版本", async () => {
    const db = new RecordingDatabase();
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
    });

    await repository.applyRemoteTask(
      {
        id: "task-remote",
        title: "Remote task",
        notes: null,
        status: "active",
        priority: 1,
        dueAt: null,
        estimateMin: null,
        tags: [],
        createdAt: "2026-05-16T10:00:00.000Z",
        updatedAt: "2026-05-16T11:00:00.000Z",
        completedAt: null,
      },
      8,
    );

    expect(db.paramsForSql("INSERT INTO entity_sync_versions")).toEqual([
      "task",
      "task-remote",
      8,
      "2026-05-16T12:00:00.000Z",
    ]);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO local_changes")))
      .toBe(false);
  });

  it("已知远端版本时在本地更新中记录 baseVersion", async () => {
    const db = new RecordingDatabase({
      taskRows: [
        taskRow({
          id: "task-1",
          title: "Local edit",
          updated_at: "2026-05-16T12:00:00.000Z",
        }),
      ],
      taskSyncVersions: [
        {
          task_id: "task-1",
          remote_version: 8,
          updated_at: "2026-05-16T11:00:00.000Z",
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      changeId: () => "change-1",
    });

    await repository.updateTask("task-1", { title: "Local edit" });

    const localChangeParams = db.paramsForSql("INSERT INTO local_changes");
    expect(localChangeParams?.slice(0, 4)).toEqual([
      "change-1",
      "task",
      "task-1",
      "task.update",
    ]);
    expect(JSON.parse(localChangeParams?.[4] as string)).toEqual({
      id: "task-1",
      baseVersion: 8,
      patch: { title: "Local edit" },
      updatedAt: "2026-05-16T12:00:00.000Z",
    });
  });

  it("已知远端版本时在本地状态变更中记录 baseVersion", async () => {
    const db = new RecordingDatabase({
      taskRows: [
        taskRow({
          id: "task-1",
          status: "completed",
          completed_at: "2026-05-16T12:00:00.000Z",
          updated_at: "2026-05-16T12:00:00.000Z",
        }),
      ],
      taskSyncVersions: [
        {
          task_id: "task-1",
          remote_version: 5,
          updated_at: "2026-05-16T11:00:00.000Z",
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      changeId: () => "change-status",
    });

    await repository.setStatus("task-1", "completed");

    const localChangeParams = db.paramsForSql("INSERT INTO local_changes");
    expect(localChangeParams?.slice(0, 4)).toEqual([
      "change-status",
      "task",
      "task-1",
      "task.status",
    ]);
    expect(JSON.parse(localChangeParams?.[4] as string)).toEqual({
      id: "task-1",
      baseVersion: 5,
      status: "completed",
      completedAt: "2026-05-16T12:00:00.000Z",
      updatedAt: "2026-05-16T12:00:00.000Z",
    });
  });

  it("创建和重命名清单会记录清单本地变更", async () => {
    const db = new RecordingDatabase({
      taskLists: [
        {
          id: "list-1",
          name: "项目更新",
          color: "#ff0000",
          archived: 0,
          list_order: 0,
          created_at: "2026-05-16T10:00:00.000Z",
          updated_at: "2026-05-16T12:00:00.000Z",
        },
      ],
    });
    const ids = ["list-1", "change-create", "change-update"];
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      id: () => ids.shift() ?? "id",
      changeId: () => ids.shift() ?? "change",
    });

    await repository.createList({ name: " 项目 ", color: " #ff0000 " });
    await repository.updateList("list-1", { name: "项目更新" });

    const changes = db.paramsForAllSql("INSERT INTO local_changes");
    expect(changes[0]?.slice(0, 4)).toEqual(["change-create", "taskList", "list-1", "taskList.create"]);
    expect(JSON.parse(changes[0]?.[4] as string)).toMatchObject({
      id: "list-1",
      name: "项目",
      color: "#ff0000",
      archived: false,
    });
    expect(changes[1]?.slice(0, 4)).toEqual(["change-update", "taskList", "list-1", "taskList.update"]);
    expect(JSON.parse(changes[1]?.[4] as string)).toMatchObject({
      id: "list-1",
      patch: { name: "项目更新" },
      updatedAt: "2026-05-16T12:00:00.000Z",
    });
  });

  it("归档清单时迁移任务到收件箱并记录本地变更", async () => {
    const db = new RecordingDatabase({
      taskRows: [
        taskRow({
          id: "task-in-list",
          list_id: "list-1",
          updated_at: "2026-05-16T12:00:00.000Z",
        }),
      ],
      taskSyncVersions: [
        {
          task_id: "task-in-list",
          remote_version: 9,
          updated_at: "2026-05-16T11:00:00.000Z",
        },
      ],
      taskLists: [
        {
          id: "list-1",
          name: "项目",
          color: null,
          archived: 1,
          list_order: 0,
          created_at: "2026-05-16T10:00:00.000Z",
          updated_at: "2026-05-16T12:00:00.000Z",
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
      changeId: () => "change-list",
    });

    await repository.archiveList("list-1");

    expect(db.paramsForLastSql("UPDATE tasks SET list_id")).toEqual([
      "inbox",
      null,
      "2026-05-16T12:00:00.000Z",
      "list-1",
    ]);
    const changes = db.paramsForAllSql("INSERT INTO local_changes");
    expect(changes[0]?.slice(0, 4)).toEqual([
      "change-list",
      "taskList",
      "list-1",
      "taskList.archive",
    ]);
    expect(JSON.parse(changes[0]?.[4] as string)).toEqual({
      id: "list-1",
      archived: true,
      updatedAt: "2026-05-16T12:00:00.000Z",
    });
    const localChangeParams = changes[1];
    expect(localChangeParams?.slice(0, 4)).toEqual([
      "change-list",
      "task",
      "task-in-list",
      "task.update",
    ]);
    expect(JSON.parse(localChangeParams?.[4] as string)).toEqual({
      id: "task-in-list",
      baseVersion: 9,
      patch: { listId: "inbox", categoryId: null },
      updatedAt: "2026-05-16T12:00:00.000Z",
    });
  });

  it("应用和删除远端清单不会记录本地变更", async () => {
    const db = new RecordingDatabase();
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
    });

    await repository.applyRemoteList(
      {
        id: "list-remote",
        name: "远端清单",
        color: null,
        archived: false,
        order: 2,
        createdAt: "2026-05-16T10:00:00.000Z",
        updatedAt: "2026-05-16T11:00:00.000Z",
      },
      3,
    );
    await repository.deleteRemoteList("list-remote");

    expect(db.paramsForSql("INSERT INTO task_lists")).toEqual([
      "list-remote",
      "远端清单",
      null,
      0,
      2,
      "2026-05-16T10:00:00.000Z",
      "2026-05-16T11:00:00.000Z",
    ]);
    expect(db.paramsForSql("INSERT INTO entity_sync_versions")).toEqual([
      "taskList",
      "list-remote",
      3,
      "2026-05-16T12:00:00.000Z",
    ]);
    expect(db.paramsForLastSql("UPDATE tasks SET list_id")).toEqual([
      "inbox",
      null,
      "2026-05-16T12:00:00.000Z",
      "list-remote",
    ]);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO local_changes"))).toBe(false);
  });

  it("创建、重命名和删除清单内分类会记录分类同步变更", async () => {
    const db = new RecordingDatabase({
      taskCategories: [
        {
          id: "category-1",
          list_id: "list-1",
          name: "工作",
          category_order: 1,
          created_at: "2026-05-16T10:00:00.000Z",
          updated_at: "2026-05-16T12:00:00.000Z",
        },
      ],
    });
    const ids = ["category-1", "change-create", "change-update", "change-delete"];
    const repository = createTaskRepository(() => Promise.resolve(db), {
      id: () => ids.shift() ?? "id",
      changeId: () => ids.shift() ?? "change",
      now: () => new Date("2026-05-16T12:00:00.000Z"),
    });

    await expect(repository.createCategory({ listId: "list-1", name: " 工作 " })).resolves.toMatchObject({
      id: "category-1",
      listId: "list-1",
      name: "工作",
      order: 0,
    });
    await expect(repository.updateCategory("category-1", { name: "工作区", order: 2 })).resolves.toMatchObject({
      id: "category-1",
      name: "工作",
      order: 1,
    });
    await repository.deleteCategory("category-1");

    expect(db.paramsForSql("INSERT INTO task_categories")).toEqual([
      "category-1",
      "list-1",
      "工作",
      0,
      "2026-05-16T12:00:00.000Z",
      "2026-05-16T12:00:00.000Z",
    ]);
    expect(db.paramsForSql("UPDATE task_categories")).toEqual([
      "工作区",
      2,
      "2026-05-16T12:00:00.000Z",
      "category-1",
    ]);
    expect(db.paramsForSql("UPDATE tasks SET category_id")).toEqual([
      null,
      "2026-05-16T12:00:00.000Z",
      "category-1",
    ]);
    expect(db.paramsForSql("DELETE FROM task_categories")).toEqual(["category-1"]);
    const changes = db.paramsForAllSql("INSERT INTO local_changes");
    expect(changes.map((change) => change?.slice(1, 4))).toEqual([
      ["taskCategory", "category-1", "taskCategory.create"],
      ["taskCategory", "category-1", "taskCategory.update"],
      ["taskCategory", "category-1", "taskCategory.delete"],
    ]);
  });

  it("删除远端分类会把任务移回未分类且不记录本地变更", async () => {
    const db = new RecordingDatabase();
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
    });

    await repository.deleteRemoteCategory("category-1");

    expect(db.paramsForSql("UPDATE tasks SET category_id")).toEqual([
      null,
      "2026-05-16T12:00:00.000Z",
      "category-1",
    ]);
    expect(db.paramsForSql("DELETE FROM task_categories")).toEqual(["category-1"]);
    expect(db.paramsForSql("DELETE FROM entity_sync_versions")).toEqual(["taskCategory", "category-1"]);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO local_changes"))).toBe(false);
  });

  it("任务更新可保存清单内分类", async () => {
    const db = new RecordingDatabase({
      taskRows: [taskRow({ id: "task-1", category_id: "category-1" })],
      taskCategories: [
        {
          id: "category-1",
          list_id: "list-1",
          name: "工作",
          category_order: 0,
          created_at: "2026-05-16T10:00:00.000Z",
          updated_at: "2026-05-16T10:00:00.000Z",
        },
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db), {
      now: () => new Date("2026-05-16T12:00:00.000Z"),
    });

    await expect(repository.updateTask("task-1", { categoryId: "category-1" })).resolves.toMatchObject({
      id: "task-1",
      categoryId: "category-1",
    });

    expect(db.paramsForLastSql("UPDATE tasks SET")).toContain("category-1");
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO local_changes"))).toBe(true);
  });

  it("拒绝将任务父级设置为自己或后代", async () => {
    const db = new RecordingDatabase({
      taskRows: [
        taskRow({ id: "parent", parent_id: null }),
        taskRow({ id: "child", parent_id: "parent" }),
      ],
    });
    const repository = createTaskRepository(() => Promise.resolve(db));

    await expect(repository.updateTask("parent", { parentId: "parent" })).rejects.toThrow("父任务不能是当前任务或其子任务");
    await expect(repository.updateTask("parent", { parentId: "child" })).rejects.toThrow("父任务不能是当前任务或其子任务");
    await expect(repository.updateTask("child", { parentId: null })).resolves.toMatchObject({ id: "child" });
  });

  it("应用拉取的远端任务删除且不记录本地变更", async () => {
    const db = new RecordingDatabase();
    const repository = createTaskRepository(() => Promise.resolve(db));

    await repository.deleteRemoteTask("task-remote");

    expect(db.paramsForSql("DELETE FROM tasks")).toEqual(["task-remote"]);
    expect(db.paramsForSql("DELETE FROM entity_sync_versions")).toEqual(["task", "task-remote"]);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO local_changes")))
      .toBe(false);
  });
});

function task(overrides: Partial<ReturnType<typeof baseTask>>) {
  return { ...baseTask(), ...overrides };
}

function baseTask() {
  return {
    id: "task",
    title: "Task",
    notes: null,
    status: "active" as const,
    priority: 0 as const,
    startAt: null,
    dueAt: null,
    estimateMin: null,
    resources: [],
    reminders: [],
    checklist: [],
    parentId: null,
    childOrder: 0,
    tags: [],
    listId: "inbox",
    categoryId: null,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    completedAt: null,
  };
}

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task",
    title: "Task",
    notes: null,
    status: "active",
    priority: 0,
    start_at: null,
    due_at: null,
    estimate_min: null,
    resources: "[]",
    reminders: "[]",
    checklist: "[]",
    parent_id: null,
    child_order: 0,
    tags: "[]",
    list_id: "inbox",
    category_id: null,
    created_at: "2026-05-16T00:00:00.000Z",
    updated_at: "2026-05-16T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

class RecordingDatabase implements SqlDatabase {
  calls: Array<{ sql: string; params?: unknown[] }> = [];

  constructor(private rows: {
    localChanges?: LocalChangeRow[];
    taskRows?: TaskRow[];
    taskLists?: TaskListRow[];
    taskCategories?: TaskCategoryRow[];
    taskSyncVersions?: TaskSyncVersionRow[];
    entitySyncVersions?: EntitySyncVersionRow[];
    syncState?: SyncStateRow[];
    syncRuns?: SyncRunRow[];
    stats?: Array<{
      total_tasks: number;
      active_tasks: number;
      completed_tasks: number;
      pending_local_changes: number;
    }>;
  } = {}) {}

  get executedSql() {
    return this.calls.map((call) => call.sql);
  }

  async execute(sql: string, params?: unknown[]) {
    this.calls.push({ sql, params });
    return { rowsAffected: 1 };
  }

  async select<T>(sql: string, params?: unknown[]) {
    this.calls.push({ sql, params });
    if (sql.includes("COUNT(*) AS total_tasks")) {
      return (this.rows.stats ?? []) as T[];
    }
    if (sql.includes("FROM local_changes")) {
      return (this.rows.localChanges ?? []) as T[];
    }
    if (sql.includes("FROM entity_sync_versions")) {
      return (this.rows.entitySyncVersions ?? []) as T[];
    }
    if (sql.includes("FROM task_sync_versions")) {
      return (this.rows.taskSyncVersions ?? []) as T[];
    }
    if (sql.includes("FROM task_lists")) {
      return (this.rows.taskLists ?? []) as T[];
    }
    if (sql.includes("FROM task_categories")) {
      return (this.rows.taskCategories ?? []) as T[];
    }
    if (sql.includes("FROM tasks")) {
      if (sql.includes("WHERE id = $1")) {
        return (this.rows.taskRows ?? []).filter((row) => row.id === params?.[0]) as T[];
      }
      return (this.rows.taskRows ?? []) as T[];
    }
    if (sql.includes("FROM sync_state")) {
      return (this.rows.syncState ?? []) as T[];
    }
    if (sql.includes("FROM sync_runs")) {
      return (this.rows.syncRuns ?? []) as T[];
    }
    return [] as T[];
  }

  paramsForSql(fragment: string) {
    return this.calls.find((call) => call.sql.includes(fragment))?.params;
  }

  paramsForLastSql(fragment: string) {
    return [...this.calls].reverse().find((call) => call.sql.includes(fragment))?.params;
  }

  paramsForAllSql(fragment: string) {
    return this.calls.filter((call) => call.sql.includes(fragment)).map((call) => call.params);
  }
}
