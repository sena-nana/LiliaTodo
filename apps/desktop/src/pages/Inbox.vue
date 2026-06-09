<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Check, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { onTaskListsChanged } from "../data/taskListEvents";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import type { Task } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";

const repository = useTaskRepository();
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const loadRuns = useLatestAsyncRun();
const {
  selectedTask,
  childTasks,
  lists,
  saving,
  drawerError,
  parentCandidates,
  openTask,
  saveTask,
  completeTask,
  closeTask,
} = useTaskDetailDrawer({
  repository,
  reload: load,
  getParentCandidates: () => tasks.value,
});

onMounted(() => {
  void load();
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
    ]),
    commit: ([nextTasks, nextLists]) => {
      tasks.value = nextTasks;
      lists.value = nextLists;
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

function displayError(value: string) {
  return value.replace(/^Error:\s*/, "错误：");
}
</script>

<template>
  <section class="page">
    <div v-if="loading" class="card state">
      <Loader2 class="spin" :size="18" aria-hidden="true" />
      <p>正在加载收件箱...</p>
    </div>
    <div v-if="error" class="card state state--error">
      <p>{{ displayError(error) }}</p>
      <button type="button" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />
        重试
      </button>
    </div>
    <div v-if="!loading && !error && tasks.length === 0" class="card empty">
      <p>收件箱暂无任务。可在今日页添加任务并选择收件箱。</p>
    </div>
    <ul
      v-if="!loading && !error && tasks.length > 0"
      class="card task-list task-list--roomy"
    >
      <li
        v-for="task in tasks"
        :key="task.id"
        class="task-item task-item--actions task-item--clickable"
        @click="openTask(task)"
      >
        <div class="task-copy">
          <span class="task-title">{{ task.title }}</span>
          <span v-if="task.notes" class="task-meta">{{ task.notes }}</span>
          <span class="task-meta">
            <template v-if="task.startAt">开始 {{ task.startAt }}</template>
            <template v-if="task.dueAt"> 截止 {{ task.dueAt }}</template>
            <template v-if="taskHasDueReminder(task)"> 提醒已到</template>
          </span>
          <span v-if="task.priority > 0" class="task-badge">P{{ task.priority }}</span>
        </div>
        <div class="task-actions" @click.stop>
          <button type="button" class="icon-button" :aria-label="`完成 ${task.title}`" @click="completeTask(task)">
            <Check :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="icon-button" :aria-label="`编辑 ${task.title}`" @click="openTask(task)">
            <Pencil :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="icon-button icon-button--danger" :aria-label="`删除 ${task.title}`" @click="deleteTask(task)">
            <Trash2 :size="16" aria-hidden="true" />
          </button>
        </div>
      </li>
    </ul>
    <TaskDetailDrawer
      :task="selectedTask"
      :lists="lists"
      :parent-candidates="parentCandidates"
      :children="childTasks"
      :saving="saving"
      :error="drawerError"
      @close="closeTask"
      @save="saveTask"
      @complete="completeTask"
      @open-task="openTask"
    />
  </section>
</template>
