// BE-12 sprint-4.1：snapshot 序列化、合并与最新挑选。
//
// 作用：冷启动只读最新 snapshot + 之后的增量 oplog 即可重建本地状态，
// 不必把 oplog 从开服第一天回放到现在。
//
// MVP 选 JSONL 格式（每行一个 entity），原因：
//   - 无需引入 tar / zstd 依赖；
//   - WebDAV 客户端按"单文件 PUT/GET"路径即可；
//   - 加固期切到 .tar.zst 时仅需替换 serialize/parse 一对函数与 paths.SNAPSHOT_EXTENSION。
//
// 合并规则：当前 snapshot 视为"初始 state"，把新 ops 按 LWW（merge.ts）折算，
// 输出新的 entity 列表；删除型 op 把对应 entity 从 snapshot 移除。
// 语义冲突沿 mergeOpsForEntity 通道收集，由 caller 决定如何呈现给用户。

import type { Op } from "../types/op";
import type { Entity } from "../types/entity";
import {
  groupOpsByEntity,
  mergeOpsForEntity,
  type EntityWithUnknownPayload,
  type MergeOpsForEntityOptions,
} from "./merge";
import {
  parseSnapshotFileName,
  snapshotPath,
  type WebdavLayout,
} from "./paths";
import type { SemanticConflict } from "./conflict";
import type { WebdavClient } from "./types";

export type SnapshotEntry = EntityWithUnknownPayload;

export interface SnapshotMeta {
  readonly timestamp: string;
  readonly path: string;
}

/**
 * 把 entity 列表序列化为 JSONL：每行一个 entity 的紧凑 JSON。
 * 选紧凑（非 pretty）是因为：
 *   - 文件名后缀 .jsonl 在语义上就要求一行一记录；
 *   - 单行 JSON 让 parseSnapshot 不必处理 entity 内换行；
 *   - 较小体积也利于未来 zstd 压缩切换。
 */
export function serializeSnapshot(entries: readonly SnapshotEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

export function parseSnapshot(text: string): SnapshotEntry[] {
  if (text.trim().length === 0) {
    return [];
  }
  const out: SnapshotEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (raw.length === 0) {
      continue;
    }
    const lineNo = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `WebDAV 同步：snapshot 第 ${lineNo} 行 JSON 解析失败 - ${(error as Error).message}`,
      );
    }
    out.push(assertSnapshotEntry(parsed, lineNo));
  }
  return out;
}

function assertSnapshotEntry(value: unknown, line: number): SnapshotEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`WebDAV 同步：snapshot 第 ${line} 行不是对象`);
  }
  const record = value as Record<string, unknown>;
  const { id, type, schemaVersion, payload, updatedAt, originDevice } = record;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`WebDAV 同步：snapshot 第 ${line} 行 id 缺失`);
  }
  if (typeof type !== "string" || type.length === 0) {
    throw new Error(`WebDAV 同步：snapshot 第 ${line} 行 type 缺失`);
  }
  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
    throw new Error(`WebDAV 同步：snapshot 第 ${line} 行 schemaVersion 非数字`);
  }
  if (typeof updatedAt !== "string" || updatedAt.length === 0) {
    throw new Error(`WebDAV 同步：snapshot 第 ${line} 行 updatedAt 缺失`);
  }
  if (typeof originDevice !== "string" || originDevice.length === 0) {
    throw new Error(`WebDAV 同步：snapshot 第 ${line} 行 originDevice 缺失`);
  }
  const entity: Entity<Record<string, unknown>> = {
    id,
    type,
    schemaVersion,
    payload: (payload ?? {}) as Record<string, unknown>,
    updatedAt,
    originDevice,
  };
  return entity;
}

export interface MergeOpsIntoSnapshotOptions extends MergeOpsForEntityOptions {}

export interface MergeOpsIntoSnapshotResult {
  readonly entries: readonly SnapshotEntry[];
  readonly conflicts: readonly SemanticConflict[];
}

/**
 * 把一批 ops 按 entity 分组后逐组与 base 中对应 entity 合并；
 * 未在 base 中出现的 entity 视为新建（current=null）；
 * 合并结果为 null（被 delete）的 entity 不进入新 snapshot。
 */
