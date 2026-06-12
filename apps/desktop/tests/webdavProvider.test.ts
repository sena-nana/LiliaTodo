import { describe, expect, it } from "vitest";
import type { Op } from "../src/sync/types/op";
import { compactWebdavSnapshot, createWebdavSyncProvider } from "../src/sync/webdav/provider";
import { createWebdavLayout } from "../src/sync/webdav/paths";
import { writeSnapshot } from "../src/sync/webdav/snapshot";
import {
  WebdavConflictError,
  type WebdavClient,
  type WebdavGetResult,
  type WebdavPutOptions,
  type WebdavPutResult,
  type WebdavStat,
} from "../src/sync/webdav/types";
import { parseOpsJsonl } from "../src/sync/webdav/serialize";

interface FakeFile {
  body: string;
  etag: string;
}

class InMemoryWebdavClient implements WebdavClient {
  private readonly files = new Map<string, FakeFile>();
  private readonly collections = new Set<string>();
  private etagSeq = 0;

  async ensureCollection(path: string): Promise<void> {
    const normalized = trimTrailingSlash(path);
    this.collections.add(normalized);
    // 父级目录也算存在
    const parts = normalized.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      this.collections.add(acc);
    }
  }

  async list(path: string): Promise<WebdavStat[]> {
    const normalized = trimTrailingSlash(path);
    if (!this.collections.has(normalized)) {
      return [];
    }
    const prefix = `${normalized}/`;
    const stats: WebdavStat[] = [];
    const seenChildDirs = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const rest = filePath.slice(prefix.length);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        const file = this.files.get(filePath)!;
        stats.push({
          path: filePath,
          etag: file.etag,
          lastModified: null,
          size: file.body.length,
          isDirectory: false,
        });
      } else {
        const childDir = rest.slice(0, slashIdx);
        const childPath = `${normalized}/${childDir}`;
        if (!seenChildDirs.has(childPath)) {
          seenChildDirs.add(childPath);
          stats.push({
            path: childPath,
            etag: null,
            lastModified: null,
            size: null,
            isDirectory: true,
          });
        }
      }
    }
    for (const col of this.collections) {
      if (
        col.startsWith(prefix) &&
        col !== normalized &&
        col.slice(prefix.length).indexOf("/") === -1 &&
        !seenChildDirs.has(col)
      ) {
        stats.push({
          path: col,
          etag: null,
          lastModified: null,
          size: null,
          isDirectory: true,
        });
        seenChildDirs.add(col);
      }
    }
    return stats;
  }

  async get(path: string): Promise<WebdavGetResult | null> {
    const file = this.files.get(path);
    if (!file) {
      return null;
    }
    return { body: file.body, etag: file.etag, lastModified: null };
  }

  async put(
    path: string,
    body: string,
    options?: WebdavPutOptions,
  ): Promise<WebdavPutResult> {
    const existing = this.files.get(path);
    if (options?.ifNoneMatch === "*" && existing) {
      throw new WebdavConflictError(path, "目标已存在");
    }
    if (options?.ifMatch && existing && existing.etag !== options.ifMatch) {
      throw new WebdavConflictError(path, "ETag 不一致");
    }
    this.etagSeq += 1;
    const etag = `etag-${this.etagSeq}`;
    this.files.set(path, { body, etag });
    // 父目录视为已存在
    const parentIdx = path.lastIndexOf("/");
    if (parentIdx > 0) {
      await this.ensureCollection(path.slice(0, parentIdx));
    }
    return { etag };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async stat(path: string): Promise<WebdavStat | null> {
    const file = this.files.get(path);
    if (!file) {
      return null;
    }
    return {
      path,
      etag: file.etag,
      lastModified: null,
      size: file.body.length,
      isDirectory: false,
    };
  }
}

