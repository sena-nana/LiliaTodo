// AB-01：服务端/同步层的实体快照格式。
// 与 WebDAV 同步层（阶段 3）共用同一份格式规范，未来切到服务端 transport 时数据零迁移。
// 一旦冻结，破坏性改动必须升 major 并改 capability version。

export interface Entity<TPayload = unknown> {
  id: string;
  type: string;
  schemaVersion: number;
  payload: TPayload;
  updatedAt: string;
  originDevice: string;
}
