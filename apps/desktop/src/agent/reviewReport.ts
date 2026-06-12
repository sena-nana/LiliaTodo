import type { Task } from '../domain/tasks';

export interface AgentReviewDailyItem {
  date: string;
  label: string;
  plannedCount: number;
  completedCount: number;
  delayedCount: number;
  completedEstimateMin: number;
}

export interface AgentReviewReason {
  id: string;
  title: string;
  count: number;
  detail: string;
  taskTitles: string[];
}

export interface AgentReviewSuggestion {
  id: string;
  title: string;
  detail: string;
  priority: number;
}

export interface AgentReviewReport {
  generatedAt: string;
  daily: AgentReviewDailyItem[];
  weekly: {
    label: string;
    plannedCount: number;
    completedCount: number;
    plannedEstimateMin: number;
    completedEstimateMin: number;
    missedCount: number;
    unplannedCompletedCount: number;
    deviationItems: string[];
  };
  delayReasons: AgentReviewReason[];
  nextWeekSuggestions: AgentReviewSuggestion[];
}

export interface AgentReviewReportOptions {
  now?: Date;
  dailyLookbackDays?: number;
  dailyCapacityMin?: number;
}

const dayMs = 86_400_000;
const fallbackEstimateMin = 30;

export function buildAgentReviewReport(tasks: Task[], options: AgentReviewReportOptions = {}): AgentReviewReport {
  const now = options.now ?? new Date();
  const days = options.dailyLookbackDays ?? 7;
  const capacity = options.dailyCapacityMin ?? 360;
  const uniqueTasks = [...new Map(tasks.map((task) => [task.id, task])).values()];
  const weekStart = startOfWeek(now);
  const weekEnd = endOfDay(addDays(weekStart, 6));
  const nextWeekStart = addDays(weekStart, 7);
  const nextWeekEnd = endOfDay(addDays(nextWeekStart, 6));
  const plannedThisWeek = uniqueTasks.filter((task) => plannedInRange(task, weekStart, weekEnd));
  const completedThisWeek = uniqueTasks.filter((task) => completedInRange(task, weekStart, weekEnd));
  const missedThisWeek = plannedThisWeek.filter((task) => delayedBy(task, now));
  const unplannedCompleted = completedThisWeek.filter((task) => !plannedInRange(task, weekStart, weekEnd));
  const delayReasons = buildDelayReasons(uniqueTasks, now, capacity);

  return {
    generatedAt: now.toISOString(),
    daily: Array.from({ length: days }, (_, index) => buildDailyItem(uniqueTasks, addDays(startOfDay(now), index - days + 1))),
    weekly: {
      label: formatShort(weekStart) + ' - ' + formatShort(weekEnd),
      plannedCount: plannedThisWeek.length,
      completedCount: completedThisWeek.length,
      plannedEstimateMin: sumEstimate(plannedThisWeek),
      completedEstimateMin: sumEstimate(completedThisWeek),
      missedCount: missedThisWeek.length,
      unplannedCompletedCount: unplannedCompleted.length,
      deviationItems: buildDeviationItems(plannedThisWeek, completedThisWeek, missedThisWeek, unplannedCompleted),
    },
    delayReasons,
    nextWeekSuggestions: buildNextWeekSuggestions(uniqueTasks, now, nextWeekStart, nextWeekEnd, capacity, delayReasons),
  };
}

export function formatReviewMinutes(minutes: number) {
  if (minutes <= 0) return '0 分钟';
  if (minutes < 60) return String(minutes) + ' 分钟';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? String(hours) + ' 小时' : String(hours) + ' 小时 ' + String(rest) + ' 分钟';
}

