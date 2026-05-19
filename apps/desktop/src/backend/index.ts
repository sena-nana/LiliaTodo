// AB-01：backend 抽象层统一出口。
//
// 边界约定（强约束，未来若引入 ESLint 通过 no-restricted-imports 强化）：
// - 业务页面只允许 import 自 `backend`（本文件）或 `backend/namespaces/*`；
// - 严禁业务侧 import `backend/transport/*`，所有调用必须经命名空间层；
// - WebDAV 同步层（阶段 3）允许 import `backend/contracts/{entity,op}`，不得 import 其它子模块；
// - `backend/contracts/*` 一旦冻结，破坏性改动必须升 major 并改对应 capability version。

import {
  noopBackendSync,
  noopBackendTasks,
  noopBackendCalendar,
  noopBackendGates,
  noopBackendSandbox,
  noopBackendMcp,
} from "./namespaces";
import type {
  BackendSync,
  BackendTasks,
  BackendCalendar,
  BackendGates,
  BackendSandbox,
  BackendMcp,
} from "./namespaces";
import {
  disabledBackendConfig,
  isBackendConfigured,
  type BackendConfig,
} from "./config";
import { noopCapabilities, type Capabilities } from "./capabilities";

export type {
  BackendSync,
  BackendTasks,
  BackendCalendar,
  BackendGates,
  BackendSandbox,
  BackendMcp,
} from "./namespaces";
export type { BackendConfig } from "./config";
export type { Capabilities, Capability } from "./capabilities";
export {
  BackendDisabledError,
  BackendUnreachableError,
  BackendVersionMismatchError,
} from "./errors";
export type {
  Entity,
  Op,
  OpKind,
  OpTarget,
  Intent,
  Outcome,
  Gate,
  Verdict,
  VerdictRecord,
  JobSpec,
  JobResult,
  JobStatus,
  LogFrame,
} from "./contracts";

export interface Backend {
  readonly sync: BackendSync;
  readonly tasks: BackendTasks;
  readonly calendar: BackendCalendar;
  readonly gates: BackendGates;
  readonly sandbox: BackendSandbox;
  readonly mcp: BackendMcp;
  readonly capabilities: Capabilities;
  readonly config: BackendConfig;
}

export const backend: Backend = {
  sync: noopBackendSync,
  tasks: noopBackendTasks,
  calendar: noopBackendCalendar,
  gates: noopBackendGates,
  sandbox: noopBackendSandbox,
  mcp: noopBackendMcp,
  capabilities: noopCapabilities,
  config: disabledBackendConfig,
};

export function isBackendEnabled(): boolean {
  return isBackendConfigured(backend.config);
}
