import type { Entity } from '../types/entity';
import type { Op } from '../types/op';
import type { LocalChange } from '../../data/taskRepository';
import type {
  Task,
  TaskCategory,
  TaskChecklistItem,
  TaskList,
  TaskPriority,
  TaskReminder,
  TaskResource,
  TaskStatus,
} from '../../domain/tasks';
import { hasValidDatePart } from '../../domain/dateTime';

export const TASK_ENTITY_TYPE = 'task';
export const TASK_LIST_ENTITY_TYPE = 'taskList';
export const TASK_CATEGORY_ENTITY_TYPE = 'taskCategory';
export const TASK_SCHEMA_VERSION = 4;
export const TASK_LIST_SCHEMA_VERSION = 1;
export const TASK_CATEGORY_SCHEMA_VERSION = 1;

export type TaskEntityBridgeKind = 'task' | 'taskList' | 'taskCategory';

export interface EntityBridge<TKind extends TaskEntityBridgeKind, TLocal> {
  readonly kind: TKind;
  readonly entityType: string;
  readonly schemaVersion: number;
  localChangeToOp(change: LocalChange, options: LocalChangeToOpOptions): Op;
  entityToLocal(entity: Entity<unknown>): TLocal;
}

export type TaskEntityBridge =
  | EntityBridge<'task', Task>
  | EntityBridge<'taskList', TaskList>
  | EntityBridge<'taskCategory', TaskCategory>;

export interface LocalChangeToOpOptions {
  readonly deviceId: string;
  readonly actor?: string;
}

const VALID_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'active',
  'completed',
  'archived',
]);
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function localChangeToOp(change: LocalChange, options: LocalChangeToOpOptions): Op {
  if (!isSupportedChangeEntityType(change.entityType)) {
    throw new Error(`WebDAV 同步：不支持的实体类型：${change.entityType}`);
  }
  const actor = options.actor ?? options.deviceId;
  const base = {
    ts: change.createdAt,
    actor,
    originDevice: options.deviceId,
    target: { entityType: change.entityType, entityId: change.entityId },
  } as const;

  switch (change.action) {
    case 'task.create': {
      const payload = unwrapTaskCreatePayload(change.payload);
      return { op: 'put', params: payload, ...base };
    }
    case 'task.update': {
      const params = unwrapTaskUpdatePayload(change.payload);
      return { op: 'patch', params, ...base };
    }
    case 'task.status': {
      const params = unwrapTaskStatusPayload(change.payload);
      return { op: 'patch', params, ...base };
    }
    case 'task.delete':
      return { op: 'delete', params: null, ...base };
    case 'taskList.create':
      return { op: 'put', params: unwrapTaskListCreatePayload(change.payload), ...base };
    case 'taskList.update':
      return { op: 'patch', params: unwrapTaskListUpdatePayload(change.payload), ...base };
    case 'taskList.archive':
      return { op: 'patch', params: unwrapTaskListArchivePayload(change.payload), ...base };
    case 'taskList.delete':
      return { op: 'delete', params: null, ...base };
    case 'taskCategory.create':
      return { op: 'put', params: unwrapTaskCategoryCreatePayload(change.payload), ...base };
    case 'taskCategory.update':
      return { op: 'patch', params: unwrapTaskCategoryUpdatePayload(change.payload), ...base };
    case 'taskCategory.delete':
      return { op: 'delete', params: null, ...base };
  }
}

