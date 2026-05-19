// BE-12 sprint-3：根据服务能力选择"如何在并发写入下保护一次提交"。
//
// 三档策略：
//   - "webdav-lock"：服务端支持 WebDAV LOCK（class 2），独占锁；
//     一期不实做，sprint-4 等真客户端补齐 LOCK/UNLOCK 协议后再启用。
//   - "etag-optimistic"：进入时 stat 拿当前 ETag 作为 token，
//     真写入时调用方在 put 里传 If-Match=token.expectedEtag；
//     服务端冲突返回 412，由 caller 走重试或冲突 UI。坚果云走这一档。
//   - "read-before-write"：服务端连 ETag 都不靠谱时退到"写前再 stat 一次"，
//     拿到 lastModified 作 token；纯雏形，并发窗口仍存在但优于"盲写"。
//
// strategy.withLock 只负责"获取 token + 收尾"，真正的 put 由 caller 自己拿
// token 去做条件提交；这样不绑死任何具体写入协议，便于 sprint-4 替换 client。

import type { WebdavCapabilities } from "./capabilities";
import type { WebdavClient } from "./types";

export type LockStrategyKind =
  | "webdav-lock"
  | "etag-optimistic"
  | "read-before-write";

export interface LockToken {
  readonly path: string;
  /** 调用方在 put 时传 ifMatch；null 表示文件不存在或服务端没给 ETag。 */
  readonly expectedEtag: string | null;
  readonly expectedLastModified: string | null;
  readonly kind: LockStrategyKind;
}

export interface LockStrategy {
  readonly kind: LockStrategyKind;
  withLock<T>(
    path: string,
    work: (token: LockToken) => Promise<T>,
  ): Promise<T>;
}

export interface PickLockStrategyInput {
  readonly client: WebdavClient;
  readonly capabilities: WebdavCapabilities;
}

export function pickLockStrategy({
  client,
  capabilities,
}: PickLockStrategyInput): LockStrategy {
  if (capabilities.supportsLock) {
    // sprint-4 真客户端补齐 LOCK 协议后再切换；当前保护性退化到 etag。
    // 此分支保留是为了让调用代码不必关心"是否真切换"。
    return createEtagOptimisticLockStrategy(client);
  }
  if (capabilities.supportsEtag) {
    return createEtagOptimisticLockStrategy(client);
  }
  return createReadBeforeWriteLockStrategy(client);
}

export function createEtagOptimisticLockStrategy(
  client: WebdavClient,
): LockStrategy {
  return {
    kind: "etag-optimistic",
    async withLock(path, work) {
      const stat = await client.stat(path);
      const token: LockToken = {
        path,
        expectedEtag: stat?.etag ?? null,
        expectedLastModified: stat?.lastModified ?? null,
        kind: "etag-optimistic",
      };
      return work(token);
    },
  };
}

export function createReadBeforeWriteLockStrategy(
  client: WebdavClient,
): LockStrategy {
  return {
    kind: "read-before-write",
    async withLock(path, work) {
      const stat = await client.stat(path);
      const token: LockToken = {
        path,
        expectedEtag: stat?.etag ?? null,
        expectedLastModified: stat?.lastModified ?? null,
        kind: "read-before-write",
      };
      const result = await work(token);
      // 写后再 stat 一次：若 lastModified 出现意外跳变，调用方应自查冲突。
      // 本策略不抛错，因为"是否构成冲突"的判定需要业务上下文，留给 caller。
      await client.stat(path);
      return result;
    },
  };
}
