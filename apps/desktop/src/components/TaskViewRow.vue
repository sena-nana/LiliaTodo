<script setup lang="ts">
import { Check, Pencil, Trash2 } from "lucide-vue-next";
import type { Task } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";

const props = withDefaults(defineProps<{
  task: Task;
  variant?: "list" | "timeline";
}>(), {
  variant: "list",
});

const emit = defineEmits<{
  open: [task: Task];
  complete: [task: Task];
  delete: [task: Task];
}>();

function taskTimelineTime(task: Task) {
  return task.startAt ?? task.dueAt ?? task.createdAt;
}

function formatTaskTime(value: string | null) {
  if (!value) return "无时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
</script>

<template>
  <li
    v-if="variant === 'list'"
    class="task-item task-item--actions task-item--clickable"
    @click="emit('open', task)"
  >
    <div class="task-copy">
      <span class="task-title">{{ task.title }}</span>
      <span v-if="task.notes" class="task-meta">{{ task.notes }}</span>
      <span class="task-meta">
        <template v-if="task.startAt">开始 {{ formatTaskTime(task.startAt) }}</template>
        <template v-if="task.dueAt"> 截止 {{ formatTaskTime(task.dueAt) }}</template>
        <template v-if="taskHasDueReminder(task)"> 提醒已到</template>
      </span>
      <span v-if="task.priority > 0" class="task-badge">P{{ task.priority }}</span>
    </div>
    <div class="task-actions" @click.stop>
      <button type="button" class="icon-button" :aria-label="`完成 ${task.title}`" @click="emit('complete', task)">
        <Check :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="icon-button" :aria-label="`编辑 ${task.title}`" @click="emit('open', task)">
        <Pencil :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="icon-button icon-button--danger" :aria-label="`删除 ${task.title}`" @click="emit('delete', task)">
        <Trash2 :size="16" aria-hidden="true" />
      </button>
    </div>
  </li>

  <li
    v-else
    class="timeline__item task-item--clickable"
    @click="emit('open', task)"
  >
    <time :datetime="taskTimelineTime(task)">{{ formatTaskTime(taskTimelineTime(task)) }}</time>
    <div class="global-timeline__content">
      <div>
        <b>{{ task.title }}</b>
        <p v-if="task.notes">{{ task.notes }}</p>
        <p>
          <template v-if="task.startAt">开始 {{ formatTaskTime(task.startAt) }}</template>
          <template v-if="task.dueAt"> 截止 {{ formatTaskTime(task.dueAt) }}</template>
          <template v-if="!task.startAt && !task.dueAt">创建 {{ formatTaskTime(task.createdAt) }}</template>
          <template v-if="taskHasDueReminder(task)"> 提醒已到</template>
        </p>
      </div>
      <div class="task-actions" @click.stop>
        <span v-if="task.priority > 0" class="task-badge">P{{ task.priority }}</span>
        <button type="button" class="icon-button" :aria-label="`完成 ${task.title}`" @click="emit('complete', task)">
          <Check :size="16" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button" :aria-label="`编辑 ${task.title}`" @click="emit('open', task)">
          <Pencil :size="16" aria-hidden="true" />
        </button>
        <button type="button" class="icon-button icon-button--danger" :aria-label="`删除 ${task.title}`" @click="emit('delete', task)">
          <Trash2 :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>
  </li>
</template>

<style scoped>
.global-timeline__content {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.global-timeline__content > div:first-child {
  min-width: 0;
}

.global-timeline__content .task-actions {
  align-items: center;
}

@media (max-width: 900px) {
  .global-timeline__content {
    flex-direction: column;
  }
}
</style>
