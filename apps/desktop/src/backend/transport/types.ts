// AB-01：服务端传输层抽象。
// 任何真实 transport（HTTP、WebSocket、JSON-RPC over pipe 等）都必须实现这一接口。
// 业务侧禁止直接 import transport/*；只能经 namespaces/* 命名空间使用。

export interface EventFrame<T = unknown> {
  type: string;
  seq: number;
  payload: T;
}

export type Unsubscribe = () => void;

export interface TransportRequestOptions {
  idempotencyKey?: string;
}

export interface Transport {
  request<TReq, TRes>(
    method: string,
    params: TReq,
    opts?: TransportRequestOptions,
  ): Promise<TRes>;

  subscribe<T = unknown>(
    topic: string,
    handler: (frame: EventFrame<T>) => void,
  ): Unsubscribe;

  close(): Promise<void>;
}
