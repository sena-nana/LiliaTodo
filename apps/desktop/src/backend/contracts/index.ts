// AB-01：backend 协议层统一出口。
// WebDAV 同步层（阶段 3）允许 import 此处的 Entity / Op；其它业务代码请走 namespaces/*。

export type { Entity } from "./entity";
export type { Op, OpKind, OpTarget } from "./op";
export type { Intent, Outcome, OutcomeStatus } from "./intent";
export type { Gate, Verdict, VerdictRecord } from "./gate";
export type { JobSpec, JobResult, JobStatus, LogFrame } from "./job";
