import { describe, expect, it } from "vitest";
import type { Entity } from "../src/sync/types/entity";
import type { Op } from "../src/sync/types/op";
import {
  parseEntity,
  parseOpsJsonl,
  serializeEntity,
  serializeOps,
} from "../src/sync/webdav/serialize";

describe("BE-12 WebDAV 序列化", () => {
  it("Entity 序列化 → 反序列化往返一致", () => {
    const entity: Entity<{ title: string; tags: string[] }> = {
      id: "t1",
      type: "task",
      schemaVersion: 1,
      payload: { title: "写测试", tags: ["dev", "be12"] },
      updatedAt: "2026-05-19T10:00:00.000Z",
      originDevice: "deviceA",
    };
    const text = serializeEntity(entity);
    expect(text).toContain("\n  \"id\": \"t1\"");
    const parsed = parseEntity<{ title: string; tags: string[] }>(text);
    expect(parsed).toEqual(entity);
  });

  it("Entity 反序列化拒绝缺失字段", () => {
    expect(() => parseEntity('{"id":"t1"}')).toThrow(/Entity\.type/);
    expect(() => parseEntity('{"id":1, "type":"task"}')).toThrow(/Entity\.id/);
    expect(() => parseEntity("not json")).toThrow(/JSON/);
  });

  it("Op 序列化为 JSONL，一条一行末尾带换行", () => {
    const ops: Op[] = [
      {
        op: "put",
        target: { entityType: "task", entityId: "t1" },
        params: { title: "新任务" },
        ts: "2026-05-19T10:00:00.000Z",
        actor: "user:wjx",
        originDevice: "deviceA",
      },
      {
        op: "patch",
        target: { entityType: "task", entityId: "t1" },
        params: { tags: ["urgent"] },
        ts: "2026-05-19T10:01:00.000Z",
        actor: "user:wjx",
        originDevice: "deviceA",
      },
    ];
    const text = serializeOps(ops);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(ops[0]);
  });

  it("空 Op 数组序列化为空串", () => {
    expect(serializeOps([])).toBe("");
    expect(parseOpsJsonl("")).toEqual([]);
  });

  it("Op JSONL 解析跳过空行并定位错误行", () => {
    const text = [
      JSON.stringify({
        op: "put",
        target: { entityType: "task", entityId: "t1" },
        params: {},
        ts: "2026-05-19T10:00:00.000Z",
        actor: "user:wjx",
        originDevice: "deviceA",
      }),
      "",
      "not json",
    ].join("\n");
    expect(() => parseOpsJsonl(text)).toThrow(/第 3 行/);
  });

  it("Op 反序列化校验 op kind", () => {
    const bad = JSON.stringify({
      op: "merge",
      target: { entityType: "task", entityId: "t1" },
      params: {},
      ts: "2026-05-19T10:00:00.000Z",
      actor: "user:wjx",
      originDevice: "deviceA",
    });
    expect(() => parseOpsJsonl(bad)).toThrow(/op 非法/);
  });

  it("Op 反序列化校验 target 子字段", () => {
    const bad = JSON.stringify({
      op: "put",
      target: { entityType: "" },
      params: {},
      ts: "2026-05-19T10:00:00.000Z",
      actor: "user:wjx",
      originDevice: "deviceA",
    });
    expect(() => parseOpsJsonl(bad)).toThrow(/target\.entityType/);
  });
});
