// BE-12 sprint-3：语义冲突类型与检测口子。
//
// LWW 仲裁完成后，业务可能仍然觉得"两条 op 都被 LWW 接受了，但语义上不该共存"
// （例如同一任务被设置为不同截止时间）。这类冲突不上服务端 backend.gates
// （一期 noop），而是收集到本地待裁决列表，由 UI 提示用户处理。
//
// 本模块只提供数据结构与默认 noop 实现；具体规则（哪些字段算语义冲突）
// 由业务侧实现 Detector 注入。

import type { Op } from "../types/op";

export interface SemanticConflict {
  readonly entityType: string;
  readonly entityId: string;
  /** 业务自定义分类标签，便于 UI 路由不同处理界面。 */
  readonly kind: string;
  readonly description: string;
  readonly competingOps: readonly Op[];
  /** LWW 最终采用的 op；语义冲突不阻塞 LWW，仅记录。 */
  readonly resolvedToOp: Op;
  readonly detectedAt: string;
}

/**
 * 业务可注入的冲突检测器。每应用一条 op 后被调用一次，
 * 拿到"当前 entity 字段状态"与"刚应用的 op"，判断是否构成语义冲突。
 */
export interface SemanticConflictDetector {
  inspect(input: SemanticConflictInspectInput): SemanticConflict | null;
}

export interface SemanticConflictInspectInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly priorOps: readonly Op[];
  readonly appliedOp: Op;
  readonly priorPayload: unknown;
  readonly nextPayload: unknown;
  readonly now: string;
}

export const noopSemanticConflictDetector: SemanticConflictDetector = {
  inspect: () => null,
};

/**
 * 字段级合并策略：用于把不同设备对同字段的并发改动合并而非简单 LWW 覆盖。
 * 一期不提供 CRDT 实现，业务侧若有富文本/列表字段可自行注入。
 * 默认策略 = LWW（直接用 incoming）。
 */
export interface FieldMergePolicy {
  mergeField(input: FieldMergeInput): unknown;
}

export interface FieldMergeInput {
  readonly entityType: string;
  readonly field: string;
  readonly current: unknown;
  readonly incoming: unknown;
  readonly op: Op;
}

export const lastWriteWinsFieldMergePolicy: FieldMergePolicy = {
  mergeField: ({ incoming }) => incoming,
};
