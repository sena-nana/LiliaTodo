import { describe, expect, it } from "vitest";
import {
  conservativeWebdavCapabilities,
  detectWebdavCapabilities,
  inferVendor,
} from "../src/sync/webdav/capabilities";
import type {
  WebdavClient,
  WebdavServerInfo,
} from "../src/sync/webdav/types";

function makeClient(
  override: Partial<WebdavClient> = {},
): WebdavClient {
  const base: WebdavClient = {
    async ensureCollection() {},
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async put() {
      return { etag: null };
    },
    async delete() {},
    async stat() {
      return null;
    },
  };
  return { ...base, ...override };
}

describe("inferVendor", () => {
  it("识别 nextcloud", () => {
    expect(inferVendor("Nextcloud 28.0.1")).toBe("nextcloud");
  });

  it("识别 jianguoyun / nutstore / 中文名", () => {
    expect(inferVendor("Jianguoyun-WebDAV")).toBe("jianguoyun");
    expect(inferVendor("nutstore/1.0")).toBe("jianguoyun");
    expect(inferVendor("坚果云 dav")).toBe("jianguoyun");
  });

  it("无法识别返回 unknown", () => {
    expect(inferVendor("Apache/2.4")).toBe("unknown");
    expect(inferVendor(null)).toBe("unknown");
  });
});

describe("detectWebdavCapabilities", () => {
  it("client 不带 options 时返回最保守画像", async () => {
    const client = makeClient();
    const caps = await detectWebdavCapabilities({
      client,
      probePath: "/momo",
    });
    expect(caps).toEqual(conservativeWebdavCapabilities);
  });

  it("OPTIONS 异常时退回保守画像", async () => {
    const client = makeClient({
      async options() {
        throw new Error("network down");
      },
    });
    const caps = await detectWebdavCapabilities({
      client,
      probePath: "/momo",
    });
    expect(caps).toEqual(conservativeWebdavCapabilities);
  });

  it("nextcloud + class 2 LOCK 被识别为支持 LOCK", async () => {
    const info: WebdavServerInfo = {
      davCompliance: new Set(["1", "2", "3"]),
      allowMethods: new Set(["GET", "PUT", "LOCK", "UNLOCK", "PROPFIND"]),
      serverHeader: "Nextcloud",
    };
    const client = makeClient({
      async options() {
        return info;
      },
    });
    const caps = await detectWebdavCapabilities({
      client,
      probePath: "/momo",
    });
    expect(caps.supportsLock).toBe(true);
    expect(caps.vendor).toBe("nextcloud");
    expect(caps.supportsPropfindInfinity).toBe(true);
    expect(caps.serverHeader).toBe("Nextcloud");
  });

  it("坚果云不支持 LOCK，且 PROPFIND 深度受限", async () => {
    const info: WebdavServerInfo = {
      davCompliance: new Set(["1"]),
      allowMethods: new Set(["GET", "PUT", "PROPFIND", "DELETE"]),
      serverHeader: "Jianguoyun-WebDAV",
    };
    const client = makeClient({
      async options() {
        return info;
      },
    });
    const caps = await detectWebdavCapabilities({
      client,
      probePath: "/momo",
    });
    expect(caps.supportsLock).toBe(false);
    expect(caps.vendor).toBe("jianguoyun");
    expect(caps.supportsPropfindInfinity).toBe(false);
    expect(caps.supportsEtag).toBe(true);
  });

  it("声明 class 2 但不在 allow 中也算不支持 LOCK", async () => {
    const info: WebdavServerInfo = {
      davCompliance: new Set(["1", "2"]),
      allowMethods: new Set(["GET", "PUT"]),
      serverHeader: "Custom",
    };
    const client = makeClient({
      async options() {
        return info;
      },
    });
    const caps = await detectWebdavCapabilities({
      client,
      probePath: "/momo",
    });
    expect(caps.supportsLock).toBe(false);
  });
});
