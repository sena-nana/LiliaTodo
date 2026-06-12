import type {
  CreateTaskInput,
  Task,
  TaskChecklistItem,
  TaskRecurrence,
  TaskReminder,
  TaskResource,
  TaskResourceType,
  TaskStatus,
} from "./tasks";
import { normalizeStrictDateTimeToIso } from "./dateTime";

export type TaskImportExportFormat = "json" | "csv" | "markdown";

export interface ImportedTaskRecord {
  input: CreateTaskInput;
  status: TaskStatus;
}

export function exportTasks(tasks: Task[], format: TaskImportExportFormat) {
  if (format === "json") {
    return JSON.stringify(tasks.map(taskToPortableRecord), null, 2);
  }
  if (format === "csv") {
    return [
      ["title", "notes", "status", "priority", "startAt", "dueAt", "estimateMin", "tags", "listId", "categoryId"].join(","),
      ...tasks.map((task) => [
        task.title,
        task.notes ?? "",
        task.status,
        String(task.priority),
        task.startAt ?? "",
        task.dueAt ?? "",
        task.estimateMin == null ? "" : String(task.estimateMin),
        task.tags.join("|"),
        task.listId,
        task.categoryId ?? "",
      ].map(csvEscape).join(",")),
    ].join("\n");
  }
  return tasks.map((task) => {
    const meta = [
      task.dueAt ? `截止：${task.dueAt}` : null,
      task.estimateMin ? `估时：${task.estimateMin} 分钟` : null,
      task.tags.length ? `标签：${task.tags.join("、")}` : null,
    ].filter(Boolean).join("；");
    return `- [${task.status === "completed" ? "x" : " "}] ${task.title}${meta ? `（${meta}）` : ""}`;
  }).join("\n");
}

export function importTasks(text: string, format: TaskImportExportFormat): CreateTaskInput[] {
  return importTaskRecords(text, format).map((record) => record.input);
}

export function importTaskRecords(text: string, format: TaskImportExportFormat): ImportedTaskRecord[] {
  const records = format === "json"
    ? importJsonTasks(text)
    : format === "csv"
      ? importCsvTasks(text)
      : importMarkdownTasks(text);
  if (records.length === 0) {
    throw new Error("没有找到可导入的任务");
  }
  return records;
}

function taskToPortableRecord(task: Task) {
  return {
    title: task.title,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    startAt: task.startAt,
    dueAt: task.dueAt,
    estimateMin: task.estimateMin,
    resources: task.resources,
    tags: task.tags,
    listId: task.listId,
    categoryId: task.categoryId,
    checklist: task.checklist,
    reminders: task.reminders,
    recurrence: task.recurrence,
  };
}

function importJsonTasks(text: string): ImportedTaskRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("导入 JSON 格式不合法");
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => normalizeImportRecord(item));
}

function importCsvTasks(text: string): ImportedTaskRecord[] {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  const header = normalizeCsvHeader(rows.shift() ?? []);
  if (rows.length > 0 && !header.includes("title")) {
    throw new Error("导入 CSV 缺少 title 表头");
  }
  return rows.map((row) => {
    const item: Record<string, string> = {};
    header.forEach((key, index) => {
      item[key] = row[index] ?? "";
    });
    return normalizeImportRecord({
      ...item,
      priority: item.priority ? Number(item.priority) : undefined,
      estimateMin: item.estimateMin ? Number(item.estimateMin) : undefined,
      tags: item.tags ? item.tags.split("|") : [],
    });
  });
}

function normalizeCsvHeader(row: string[]) {
  const header = row.map((cell, index) => {
    const trimmed = cell.trim();
    return index === 0 ? trimmed.replace(/^\uFEFF/, "") : trimmed;
  });
  const seen = new Set<string>();
  for (const name of header) {
    if (!name) continue;
    if (seen.has(name)) {
      throw new Error(`导入 CSV 存在重复表头：${name}`);
    }
    seen.add(name);
  }
  return header;
}

function importMarkdownTasks(text: string): ImportedTaskRecord[] {
  return text.split(/\r?\n/)
    .map((line) => {
      const matched = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
      if (!matched) return null;
      const parsed = parseMarkdownTaskTitleAndMeta(matched[2]?.trim() ?? "");
      return normalizeImportRecord({
        title: parsed.title,
        status: matched[1]?.toLowerCase() === "x" ? "completed" : "active",
        dueAt: parsed.dueAt,
        estimateMin: parsed.estimateMin,
        tags: parsed.tags,
      });
    })
    .filter((record): record is ImportedTaskRecord => record !== null);
}

function parseMarkdownTaskTitleAndMeta(text: string) {
  const matched = text.match(/^(.*?)（(.+)）$/);
  if (!matched) {
    return { title: text, dueAt: null, estimateMin: null, tags: [] as string[] };
  }
  const meta = parseMarkdownMeta(matched[2] ?? "");
  return {
    title: (matched[1] ?? text).trim(),
    ...meta,
  };
}

