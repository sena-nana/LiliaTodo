// BE-12 sprint-4.3b：WebDAV 同步运行时的工厂层。
//
// 接 secretsStore → WebdavConfig → WebdavClient → WebdavSyncProvider → WebdavTaskSyncRunner，
// 一处汇总，避免上层（App.vue / Settings.vue）感知装配细节。
//
// 凭据缺失或非法时返回 `{ kind: 'disabled', reason }`，由上层 UI 决定提示与隐藏入口；
// 不抛错，避免冷启动直接崩页。

import type { TaskRepository } from "../../data/taskRepository";
import {
  createWebdavHttpClient,
  type HttpFetcher,
} from "./httpClient";
import { createWebdavLayout, WEBDAV_DEFAULT_ROOT, type WebdavLayout } from "./paths";
import {
  createWebdavSyncProvider,
  type SyncProvider,
} from "./provider";
import type {
  WebdavSecrets,
  WebdavSecretsStore,
} from "./secretsStore";
import {
  createWebdavTaskSyncRunner,
  type WebdavTaskSyncRunner,
} from "./taskSyncRunner";
import type { WebdavClient, WebdavConfig } from "./types";

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

  const config = secretsToConfig(secrets);
  const layout = createWebdavLayout(secrets.root || WEBDAV_DEFAULT_ROOT);
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
  const runner = createWebdavTaskSyncRunner({
    provider,
    repository: options.repository,
    deviceId: secrets.deviceId,
    now: options.now,
  });

  return { kind: "enabled", runner, secrets, layout, provider, client };
}

function secretsToConfig(secrets: WebdavSecrets): WebdavConfig {
  return {
    baseUrl: secrets.baseUrl,
    root: secrets.root,
    credentials: {
      kind: "basic",
      username: secrets.username,
      password: secrets.password,
    },
  };
}
