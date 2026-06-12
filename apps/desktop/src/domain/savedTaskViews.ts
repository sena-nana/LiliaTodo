import type { TaskPriority, TaskSearchReminderStatus, TaskSearchTimeMode, TaskStatus } from "./tasks";

export const SAVED_TASK_VIEWS_STORAGE_KEY = "liliatodo.savedTaskViews.v1";

export interface SavedTaskViewQuery {
  keyword: string;
  status: TaskStatus | "all";
  tagText: string;
  listId: string;
  categoryId: string;
  priority: TaskPriority | "all";
  timeMode: TaskSearchTimeMode;
  timeFrom: string;
  timeTo: string;
  reminderStatus: TaskSearchReminderStatus | "all";
  includeDeleted: boolean;
}

export interface SavedTaskView {
  id: string;
  name: string;
  query: SavedTaskViewQuery;
  builtIn: boolean;
  createdAt: string;
}

export const emptySavedTaskViewQuery: SavedTaskViewQuery = {
  keyword: "",
  status: "all",
  tagText: "",
  listId: "",
  categoryId: "",
  priority: "all",
  timeMode: "all",
  timeFrom: "",
  timeTo: "",
  reminderStatus: "all",
  includeDeleted: false,
};

export function builtInSavedTaskViews(now = new Date()): SavedTaskView[] {
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return [
    {
      id: "builtin-this-week-high-priority",
      name: "本周高优先级",
      builtIn: true,
      createdAt: now.toISOString(),
      query: {
        ...emptySavedTaskViewQuery,
        priority: 2,
        status: "active",
        timeMode: "scheduled",
        timeFrom: toLocalDateTimeInput(weekStart),
        timeTo: toLocalDateTimeInput(weekEnd),
      },
    },
    {
      id: "builtin-unplanned",
      name: "无计划任务",
      builtIn: true,
      createdAt: now.toISOString(),
      query: {
        ...emptySavedTaskViewQuery,
        status: "active",
        timeMode: "unscheduled",
        timeFrom: "",
        timeTo: "",
      },
    },
    {
      id: "builtin-waiting-confirm",
      name: "等待确认",
      builtIn: true,
      createdAt: now.toISOString(),
      query: {
        ...emptySavedTaskViewQuery,
        keyword: "等待确认",
        status: "all",
      },
    },
  ];
}

export function loadSavedTaskViews(storage: Pick<Storage, "getItem">): SavedTaskView[] {
  const raw = storage.getItem(SAVED_TASK_VIEWS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseSavedTaskView).filter((view): view is SavedTaskView => view !== null);
  } catch {
    return [];
  }
}

export function saveTaskViews(storage: Pick<Storage, "setItem">, views: SavedTaskView[]) {
  storage.setItem(
    SAVED_TASK_VIEWS_STORAGE_KEY,
    JSON.stringify(views.filter((view) => !view.builtIn)),
  );
}

export function createSavedTaskView(name: string, query: SavedTaskViewQuery, now = new Date()): SavedTaskView {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("视图名称不能为空");
  }
  return {
    id: `view-${now.getTime()}`,
    name: normalizedName,
    query: normalizeSavedTaskViewQuery(query),
    builtIn: false,
    createdAt: now.toISOString(),
  };
}

export function normalizeSavedTaskViewQuery(query: Partial<SavedTaskViewQuery> | null | undefined): SavedTaskViewQuery {
  const normalized = { ...emptySavedTaskViewQuery, ...(query ?? {}) };
  return {
    keyword: normalizeText(normalized.keyword),
    status: normalizeStatus(normalized.status),
    tagText: normalizeText(normalized.tagText),
    listId: normalizeText(normalized.listId),
    categoryId: normalizeText(normalized.categoryId),
    priority: normalizePriority(normalized.priority),
    timeMode: normalizeTimeMode(normalized.timeMode),
    timeFrom: typeof normalized.timeFrom === "string" ? normalized.timeFrom : "",
    timeTo: typeof normalized.timeTo === "string" ? normalized.timeTo : "",
    reminderStatus: normalizeReminderStatus(normalized.reminderStatus),
    includeDeleted: Boolean(normalized.includeDeleted),
  };
}

function normalizeText(value: unknown) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(",").trim();
  return String(value).trim();
}

function parseSavedTaskView(value: unknown): SavedTaskView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as Partial<SavedTaskView>;
  if (!view.id || !view.name || !view.query || view.builtIn) return null;
  return {
    id: String(view.id),
    name: String(view.name),
    query: normalizeSavedTaskViewQuery(view.query),
    builtIn: false,
    createdAt: typeof view.createdAt === "string" ? view.createdAt : new Date(0).toISOString(),
  };
}

function normalizeStatus(value: unknown): TaskStatus | "all" {
  return value === "active" || value === "completed" || value === "archived" ? value : "all";
}

function normalizePriority(value: unknown): TaskPriority | "all" {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : "all";
}

function normalizeTimeMode(value: unknown): TaskSearchTimeMode {
  return value === "scheduled" || value === "unscheduled" ? value : "all";
}

function normalizeReminderStatus(value: unknown): TaskSearchReminderStatus | "all" {
  return value === "none" || value === "pending" || value === "due" || value === "fired" || value === "dismissed"
    ? value
    : "all";
}

function toLocalDateTimeInput(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 16);
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}