function buildDailyItem(tasks: Task[], date: Date): AgentReviewDailyItem {
  const start = startOfDay(date);
  const end = endOfDay(date);
  const planned = tasks.filter((task) => plannedInRange(task, start, end));
  const completed = tasks.filter((task) => completedInRange(task, start, end));
  return {
    date: dateKey(date),
    label: formatDay(date),
    plannedCount: planned.length,
    completedCount: completed.length,
    delayedCount: planned.filter((task) => delayedBy(task, end)).length,
    completedEstimateMin: sumEstimate(completed),
  };
}

function buildDelayReasons(tasks: Task[], now: Date, capacity: number): AgentReviewReason[] {
  const activeTasks = tasks.filter((task) => task.status === 'active' && !task.deletedAt);
  const overdue = activeTasks.filter((task) => {
    const dueAt = parseTaskTime(task.dueAt);
    return dueAt !== null && dueAt.getTime() < now.getTime();
  });
  const missingStart = activeTasks.filter((task) => parseTaskTime(task.dueAt) !== null && parseTaskTime(task.startAt) === null);
  const missingEstimate = activeTasks.filter((task) => (parseTaskTime(task.startAt) !== null || parseTaskTime(task.dueAt) !== null) && task.estimateMin == null);
  const invalidRange = activeTasks.filter((task) => {
    const startAt = parseTaskTime(task.startAt);
    const dueAt = parseTaskTime(task.dueAt);
    return startAt !== null && dueAt !== null && startAt.getTime() > dueAt.getTime();
  });
  const overloaded = overloadedDays(activeTasks, capacity);
  return [
    reason('overdue', '已逾期未完成', overdue, String(overdue.length) + ' 个任务已经超过截止时间。'),
    reason('missing-start', '有截止但无开始时间', missingStart, String(missingStart.length) + ' 个任务缺少开始时间，容易集中到截止当天。'),
    reason('missing-estimate', '缺少估时', missingEstimate, String(missingEstimate.length) + ' 个已排期任务缺少估时，容量判断会偏差。'),
    {
      id: 'over-capacity',
      title: '单日容量超载',
      count: overloaded.length,
      detail: overloaded.map((day) => formatShort(day.date) + ' 约 ' + formatReviewMinutes(day.estimateMin)).join('；'),
      taskTitles: overloaded.flatMap((day) => day.taskTitles).slice(0, 3),
    },
    reason('invalid-range', '开始晚于截止', invalidRange, String(invalidRange.length) + ' 个任务的开始时间晚于截止时间。'),
  ].filter((item) => item.count > 0);
}

function buildDeviationItems(planned: Task[], completed: Task[], missed: Task[], unplannedCompleted: Task[]) {
  const items = planned.length === 0
    ? ['本周没有明确计划任务，复盘偏差主要来自临时完成项。']
    : ['本周计划 ' + String(planned.length) + ' 个任务，已完成 ' + String(completed.length) + ' 个。'];
  if (missed.length > 0) items.push(String(missed.length) + ' 个计划任务已经过期或落后。');
  if (unplannedCompleted.length > 0) items.push(String(unplannedCompleted.length) + ' 个完成项不在本周计划内，说明临时插入较多。');
  if (items.length === 1 && missed.length === 0 && unplannedCompleted.length === 0) items.push('本周计划偏差较小。');
  return items;
}

