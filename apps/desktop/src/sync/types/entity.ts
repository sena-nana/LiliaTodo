// WebDAV 同步层共享数据格式：实体快照。
// 该格式仅供 sync/webdav/* 内部模块与对应测试使用，是同步层与未来其它 provider
// （Nextcloud / OwnCloud / 自建 dav）复用的最小共享形状。
// 一旦冻结，破坏性改动必须升 major 并改 capability version。

export interface Entity<TPayload = unknown> {
  id: string;
  type: string;
  schemaVersion: number;
  payload: TPayload;
  updatedAt: string;
  originDevice: string;
}
