<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ChevronDown, ChevronRight, Circle, Loader2, Plus, RefreshCw } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { onTaskListsChanged } from "../data/taskListEvents";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useTaskListActions } from "../composables/useTaskListActions";
import { compareByOrder } from "../domain/order";
import type { Task, TaskCategory } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";

const route = useRoute();
const repository = useTaskRepository();
const listId = computed(() => String(route.params.listId ?? "inbox"));
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const selectedCategoryId = ref<string | null>(null);
const collapsedSectionIds = ref<Set<string>>(new Set());
const loadRuns = useLatestAsyncRun();
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
const { newTitle, quickAddSaving, createTask } = useTaskListActions({
  repository,
  tasks,
  reload: load,
  listId: () => listId.value,
  categoryId: () => selectedCategoryId.value,
  setError: (value) => {
    error.value = value;
  },
});
const listName = computed(() => lists.value.find((list) => list.id === listId.value)?.name ?? "清单");
const sortedCategories = computed(() => [...categories.value].sort(compareByOrder));
const categorySections = computed(() => [
  ...sortedCategories.value.map((category) => ({
    id: category.id,
    name: category.name,
    category,
    tasks: tasks.value.filter((task) => task.categoryId === category.id),
  })),
  {
    id: "__uncategorized",
    name: "未分类",
    category: null,
    tasks: tasks.value.filter((task) => !task.categoryId),
  },
]);
const selectedSectionName = computed(() => {
  if (selectedCategoryId.value === null) return "未分类";
  return sortedCategories.value.find((category) => category.id === selectedCategoryId.value)?.name ?? "未分类";
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

watch(listId, () => {
  closeTask();
  newTitle.value = "";
  selectedCategoryId.value = null;
  collapsedSectionIds.value = new Set();
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
      repository.listCategoriesByList(currentListId),
    ]),
    commit: ([nextTasks, nextLists, nextCategories]) => {
      tasks.value = nextTasks;
      lists.value = nextLists;
      categories.value = nextCategories;
      if (selectedCategoryId.value && !nextCategories.some((category) => category.id === selectedCategoryId.value)) {
        selectedCategoryId.value = null;
      }
    },
    fail: (e) => {
      error.value = String(e);
    },
    settle: () => {
      loading.value = false;
    },
  });
}

function isSectionCollapsed(sectionId: string) {
  return collapsedSectionIds.value.has(sectionId);
}

function toggleSection(section: { id: string; category: TaskCategory | null }) {
  selectedCategoryId.value = section.category?.id ?? null;
  const next = new Set(collapsedSectionIds.value);
  if (next.has(section.id)) {
    next.delete(section.id);
  } else {
    next.add(section.id);
  }
  collapsedSectionIds.value = next;
}

function openTaskFromRow(task: Task) {
  selectedCategoryId.value = task.categoryId;
  void openTask(task);
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function checklistProgress(task: Task) {
  const done = task.checklist.filter((item) => item.done).length;
  return `${done}/${task.checklist.length}`;
}

function displayError(value: string) {
  return value.replace(/^Error:\s*/, "错误：");
}
</script>

<template>
  <section class="page">
    <form class="quick-add" @submit.prevent="createTask">
      <label class="sr-only" for="list-quick-add">添加清单任务</label>
      <div class="row">
        <input id="list-quick-add" v-model="newTitle" :placeholder="`添加到${listName} · ${selectedSectionName}`" />
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
    <div v-else-if="error" class="card state state--error">
      <p>{{ displayError(error) }}</p>
      <button type="button" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />
        重试
      </button>
    </div>
    <section v-else-if="tasks.length > 0 || categories.length > 0" class="task-sections">
      <div v-for="section in categorySections" :key="section.id" class="task-section">
        <button
          type="button"
          class="task-section__header"
          :class="{ 'is-selected': selectedCategoryId === (section.category?.id ?? null) }"
          :aria-expanded="!isSectionCollapsed(section.id)"
          :aria-controls="`task-section-${section.id}`"
          @click="toggleSection(section)"
        >
          <span class="task-section__title">
            <ChevronRight v-if="isSectionCollapsed(section.id)" :size="16" aria-hidden="true" />
            <ChevronDown v-else :size="16" aria-hidden="true" />
            <span>{{ section.name }}</span>
          </span>
          <span class="task-section__count">{{ section.tasks.length }}</span>
        </button>
        <ul
          v-if="!isSectionCollapsed(section.id)"
          :id="`task-section-${section.id}`"
          class="task-list task-list--compact"
        >
          <li
            v-for="task in section.tasks"
            :key="task.id"
            :class="['task-row', { 'is-selected': selectedTask?.id === task.id }]"
          >
            <button type="button" class="task-row__complete" :aria-label="`完成 ${task.title}`" @click="completeTask(task)">
              <Circle :size="18" aria-hidden="true" />
            </button>
            <button type="button" class="task-row__content" :aria-label="`打开任务 ${task.title}`" @click="openTaskFromRow(task)">
              <span class="task-row__title">{{ task.title }}</span>
              <span v-if="task.notes" class="task-row__notes">{{ task.notes }}</span>
              <span class="task-row__meta">
                <span v-if="task.startAt">开始 {{ formatDateTime(task.startAt) }}</span>
                <span v-if="task.dueAt">截止 {{ formatDateTime(task.dueAt) }}</span>
                <span v-if="taskHasDueReminder(task)">提醒已到</span>
                <span v-if="task.priority > 0">P{{ task.priority }}</span>
                <span v-if="task.checklist.length > 0">检查清单 {{ checklistProgress(task) }}</span>
              </span>
            </button>
          </li>
          <li v-if="section.tasks.length === 0" class="task-section__empty">暂无任务。</li>
        </ul>
      </div>
    </section>
    <div v-else class="card empty">
      <p>这个清单暂无任务。</p>
    </div>

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
.quick-add {
  position: sticky;
  top: 0;
  z-index: 2;
}

.task-sections {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-section {
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-elev);
}

.task-section__header {
  width: 100%;
  height: 38px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  border-radius: 6px;
}

.task-section__header:hover,
.task-section__header.is-selected {
  background: var(--bg-hover);
  color: var(--text);
}

.task-section__header.is-selected {
  box-shadow: inset 2px 0 0 var(--accent);
}

.task-section__title,
.task-section__count {
  display: inline-flex;
  align-items: center;
}

.task-section__title {
  min-width: 0;
  gap: 6px;
  font-weight: 700;
}

.task-section__title span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-section__count {
  min-width: 24px;
  height: 22px;
  justify-content: center;
  border-radius: 999px;
  background: var(--bg-subtle);
  font-size: 12px;
}

.task-list--compact {
  padding: 0 0 4px;
}

.task-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  min-height: 46px;
  border-radius: 6px;
}

.task-row:hover,
.task-row.is-selected {
  background: var(--bg-hover);
}

.task-row.is-selected {
  box-shadow: inset 2px 0 0 var(--accent);
}

.task-row__complete {
  width: 34px;
  height: 40px;
  padding: 0;
  color: var(--text-muted);
}

.task-row__complete:hover {
  color: var(--ok);
}

.task-row__content {
  display: flex;
  min-width: 0;
  height: auto;
  padding: 7px 8px 8px 0;
  align-items: stretch;
  justify-content: flex-start;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  font-weight: 400;
}

.task-row__content:hover {
  background: transparent;
}

.task-row__title {
  color: var(--text);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.task-row__notes {
  color: var(--text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 18px;
  color: var(--text-muted);
  font-size: 12px;
}

.task-section__empty {
  padding: 8px 10px 12px 34px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
