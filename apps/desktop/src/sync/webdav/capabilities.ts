// BE-12 sprint-3：WebDAV 服务能力探测与画像。
//
// 不同 dav 服务能力差异很大；本模块定义统一画像 `WebdavCapabilities`，
// 供 lock.ts 的 strategy 选择与 client 退化路径使用。
//
// 一期优先接入坚果云（dav.jianguoyun.com）：
//   - 不支持 WebDAV LOCK（class 2）→ 必须走 ETag 乐观锁
//   - 不支持 PROPFIND depth=infinity → 必须按目录逐层 list
//   - 服务端按邮箱+应用密码做 HTTP Basic
//
// Nextcloud 在二期再接，class 2 LOCK 才有用武之地。

import type { WebdavClient, WebdavServerInfo } from "./types";

export type WebdavVendor = "nextcloud" | "jianguoyun" | "unknown";

export interface WebdavCapabilities {
  readonly supportsLock: boolean;
  readonly supportsEtag: boolean;
  readonly supportsPropfindInfinity: boolean;
  readonly vendor: WebdavVendor;
  /** 服务端原始 Server 头，便于诊断与日志。 */
  readonly serverHeader: string | null;
}

/**
 * 最保守画像：假设服务端只能用 ETag 乐观锁，不支持 LOCK / depth=infinity。
 * 坚果云正好符合该画像，所以也是当前 sprint-4 的目标默认值。
 */
export const conservativeWebdavCapabilities: WebdavCapabilities = {
  supportsLock: false,
  supportsEtag: true,
  supportsPropfindInfinity: false,
  vendor: "unknown",
  serverHeader: null,
};

export interface DetectWebdavCapabilitiesInput {
  readonly client: WebdavClient;
  readonly probePath: string;
}

export async function detectWebdavCapabilities(
  input: DetectWebdavCapabilitiesInput,
): Promise<WebdavCapabilities> {
  const { client, probePath } = input;
  if (typeof client.options !== "function") {
    return conservativeWebdavCapabilities;
  }
  let info: WebdavServerInfo;
  try {
    info = await client.options(probePath);
  } catch {
    return conservativeWebdavCapabilities;
  }
  const supportsLock =
    info.davCompliance.has("2") && info.allowMethods.has("LOCK");
  const vendor = inferVendor(info.serverHeader);
  return {
    supportsLock,
    supportsEtag: true,
    // PROPFIND infinity 必须真发请求才能确定，OPTIONS 拿不到；
    // 这里按 vendor 经验初值，sprint-4 真客户端可在首个 PROPFIND 时回填。
    supportsPropfindInfinity: vendor === "nextcloud",
    vendor,
    serverHeader: info.serverHeader,
  };
}

export function inferVendor(serverHeader: string | null): WebdavVendor {
  if (!serverHeader) {
    return "unknown";
  }
  const normalized = serverHeader.toLowerCase();
  if (normalized.includes("nextcloud")) {
    return "nextcloud";
  }
  if (
    normalized.includes("jianguoyun") ||
    normalized.includes("nutstore") ||
    normalized.includes("坚果云")
  ) {
    return "jianguoyun";
  }
  return "unknown";
}
