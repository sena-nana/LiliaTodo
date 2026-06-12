<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import TaskViewRow from "../components/TaskViewRow.vue";
import PageStateBlock from "../components/PageStateBlock.vue";
import TaskBulkToolbar from "../components/TaskBulkToolbar.vue";
import TaskSelectionToolbar from "../components/TaskSelectionToolbar.vue";
import TaskTableRow from "../components/TaskTableRow.vue";
import { useBulkSelection } from "../composables/useBulkSelection";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts";
import { useTaskBulkActions } from "../composables/useTaskBulkActions";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { formatDisplayError } from "../utils/errors";
import type { Task } from "../domain/tasks";
import { parseStrictDateTimeMs } from "../domain/dateTime";

type TaskViewMode = "all" | "quadrant" | "timeline" | "completed" | "archived" | "deleted";

const route = useRoute();
const repository = useTaskRepository();
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const now = ref(new Date());
const draggingTaskId = ref<string | null>(null);
const loadRuns = useLatestAsyncRun();
const selection = useBulkSelection();
const mode = computed<TaskViewMode>(() => {
  const value = String(route.params.view ?? "all");
  return ["quadrant", "timeline", "completed", "archived", "deleted"].includes(value) ? value as TaskViewMode : "all";
});
const {
  selectedTask,
  childTasks,
  lists,
  saving,
  drawerError,
  parentCandidates,
  categories,
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
const quadrantSections = computed(() => {
  const sections = [
    { id: "important-urgent", name: "重要且紧急", tasks: [] as Task[] },
    { id: "important-not-urgent", name: "重要不紧急", tasks: [] as Task[] },
    { id: "not-important-urgent", name: "不重要但紧急", tasks: [] as Task[] },
    { id: "not-important-not-urgent", name: "不重要不紧急", tasks: [] as Task[] },
  ];

  for (const task of tasks.value) {
    const important = task.priority > 0;
    const urgent = isTaskUrgent(task);
    if (important && urgent) sections[0].tasks.push(task);
    else if (important) sections[1].tasks.push(task);
    else if (urgent) sections[2].tasks.push(task);
    else sections[3].tasks.push(task);
  }

  return sections;
});
const timelineTasks = computed(() => [...tasks.value].sort((a, b) => {
  const byTime = taskTimelineTime(a).localeCompare(taskTimelineTime(b));
  if (byTime !== 0) return byTime;
  return b.priority - a.priority;
}));
const { applyBulk } = useTaskBulkActions({
  repository,
  selection,
  reload: load,
  setError: (value) => {
    error.value = value;
  },
});

onMounted(() => {
  void load();
});

useGlobalShortcuts({
  o: () => {
    const task = selectedTask.value ?? tasks.value.find((task) => selection.has(task.id)) ?? tasks.value[0];
    if (task && mode.value !== "deleted") void openTask(task);
  },
  x: () => {
    const task = selectedTask.value ?? tasks.value.find((task) => selection.has(task.id)) ?? tasks.value[0];
    if (task && mode.value === "all") void completeTask(task);
  },
  delete: () => {
    if (mode.value === "deleted") {
      void bulkPurge();
      return;
    }
    if (selection.selectedCount.value > 0) {
      void bulkDelete();
      return;
    }
    const task = selectedTask.value ?? tasks.value[0];
    if (task) void deleteTask(task);
  },
});

watch(mode, () => {
  closeTask();
  selection.clear();
  void load();
});

async function load() {
  await loadRuns.runLatest({
    before: () => {
      loading.value = true;
      error.value = null;
    },
    execute: async () => {
      const taskPromise = mode.value === "completed" || mode.value === "archived" || mode.value === "deleted"
        ? repository.listTasksByStatus(mode.value === "deleted" ? "deleted" : mode.value)
        : repository.listActiveTasks();
      const [nextTasks, nextLists] = await Promise.all([taskPromise, repository.listLists()]);
      const nextCategories = (await Promise.all(nextLists.map((list) => repository.listCategoriesByList(list.id)))).flat();
      return [nextTasks, nextLists, nextCategories] as const;
    },
    commit: ([nextTasks, nextLists, nextCategories]) => {
      now.value = new Date();
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

async function bulkComplete() {
  await applyBulk({ type: "complete" });
}

async function bulkDelete() {
  await applyBulk({ type: "delete" });
}

async function restoreTask(task: Task) {
  error.value = null;
  try {
    await repository.restoreTask(task.id);
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

async function purgeTask(task: Task) {
  error.value = null;
  try {
    await repository.purgeTask(task.id);
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

async function bulkRestore() {
  const taskIds = [...selection.selectedIds.value];
  if (taskIds.length === 0) return;
  error.value = null;
  for (const taskId of taskIds) {
    await repository.restoreTask(taskId);
  }
  selection.clear();
  await load();
}

async function bulkPurge() {
  const taskIds = [...selection.selectedIds.value];
  if (taskIds.length === 0) return;
  error.value = null;
  for (const taskId of taskIds) {
    await repository.purgeTask(taskId);
  }
  selection.clear();
  await load();
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
  await repository.reorderTasks({ taskIds: ids });
  await load();
}

function isTaskUrgent(task: Task) {
  if (!task.dueAt) return false;
  const dueTime = parseStrictDateTimeMs(task.dueAt);
  if (dueTime === null) return false;
  const urgentUntil = now.value.getTime() + 24 * 60 * 60 * 1000;
  return dueTime <= urgentUntil;
}

function taskTimelineTime(task: Task) {
  return task.startAt ?? task.dueAt ?? task.createdAt;
}

</script>

<template>
  <section class="page">
    <TaskSelectionToolbar
      v-if="!loading && !error && tasks.length > 0"
      :label="mode === 'deleted' ? '最近删除' : mode === 'completed' ? '已完成' : mode === 'archived' ? '已归档' : '任务'"
      :total-count="tasks.length"
      :selected-count="selection.selectedCount.value"
    >
      <template #actions>
        <template v-if="mode === 'deleted'">
          <button type="button" :disabled="selection.selectedCount.value === 0" @click="bulkRestore">批量恢复</button>
          <button type="button" class="ghost danger" :disabled="selection.selectedCount.value === 0" @click="bulkPurge">彻底删除</button>
        </template>
        <template v-else>
          <button type="button" :disabled="selection.selectedCount.value === 0 || mode !== 'all'" @click="bulkComplete">批量完成</button>
          <button type="button" :disabled="selection.selectedCount.value === 0" @click="bulkDelete">批量删除</button>
        </template>
      </template>
    </TaskSelectionToolbar>
    <TaskBulkToolbar
      v-if="selection.selectedCount.value > 0 && mode !== 'deleted'"
      :selected-count="selection.selectedCount.value"
      :lists="lists"
      :categories="categories"
      @apply="applyBulk"
      @clear="selection.clear"
    />
    <PageStateBlock v-if="loading" kind="loading" title="正在加载任务..." />
    <PageStateBlock v-else-if="error" kind="error" :title="formatDisplayError(error)" @action="load" />
    <PageStateBlock v-else-if="tasks.length === 0" kind="empty" title="暂无任务。" />

    <ul v-if="!loading && !error && tasks.length > 0 && (mode === 'all' || mode === 'completed' || mode === 'archived' || mode === 'deleted')" class="card task-list task-list--roomy">
      <TaskTableRow
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        selectable
        :checked="selection.has(task.id)"
        :selected="selectedTask?.id === task.id"
        draggable-row
        :deleted-mode="mode === 'deleted'"
        @toggle="(_, checked) => selection.toggle(task.id, checked)"
        @open="openTask"
        @complete="completeTask"
        @delete="deleteTask"
        @restore="restoreTask"
        @purge="purgeTask"
        @drag-start="onTaskDragStart"
        @drop-on="onTaskDrop"
      />
    </ul>

    <section v-if="!loading && !error && tasks.length > 0 && mode === 'quadrant'" class="global-quadrant-grid">
      <div v-for="section in quadrantSections" :key="section.id" class="task-view-section">
        <div class="task-view-section__header">
          <h2>{{ section.name }}</h2>
        </div>
        <p v-if="section.tasks.length === 0" class="empty-text">暂无任务。</p>
        <ul v-else class="task-list task-list--roomy">
          <TaskViewRow
            v-for="task in section.tasks"
            :key="task.id"
            :task="task"
            @open="openTask"
            @complete="completeTask"
            @delete="deleteTask"
          />
        </ul>
      </div>
    </section>

    <section v-if="!loading && !error && tasks.length > 0 && mode === 'timeline'" class="task-view-section">
      <ol class="timeline global-timeline">
        <TaskViewRow
          v-for="task in timelineTasks"
          :key="task.id"
          :task="task"
          variant="timeline"
          @open="openTask"
          @complete="completeTask"
          @delete="deleteTask"
        />
      </ol>
    </section>

    <AsyncTaskDetailDrawer
      v-if="selectedTask"
      :task="selectedTask"
      :lists="lists"
      :categories="categories"
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
.global-quadrant-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.task-toolbar {
  min-height: 42px;
  padding: 0 10px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  color: var(--text-muted);
  font-size: 12px;
}

.task-toolbar__left,
.task-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-view-section {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.task-view-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.task-view-section__header h2 {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.global-timeline {
  margin-left: 6px;
}

@media (max-width: 900px) {
  .global-quadrant-grid {
    grid-template-columns: 1fr;
  }
}
</style>
