<script setup lang="ts">
import { provide } from "vue";
import { RouterView } from "vue-router";
import {
  RemoteSyncConfigKey,
  RunLocalSyncSimulationKey,
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
  useTaskRepository,
} from "./data/TaskRepositoryContext";
import { createDefaultSettingsSyncRuntime } from "./sync/defaultSettingsSyncRuntime";
import {
  createRemoteSyncConfig,
  type RemoteSyncEnv,
} from "./sync/remoteSyncConfig";
import {
  createPluginStoreWebdavSecretsStore,
  createTauriHttpFetcher,
  createWebdavRuntime,
  type WebdavRuntimeResolution,
  type WebdavSecretsStore,
} from "./sync/webdav";

const repository = useTaskRepository();

// 凭据 store 与 http fetcher 都是异步装配，但 App.vue 的 setup 必须保持同步；
// 用懒加载 + 一次性缓存的方式：第一次按按钮时再实例化，失败也只回包成 disabled。
let secretsStorePromise: Promise<WebdavSecretsStore> | null = null;
function getSecretsStore(): Promise<WebdavSecretsStore> {
  secretsStorePromise ??= createPluginStoreWebdavSecretsStore();
  return secretsStorePromise;
}
const secretsStoreProvider: WebdavSecretsStore = {
  load: async () => (await getSecretsStore()).load(),
  save: async (secrets) => (await getSecretsStore()).save(secrets),
  clear: async () => (await getSecretsStore()).clear(),
};

async function buildWebdavRuntime(): Promise<WebdavRuntimeResolution> {
  const [secretsStore, httpFetcher] = await Promise.all([
    getSecretsStore(),
    createTauriHttpFetcher(),
  ]);
  return createWebdavRuntime({
    repository,
    secretsStore,
    httpFetcher,
    userAgent: "Momo/0.1 (+webdav)",
  });
}

const settingsSyncRuntime = createDefaultSettingsSyncRuntime({
  repository,
  remoteSyncConfig: createRemoteSyncConfig(readRemoteSyncEnv(import.meta.env)),
  webdavRuntimeFactory: buildWebdavRuntime,
});

provide(RemoteSyncConfigKey, settingsSyncRuntime.remoteSyncConfig);
provide(RunLocalSyncSimulationKey, settingsSyncRuntime.runLocalSyncSimulation);
provide(WebdavSyncControllerKey, settingsSyncRuntime.webdav);
provide(WebdavSecretsStoreKey, secretsStoreProvider);

function readRemoteSyncEnv(env: ImportMetaEnv): RemoteSyncEnv {
  return {
    VITE_MOMO_SYNC_BASE_URL: env.VITE_MOMO_SYNC_BASE_URL,
    VITE_MOMO_SYNC_TOKEN: env.VITE_MOMO_SYNC_TOKEN,
  };
}
</script>

<template>
  <RouterView />
</template>
