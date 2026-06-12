<script setup lang="ts">
import type { WebdavAutoSyncStatus } from "../sync/defaultSettingsSyncRuntime";

defineProps<{
  status: WebdavAutoSyncStatus | null;
  busy: boolean;
  hasSavedSecrets: boolean;
}>();

const emit = defineEmits<{
  toggle: [enabled: boolean];
}>();

function onToggle(event: Event) {
  emit("toggle", (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <section class="webdav-auto">
    <label>
      <input
        type="checkbox"
        :checked="status?.enabled ?? false"
        :disabled="busy || !hasSavedSecrets"
        @change="onToggle"
      />
      自动后台同步
    </label>
    <span>{{ status?.running ? "运行中" : "已停止" }}</span>
  </section>
</template>

<style scoped>
.webdav-auto {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.webdav-auto label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
}
</style>
