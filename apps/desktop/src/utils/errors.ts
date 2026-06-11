import type { BatchTaskResult } from "../domain/tasks";

export function formatDisplayError(value: unknown) {
  return String(value).replace(/^Error:\s*/, "错误：");
}

export function formatBatchTaskFailure(failed: BatchTaskResult["failed"]) {
  return `部分任务处理失败：${failed.map((item) => item.error).join("；")}`;
}
