// AB-01：业务页面唯一允许 import 的 backend 入口集合。
// 禁止 import backend/transport/*——所有调用强制经命名空间层。

export type { BackendSync, SyncSnapshot } from "./sync";
export { noopBackendSync } from "./sync";
export type { BackendTasks } from "./tasks";
export { noopBackendTasks } from "./tasks";
export type { BackendCalendar } from "./calendar";
export { noopBackendCalendar } from "./calendar";
export type { BackendGates } from "./gates";
export { noopBackendGates } from "./gates";
export type { BackendSandbox } from "./sandbox";
export { noopBackendSandbox } from "./sandbox";
export type { BackendMcp, McpServerInfo } from "./mcp";
export { noopBackendMcp } from "./mcp";
