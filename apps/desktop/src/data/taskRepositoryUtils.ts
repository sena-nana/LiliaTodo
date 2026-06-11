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
      date.setUTCMonth(date.getUTCMonth() + recurrence.interval);
      break;
  }
  return date.toISOString();
}
