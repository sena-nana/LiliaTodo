import { ref, type Ref } from "vue";
import type { TaskRepository } from "../data/taskRepository";
import type { Task } from "../domain/tasks";
import { moveItemById } from "../domain/order";

interface UseTaskListActionsOptions {
  repository: TaskRepository;
  tasks: Ref<Task[]>;
  reload: () => Promise<void>;
  listId: () => string;
  categoryId?: () => string | null;
  setError: (value: string | null) => void;
}

export function useTaskListActions({
  repository,
  tasks,
  reload,
  listId,
  categoryId,
  setError,
}: UseTaskListActionsOptions) {
  const newTitle = ref("");
  const quickAddSaving = ref(false);

  async function createTask() {
    if (!newTitle.value.trim()) return;
    quickAddSaving.value = true;
    setError(null);
    try {
      const selectedCategoryId = categoryId?.() ?? null;
      await repository.createTask({
        title: newTitle.value,
        listId: listId(),
        ...(selectedCategoryId ? { categoryId: selectedCategoryId } : {}),
      });
      newTitle.value = "";
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      quickAddSaving.value = false;
    }
  }

  async function moveTask(task: Task, direction: -1 | 1) {
    const bucket = tasks.value.filter((item) => item.categoryId === task.categoryId);
    const reordered = moveItemById(bucket, task.id, direction);
    if (!reordered) return;
    setError(null);
    try {
      await Promise.all(reordered.map((nextTask, childOrder) =>
        repository.updateTask(nextTask.id, { childOrder }),
      ));
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return {
    newTitle,
    quickAddSaving,
    createTask,
    moveTask,
  };
}
