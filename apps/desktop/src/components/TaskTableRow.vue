<script setup lang="ts">
import { Check, GripVertical, Pencil, RotateCcw, Trash2 } from "lucide-vue-next";
import type { Task } from "../domain/tasks";
import { taskHasDueReminder } from "../domain/tasks";

const props = withDefaults(defineProps<{
  task: Task;
  selected?: boolean;
  selectable?: boolean;
  checked?: boolean;
  showMove?: boolean;
  draggableRow?: boolean;
  deletedMode?: boolean;
}>(), {
  selected: false,
  selectable: false,
  checked: false,
  showMove: false,
  draggableRow: false,
  deletedMode: false,
});

const emit = defineEmits<{
  open: [task: Task];
  complete: [task: Task];
  delete: [task: Task];
  restore: [task: Task];
  purge: [task: Task];
  toggle: [task: Task, checked: boolean];
  moveUp: [task: Task];
  moveDown: [task: Task];
  dragStart: [task: Task];
  dropOn: [task: Task];
}>();

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
</script>

<template>
  <li
    class="task-table-row"
    :class="{ 'is-selected': selected, 'is-draggable': draggableRow }"
    :draggable="draggableRow"
    @dragstart="emit('dragStart', task)"
    @dragover.prevent
    @drop="emit('dropOn', task)"
  >
    <span v-if="draggableRow" class="task-table-row__drag" aria-hidden="true">
      <GripVertical :size="15" />
    </span>
    <label v-if="selectable" class="task-table-row__check">
      <input
        type="checkbox"
        :checked="checked"
        :aria-label="`选择 ${task.title}`"
        @change="emit('toggle', task, ($event.target as HTMLInputElement).checked)"
      />
    </label>
    <button type="button" class="task-table-row__open" :aria-label="`打开任务 ${task.title}`" @click="emit('open', task)">
      <span class="task-table-row__title">{{ task.title }}</span>
      <span class="task-table-row__meta">
        <span v-if="task.notes">{{ task.notes }}</span>
        <span v-if="task.startAt">开始 {{ formatDateTime(task.startAt) }}</span>
        <span v-if="task.dueAt">截止 {{ formatDateTime(task.dueAt) }}</span>
        <span v-if="task.priority > 0">P{{ task.priority }}</span>
        <span v-if="taskHasDueReminder(task)">提醒已到</span>
        <span v-if="task.recurrence">重复 {{ task.recurrence.interval }}{{ task.recurrence.unit === "day" ? "天" : task.recurrence.unit === "week" ? "周" : "月" }}</span>
      </span>
    </button>
    <div class="task-table-row__actions" @click.stop>
      <button v-if="!deletedMode" type="button" class="icon-button" :aria-label="`完成 ${task.title}`" @click="emit('complete', task)">
        <Check :size="16" aria-hidden="true" />
      </button>
      <button v-if="!deletedMode" type="button" class="icon-button" :aria-label="`编辑 ${task.title}`" @click="emit('open', task)">
        <Pencil :size="16" aria-hidden="true" />
      </button>
      <button v-if="showMove" type="button" class="icon-button" :aria-label="`上移 ${task.title}`" @click="emit('moveUp', task)">
        ↑
      </button>
      <button v-if="showMove" type="button" class="icon-button" :aria-label="`下移 ${task.title}`" @click="emit('moveDown', task)">
        ↓
      </button>
      <button v-if="deletedMode" type="button" class="icon-button" :aria-label="`恢复 ${task.title}`" @click="emit('restore', task)">
        <RotateCcw :size="16" aria-hidden="true" />
      </button>
      <button v-if="deletedMode" type="button" class="icon-button icon-button--danger" :aria-label="`彻底删除 ${task.title}`" @click="emit('purge', task)">
        <Trash2 :size="16" aria-hidden="true" />
      </button>
      <button v-else type="button" class="icon-button icon-button--danger" :aria-label="`删除 ${task.title}`" @click="emit('delete', task)">
        <Trash2 :size="16" aria-hidden="true" />
      </button>
    </div>
  </li>
</template>

<style scoped>
.task-table-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
}

.task-table-row:not(.is-draggable) {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.task-table-row__drag {
  width: 20px;
  display: inline-flex;
  justify-content: center;
  color: var(--text-faint);
  cursor: grab;
}

.task-table-row.is-draggable:active .task-table-row__drag {
  cursor: grabbing;
}

.task-table-row:last-child {
  border-bottom: 0;
}

.task-table-row.is-selected {
  background: var(--bg-hover);
}

.task-table-row__check {
  width: 28px;
  display: inline-flex;
  justify-content: center;
}

.task-table-row__open {
  min-width: 0;
  height: auto;
  padding: 8px 0;
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
  text-align: left;
}

.task-table-row__open:hover {
  background: transparent;
}

.task-table-row__title {
  font-weight: 600;
  color: var(--text);
  overflow-wrap: anywhere;
}

.task-table-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.task-table-row__actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
