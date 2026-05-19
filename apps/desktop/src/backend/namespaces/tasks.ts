// AB-01：backend.tasks 命名空间——通过 intent.submit 触发服务端的任务拆解/建议能力。
// 服务端结果以 Op[] 形式经 sync 通道回流，本地业务无需为「谁产生的变更」分支处理。
// 一期 noop，UI 入口须按 capabilities.has("tasks") 决定是否可见。

import { BackendDisabledError } from "../errors";

export interface BackendTasks {
  breakdown(taskId: string): Promise<{ intentId: string }>;
  suggest(taskId: string): Promise<{ intentId: string }>;
}

export const noopBackendTasks: BackendTasks = {
  async breakdown() {
    throw new BackendDisabledError("tasks.breakdown");
  },
  async suggest() {
    throw new BackendDisabledError("tasks.suggest");
  },
};
