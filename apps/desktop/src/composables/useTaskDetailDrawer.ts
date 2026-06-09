import { computed, ref } from "vue";
import type { TaskRepository } from "../data/taskRepository";
import type { Task, TaskList, UpdateTaskInput } from "../domain/tasks";

interface UseTaskDetailDrawerOptions {
  repository: TaskRepository;
  reload: () => Promise<void>;
  getParentCandidates?: () => Task[];
}

export function useTaskDetailDrawer(options: UseTaskDetailDrawerOptions) {
  const selectedTask = ref<Task | null>(null);
  const childTasks = ref<Task[]>([]);
  const lists = ref<TaskList[]>([]);
  const saving = ref(false);
  const drawerError = ref<string | null>(null);

  const parentCandidates = computed(() => {
    const candidates = options.getParentCandidates?.() ?? [];
    const selectedTaskId = selectedTask.value?.id;
    return selectedTaskId
      ? candidates.filter((task) => task.id !== selectedTaskId)
      : candidates;
  });

  async function loadLists() {
    lists.value = await options.repository.listLists();
  }

  async function openTask(task: Task) {
    selectedTask.value = task;
    drawerError.value = null;
    try {
      childTasks.value = await options.repository.listTaskChildren(task.id);
      await loadLists();
    } catch (e) {
      drawerError.value = String(e);
    }
  }

  async function saveTask(taskId: string, patch: UpdateTaskInput) {
    saving.value = true;
    drawerError.value = null;
    try {
      const task = await options.repository.updateTask(taskId, patch);
      await options.reload();
      await openTask(task);
    } catch (e) {
      drawerError.value = String(e);
    } finally {
      saving.value = false;
    }
  }

  async function completeTask(task: Task) {
    drawerError.value = null;
    try {
      await options.repository.setStatus(task.id, "completed");
      closeTask();
      await options.reload();
    } catch (e) {
      drawerError.value = String(e);
    }
  }

  async function deleteTask(task: Task) {
    drawerError.value = null;
    try {
      await options.repository.deleteTask(task.id);
      closeTask();
      await options.reload();
    } catch (e) {
      drawerError.value = String(e);
    }
  }

  function closeTask() {
    selectedTask.value = null;
  }

  return {
    selectedTask,
    childTasks,
    lists,
    saving,
    drawerError,
    parentCandidates,
    openTask,
    saveTask,
    completeTask,
    deleteTask,
    closeTask,
    loadLists,
  };
}
