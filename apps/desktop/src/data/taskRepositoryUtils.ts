import type { Task } from "../domain/tasks";

export function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function shiftIso(value: string | null, recurrence: NonNullable<Task["recurrence"]>) {
  if (!value) return null;
  const date = new Date(value);
  switch (recurrence.unit) {
    case "day":
      date.setUTCDate(date.getUTCDate() + recurrence.interval);
      break;
    case "week":
      date.setUTCDate(date.getUTCDate() + recurrence.interval * 7);
      break;
    case "month":
      shiftUtcMonthClamped(date, recurrence.interval);
      break;
  }
  return date.toISOString();
}

function shiftUtcMonthClamped(date: Date, interval: number) {
  const day = date.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + interval,
    1,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
  const lastDayOfTargetMonth = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  date.setTime(targetMonthStart.getTime());
}
