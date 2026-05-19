// BE-12：WebDAV 同步层对业务侧暴露的 SyncProvider 接口与实现骨架。
//
// 与 plan C.2 抽象一致：
//   interface SyncProvider {
//     push(ops): Promise<void>
//     pull(since): Promise<Op[]>
//     snapshot(): Promise<Snapshot>
//   }
//
// 本文件提供：
//   - SyncProvider 接口（push/pull/snapshot/pushEntity/getEntity）
//   - WebdavSyncProvider 骨架，consumed by 上层 SyncRunner
//
// 本 sprint 完成最小可运行回路（push 单设备 jsonl chunk、pull 多设备扫日合并）；
// snapshot / 冲突仲裁 / idle 缓冲 / feature detect 留后续 sprint。

import type { Entity } from "../../backend/contracts/entity";
import type { Op } from "../../backend/contracts/op";

import {
  advanceCursor,
  decodeCursor,
  encodeCursor,
  EMPTY_CURSOR,
  type DevicePullPosition,
} from "./cursor";
import {
  createWebdavLayout,
  entityCollectionPath,
  entityPath,
  formatYyyymmdd,
  oplogChunkPath,
  oplogDayCollectionPath,
  oplogDeviceCollectionPath,
  parseSeq,
  type WebdavLayout,
} from "./paths";
import { allocateChunkSeq } from "./seq";
import {
  parseEntity,
  parseOpsJsonl,
  serializeEntity,
  serializeOps,
} from "./serialize";
import type { WebdavClient, WebdavStat } from "./types";

export interface SyncPushResult {
  readonly acceptedCount: number;
  readonly chunkPath: string | null;
}

export interface SyncPullResult {
  readonly ops: Op[];
  readonly cursor: string;
}

export interface SyncSnapshot {
  readonly entities: Entity[];
  readonly cursor: string;
}

export interface SyncProvider {
  push(ops: Op[]): Promise<SyncPushResult>;
  pull(since?: string | null): Promise<SyncPullResult>;
  snapshot(): Promise<SyncSnapshot>;
  pushEntity<T>(entity: Entity<T>): Promise<void>;
  getEntity<T>(entityType: string, entityId: string): Promise<Entity<T> | null>;
}

export interface CreateWebdavSyncProviderOptions {
  readonly client: WebdavClient;
  readonly deviceId: string;
  readonly layout?: WebdavLayout;
  readonly clock?: () => Date;
}

export function createWebdavSyncProvider({
  client,
  deviceId,
  layout = createWebdavLayout(),
  clock = () => new Date(),
}: CreateWebdavSyncProviderOptions): SyncProvider {
  assertDeviceId(deviceId);

  return {
    async push(ops) {
      if (ops.length === 0) {
        return { acceptedCount: 0, chunkPath: null };
      }
      const ownOps = ops.filter((op) => op.originDevice === deviceId);
      if (ownOps.length === 0) {
        return { acceptedCount: 0, chunkPath: null };
      }
      const day = formatYyyymmdd(clock());
      const dayPath = oplogDayCollectionPath(layout, deviceId, day);
      await client.ensureCollection(layout.oplog);
      await client.ensureCollection(oplogDeviceCollectionPath(layout, deviceId));
      await client.ensureCollection(dayPath);
      const existing = await client.list(dayPath);
      const filenames = existing.map(toBasename);
      const seq = allocateChunkSeq({ existingFilenames: filenames });
      const chunkPath = oplogChunkPath(layout, deviceId, day, seq);
      await client.put(chunkPath, serializeOps(ownOps), {
        ifNoneMatch: "*",
      });
      return { acceptedCount: ownOps.length, chunkPath };
    },

    async pull(since) {
      const startCursor = decodeCursor(since ?? null);
      const devicesRoot = layout.oplog;
      const deviceStats = await tryList(client, devicesRoot);
      const collected: Op[] = [];
      let cursor = startCursor;
      for (const deviceStat of deviceStats) {
        if (!deviceStat.isDirectory) {
          continue;
        }
        const remoteDevice = toBasename(deviceStat);
        const devicePosition = startCursor[remoteDevice];
        const deviceDir = oplogDeviceCollectionPath(layout, remoteDevice);
        const dayStats = await tryList(client, deviceDir);
        const dayNames = dayStats
          .filter((s) => s.isDirectory)
          .map(toBasename)
          .filter((d) => /^\d{8}$/.test(d))
          .sort();
        for (const day of dayNames) {
          if (devicePosition && day < devicePosition.lastDay) {
            continue;
          }
          const dayDir = oplogDayCollectionPath(layout, remoteDevice, day);
          const chunkStats = await tryList(client, dayDir);
          const seqs = chunkStats
            .map((s) => ({ stat: s, seq: parseSeq(toBasename(s)) }))
            .filter((v): v is { stat: WebdavStat; seq: number } => v.seq !== null)
            .sort((a, b) => a.seq - b.seq);
          for (const { stat, seq } of seqs) {
            if (
              devicePosition &&
              day === devicePosition.lastDay &&
              seq <= devicePosition.lastSeq
            ) {
              continue;
            }
            const got = await client.get(stat.path);
            if (got === null) {
              continue;
            }
            const ops = parseOpsJsonl(got.body);
            collected.push(...ops);
            cursor = advanceCursor(cursor, remoteDevice, {
              lastDay: day,
              lastSeq: seq,
            } satisfies DevicePullPosition);
          }
        }
      }
      return { ops: collected, cursor: encodeCursor(cursor) };
    },

    async snapshot() {
      // 本 sprint 暂只把"已存在的 entities 文件"按 entityType 扫一遍读出。
      // snapshot 合并（plan D：oplog > 1k 触发）放在后续 sprint。
      const entityRoot = layout.entities;
      const typeStats = await tryList(client, entityRoot);
      const entities: Entity[] = [];
      for (const typeStat of typeStats) {
        if (!typeStat.isDirectory) {
          continue;
        }
        const entityType = toBasename(typeStat);
        const dirPath = entityCollectionPath(layout, entityType);
        const files = await tryList(client, dirPath);
        for (const file of files) {
          if (file.isDirectory || !file.path.endsWith(".json")) {
            continue;
          }
          const got = await client.get(file.path);
          if (got === null) {
            continue;
          }
          entities.push(parseEntity(got.body));
        }
      }
      return {
        entities,
        cursor: encodeCursor(EMPTY_CURSOR),
      };
    },

    async pushEntity(entity) {
      await client.ensureCollection(layout.entities);
      await client.ensureCollection(entityCollectionPath(layout, entity.type));
      const path = entityPath(layout, entity.type, entity.id);
      await client.put(path, serializeEntity(entity));
    },

    async getEntity<T>(entityType: string, entityId: string) {
      const path = entityPath(layout, entityType, entityId);
      const got = await client.get(path);
      if (got === null) {
        return null;
      }
      return parseEntity<T>(got.body);
    },
  };
}

function toBasename(stat: WebdavStat): string {
  const trimmed = stat.path.endsWith("/")
    ? stat.path.slice(0, -1)
    : stat.path;
  const idx = trimmed.lastIndexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

async function tryList(client: WebdavClient, path: string): Promise<WebdavStat[]> {
  try {
    return await client.list(path);
  } catch {
    return [];
  }
}

function assertDeviceId(device: string): void {
  if (!/^[A-Za-z0-9_\-]+$/.test(device)) {
    throw new Error(`非法 device id：${device}`);
  }
}
