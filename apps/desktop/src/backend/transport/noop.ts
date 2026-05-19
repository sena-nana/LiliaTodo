// AB-01：默认 noop transport。
// 一期所有 backend 调用最终在这里抛 BackendDisabledError；UI 应通过 capabilities 提前屏蔽入口。

import { BackendDisabledError } from "../errors";
import type {
  EventFrame,
  Transport,
  TransportRequestOptions,
  Unsubscribe,
} from "./types";

export const noopTransport: Transport = {
  async request<TReq, TRes>(
    method: string,
    _params: TReq,
    _opts?: TransportRequestOptions,
  ): Promise<TRes> {
    throw new BackendDisabledError(`request(${method})`);
  },

  subscribe<T = unknown>(
    topic: string,
    _handler: (frame: EventFrame<T>) => void,
  ): Unsubscribe {
    throw new BackendDisabledError(`subscribe(${topic})`);
  },

  async close(): Promise<void> {
    // noop transport 没有需要释放的资源。
  },
};
