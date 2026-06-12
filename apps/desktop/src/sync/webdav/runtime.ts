// BE-12 sprint-4.3b：WebDAV 同步运行时的工厂层。
//
// 接 secretsStore → WebdavConfig → WebdavClient → WebdavSyncProvider → WebdavTaskSyncRunner，
// 一处汇总，避免上层（App.vue / Settings.vue）感知装配细节。
//
// 凭据缺失或非法时返回 `{ kind: 'disabled', reason }`，由上层 UI 决定提示与隐藏入口；
// 不抛错，避免冷启动直接崩页。

import type { TaskRepository } from "../../data/taskRepository";
import { buildWebdavRuntimeConfig } from "./config";
import {
  createWebdavHttpClient,
  type HttpFetcher,
} from "./httpClient";
import type { WebdavLayout } from "./paths";
import {
  compactWebdavSnapshot,
  createWebdavSyncProvider,
  type CompactWebdavSnapshotResult,
  type SyncProvider,
} from "./provider";
import type {
  WebdavSecrets,
  WebdavSecretsStore,
} from "./secretsStore";
import {
  createWebdavTaskSyncRunner,
  type WebdavRunOnceResult,
  type WebdavTaskSyncRunner,
} from "./taskSyncRunner";
import {
  countOplogChunks,
  shouldCompactSnapshot,
  type CountOplogChunksResult,
} from "./snapshot";
import type { WebdavClient } from "./types";

export type WebdavRuntimeResolution =
  | {
    readonly kind: "enabled";
    readonly runner: WebdavTaskSyncRunner;
    readonly secrets: WebdavSecrets;
    readonly layout: WebdavLayout;
    readonly provider: SyncProvider;
    readonly client: WebdavClient;
  }
  | {
    readonly kind: "disabled";
    readonly reason: string;
  };

export interface CreateWebdavRuntimeOptions {
  readonly repository: TaskRepository;
  readonly secretsStore: WebdavSecretsStore;
  readonly httpFetcher: HttpFetcher;
  readonly now?: () => Date;
  readonly userAgent?: string;
  readonly snapshotCompactThreshold?: number;
  readonly isIdleWindow?: () => boolean;
  readonly countOplogChunks?: (
    client: WebdavClient,
    layout: WebdavLayout,
  ) => Promise<CountOplogChunksResult>;
  readonly compactSnapshot?: (options: {
    readonly client: WebdavClient;
    readonly deviceId: string;
    readonly layout: WebdavLayout;
    readonly clock?: () => Date;
  }) => Promise<CompactWebdavSnapshotResult>;
}

export interface CreateSnapshotCompactingRunnerOptions {
  readonly runner: WebdavTaskSyncRunner;
  readonly client: WebdavClient;
  readonly layout: WebdavLayout;
  readonly deviceId: string;
  readonly clock?: () => Date;
  readonly threshold?: number;
  readonly isIdleWindow?: () => boolean;
  readonly countOplogChunks?: (
    client: WebdavClient,
    layout: WebdavLayout,
  ) => Promise<CountOplogChunksResult>;
  readonly compactSnapshot?: (options: {
    readonly client: WebdavClient;
    readonly deviceId: string;
    readonly layout: WebdavLayout;
    readonly clock?: () => Date;
  }) => Promise<CompactWebdavSnapshotResult>;
}

export function createSnapshotCompactingRunner({
  runner,
  client,
  layout,
  deviceId,
  clock,
  threshold,
  isIdleWindow = () => true,
  countOplogChunks: countChunks = countOplogChunks,
  compactSnapshot = compactWebdavSnapshot,
}: CreateSnapshotCompactingRunnerOptions): WebdavTaskSyncRunner {
  let compactPending = false;

  return {
    async runOnce(): Promise<WebdavRunOnceResult> {
      const result = await runner.runOnce();
      if (!result.ok) {
        return result;
      }
      try {
        if (!compactPending) {
          const { chunkCount } = await countChunks(client, layout);
          compactPending = shouldCompactSnapshot({ oplogChunkCount: chunkCount, threshold });
          return result;
        }
        if (isIdleWindow()) {
          await compactSnapshot({ client, layout, deviceId, clock });
          compactPending = false;
        }
      } catch {
        // Snapshot compact 是同步后的维护任务，失败不应反向把主同步标成失败。
      }
      return result;
    },
  };
}

/**
 * 从 secretsStore 取凭据并装配完整 runtime；凭据缺失时返回 disabled。
 */
export async function createWebdavRuntime(
  options: CreateWebdavRuntimeOptions,
): Promise<WebdavRuntimeResolution> {
  let secrets: WebdavSecrets | null;
  try {
    secrets = await options.secretsStore.load();
  } catch (error) {
    return {
      kind: "disabled",
      reason: error instanceof Error
        ? `读取 WebDAV 凭据失败：${error.message}`
        : "读取 WebDAV 凭据失败",
    };
  }
  if (secrets === null) {
    return { kind: "disabled", reason: "尚未配置 WebDAV 凭据" };
  }

  const { config, layout } = buildWebdavRuntimeConfig(secrets);
  const client = createWebdavHttpClient({
    config,
    fetcher: options.httpFetcher,
    userAgent: options.userAgent,
  });
  const provider = createWebdavSyncProvider({
    client,
    deviceId: secrets.deviceId,
    layout,
    clock: options.now,
  });
  const baseRunner = createWebdavTaskSyncRunner({
    provider,
    repository: options.repository,
    deviceId: secrets.deviceId,
    now: options.now,
  });
  const runner = createSnapshotCompactingRunner({
    runner: baseRunner,
    client,
    layout,
    deviceId: secrets.deviceId,
    clock: options.now,
    threshold: options.snapshotCompactThreshold,
    isIdleWindow: options.isIdleWindow,
    countOplogChunks: options.countOplogChunks,
    compactSnapshot: options.compactSnapshot,
  });

  return { kind: "enabled", runner, secrets, layout, provider, client };
}
