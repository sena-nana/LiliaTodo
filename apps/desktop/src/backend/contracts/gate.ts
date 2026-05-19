// AB-01：人机确认门契约。
// 一期接口冻结，实现推迟；阶段 3/4 之前 UI 可暂用本地 GatePending 占位，等接服务端后再切到 backend.gates。

export type Verdict = "approve" | "reject" | "defer";

export interface Gate<TPayload = unknown> {
  id: string;
  kind: string;
  payload: TPayload;
  createdAt: string;
  expiresAt: string | null;
}

export interface VerdictRecord {
  gateId: string;
  verdict: Verdict;
  decidedBy: string;
  decidedAt: string;
  note: string | null;
}
