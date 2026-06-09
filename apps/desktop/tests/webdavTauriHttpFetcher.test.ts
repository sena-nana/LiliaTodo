import { describe, expect, it, vi } from "vitest";
import { createTauriHttpFetcher } from "../src/sync/webdav/tauriHttpFetcher";

describe("createTauriHttpFetcher", () => {
  it("把 plugin-http fetch 包成 HttpFetcher：透传 method/headers/body，回收 status/headers/body", async () => {
    const responseHeaders = new Headers({
      ETag: '"abc"',
      "Content-Type": "application/xml",
    });
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => {
      return new Response("payload", {
        status: 207,
        headers: responseHeaders,
      });
    });
    const fetcher = await createTauriHttpFetcher({
      pluginHttp: { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    });
    const result = await fetcher.request({
      method: "PROPFIND",
      url: "https://dav.jianguoyun.com/dav/liliatodo/",
      headers: {
        Authorization: "Basic xxx",
        Depth: "1",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: "<propfind/>",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://dav.jianguoyun.com/dav/liliatodo/");
    expect(calledInit.method).toBe("PROPFIND");
    expect(calledInit.body).toBe("<propfind/>");
    expect((calledInit.headers as Record<string, string>)["Depth"]).toBe("1");
    expect(result.status).toBe(207);
    expect(result.body).toBe("payload");
    // pickHeader 在 httpClient 里大小写不敏感；这里只需保证字段存在即可。
    const keys = Object.keys(result.headers).map((k) => k.toLowerCase());
    expect(keys).toContain("etag");
    expect(keys).toContain("content-type");
  });

  it("fetch 抛错时透传给 caller（由 createWebdavHttpClient 收口为 WebdavUnreachableError）", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network down");
    });
    const fetcher = await createTauriHttpFetcher({
      pluginHttp: { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    });
    await expect(
      fetcher.request({
        method: "GET",
        url: "https://dav.jianguoyun.com/dav/liliatodo/x.json",
        headers: {},
      }),
    ).rejects.toThrow(/network down/);
  });
});
