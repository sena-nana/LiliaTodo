import { describe, expect, it } from "vitest";
import type { Op } from "../src/sync/types/op";
import { createWebdavLayout } from "../src/sync/webdav/paths";
import {
  DEFAULT_SNAPSHOT_OPLOG_THRESHOLD,
  buildCompactedSnapshot,
  countOplogChunks,
  listSnapshots,
  loadSnapshot,
  mergeOpsIntoSnapshot,
  parseSnapshot,
  parseSnapshotDocument,
  pickLatestSnapshot,
  serializeSnapshotDocument,
  serializeSnapshot,
  shouldCompactSnapshot,
  writeCompactedSnapshot,
  writeSnapshot,
  type SnapshotEntry,
} from "../src/sync/webdav/snapshot";
import type {
  WebdavClient,
  WebdavGetResult,
  WebdavPutOptions,
  WebdavPutResult,
  WebdavStat,
} from "../src/sync/webdav/types";

function makeEntity(
  type: string,
  id: string,
  payload: Record<string, unknown>,
  override: Partial<SnapshotEntry> = {},
): SnapshotEntry {
  return {
    id,
    type,
    schemaVersion: 1,
    payload,
    updatedAt: "2026-01-01T00:00:00.000Z",
    originDevice: "d1",
    ...override,
  };
}

function makeOp(partial: Partial<Op> & Pick<Op, "ts" | "originDevice">): Op {
  return {
    op: "put",
    target: { entityType: "task", entityId: "t1" },
    params: { title: "x" },
    actor: "user",
    ...partial,
  } as Op;
}

describe("serializeSnapshot / parseSnapshot", () => {
  it("空入参产出空串", () => {
    expect(serializeSnapshot([])).toBe("");
    expect(parseSnapshot("")).toEqual([]);
  });

  it("往返不丢字段", () => {
    const entries: SnapshotEntry[] = [
      makeEntity("task", "a", { title: "A" }),
      makeEntity("project", "p", { name: "P", tags: ["x", "y"] }),
    ];
    const text = serializeSnapshot(entries);
    const parsed = parseSnapshot(text);
    expect(parsed).toEqual(entries);
  });

  it("snapshot 文档可携带 pull cursor 水位且兼容 parseSnapshot", () => {
    const entry = makeEntity("task", "a", { title: "A" });
    const text = serializeSnapshotDocument([entry], { cursor: "cursor-after" });

    expect(parseSnapshot(text)).toEqual([entry]);
    expect(parseSnapshotDocument(text)).toEqual({
      entries: [entry],
      cursor: "cursor-after",
    });
  });

  it("解析容忍 CRLF 与多余空行", () => {
    const a = makeEntity("task", "a", { title: "A" });
    const text = serializeSnapshot([a]).replace(/\n/g, "\r\n") + "\r\n\r\n";
    expect(parseSnapshot(text)).toEqual([a]);
  });
});