export function entityToTask(entity: Entity<unknown>): Task {
  if (entity.type !== TASK_ENTITY_TYPE) {
    throw new Error(`WebDAV 同步：非 task entity 不能转 Task：${entity.type}`);
  }
  const payload = isPlainObject(entity.payload) ? (entity.payload as Record<string, unknown>) : {};
  return {
    id: entity.id,
    title: asString(payload.title, 'task.title'),
    notes: asNullableString(payload.notes),
    status: asTaskStatus(payload.status),
    priority: asTaskPriority(payload.priority),
    startAt: asNullableIsoString(payload.startAt, 'task.startAt'),
    dueAt: asNullableIsoString(payload.dueAt, 'task.dueAt'),
    estimateMin: asNullableNumber(payload.estimateMin),
    resources: asResources(payload.resources),
    reminders: asReminders(payload.reminders),
    checklist: asChecklist(payload.checklist),
    parentId: asNullableString(payload.parentId),
    childOrder: asIntegerWithDefault(payload.childOrder, 0, 'task.childOrder'),
    tags: asStringArray(payload.tags),
    listId: asStringWithDefault(payload.listId, 'inbox'),
    categoryId: asNullableString(payload.categoryId),
    recurrence: asRecurrence(payload.recurrence),
    deletedAt: asNullableIsoString(payload.deletedAt, 'task.deletedAt'),
    lastReminderNotifiedAt: asNullableIsoString(payload.lastReminderNotifiedAt, 'task.lastReminderNotifiedAt'),
    createdAt: asRequiredIsoString(payload.createdAt, 'task.createdAt'),
    updatedAt: asRequiredIsoString(entity.updatedAt, 'task.updatedAt'),
    completedAt: asNullableIsoString(payload.completedAt, 'task.completedAt'),
  };
}

export function entityToTaskList(entity: Entity<unknown>): TaskList {
  if (entity.type !== TASK_LIST_ENTITY_TYPE) {
    throw new Error(`WebDAV 同步：非 taskList entity 不能转 TaskList：${entity.type}`);
  }
  const payload = isPlainObject(entity.payload) ? (entity.payload as Record<string, unknown>) : {};
  return {
    id: entity.id,
    name: asString(payload.name, 'taskList.name'),
    color: asNullableString(payload.color),
    archived: asBooleanWithDefault(payload.archived, false, 'taskList.archived'),
    order: asIntegerWithDefault(payload.order, 0, 'taskList.order'),
    createdAt: asRequiredIsoString(payload.createdAt, 'taskList.createdAt'),
    updatedAt: asRequiredIsoString(entity.updatedAt, 'taskList.updatedAt'),
  };
}

export function entityToTaskCategory(entity: Entity<unknown>): TaskCategory {
  if (entity.type !== TASK_CATEGORY_ENTITY_TYPE) {
    throw new Error(`WebDAV 同步：非 taskCategory entity 不能转 TaskCategory：${entity.type}`);
  }
  const payload = isPlainObject(entity.payload) ? (entity.payload as Record<string, unknown>) : {};
  return {
    id: entity.id,
    listId: asStringWithDefault(payload.listId, 'inbox'),
    name: asString(payload.name, 'taskCategory.name'),
    order: asIntegerWithDefault(payload.order, 0, 'taskCategory.order'),
    createdAt: asRequiredIsoString(payload.createdAt, 'taskCategory.createdAt'),
    updatedAt: asRequiredIsoString(entity.updatedAt, 'taskCategory.updatedAt'),
  };
}

export const TASK_ENTITY_BRIDGES: readonly TaskEntityBridge[] = [
  {
    kind: 'task',
    entityType: TASK_ENTITY_TYPE,
    schemaVersion: TASK_SCHEMA_VERSION,
    localChangeToOp,
    entityToLocal: entityToTask,
  },
  {
    kind: 'taskList',
    entityType: TASK_LIST_ENTITY_TYPE,
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    localChangeToOp,
    entityToLocal: entityToTaskList,
  },
  {
    kind: 'taskCategory',
    entityType: TASK_CATEGORY_ENTITY_TYPE,
    schemaVersion: TASK_CATEGORY_SCHEMA_VERSION,
    localChangeToOp,
    entityToLocal: entityToTaskCategory,
  },
];

export function getTaskEntityBridge(entityType: string): TaskEntityBridge | null {
  return TASK_ENTITY_BRIDGES.find((bridge) => bridge.entityType === entityType) ?? null;
}

export function isSupportedTaskEntityType(entityType: string): boolean {
  return getTaskEntityBridge(entityType) !== null;
}

