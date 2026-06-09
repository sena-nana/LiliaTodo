<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { onTaskListsChanged } from "../data/taskListEvents";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useTaskListActions } from "../composables/useTaskListActions";
import type { Task } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";

const route = useRoute();
const repository = useTaskRepository();
const listId = computed(() => String(route.params.listId ?? "inbox"));
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
  deleteTask: deleteTaskFromDrawer,
  closeTask,
} = useTaskDetailDrawer({
  repository,
  reload: load,
  getParentCandidates: () => tasks.value,
});
const { newTitle, quickAddSaving, createTask, moveTask } = useTaskListActions({
  repository,
  tasks,
  reload: load,
  listId: () => listId.value,
  setError: (value) => {
    error.value = value;
  },
});
const listName = computed(() => lists.value.find((list) => list.id === listId.value)?.name ?? "清单");

onMounted(() => {
  void load();
});

const stopTaskListEvents = onTaskListsChanged(() => {
  void load();
});

onUnmounted(() => {
  stopTaskListEvents();
});

watch(listId, () => {
  closeTask();
  newTitle.value = "";
  void load();
});

async function load() {
  const currentListId = listId.value;
  await loadRuns.runLatest({
    before: () => {
      loading.value = true;
      error.value = null;
    },
    execute: () => Promise.all([
      repository.listTasksByList(currentListId),
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
    <header class="page-header">
      <h1>{{ listName }}</h1>
    </header>
    <form class="quick-add" @submit.prevent="createTask">
      <label class="sr-only" for="list-quick-add">添加清单任务</label>
      <div class="row">
        <input id="list-quick-add" v-model="newTitle" :placeholder="`添加到${listName}`" />
        <button class="primary" type="submit" :disabled="quickAddSaving || !newTitle.trim()">
          <Plus :size="16" aria-hidden="true" />
          添加任务
        </button>
      </div>
    </form>
    <div v-if="loading" class="card state">
      <Loader2 class="spin" :size="18" aria-hidden="true" />
      <p>正在加载清单...</p>
    </div>
    <div v-if="error" class="card state state--error">
      <p>{{ displayError(error) }}</p>
      <button type="button" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />
        重试
      </button>
    </div>
    <div v-if="!loading && !error && tasks.length === 0" class="card empty">
      <p>这个清单暂无任务。</p>
    </div>
    <ul v-if="!loading && !error && tasks.length > 0" class="card task-list task-list--roomy">
      <li v-for="task in tasks" :key="task.id" class="task-item task-item--actions task-item--clickable" @click="openTask(task)">
        <div class="task-copy">
          <span class="task-title">{{ task.title }}</span>
          <span v-if="task.notes" class="task-meta">{{ task.notes }}</span>
          <span v-if="taskHasDueReminder(task)" class="task-meta">提醒已到</span>
          <span v-if="task.priority > 0" class="task-badge">P{{ task.priority }}</span>
        </div>
        <div class="task-actions" @click.stop>
          <button type="button" class="icon-button" :aria-label="`完成 ${task.title}`" @click="completeTask(task)">
            <Check :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="icon-button" :aria-label="`上移 ${task.title}`" @click="moveTask(task, -1)">
            <ArrowUp :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="icon-button" :aria-label="`下移 ${task.title}`" @click="moveTask(task, 1)">
            <ArrowDown :size="16" aria-hidden="true" />
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
      @delete="deleteTaskFromDrawer"
      @open-task="openTask"
    />
  </section>
</template>