describe("mergeOpsIntoSnapshot", () => {
  it("新建 entity 进入快照", () => {
    const result = mergeOpsIntoSnapshot(
      [],
      [
        makeOp({
          ts: "2026-01-02T00:00:00.000Z",
          originDevice: "d1",
          op: "put",
          target: { entityType: "task", entityId: "t1" },
          params: { title: "新" },
        }),
      ],
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].payload).toEqual({ title: "新" });
  });

  it("patch 在原有 entity 上字段合并", () => {
    const base = [
      makeEntity("task", "t1", { title: "旧", done: false }),
    ];
    const result = mergeOpsIntoSnapshot(base, [
      makeOp({
        ts: "2026-01-02T00:00:00.000Z",
        originDevice: "d1",
        op: "patch",
        target: { entityType: "task", entityId: "t1" },
        params: { done: true },
      }),
    ]);
    expect(result.entries[0].payload).toEqual({ title: "旧", done: true });
  });

  it("delete op 把 entity 从快照剔除", () => {
    const base = [
      makeEntity("task", "t1", { title: "X" }),
      makeEntity("task", "t2", { title: "Y" }),
    ];
    const result = mergeOpsIntoSnapshot(base, [
      makeOp({
        ts: "2026-01-02T00:00:00.000Z",
        originDevice: "d1",
        op: "delete",
        target: { entityType: "task", entityId: "t1" },
        params: null,
      }),
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe("t2");
  });

  it("不同 entity 不互相影响", () => {
    const base = [makeEntity("task", "t1", { title: "X" })];
    const result = mergeOpsIntoSnapshot(base, [
      makeOp({
        ts: "2026-01-02T00:00:00.000Z",
        originDevice: "d1",
        op: "put",
        target: { entityType: "task", entityId: "t2" },
        params: { title: "Y" },
      }),
    ]);
    expect(result.entries).toHaveLength(2);
    const ids = result.entries.map((entry) => entry.id).sort();
    expect(ids).toEqual(["t1", "t2"]);
  });
});

describe("buildCompactedSnapshot / writeCompactedSnapshot", () => {
  it("构建 compact 快照时合并 oplog 并保留新的 cursor 水位", () => {
    const base = [makeEntity("task", "t1", { title: "旧", done: false })];
    const result = buildCompactedSnapshot({
      baseEntries: base,
      ops: [
        makeOp({
          ts: "2026-01-02T00:00:00.000Z",
          originDevice: "d2",
          op: "patch",
          target: { entityType: "task", entityId: "t1" },
          params: { done: true },
        }),
        makeOp({
          ts: "2026-01-02T00:01:00.000Z",
          originDevice: "d2",
          op: "put",
          target: { entityType: "task", entityId: "t2" },
          params: { title: "新" },
        }),
      ],
      cursor: "cursor-after-pull",
    });

    expect(result.cursor).toBe("cursor-after-pull");
    expect(result.entries.map((entry) => [entry.type, entry.id])).toEqual([
      ["task", "t1"],
      ["task", "t2"],
    ]);
    expect(result.entries[0].payload).toEqual({ title: "旧", done: true });
    expect(result.conflicts).toEqual([]);
  });

  it("compact 快照会剔除被 delete op 删除的实体", () => {
    const result = buildCompactedSnapshot({
      baseEntries: [
        makeEntity("task", "t1", { title: "删除" }),
        makeEntity("task", "t2", { title: "保留" }),
      ],
      ops: [
        makeOp({
          ts: "2026-01-02T00:00:00.000Z",
          originDevice: "d2",
          op: "delete",
          target: { entityType: "task", entityId: "t1" },
          params: null,
        }),
      ],
      cursor: "cursor-after-delete",
    });

    expect(result.entries.map((entry) => entry.id)).toEqual(["t2"]);
    expect(result.cursor).toBe("cursor-after-delete");
  });

  it("写入 compact 快照时把合并结果和 cursor 一起落到 WebDAV", async () => {
    const client = new StubWebdavClient();
    const layout = createWebdavLayout("/liliatodo");
    const base = [makeEntity("task", "t1", { title: "旧" })];

    const written = await writeCompactedSnapshot({
      client,
      layout,
      timestamp: "202601030900",
      baseEntries: base,
      ops: [
        makeOp({
          ts: "2026-01-03T08:00:00.000Z",
          originDevice: "d2",
          op: "patch",
          target: { entityType: "task", entityId: "t1" },
          params: { title: "新" },
        }),
      ],
      cursor: "cursor-after-compact",
    });

    const loaded = await loadSnapshot(client, written.meta);
    expect(written.meta.path).toBe("/liliatodo/snapshots/202601030900.jsonl");
    expect(loaded.cursor).toBe("cursor-after-compact");
    expect(loaded.entries[0].payload).toEqual({ title: "新" });
  });
});

describe("shouldCompactSnapshot", () => {
  it("默认阈值 1000", () => {
    expect(DEFAULT_SNAPSHOT_OPLOG_THRESHOLD).toBe(1000);
    expect(shouldCompactSnapshot({ oplogChunkCount: 999 })).toBe(false);
    expect(shouldCompactSnapshot({ oplogChunkCount: 1000 })).toBe(true);
  });

  it("可注入自定义阈值", () => {
    expect(shouldCompactSnapshot({ oplogChunkCount: 4, threshold: 5 })).toBe(false);
    expect(shouldCompactSnapshot({ oplogChunkCount: 5, threshold: 5 })).toBe(true);
  });
});

class StubWebdavClient implements WebdavClient {
  private readonly files = new Map<string, { body: string; etag: string }>();
  private readonly collections = new Set<string>();
  private etagSeq = 0;

  async ensureCollection(path: string): Promise<void> {
    this.collections.add(path);
  }

  async list(path: string): Promise<WebdavStat[]> {
    if (!this.collections.has(path)) {
      return [];
    }
    const prefix = `${path}/`;
    const stats: WebdavStat[] = [];
    const childDirs = new Set<string>();
    for (const [filePath, file] of this.files) {
      if (!filePath.startsWith(prefix)) continue;
      const relative = filePath.slice(prefix.length);
      const slashIndex = relative.indexOf("/");
      if (slashIndex >= 0) {
        childDirs.add(`${path}/${relative.slice(0, slashIndex)}`);
        continue;
      }
      stats.push({
        path: filePath,
        etag: file.etag,
        lastModified: null,
        size: file.body.length,
        isDirectory: false,
      });
    }
    for (const collection of this.collections) {
      if (!collection.startsWith(prefix) || collection === path) continue;
      const relative = collection.slice(prefix.length);
      if (relative.includes("/")) continue;
      childDirs.add(collection);
    }
    for (const child of childDirs) {
      stats.push({
        path: child,
        etag: null,
        lastModified: null,
        size: null,
        isDirectory: true,
      });
    }
    return stats;
  }

  async get(path: string): Promise<WebdavGetResult | null> {
    const file = this.files.get(path);
    if (!file) return null;
    return { body: file.body, etag: file.etag, lastModified: null };
  }

  async put(
    path: string,
    body: string,
    _options: WebdavPutOptions = {},
  ): Promise<WebdavPutResult> {
    this.etagSeq += 1;
    const etag = `e${this.etagSeq}`;
    this.files.set(path, { body, etag });
    return { etag };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async stat(path: string): Promise<WebdavStat | null> {
    const file = this.files.get(path);
    if (!file) return null;
    return {
      path,
      etag: file.etag,
      lastModified: null,
      size: file.body.length,
      isDirectory: false,
    };
  }
}

describe("listSnapshots / pickLatestSnapshot / writeSnapshot / loadSnapshot", () => {
  it("写后能列出并选最新", async () => {
    const client = new StubWebdavClient();
    const layout = createWebdavLayout("/liliatodo");
    const e = makeEntity("task", "a", { title: "A" });
    await writeSnapshot({
      client,
      layout,
      timestamp: "202601010000",
      entries: [e],
    });
    await writeSnapshot({
      client,
      layout,
      timestamp: "202601020000",
      entries: [e],
    });
    const listed = await listSnapshots(client, layout);
    expect(listed.snapshots.map((s) => s.timestamp)).toEqual([
      "202601010000",
      "202601020000",
    ]);
    const latest = await pickLatestSnapshot(client, layout);
    expect(latest?.timestamp).toBe("202601020000");
    const loaded = await loadSnapshot(client, latest!);
    expect(loaded.entries).toEqual([e]);
    expect(loaded.cursor).toBeNull();
  });

  it("写入 snapshot 时可保存 cursor 水位", async () => {
    const client = new StubWebdavClient();
    const layout = createWebdavLayout("/liliatodo");
    const entry = makeEntity("task", "a", { title: "A" });
    const meta = await writeSnapshot({
      client,
      layout,
      timestamp: "202601010000",
      entries: [entry],
      cursor: "cursor-after",
    });

    await expect(loadSnapshot(client, meta)).resolves.toEqual({
      entries: [entry],
      meta,
      cursor: "cursor-after",
    });
  });

  it("snapshots 目录缺失返回空列表", async () => {
    const client = new StubWebdavClient();
    const layout = createWebdavLayout("/liliatodo");
    const result = await listSnapshots(client, layout);
    expect(result.snapshots).toEqual([]);
    expect(await pickLatestSnapshot(client, layout)).toBeNull();
  });

  it("loadSnapshot 指向不存在文件时抛错", async () => {
    const client = new StubWebdavClient();
    await expect(
      loadSnapshot(client, { timestamp: "202601010000", path: "/liliatodo/snapshots/202601010000.jsonl" }),
    ).rejects.toThrow(/snapshot 文件不存在/);
  });
});

describe("countOplogChunks", () => {
  it("统计所有设备日期目录中的合法 oplog chunk", async () => {
    const client = new StubWebdavClient();
    const layout = createWebdavLayout("/liliatodo");
    await client.ensureCollection(layout.oplog);
    await client.ensureCollection(`${layout.oplog}/deviceA`);
    await client.ensureCollection(`${layout.oplog}/deviceA/20260101`);
    await client.ensureCollection(`${layout.oplog}/deviceB`);
    await client.ensureCollection(`${layout.oplog}/deviceB/20260102`);
    await client.put(`${layout.oplog}/deviceA/20260101/000000.jsonl`, "{}");
    await client.put(`${layout.oplog}/deviceA/20260101/readme.txt`, "忽略");
    await client.put(`${layout.oplog}/deviceB/20260102/000001.jsonl`, "{}");

    const result = await countOplogChunks(client, layout);

    expect(result.chunkCount).toBe(2);
  });

  it("oplog 目录缺失时返回 0", async () => {
    const client = new StubWebdavClient();
    const layout = createWebdavLayout("/liliatodo");

    await expect(countOplogChunks(client, layout)).resolves.toEqual({ chunkCount: 0 });
  });
});
