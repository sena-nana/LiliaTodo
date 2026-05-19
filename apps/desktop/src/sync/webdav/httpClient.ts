// BE-12 sprint-4.2：基于 fetch 的 WebDAV HTTP 客户端，首要适配坚果云。
//
// 设计要点：
// - 不直接持有 globalThis.fetch；通过 HttpFetcher 注入，便于单测，
//   也保留未来切到 Tauri http plugin（解决浏览器进程 CORS）时仅替换 fetcher 的口子。
// - 不引入任何 WebDAV npm 包（dav/webdav-client）；只用 fetch + DOMParser，
//   产物体积小、可控、加密/凭据处理就近统一在本文件。
// - 坚果云特化：不支持 LOCK/UNLOCK、不支持 PROPFIND depth=infinity；
//   list 默认 depth=1，不递归；ensureCollection 失败重试一次（已有目录通常 405）。
//
// 注意：本文件仅实现 WebdavClient 协议；不掺杂业务逻辑（Op/Entity 转换在 provider 层）。

import {
  WebdavConflictError,
  WebdavUnreachableError,
  type WebdavClient,
  type WebdavConfig,
  type WebdavGetResult,
  type WebdavPutOptions,
  type WebdavPutResult,
  type WebdavServerInfo,
  type WebdavStat,
} from "./types";

export interface HttpHeaders {
  readonly [name: string]: string;
}

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: HttpHeaders;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: HttpHeaders;
  readonly body: string;
}

