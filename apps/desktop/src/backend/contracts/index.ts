// AB-01：backend 协议层统一出口。
// Entity / Op / OpKind / OpTarget 已迁到 sync/types，本文件仅做转发以保持
// backend/index.ts 的 re-export 链不断；backend 抽象层将在后续阶段整组下线。

export type { Entity, Op, OpKind, OpTarget } from "../../sync/types";
export type { Intent, Outcome, OutcomeStatus } from "./intent";
export type { Gate, Verdict, VerdictRecord } from "./gate";
export type { JobSpec, JobResult, JobStatus, LogFrame } from "./job";
