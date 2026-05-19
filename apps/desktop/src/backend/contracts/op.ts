// AB-01：操作日志的统一格式。
// 服务端任何产出（agent / sandbox 结果）必须折算为 Op[] 回流；Momo 走同一 ingest 通道吸收。
// WebDAV 同步层（阶段 3）也使用本格式，避免格式分叉。

export type OpKind = "put" | "patch" | "delete";

export interface OpTarget {
  entityType: string;
  entityId: string;
}

export interface Op<TParams = unknown> {
  op: OpKind;
  target: OpTarget;
  params: TParams;
  ts: string;
  actor: string;
  originDevice: string;
}
