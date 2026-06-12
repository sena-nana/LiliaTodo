export function hasValidDatePart(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!match) return true;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function parseStrictDateTime(value: string | null | undefined): Date | null {
  if (!value || !hasValidDatePart(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseStrictDateTimeMs(value: string | null | undefined): number | null {
  return parseStrictDateTime(value)?.getTime() ?? null;
}

export function normalizeStrictDateTimeToIso(value: string | null | undefined): string | null {
  return parseStrictDateTime(value)?.toISOString() ?? null;
}
