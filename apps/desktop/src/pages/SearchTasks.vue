<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Search } from "lucide-vue-next";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import PageStateBlock from "../components/PageStateBlock.vue";
import TaskBulkToolbar from "../components/TaskBulkToolbar.vue";
import TaskTableRow from "../components/TaskTableRow.vue";
import { useBulkSelection } from "../composables/useBulkSelection";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts";
import { useTaskBulkActions } from "../composables/useTaskBulkActions";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { formatDisplayError } from "../utils/errors";
import type { Task, TaskPriority, TaskSearchReminderStatus, TaskSearchTimeMode, TaskStatus } from "../domain/tasks";
import {
  builtInSavedTaskViews,
  createSavedTaskView,
  loadSavedTaskViews,
  saveTaskViews,
  type SavedTaskView,
  type SavedTaskViewQuery,
} from "../domain/savedTaskViews";

const repository = useTaskRepository();
const route = useRoute();
const searchInput = ref<HTMLInputElement | null>(null);
const keyword = ref("");
const status = ref<TaskStatus | "all">("all");
const tagText = ref("");
const listId = ref("");
const categoryId = ref("");
const priority = ref<TaskPriority | "all">("all");
const timeMode = ref<TaskSearchTimeMode>("all");
const timeFrom = ref("");
const timeTo = ref("");
const reminderStatus = ref<TaskSearchReminderStatus | "all">("all");
const includeDeleted = ref(false);
const selectedViewId = ref("");
const newViewName = ref("");
const savedViews = ref<SavedTaskView[]>([]);
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
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
  deleteTask,
  reorderChildTasks,
  closeTask,
} = useTaskDetailDrawer({
  repository,
  reload: load,
  getParentCandidates: () => tasks.value,
});

const title = computed(() => `搜索结果 ${tasks.value.length} 条`);
const allSavedViews = computed(() => [
  ...builtInSavedTaskViews(),
  ...savedViews.value,
]);
const selectedView = computed(() => allSavedViews.value.find((view) => view.id === selectedViewId.value) ?? null);
const filteredCategories = computed(() =>
  categories.value.filter((category) => !listId.value || category.listId === listId.value),
);
const { applyBulk } = useTaskBulkActions({
  repository,
  selection,
  reload: load,
  setError: (value) => {
    error.value = value;
  },
});

onMounted(() => {
  savedViews.value = loadSavedTaskViews(window.localStorage);
  void load();
});

watch(() => route.query.taskId, () => {
  void openTaskFromRoute();
});

