import { describe, expect, it } from "vitest";
import type { Entity } from "../src/sync/types/entity";
import type { LocalChange } from "../src/data/taskRepository";
import {
  entityToTaskList,
  entityToTaskCategory,
  entityToTask,
  localChangeToOp,
  TASK_CATEGORY_ENTITY_TYPE,
  TASK_LIST_ENTITY_TYPE,
  TASK_ENTITY_TYPE,
} from "../src/sync/webdav/taskBridge";

function baseChange(overrides: Partial<LocalChange> = {}): LocalChange {
  return {
    id: "lc-1",
    entityType: "task",
    entityId: "t-1",
    action: "task.create",
    payload: {},
    createdAt: "2026-05-19T10:00:00.000Z",
    syncedAt: null,
    ...overrides,
  };
}

describe("LocalChange → Op 翻译", () => {
  it("task.create 折算为 put，params 是 payload 浅拷贝", () => {
    const payload = {
      id: "t-1",
      title: "写测试",
      priority: 1,
      status: "active",
    };
    const change = baseChange({ payload });
    const op = localChangeToOp(change, { deviceId: "desk-a" });
    expect(op).toEqual({
      op: "put",
      target: { entityType: "task", entityId: "t-1" },
      params: payload,
      ts: change.createdAt,
      actor: "desk-a",
      originDevice: "desk-a",
    });
    // 必须是拷贝，修改源不影响 op 内部
    (payload as Record<string, unknown>).title = "改名";
    expect((op.params as Record<string, unknown>).title).toBe("写测试");
  });

  it("task.update 折算为 patch，updatedAt 抬到顶层字段", () => {
    const change = baseChange({
      action: "task.update",
      payload: {
        patch: { title: "改后", priority: 2 },
        updatedAt: "2026-05-19T11:00:00.000Z",
      },
    });
    const op = localChangeToOp(change, { deviceId: "desk-a" });
    expect(op.op).toBe("patch");
    expect(op.params).toEqual({
      title: "改后",
      priority: 2,
      updatedAt: "2026-05-19T11:00:00.000Z",
    });
  });

  it("task.update 缺 patch 字段直接抛错", () => {
    const change = baseChange({
      action: "task.update",
      payload: { updatedAt: "2026-05-19T11:00:00.000Z" },
    });
    expect(() => localChangeToOp(change, { deviceId: "desk-a" })).toThrow(
      /patch/,
    );
  });

  it("task.status 折算为 patch，只带 status/completedAt/updatedAt", () => {
    const change = baseChange({
      action: "task.status",
      payload: {
        status: "completed",
        completedAt: "2026-05-19T12:00:00.000Z",
        updatedAt: "2026-05-19T12:00:00.000Z",
      },
    });
    const op = localChangeToOp(change, { deviceId: "desk-a" });
    expect(op.op).toBe("patch");
    expect(op.params).toEqual({
      status: "completed",
      completedAt: "2026-05-19T12:00:00.000Z",
      updatedAt: "2026-05-19T12:00:00.000Z",
    });
  });

  it("task.status 非法 status 抛错避免写脏 entity", () => {
    const change = baseChange({
      action: "task.status",
      payload: { status: "weird" },
    });
    expect(() => localChangeToOp(change, { deviceId: "desk-a" })).toThrow(
      /status/,
    );
  });

  it("task.delete 折算为 delete，params 为 null", () => {
    const change = baseChange({ action: "task.delete", payload: null });
    const op = localChangeToOp(change, { deviceId: "desk-a" });
    expect(op).toEqual({
      op: "delete",
      target: { entityType: "task", entityId: "t-1" },
      params: null,
      ts: change.createdAt,
      actor: "desk-a",
      originDevice: "desk-a",
    });
  });

  it("显式注入 actor 时优先于 deviceId", () => {
    const op = localChangeToOp(
      baseChange({ payload: { title: "a" } }),
      { deviceId: "desk-a", actor: "user-42" },
    );
    expect(op.actor).toBe("user-42");
    expect(op.originDevice).toBe("desk-a");
  });

  it("非支持 entityType 抛错（caller 应预先 filter）", () => {
    const change = baseChange({
      entityType: "project" as unknown as "task",
    });
    expect(() => localChangeToOp(change, { deviceId: "desk-a" })).toThrow(/实体类型/);
  });

  it("taskList.create 折算为 put", () => {
    const payload = {
      id: "list-1",
      name: "项目",
      color: null,
      archived: false,
      order: 0,
      createdAt: "2026-05-19T09:00:00.000Z",
      updatedAt: "2026-05-19T09:00:00.000Z",
    };
    const op = localChangeToOp(
      baseChange({
        entityType: "taskList",
        entityId: "list-1",
        action: "taskList.create",
        payload,
      }),
      { deviceId: "desk-a" },
    );
    expect(op).toMatchObject({
      op: "put",
      target: { entityType: "taskList", entityId: "list-1" },
      params: payload,
    });
  });

  it("taskList.update 折算为 patch，updatedAt 抬到顶层字段", () => {
    const op = localChangeToOp(
      baseChange({
        entityType: "taskList",
        entityId: "list-1",
        action: "taskList.update",
        payload: {
          patch: { name: "项目更新" },
          updatedAt: "2026-05-19T11:00:00.000Z",
        },
      }),
      { deviceId: "desk-a" },
    );
    expect(op.op).toBe("patch");
    expect(op.params).toEqual({
      name: "项目更新",
      updatedAt: "2026-05-19T11:00:00.000Z",
    });
  });

  it("taskList.archive 折算为 archived patch", () => {
    const op = localChangeToOp(
      baseChange({
        entityType: "taskList",
        entityId: "list-1",
        action: "taskList.archive",
        payload: {
          id: "list-1",
          archived: true,
          updatedAt: "2026-05-19T12:00:00.000Z",
        },
      }),
      { deviceId: "desk-a" },
    );
    expect(op.op).toBe("patch");
    expect(op.params).toEqual({
      archived: true,
      updatedAt: "2026-05-19T12:00:00.000Z",
    });
  });
});