export function mergeOpsIntoSnapshot(
  base: readonly SnapshotEntry[],
  ops: readonly Op[],
  options: MergeOpsIntoSnapshotOptions = {},
): MergeOpsIntoSnapshotResult {
  const indexed = new Map<string, SnapshotEntry>();
  for (const entry of base) {
    indexed.set(`${entry.type}:${entry.id}`, entry);
  }
  const grouped = groupOpsByEntity(ops);
  const allConflicts: SemanticConflict[] = [];
  for (const [key, bucket] of grouped) {
    const existing = indexed.get(key) ?? null;
    const result = mergeOpsForEntity(existing, bucket, options);
    allConflicts.push(...result.conflicts);
    if (result.entity === null) {
      indexed.delete(key);
    } else {
      indexed.set(key, result.entity);
    }
  }
  return {
    entries: Array.from(indexed.values()),
    conflicts: allConflicts,
  };
}

export interface ListSnapshotsResult {
  readonly snapshots: readonly SnapshotMeta[];
}

/**
 * 列 snapshots 目录下所有可识别的 snapshot 文件，按 timestamp 升序。
 * 目录不存在时返回空，不抛错。
 */
export async function listSnapshots(
  client: WebdavClient,
  layout: WebdavLayout,
): Promise<ListSnapshotsResult> {
  const stats = await client.list(layout.snapshots).catch(() => []);
  const snapshots: SnapshotMeta[] = [];
  for (const stat of stats) {
    if (stat.isDirectory) {
      continue;
    }
    const filename = stat.path.slice(stat.path.lastIndexOf("/") + 1);
    const timestamp = parseSnapshotFileName(filename);
    if (timestamp === null) {
      continue;
    }
    snapshots.push({ timestamp, path: stat.path });
  }
  snapshots.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return { snapshots };
}

/**
 * 拿到最新 snapshot 的元数据；无则返回 null。
 */
export async function pickLatestSnapshot(
  client: WebdavClient,
  layout: WebdavLayout,
): Promise<SnapshotMeta | null> {
  const { snapshots } = await listSnapshots(client, layout);
  return snapshots.length === 0 ? null : snapshots[snapshots.length - 1];
}

export interface LoadSnapshotResult {
  readonly entries: readonly SnapshotEntry[];
  readonly meta: SnapshotMeta;
}

/**
 * 下载并解析指定 snapshot；文件不存在抛错由 caller 处理（不应静默返回空，
 * 否则会让 caller 误以为"远端没数据"而触发首装兜底）。
 */
export async function loadSnapshot(
  client: WebdavClient,
  meta: SnapshotMeta,
): Promise<LoadSnapshotResult> {
  const result = await client.get(meta.path);
  if (result === null) {
    throw new Error(`WebDAV 同步：snapshot 文件不存在 ${meta.path}`);
  }
  return {
    entries: parseSnapshot(result.body),
    meta,
  };
}

export interface WriteSnapshotOptions {
  readonly client: WebdavClient;
  readonly layout: WebdavLayout;
  readonly timestamp: string;
  readonly entries: readonly SnapshotEntry[];
}

export async function writeSnapshot(
  options: WriteSnapshotOptions,
): Promise<SnapshotMeta> {
  const { client, layout, timestamp, entries } = options;
  await client.ensureCollection(layout.snapshots);
  const path = snapshotPath(layout, timestamp);
  await client.put(path, serializeSnapshot(entries));
  return { timestamp, path };
}

export const DEFAULT_SNAPSHOT_OPLOG_THRESHOLD = 1000;

export interface ShouldCompactSnapshotInput {
  readonly oplogChunkCount: number;
  readonly threshold?: number;
}

/**
 * 简单阈值判断：oplog chunk 数超过阈值时建议 compact。
 * 真正"判断当前是否 idle"由调度层（scheduler）拿这个建议结合空闲信号决定。
 */
export function shouldCompactSnapshot({
  oplogChunkCount,
  threshold = DEFAULT_SNAPSHOT_OPLOG_THRESHOLD,
}: ShouldCompactSnapshotInput): boolean {
  return oplogChunkCount >= threshold;
}
