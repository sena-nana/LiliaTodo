<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Loader2, RefreshCw } from "lucide-vue-next";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import TaskViewRow from "../components/TaskViewRow.vue";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import type { Task } from "../domain/tasks";

type TaskViewMode = "all" | "quadrant" | "timeline";

const route = useRoute();
const repository = useTaskRepository();
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const now = ref(new Date());
const loadRuns = useLatestAsyncRun();
const mode = computed<TaskViewMode>(() => {
  const value = String(route.params.view ?? "all");
  return value === "quadrant" || value === "timeline" ? value : "all";
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

onMounted(() => {
  void load();
});

watch(mode, () => {
  closeTask();
});

async function load() {
  await loadRuns.runLatest({
    before: () => {
      loading.value = true;
      error.value = null;
    },
    execute: () => repository.listActiveTasks(),
    commit: (nextTasks) => {
      now.value = new Date();
      tasks.value = nextTasks;
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

function isTaskUrgent(task: Task) {
  if (!task.dueAt) return false;
  const dueTime = new Date(task.dueAt).getTime();
  if (Number.isNaN(dueTime)) return false;
  const urgentUntil = now.value.getTime() + 24 * 60 * 60 * 1000;
  return dueTime <= urgentUntil;
}

function taskTimelineTime(task: Task) {
  return task.startAt ?? task.dueAt ?? task.createdAt;
}

function displayError(value: string) {
  return value.replace(/^Error:\s*/, "错误：");
}
</script>

<template>
  <section class="page">
    <div v-if="loading" class="card state">
      <Loader2 class="spin" :size="18" aria-hidden="true" />
      <p>正在加载任务...</p>
    </div>
    <div v-if="error" class="card state state--error">
      <p>{{ displayError(error) }}</p>
      <button type="button" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />
        重试
      </button>
    </div>
    <div v-if="!loading && !error && tasks.length === 0" class="card empty">
      <p>暂无进行中的任务。</p>
    </div>

    <ul v-if="!loading && !error && tasks.length > 0 && mode === 'all'" class="card task-list task-list--roomy">
      <TaskViewRow
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        @open="openTask"
        @complete="completeTask"
        @delete="deleteTask"
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
    />
  </section>
</template>

<style scoped>
.global-quadrant-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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
