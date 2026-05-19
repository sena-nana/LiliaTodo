// AB-01：沙箱/长任务契约。一期接口冻结，namespaces/sandbox 一期 noop。

export interface JobSpec<TPayload = unknown> {
  kind: string;
  payload: TPayload;
  timeoutMs: number | null;
}

export type JobStatus = "queued" | "running" | "ok" | "failed" | "cancelled";

export interface JobResult<TPayload = unknown> {
  jobId: string;
  status: JobStatus;
  payload: TPayload | null;
  error?: { code: string; message: string };
  startedAt: string | null;
  endedAt: string | null;
}

export interface LogFrame {
  jobId: string;
  ts: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
}