function trimTrailingSlash(path: string): string {
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

function makeOp(overrides: Partial<Op> = {}): Op {
  return {
    op: "put",
    target: { entityType: "task", entityId: "t1" },
    params: { title: "hi" },
    ts: "2026-05-19T10:00:00.000Z",
    actor: "user:wjx",
    originDevice: "deviceA",
    ...overrides,
  };
}

describe("BE-12 WebdavSyncProvider 端到端骨架", () => {
  it("push 把本设备 ops 写入 today 的 jsonl chunk", async () => {
    const client = new InMemoryWebdavClient();
    const fixedClock = () => new Date(Date.UTC(2026, 4, 19, 12, 30));
    const provider = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      clock: fixedClock,
    });

    const ops = [
      makeOp({ params: { title: "第一条" } }),
      makeOp({ ts: "2026-05-19T10:01:00.000Z", params: { tags: ["x"] } }),
    ];
    const result = await provider.push(ops);
    expect(result.acceptedCount).toBe(2);
    expect(result.chunkPath).toBe(
      "/liliatodo/oplog/deviceA/20260519/000000.jsonl",
    );
    const persisted = await client.get(result.chunkPath!);
    expect(persisted).not.toBeNull();
    expect(parseOpsJsonl(persisted!.body)).toEqual(ops);
  });

  it("push 过滤掉非本设备 ops", async () => {
    const client = new InMemoryWebdavClient();
    const provider = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      clock: () => new Date(Date.UTC(2026, 4, 19)),
    });
    const result = await provider.push([
      makeOp({ originDevice: "deviceB" }),
    ]);
    expect(result.acceptedCount).toBe(0);
    expect(result.chunkPath).toBeNull();
  });

  it("push 连续两次 seq 递增不覆盖", async () => {
    const client = new InMemoryWebdavClient();
    const provider = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      clock: () => new Date(Date.UTC(2026, 4, 19)),
    });
    const first = await provider.push([makeOp()]);
    const second = await provider.push([
      makeOp({ ts: "2026-05-19T11:00:00.000Z" }),
    ]);
    expect(first.chunkPath).toBe("/liliatodo/oplog/deviceA/20260519/000000.jsonl");
    expect(second.chunkPath).toBe("/liliatodo/oplog/deviceA/20260519/000001.jsonl");
  });

  it("pull 从空 cursor 拉取全部 ops 并返回新 cursor", async () => {
    const client = new InMemoryWebdavClient();
    const providerA = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      clock: () => new Date(Date.UTC(2026, 4, 19)),
    });
    const providerB = createWebdavSyncProvider({
      client,
      deviceId: "deviceB",
      clock: () => new Date(Date.UTC(2026, 4, 19)),
    });
    await providerA.push([makeOp({ params: { title: "A1" } })]);
    await providerB.push([
      makeOp({
        originDevice: "deviceB",
        ts: "2026-05-19T10:30:00.000Z",
        params: { title: "B1" },
      }),
    ]);

    const reader = createWebdavSyncProvider({
      client,
      deviceId: "reader",
      clock: () => new Date(Date.UTC(2026, 4, 19)),
    });
    const pulled = await reader.pull(null);
    expect(pulled.ops).toHaveLength(2);
    const titles = pulled.ops.map((op) =>
      (op.params as { title: string }).title
    );
    expect(titles).toEqual(expect.arrayContaining(["A1", "B1"]));

    const again = await reader.pull(pulled.cursor);
    expect(again.ops).toEqual([]);
  });

  it("pull 仅返回 cursor 之后的新 chunk", async () => {
    const client = new InMemoryWebdavClient();
    const providerA = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      clock: () => new Date(Date.UTC(2026, 4, 19)),
    });
    await providerA.push([makeOp({ params: { title: "old" } })]);

    const reader = createWebdavSyncProvider({
      client,
      deviceId: "reader",
      clock: () => new Date(),
    });
    const initial = await reader.pull(null);
    expect(initial.ops).toHaveLength(1);

    await providerA.push([
      makeOp({ ts: "2026-05-19T12:00:00.000Z", params: { title: "new" } }),
    ]);
    const incremental = await reader.pull(initial.cursor);
    expect(incremental.ops).toHaveLength(1);
    expect((incremental.ops[0].params as { title: string }).title).toBe("new");
  });

  it("pushEntity / getEntity 往返一致", async () => {
    const client = new InMemoryWebdavClient();
    const provider = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      clock: () => new Date(),
    });
    await provider.pushEntity({
      id: "t1",
      type: "task",
      schemaVersion: 1,
      payload: { title: "实体测试" },
      updatedAt: "2026-05-19T10:00:00.000Z",
      originDevice: "deviceA",
    });
    const got = await provider.getEntity<{ title: string }>("task", "t1");
    expect(got?.payload.title).toBe("实体测试");
    const miss = await provider.getEntity("task", "t-missing");
    expect(miss).toBeNull();
  });

  it("snapshot 扫读 entities 目录", async () => {
    const client = new InMemoryWebdavClient();
    const provider = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      clock: () => new Date(),
    });
    await provider.pushEntity({
      id: "t1",
      type: "task",
      schemaVersion: 1,
      payload: { title: "A" },
      updatedAt: "2026-05-19T10:00:00.000Z",
      originDevice: "deviceA",
    });
    await provider.pushEntity({
      id: "n1",
      type: "notification",
      schemaVersion: 1,
      payload: { kind: "info" },
      updatedAt: "2026-05-19T10:01:00.000Z",
      originDevice: "deviceA",
    });
    const snap = await provider.snapshot();
    expect(snap.entities).toHaveLength(2);
    expect(snap.entities.map((e) => e.type).sort()).toEqual([
      "notification",
      "task",
    ]);
  });

  it("snapshot 优先读取最新 snapshot 文件", async () => {
    const client = new InMemoryWebdavClient();
    const layout = createWebdavLayout();
    const provider = createWebdavSyncProvider({
      client,
      deviceId: "deviceA",
      layout,
      clock: () => new Date(),
    });
    await provider.pushEntity({
      id: "old-task",
      type: "task",
      schemaVersion: 1,
      payload: { title: "旧实体" },
      updatedAt: "2026-05-19T10:00:00.000Z",
      originDevice: "deviceA",
    });
    await writeSnapshot({
      client,
      layout,
      timestamp: "202605201200",
      cursor: "cursor-from-snapshot",
      entries: [
        {
          id: "snap-task",
          type: "task",
          schemaVersion: 1,
          payload: { title: "快照实体" },
          updatedAt: "2026-05-20T12:00:00.000Z",
          originDevice: "deviceB",
        },
      ],
    });

    const snap = await provider.snapshot();

    expect(snap.entities).toEqual([
      {
        id: "snap-task",
        type: "task",
        schemaVersion: 1,
        payload: { title: "快照实体" },
        updatedAt: "2026-05-20T12:00:00.000Z",
        originDevice: "deviceB",
      },
    ]);
    expect(snap.cursor).toBe("cursor-from-snapshot");
  });

  it("显式 compact 从 snapshot cursor 之后拉取 oplog 并写入新水位", async () => {
    const client = new InMemoryWebdavClient();
    const layout = createWebdavLayout();
    const writer = createWebdavSyncProvider({
      client,
      deviceId: "deviceB",
      layout,
      clock: () => new Date(Date.UTC(2026, 4, 19, 10, 0)),
    });
    const reader = createWebdavSyncProvider({
      client,
      deviceId: "reader",
      layout,
    });
    await writer.push([
      makeOp({
        originDevice: "deviceB",
        params: { title: "旧日志" },
      }),
    ]);
    const initialPull = await reader.pull(null);
    await writeSnapshot({
      client,
      layout,
      timestamp: "202605191100",
      cursor: initialPull.cursor,
      entries: [
        {
          id: "t1",
          type: "task",
          schemaVersion: 1,
          payload: { title: "快照内旧标题" },
          updatedAt: "2026-05-19T10:00:00.000Z",
          originDevice: "deviceB",
        },
      ],
    });
    await writer.push([
      makeOp({
        originDevice: "deviceB",
        ts: "2026-05-19T12:00:00.000Z",
        op: "patch",
        params: { title: "增量新标题" },
      }),
    ]);

    const compacted = await compactWebdavSnapshot({
      client,
      layout,
      deviceId: "compactor",
      clock: () => new Date(Date.UTC(2026, 4, 19, 12, 30)),
    });

    expect(compacted.meta.path).toBe("/liliatodo/snapshots/202605191230.jsonl");
    expect(compacted.pulledOpsCount).toBe(1);
    expect(compacted.entries[0].payload).toEqual({ title: "增量新标题" });
    const latest = await reader.snapshot();
    expect(latest.cursor).toBe(compacted.cursor);
    expect(latest.entities[0].payload).toEqual({ title: "增量新标题" });
  });

  it("非法 deviceId 创建即抛错", () => {
    expect(() =>
      createWebdavSyncProvider({
        client: new InMemoryWebdavClient(),
        deviceId: "device/bad",
      })
    ).toThrow(/device id/);
  });
});
