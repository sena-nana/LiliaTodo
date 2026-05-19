// BE-12 sprint-3：Op 级 LWW 仲裁与回放。
//
// 多设备 pull 回来的 ops 会乱序，本模块把它们按 (ts, originDevice, target)
// 稳定排序、去重，再按字段策略折算到 entity 上。
//
// LWW 排序确保所有节点收敛到同一最终状态：
//   - 主键：ts（ISO-8601 字符串可直接字典序比较）
//   - 次键：originDevice（同毫秒抢入时保证确定顺序）
//   - 三键：target.entityType / target.entityId（不同实体的 op 互不影响）
//
// 同步语义：'put' 整体替换 payload；'patch' 字段级合并；'delete' 标记为 null。
// 富文本/列表字段如需 CRDT 合并，由 caller 通过 FieldMergePolicy 注入。

import type { Entity } from "../types/entity";
import type { Op } from "../types/op";
import {
  lastWriteWinsFieldMergePolicy,
  noopSemanticConflictDetector,
  type FieldMergePolicy,
  type SemanticConflict,
  type SemanticConflictDetector,
} from "./conflict";

export function sortOpsForReplay(ops: readonly Op[]): Op[] {
  return [...ops].sort(compareOpsForReplay);
}

export function compareOpsForReplay(a: Op, b: Op): number {
  if (a.ts !== b.ts) {
    return a.ts < b.ts ? -1 : 1;
  }
  if (a.originDevice !== b.originDevice) {
    return a.originDevice < b.originDevice ? -1 : 1;
  }
  if (a.target.entityType !== b.target.entityType) {
    return a.target.entityType < b.target.entityType ? -1 : 1;
  }
  if (a.target.entityId !== b.target.entityId) {
    return a.target.entityId < b.target.entityId ? -1 : 1;
  }
  if (a.op !== b.op) {
    return a.op < b.op ? -1 : 1;
  }
  return 0;
}