export interface HttpFetcher {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export interface CreateWebdavHttpClientOptions {
  readonly config: WebdavConfig;
  readonly fetcher: HttpFetcher;
  /** 用户代理；坚果云不强制，但便于日志诊断。 */
  readonly userAgent?: string;
}

export function createWebdavHttpClient(
  options: CreateWebdavHttpClientOptions,
): WebdavClient {
  const { config, fetcher } = options;
  const baseUrl = trimTrailingSlash(config.baseUrl);
  const authHeader = buildAuthHeader(config);

  function urlFor(path: string): string {
    const ensured = path.startsWith("/") ? path : `/${path}`;
    return `${baseUrl}${encodePath(ensured)}`;
  }

  function commonHeaders(extra: HttpHeaders = {}): HttpHeaders {
    const headers: Record<string, string> = { ...extra };
    if (authHeader !== null) {
      headers["Authorization"] = authHeader;
    }
    if (options.userAgent !== undefined) {
      headers["User-Agent"] = options.userAgent;
    }
    return headers;
  }

  async function send(req: HttpRequest): Promise<HttpResponse> {
    try {
      return await fetcher.request(req);
    } catch (error) {
      throw new WebdavUnreachableError(
        error,
        `WebDAV 请求失败 ${req.method} ${req.url}`,
      );
    }
  }

  return {
    async ensureCollection(path: string): Promise<void> {
      // MKCOL；已存在时通常 405 Method Not Allowed，亦视为成功。
      const res = await send({
        method: "MKCOL",
        url: urlFor(ensureTrailingSlash(path)),
        headers: commonHeaders(),
      });
      if (res.status === 201 || res.status === 200) {
        return;
      }
      if (res.status === 405 || res.status === 301) {
        // 已存在；不重复创建。
        return;
      }
      if (res.status === 409) {
        throw new WebdavConflictError(
          path,
          `MKCOL 父目录缺失：${path}`,
        );
      }
      throw new WebdavUnreachableError(
        new Error(`HTTP ${res.status}`),
        `WebDAV MKCOL 失败 ${path}`,
      );
    },

    async list(path: string): Promise<WebdavStat[]> {
      const res = await send({
        method: "PROPFIND",
        url: urlFor(ensureTrailingSlash(path)),
        headers: commonHeaders({
          Depth: "1",
          "Content-Type": "application/xml; charset=utf-8",
        }),
        body: PROPFIND_ALLPROP_BODY,
      });
      if (res.status === 404) {
        return [];
      }
      if (res.status !== 207 && res.status !== 200) {
        throw new WebdavUnreachableError(
          new Error(`HTTP ${res.status}`),
          `WebDAV PROPFIND 失败 ${path}`,
        );
      }
      const stats = parseMultistatus(res.body, baseUrl);
      const normalizedSelf = trimTrailingSlash(path);
      return stats.filter((stat) => trimTrailingSlash(stat.path) !== normalizedSelf);
    },

    async get(path: string): Promise<WebdavGetResult | null> {
      const res = await send({
        method: "GET",
        url: urlFor(path),
        headers: commonHeaders(),
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        throw new WebdavUnreachableError(
          new Error(`HTTP ${res.status}`),
          `WebDAV GET 失败 ${path}`,
        );
      }
      return {
        body: res.body,
        etag: pickHeader(res.headers, "etag"),
        lastModified: pickHeader(res.headers, "last-modified"),
      };
    },

    async put(
      path: string,
      body: string,
      putOptions: WebdavPutOptions = {},
    ): Promise<WebdavPutResult> {
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
      };
      if (putOptions.ifMatch !== undefined) {
        headers["If-Match"] = putOptions.ifMatch;
      }
      if (putOptions.ifNoneMatch !== undefined) {
        headers["If-None-Match"] = putOptions.ifNoneMatch;
      }
      const res = await send({
        method: "PUT",
        url: urlFor(path),
        headers: commonHeaders(headers),
        body,
      });
      if (res.status === 412) {
        throw new WebdavConflictError(
          path,
          `WebDAV PUT 条件不满足（If-Match 失败）：${path}`,
        );
      }
      if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
        throw new WebdavUnreachableError(
          new Error(`HTTP ${res.status}`),
          `WebDAV PUT 失败 ${path}`,
        );
      }
      return { etag: pickHeader(res.headers, "etag") };
    },

    async delete(path: string): Promise<void> {
      const res = await send({
        method: "DELETE",
        url: urlFor(path),
        headers: commonHeaders(),
      });
      if (res.status === 204 || res.status === 200 || res.status === 404) {
        return;
      }
      throw new WebdavUnreachableError(
        new Error(`HTTP ${res.status}`),
        `WebDAV DELETE 失败 ${path}`,
      );
    },

    async stat(path: string): Promise<WebdavStat | null> {
      const res = await send({
        method: "PROPFIND",
        url: urlFor(path),
        headers: commonHeaders({
          Depth: "0",
          "Content-Type": "application/xml; charset=utf-8",
        }),
        body: PROPFIND_ALLPROP_BODY,
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 207 && res.status !== 200) {
        throw new WebdavUnreachableError(
          new Error(`HTTP ${res.status}`),
          `WebDAV PROPFIND(depth=0) 失败 ${path}`,
        );
      }
      const stats = parseMultistatus(res.body, baseUrl);
      return stats[0] ?? null;
    },

    async options(path: string): Promise<WebdavServerInfo> {
      const res = await send({
        method: "OPTIONS",
        url: urlFor(path),
        headers: commonHeaders(),
      });
      if (res.status !== 200 && res.status !== 204) {
        throw new WebdavUnreachableError(
          new Error(`HTTP ${res.status}`),
          `WebDAV OPTIONS 失败 ${path}`,
        );
      }
      const davHeader = pickHeader(res.headers, "dav") ?? "";
      const allowHeader = pickHeader(res.headers, "allow") ?? "";
      const serverHeader = pickHeader(res.headers, "server");
      return {
        davCompliance: new Set(
          davHeader
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
        ),
        allowMethods: new Set(
          allowHeader
            .split(",")
            .map((part) => part.trim().toUpperCase())
            .filter((part) => part.length > 0),
        ),
        serverHeader,
      };
    },
  };
}

const PROPFIND_ALLPROP_BODY = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<d:propfind xmlns:d="DAV:">',
  "  <d:prop>",
  "    <d:resourcetype/>",
  "    <d:getetag/>",
  "    <d:getlastmodified/>",
  "    <d:getcontentlength/>",
  "  </d:prop>",
  "</d:propfind>",
].join("\n");

function trimTrailingSlash(value: string): string {
  if (value.length === 0) return value;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function ensureTrailingSlash(value: string): string {
  if (value.length === 0) return "/";
  return value.endsWith("/") ? value : `${value}/`;
}

function encodePath(path: string): string {
  // 仅对各段做 encodeURIComponent，保留 "/" 与开头斜杠；
  // 不使用 encodeURI 是因为它会漏编码 `#` `?` 等元字符。
  return path
    .split("/")
    .map((segment, idx) =>
      idx === 0 && segment.length === 0
        ? ""
        : encodeURIComponent(segment),
    )
    .join("/");
}

function buildAuthHeader(config: WebdavConfig): string | null {
  const credentials = config.credentials;
  if (credentials === null) return null;
  if (credentials.kind !== "basic") {
    throw new Error(`暂不支持的 WebDAV 凭据类型：${credentials.kind}`);
  }
  const token = `${credentials.username}:${credentials.password}`;
  return `Basic ${base64Encode(token)}`;
}

function base64Encode(value: string): string {
  // 浏览器与 jsdom 都有 btoa；Tauri 后端进程少见但本模块仅在前端运行。
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(unescape(encodeURIComponent(value)));
  }
  // Node fallback：避免在测试环境少依赖时报错。
  const nodeBuffer = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (nodeBuffer) {
    return nodeBuffer.from(value, "utf-8").toString("base64");
  }
  throw new Error("WebDAV 客户端：当前环境缺少 btoa/Buffer，无法生成 Basic 凭据");
}

