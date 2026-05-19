import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  decodeCursor,
  encodeCursor,
  EMPTY_CURSOR,
  isStrictlyAfter,
} from "../src/sync/webdav/cursor";

describe("BE-12 WebDAV 拉取游标", () => {
  it("空 cursor 与 null/undefined 解析为 EMPTY_CURSOR", () => {
    expect(decodeCursor(null)).toBe(EMPTY_CURSOR);
    expect(decodeCursor(undefined)).toBe(EMPTY_CURSOR);
    expect(decodeCursor("")).toBe(EMPTY_CURSOR);
  });

  it("非法 JSON 退化为空 cursor", () => {
    expect(decodeCursor("not json")).toBe(EMPTY_CURSOR);
    expect(decodeCursor("[1,2,3]")).toBe(EMPTY_CURSOR);
  });

  it("encode → decode 往返", () => {
    const cursor = {
      deviceA: { lastDay: "20260519", lastSeq: 3 },
      deviceB: { lastDay: "20260518", lastSeq: 7 },
    };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  it("decode 跳过格式非法的 device 条目", () => {
    const raw = JSON.stringify({
      deviceA: { lastDay: "20260519", lastSeq: 3 },
      bad1: { lastDay: "abc", lastSeq: 1 },
      bad2: { lastDay: "20260519", lastSeq: -1 },
      bad3: "string",
    });
    expect(decodeCursor(raw)).toEqual({
      deviceA: { lastDay: "20260519", lastSeq: 3 },
    });
  });

  it("advanceCursor 仅在严格新进度时更新", () => {
    const base = decodeCursor(
      JSON.stringify({ deviceA: { lastDay: "20260519", lastSeq: 3 } }),
    );
    const same = advanceCursor(base, "deviceA", {
      lastDay: "20260519",
      lastSeq: 3,
    });
    expect(same).toBe(base);

    const back = advanceCursor(base, "deviceA", {
      lastDay: "20260519",
      lastSeq: 1,
    });
    expect(back).toBe(base);

    const newer = advanceCursor(base, "deviceA", {
      lastDay: "20260519",
      lastSeq: 4,
    });
    expect(newer.deviceA).toEqual({ lastDay: "20260519", lastSeq: 4 });

    const nextDay = advanceCursor(base, "deviceA", {
      lastDay: "20260520",
      lastSeq: 0,
    });
    expect(nextDay.deviceA).toEqual({ lastDay: "20260520", lastSeq: 0 });

    const newDevice = advanceCursor(base, "deviceC", {
      lastDay: "20260519",
      lastSeq: 1,
    });
    expect(newDevice.deviceA).toEqual({ lastDay: "20260519", lastSeq: 3 });
    expect(newDevice.deviceC).toEqual({ lastDay: "20260519", lastSeq: 1 });
  });

  it("isStrictlyAfter 比较语义符合 (day, seq) 字典序", () => {
    expect(
      isStrictlyAfter(
        { lastDay: "20260520", lastSeq: 0 },
        { lastDay: "20260519", lastSeq: 99 },
      ),
    ).toBe(true);
    expect(
      isStrictlyAfter(
        { lastDay: "20260519", lastSeq: 4 },
        { lastDay: "20260519", lastSeq: 3 },
      ),
    ).toBe(true);
    expect(
      isStrictlyAfter(
        { lastDay: "20260519", lastSeq: 3 },
        { lastDay: "20260519", lastSeq: 3 },
      ),
    ).toBe(false);
    expect(
      isStrictlyAfter(
        { lastDay: "20260518", lastSeq: 100 },
        { lastDay: "20260519", lastSeq: 0 },
      ),
    ).toBe(false);
  });
});
