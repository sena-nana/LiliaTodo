// AB-01：backend.sandbox 命名空间——服务端长任务/沙箱执行入口。一期 noop。

import { BackendDisabledError } from "../errors";
import type { JobResult, JobSpec, LogFrame } from "../contracts";
import type { EventFrame, Unsubscribe } from "../transport/types";

export interface BackendSandbox {
  submit(spec: JobSpec): Promise<{ jobId: string }>;
  status(jobId: string): Promise<JobResult>;
  cancel(jobId: string): Promise<void>;
  tailLog(jobId: string, handler: (frame: EventFrame<LogFrame>) => void): Unsubscribe;
}

export const noopBackendSandbox: BackendSandbox = {
  async submit() {
    throw new BackendDisabledError("sandbox.submit");
  },
  async status() {
    throw new BackendDisabledError("sandbox.status");
  },
  async cancel() {
    throw new BackendDisabledError("sandbox.cancel");
  },
  tailLog() {
    throw new BackendDisabledError("sandbox.tailLog");
  },
};
