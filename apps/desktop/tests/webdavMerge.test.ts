import { describe, expect, it } from "vitest";
import type { Op } from "../src/sync/types/op";
import {
  applyOpToEntity,
  compareOpsForReplay,
  dedupeOps,
  groupOpsByEntity,
  mergeOpsAcrossEntities,
  mergeOpsForEntity,
  sortOpsForReplay,
  type EntityWithUnknownPayload,
} from "../src/sync/webdav/merge";
import type {
  FieldMergePolicy,
  SemanticConflict,
  SemanticConflictDetector,
} from "../src/sync/webdav/conflict";

function makeOp(partial: Partial<Op> & Pick<Op, "ts" | "originDevice">): Op {
  return {
    op: "put",
    target: { entityType: "task", entityId: "t1" },
    params: { title: "x" },
    actor: "user",
    ...partial,
  } as Op;
}

describe("compareOpsForReplay", () => {
  it("以 ts 为主键升序排序", () => {
    const earlier = makeOp({ ts: "2026-01-01T00:00:00.000Z", originDevice: "d-b" });
    const later = makeOp({ ts: "2026-01-02T00:00:00.000Z", originDevice: "d-a" });
    expect(compareOpsForReplay(earlier, later)).toBeLessThan(0);
    expect(compareOpsForReplay(later, earlier)).toBeGreaterThan(0);
  });

  it("ts 相同时按 originDevice 决断", () => {
    const a = makeOp({ ts: "2026-01-01T00:00:00.000Z", originDevice: "d-a" });
    const b = makeOp({ ts: "2026-01-01T00:00:00.000Z", originDevice: "d-b" });
    expect(compareOpsForReplay(a, b)).toBeLessThan(0);
  });

  it("ts+device 相同时按 entityType / entityId / op 兜底", () => {
    const a = makeOp({
      ts: "2026-01-01T00:00:00.000Z",
      originDevice: "d",
      target: { entityType: "task", entityId: "a" },
    });
    const b = makeOp({
      ts: "2026-01-01T00:00:00.000Z",
      originDevice: "d",
      target: { entityType: "task", entityId: "b" },
    });
    expect(compareOpsForReplay(a, b)).toBeLessThan(0);
  });
});

describe("sortOpsForReplay", () => {
  it("稳定排序且不修改入参", () => {
    const ops: Op[] = [
      makeOp({ ts: "2026-01-03T00:00:00.000Z", originDevice: "d2" }),
      makeOp({ ts: "2026-01-01T00:00:00.000Z", originDevice: "d1" }),
      makeOp({ ts: "2026-01-02T00:00:00.000Z", originDevice: "d3" }),
    ];
    const snapshot = [...ops];
    const sorted = sortOpsForReplay(ops);
    expect(sorted.map((op) => op.ts)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ]);
    expect(ops).toEqual(snapshot);
  });
});

describe("dedupeOps", () => {
  it("按 (device,ts,target,op) 去重", () => {
    const op = makeOp({ ts: "2026-01-01T00:00:00.000Z", originDevice: "d1" });
    const result = dedupeOps([op, op, { ...op, params: { title: "y" } }]);
    expect(result).toHaveLength(1);
  });

  it("不同 device 视为不同记录", () => {
    const a = makeOp({ ts: "2026-01-01T00:00:00.000Z", originDevice: "d1" });
    const b = makeOp({ ts: "2026-01-01T00:00:00.000Z", originDevice: "d2" });
    expect(dedupeOps([a, b])).toHaveLength(2);
  });
});

describe("groupOpsByEntity", () => {
  it("按 entityType:entityId 拆桶", () => {
    const ops = [
      makeOp({
        ts: "2026-01-01T00:00:00.000Z",
        originDevice: "d1",
        target: { entityType: "task", entityId: "a" },
      }),
      makeOp({
        ts: "2026-01-01T00:00:00.000Z",
        originDevice: "d1",
        target: { entityType: "task", entityId: "b" },
      }),
      makeOp({
        ts: "2026-01-01T00:00:00.000Z",
        originDevice: "d1",
        target: { entityType: "project", entityId: "a" },
      }),
    ];
    const grouped = groupOpsByEntity(ops);
    expect(grouped.size).toBe(3);
    expect(grouped.get("task:a")).toHaveLength(1);
    expect(grouped.get("project:a")).toHaveLength(1);
  });
});

