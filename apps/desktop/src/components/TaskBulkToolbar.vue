<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CalendarClock, Check, FolderInput, Tags, Trash2 } from "lucide-vue-next";
import type { BatchTaskOperation, TaskCategory, TaskList } from "../domain/tasks";

type BulkOperationWithoutIds =
  | Omit<Extract<BatchTaskOperation, { type: "complete" }>, "taskIds">
  | Omit<Extract<BatchTaskOperation, { type: "reschedule" }>, "taskIds">
  | Omit<Extract<BatchTaskOperation, { type: "move" }>, "taskIds">
  | Omit<Extract<BatchTaskOperation, { type: "tag" }>, "taskIds">
  | Omit<Extract<BatchTaskOperation, { type: "delete" }>, "taskIds">;

const props = defineProps<{
  selectedCount: number;
  lists: TaskList[];
  categories?: TaskCategory[];
  currentListId?: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  apply: [operation: BulkOperationWithoutIds];
  clear: [];
}>();

const dueAt = ref("");
const targetListId = ref(props.currentListId ?? props.lists[0]?.id ?? "inbox");
const targetCategoryId = ref("");
const tagText = ref("");
const tagMode = ref<"merge" | "replace">("merge");

watch(() => props.currentListId, (value) => {
  if (value) targetListId.value = value;
});

const targetCategories = computed(() =>
  (props.categories ?? []).filter((category) => category.listId === targetListId.value),
);
const tags = computed(() => tagText.value.split(",").map((tag) => tag.trim()).filter(Boolean));
const riskLabel = computed(() => props.selectedCount >= 5 ? "高风险" : props.selectedCount >= 2 ? "中风险" : "低风险");
const riskClass = computed(() => props.selectedCount >= 5 ? "high" : props.selectedCount >= 2 ? "medium" : "low");
const impactText = computed(() => `将影响 ${props.selectedCount} 个任务，确认后写入本地任务库并进入同步链路。`);

function isoFromLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}
</script>

<template>
  <section class="bulk-toolbar" aria-label="批量操作">
    <div class="bulk-toolbar__summary">
      <strong>已选 {{ selectedCount }} 条</strong>
      <span :class="['bulk-toolbar__risk', `is-${riskClass}`]">{{ riskLabel }}</span>
      <span>{{ impactText }}</span>
    </div>
    <div class="bulk-toolbar__actions">
      <button type="button" :disabled="disabled || selectedCount === 0" @click="emit('apply', { type: 'complete' })">
        <Check :size="15" aria-hidden="true" />
        完成
      </button>
      <label>
        <span class="sr-only">批量截止时间</span>
        <input v-model="dueAt" type="datetime-local" aria-label="批量截止时间" />
      </label>
      <button type="button" :disabled="disabled || selectedCount === 0" @click="emit('apply', { type: 'reschedule', dueAt: isoFromLocal(dueAt) })">
        <CalendarClock :size="15" aria-hidden="true" />
        改期
      </button>
      <select v-model="targetListId" aria-label="批量移动清单">
        <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
      </select>
      <select v-model="targetCategoryId" aria-label="批量移动分类">
        <option value="">未分类</option>
        <option v-for="category in targetCategories" :key="category.id" :value="category.id">{{ category.name }}</option>
      </select>
      <button type="button" :disabled="disabled || selectedCount === 0" @click="emit('apply', { type: 'move', listId: targetListId, categoryId: targetCategoryId || null })">
        <FolderInput :size="15" aria-hidden="true" />
        移动
      </button>
      <input v-model="tagText" class="bulk-toolbar__tags" aria-label="批量标签" placeholder="标签，逗号分隔" />
      <select v-model="tagMode" aria-label="批量标签模式">
        <option value="merge">合并</option>
        <option value="replace">替换</option>
      </select>
      <button type="button" :disabled="disabled || selectedCount === 0 || tags.length === 0" @click="emit('apply', { type: 'tag', tags, mode: tagMode })">
        <Tags :size="15" aria-hidden="true" />
        标签
      </button>
      <button type="button" class="icon-button icon-button--danger" :disabled="disabled || selectedCount === 0" aria-label="批量删除" @click="emit('apply', { type: 'delete' })">
        <Trash2 :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="ghost" @click="emit('clear')">取消选择</button>
    </div>
  </section>
</template>

<style scoped>
.bulk-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 6px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.bulk-toolbar__summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.bulk-toolbar__summary strong {
  color: var(--text);
  white-space: nowrap;
}

.bulk-toolbar__risk {
  min-width: 52px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.bulk-toolbar__risk.is-low {
  color: var(--ok);
  background: var(--ok-soft);
}

.bulk-toolbar__risk.is-medium {
  color: var(--warn);
  background: var(--warn-soft);
}

.bulk-toolbar__risk.is-high {
  color: var(--err);
  background: var(--err-soft);
}

.bulk-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.bulk-toolbar__actions input,
.bulk-toolbar__actions select {
  width: 132px;
}

.bulk-toolbar__actions .bulk-toolbar__tags {
  width: 150px;
}

@media (max-width: 980px) {
  .bulk-toolbar {
    grid-template-columns: 1fr;
  }

  .bulk-toolbar__actions {
    justify-content: flex-start;
  }
}
</style>
