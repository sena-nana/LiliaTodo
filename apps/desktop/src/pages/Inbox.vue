<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Plus } from "lucide-vue-next";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import PageStateBlock from "../components/PageStateBlock.vue";
import TaskBulkToolbar from "../components/TaskBulkToolbar.vue";
import TaskSelectionToolbar from "../components/TaskSelectionToolbar.vue";
import TaskTableRow from "../components/TaskTableRow.vue";
import { useBulkSelection } from "../composables/useBulkSelection";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { onTaskListsChanged } from "../data/taskListEvents";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useTaskBulkActions } from "../composables/useTaskBulkActions";
import { useTaskListActions } from "../composables/useTaskListActions";
import { formatDisplayError } from "../utils/errors";
import type { Task } from "../domain/tasks";

const repository = useTaskRepository();
const tasks = ref<Task[]>([]);
const quickAddInput = ref<HTMLInputElement | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const draggingTaskId = ref<string | null>(null);
const loadRuns = useLatestAsyncRun();
const selection = useBulkSelection();
const {
  selectedTask,
  childTasks,
  lists,
  categories,
  saving,
  drawerError,
  parentCandidates,
  openTask,
  saveTask,
  completeTask,
  deleteTask: deleteTaskFromDrawer,
  reorderChildTasks,
  closeTask,
} = useTaskDetailDrawer({
  repository,
  reload: load,
  getParentCandidates: () => tasks.value,
});
const { newTitle, quickAddSaving, createTask } = useTaskListActions({
  repository,
  tasks,
  reload: load,
  listId: () => "inbox",
  setError: (value) => {
    error.value = value;
  },
});
const selectedTasks = computed(() => tasks.value.filter((task) => selection.has(task.id)));
const { applyBulk } = useTaskBulkActions({
  repository,
  selection,
  reload: load,
  setError: (value) => {
    error.value = value;
  },
  getTaskIds: () => selectedTasks.value.map((task) => task.id),
});

onMounted(() => {
  void load();
});

useGlobalShortcuts({
  n: () => quickAddInput.value?.focus(),
  o: () => {
    const task = selectedTask.value ?? selectedTasks.value[0] ?? tasks.value[0];
    if (task) void openTask(task);
  },
  x: () => {
    const task = selectedTask.value ?? selectedTasks.value[0] ?? tasks.value[0];
    if (task) void completeTask(task);
  },
  delete: () => {
    if (selection.selectedCount.value > 0) {
      void bulkDelete();
      return;
    }
    const task = selectedTask.value ?? tasks.value[0];
    if (task) void deleteTask(task);
  },
});

const stopTaskListEvents = onTaskListsChanged(() => {
  void load();
});

onUnmounted(() => {
  stopTaskListEvents();
});

async function load() {
  await loadRuns.runLatest({
    before: () => {
      loading.value = true;
      error.value = null;
    },
    execute: () => Promise.all([
      repository.listInbox(),
      repository.listLists(),
      repository.listCategoriesByList("inbox"),
    ]),
    commit: ([nextTasks, nextLists, nextCategories]) => {
      tasks.value = nextTasks;
      lists.value = nextLists;
      categories.value = nextCategories;
    },
    fail: (e) => {
      error.value = String(e);
    },
    settle: () => {
      loading.value = false;
    },
  });
}

async function deleteTask(task: Task) {
  error.value = null;
  try {
    await repository.deleteTask(task.id);
    if (selectedTask.value?.id === task.id) closeTask();
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

async function bulkDelete() {
  await applyBulk({ type: "delete" });
}

async function bulkComplete() {
  await applyBulk({ type: "complete" });
}

function onTaskDragStart(task: Task) {
  draggingTaskId.value = task.id;
}

async function onTaskDrop(target: Task) {
  const sourceId = draggingTaskId.value;
  draggingTaskId.value = null;
  if (!sourceId || sourceId === target.id) return;
  const ids = tasks.value.map((task) => task.id);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(target.id);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ids.splice(sourceIndex, 1);
  ids.splice(targetIndex, 0, sourceId);
  error.value = null;
  try {
    await repository.reorderTasks({ taskIds: ids, listId: "inbox", categoryId: null });
    await load();
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <section class="page">
    <form class="quick-add" @submit.prevent="createTask">
      <label class="sr-only" for="inbox-quick-add">添加收件箱任务</label>
      <div class="row">
        <input ref="quickAddInput" id="inbox-quick-add" v-model="newTitle" placeholder="添加收件箱任务" />
        <button class="primary" type="submit" :disabled="quickAddSaving || !newTitle.trim()">
          <Plus :size="16" aria-hidden="true" />
          添加任务
        </button>
      </div>
    </form>
    <TaskSelectionToolbar
      v-if="!loading && !error && tasks.length > 0"
      label="收件箱"
      :total-count="tasks.length"
      :selected-count="selection.selectedCount.value"
    >
      <template #actions>
        <button type="button" :disabled="selection.selectedCount.value === 0" @click="bulkComplete">批量完成</button>
        <button type="button" :disabled="selection.selectedCount.value === 0" @click="bulkDelete">批量删除</button>
      </template>
    </TaskSelectionToolbar>
    <TaskBulkToolbar
      v-if="selection.selectedCount.value > 0"
      :selected-count="selection.selectedCount.value"
      :lists="lists"
      :categories="categories"
      current-list-id="inbox"
      @apply="applyBulk"
      @clear="selection.clear"
    />
    <PageStateBlock v-if="loading" kind="loading" title="正在加载收件箱..." />
    <PageStateBlock v-else-if="error" kind="error" :title="formatDisplayError(error)" @action="load" />
    <PageStateBlock v-else-if="tasks.length === 0" kind="empty" title="收件箱暂无任务。可在今日页添加任务并选择收件箱。" />
    <ul v-else class="task-table">
      <TaskTableRow
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        selectable
        draggable-row
        :checked="selection.has(task.id)"
        :selected="selectedTask?.id === task.id"
        @toggle="(_, checked) => selection.toggle(task.id, checked)"
        @open="openTask"
        @complete="completeTask"
        @delete="deleteTask"
        @drag-start="onTaskDragStart"
        @drop-on="onTaskDrop"
      />
    </ul>
    <AsyncTaskDetailDrawer
      v-if="selectedTask"
      :task="selectedTask"
      :lists="lists"
      :parent-candidates="parentCandidates"
      :children="childTasks"
      :saving="saving"
      :error="drawerError"
      @close="closeTask"
      @save="saveTask"
      @complete="completeTask"
      @delete="deleteTaskFromDrawer"
      @open-task="openTask"
      @reorder-children="reorderChildTasks"
    />
  </section>
</template>

<style scoped>
.task-table {
  list-style: none;
  padding: 0 12px;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

</style>
