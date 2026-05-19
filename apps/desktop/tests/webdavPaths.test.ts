import { describe, expect, it } from "vitest";
import {
  createWebdavLayout,
  deviceLockPath,
  entityCollectionPath,
  entityPath,
  formatSeq,
  formatYyyymmdd,
  formatYyyymmddhhmm,
  normalizeRoot,
  oplogChunkPath,
  oplogDayCollectionPath,
  oplogDeviceCollectionPath,
  parseSeq,
  snapshotPath,
  WEBDAV_DEFAULT_ROOT,
} from "../src/sync/webdav/paths";

describe("BE-12 WebDAV 路径布局", () => {
  it("默认 root 为 /momo", () => {
    expect(WEBDAV_DEFAULT_ROOT).toBe("/momo");
    const layout = createWebdavLayout();
    expect(layout.root).toBe("/momo");
    expect(layout.schemaVersion).toBe("/momo/schema-version");
    expect(layout.deviceLocks).toBe("/momo/device-locks");
    expect(layout.entities).toBe("/momo/entities");
    expect(layout.oplog).toBe("/momo/oplog");
    expect(layout.snapshots).toBe("/momo/snapshots");
  });

  it("normalizeRoot 处理前后斜杠", () => {
    expect(normalizeRoot("momo")).toBe("/momo");
    expect(normalizeRoot("/momo/")).toBe("/momo");
    expect(normalizeRoot("/momo")).toBe("/momo");
    expect(normalizeRoot("/foo/bar/")).toBe("/foo/bar");
  });

  it("normalizeRoot 拒绝空 root", () => {
    expect(() => normalizeRoot("")).toThrow(/root/);
    expect(() => normalizeRoot("   ")).toThrow(/root/);
  });

  it("entityPath / entityCollectionPath 按 plan D 节布局", () => {
    const layout = createWebdavLayout();
    expect(entityPath(layout, "task", "abc-123")).toBe(
      "/momo/entities/task/abc-123.json",
    );
    expect(entityCollectionPath(layout, "notification")).toBe(
      "/momo/entities/notification",
    );
  });

  it("entityPath 拒绝非法 entityType / entityId", () => {
    const layout = createWebdavLayout();
    expect(() => entityPath(layout, "Task", "abc")).toThrow(/entity type/);
    expect(() => entityPath(layout, "task", "../escape")).toThrow(/entity id/);
  });

  it("oplog 路径按 device/yyyymmdd/seq 布局", () => {
    const layout = createWebdavLayout();
    expect(oplogDeviceCollectionPath(layout, "deviceA")).toBe(
      "/momo/oplog/deviceA",
    );
    expect(oplogDayCollectionPath(layout, "deviceA", "20260519")).toBe(
      "/momo/oplog/deviceA/20260519",
    );
    expect(oplogChunkPath(layout, "deviceA", "20260519", 7)).toBe(
      "/momo/oplog/deviceA/20260519/000007.jsonl",
    );
  });

  it("deviceLockPath 按 device 名命名", () => {
    const layout = createWebdavLayout();
    expect(deviceLockPath(layout, "deviceA")).toBe(
      "/momo/device-locks/deviceA.lock",
    );
  });

  it("snapshotPath 校验 yyyymmddhhmm", () => {
    const layout = createWebdavLayout();
    expect(snapshotPath(layout, "202605191230")).toBe(
      "/momo/snapshots/202605191230.tar.zst",
    );
    expect(() => snapshotPath(layout, "2026051912")).toThrow(/yyyymmddhhmm/);
  });

  it("formatSeq / parseSeq 互逆", () => {
    expect(formatSeq(0)).toBe("000000");
    expect(formatSeq(123)).toBe("000123");
    expect(parseSeq("000123.jsonl")).toBe(123);
    expect(parseSeq("999.jsonl")).toBe(999);
    expect(parseSeq("abc.jsonl")).toBeNull();
    expect(parseSeq("000123.json")).toBeNull();
  });

  it("formatYyyymmdd / formatYyyymmddhhmm 按 UTC 拼接", () => {
    const ref = new Date(Date.UTC(2026, 4, 19, 12, 30, 0));
    expect(formatYyyymmdd(ref)).toBe("20260519");
    expect(formatYyyymmddhhmm(ref)).toBe("202605191230");
  });

  it("自定义 root 不影响命名规则", () => {
    const layout = createWebdavLayout("/dav/momo-prod");
    expect(layout.root).toBe("/dav/momo-prod");
    expect(entityPath(layout, "task", "t1")).toBe(
      "/dav/momo-prod/entities/task/t1.json",
    );
    expect(oplogChunkPath(layout, "deviceA", "20260519", 1)).toBe(
      "/dav/momo-prod/oplog/deviceA/20260519/000001.jsonl",
    );
  });
});
