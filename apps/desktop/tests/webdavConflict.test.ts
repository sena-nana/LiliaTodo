import { describe, expect, it } from "vitest";
import type { Op } from "../src/backend/contracts/op";
import {
  lastWriteWinsFieldMergePolicy,
  noopSemanticConflictDetector,
} from "../src/sync/webdav/conflict";

function makeOp(): Op {
  return {
    op: "patch",
    target: { entityType: "task", entityId: "t" },
    params: { foo: "bar" },
    ts: "2026-01-01T00:00:00.000Z",
    actor: "user",
    originDevice: "d1",
  };
}

describe("noopSemanticConflictDetector", () => {
  it("永远返回 null", () => {
    const op = makeOp();
    const result = noopSemanticConflictDetector.inspect({
      entityType: "task",
      entityId: "t",
      priorOps: [op],
      appliedOp: op,
      priorPayload: null,
      nextPayload: { foo: "bar" },
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(result).toBeNull();
  });
});

describe("lastWriteWinsFieldMergePolicy", () => {
  it("总是返回 incoming", () => {
    const op = makeOp();
    expect(
      lastWriteWinsFieldMergePolicy.mergeField({
        entityType: "task",
        field: "foo",
        current: "old",
        incoming: "new",
        op,
      }),
    ).toBe("new");
  });

  it("incoming 为 null 时也返回 null（不退回 current）", () => {
    const op = makeOp();
    expect(
      lastWriteWinsFieldMergePolicy.mergeField({
        entityType: "task",
        field: "foo",
        current: "old",
        incoming: null,
        op,
      }),
    ).toBeNull();
  });
});
