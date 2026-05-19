import { describe, expect, it } from "vitest";
import {
  createWebdavHttpClient,
  type HttpFetcher,
  type HttpRequest,
  type HttpResponse,
} from "../src/sync/webdav/httpClient";
import {
  WebdavConflictError,
  WebdavUnreachableError,
  type WebdavConfig,
} from "../src/sync/webdav/types";

interface RecordedRequest extends HttpRequest {
  readonly index: number;
}

function makeFetcher(
  handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>,
): { fetcher: HttpFetcher; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  let i = 0;
  const fetcher: HttpFetcher = {
    async request(req) {
      calls.push({ ...req, index: i });
      i += 1;
      return handler(req);
    },
  };
  return { fetcher, calls };
}

function jianguoyunConfig(): WebdavConfig {
  return {
    baseUrl: "https://dav.jianguoyun.com/dav",
    root: "/momo",
    credentials: {
      kind: "basic",
      username: "user@example.com",
      password: "secret-app-token",
    },
  };
}

describe("createWebdavHttpClient — Basic 头与 URL 编码", () => {
  it("将凭据 base64 后写入 Authorization", async () => {
    const { fetcher, calls } = makeFetcher(() => ({
      status: 200,
      headers: { dav: "1", allow: "GET, PUT, PROPFIND", server: "Jianguoyun-WebDAV" },
      body: "",
    }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await client.options!("/momo");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["Authorization"]).toBe(
      "Basic " + btoa("user@example.com:secret-app-token"),
    );
  });

  it("路径段做 encodeURIComponent，保留斜杠", async () => {
    const { fetcher, calls } = makeFetcher(() => ({
      status: 200,
      headers: {},
      body: "",
    }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await client.get("/momo/entities/任务/a b.json");
    expect(calls[0].url).toBe(
      "https://dav.jianguoyun.com/dav/momo/entities/" +
        encodeURIComponent("任务") +
        "/" +
        encodeURIComponent("a b.json"),
    );
  });
});

describe("ensureCollection", () => {
  it("201 / 200 视为创建成功", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 201, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await expect(client.ensureCollection("/momo/entities")).resolves.toBeUndefined();
  });

  it("405 视为已存在", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 405, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await expect(client.ensureCollection("/momo/entities")).resolves.toBeUndefined();
  });

  it("409 抛 WebdavConflictError 提示父目录缺失", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 409, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await expect(client.ensureCollection("/momo/a/b/c")).rejects.toBeInstanceOf(
      WebdavConflictError,
    );
  });
});

