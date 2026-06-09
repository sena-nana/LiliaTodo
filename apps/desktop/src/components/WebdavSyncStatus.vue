<script setup lang="ts">
import { Loader2, RefreshCw } from "lucide-vue-next";
import type { WebdavRunReport } from "../sync/webdav";

defineProps<{
  controllerAvailable: boolean;
  syncing: boolean;
  hasSavedSecrets: boolean;
  inspectReason: string | null;
  syncError: string | null;
  syncReport: WebdavRunReport | null;
}>();

defineEmits<{
  syncNow: [];
}>();
</script>

<template>
  <p v-if="inspectReason" class="muted">{{ inspectReason }}</p>
  <div v-if="controllerAvailable" class="row sync-actions">
    <button class="primary" type="button" :disabled="syncing || !hasSavedSecrets" @click="$emit('syncNow')">
      <Loader2 v-if="syncing" class="spin" :size="14" aria-hidden="true" />
      <RefreshCw v-else :size="14" aria-hidden="true" />
      立即同步
    </button>
  </div>
  <p v-if="syncError" class="err">{{ syncError }}</p>
  <p v-if="syncReport" class="ok">{{ syncReport.message }}</p>
</template>

<style scoped>
.sync-actions {
  margin-top: 6px;
}
</style>
