import { createWebdavLayout, normalizeRoot, WEBDAV_DEFAULT_ROOT, type WebdavLayout } from "./paths";
import type { WebdavSecrets } from "./secretsStore";
import type { WebdavConfig } from "./types";

export interface WebdavRuntimeConfig {
  readonly config: WebdavConfig;
  readonly layout: WebdavLayout;
}

export function buildWebdavRuntimeConfig(secrets: WebdavSecrets): WebdavRuntimeConfig {
  const root = normalizeWebdavRoot(secrets.root);
  return {
    config: {
      baseUrl: secrets.baseUrl,
      root,
      credentials: {
        kind: "basic",
        username: secrets.username,
        password: secrets.password,
      },
    },
    layout: createWebdavLayout(root),
  };
}

function normalizeWebdavRoot(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return WEBDAV_DEFAULT_ROOT;
  return normalizeRoot(trimmed);
}