describe("put", () => {
  it("传 If-Match 头并解析 etag 响应头", async () => {
    const { fetcher, calls } = makeFetcher(() => ({
      status: 201,
      headers: { ETag: '"new-etag"' },
      body: "",
    }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    const result = await client.put("/momo/entities/task/x.json", "body", {
      ifMatch: '"old-etag"',
    });
    expect(calls[0].headers["If-Match"]).toBe('"old-etag"');
    expect(result.etag).toBe('"new-etag"');
  });

  it("412 抛 WebdavConflictError", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 412, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await expect(
      client.put("/momo/entities/task/x.json", "body", { ifMatch: '"old"' }),
    ).rejects.toBeInstanceOf(WebdavConflictError);
  });
});

describe("get", () => {
  it("404 返回 null", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 404, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    expect(await client.get("/momo/entities/task/missing.json")).toBeNull();
  });

  it("200 返回 body + etag + lastModified", async () => {
    const { fetcher } = makeFetcher(() => ({
      status: 200,
      headers: { ETag: '"xyz"', "Last-Modified": "Mon, 19 May 2026 12:00:00 GMT" },
      body: "payload",
    }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    const result = await client.get("/momo/entities/task/a.json");
    expect(result).toEqual({
      body: "payload",
      etag: '"xyz"',
      lastModified: "Mon, 19 May 2026 12:00:00 GMT",
    });
  });
});

describe("delete", () => {
  it("204 / 200 / 404 都不抛错", async () => {
    for (const status of [200, 204, 404]) {
      const { fetcher } = makeFetcher(() => ({ status, headers: {}, body: "" }));
      const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
      await expect(
        client.delete("/momo/entities/task/x.json"),
      ).resolves.toBeUndefined();
    }
  });
});

describe("stat — PROPFIND depth=0", () => {
  it("解析坚果云典型 multistatus，剥 baseUrl pathname 前缀", async () => {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/momo/entities/task/a.json</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>"abc"</d:getetag>
        <d:getlastmodified>Mon, 19 May 2026 12:00:00 GMT</d:getlastmodified>
        <d:getcontentlength>42</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
    const { fetcher, calls } = makeFetcher(() => ({
      status: 207,
      headers: { "Content-Type": "application/xml" },
      body,
    }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    const stat = await client.stat("/momo/entities/task/a.json");
    expect(calls[0].method).toBe("PROPFIND");
    expect(calls[0].headers["Depth"]).toBe("0");
    expect(stat).not.toBeNull();
    expect(stat!.path).toBe("/momo/entities/task/a.json");
    expect(stat!.etag).toBe("abc");
    expect(stat!.size).toBe(42);
    expect(stat!.isDirectory).toBe(false);
    expect(stat!.lastModified).toBe("Mon, 19 May 2026 12:00:00 GMT");
  });

  it("404 返回 null", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 404, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    expect(await client.stat("/momo/entities/task/none.json")).toBeNull();
  });
});

describe("list — PROPFIND depth=1", () => {
  it("过滤掉与自身路径相等的 response", async () => {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/momo/entities/task/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/momo/entities/task/a.json</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>"e1"</d:getetag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/momo/entities/task/b.json</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>W/"e2"</d:getetag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
    const { fetcher, calls } = makeFetcher(() => ({
      status: 207,
      headers: {},
      body,
    }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    const stats = await client.list("/momo/entities/task");
    expect(calls[0].headers["Depth"]).toBe("1");
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.path).sort()).toEqual([
      "/momo/entities/task/a.json",
      "/momo/entities/task/b.json",
    ]);
    const weak = stats.find((s) => s.path.endsWith("b.json"));
    expect(weak?.etag).toBe("e2");
  });

  it("404 返回空数组", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 404, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    expect(await client.list("/momo/empty")).toEqual([]);
  });
});

describe("options — 探测服务能力", () => {
  it("解析 DAV / Allow / Server 头", async () => {
    const { fetcher } = makeFetcher(() => ({
      status: 200,
      headers: {
        DAV: "1, 3",
        Allow: "GET, PUT, PROPFIND, DELETE, MKCOL",
        Server: "Jianguoyun-WebDAV",
      },
      body: "",
    }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    const info = await client.options!("/momo");
    expect(Array.from(info.davCompliance).sort()).toEqual(["1", "3"]);
    expect(info.allowMethods.has("PROPFIND")).toBe(true);
    expect(info.allowMethods.has("LOCK")).toBe(false);
    expect(info.serverHeader).toBe("Jianguoyun-WebDAV");
  });
});

describe("传输异常 → WebdavUnreachableError", () => {
  it("fetcher 抛错时包装为 WebdavUnreachableError", async () => {
    const fetcher: HttpFetcher = {
      async request() {
        throw new Error("network kaput");
      },
    };
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await expect(client.get("/momo/entities/task/x.json")).rejects.toBeInstanceOf(
      WebdavUnreachableError,
    );
  });

  it("非预期状态码也抛 WebdavUnreachableError", async () => {
    const { fetcher } = makeFetcher(() => ({ status: 500, headers: {}, body: "" }));
    const client = createWebdavHttpClient({ config: jianguoyunConfig(), fetcher });
    await expect(client.get("/momo/entities/task/x.json")).rejects.toBeInstanceOf(
      WebdavUnreachableError,
    );
  });
});
