import type { Task, UpdateTaskInput } from "./tasks";
import { parseStrictDateTime } from "./dateTime";

export type CalendarViewMode = "day" | "week" | "month";

export interface CalendarRange {
  start: Date;
  end: Date;
}

export interface CalendarDay {
  key: string;
  date: Date;
  inCurrentRange: boolean;
}

export type ScheduleSuggestionKind = "schedule" | "estimate" | "capacity";

export interface ScheduleSuggestion {
  id: string;
  kind: ScheduleSuggestionKind;
  taskId: string | null;
  title: string;
  detail: string;
  targetDate: string | null;
  priority: number;
  patch: UpdateTaskInput | null;
}

export interface CalendarDayLoad {
  date: string;
  estimateMin: number;
  taskCount: number;
  overloaded: boolean;
}

export interface CalendarLoadAnalysis {
  totalEstimateMin: number;
  unknownEstimateCount: number;
  overloadedDays: CalendarDayLoad[];
  overdueRiskCount: number;
  resourceTaskCount: number;
  topResources: Array<{ label: string; count: number }>;
  dailyLoads: CalendarDayLoad[];
}

export type CalendarConflictKind = "time_overlap" | "parent_breakdown" | "late_reminder" | "invalid_range";

export interface CalendarConflict {
  id: string;
  kind: CalendarConflictKind;
  taskIds: string[];
  title: string;
  detail: string;
  severity: "warn" | "danger";
}

const dayMs = 24 * 60 * 60 * 1000;
const defaultDailyCapacityMin = 6 * 60;
const defaultTaskEstimateMin = 30;

export function getCalendarRange(mode: CalendarViewMode, anchor: Date): CalendarRange {
  if (mode === "day") {
    const start = startOfDay(anchor);
    return { start, end: endOfDay(start) };
  }

  if (mode === "week") {
    const start = startOfWeek(anchor);
    return { start, end: endOfDay(addDays(start, 6)) };
  }

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(monthStart);
  return { start, end: endOfDay(addDays(start, 41)) };
}

export function getCalendarDays(mode: CalendarViewMode, anchor: Date): CalendarDay[] {
  const range = getCalendarRange(mode, anchor);
  const count = mode === "day" ? 1 : mode === "week" ? 7 : 42;
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(range.start, index);
    return {
      key: toDateKey(date),
      date,
      inCurrentRange: mode !== "month" || date.getMonth() === anchor.getMonth(),
    };
  });
}

export function getCalendarTitle(mode: CalendarViewMode, anchor: Date) {
  const range = getCalendarRange(mode, anchor);
  if (mode === "day") return formatChineseDate(anchor);
  if (mode === "month") return `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`;
  return `${formatShortDate(range.start)} - ${formatShortDate(range.end)}`;
}

