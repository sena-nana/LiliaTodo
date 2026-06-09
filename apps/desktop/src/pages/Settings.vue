<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  normalizeSettingsTab,
} from "../config/appShell";
import { WebdavSyncControllerKey } from "../data/TaskRepositoryContext";
import type { WebdavRunReport } from "../sync/webdav";
import "../styles/page.css";

const route = useRoute();
const webdavController = inject(WebdavSyncControllerKey, null);
const activeTab = computed(() => normalizeSettingsTab(route.query.tab));
const activeTabSection = computed(() => SETTINGS_SECTIONS[activeTab.value]);
const activeTabLabel = computed(
  () => SETTINGS_TABS.find((tab) => tab.key === activeTab.value)?.label ?? "设置",
);
const latestWebdavRunReport = ref<WebdavRunReport | null>(null);
let unsubscribeWebdavRunCompleted: (() => void) | null = null;

onMounted(() => {
  unsubscribeWebdavRunCompleted = webdavController?.onRunCompleted((report) => {
    latestWebdavRunReport.value = report;
  }) ?? null;
});

onUnmounted(() => {
  unsubscribeWebdavRunCompleted?.();
});
</script>

<template>
  <section class="settings-page" :aria-label="activeTabLabel">
    <p v-if="latestWebdavRunReport" class="settings-page__sync-notice ok">
      {{ latestWebdavRunReport.message }}
    </p>
    <component :is="activeTabSection" />
  </section>
</template>

<style scoped>
.settings-page__sync-notice {
  margin: 0 0 10px;
}
</style>
