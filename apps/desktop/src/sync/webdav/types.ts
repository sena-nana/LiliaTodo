// BE-12：WebDAV 同步层与外部 WebDAV 服务对话的最小抽象。
//
// 故意不耦合任何 npm 客户端实现：让上层先确定接口契约，未来再决定用
// `webdav` / 自研 Tauri 命令 / 其它实现都不影响业务代码。
//
// 边界约定（强约束，后续 ESLint 会通过 no-restricted-imports 强化）：
// - 本目录仅依赖 `@momo/schema` 与 `backend/contracts/{entity,op}`；
// - 严禁 import `backend/namespaces/*` 或 `backend/transport/*`；
// - 业务页面不应直接 import 本目录，统一经 `SyncProvider`。

export interface WebdavCredentials {
  readonly kind: "basic";
  readonly username: string;
  readonly password: string;
}

export interface WebdavConfig {
  readonly baseUrl: string;
  readonly root: string;
  readonly credentials: WebdavCredentials | null;
}

export interface WebdavStat {
  readonly path: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly size: number | null;
  readonly isDirectory: boolean;
}

export interface WebdavPutOptions {
  readonly ifMatch?: string;
  readonly ifNoneMatch?: string;
}

export interface WebdavPutResult {
  readonly etag: string | null;
}

export interface WebdavGetResult {
  readonly body: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface WebdavServerInfo {
  readonly davCompliance: ReadonlySet<string>;
  readonly allowMethods: ReadonlySet<string>;
  readonly serverHeader: string | null;
}

export interface WebdavClient {
  ensureCollection(path: string): Promise<void>;
  list(path: string): Promise<WebdavStat[]>;
  get(path: string): Promise<WebdavGetResult | null>;
  put(
    path: string,
    body: string,
    options?: WebdavPutOptions,
  ): Promise<WebdavPutResult>;
  delete(path: string): Promise<void>;
  stat(path: string): Promise<WebdavStat | null>;
  /**
   * 可选：探测服务端能力（OPTIONS）。
   * sprint-3 capabilities 模块在 client 未实现时按"最保守"画像退化。
   */
  options?(path: string): Promise<WebdavServerInfo>;
}

export class WebdavConflictError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "WebdavConflictError";
  }
}

export class WebdavUnreachableError extends Error {
  constructor(
    public readonly cause: unknown,
    message: string,
  ) {
    super(message);
    this.name = "WebdavUnreachableError";
  }
}
