// BE-12 sprint-4.3a：把 @tauri-apps/plugin-http 包装为 HttpFetcher。
//
// 为什么不直接用浏览器 fetch：
//   - 坚果云不会给 LiliaTodo origin 加 Access-Control-Allow-Origin，浏览器进程
//     发起的跨域 WebDAV 请求会被 CORS 预检拦下；
//   - plugin-http 由 Tauri rust 端 reqwest 直接发起，绕过 webview 同源策略；
//   - 域名白名单由 capabilities/default.json 的 http:default scope 收口，
//     防止本 fetcher 被滥用打到任意远端。
//
// 注入点：
//   const client = createWebdavHttpClient({
//     config,
//     fetcher: await createTauriHttpFetcher(),
//   });
//
// 注意：本文件需要 Tauri 运行时（webview 上下文）才能加载 plugin-http；
// vitest（jsdom）下用 mock fetcher 即可，不应直接 import 本模块。

import type {
  HttpFetcher,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
} from "./httpClient";

type PluginFetchFn = typeof globalThis.fetch;

interface PluginHttpModule {
  readonly fetch: PluginFetchFn;
}

export interface CreateTauriHttpFetcherOptions {
  /**
   * 测试或非 Tauri 环境下注入自定义 fetch 实现；
   * 生产路径走默认（懒加载 @tauri-apps/plugin-http）。
   */
  readonly pluginHttp?: PluginHttpModule;
}

export async function createTauriHttpFetcher(
  options: CreateTauriHttpFetcherOptions = {},
): Promise<HttpFetcher> {
  const moduleRef = options.pluginHttp ?? (await loadPluginHttp());
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const response = await moduleRef.fetch(req.url, {
        method: req.method,
        headers: toHeadersInit(req.headers),
        body: req.body,
      });
      const headers = headersToPlain(response.headers);
      const body = await response.text();
      return {
        status: response.status,
        headers,
        body,
      };
    },
  };
}

async function loadPluginHttp(): Promise<PluginHttpModule> {
  // 动态 import：避免在 vitest/jsdom 等非 Tauri 上下文里因 ESM 解析失败而 throw。
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier);",
  ) as (s: string) => Promise<unknown>;
  const mod = (await dynamicImport("@tauri-apps/plugin-http")) as {
    fetch?: PluginFetchFn;
  };
  if (typeof mod.fetch !== "function") {
    throw new Error("WebDAV：@tauri-apps/plugin-http 未导出 fetch");
  }
  return { fetch: mod.fetch };
}

function toHeadersInit(headers: HttpHeaders): HeadersInit {
  const out: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    out[key] = headers[key];
  }
  return out;
}

function headersToPlain(headers: Headers): HttpHeaders {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
