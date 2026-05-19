// BE-12 sprint-4.3b：task 实体的 LocalChange ↔ Op、Entity ↔ Task 翻译层。
//
// 边界：
//   - 只处理 task 一种实体；project/calendar-event/reminder 留后续 sprint；
//   - 不直接接 SQLite / 不接 plugin-store；仅做 in-memory 转换。
//
// 关键约定：
//   - `task.create` 折算为 op:'put'，params 为完整 Task 快照；
//   - `task.update` 折算为 op:'patch'，params 为补丁字段（含 updatedAt）；
//   - `task.status` 折算为 op:'patch'，params 为 `{ status, completedAt, updatedAt }`；
//   - `task.delete` 折算为 op:'delete'，params 为 null；
//   - LocalChange.createdAt 直接作为 op.ts（LWW 主键），保证本地与远端时钟一致；
//   - actor 默认为 deviceId；未来若引入多用户登录可改为 user id。

import type { Entity } from "../../backend/contracts/entity";
import type { Op } from "../../backend/contracts/op";
import type { LocalChange } from "../../data/taskRepository";
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "../../domain/tasks";

export const TASK_ENTITY_TYPE = "task";
export const TASK_SCHEMA_VERSION = 1;

export interface LocalChangeToOpOptions {
  readonly deviceId: string;
  readonly actor?: string;
}

const VALID_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "active",
  "completed",
  "archived",
]);

/**
 * 把单条 LocalChange 折算为 Op；非 task entity 抛错（caller 应预先 filter）。
 */
export function localChangeToOp(
  change: LocalChange,
  options: LocalChangeToOpOptions,
): Op {
  if (change.entityType !== TASK_ENTITY_TYPE) {
    throw new Error(
      `WebDAV 同步：本 bridge 只支持 task，遇到 ${change.entityType}`,
    );
  }
  const actor = options.actor ?? options.deviceId;
  const base = {
    ts: change.createdAt,
    actor,
    originDevice: options.deviceId,
    target: { entityType: TASK_ENTITY_TYPE, entityId: change.entityId },
  } as const;

  switch (change.action) {
    case "task.create": {
      const payload = unwrapTaskCreatePayload(change.payload);
      return { op: "put", params: payload, ...base };
    }
    case "task.update": {
      const params = unwrapTaskUpdatePayload(change.payload);
      return { op: "patch", params, ...base };
    }
    case "task.status": {
      const params = unwrapTaskStatusPayload(change.payload);
      return { op: "patch", params, ...base };
    }
    case "task.delete":
      return { op: "delete", params: null, ...base };
  }
}

/**
 * Entity<unknown> → Task：把 WebDAV 上拉回的 entity payload 解码为本地 Task。
 * 缺失字段以默认值兜底；status/priority 越界则抛错（避免静默写脏数据）。
 */
export function entityToTask(entity: Entity<unknown>): Task {
  if (entity.type !== TASK_ENTITY_TYPE) {
    throw new Error(`WebDAV 同步：非 task entity 不能转 Task：${entity.type}`);
  }
  const payload = isPlainObject(entity.payload)
    ? (entity.payload as Record<string, unknown>)
    : {};
  return {
    id: entity.id,
    title: asString(payload.title, "task.title"),
    notes: asNullableString(payload.notes),
    status: asTaskStatus(payload.status),
    priority: asTaskPriority(payload.priority),
    dueAt: asNullableString(payload.dueAt),
    estimateMin: asNullableNumber(payload.estimateMin),
    tags: asStringArray(payload.tags),
    createdAt: asString(payload.createdAt, "task.createdAt"),
    updatedAt: entity.updatedAt,
    completedAt: asNullableString(payload.completedAt),
  };
}

function unwrapTaskCreatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error("WebDAV 同步：task.create payload 必须为对象");
  }
  return { ...(raw as Record<string, unknown>) };
}

function unwrapTaskUpdatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error("WebDAV 同步：task.update payload 必须为对象");
  }
  const record = raw as Record<string, unknown>;
  const patch = record.patch;
  if (!isPlainObject(patch)) {
    throw new Error("WebDAV 同步：task.update.patch 缺失或非对象");
  }
  const fields = { ...(patch as Record<string, unknown>) };
  if (typeof record.updatedAt === "string") {
    fields.updatedAt = record.updatedAt;
  }
  return fields;
}

function unwrapTaskStatusPayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error("WebDAV 同步：task.status payload 必须为对象");
  }
  const record = raw as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== "string" || !VALID_TASK_STATUSES.has(status as TaskStatus)) {
    throw new Error(`WebDAV 同步：task.status.status 非法：${String(status)}`);
  }
  const fields: Record<string, unknown> = { status };
  if ("completedAt" in record) {
    fields.completedAt = record.completedAt;
  }
  if (typeof record.updatedAt === "string") {
    fields.updatedAt = record.updatedAt;
  }
  return fields;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`WebDAV 同步：${field} 必须为字符串`);
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`WebDAV 同步：字段必须为字符串或 null：${String(value)}`);
  }
  return value;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`WebDAV 同步：字段必须为数字或 null：${String(value)}`);
  }
  return value;
}

function asTaskStatus(value: unknown): TaskStatus {
  if (typeof value !== "string" || !VALID_TASK_STATUSES.has(value as TaskStatus)) {
    throw new Error(`WebDAV 同步：task.status 非法：${String(value)}`);
  }
  return value as TaskStatus;
}

function asTaskPriority(value: unknown): TaskPriority {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`WebDAV 同步：task.priority 必须为整数`);
  }
  if (value < 0 || value > 3) {
    throw new Error(`WebDAV 同步：task.priority 越界：${value}`);
  }
  return value as TaskPriority;
}

function asStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("WebDAV 同步：task.tags 必须为数组");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`WebDAV 同步：task.tags[${index}] 非字符串`);
    }
    return entry;
  });
}
