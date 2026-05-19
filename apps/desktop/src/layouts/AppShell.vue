<script setup lang="ts">
import { ref } from "vue";
import { RouterView } from "vue-router";
import TitleBar from "../components/TitleBar.vue";
import ActivityBar from "./ActivityBar.vue";
import SecondaryPanel from "./SecondaryPanel.vue";
import { openSettingsWindow } from "../window/settingsWindow";

const settingsError = ref<string | null>(null);

async function onOpenSettings() {
  settingsError.value = null;
  try {
    await openSettingsWindow();
  } catch (e) {
    settingsError.value = String(e);
    console.error("[settings-window]", e);
  }
}
</script>

<template>
  <div class="shell">
    <TitleBar />
    <ActivityBar @open-settings="onOpenSettings" />
    <SecondaryPanel />
    <main class="shell__main">
      <p v-if="settingsError" class="err">{{ settingsError }}</p>
      <RouterView />
    </main>
  </div>
</template>
