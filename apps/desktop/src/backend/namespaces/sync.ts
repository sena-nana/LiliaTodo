// AB-01：backend.sync 命名空间——服务端的 entity / op 同步入口。
// 阶段 3 WebDAV 同步层实现 SyncProvider 接口（另文件），不在此处直接落地；本命名空间一期 noop。

import { BackendDisabledError } from "../errors";
import type { Entity, Op } from "../contracts";
import type { EventFrame, Unsubscribe } from "../transport/types";

export interface SyncSnapshot {
  cursor: string;
  entities: Entity[];
}

export interface BackendSync {
  getEntity<T = unknown>(type: string, id: string): Promise<Entity<T> | null>;
  putEntity<T = unknown>(entity: Entity<T>): Promise<void>;
  appendOps(ops: Op[]): Promise<void>;
  fetchOps(sinceCursor: string | null): Promise<{ cursor: string; ops: Op[] }>;
  snapshot(): Promise<SyncSnapshot>;
  onEntityChanged(handler: (frame: EventFrame<Entity>) => void): Unsubscribe;
  onOpsAppended(handler: (frame: EventFrame<Op[]>) => void): Unsubscribe;
}

export const noopBackendSync: BackendSync = {
  async getEntity() {
    throw new BackendDisabledError("sync.getEntity");
  },
  async putEntity() {
    throw new BackendDisabledError("sync.putEntity");
  },
  async appendOps() {
    throw new BackendDisabledError("sync.appendOps");
  },
  async fetchOps() {
    throw new BackendDisabledError("sync.fetchOps");
  },
  async snapshot() {
    throw new BackendDisabledError("sync.snapshot");
  },
  onEntityChanged() {
    throw new BackendDisabledError("sync.onEntityChanged");
  },
  onOpsAppended() {
    throw new BackendDisabledError("sync.onOpsAppended");
  },
};
