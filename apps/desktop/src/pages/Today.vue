<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Check, Plus } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import { useTaskListActions } from "../composables/useTaskListActions";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts";
import type { TodayTaskGroups } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";
import {
  applyTemplateToCreateInput,
  createTaskTemplate,
  loadTaskTemplates,
  saveTaskTemplates,
  type TaskTemplate,
} from "../domain/taskTemplates";
import { buildEditableContextMenuItems, useContextMenu } from "../components/contextMenu";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import PageStateBlock from "../components/PageStateBlock.vue";
import { formatDisplayError } from "../utils/errors";

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
const quickAddInput = ref<HTMLInputElement | null>(null);
const destination = ref<"today" | "inbox">("today");
const dueAtInput = ref("");
const estimateInput = ref("");
const selectedTemplateId = ref("");
const templateName = ref("");
const templateTags = ref("");
const templateChecklist = ref("");
const templateReminderOffset = ref("");
const templates = ref<TaskTemplate[]>([]);
const loading = ref(true);
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
  reorderChildTasks,
  closeTask,
} = useTaskDetailDrawer({
  repository,
  reload: load,
  getParentCandidates: () => allVisibleTasks.value,
});
const { newTitle: title, quickAddSaving, createTask: onQuickAdd } = useTaskListActions({
  repository,
  tasks: allVisibleTasks,
  reload: load,
  listId: () => "inbox",
  buildCreateInput: (taskTitle) => ({
    ...buildCreateInputFromTemplate(taskTitle),
  }),
  reset: () => {
    dueAtInput.value = "";
    estimateInput.value = "";
    selectedTemplateId.value = "";
  },
  setError: (value) => {
    error.value = value;
  },
});

onMounted(() => {
  templates.value = loadTaskTemplates(window.localStorage);
  void load();
});

useGlobalShortcuts({
  n: () => quickAddInput.value?.focus(),
  o: () => {
    const task = selectedTask.value ?? allVisibleTasks.value[0];
    if (task) void openTask(task);
  },
  x: () => {
    const task = selectedTask.value ?? allVisibleTasks.value[0];
    if (task) void completeTask(task);
  },
  delete: () => {
    const task = selectedTask.value ?? allVisibleTasks.value[0];
    if (task) void deleteTask(task);
  },
});

function buildCreateInputFromTemplate(taskTitle: string) {
  const base = {
    title: taskTitle,
    dueAt:
      destination.value === "today"
        ? dueAtInputToIso(dueAtInput.value) ?? defaultTodayDueAt()
        : null,
    estimateMin: estimateInputToNumber(estimateInput.value),
  };
  const template = templates.value.find((item) => item.id === selectedTemplateId.value);
  return template ? applyTemplateToCreateInput(template, base) : base;
}

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

function dueAtInputToIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("任务截止时间不合法");
  }
  return date.toISOString();
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

function applyTemplate() {
  const template = templates.value.find((item) => item.id === selectedTemplateId.value);
  if (!template) return;
  title.value = template.title;
  estimateInput.value = template.estimateMin ? String(template.estimateMin) : "";
}

function saveTemplate() {
  error.value = null;
  try {
    const nextTemplate = createTaskTemplate({
      name: templateName.value,
      title: title.value,
      estimateMin: estimateInputToNumber(estimateInput.value),
      tags: parseTemplateTags(templateTags.value),
      checklist: parseTemplateChecklist(templateChecklist.value),
      reminderOffsetMin: estimateInputToNumber(templateReminderOffset.value),
    });
    templates.value = [
      ...templates.value.filter((item) => item.name !== nextTemplate.name),
      nextTemplate,
    ];
    saveTaskTemplates(window.localStorage, templates.value);
    selectedTemplateId.value = nextTemplate.id;
    templateName.value = "";
    templateTags.value = "";
    templateChecklist.value = "";
    templateReminderOffset.value = "";
  } catch (e) {
    error.value = String(e);
  }
}

function parseTemplateTags(value: string) {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

function parseTemplateChecklist(value: string) {
  return value.split(/[|｜\n]/).map((title) => title.trim()).filter(Boolean).map((title, index) => ({
    id: `check-${index}`,
    title,
    done: false,
    order: index,
  }));
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

</script>

<template>
  <section class="page">
    <form class="quick-add" @submit.prevent="onQuickAdd">
      <label class="sr-only" for="today-quick-add">快速添加任务</label>
      <div class="row">
        <input
          ref="quickAddInput"
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
      <div class="template-row">
        <label class="sr-only" for="task-template">任务模板</label>
        <select id="task-template" v-model="selectedTemplateId" aria-label="任务模板" @change="applyTemplate">
          <option value="">选择模板</option>
          <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
        </select>
        <label class="sr-only" for="task-template-name">模板名称</label>
        <input id="task-template-name" v-model="templateName" aria-label="模板名称" placeholder="保存为模板" />
        <label class="sr-only" for="task-template-tags">模板标签</label>
        <input id="task-template-tags" v-model="templateTags" aria-label="模板标签" placeholder="标签，逗号分隔" />
        <label class="sr-only" for="task-template-checklist">模板检查项</label>
        <input id="task-template-checklist" v-model="templateChecklist" aria-label="模板检查项" placeholder="检查项，用 | 分隔" />
        <label class="sr-only" for="task-template-reminder">提醒提前分钟</label>
        <input id="task-template-reminder" v-model="templateReminderOffset" aria-label="提醒提前分钟" class="template-row__number" type="number" min="0" step="1" placeholder="提前 min" />
        <button type="button" @click="saveTemplate">保存模板</button>
      </div>
    </form>

    <PageStateBlock v-if="loading" kind="loading" title="正在加载本地任务..." />
    <PageStateBlock v-else-if="error" kind="error" :title="formatDisplayError(error)" @action="load" />

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
      @reorder-children="reorderChildTasks"
    />
  </section>
</template>

<style scoped>
.template-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.template-row select {
  min-width: 160px;
}

.template-row input {
  flex: 1;
  min-width: 160px;
}

.template-row .template-row__number {
  flex: 0 0 112px;
  min-width: 112px;
}
</style>
