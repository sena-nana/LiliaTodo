<script setup lang="ts">
defineProps<{
  label: string;
  totalCount: number;
  selectedCount: number;
}>();
</script>

<template>
  <section class="task-selection-toolbar">
    <div class="task-selection-toolbar__left">
      <slot name="label">
        <span>{{ label }} {{ totalCount }} 条</span>
      </slot>
      <span v-if="selectedCount > 0">已选 {{ selectedCount }} 条</span>
    </div>
    <div class="task-selection-toolbar__right">
      <slot name="actions" />
    </div>
  </section>
</template>

<style scoped>
.task-selection-toolbar {
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

.task-selection-toolbar__left,
.task-selection-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
