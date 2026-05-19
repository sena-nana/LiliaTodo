// BE-12：WebDAV 同步 oplog 文件名 seq 分配。
//
// 每个 device 在每个 yyyymmdd 目录下使用 6 位 0 填充的 seq 命名 jsonl 切片。
// 单日 seq 内不要求严格连续（容忍并发未提交的空洞），仅要求 push 时 seq > 已存在最大值。
// 该层只做编号计算；远端列目录与 ETag 校验交给 client。

import { parseSeq } from "./paths";

export function nextSeq(existingFilenames: Iterable<string>): number {
  let max = -1;
  for (const filename of existingFilenames) {
    const seq = parseSeq(filename);
    if (seq === null) {
      continue;
    }
    if (seq > max) {
      max = seq;
    }
  }
  return max + 1;
}

export interface AllocateChunkSeqInput {
  readonly existingFilenames: Iterable<string>;
  readonly preferredSeq?: number;
}

export function allocateChunkSeq({
  existingFilenames,
  preferredSeq,
}: AllocateChunkSeqInput): number {
  const next = nextSeq(existingFilenames);
  if (preferredSeq === undefined) {
    return next;
  }
  if (!Number.isInteger(preferredSeq) || preferredSeq < 0) {
    throw new Error(`preferredSeq 非法：${preferredSeq}`);
  }
  return preferredSeq >= next ? preferredSeq : next;
}
