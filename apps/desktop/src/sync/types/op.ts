// WebDAV 同步层共享数据格式：操作日志。
// 与 entity.ts 一道作为 sync/webdav/* 内部模块的最小共享形状，
// 未来加 calendar / agent-task 等新实体或换 provider 时可继续复用。

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