describe("applyOpToEntity", () => {
  it("put 整体替换 payload", () => {
    const current: EntityWithUnknownPayload = {
      id: "t1",
      type: "task",
      schemaVersion: 2,
      payload: { title: "old", note: "keep?" },
      updatedAt: "2025-12-31T00:00:00.000Z",
      originDevice: "old",
    };
    const op = makeOp({
      ts: "2026-01-01T00:00:00.000Z",
      originDevice: "d1",
      op: "put",
      params: { title: "new" },
    });
    const next = applyOpToEntity(current, op);
    expect(next).not.toBeNull();
    expect(next!.payload).toEqual({ title: "new" });
    expect(next!.schemaVersion).toBe(2);
    expect(next!.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(next!.originDevice).toBe("d1");
  });

  it("patch 仅合并指定字段", () => {
    const current: EntityWithUnknownPayload = {
      id: "t1",
      type: "task",
      schemaVersion: 1,
      payload: { title: "old", done: false },
      updatedAt: "2025-12-31T00:00:00.000Z",
      originDevice: "old",
    };
    const op = makeOp({
      ts: "2026-01-01T00:00:00.000Z",
      originDevice: "d1",
      op: "patch",
      params: { done: true },
    });
    const next = applyOpToEntity(current, op);
    expect(next!.payload).toEqual({ title: "old", done: true });
  });

  it("delete 返回 null", () => {
    const op = makeOp({
      ts: "2026-01-01T00:00:00.000Z",
      originDevice: "d1",
      op: "delete",
      params: null,
    });
    expect(applyOpToEntity(null, op)).toBeNull();
  });

  it("FieldMergePolicy 可注入合并字段", () => {
    const recording: string[] = [];
    const policy: FieldMergePolicy = {
      mergeField({ field, current, incoming }) {
        recording.push(field);
        if (field === "tags" && Array.isArray(current) && Array.isArray(incoming)) {
          return Array.from(new Set([...current, ...incoming]));
        }
        return incoming;
      },
    };
    const current: EntityWithUnknownPayload = {
      id: "t1",
      type: "task",
      schemaVersion: 1,
      payload: { tags: ["a"], title: "x" },
      updatedAt: "2025-12-31T00:00:00.000Z",
      originDevice: "old",
    };
    const op = makeOp({
      ts: "2026-01-01T00:00:00.000Z",
      originDevice: "d1",
      op: "patch",
      params: { tags: ["b"] },
    });
    const next = applyOpToEntity(current, op, { fieldPolicy: policy });
    expect(next!.payload).toEqual({ tags: ["a", "b"], title: "x" });
    expect(recording).toEqual(["tags"]);
  });

  it("put 非对象 params 抛错", () => {
    const op = makeOp({
      ts: "2026-01-01T00:00:00.000Z",
      originDevice: "d1",
      op: "put",
      params: "bad" as unknown as Record<string, unknown>,
    });
    expect(() => applyOpToEntity(null, op)).toThrow(/put op 的 params/);
  });
});

describe("mergeOpsForEntity", () => {
  it("LWW 折算后保留最后一条 put", () => {
    const ops: Op[] = [
      makeOp({
        ts: "2026-01-01T00:00:00.000Z",
        originDevice: "d1",
        op: "put",
        params: { title: "first" },
      }),
      makeOp({
        ts: "2026-01-02T00:00:00.000Z",
        originDevice: "d2",
        op: "patch",
        params: { done: true },
      }),
    ];
    const result = mergeOpsForEntity(null, ops);
    expect(result.entity!.payload).toEqual({ title: "first", done: true });
    expect(result.appliedOps).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  it("detector 抓到的冲突被收集", () => {
    const detector: SemanticConflictDetector = {
      inspect({ priorOps, appliedOp, entityType, entityId, now }):
        | SemanticConflict
        | null {
        if (priorOps.length === 0) return null;
        return {
          entityType,
          entityId,
          kind: "double-write",
          description: "两次写入并存",
          competingOps: [...priorOps, appliedOp],
          resolvedToOp: appliedOp,
          detectedAt: now,
        };
      },
    };
    const ops: Op[] = [
      makeOp({
        ts: "2026-01-01T00:00:00.000Z",
        originDevice: "d1",
        op: "put",
        params: { title: "a" },
      }),
      makeOp({
        ts: "2026-01-02T00:00:00.000Z",
        originDevice: "d2",
        op: "put",
        params: { title: "b" },
      }),
    ];
    const fixedNow = new Date("2026-05-19T00:00:00.000Z");
    const result = mergeOpsForEntity(null, ops, {
      detector,
      now: () => fixedNow,
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].kind).toBe("double-write");
    expect(result.conflicts[0].detectedAt).toBe(fixedNow.toISOString());
    expect(result.entity!.payload).toEqual({ title: "b" });
  });
});

describe("mergeOpsAcrossEntities", () => {
  it("按实体分组分别折算", async () => {
    const ops: Op[] = [
      makeOp({
        ts: "2026-01-01T00:00:00.000Z",
        originDevice: "d1",
        op: "put",
        target: { entityType: "task", entityId: "a" },
        params: { title: "A" },
      }),
      makeOp({
        ts: "2026-01-01T00:00:00.000Z",
        originDevice: "d1",
        op: "put",
        target: { entityType: "task", entityId: "b" },
        params: { title: "B" },
      }),
    ];
    const result = await mergeOpsAcrossEntities(ops, {
      loadEntity: async () => null,
    });
    expect(result.entries).toHaveLength(2);
    const titles = result.entries.map(
      (entry) => (entry.result.entity?.payload as Record<string, unknown>).title,
    );
    expect(titles.sort()).toEqual(["A", "B"]);
  });
});