describe("Entity → Task 解码", () => {
  function makeEntity(
    payload: Record<string, unknown>,
    overrides: Partial<Entity<unknown>> = {},
  ): Entity<unknown> {
    return {
      id: "t-1",
      type: TASK_ENTITY_TYPE,
      schemaVersion: 1,
      payload,
      updatedAt: "2026-05-19T13:00:00.000Z",
      originDevice: "desk-b",
      ...overrides,
    };
  }

  it("完整字段照射成 Task，updatedAt 来自 entity 顶层", () => {
    const entity = makeEntity({
      title: "拉回任务",
      notes: "备注",
      status: "active",
      priority: 2,
      startAt: null,
      dueAt: "2026-05-20T09:00:00.000Z",
      estimateMin: 30,
      resources: [],
      reminders: [],
      checklist: [],
      parentId: null,
      childOrder: 0,
      tags: ["a", "b"],
      listId: "inbox",
      categoryId: null,
      recurrence: null,
      deletedAt: null,
      lastReminderNotifiedAt: null,
      createdAt: "2026-05-18T10:00:00.000Z",
      completedAt: null,
    });
    expect(entityToTask(entity)).toEqual({
      id: "t-1",
      title: "拉回任务",
      notes: "备注",
      status: "active",
      priority: 2,
      startAt: null,
      dueAt: "2026-05-20T09:00:00.000Z",
      estimateMin: 30,
      resources: [],
      reminders: [],
      checklist: [],
      parentId: null,
      childOrder: 0,
      tags: ["a", "b"],
      listId: "inbox",
      categoryId: null,
      recurrence: null,
      deletedAt: null,
      lastReminderNotifiedAt: null,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-19T13:00:00.000Z",
      completedAt: null,
    });
  });

  it("合法任务时间字段解码后统一规范化为 ISO", () => {
    const task = entityToTask(
      makeEntity(
        {
          title: "跨时区任务",
          status: "completed",
          priority: 1,
          startAt: "2026-05-20T09:00:00+08:00",
          dueAt: "2026-05-21T10:00:00+08:00",
          createdAt: "2026-05-18T10:00:00+08:00",
          completedAt: "2026-05-22T11:00:00+08:00",
        },
        { updatedAt: "2026-05-19T13:00:00+08:00" },
      ),
    );

    expect(task.startAt).toBe("2026-05-20T01:00:00.000Z");
    expect(task.dueAt).toBe("2026-05-21T02:00:00.000Z");
    expect(task.createdAt).toBe("2026-05-18T02:00:00.000Z");
    expect(task.updatedAt).toBe("2026-05-19T05:00:00.000Z");
    expect(task.completedAt).toBe("2026-05-22T03:00:00.000Z");
  });

  it("远端任务时间字段非法时抛错避免写脏数据", () => {
    const cases: Array<{
      readonly payload: Record<string, unknown>;
      readonly entity?: Partial<Entity<unknown>>;
    }> = [
      { payload: { startAt: "" } },
      { payload: { dueAt: "不是日期" } },
      { payload: { completedAt: "not-a-date" } },
      { payload: { createdAt: "" } },
      { payload: {}, entity: { updatedAt: "不是日期" } },
    ];

    for (const item of cases) {
      expect(() =>
        entityToTask(
          makeEntity(
            {
              title: "坏时间",
              status: "active",
              priority: 0,
              createdAt: "2026-05-18T10:00:00.000Z",
              ...item.payload,
            },
            item.entity,
          ),
        ),
      ).toThrow(/WebDAV 同步：.*必须是有效的 ISO 日期/);
    }
  });

  it("notes/dueAt/estimateMin/completedAt 缺省时回落为 null", () => {
    const entity = makeEntity({
      title: "最小",
      status: "active",
      priority: 0,
      createdAt: "2026-05-18T10:00:00.000Z",
    });
    const task = entityToTask(entity);
    expect(task.notes).toBeNull();
    expect(task.dueAt).toBeNull();
    expect(task.estimateMin).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.tags).toEqual([]);
    expect(task.resources).toEqual([]);
    expect(task.reminders).toEqual([]);
    expect(task.checklist).toEqual([]);
    expect(task.listId).toBe("inbox");
  });

  it("完整解码合法提醒字段", () => {
    const reminder = {
      id: "reminder-1",
      triggerAt: "2026-05-20T08:30:00.000Z",
      status: "pending",
      message: "开会",
    };
    const task = entityToTask(
      makeEntity({
        title: "提醒任务",
        status: "active",
        priority: 0,
        createdAt: "2026-05-18T10:00:00.000Z",
        reminders: [reminder],
      }),
    );

    expect(task.reminders).toEqual([reminder]);
  });

  it("远端提醒时间非法时抛错避免写脏数据", () => {
    expect(() =>
      entityToTask(
        makeEntity({
          title: "坏提醒",
          status: "active",
          priority: 0,
          createdAt: "2026-05-18T10:00:00.000Z",
          reminders: [
            {
              id: "reminder-1",
              triggerAt: "",
              status: "pending",
              message: null,
            },
          ],
        }),
      ),
    ).toThrow(/triggerAt.*ISO/);
    expect(() =>
      entityToTask(
        makeEntity({
          title: "坏提醒",
          status: "active",
          priority: 0,
          createdAt: "2026-05-18T10:00:00.000Z",
          reminders: [
            {
              id: "reminder-1",
              triggerAt: "不是日期",
              status: "pending",
              message: null,
            },
          ],
        }),
      ),
    ).toThrow(/triggerAt.*ISO/);
  });

  it("status / priority 越界时抛错避免写脏数据", () => {
    expect(() =>
      entityToTask(
        makeEntity({
          title: "x",
          status: "weird",
          priority: 0,
          createdAt: "2026-05-18T10:00:00.000Z",
        }),
      ),
    ).toThrow(/status/);
    expect(() =>
      entityToTask(
        makeEntity({
          title: "x",
          status: "active",
          priority: 99,
          createdAt: "2026-05-18T10:00:00.000Z",
        }),
      ),
    ).toThrow(/priority/);
  });

  it("非 task entity 抛错", () => {
    const entity: Entity<unknown> = {
      id: "p-1",
      type: "project",
      schemaVersion: 1,
      payload: { name: "x" },
      updatedAt: "2026-05-19T13:00:00.000Z",
      originDevice: "desk-b",
    };
    expect(() => entityToTask(entity)).toThrow(/task/);
  });

  it("tags 字段非字符串数组抛错", () => {
    expect(() =>
      entityToTask(
        makeEntity({
          title: "x",
          status: "active",
          priority: 0,
          createdAt: "2026-05-18T10:00:00.000Z",
          tags: [1, 2],
        }),
      ),
    ).toThrow(/tags/);
  });
});

