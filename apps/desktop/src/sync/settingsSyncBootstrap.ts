import type { TaskRepository } from "../data/taskRepository";
import { createDefaultSettingsSyncRuntime } from "./defaultSettingsSyncRuntime";
import type { WebdavRuntimeResolution } from "./webdav/runtime";
import type { WebdavSecretsStore } from "./webdav/secretsStore";

let secretsStorePromise: Promise<WebdavSecretsStore> | null = null;

async function getSecretsStore(): Promise<WebdavSecretsStore> {
  secretsStorePromise ??= import("./webdav/secretsStore").then(
    ({ createPluginStoreWebdavSecretsStore }) => createPluginStoreWebdavSecretsStore(),
  );
  return secretsStorePromise;
}

export function createLazySettingsSyncRuntime(repository: TaskRepository) {
  const secretsStoreProvider: WebdavSecretsStore = {
    load: async () => (await getSecretsStore()).load(),
    save: async (secrets) => (await getSecretsStore()).save(secrets),
    clear: async () => (await getSecretsStore()).clear(),
  };

  async function buildWebdavRuntime(): Promise<WebdavRuntimeResolution> {
    const [
      secretsStore,
      { createTauriHttpFetcher },
      { createWebdavRuntime },
    ] = await Promise.all([
      getSecretsStore(),
      import("./webdav/tauriHttpFetcher"),
      import("./webdav/runtime"),
    ]);
    const httpFetcher = await createTauriHttpFetcher();
    return createWebdavRuntime({
      repository,
      secretsStore,
      httpFetcher,
      userAgent: "Momo/0.1 (+webdav)",
    });
  }

  return {
    settingsSyncRuntime: createDefaultSettingsSyncRuntime({
      webdavRuntimeFactory: buildWebdavRuntime,
    }),
    secretsStoreProvider,
  };
}
