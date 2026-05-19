import { describe, expect, it, vi } from "vitest";
import {
  createEtagOptimisticLockStrategy,
  createReadBeforeWriteLockStrategy,
  pickLockStrategy,
} from "../src/sync/webdav/lock";
import type {
  WebdavCapabilities,
} from "../src/sync/webdav/capabilities";
import type {
  WebdavClient,
  WebdavStat,
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

function makeCapabilities(
  override: Partial<WebdavCapabilities> = {},
): WebdavCapabilities {
  return {
    supportsLock: false,
    supportsEtag: true,
    supportsPropfindInfinity: false,
    vendor: "unknown",
    serverHeader: null,
    ...override,
  };
}

describe("pickLockStrategy", () => {
  it("supportsLock=true 当前退化到 etag（待 sprint-4 真客户端补齐）", () => {
    const strategy = pickLockStrategy({
      client: makeClient(),
      capabilities: makeCapabilities({ supportsLock: true }),
    });
    expect(strategy.kind).toBe("etag-optimistic");
  });

  it("仅 supportsEtag 走 etag-optimistic", () => {
    const strategy = pickLockStrategy({
      client: makeClient(),
      capabilities: makeCapabilities({ supportsEtag: true }),
    });
    expect(strategy.kind).toBe("etag-optimistic");
  });

  it("ETag 也不支持时退到 read-before-write", () => {
    const strategy = pickLockStrategy({
      client: makeClient(),
      capabilities: makeCapabilities({ supportsEtag: false }),
    });
    expect(strategy.kind).toBe("read-before-write");
  });
});

describe("createEtagOptimisticLockStrategy", () => {
  it("把 stat 拿到的 etag 作为 token 传给 work", async () => {
    const stat: WebdavStat = {
      path: "/momo/entities/task/x.json",
      etag: "abc",
      lastModified: "2026-01-01T00:00:00.000Z",
      size: 10,
      isDirectory: false,
    };
    const client = makeClient({
      async stat() {
        return stat;
      },
    });
    const strategy = createEtagOptimisticLockStrategy(client);
    const work = vi.fn(async () => "ok");
    const result = await strategy.withLock("/momo/entities/task/x.json", work);
    expect(result).toBe("ok");
    expect(work).toHaveBeenCalledTimes(1);
    const token = work.mock.calls[0][0];
    expect(token.expectedEtag).toBe("abc");
    expect(token.expectedLastModified).toBe("2026-01-01T00:00:00.000Z");
    expect(token.kind).toBe("etag-optimistic");
  });

  it("文件不存在时 token.expectedEtag=null（首次写入场景）", async () => {
    const client = makeClient({
      async stat() {
        return null;
      },
    });
    const strategy = createEtagOptimisticLockStrategy(client);
    const work = vi.fn(async () => undefined);
    await strategy.withLock("/momo/entities/task/new.json", work);
    const token = work.mock.calls[0][0];
    expect(token.expectedEtag).toBeNull();
    expect(token.expectedLastModified).toBeNull();
  });
});

describe("createReadBeforeWriteLockStrategy", () => {
  it("写前后各 stat 一次，返回 work 结果", async () => {
    const stat: WebdavStat = {
      path: "/momo/entities/task/x.json",
      etag: null,
      lastModified: "2026-01-01T00:00:00.000Z",
      size: 10,
      isDirectory: false,
    };
    const statSpy = vi.fn(async () => stat);
    const client = makeClient({ stat: statSpy });
    const strategy = createReadBeforeWriteLockStrategy(client);
    const work = vi.fn(async () => "done");
    const result = await strategy.withLock("/momo/entities/task/x.json", work);
    expect(result).toBe("done");
    expect(statSpy).toHaveBeenCalledTimes(2);
    const token = work.mock.calls[0][0];
    expect(token.kind).toBe("read-before-write");
    expect(token.expectedLastModified).toBe("2026-01-01T00:00:00.000Z");
  });
});