describe("Entity → TaskList 解码", () => {
  it("完整字段照射成 TaskList，updatedAt 来自 entity 顶层", () => {
    const entity: Entity<unknown> = {
      id: "list-1",
      type: TASK_LIST_ENTITY_TYPE,
      schemaVersion: 1,
      payload: {
        name: "项目",
        color: "#ff0000",
        archived: false,
        order: 2,
        createdAt: "2026-05-18T10:00:00.000Z",
      },
      updatedAt: "2026-05-19T13:00:00.000Z",
      originDevice: "desk-b",
    };

    expect(entityToTaskList(entity)).toEqual({
      id: "list-1",
      name: "项目",
      color: "#ff0000",
      archived: false,
      order: 2,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-19T13:00:00.000Z",
    });
  });

  it("清单字段非法时抛错避免写脏数据", () => {
    const entity: Entity<unknown> = {
      id: "list-1",
      type: TASK_LIST_ENTITY_TYPE,
      schemaVersion: 1,
      payload: {
        name: 1,
        createdAt: "2026-05-18T10:00:00.000Z",
      },
      updatedAt: "2026-05-19T13:00:00.000Z",
      originDevice: "desk-b",
    };

    expect(() => entityToTaskList(entity)).toThrow(/taskList.name/);
  });
});

describe("Entity → TaskCategory 解码", () => {
  it("完整字段照射成 TaskCategory，updatedAt 来自 entity 顶层", () => {
    const entity: Entity<unknown> = {
      id: "category-1",
      type: TASK_CATEGORY_ENTITY_TYPE,
      schemaVersion: 1,
      payload: {
        listId: "list-1",
        name: "工作",
        order: 2,
        createdAt: "2026-05-18T10:00:00.000Z",
      },
      updatedAt: "2026-05-19T13:00:00.000Z",
      originDevice: "desk-b",
    };

    expect(entityToTaskCategory(entity)).toEqual({
      id: "category-1",
      listId: "list-1",
      name: "工作",
      order: 2,
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-19T13:00:00.000Z",
    });
  });
});
