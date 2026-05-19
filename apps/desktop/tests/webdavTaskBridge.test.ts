import { describe, expect, it } from "vitest";
import type { Entity } from "../src/sync/types/entity";
import type { LocalChange } from "../src/data/taskRepository";
import {
  entityToTask,
  localChangeToOp,
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

  it("非 task entityType 抛错（caller 应预先 filter）", () => {
    const change = baseChange({
      entityType: "project" as unknown as "task",
    });
    expect(() => localChangeToOp(change, { deviceId: "desk-a" })).toThrow(
      /task/,
    );
  });
});

describe("Entity → Task 解码", () => {
  function makeEntity(payload: Record<string, unknown>): Entity<unknown> {
    return {
      id: "t-1",
      type: TASK_ENTITY_TYPE,
      schemaVersion: 1,
      payload,
      updatedAt: "2026-05-19T13:00:00.000Z",
      originDevice: "desk-b",
    };
  }

  it("完整字段照射成 Task，updatedAt 来自 entity 顶层", () => {
    const entity = makeEntity({
      title: "拉回任务",
      notes: "备注",
      status: "active",
      priority: 2,
      dueAt: "2026-05-20T09:00:00.000Z",
      estimateMin: 30,
      tags: ["a", "b"],
      createdAt: "2026-05-18T10:00:00.000Z",
      completedAt: null,
    });
    expect(entityToTask(entity)).toEqual({
      id: "t-1",
      title: "拉回任务",
      notes: "备注",
      status: "active",
      priority: 2,
      dueAt: "2026-05-20T09:00:00.000Z",
      estimateMin: 30,
      tags: ["a", "b"],
      createdAt: "2026-05-18T10:00:00.000Z",
      updatedAt: "2026-05-19T13:00:00.000Z",
      completedAt: null,
    });
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
