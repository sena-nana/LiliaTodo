<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Check, ChevronDown, ChevronRight, Circle, Pencil, Plus, Trash2, X } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { onTaskListsChanged } from "../data/taskListEvents";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useTaskListActions } from "../composables/useTaskListActions";
import { useBulkSelection } from "../composables/useBulkSelection";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts";
import { useTaskBulkActions } from "../composables/useTaskBulkActions";
import { compareByOrder } from "../domain/order";
import type { Task, TaskCategory } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";
import { formatDisplayError } from "../utils/errors";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import PageStateBlock from "../components/PageStateBlock.vue";
import TaskBulkToolbar from "../components/TaskBulkToolbar.vue";
import TaskSelectionToolbar from "../components/TaskSelectionToolbar.vue";

const route = useRoute();
const repository = useTaskRepository();
const listId = computed(() => String(route.params.listId ?? "inbox"));
const tasks = ref<Task[]>([]);
const quickAddInput = ref<HTMLInputElement | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const selectedCategoryId = ref<string | null>(null);
const collapsedSectionIds = ref<Set<string>>(new Set());
const creatingCategory = ref(false);
const newCategoryName = ref("");
const editingCategoryId = ref<string | null>(null);
const editingCategoryName = ref("");
const draggingTaskId = ref<string | null>(null);
const draggingCategoryId = ref<string | null>(null);
const loadRuns = useLatestAsyncRun();
const selection = useBulkSelection();
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
    if (task) void openTaskFromRow(task);
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
    if (task) void deleteTaskFromDrawer(task);
  },
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
  selection.clear();
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

