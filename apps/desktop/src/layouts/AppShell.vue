<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted } from "vue";
import { RouterView, useRouter } from "vue-router";
import { APP_TITLE, SETTINGS_TABS, normalizeSettingsTab } from "../config/appShell";
import { useRouteReturnTarget } from "../composables/useRouteReturnTarget";
import { useShellSidebar } from "../composables/useShellSidebar";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts";
import { OPEN_TASK_EVENT } from "../notifications";
import TitleBar from "../components/TitleBar.vue";
import "../styles/shell.css";

const SecondaryPanel = defineAsyncComponent(() => import("./SecondaryPanel.vue"));
const SettingsSidebar = defineAsyncComponent(() => import("./SettingsSidebar.vue"));

const router = useRouter();
const { route, returnTo } = useRouteReturnTarget("/today");
const sidebarLocked = computed(() => route.meta.lockSidebar === true);
const sidebarVariant = computed(() => route.meta.sidebar ?? "main");
const isSettingsMode = computed(() => sidebarVariant.value === "settings");
const activeSettingsTab = computed(() => normalizeSettingsTab(route.query.tab));
const sidebar = useShellSidebar(sidebarLocked);

useGlobalShortcuts({
  "mod+k": () => void router.push("/search"),
  "mod+g": () => void router.push("/today"),
  "mod+i": () => void router.push("/inbox"),
  "mod+a": () => void router.push("/agent-inbox"),
});

function onOpenTask(event: Event) {
  const taskId = (event as CustomEvent<{ taskId?: string }>).detail?.taskId;
  if (taskId) {
    void router.push({ path: "/search", query: { taskId } });
  }
}

onMounted(() => window.addEventListener(OPEN_TASK_EVENT, onOpenTask));
onUnmounted(() => window.removeEventListener(OPEN_TASK_EVENT, onOpenTask));
</script>

<template>
  <div
    class="shell"
    :class="{
      'is-resizing': sidebar.isResizing.value,
      'is-sidebar-collapsed': sidebar.effectiveCollapsed.value,
      'is-settings-mode': isSettingsMode,
    }"
    :style="{ '--sidebar-width': sidebar.widthStyle.value }"
  >
    <TitleBar
      :title="APP_TITLE"
      :left-sidebar-collapsed="sidebar.effectiveCollapsed.value"
      :sidebar-toggles-disabled="sidebarLocked"
      @toggle-left-sidebar="sidebar.toggleCollapsed"
    />
    <SettingsSidebar
      v-if="isSettingsMode"
      :tabs="SETTINGS_TABS"
      :active-key="activeSettingsTab"
      :return-to="returnTo"
    />
    <SecondaryPanel v-else />
    <div
      class="shell__resizer"
      role="separator"
      aria-orientation="vertical"
      :aria-disabled="sidebar.effectiveCollapsed.value ? 'true' : undefined"
      :aria-valuenow="sidebar.width.value"
      :aria-valuemin="sidebar.minWidth"
      :aria-valuemax="sidebar.maxWidth"
      title="拖动调整侧栏宽度（双击恢复默认）"
      @pointerdown="sidebar.startResize"
      @dblclick="sidebar.resetWidth"
    />
    <main class="shell__main">
      <RouterView />
    </main>
  </div>
</template>