export function moveCalendarAnchor(mode: CalendarViewMode, anchor: Date, direction: -1 | 1) {
  if (mode === "day") return addDays(anchor, direction);
  if (mode === "week") return addDays(anchor, direction * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

export function groupTasksByCalendarDate(tasks: Task[]) {
  const groups: Record<string, Task[]> = {};
  for (const task of tasks) {
    const time = taskCalendarTime(task);
    if (!time) continue;
    const date = parseStrictDateTime(time);
    if (!date) continue;
    const key = toDateKey(date);
    groups[key] ??= [];
    groups[key].push(task);
  }

  for (const key of Object.keys(groups)) {
    groups[key].sort(compareCalendarTasks);
  }

  return groups;
}

export function buildTaskReschedulePatch(task: Task, targetDate: Date): UpdateTaskInput {
  if (task.dueAt) {
    return { dueAt: mergeDateWithTaskTime(targetDate, task.dueAt).toISOString() };
  }
  if (task.startAt) {
    return { startAt: mergeDateWithTaskTime(targetDate, task.startAt).toISOString() };
  }
  const nextStart = startOfDay(targetDate);
  nextStart.setHours(9, 0, 0, 0);
  return { startAt: nextStart.toISOString() };
}

export function buildScheduleSuggestions(
  tasks: Task[],
  dailyCapacityMin = defaultDailyCapacityMin,
): ScheduleSuggestion[] {
  const suggestions: ScheduleSuggestion[] = [];
  const loadByDate: Record<string, { total: number; tasks: Task[] }> = {};

  for (const task of tasks) {
    if (task.status !== "active" || task.deletedAt) continue;
    const targetTime = taskCalendarTime(task);
    if (!targetTime) continue;
    const targetDate = parseStrictDateTime(targetTime);
    if (!targetDate) continue;
    const targetDateKey = toDateKey(targetDate);
    const estimate = task.estimateMin ?? defaultTaskEstimateMin;
    loadByDate[targetDateKey] ??= { total: 0, tasks: [] };
    loadByDate[targetDateKey].total += estimate;
    loadByDate[targetDateKey].tasks.push(task);

    if (task.dueAt && !task.startAt) {
      const suggestedStartAt = suggestStartBeforeDue(task.dueAt, estimate);
      if (suggestedStartAt) {
        suggestions.push({
          id: `schedule:${task.id}`,
          kind: "schedule",
          taskId: task.id,
          title: `安排「${task.title}」`,
          detail: `建议在截止前预留 ${estimate} 分钟，从 ${formatTime(suggestedStartAt)} 开始。`,
          targetDate: targetDateKey,
          priority: task.priority + 2,
          patch: { startAt: suggestedStartAt.toISOString() },
        });
      }
    }

    if (task.estimateMin == null) {
      suggestions.push({
        id: `estimate:${task.id}`,
        kind: "estimate",
        taskId: task.id,
        title: `补充「${task.title}」估时`,
        detail: "当前排期按 30 分钟临时估算，补充估时后建议会更准确。",
        targetDate: targetDateKey,
        priority: task.priority + 1,
        patch: { estimateMin: defaultTaskEstimateMin },
      });
    }
  }

  for (const [date, load] of Object.entries(loadByDate)) {
    if (load.total <= dailyCapacityMin) continue;
    const movableTask = pickMovableCapacityTask(load.tasks);
    const highPriorityCount = load.tasks.filter((task) => task.priority >= 2).length;
    suggestions.push({
      id: `capacity:${date}`,
      kind: "capacity",
      taskId: movableTask?.id ?? null,
      title: `${formatShortDate(dateKeyToLocalDate(date))} 排期超载`,
      detail: movableTask
        ? `已安排约 ${load.total} 分钟，超过默认容量 ${dailyCapacityMin} 分钟；建议先保留 ${highPriorityCount} 个高优先级任务，并把「${movableTask.title}」顺延一天。`
        : `已安排约 ${load.total} 分钟，超过默认容量 ${dailyCapacityMin} 分钟；建议先保留 ${highPriorityCount} 个高优先级任务。`,
      targetDate: date,
      priority: 10,
      patch: movableTask ? buildTaskReschedulePatch(movableTask, addDays(dateKeyToLocalDate(date), 1)) : null,
    });
  }

  return suggestions.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.targetDate ?? "").localeCompare(b.targetDate ?? "");
  }).slice(0, 5);
}

export function buildCalendarLoadAnalysis(
  tasks: Task[],
  dailyCapacityMin = defaultDailyCapacityMin,
  now = new Date(),
): CalendarLoadAnalysis {
  const loadByDate: Record<string, CalendarDayLoad> = {};
  const resourceCounts: Record<string, number> = {};
  let totalEstimateMin = 0;
  let unknownEstimateCount = 0;
  let overdueRiskCount = 0;
  let resourceTaskCount = 0;

  for (const task of tasks) {
    if (task.status !== "active" || task.deletedAt) continue;
    const targetTime = taskCalendarTime(task);
    const estimate = task.estimateMin ?? defaultTaskEstimateMin;
    totalEstimateMin += estimate;
    if (task.estimateMin == null) unknownEstimateCount += 1;

    const dueAt = parseStrictDateTime(task.dueAt);
    if (dueAt && dueAt.getTime() < now.getTime()) {
      overdueRiskCount += 1;
    }

    if (task.resources.length > 0) {
      resourceTaskCount += 1;
      for (const resource of task.resources) {
        const label = resource.label.trim();
        if (!label) continue;
        resourceCounts[label] = (resourceCounts[label] ?? 0) + 1;
      }
    }

    if (!targetTime) continue;
    const targetDate = parseStrictDateTime(targetTime);
    if (!targetDate) continue;
    const date = toDateKey(targetDate);
    loadByDate[date] ??= {
      date,
      estimateMin: 0,
      taskCount: 0,
      overloaded: false,
    };
    loadByDate[date].estimateMin += estimate;
    loadByDate[date].taskCount += 1;
    loadByDate[date].overloaded = loadByDate[date].estimateMin > dailyCapacityMin;
  }

  const dailyLoads = Object.values(loadByDate).sort((a, b) => a.date.localeCompare(b.date));
  const topResources = Object.entries(resourceCounts)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0], "zh-CN");
    })
    .slice(0, 3)
    .map(([label, count]) => ({ label, count }));

  return {
    totalEstimateMin,
    unknownEstimateCount,
    overloadedDays: dailyLoads.filter((day) => day.overloaded),
    overdueRiskCount,
    resourceTaskCount,
    topResources,
    dailyLoads,
  };
}