function pickHeader(headers: HttpHeaders, name: string): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return null;
}

interface MultistatusEntry {
  readonly stat: WebdavStat;
}

function parseMultistatus(xml: string, baseUrl: string): WebdavStat[] {
  const parser = getDomParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const responses = Array.from(doc.getElementsByTagNameNS("DAV:", "response"));
  if (responses.length === 0) {
    // 部分实现使用未带命名空间的 tagname；兜底再试一次。
    const fallback = Array.from(doc.getElementsByTagName("response"));
    return fallback.map((node) => parseResponseNode(node, baseUrl)).filter(notNull);
  }
  return responses.map((node) => parseResponseNode(node, baseUrl)).filter(notNull);
}

function parseResponseNode(
  node: Element,
  baseUrl: string,
): WebdavStat | null {
  const hrefEl = firstChildLocal(node, "href");
  if (hrefEl === null) return null;
  const hrefRaw = hrefEl.textContent ?? "";
  const path = hrefToPath(hrefRaw, baseUrl);
  const propEl = findPropNode(node);
  if (propEl === null) {
    return null;
  }
  const etag = textOf(firstChildLocal(propEl, "getetag"));
  const lastModified = textOf(firstChildLocal(propEl, "getlastmodified"));
  const contentLength = textOf(firstChildLocal(propEl, "getcontentlength"));
  const resourceType = firstChildLocal(propEl, "resourcetype");
  const isDirectory =
    resourceType !== null && firstChildLocal(resourceType, "collection") !== null;
  const sizeParsed = contentLength === null ? null : Number.parseInt(contentLength, 10);
  return {
    path,
    etag: normalizeEtag(etag),
    lastModified,
    size: sizeParsed !== null && Number.isFinite(sizeParsed) ? sizeParsed : null,
    isDirectory,
  };
}

function findPropNode(responseNode: Element): Element | null {
  const propstats = Array.from(
    responseNode.getElementsByTagNameNS("DAV:", "propstat"),
  );
  const candidates = propstats.length > 0
    ? propstats
    : Array.from(responseNode.getElementsByTagName("propstat"));
  for (const ps of candidates) {
    const status = textOf(firstChildLocal(ps, "status")) ?? "";
    if (!status.includes("200")) continue;
    const prop = firstChildLocal(ps, "prop");
    if (prop !== null) return prop;
  }
  return null;
}

function firstChildLocal(node: Element, localName: string): Element | null {
  const lower = localName.toLowerCase();
  for (const child of Array.from(node.children)) {
    if (child.localName?.toLowerCase() === lower) {
      return child;
    }
  }
  return null;
}

function textOf(node: Element | null): string | null {
  if (node === null) return null;
  const text = node.textContent;
  if (text === null) return null;
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeEtag(etag: string | null): string | null {
  if (etag === null) return null;
  return etag.replace(/^W\//i, "").replace(/^"|"$/g, "");
}

function hrefToPath(href: string, baseUrl: string): string {
  if (href.length === 0) return "/";
  let decoded: string;
  try {
    decoded = decodeURI(href);
  } catch {
    decoded = href;
  }
  if (/^https?:\/\//i.test(decoded)) {
    // 绝对 URL：剥 baseUrl 前缀（保留兜底）。
    try {
      const url = new URL(decoded);
      return url.pathname || "/";
    } catch {
      return decoded;
    }
  }
  // 已是绝对路径
  if (decoded.startsWith("/")) {
    // 若 baseUrl 是完整 URL 且有 pathname 前缀，则剥掉，便于上层直接对照 layout 路径。
    try {
      const base = new URL(baseUrl);
      if (base.pathname && base.pathname !== "/" && decoded.startsWith(base.pathname)) {
        const stripped = decoded.slice(base.pathname.length);
        return stripped.startsWith("/") ? stripped : `/${stripped}`;
      }
    } catch {
      // baseUrl 不是完整 URL；忽略，按原值返回。
    }
    return decoded;
  }
  return `/${decoded}`;
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

interface DomParserLike {
  parseFromString(text: string, mime: string): Document;
}

function getDomParser(): DomParserLike {
  const ctor = (globalThis as { DOMParser?: new () => DomParserLike }).DOMParser;
  if (typeof ctor !== "function") {
    throw new Error("WebDAV 客户端：当前环境缺少 DOMParser，无法解析 PROPFIND XML");
  }
  return new ctor();
}

export type { MultistatusEntry };