function parseMarkdownMeta(text: string) {
  const meta: { dueAt: string | null; estimateMin: number | null; tags: string[] } = {
    dueAt: null,
    estimateMin: null,
    tags: [],
  };
  for (const segment of text.split("；").map((part) => part.trim()).filter(Boolean)) {
    const [rawKey, ...rawValueParts] = segment.split("：");
    const key = rawKey?.trim();
    const value = rawValueParts.join("：").trim();
    if (key === "截止" && value) {
      meta.dueAt = value;
    } else if (key === "估时") {
      const matched = value.match(/^(\d+)\s*分钟$/);
      meta.estimateMin = matched ? Number(matched[1]) : null;
    } else if (key === "标签") {
      meta.tags = value.split("、").map((tag) => tag.trim()).filter(Boolean);
    }
  }
  return meta;
}

function normalizeImportRecord(value: unknown): ImportedTaskRecord {
  return {
    input: normalizeImportItem(value),
    status: normalizeStatus(isRecord(value) ? value.status : undefined),
  };
}

function normalizeImportItem(value: unknown): CreateTaskInput {
  if (!value || typeof value !== "object") throw new Error("导入任务格式不合法");
  const item = value as Record<string, unknown>;
  const title = String(item.title ?? "").trim();
  if (!title) throw new Error("导入任务标题不能为空");
  return {
    title,
    notes: nullableText(item.notes),
    priority: normalizePriority(item.priority),
    startAt: normalizeDateTime(item.startAt, "导入任务开始时间"),
    dueAt: normalizeDateTime(item.dueAt, "导入任务截止时间"),
    estimateMin: normalizeEstimate(item.estimateMin),
    resources: normalizeResources(item.resources),
    reminders: normalizeReminders(item.reminders),
    checklist: normalizeChecklist(item.checklist),
    tags: Array.isArray(item.tags) ? [...new Set(item.tags.map(String).map((tag) => tag.trim()).filter(Boolean))] : [],
    listId: nullableText(item.listId) ?? undefined,
    categoryId: nullableText(item.categoryId),
    recurrence: normalizeRecurrence(item.recurrence),
  };
}

function normalizePriority(value: unknown) {
  const priority = Number(value ?? 0);
  return priority === 0 || priority === 1 || priority === 2 || priority === 3 ? priority : 0;
}

function normalizeStatus(value: unknown): TaskStatus {
  const status = typeof value === "string" ? value.trim() : value;
  return status === "completed" || status === "archived" ? status : "active";
}

function normalizeEstimate(value: unknown) {
  const estimate = Number(value);
  return Number.isInteger(estimate) && estimate > 0 ? estimate : null;
}

function nullableText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function normalizeDateTime(value: unknown, label: string) {
  const text = nullableText(value);
  if (!text) return null;
  const normalized = normalizeStrictDateTimeToIso(text);
  if (!normalized) {
    throw new Error(`${label}不合法`);
  }
  return normalized;
}

function normalizeResources(value: unknown): TaskResource[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("导入任务资源必须为数组");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`导入任务资源第 ${index + 1} 项格式不合法`);
    const type = String(item.type ?? "other");
    if (!isResourceType(type)) throw new Error(`导入任务资源第 ${index + 1} 项类型不合法`);
    const label = String(item.label ?? "").trim();
    if (!label) throw new Error(`导入任务资源第 ${index + 1} 项名称不能为空`);
    return {
      id: nullableText(item.id) ?? `resource-${index}`,
      type,
      label,
      amount: typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : null,
      unit: nullableText(item.unit),
    };
  });
}

function normalizeReminders(value: unknown): TaskReminder[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("导入任务提醒必须为数组");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`导入任务提醒第 ${index + 1} 项格式不合法`);
    const status = String(item.status ?? "pending");
    if (status !== "pending" && status !== "fired" && status !== "dismissed") {
      throw new Error(`导入任务提醒第 ${index + 1} 项状态不合法`);
    }
    const triggerAt = nullableText(item.triggerAt);
    const normalizedTriggerAt = normalizeStrictDateTimeToIso(triggerAt);
    if (!normalizedTriggerAt) {
      throw new Error(`导入任务提醒第 ${index + 1} 项时间不合法`);
    }
    return {
      id: nullableText(item.id) ?? `reminder-${index}`,
      triggerAt: normalizedTriggerAt,
      status,
      message: nullableText(item.message),
    };
  });
}

function normalizeChecklist(value: unknown): TaskChecklistItem[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("导入任务检查项必须为数组");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`导入任务检查项第 ${index + 1} 项格式不合法`);
    const title = String(item.title ?? "").trim();
    if (!title) throw new Error(`导入任务检查项第 ${index + 1} 项标题不能为空`);
    const order = Number(item.order ?? index);
    return {
      id: nullableText(item.id) ?? `check-${index}`,
      title,
      done: Boolean(item.done),
      order: Number.isInteger(order) && order >= 0 ? order : index,
    };
  });
}

function normalizeRecurrence(value: unknown): TaskRecurrence | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error("导入任务重复规则格式不合法");
  if (value.enabled !== true) return null;
  const unit = String(value.unit ?? "");
  const interval = Number(value.interval);
  if (unit !== "day" && unit !== "week" && unit !== "month") throw new Error("导入任务重复规则单位不合法");
  if (!Number.isInteger(interval) || interval <= 0) throw new Error("导入任务重复间隔必须为正整数");
  return { enabled: true, unit, interval };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResourceType(value: string): value is TaskResourceType {
  return ["person", "tool", "space", "budget", "material", "other"].includes(value);
}

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) {
    throw new Error("导入 CSV 格式不合法");
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
