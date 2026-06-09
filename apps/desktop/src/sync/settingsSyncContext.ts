import type { InjectionKey } from "vue";
import type { WebdavSyncController } from "./defaultSettingsSyncRuntime";
import type { WebdavSecretsStore } from "./webdav/secretsStore";

export const WebdavSyncControllerKey: InjectionKey<WebdavSyncController | null> =
  Symbol("WebdavSyncController");
export const WebdavSecretsStoreKey: InjectionKey<WebdavSecretsStore | null> =
  Symbol("WebdavSecretsStore");
