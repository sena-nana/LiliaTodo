// BE-12：WebDAV 同步层的拉取游标。
//
// 游标按 device 维度记录"上一次成功消费到的 (yyyymmdd, seq)"。
// 序列化为 opaque 字符串交给上层持久化，不暴露内部结构。

export interface DevicePullPosition {
  readonly lastDay: string;
  readonly lastSeq: number;
}

export type PullCursor = Readonly<Record<string, DevicePullPosition>>;

export const EMPTY_CURSOR: PullCursor = Object.freeze({});

export function encodeCursor(cursor: PullCursor): string {
  return JSON.stringify(cursor);
}

export function decodeCursor(value: string | null | undefined): PullCursor {
  if (!value) {
    return EMPTY_CURSOR;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return EMPTY_CURSOR;
  }
  if (!isPlainObject(parsed)) {
    return EMPTY_CURSOR;
  }
  const result: Record<string, DevicePullPosition> = {};
  for (const [device, position] of Object.entries(parsed)) {
    if (!isPlainObject(position)) {
      continue;
    }
    const lastDay = (position as Record<string, unknown>).lastDay;
    const lastSeq = (position as Record<string, unknown>).lastSeq;
    if (typeof lastDay !== "string" || !/^\d{8}$/.test(lastDay)) {
      continue;
    }
    if (typeof lastSeq !== "number" || !Number.isInteger(lastSeq) || lastSeq < 0) {
      continue;
    }
    result[device] = { lastDay, lastSeq };
  }
  return Object.freeze(result);
}

export function advanceCursor(
  cursor: PullCursor,
  deviceId: string,
  position: DevicePullPosition,
): PullCursor {
  const prior = cursor[deviceId];
  if (prior && !isStrictlyAfter(position, prior)) {
    return cursor;
  }
  const next = { ...cursor, [deviceId]: position };
  return Object.freeze(next);
}

export function isStrictlyAfter(
  candidate: DevicePullPosition,
  prior: DevicePullPosition,
): boolean {
  if (candidate.lastDay > prior.lastDay) {
    return true;
  }
  if (candidate.lastDay < prior.lastDay) {
    return false;
  }
  return candidate.lastSeq > prior.lastSeq;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
