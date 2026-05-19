// BE-12：WebDAV 同步层数据序列化。
// Entity 文件用 pretty JSON；Op 一条一行的 JSONL，便于 append-only 与流式回放。
// 严格走 sync/types 的共享格式，避免与未来其它同步 provider 出现两份解析逻辑。

import type { Entity } from "../types/entity";
import type { Op, OpKind, OpTarget } from "../types/op";

const OP_KINDS = new Set<OpKind>(["put", "patch", "delete"]);

export function serializeEntity<T>(entity: Entity<T>): string {
  return JSON.stringify(entity, null, 2);
}

export function parseEntity<T>(text: string): Entity<T> {
  const parsed = parseJson(text);
  return assertEntityShape<T>(parsed);
}

export function serializeOps(ops: Op[]): string {
  if (ops.length === 0) {
    return "";
  }
  return ops.map((op) => JSON.stringify(op)).join("\n") + "\n";
}

export function parseOpsJsonl(text: string): Op[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const ops: Op[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (raw.length === 0) {
      continue;
    }
    const lineNo = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `WebDAV 同步：oplog 第 ${lineNo} 行 JSON 解析失败 - ${(error as Error).message}`,
      );
    }
    ops.push(assertOpShape(parsed, lineNo));
  }
  return ops;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `WebDAV 同步：JSON 解析失败 - ${(error as Error).message}`,
    );
  }
}

function assertEntityShape<T>(value: unknown): Entity<T> {
  if (!isPlainObject(value)) {
    throw new Error("WebDAV 同步：Entity 必须为对象");
  }
  const {
    id,
    type,
    schemaVersion,
    payload,
    updatedAt,
    originDevice,
  } = value as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("WebDAV 同步：Entity.id 缺失");
  }
  if (typeof type !== "string" || type.length === 0) {
    throw new Error("WebDAV 同步：Entity.type 缺失");
  }
  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
    throw new Error("WebDAV 同步：Entity.schemaVersion 非数字");
  }
  if (typeof updatedAt !== "string" || updatedAt.length === 0) {
    throw new Error("WebDAV 同步：Entity.updatedAt 缺失");
  }
  if (typeof originDevice !== "string" || originDevice.length === 0) {
    throw new Error("WebDAV 同步：Entity.originDevice 缺失");
  }
  return {
    id,
    type,
    schemaVersion,
    payload: payload as T,
    updatedAt,
    originDevice,
  };
}

function assertOpShape(value: unknown, line: number): Op {
  if (!isPlainObject(value)) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行不是对象`);
  }
  const record = value as Record<string, unknown>;
  const op = record.op;
  if (typeof op !== "string" || !OP_KINDS.has(op as OpKind)) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行 op 非法`);
  }
  const target = record.target;
  if (!isPlainObject(target)) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行 target 缺失`);
  }
  const entityType = (target as Record<string, unknown>).entityType;
  const entityId = (target as Record<string, unknown>).entityId;
  if (typeof entityType !== "string" || entityType.length === 0) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行 target.entityType 缺失`);
  }
  if (typeof entityId !== "string" || entityId.length === 0) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行 target.entityId 缺失`);
  }
  const ts = record.ts;
  if (typeof ts !== "string" || ts.length === 0) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行 ts 缺失`);
  }
  const actor = record.actor;
  if (typeof actor !== "string" || actor.length === 0) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行 actor 缺失`);
  }
  const originDevice = record.originDevice;
  if (typeof originDevice !== "string" || originDevice.length === 0) {
    throw new Error(`WebDAV 同步：oplog 第 ${line} 行 originDevice 缺失`);
  }
  const params = record.params;
  return {
    op: op as OpKind,
    target: {
      entityType,
      entityId,
    } satisfies OpTarget,
    params,
    ts,
    actor,
    originDevice,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