async function createCategory() {
  if (!newCategoryName.value.trim()) return;
  error.value = null;
  try {
    const category = await repository.createCategory({ listId: listId.value, name: newCategoryName.value });
    newCategoryName.value = "";
    creatingCategory.value = false;
    selectedCategoryId.value = category.id;
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

function beginRenameCategory(category: TaskCategory) {
  editingCategoryId.value = category.id;
  editingCategoryName.value = category.name;
}

async function saveCategory(category: TaskCategory) {
  if (!editingCategoryName.value.trim()) return;
  error.value = null;
  try {
    await repository.updateCategory(category.id, { name: editingCategoryName.value });
    editingCategoryId.value = null;
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

async function removeCategory(category: TaskCategory) {
  error.value = null;
  try {
    await repository.deleteCategory(category.id);
    if (selectedCategoryId.value === category.id) selectedCategoryId.value = null;
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

function onTaskDragStart(task: Task) {
  draggingTaskId.value = task.id;
}

async function onTaskDrop(target: Task, section: { category: TaskCategory | null; tasks: Task[] }) {
  const sourceId = draggingTaskId.value;
  draggingTaskId.value = null;
  if (!sourceId || sourceId === target.id) return;
  const ids = section.tasks.map((task) => task.id);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(target.id);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ids.splice(sourceIndex, 1);
  ids.splice(targetIndex, 0, sourceId);
  await repository.reorderTasks({
    taskIds: ids,
    listId: listId.value,
    categoryId: section.category?.id ?? null,
  });
  await load();
}

function onCategoryDragStart(category: TaskCategory | null) {
  draggingCategoryId.value = category?.id ?? null;
}

async function onCategoryDrop(target: TaskCategory | null) {
  const sourceId = draggingCategoryId.value;
  draggingCategoryId.value = null;
  if (!sourceId || !target || sourceId === target.id) return;
  const ids = sortedCategories.value.map((category) => category.id);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(target.id);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ids.splice(sourceIndex, 1);
  ids.splice(targetIndex, 0, sourceId);
  await Promise.all(ids.map((id, order) => repository.updateCategory(id, { order })));
  await load();
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

</script>

<template>
  <section class="page">
    <form class="quick-add" @submit.prevent="createTask">
      <label class="sr-only" for="list-quick-add">添加清单任务</label>
      <div class="row">
        <input ref="quickAddInput" id="list-quick-add" v-model="newTitle" :placeholder="`添加到${listName} · ${selectedSectionName}`" />
        <button class="primary" type="submit" :disabled="quickAddSaving || !newTitle.trim()">
          <Plus :size="16" aria-hidden="true" />
          添加任务
        </button>
      </div>
    </form>

    <TaskSelectionToolbar
      label="清单"
      :total-count="tasks.length"
      :selected-count="selection.selectedCount.value"
      class="list-toolbar"
    >
      <template #label>
        <strong>{{ listName }}</strong>
        <span>{{ tasks.length }} 条任务</span>
      </template>
      <template #actions>
        <button type="button" @click="creatingCategory = true">
          <Plus :size="16" aria-hidden="true" />
          新增分类
        </button>
        <button type="button" :disabled="selection.selectedCount.value === 0" @click="bulkComplete">批量完成</button>
        <button type="button" :disabled="selection.selectedCount.value === 0" @click="bulkDelete">批量删除</button>
      </template>
    </TaskSelectionToolbar>
    <TaskBulkToolbar
      v-if="selection.selectedCount.value > 0"
      :selected-count="selection.selectedCount.value"
      :lists="lists"
      :categories="categories"
      :current-list-id="listId"
      @apply="applyBulk"
      @clear="selection.clear"
    />

    <form v-if="creatingCategory" class="category-form" @submit.prevent="createCategory">
      <input v-model="newCategoryName" aria-label="分类名称" placeholder="分类名称" />
      <button type="submit" class="icon-button" aria-label="保存分类"><Check :size="16" aria-hidden="true" /></button>
      <button type="button" class="icon-button" aria-label="取消新增分类" @click="creatingCategory = false"><X :size="16" aria-hidden="true" /></button>
    </form>

    <PageStateBlock v-if="loading" kind="loading" title="正在加载清单..." />
    <PageStateBlock v-else-if="error" kind="error" :title="formatDisplayError(error)" @action="load" />
    <section v-else-if="tasks.length > 0 || categories.length > 0" class="task-sections">
      <div v-for="section in categorySections" :key="section.id" class="task-section">
        <button
          type="button"
          class="task-section__header"
          :draggable="Boolean(section.category)"
          :class="{ 'is-selected': selectedCategoryId === (section.category?.id ?? null) }"
          :aria-expanded="!isSectionCollapsed(section.id)"
          :aria-controls="`task-section-${section.id}`"
          @dragstart="onCategoryDragStart(section.category)"
          @dragover.prevent
          @drop="onCategoryDrop(section.category)"
          @click="toggleSection(section)"
        >
          <span class="task-section__title">
            <ChevronRight v-if="isSectionCollapsed(section.id)" :size="16" aria-hidden="true" />
            <ChevronDown v-else :size="16" aria-hidden="true" />
            <template v-if="editingCategoryId === section.category?.id">
              <input v-model="editingCategoryName" :aria-label="`重命名分类 ${section.name}`" @click.stop />
            </template>
            <span v-else>{{ section.name }}</span>
          </span>
          <span class="task-section__tools" @click.stop>
            <span class="task-section__count">{{ section.tasks.length }}</span>
            <template v-if="section.category">
              <button
                v-if="editingCategoryId === section.category.id"
                type="button"
                class="icon-button"
                :aria-label="`保存分类 ${section.name}`"
                @click="saveCategory(section.category)"
              >
                <Check :size="14" aria-hidden="true" />
              </button>
              <button
                v-else
                type="button"
                class="icon-button"
                :aria-label="`重命名分类 ${section.name}`"
                @click="beginRenameCategory(section.category)"
              >
                <Pencil :size="14" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="icon-button icon-button--danger"
                :aria-label="`删除分类 ${section.name}`"
                @click="removeCategory(section.category)"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </button>
            </template>
          </span>
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
            draggable="true"
            @dragstart="onTaskDragStart(task)"
            @dragover.prevent
            @drop="onTaskDrop(task, section)"
          >
            <label class="task-row__select">
              <input
                type="checkbox"
                :checked="selection.has(task.id)"
                :aria-label="`选择 ${task.title}`"
                @change="selection.toggle(task.id, ($event.target as HTMLInputElement).checked)"
              />
            </label>
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
    <PageStateBlock v-else kind="empty" title="这个清单暂无任务。" />

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
.quick-add {
  position: sticky;
  top: 0;
  z-index: 2;
}

.list-toolbar {
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

.list-toolbar__left,
.list-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.list-toolbar__left strong {
  color: var(--text);
}

.category-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px 32px;
  gap: 6px;
  margin-bottom: 10px;
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
.task-section__count,
.task-section__tools {
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

.task-section__title input {
  height: 26px;
  min-width: 160px;
}

.task-section__tools {
  gap: 4px;
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
  grid-template-columns: 28px 34px minmax(0, 1fr);
  align-items: start;
  min-height: 46px;
  border-radius: 6px;
}

.task-row__select {
  width: 28px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
