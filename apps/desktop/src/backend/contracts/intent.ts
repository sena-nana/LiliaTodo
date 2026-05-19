// AB-01：业务侧向服务端表达「想做某事」的请求。
// 一期接口冻结，实现推迟到对接服务端后由 namespaces/tasks calendar 等填充。

import type { Op } from "../../sync/types/op";

export interface Intent<TPayload = unknown> {
  id: string;
  kind: string;
  payload: TPayload;
  createdAt: string;
}

export type OutcomeStatus = "ok" | "failed" | "needs_gate";

export interface Outcome<TPayload = unknown> {
  intentId: string;
  status: OutcomeStatus;
  ops: Op[];
  payload?: TPayload;
  error?: { code: string; message: string };
}
