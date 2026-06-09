export const DEFAULT_TASK_LIST_ID = 'inbox';
export const DEFAULT_TASK_LIST_NAME = '收件箱';

export type TaskStatus = 'active' | 'completed' | 'archived';
export type TaskPriority = 0 | 1 | 2 | 3;
export type TaskResourceType = 'person' | 'tool' | 'space' | 'budget' | 'material' | 'other';
export type TaskReminderStatus = 'pending' | 'fired' | 'dismissed';

export interface TaskResource {
  id: string;
  type: TaskResourceType;
  label: string;
  amount: number | null;
  unit: string | null;
}

export interface TaskReminder {
  id: string;
  triggerAt: string;
  status: TaskReminderStatus;
  message: string | null;
}

export interface TaskChecklistItem {
  id: string;
  title: string;
  done: boolean;
  order: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startAt: string | null;
  dueAt: string | null;
  estimateMin: number | null;
  resources: TaskResource[];
  reminders: TaskReminder[];
  checklist: TaskChecklistItem[];
  parentId: string | null;
  childOrder: number;
  tags: string[];
  listId: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskList {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  priority?: TaskPriority;
  startAt?: string | null;
  dueAt?: string | null;
  estimateMin?: number | null;
  resources?: TaskResource[];
  reminders?: TaskReminder[];
  checklist?: TaskChecklistItem[];
  parentId?: string | null;
  childOrder?: number;
  tags?: string[];
  listId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  priority?: TaskPriority;
  startAt?: string | null;
  dueAt?: string | null;
  estimateMin?: number | null;
  resources?: TaskResource[];
  reminders?: TaskReminder[];
  checklist?: TaskChecklistItem[];
  parentId?: string | null;
  childOrder?: number;
  tags?: string[];
  listId?: string;
}

export interface CreateTaskListInput {
  name: string;
  color?: string | null;
}

export interface UpdateTaskListInput {
  name?: string;
  color?: string | null;
  order?: number;
}

export interface TodayTaskGroups {
  overdue: Task[];
  dueToday: Task[];
  completedToday: Task[];
}

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: number;
  start_at: string | null;
  due_at: string | null;
  estimate_min: number | null;
  resources: string | null;
  reminders: string | null;
  checklist: string | null;
  parent_id: string | null;
  child_order: number | null;
  tags: string | null;
  list_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskListRow {
  id: string;
  name: string;
  color: string | null;
  archived: number | boolean;
  list_order: number;
  created_at: string;
  updated_at: string;
}

export function normalizeCreateTaskInput(input: CreateTaskInput) {
  const title = input.title.trim();
  if (!title) {
    throw new Error('任务标题不能为空');
  }

  return {
    title,
    notes: normalizeNullableText(input.notes),
    priority: normalizePriority(input.priority),
    startAt: normalizeNullableIso(input.startAt, '任务开始时间'),
    dueAt: normalizeNullableIso(input.dueAt, '任务截止时间'),
    estimateMin: normalizeEstimate(input.estimateMin),
    resources: normalizeResources(input.resources),
    reminders: normalizeReminders(input.reminders),
    checklist: normalizeChecklist(input.checklist),
    parentId: normalizeNullableId(input.parentId),
    childOrder: normalizeOrder(input.childOrder),
    tags: normalizeTags(input.tags),
    listId: normalizeListId(input.listId),
  };
}

export function normalizeUpdateTaskInput(input: UpdateTaskInput) {
  const patch: UpdateTaskInput = {};

  if ('title' in input) {
    const title = input.title?.trim() ?? '';
    if (!title) {
      throw new Error('任务标题不能为空');
    }
    patch.title = title;
  }

  if ('notes' in input) patch.notes = normalizeNullableText(input.notes);
  if ('priority' in input) patch.priority = normalizePriority(input.priority);
  if ('startAt' in input) patch.startAt = normalizeNullableIso(input.startAt, '任务开始时间');
  if ('dueAt' in input) patch.dueAt = normalizeNullableIso(input.dueAt, '任务截止时间');
  if ('estimateMin' in input) patch.estimateMin = normalizeEstimate(input.estimateMin);
  if ('resources' in input) patch.resources = normalizeResources(input.resources);
  if ('reminders' in input) patch.reminders = normalizeReminders(input.reminders);
  if ('checklist' in input) patch.checklist = normalizeChecklist(input.checklist);
  if ('parentId' in input) patch.parentId = normalizeNullableId(input.parentId);
  if ('childOrder' in input) patch.childOrder = normalizeOrder(input.childOrder);
  if ('tags' in input) patch.tags = normalizeTags(input.tags);
  if ('listId' in input) patch.listId = normalizeListId(input.listId);

  return patch;
}

export function normalizeCreateTaskListInput(input: CreateTaskListInput) {
  const name = input.name.trim();
  if (!name) {
    throw new Error('清单名称不能为空');
  }
  return {
    name,
    color: normalizeNullableText(input.color),
  };
}

export function normalizeUpdateTaskListInput(input: UpdateTaskListInput) {
  const patch: UpdateTaskListInput = {};
  if ('name' in input) {
    const name = input.name?.trim() ?? '';
    if (!name) {
      throw new Error('清单名称不能为空');
    }
    patch.name = name;
  }
  if ('color' in input) patch.color = normalizeNullableText(input.color);
  if ('order' in input) patch.order = normalizeOrder(input.order);
  return patch;
}

export function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: normalizeStatus(row.status),
    priority: normalizePriority(row.priority),
    startAt: row.start_at ?? null,
    dueAt: row.due_at,
    estimateMin: row.estimate_min,
    resources: parseResources(row.resources),
    reminders: parseReminders(row.reminders),
    checklist: parseChecklist(row.checklist),
    parentId: row.parent_id ?? null,
    childOrder: normalizeOrder(row.child_order ?? 0),
    tags: parseTags(row.tags),
    listId: normalizeListId(row.list_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function mapTaskListRow(row: TaskListRow): TaskList {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archived === true || row.archived === 1,
    order: row.list_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function groupTodayTasks(tasks: Task[], now = new Date()): TodayTaskGroups {
  const { start, end } = getDayBounds(now);
  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const completedToday: Task[] = [];

  for (const task of sortTasks(tasks)) {
    if (task.status === 'completed' && task.completedAt) {
      const completedAt = new Date(task.completedAt);
      if (completedAt >= start && completedAt <= end) {
        completedToday.push(task);
      }
      continue;
    }

    if (task.status !== 'active') continue;

    const dueAt = task.dueAt ? new Date(task.dueAt) : null;
    const startAt = task.startAt ? new Date(task.startAt) : null;
    if (dueAt && dueAt < start) {
      overdue.push(task);
    } else if ((dueAt && dueAt <= end) || (startAt && startAt >= start && startAt <= end)) {
      dueToday.push(task);
    }
  }

  return { overdue, dueToday, completedToday };
}

export function getDayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const aTime = a.startAt ?? a.dueAt ?? a.completedAt ?? a.createdAt;
    const bTime = b.startAt ?? b.dueAt ?? b.completedAt ?? b.createdAt;
    const byTime = aTime.localeCompare(bTime);
    if (byTime !== 0) return byTime;
    return b.priority - a.priority;
  });
}