export function schemaVersionForTaskEntity(entityType: string): number {
  return getTaskEntityBridge(entityType)?.schemaVersion ?? TASK_SCHEMA_VERSION;
}

function unwrapTaskCreatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：task.create payload 必须为对象');
  }
  return { ...(raw as Record<string, unknown>) };
}

function unwrapTaskUpdatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：task.update payload 必须为对象');
  }
  const record = raw as Record<string, unknown>;
  const patch = record.patch;
  if (!isPlainObject(patch)) {
    throw new Error('WebDAV 同步：task.update.patch 缺失或非对象');
  }
  const fields = { ...(patch as Record<string, unknown>) };
  if (typeof record.updatedAt === 'string') {
    fields.updatedAt = record.updatedAt;
  }
  return fields;
}

function unwrapTaskStatusPayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：task.status payload 必须为对象');
  }
  const record = raw as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== 'string' || !VALID_TASK_STATUSES.has(status as TaskStatus)) {
    throw new Error(`WebDAV 同步：task.status.status 非法：${String(status)}`);
  }
  const fields: Record<string, unknown> = { status };
  if ('completedAt' in record) fields.completedAt = record.completedAt;
  if (typeof record.updatedAt === 'string') fields.updatedAt = record.updatedAt;
  return fields;
}

function unwrapTaskListCreatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：taskList.create payload 必须为对象');
  }
  return { ...(raw as Record<string, unknown>) };
}

function unwrapTaskListUpdatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：taskList.update payload 必须为对象');
  }
  const record = raw as Record<string, unknown>;
  const patch = record.patch;
  if (!isPlainObject(patch)) {
    throw new Error('WebDAV 同步：taskList.update.patch 缺失或非对象');
  }
  const fields = { ...(patch as Record<string, unknown>) };
  if (typeof record.updatedAt === 'string') fields.updatedAt = record.updatedAt;
  return fields;
}

function unwrapTaskListArchivePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：taskList.archive payload 必须为对象');
  }
  const record = raw as Record<string, unknown>;
  const fields: Record<string, unknown> = { archived: true };
  if (typeof record.updatedAt === 'string') fields.updatedAt = record.updatedAt;
  return fields;
}

function unwrapTaskCategoryCreatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：taskCategory.create payload 必须为对象');
  }
  return { ...(raw as Record<string, unknown>) };
}

function unwrapTaskCategoryUpdatePayload(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error('WebDAV 同步：taskCategory.update payload 必须为对象');
  }
  const record = raw as Record<string, unknown>;
  const patch = record.patch;
  if (!isPlainObject(patch)) {
    throw new Error('WebDAV 同步：taskCategory.update.patch 缺失或非对象');
  }
  const fields = { ...(patch as Record<string, unknown>) };
  if (typeof record.updatedAt === 'string') {
    fields.updatedAt = record.updatedAt;
  }
  return fields;
}

function isSupportedChangeEntityType(entityType: string): entityType is typeof TASK_ENTITY_TYPE | typeof TASK_LIST_ENTITY_TYPE | typeof TASK_CATEGORY_ENTITY_TYPE {
  return entityType === TASK_ENTITY_TYPE || entityType === TASK_LIST_ENTITY_TYPE || entityType === TASK_CATEGORY_ENTITY_TYPE;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`WebDAV 同步：${field} 必须为字符串`);
  }
  return value;
}

function asRequiredIsoString(value: unknown, field: string): string {
  const text = asString(value, field);
  const date = new Date(text);
  if (!ISO_DATE_TIME_PATTERN.test(text) || Number.isNaN(date.getTime()) || !hasValidDatePart(text)) {
    throw new Error(`WebDAV 同步：${field} 必须是有效的 ISO 日期`);
  }
  return date.toISOString();
}

function asNullableIsoString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return asRequiredIsoString(value, field);
}

function asStringWithDefault(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`WebDAV 同步：字段必须为非空字符串：${String(value)}`);
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`WebDAV 同步：字段必须为字符串或 null：${String(value)}`);
  }
  return value;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`WebDAV 同步：字段必须为数字或 null：${String(value)}`);
  }
  return value;
}