export function detectCalendarConflicts(tasks: Task[]): CalendarConflict[] {
  const conflicts: CalendarConflict[] = [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const tasksWithIntervals: Array<{ task: Task; start: Date; end: Date }> = [];

  for (const task of tasks) {
    if (task.status !== "active" || task.deletedAt) continue;
    const start = parseStrictDateTime(task.startAt);
    const due = parseStrictDateTime(task.dueAt);

    if (start && due && start.getTime() > due.getTime()) {
      conflicts.push({
        id: `invalid-range:${task.id}`,
        kind: "invalid_range",
        taskIds: [task.id],
        title: `「${task.title}」时间顺序异常`,
        detail: "截止时间早于开始时间，需要先修正时间范围。",
        severity: "danger",
      });
    }

    if (task.parentId && taskById.has(task.parentId) === false) {
      conflicts.push({
        id: `parent-breakdown:${task.id}`,
        kind: "parent_breakdown",
        taskIds: [task.id],
        title: `「${task.title}」父任务缺失`,
        detail: "当前任务指向的父任务不在本日历范围内，计划拆解关系可能不完整。",
        severity: "warn",
      });
    }

    for (const reminder of task.reminders) {
      if (!task.dueAt || reminder.status !== "pending") continue;
      const reminderAt = parseStrictDateTime(reminder.triggerAt);
      const dueAt = parseStrictDateTime(task.dueAt);
      if (!reminderAt || !dueAt) continue;
      if (reminderAt.getTime() > dueAt.getTime()) {
        conflicts.push({
          id: `late-reminder:${task.id}:${reminder.id}`,
          kind: "late_reminder",
          taskIds: [task.id],
          title: `「${task.title}」提醒过晚`,
          detail: "提醒时间晚于截止时间，可能无法及时提醒。",
          severity: "warn",
        });
      }
    }

    const interval = getTaskInterval(task);
    if (interval) tasksWithIntervals.push({ task, ...interval });
  }

  for (let i = 0; i < tasksWithIntervals.length; i += 1) {
    for (let j = i + 1; j < tasksWithIntervals.length; j += 1) {
      const first = tasksWithIntervals[i];
      const second = tasksWithIntervals[j];
      if (!first || !second) continue;
      if (first.start.getTime() >= second.end.getTime() || second.start.getTime() >= first.end.getTime()) continue;
      conflicts.push({
        id: `time-overlap:${first.task.id}:${second.task.id}`,
        kind: "time_overlap",
        taskIds: [first.task.id, second.task.id],
        title: "任务时间重叠",
        detail: `「${first.task.title}」与「${second.task.title}」时间段重叠。`,
        severity: "danger",
      });
    }
  }

  return conflicts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "danger" ? -1 : 1;
    return a.title.localeCompare(b.title, "zh-CN");
  }).slice(0, 8);
}

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateKeyToLocalDate(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`非法日历日期：${dateKey}`);
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  if (toDateKey(date) !== dateKey) {
    throw new Error(`非法日历日期：${dateKey}`);
  }
  return date;
}

export function taskCalendarTime(task: Task) {
  return task.startAt ?? task.dueAt;
}

export function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date: Date) {
  const start = startOfDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  return addDays(start, -mondayOffset);
}

function addDays(date: Date, amount: number) {
  return new Date(date.getTime() + amount * dayMs);
}

function compareCalendarTasks(a: Task, b: Task) {
  const aTime = taskCalendarTime(a) ?? a.createdAt;
  const bTime = taskCalendarTime(b) ?? b.createdAt;
  const byTime = aTime.localeCompare(bTime);
  if (byTime !== 0) return byTime;
  return b.priority - a.priority;
}

function mergeDateWithTaskTime(targetDate: Date, sourceIso: string) {
  const source = parseStrictDateTime(sourceIso);
  const next = startOfDay(targetDate);
  if (!source) {
    next.setHours(9, 0, 0, 0);
    return next;
  }
  next.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  return next;
}

function suggestStartBeforeDue(dueAt: string, estimateMin: number) {
  const due = parseStrictDateTime(dueAt);
  if (!due) {
    return null;
  }
  return new Date(due.getTime() - estimateMin * 60 * 1000);
}

function pickMovableCapacityTask(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const byEstimate = (b.estimateMin ?? defaultTaskEstimateMin) - (a.estimateMin ?? defaultTaskEstimateMin);
    if (byEstimate !== 0) return byEstimate;
    return (taskCalendarTime(b) ?? "").localeCompare(taskCalendarTime(a) ?? "");
  })[0] ?? null;
}

function getTaskInterval(task: Task) {
  if (!task.startAt) return null;
  const start = parseStrictDateTime(task.startAt);
  if (!start) return null;
  if (task.dueAt) {
    const end = parseStrictDateTime(task.dueAt);
    if (end && end.getTime() > start.getTime()) {
      return { start, end };
    }
  }
  const estimate = task.estimateMin ?? defaultTaskEstimateMin;
  return { start, end: new Date(start.getTime() + estimate * 60 * 1000) };
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatChineseDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(date);
}
