import type { BatchTaskOperation } from "../domain/tasks";
import type { TaskRepository } from "../data/taskRepository";
import type { BulkSelectionState } from "./useBulkSelection";
import { formatBatchTaskFailure } from "../utils/errors";

type BulkOperationWithoutIds = Omit<BatchTaskOperation, "taskIds">;

interface UseTaskBulkActionsOptions {
  repository: TaskRepository;
  selection: BulkSelectionState;
  reload(): Promise<void>;
  setError(value: string | null): void;
  getTaskIds?: () => string[];
}

export function useTaskBulkActions({
  repository,
  selection,
  reload,
  setError,
  getTaskIds,
}: UseTaskBulkActionsOptions) {
  async function applyBulk(operation: BulkOperationWithoutIds) {
    const taskIds = getTaskIds ? getTaskIds() : [...selection.selectedIds.value];
    if (taskIds.length === 0) return;
    setError(null);
    const result = await repository.batchUpdateTasks({ ...operation, taskIds } as BatchTaskOperation);
    selection.clear();
    await reload();
    if (result.failed.length > 0) {
      setError(formatBatchTaskFailure(result.failed));
    }
  }

  return { applyBulk };
}
