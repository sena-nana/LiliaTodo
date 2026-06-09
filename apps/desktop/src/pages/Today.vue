<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Check, Loader2, Plus, RefreshCw } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import type { Task, TodayTaskGroups } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";
import { buildEditableContextMenuItems, useContextMenu } from "../components/contextMenu";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";

const contextMenu = useContextMenu();
function onEditableContextMenu(event: MouseEvent) {
  contextMenu.show(event, buildEditableContextMenuItems(event));
}

const repository = useTaskRepository();
const groups = ref<TodayTaskGroups>({
  overdue: [],
  dueToday: [],
  completedToday: [],
});
const title = ref("");
const destination = ref<"today" | "inbox">("today");
const dueAtInput = ref("");
const estimateInput = ref("");
const loading = ref(true);
const quickAddSaving = ref(false);
const error = ref<string | null>(null);
const allVisibleTasks = computed(() => [
  ...groups.value.overdue,
  ...groups.value.dueToday,
  ...groups.value.completedToday,
]);
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
  deleteTask,
  closeTask,
} = useTaskDetailDrawer({
  repository,
  reload: load,
  getParentCandidates: () => allVisibleTasks.value,
});

onMounted(() => {
  void load();
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    groups.value = await repository.listToday(new Date());
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function onQuickAdd() {
  if (!title.value.trim()) return;
  quickAddSaving.value = true;
  error.value = null;
  try {
    await repository.createTask({
      title: title.value,
      dueAt:
        destination.value === "today"
          ? dueAtInputToIso(dueAtInput.value) ?? defaultTodayDueAt()
          : null,
      estimateMin: estimateInputToNumber(estimateInput.value),
    });
    title.value = "";
    dueAtInput.value = "";
    estimateInput.value = "";
    await load();
  } catch (e) {
    error.value = String(e);
  } finally {
    quickAddSaving.value = false;
  }
}

function dueAtInputToIso(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function estimateInputToNumber(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function defaultTodayDueAt() {
  const due = new Date();
  due.setHours(12, 0, 0, 0);
  return due.toISOString();
}

function formatDateTime(value: string | null) {
  if (!value) return "无时间";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function displayError(value: string) {
  return value.replace(/^Error:\s*/, "错误：");
}
</script>

<template>
  <section class="page">
    <form class="quick-add" @submit.prevent="onQuickAdd">
      <label class="sr-only" for="today-quick-add">快速添加任务</label>
      <div class="row">
        <input
          id="today-quick-add"
          v-model="title"
          placeholder="添加今日任务"
          @contextmenu="onEditableContextMenu"
        />
        <label class="sr-only" for="task-destination">任务归属</label>
        <select id="task-destination" v-model="destination">
          <option value="today">今日</option>
          <option value="inbox">收件箱</option>
        </select>
        <label class="sr-only" for="task-due-at">任务截止时间</label>
        <input
          id="task-due-at"
          v-model="dueAtInput"
          type="datetime-local"
          :disabled="destination === 'inbox'"
          @contextmenu="onEditableContextMenu"
        />
        <label class="sr-only" for="task-estimate">任务估时分钟</label>
        <input
          id="task-estimate"
          v-model="estimateInput"
          class="estimate-input"
          type="number"
          min="1"
          step="1"
          placeholder="min"
          @contextmenu="onEditableContextMenu"
        />
        <button class="primary" type="submit" :disabled="quickAddSaving || !title.trim()">
          <Plus :size="16" aria-hidden="true" />
          {{ destination === "today" ? "添加到今日" : "添加任务" }}
        </button>
      </div>
    </form>

    <div v-if="loading" class="card state">
      <Loader2 class="spin" :size="18" aria-hidden="true" />
      <p>正在加载本地任务...</p>
    </div>
    <div v-if="error" class="card state state--error">
      <p>{{ displayError(error) }}</p>
      <button type="button" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />
        重试
      </button>
    </div>

    <div v-if="!loading && !error" class="task-grid">
      <section class="card task-section">
        <div class="section-title">
          <h2>已逾期</h2>
        </div>
        <p v-if="groups.overdue.length === 0" class="empty-text">暂无内容。</p>
        <ul v-else class="task-list">
          <li v-for="task in groups.overdue" :key="task.id" class="task-item task-item--clickable" @click="openTask(task)">
            <span class="task-title is-danger">{{ task.title }}</span>
            <span class="task-meta">
              {{ formatDateTime(task.dueAt ?? task.completedAt) }}
              <template v-if="taskHasDueReminder(task)"> · 提醒已到</template>
            </span>
          </li>
        </ul>
      </section>

      <section class="card task-section">
        <div class="section-title">
          <h2>今日到期</h2>
        </div>
        <p v-if="groups.dueToday.length === 0" class="empty-text">暂无内容。</p>
        <ul v-else class="task-list">
          <li v-for="task in groups.dueToday" :key="task.id" class="task-item task-item--clickable" @click="openTask(task)">
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              {{ formatDateTime(task.startAt ?? task.dueAt ?? task.completedAt) }}
              <template v-if="taskHasDueReminder(task)"> · 提醒已到</template>
            </span>
          </li>
        </ul>
      </section>

      <section class="card task-section">
        <div class="section-title">
          <h2>今日完成</h2>
          <Check :size="16" aria-hidden="true" />
        </div>
        <p v-if="groups.completedToday.length === 0" class="empty-text">
          暂无内容。
        </p>
        <ul v-else class="task-list">
          <li
            v-for="task in groups.completedToday"
            :key="task.id"
            class="task-item"
            @click="openTask(task)"
          >
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              {{ formatDateTime(task.dueAt ?? task.completedAt) }}
            </span>
          </li>
        </ul>
      </section>
    </div>
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
      @delete="deleteTask"
      @open-task="openTask"
    />
  </section>
</template>
