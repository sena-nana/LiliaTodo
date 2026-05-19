import { describe, expect, it } from "vitest";
import { allocateChunkSeq, nextSeq } from "../src/sync/webdav/seq";

describe("BE-12 WebDAV oplog seq 分配", () => {
  it("空目录从 0 开始", () => {
    expect(nextSeq([])).toBe(0);
    expect(allocateChunkSeq({ existingFilenames: [] })).toBe(0);
  });

  it("跳过非 jsonl 文件名", () => {
    expect(nextSeq(["foo.txt", "000001.json", "000002.jsonl"])).toBe(3);
  });

  it("取已有最大值 + 1", () => {
    expect(nextSeq(["000005.jsonl", "000002.jsonl", "000010.jsonl"])).toBe(11);
  });

  it("容忍前缀 0 的解析差异", () => {
    expect(nextSeq(["0.jsonl", "10.jsonl"])).toBe(11);
  });

  it("preferredSeq 大于等于 next 时采用 preferred", () => {
    expect(allocateChunkSeq({
      existingFilenames: ["000001.jsonl"],
      preferredSeq: 5,
    })).toBe(5);
  });

  it("preferredSeq 小于 next 时退回 next 防止覆盖", () => {
    expect(allocateChunkSeq({
      existingFilenames: ["000005.jsonl"],
      preferredSeq: 3,
    })).toBe(6);
  });

  it("preferredSeq 非法抛错", () => {
    expect(() =>
      allocateChunkSeq({ existingFilenames: [], preferredSeq: -1 })
    ).toThrow(/preferredSeq/);
    expect(() =>
      allocateChunkSeq({ existingFilenames: [], preferredSeq: 1.5 })
    ).toThrow(/preferredSeq/);
  });
});
