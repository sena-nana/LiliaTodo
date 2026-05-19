// AB-01：backend.gates 命名空间——服务端发起的人机确认门。
// 一期 noop；阶段 3/4 之前 UI 可暂用本地 GatePending 占位。

import { BackendDisabledError } from "../errors";
import type { Gate, Verdict, VerdictRecord } from "../contracts";
import type { EventFrame, Unsubscribe } from "../transport/types";

export interface BackendGates {
  list(): Promise<Gate[]>;
  verdict(id: string, verdict: Verdict, note?: string): Promise<VerdictRecord>;
  onPending(handler: (frame: EventFrame<Gate>) => void): Unsubscribe;
  onResolved(handler: (frame: EventFrame<VerdictRecord>) => void): Unsubscribe;
}

export const noopBackendGates: BackendGates = {
  async list() {
    throw new BackendDisabledError("gates.list");
  },
  async verdict() {
    throw new BackendDisabledError("gates.verdict");
  },
  onPending() {
    throw new BackendDisabledError("gates.onPending");
  },
  onResolved() {
    throw new BackendDisabledError("gates.onResolved");
  },
};
