import type { CreateTaskInput, TaskChecklistItem, TaskReminder } from "./tasks";
import { parseStrictDateTime } from "./dateTime";

export const TASK_TEMPLATES_STORAGE_KEY = "liliatodo.taskTemplates.v1";

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  estimateMin: number | null;
  tags: string[];
  checklist: TaskChecklistItem[];
  reminderOffsetMin: number | null;
  createdAt: string;
}

export interface TaskTemplateDraft {
  name: string;
  title: string;
  estimateMin?: number | null;
  tags?: string[];
  checklist?: TaskChecklistItem[];
  reminderOffsetMin?: number | null;
}

export function createTaskTemplate(draft: TaskTemplateDraft, now = new Date()): TaskTemplate {
  const name = draft.name.trim();
  const title = draft.title.trim();
  if (!name) throw new Error("模板名称不能为空");
  if (!title) throw new Error("模板任务标题不能为空");
  return {
    id: `template-${now.getTime()}`,
    name,
    title,
    estimateMin: normalizeEstimate(draft.estimateMin),
    tags: normalizeTags(draft.tags),
    checklist: normalizeChecklist(draft.checklist),
    reminderOffsetMin: normalizeReminderOffset(draft.reminderOffsetMin),
    createdAt: now.toISOString(),
  };
}

export function loadTaskTemplates(storage: Pick<Storage, "getItem">): TaskTemplate[] {
  const raw = storage.getItem(TASK_TEMPLATES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseTaskTemplate).filter((template): template is TaskTemplate => template !== null);
  } catch {
    return [];
  }
}

export function saveTaskTemplates(storage: Pick<Storage, "setItem">, templates: TaskTemplate[]) {
  storage.setItem(TASK_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

export function applyTemplateToCreateInput(
  template: TaskTemplate,
  base: CreateTaskInput,
): CreateTaskInput {
  const dueAt = base.dueAt ?? null;
  return {
    ...base,
    title: template.title,
    estimateMin: template.estimateMin,
    tags: [...template.tags],
    checklist: template.checklist.map((item) => ({ ...item })),
    reminders: template.reminderOffsetMin != null && dueAt
      ? buildReminderList(dueAt, template.reminderOffsetMin, base.reminders)
      : base.reminders,
  };
}

function parseTaskTemplate(value: unknown): TaskTemplate | null {
  if (!value || typeof value !== "object") return null;
  const template = value as Partial<TaskTemplate>;
  if (!template.id || !template.name || !template.title) return null;
  return {
    id: String(template.id),
    name: String(template.name),
    title: String(template.title),
    estimateMin: normalizeEstimate(template.estimateMin),
    tags: normalizeTags(template.tags),
    checklist: normalizeChecklist(template.checklist),
    reminderOffsetMin: normalizeReminderOffset(template.reminderOffsetMin),
    createdAt: typeof template.createdAt === "string" ? template.createdAt : new Date(0).toISOString(),
  };
}

function normalizeEstimate(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function normalizeReminderOffset(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((tag) => tag.trim()).filter(Boolean))];
}

function normalizeChecklist(value: unknown): TaskChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<TaskChecklistItem>;
    const id = normalizeText(raw.id);
    const title = normalizeText(raw.title);
    return [{
      id: id || `check-${index}`,
      title: title || `检查项 ${index + 1}`,
      done: Boolean(raw.done),
      order: Number.isInteger(raw.order) && Number(raw.order) >= 0 ? Number(raw.order) : index,
    }];
  }).sort((a, b) => a.order - b.order);
}

function normalizeText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function buildReminderList(dueAt: string, offsetMin: number, fallback: TaskReminder[] | undefined) {
  const reminder = buildReminder(dueAt, offsetMin);
  return reminder ? [reminder] : fallback;
}

function buildReminder(dueAt: string, offsetMin: number): TaskReminder | null {
  const dueTime = parseStrictDateTime(dueAt)?.getTime();
  if (dueTime == null) return null;
  const triggerAt = new Date(dueTime - offsetMin * 60 * 1000);
  return {
    id: `reminder-${triggerAt.getTime()}`,
    triggerAt: triggerAt.toISOString(),
    status: "pending",
    message: null,
  };
}