function buildNextWeekSuggestions(tasks: Task[], now: Date, start: Date, end: Date, capacity: number, reasons: AgentReviewReason[]) {
  const activeTasks = tasks.filter((task) => task.status === 'active' && !task.deletedAt);
  const nextWeekTasks = activeTasks.filter((task) => plannedInRange(task, start, end));
  const suggestions: AgentReviewSuggestion[] = [];
  const overdue = activeTasks.filter((task) => {
    const dueAt = parseTaskTime(task.dueAt);
    return dueAt !== null && dueAt.getTime() < now.getTime();
  }).length;
  const missingStart = activeTasks.filter((task) => parseTaskTime(task.dueAt) !== null && parseTaskTime(task.startAt) === null).length;
  const overloaded = overloadedDays(nextWeekTasks, capacity).length;
  const missingEstimate = nextWeekTasks.filter((task) => task.estimateMin == null).length;
  const highPriority = nextWeekTasks.filter((task) => task.priority >= 2).length;
  if (overdue > 0) suggestions.push({ id: 'clear-overdue', title: '先清理逾期任务', detail: '下周计划前先处理 ' + String(overdue) + ' 个逾期任务，避免继续挤占新计划。', priority: 5 });
  if (missingStart > 0) suggestions.push({ id: 'schedule-start', title: '给截止任务补开始时间', detail: '为 ' + String(missingStart) + ' 个只有截止时间的任务补开始时间，减少截止日前集中爆发。', priority: 4 });
  if (overloaded > 0) suggestions.push({ id: 'spread-load', title: '摊平下周负载', detail: '下周有 ' + String(overloaded) + ' 天超过默认容量，优先移动低优先级或大估时任务。', priority: 3 });
  if (missingEstimate > 0) suggestions.push({ id: 'fill-estimate', title: '补齐下周估时', detail: String(missingEstimate) + ' 个下周任务缺少估时，建议先补齐再排容量。', priority: 2 });
  if (highPriority > 0) suggestions.push({ id: 'protect-focus', title: '保护高优先级任务', detail: '下周已有 ' + String(highPriority) + ' 个高优先级任务，建议保留连续时间块。', priority: 1 });
  if (suggestions.length === 0 && reasons.length === 0) suggestions.push({ id: 'keep-cadence', title: '维持当前节奏', detail: '当前没有明显延期原因，下周按已有计划推进即可。', priority: 0 });
  return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 4);
}

function overloadedDays(tasks: Task[], capacity: number) {
  const loads = new Map<string, { date: Date; estimateMin: number; taskTitles: string[] }>();
  for (const task of tasks) {
    const time = task.startAt ?? task.dueAt;
    if (!time) continue;
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) continue;
    const key = dateKey(date);
    const load = loads.get(key) ?? { date: startOfDay(date), estimateMin: 0, taskTitles: [] };
    load.estimateMin += task.estimateMin ?? fallbackEstimateMin;
    load.taskTitles.push(task.title);
    loads.set(key, load);
  }
  return [...loads.values()].filter((load) => load.estimateMin > capacity).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function reason(id: string, title: string, tasks: Task[], detail: string): AgentReviewReason {
  return { id, title, count: tasks.length, detail, taskTitles: tasks.slice(0, 3).map((task) => task.title) };
}

function plannedInRange(task: Task, start: Date, end: Date) {
  const date = parseTaskTime(task.startAt) ?? parseTaskTime(task.dueAt);
  if (!date) return false;
  const value = date.getTime();
  return value >= start.getTime() && value <= end.getTime();
}

function completedInRange(task: Task, start: Date, end: Date) {
  const completedAt = parseTaskTime(task.completedAt);
  if (!completedAt) return false;
  const value = completedAt.getTime();
  return value >= start.getTime() && value <= end.getTime();
}

function delayedBy(task: Task, date: Date) {
  const dueAt = parseTaskTime(task.dueAt);
  return task.status === 'active' && !task.deletedAt && dueAt !== null && dueAt.getTime() < date.getTime();
}

function sumEstimate(tasks: Task[]) {
  return tasks.reduce((total, task) => total + (task.estimateMin ?? fallbackEstimateMin), 0);
}

function startOfDay(date: Date) { const next = new Date(date); next.setHours(0, 0, 0, 0); return next; }
function endOfDay(date: Date) { const next = new Date(date); next.setHours(23, 59, 59, 999); return next; }
function startOfWeek(date: Date) { const start = startOfDay(date); return addDays(start, -((start.getDay() + 6) % 7)); }
function addDays(date: Date, amount: number) { return new Date(date.getTime() + amount * dayMs); }
function dateKey(date: Date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
function formatDay(date: Date) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' }).format(date); }
function formatShort(date: Date) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date); }
function parseTaskTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
