// BE-12：WebDAV 同步层的目录布局规范。
// 实现 plan D 节：
//
//   /<root>/
//     schema-version                  # 客户端 @liliatodo/schema 主版本号
//     device-locks/<device>.lock      # 短期 lock，恢复用 ETag/feature detect
//     entities/
//       <entity-type>/<id>.json       # Entity<T> 快照
//     oplog/
//       <device>/<yyyymmdd>/<seq>.jsonl
//     snapshots/
//       <yyyymmddhhmm>.jsonl          # idle 时 oplog > 1k 条触发；
//                                     # MVP 暂用 JSONL（每行一个 entity），
//                                     # 加固期再切到 .tar.zst（保留命名空间）。
//
// 与 sync/types 共享同一份数据格式，未来切换 provider 时数据零迁移。

export const WEBDAV_DEFAULT_ROOT = "/liliatodo";

const SAFE_DEVICE_PATTERN = /^[A-Za-z0-9_\-]+$/;
const SAFE_ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9\-]*$/;
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9_\-]+$/;

export interface WebdavLayout {
  readonly root: string;
  readonly schemaVersion: string;
  readonly deviceLocks: string;
  readonly entities: string;
  readonly oplog: string;
  readonly snapshots: string;
}

export function normalizeRoot(root: string): string {
  const trimmed = root.trim();
  if (trimmed.length === 0) {
    throw new Error("WebDAV root 不能为空");
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash = withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
  if (withoutTrailingSlash.length === 0) {
    return "/";
  }
  return withoutTrailingSlash;
}

export function createWebdavLayout(root: string = WEBDAV_DEFAULT_ROOT): WebdavLayout {
  const normalized = normalizeRoot(root);
  return {
    root: normalized,
    schemaVersion: `${normalized}/schema-version`,
    deviceLocks: `${normalized}/device-locks`,
    entities: `${normalized}/entities`,
    oplog: `${normalized}/oplog`,
    snapshots: `${normalized}/snapshots`,
  };
}

export function entityPath(
  layout: WebdavLayout,
  entityType: string,
  entityId: string,
): string {
  assertSafeEntityType(entityType);
  assertSafeEntityId(entityId);
  return `${layout.entities}/${entityType}/${entityId}.json`;
}

export function entityCollectionPath(
  layout: WebdavLayout,
  entityType: string,
): string {
  assertSafeEntityType(entityType);
  return `${layout.entities}/${entityType}`;
}

export function deviceLockPath(layout: WebdavLayout, deviceId: string): string {
  assertSafeDeviceId(deviceId);
  return `${layout.deviceLocks}/${deviceId}.lock`;
}

export function oplogDayCollectionPath(
  layout: WebdavLayout,
  deviceId: string,
  yyyymmdd: string,
): string {
  assertSafeDeviceId(deviceId);
  assertYyyymmdd(yyyymmdd);
  return `${layout.oplog}/${deviceId}/${yyyymmdd}`;
}

export function oplogDeviceCollectionPath(
  layout: WebdavLayout,
  deviceId: string,
): string {
  assertSafeDeviceId(deviceId);
  return `${layout.oplog}/${deviceId}`;
}

export function oplogChunkPath(
  layout: WebdavLayout,
  deviceId: string,
  yyyymmdd: string,
  seq: number,
): string {
  const day = oplogDayCollectionPath(layout, deviceId, yyyymmdd);
  assertSeq(seq);
  return `${day}/${formatSeq(seq)}.jsonl`;
}

export const SNAPSHOT_EXTENSION = ".jsonl";

export function snapshotPath(layout: WebdavLayout, yyyymmddhhmm: string): string {
  assertYyyymmddhhmm(yyyymmddhhmm);
  return `${layout.snapshots}/${yyyymmddhhmm}${SNAPSHOT_EXTENSION}`;
}

export function parseSnapshotFileName(filename: string): string | null {
  const match = filename.match(/^(\d{12})\.jsonl$/);
  if (!match) {
    return null;
  }
  return match[1];
}

export function formatSeq(seq: number): string {
  return seq.toString(10).padStart(6, "0");
}

export function parseSeq(filename: string): number | null {
  const match = filename.match(/^(\d{1,12})\.jsonl$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function formatYyyymmdd(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export function formatYyyymmddhhmm(date: Date): string {
  const day = formatYyyymmdd(date);
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  return `${day}${hh}${mm}`;
}

function assertSafeEntityType(type: string): void {
  if (!SAFE_ENTITY_TYPE_PATTERN.test(type)) {
    throw new Error(`非法 entity type：${type}`);
  }
}

function assertSafeEntityId(id: string): void {
  if (!SAFE_ENTITY_ID_PATTERN.test(id)) {
    throw new Error(`非法 entity id：${id}`);
  }
}

function assertSafeDeviceId(device: string): void {
  if (!SAFE_DEVICE_PATTERN.test(device)) {
    throw new Error(`非法 device id：${device}`);
  }
}

function assertSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < 0 || seq > 999_999_999_999) {
    throw new Error(`非法 oplog seq：${seq}`);
  }
}

function assertYyyymmdd(value: string): void {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`非法 yyyymmdd：${value}`);
  }
}

function assertYyyymmddhhmm(value: string): void {
  if (!/^\d{12}$/.test(value)) {
    throw new Error(`非法 yyyymmddhhmm：${value}`);
  }
}