function asIntegerWithDefault(value: unknown, fallback: number, field: string): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`WebDAV 同步：${field} 必须为非负整数`);
  }
  return value;
}

function asBooleanWithDefault(value: unknown, fallback: boolean, field: string): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new Error(`WebDAV 同步：${field} 必须为布尔值`);
  }
  return value;
}

function asTaskStatus(value: unknown): TaskStatus {
  if (typeof value !== 'string' || !VALID_TASK_STATUSES.has(value as TaskStatus)) {
    throw new Error(`WebDAV 同步：task.status 非法：${String(value)}`);
  }
  return value as TaskStatus;
}

function asTaskPriority(value: unknown): TaskPriority {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('WebDAV 同步：task.priority 必须为整数');
  }
  if (value < 0 || value > 3) {
    throw new Error(`WebDAV 同步：task.priority 越界：${value}`);
  }
  return value as TaskPriority;
}

function asStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('WebDAV 同步：task.tags 必须为数组');
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`WebDAV 同步：task.tags[${index}] 非字符串`);
    }
    return entry;
  });
}

function asResources(value: unknown): TaskResource[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('WebDAV 同步：task.resources 必须为数组');
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`WebDAV 同步：task.resources[${index}] 必须为对象`);
    const record = entry as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== 'string' || !['person', 'tool', 'space', 'budget', 'material', 'other'].includes(type)) {
      throw new Error(`WebDAV 同步：task.resources[${index}].type 非法`);
    }
    return {
      id: asString(record.id, `task.resources[${index}].id`),
      type: type as TaskResource['type'],
      label: asString(record.label, `task.resources[${index}].label`),
      amount: asNullableNumber(record.amount),
      unit: asNullableString(record.unit),
    };
  });
}

function asReminders(value: unknown): TaskReminder[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('WebDAV 同步：task.reminders 必须为数组');
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`WebDAV 同步：task.reminders[${index}] 必须为对象`);
    const record = entry as Record<string, unknown>;
    const status = record.status;
    if (typeof status !== 'string' || !['pending', 'fired', 'dismissed'].includes(status)) {
      throw new Error(`WebDAV 同步：task.reminders[${index}].status 非法`);
    }
    return {
      id: asString(record.id, `task.reminders[${index}].id`),
      triggerAt: asRequiredIsoString(record.triggerAt, `task.reminders[${index}].triggerAt`),
      status: status as TaskReminder['status'],
      message: asNullableString(record.message),
    };
  });
}

function asChecklist(value: unknown): TaskChecklistItem[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('WebDAV 同步：task.checklist 必须为数组');
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`WebDAV 同步：task.checklist[${index}] 必须为对象`);
    const record = entry as Record<string, unknown>;
    if (typeof record.done !== 'boolean') {
      throw new Error(`WebDAV 同步：task.checklist[${index}].done 必须为布尔值`);
    }
    return {
      id: asString(record.id, `task.checklist[${index}].id`),
      title: asString(record.title, `task.checklist[${index}].title`),
      done: record.done,
      order: asIntegerWithDefault(record.order, index, `task.checklist[${index}].order`),
    };
  });
}

function asRecurrence(value: unknown): Task['recurrence'] {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) throw new Error('WebDAV 同步：task.recurrence 必须为对象');
  const record = value as Record<string, unknown>;
  const unit = record.unit;
  const interval = record.interval;
  if (typeof record.enabled !== 'boolean' || record.enabled !== true) {
    throw new Error('WebDAV 同步：task.recurrence.enabled 必须为 true');
  }
  if (typeof unit !== 'string' || !['day', 'week', 'month'].includes(unit)) {
    throw new Error('WebDAV 同步：task.recurrence.unit 非法');
  }
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval <= 0) {
    throw new Error('WebDAV 同步：task.recurrence.interval 必须为正整数');
  }
  return { enabled: true, unit: unit as 'day' | 'week' | 'month', interval };
}
