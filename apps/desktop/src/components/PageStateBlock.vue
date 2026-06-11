<script setup lang="ts">
import { AlertCircle, Loader2, RefreshCw, SearchX } from "lucide-vue-next";

const props = withDefaults(defineProps<{
  kind: "loading" | "error" | "empty";
  title: string;
  actionLabel?: string;
}>(), {
  actionLabel: "重试",
});

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="page-state" :class="`page-state--${kind}`">
    <Loader2 v-if="kind === 'loading'" class="spin" :size="18" aria-hidden="true" />
    <AlertCircle v-else-if="kind === 'error'" :size="18" aria-hidden="true" />
    <SearchX v-else :size="18" aria-hidden="true" />
    <p>{{ title }}</p>
    <button v-if="kind === 'error'" type="button" @click="emit('action')">
      <RefreshCw :size="16" aria-hidden="true" />
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.page-state {
  min-height: 48px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  color: var(--text-muted);
}

.page-state--error {
  color: var(--err);
  justify-content: space-between;
}

.page-state p {
  margin: 0;
}
</style>
