<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowDown, ArrowUp, Check, FolderPlus, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { onTaskListsChanged } from "../data/taskListEvents";
import { useLatestAsyncRun } from "../composables/useLatestAsyncRun";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useTaskListActions } from "../composables/useTaskListActions";
import { compareByOrder, moveItemById } from "../domain/order";
import type { Task, TaskCategory } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";

const route = useRoute();
const repository = useTaskRepository();
const listId = computed(() => String(route.params.listId ?? "inbox"));
const tasks = ref<Task[]>([]);
const categories = ref<TaskCategory[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const selectedCategoryId = ref<string | null>(null);
const creatingCategory = ref(false);
const newCategoryName = ref("");
const editingCategoryId = ref<string | null>(null);
const editingCategoryName = ref("");
const loadRuns = useLatestAsyncRun();
const {
  selectedTask,
  childTasks,
  lists,
  saving,
  drawerError,
  parentCandidates,
  categories: drawerCategories,
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
  newCategoryName.value = "";
  creatingCategory.value = false;
  editingCategoryId.value = null;
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
      drawerCategories.value = nextCategories;
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

async function createCategory() {
  if (!newCategoryName.value.trim()) return;
  await runCategoryMutation(async () => {
    const category = await repository.createCategory({ listId: listId.value, name: newCategoryName.value });
    selectedCategoryId.value = category.id;
    newCategoryName.value = "";
    creatingCategory.value = false;
  });
}

function beginRenameCategory(category: TaskCategory) {
  editingCategoryId.value = category.id;
  editingCategoryName.value = category.name;
}

async function saveCategoryRename(category: TaskCategory) {
  if (!editingCategoryName.value.trim()) return;
  await runCategoryMutation(async () => {
    await repository.updateCategory(category.id, { name: editingCategoryName.value });
    editingCategoryId.value = null;
  });
}

async function deleteCategory(category: TaskCategory) {
  await runCategoryMutation(async () => {
    await repository.deleteCategory(category.id);
    if (selectedCategoryId.value === category.id) selectedCategoryId.value = null;
  });
}

async function moveCategory(category: TaskCategory, direction: -1 | 1) {
  const reordered = moveItemById(sortedCategories.value, category.id, direction);
  if (!reordered) return;
  await runCategoryMutation(() => Promise.all(
    reordered.map((nextCategory, order) => repository.updateCategory(nextCategory.id, { order })),
  ));
}

async function moveTaskToCategory(task: Task, categoryId: string | null) {
  await runCategoryMutation(() => repository.updateTask(task.id, { categoryId }));
}

async function runCategoryMutation(mutation: () => Promise<unknown>) {
  error.value = null;
  try {
    await mutation();
    await load();
  } catch (e) {
    error.value = String(e);
  }
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
    <section class="category-panel">
      <div class="category-panel__header">
        <div class="category-tabs" aria-label="清单分类">
          <button
            type="button"
            :class="{ 'is-active': selectedCategoryId === null }"
            @click="selectedCategoryId = null"
          >
            未分类
          </button>
          <button
            v-for="category in sortedCategories"
            :key="category.id"
            type="button"
            :class="{ 'is-active': selectedCategoryId === category.id }"
            @click="selectedCategoryId = category.id"
          >
            {{ category.name }}
          </button>
        </div>
        <button type="button" class="icon-button" aria-label="新增分类" @click="creatingCategory = true">
          <FolderPlus :size="16" aria-hidden="true" />
        </button>
      </div>
      <form v-if="creatingCategory" class="category-form" @submit.prevent="createCategory">
        <input v-model="newCategoryName" aria-label="分类名称" placeholder="分类名称" />
        <button type="submit" aria-label="保存分类"><Check :size="15" aria-hidden="true" /></button>
        <button type="button" aria-label="取消新增分类" @click="creatingCategory = false"><X :size="15" aria-hidden="true" /></button>
      </form>
      <div v-if="sortedCategories.length > 0" class="category-admin">
        <div v-for="category in sortedCategories" :key="category.id" class="category-admin__row">
          <form v-if="editingCategoryId === category.id" class="category-form category-form--inline" @submit.prevent="saveCategoryRename(category)">
            <input v-model="editingCategoryName" :aria-label="`重命名分类 ${category.name}`" />
            <button type="submit" :aria-label="`保存分类 ${category.name}`"><Check :size="15" aria-hidden="true" /></button>
            <button type="button" :aria-label="`取消分类 ${category.name}`" @click="editingCategoryId = null"><X :size="15" aria-hidden="true" /></button>
          </form>
          <template v-else>
            <span>{{ category.name }}</span>
            <button type="button" class="icon-button" :aria-label="`上移分类 ${category.name}`" @click="moveCategory(category, -1)">
              <ArrowUp :size="15" aria-hidden="true" />
            </button>
            <button type="button" class="icon-button" :aria-label="`下移分类 ${category.name}`" @click="moveCategory(category, 1)">
              <ArrowDown :size="15" aria-hidden="true" />
            </button>
            <button type="button" class="icon-button" :aria-label="`重命名分类 ${category.name}`" @click="beginRenameCategory(category)">
              <Pencil :size="15" aria-hidden="true" />
            </button>
            <button type="button" class="icon-button icon-button--danger" :aria-label="`删除分类 ${category.name}`" @click="deleteCategory(category)">
              <Trash2 :size="15" aria-hidden="true" />
            </button>
          </template>
        </div>
      </div>
    </section>
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
    <section v-if="!loading && !error && tasks.length > 0" class="task-sections">
      <div v-for="section in categorySections" :key="section.id" class="task-section">
        <div class="task-section__header">
          <h2>{{ section.name }}</h2>
        </div>
        <p v-if="section.tasks.length === 0" class="empty-text">暂无任务。</p>
        <ul v-else class="task-list task-list--roomy">
          <li v-for="task in section.tasks" :key="task.id" class="task-item task-item--actions task-item--clickable" @click="openTask(task)">
            <div class="task-copy">
              <span class="task-title">{{ task.title }}</span>
              <span v-if="task.notes" class="task-meta">{{ task.notes }}</span>
              <span v-if="taskHasDueReminder(task)" class="task-meta">提醒已到</span>
              <span v-if="task.priority > 0" class="task-badge">P{{ task.priority }}</span>
            </div>
            <div class="task-actions" @click.stop>
              <select class="task-category-select" :aria-label="`移动任务 ${task.title} 到分类`" :value="task.categoryId ?? ''" @change="moveTaskToCategory(task, ($event.target as HTMLSelectElement).value || null)">
                <option value="">未分类</option>
                <option v-for="category in sortedCategories" :key="category.id" :value="category.id">{{ category.name }}</option>
              </select>
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
      </div>
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
.category-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.category-panel__header,
.category-admin__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-panel__header {
  justify-content: space-between;
}

.category-tabs {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 4px;
  overflow-x: auto;
}

.category-tabs button {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 10px;
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.category-tabs button.is-active {
  color: var(--accent);
  background: var(--accent-soft);
}

.category-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px 32px;
  gap: 6px;
}

.category-form--inline {
  flex: 1;
}

.category-admin {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--border-soft);
  padding-top: 8px;
}

.category-admin__row {
  min-height: 32px;
}

.category-admin__row span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-section {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.task-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.task-section__header h2 {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.task-category-select {
  width: 112px;
  height: 30px;
  padding: 3px 6px;
  font-size: 12px;
}
</style>