export function taskHasDueReminder(task: Task, now = new Date()) {
  const time = now.getTime();
  return (task.reminders ?? []).some(
    (reminder) => reminder.status === 'pending' && new Date(reminder.triggerAt).getTime() <= time,
  );
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableId(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeListId(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : DEFAULT_TASK_LIST_ID;
}

function normalizeNullableIso(value: string | null | undefined, field: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field}必须是有效的 ISO 日期`);
  }
  return date.toISOString();
}

function normalizeRequiredIso(value: string | null | undefined, field: string) {
  const normalized = normalizeNullableIso(value, field);
  if (!normalized) {
    throw new Error(`${field}必须是有效的 ISO 日期`);
  }
  return normalized;
}

function normalizeEstimate(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('任务估时必须是正整数');
  }
  return value;
}

function normalizeOrder(value: number | null | undefined) {
  const order = value ?? 0;
  if (!Number.isInteger(order) || order < 0) {
    throw new Error('排序值必须是非负整数');
  }
  return order;
}

function normalizePriority(value: number | null | undefined): TaskPriority {
  const priority = value ?? 0;
  if (![0, 1, 2, 3].includes(priority)) {
    throw new Error('任务优先级必须在 0 到 3 之间');
  }
  return priority as TaskPriority;
}

function normalizeStatus(status: string): TaskStatus {
  if (status === 'active' || status === 'completed' || status === 'archived') {
    return status;
  }
  return 'active';
}

function normalizeTags(tags: string[] | undefined) {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function normalizeResources(resources: TaskResource[] | undefined): TaskResource[] {
  return (resources ?? []).map((resource, index) => {
    const id = resource.id?.trim() || `resource-${index}`;
    const label = resource.label?.trim() ?? '';
    if (!label) {
      throw new Error('资源名称不能为空');
    }
    if (!isResourceType(resource.type)) {
      throw new Error('资源类型不合法');
    }
    if (resource.amount != null && (!Number.isFinite(resource.amount) || resource.amount <= 0)) {
      throw new Error('资源数量必须是正数');
    }
    return {
      id,
      type: resource.type,
      label,
      amount: resource.amount ?? null,
      unit: normalizeNullableText(resource.unit),
    };
  });
}

function normalizeReminders(reminders: TaskReminder[] | undefined): TaskReminder[] {
  return (reminders ?? []).map((reminder, index) => {
    const id = reminder.id?.trim() || `reminder-${index}`;
    if (!isReminderStatus(reminder.status)) {
      throw new Error('提醒状态不合法');
    }
    return {
      id,
      triggerAt: normalizeRequiredIso(reminder.triggerAt, '提醒时间'),
      status: reminder.status,
      message: normalizeNullableText(reminder.message),
    };
  });
}

function normalizeChecklist(checklist: TaskChecklistItem[] | undefined): TaskChecklistItem[] {
  return (checklist ?? []).map((item, index) => {
    const id = item.id?.trim() || `check-${index}`;
    const title = item.title?.trim() ?? '';
    if (!title) {
      throw new Error('检查项标题不能为空');
    }
    return {
      id,
      title,
      done: Boolean(item.done),
      order: normalizeOrder(item.order ?? index),
    };
  }).sort((a, b) => a.order - b.order);
}

function parseTags(value: string | null) {
  return parseJsonArray(value, (items) => normalizeTags(items.map(String)));
}

function parseResources(value: string | null) {
  return parseJsonArray(value, (items) => normalizeResources(items as TaskResource[]));
}

function parseReminders(value: string | null) {
  return parseJsonArray(value, (items) => normalizeReminders(items as TaskReminder[]));
}

function parseChecklist(value: string | null) {
  return parseJsonArray(value, (items) => normalizeChecklist(items as TaskChecklistItem[]));
}

function parseJsonArray<T>(value: string | null, normalize: (items: unknown[]) => T[]) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalize(parsed) : [];
  } catch {
    return [];
  }
}

function isResourceType(value: string): value is TaskResourceType {
  return ['person', 'tool', 'space', 'budget', 'material', 'other'].includes(value);
}

function isReminderStatus(value: string): value is TaskReminderStatus {
  return ['pending', 'fired', 'dismissed'].includes(value);
}