useGlobalShortcuts({
  n: () => searchInput.value?.focus(),
  "/": () => searchInput.value?.focus(),
  o: () => {
    const task = selectedTask.value ?? tasks.value.find((task) => selection.has(task.id)) ?? tasks.value[0];
    if (task) void openTask(task);
  },
  x: () => {
    const task = selectedTask.value ?? tasks.value.find((task) => selection.has(task.id)) ?? tasks.value[0];
    if (task) void completeTask(task);
  },
  delete: () => {
    if (selection.selectedCount.value > 0) {
      void applyBulk({ type: "delete" });
      return;
    }
    const task = selectedTask.value ?? tasks.value[0];
    if (task) void deleteTask(task);
  },
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    if (lists.value.length === 0) {
      lists.value = await repository.listLists();
    }
    const categoryLists = listId.value ? [listId.value] : lists.value.map((list) => list.id);
    const nextCategories = (await Promise.all(categoryLists.map((id) => repository.listCategoriesByList(id)))).flat();
    categories.value = nextCategories;
    if (categoryId.value && !nextCategories.some((category) => category.id === categoryId.value)) {
      categoryId.value = "";
    }
    const fromIso = parseSearchDateTime(timeFrom.value, "筛选开始时间");
    const toIso = parseSearchDateTime(timeTo.value, "筛选结束时间");
    tasks.value = await repository.searchTasks({
      text: keyword.value,
      tags: tagText.value.split(",").map((tag) => tag.trim()).filter(Boolean),
      listId: listId.value || null,
      categoryId: categoryId.value || null,
      statuses: status.value === "all" ? undefined : [status.value],
      priorities: priority.value === "all" ? undefined : [priority.value],
      timeMode: timeMode.value === "all" ? null : timeMode.value,
      timeFrom: fromIso,
      timeTo: toIso,
      reminderStatus: reminderStatus.value === "all" ? null : reminderStatus.value,
      includeDeleted: includeDeleted.value,
    });
    await openTaskFromRoute();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function saveCurrentView() {
  error.value = null;
  try {
    const nextView = createSavedTaskView(newViewName.value, currentSavedQuery());
    savedViews.value = [
      ...savedViews.value.filter((view) => view.name !== nextView.name),
      nextView,
    ];
    saveTaskViews(window.localStorage, savedViews.value);
    selectedViewId.value = nextView.id;
    newViewName.value = "";
  } catch (e) {
    error.value = String(e);
  }
}

async function applySavedView() {
  if (!selectedView.value) return;
  applySavedQuery(selectedView.value.query);
  selection.clear();
  await load();
}

function deleteSavedView() {
  const view = selectedView.value;
  if (!view || view.builtIn) return;
  savedViews.value = savedViews.value.filter((item) => item.id !== view.id);
  selectedViewId.value = "";
  saveTaskViews(window.localStorage, savedViews.value);
}

function currentSavedQuery(): SavedTaskViewQuery {
  return {
    keyword: keyword.value,
    status: status.value,
    tagText: tagText.value,
    listId: listId.value,
    categoryId: categoryId.value,
    priority: priority.value,
    timeMode: timeMode.value,
    timeFrom: timeFrom.value,
    timeTo: timeTo.value,
    reminderStatus: reminderStatus.value,
    includeDeleted: includeDeleted.value,
  };
}

function applySavedQuery(query: SavedTaskViewQuery) {
  keyword.value = query.keyword;
  status.value = query.status;
  tagText.value = query.tagText;
  listId.value = query.listId;
  categoryId.value = query.categoryId;
  priority.value = query.priority;
  timeMode.value = query.timeMode;
  timeFrom.value = query.timeFrom;
  timeTo.value = query.timeTo;
  reminderStatus.value = query.reminderStatus;
  includeDeleted.value = query.includeDeleted;
}

async function openTaskFromRoute() {
  const taskId = Array.isArray(route.query.taskId) ? route.query.taskId[0] : route.query.taskId;
  if (!taskId || selectedTask.value?.id === taskId) return;
  const task = tasks.value.find((item) => item.id === taskId) ?? await repository.findTaskById(taskId);
  if (task) await openTask(task);
}

function parseSearchDateTime(value: string, label: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label}不合法`);
  }
  return date.toISOString();
}

</script>

<template>
  <section class="page">
    <section class="task-toolbar">
      <div class="task-toolbar__left">
        <Search :size="16" aria-hidden="true" />
        <input ref="searchInput" v-model="keyword" aria-label="搜索任务" placeholder="搜索标题、备注、标签" @input="load" />
        <select v-model="status" aria-label="筛选状态" @change="load">
          <option value="all">全部状态</option>
          <option value="active">进行中</option>
          <option value="completed">已完成</option>
          <option value="archived">已归档</option>
        </select>
        <input v-model="tagText" aria-label="筛选标签" placeholder="标签，逗号分隔" @input="load" />
        <select v-model="listId" aria-label="筛选清单" @change="load">
          <option value="">全部清单</option>
          <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
        </select>
        <select v-model="categoryId" aria-label="筛选分类" @change="load">
          <option value="">全部分类</option>
          <option v-for="category in filteredCategories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
        <select v-model="priority" aria-label="筛选优先级" @change="load">
          <option value="all">全部优先级</option>
          <option :value="0">P0</option>
          <option :value="1">P1</option>
          <option :value="2">P2</option>
          <option :value="3">P3</option>
        </select>
        <select v-model="timeMode" aria-label="筛选计划状态" @change="load">
          <option value="all">全部计划</option>
          <option value="scheduled">已有时间</option>
          <option value="unscheduled">无计划</option>
        </select>
        <input v-model="timeFrom" type="datetime-local" aria-label="筛选开始时间" @change="load" />
        <input v-model="timeTo" type="datetime-local" aria-label="筛选结束时间" @change="load" />
        <select v-model="reminderStatus" aria-label="筛选提醒状态" @change="load">
          <option value="all">全部提醒</option>
          <option value="none">无提醒</option>
          <option value="pending">待提醒</option>
          <option value="due">提醒已到</option>
          <option value="fired">已通知</option>
          <option value="dismissed">已关闭</option>
        </select>
        <label class="task-toolbar__check">
          <input v-model="includeDeleted" type="checkbox" @change="load" />
          含最近删除
        </label>
      </div>
      <div class="task-toolbar__right">
        <span>{{ title }}</span>
      </div>
    </section>
    <section class="saved-view-toolbar" aria-label="智能视图">
      <select v-model="selectedViewId" aria-label="已保存视图">
        <option value="">选择视图</option>
        <option v-for="view in allSavedViews" :key="view.id" :value="view.id">
          {{ view.builtIn ? "内置：" : "" }}{{ view.name }}
        </option>
      </select>
      <button type="button" :disabled="!selectedViewId" @click="applySavedView">应用视图</button>
      <button type="button" class="ghost danger" :disabled="!selectedView || selectedView.builtIn" @click="deleteSavedView">删除视图</button>
      <input v-model="newViewName" aria-label="视图名称" placeholder="保存当前筛选为视图" />
      <button type="button" class="primary" @click="saveCurrentView">保存视图</button>
    </section>
    <TaskBulkToolbar
      v-if="selection.selectedCount.value > 0"
      :selected-count="selection.selectedCount.value"
      :lists="lists"
      :categories="categories"
      :current-list-id="listId || null"
      @apply="applyBulk"
      @clear="selection.clear"
    />

    <PageStateBlock v-if="loading" kind="loading" title="正在搜索任务..." />
    <PageStateBlock v-else-if="error" kind="error" :title="formatDisplayError(error)" @action="load" />
    <PageStateBlock v-else-if="tasks.length === 0" kind="empty" title="没有匹配的任务。" />
    <ul v-else class="task-table">
      <TaskTableRow
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        selectable
        :checked="selection.has(task.id)"
        :selected="selectedTask?.id === task.id"
        @toggle="(_, checked) => selection.toggle(task.id, checked)"
        @open="openTask"
        @complete="completeTask"
        @delete="deleteTask"
      />
    </ul>

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
      @delete="deleteTask"
      @open-task="openTask"
      @reorder-children="reorderChildTasks"
    />
  </section>
</template>

<style scoped>
.task-toolbar {
  min-height: 42px;
  padding: 6px 10px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.task-toolbar__left,
.task-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-toolbar__left {
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}

.task-toolbar__left input {
  width: 150px;
}

.task-toolbar__left input[aria-label="搜索任务"] {
  min-width: 220px;
  flex: 1;
}

.task-toolbar__check {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.task-toolbar__check input {
  width: auto;
}

.task-toolbar__right {
  color: var(--text-muted);
  font-size: 12px;
}

.task-table {
  list-style: none;
  padding: 0 12px;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.saved-view-toolbar {
  min-height: 42px;
  padding: 6px 10px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.saved-view-toolbar select {
  min-width: 180px;
}

.saved-view-toolbar input {
  min-width: 220px;
  flex: 1;
}

@media (max-width: 900px) {
  .saved-view-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .saved-view-toolbar select,
  .saved-view-toolbar input,
  .saved-view-toolbar button {
    width: 100%;
  }
}
</style>