export function dedupeOps(ops: readonly Op[]): Op[] {
  const seen = new Set<string>();
  const out: Op[] = [];
  for (const op of ops) {
    const key = `${op.originDevice}|${op.ts}|${op.target.entityType}|${op.target.entityId}|${op.op}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(op);
  }
  return out;
}

export function groupOpsByEntity(ops: readonly Op[]): Map<string, Op[]> {
  const map = new Map<string, Op[]>();
  for (const op of ops) {
    const key = `${op.target.entityType}:${op.target.entityId}`;
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(op);
    } else {
      map.set(key, [op]);
    }
  }
  return map;
}

export interface ApplyOpToEntityOptions {
  readonly fieldPolicy?: FieldMergePolicy;
}

export type EntityWithUnknownPayload = Entity<Record<string, unknown>>;

/**
 * 把单条 op 应用到 entity；delete 返回 null。
 * put 要求 params 为完整 payload 对象；patch params 为部分 payload。
 */
export function applyOpToEntity(
  current: EntityWithUnknownPayload | null,
  op: Op,
  options: ApplyOpToEntityOptions = {},
): EntityWithUnknownPayload | null {
  const fieldPolicy = options.fieldPolicy ?? lastWriteWinsFieldMergePolicy;
  switch (op.op) {
    case "put": {
      assertObjectParams(op, "put");
      return {
        id: op.target.entityId,
        type: op.target.entityType,
        schemaVersion: current?.schemaVersion ?? 1,
        payload: { ...(op.params as Record<string, unknown>) },
        updatedAt: op.ts,
        originDevice: op.originDevice,
      };
    }
    case "patch": {
      assertObjectParams(op, "patch");
      const basePayload = current?.payload ?? {};
      const incoming = op.params as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...basePayload };
      for (const field of Object.keys(incoming)) {
        merged[field] = fieldPolicy.mergeField({
          entityType: op.target.entityType,
          field,
          current: basePayload[field],
          incoming: incoming[field],
          op,
        });
      }
      return {
        id: op.target.entityId,
        type: op.target.entityType,
        schemaVersion: current?.schemaVersion ?? 1,
        payload: merged,
        updatedAt: op.ts,
        originDevice: op.originDevice,
      };
    }
    case "delete":
      return null;
  }
}

export interface MergeOpsForEntityOptions {
  readonly fieldPolicy?: FieldMergePolicy;
  readonly detector?: SemanticConflictDetector;
  readonly now?: () => Date;
}

export interface MergeOpsForEntityResult {
  readonly entity: EntityWithUnknownPayload | null;
  readonly conflicts: readonly SemanticConflict[];
  readonly appliedOps: readonly Op[];
}

/**
 * 把若干 ops 按 LWW 折算到一个 entity；
 * detector 每应用一条 op 后被调用一次，收集到的语义冲突原样返回。
 */
export function mergeOpsForEntity(
  current: EntityWithUnknownPayload | null,
  ops: readonly Op[],
  options: MergeOpsForEntityOptions = {},
): MergeOpsForEntityResult {
  const detector = options.detector ?? noopSemanticConflictDetector;
  const clock = options.now ?? (() => new Date());
  const sortedDeduped = dedupeOps(sortOpsForReplay(ops));
  const conflicts: SemanticConflict[] = [];
  const applied: Op[] = [];
  let entity = current;
  for (const op of sortedDeduped) {
    const priorPayload = entity?.payload ?? null;
    const next = applyOpToEntity(entity, op, {
      fieldPolicy: options.fieldPolicy,
    });
    const detected = detector.inspect({
      entityType: op.target.entityType,
      entityId: op.target.entityId,
      priorOps: applied,
      appliedOp: op,
      priorPayload,
      nextPayload: next?.payload ?? null,
      now: clock().toISOString(),
    });
    if (detected) {
      conflicts.push(detected);
    }
    applied.push(op);
    entity = next;
  }
  return { entity, conflicts, appliedOps: applied };
}

/**
 * 批量回放：把任意 ops 按 entity 分组后逐组合并。
 * `loadEntity` 由 caller 提供从本地存储拿当前快照的能力；找不到返回 null。
 */
export interface MergeOpsAcrossEntitiesOptions extends MergeOpsForEntityOptions {
  loadEntity(
    entityType: string,
    entityId: string,
  ): Promise<EntityWithUnknownPayload | null>;
}

export interface MergeOpsAcrossEntitiesResult {
  readonly entries: readonly MergeOpsAcrossEntitiesEntry[];
  readonly conflicts: readonly SemanticConflict[];
}

export interface MergeOpsAcrossEntitiesEntry {
  readonly entityType: string;
  readonly entityId: string;
  readonly result: MergeOpsForEntityResult;
}

export async function mergeOpsAcrossEntities(
  ops: readonly Op[],
  options: MergeOpsAcrossEntitiesOptions,
): Promise<MergeOpsAcrossEntitiesResult> {
  const grouped = groupOpsByEntity(ops);
  const entries: MergeOpsAcrossEntitiesEntry[] = [];
  const allConflicts: SemanticConflict[] = [];
  for (const [, bucket] of grouped) {
    const first = bucket[0];
    const current = await options.loadEntity(
      first.target.entityType,
      first.target.entityId,
    );
    const result = mergeOpsForEntity(current, bucket, options);
    entries.push({
      entityType: first.target.entityType,
      entityId: first.target.entityId,
      result,
    });
    allConflicts.push(...result.conflicts);
  }
  return { entries, conflicts: allConflicts };
}

function assertObjectParams(op: Op, kind: "put" | "patch"): void {
  if (
    op.params === null ||
    typeof op.params !== "object" ||
    Array.isArray(op.params)
  ) {
    throw new Error(`WebDAV 同步：${kind} op 的 params 必须为对象`);
  }
}
