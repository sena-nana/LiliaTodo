<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, provide } from "vue";
import { RouterView } from "vue-router";
import { useTaskRepository } from "./data/TaskRepositoryContext";
import { listenReminderTicks, notifyDueReminders } from "./notifications";
import { createLazySettingsSyncRuntime } from "./sync/settingsSyncBootstrap";
import {
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "./sync/settingsSyncContext";

const ContextMenuHost = defineAsyncComponent(() => import("./components/ContextMenuHost.vue"));
const repository = useTaskRepository();
const { settingsSyncRuntime, secretsStoreProvider } =
  createLazySettingsSyncRuntime(repository);
let stopReminderTicks: (() => void) | null = null;

provide(WebdavSyncControllerKey, settingsSyncRuntime.webdav);
provide(WebdavSecretsStoreKey, secretsStoreProvider);

onMounted(() => {
  void notifyDueReminders(repository).catch(() => undefined);
  void listenReminderTicks(repository)
    .then((stop) => {
      stopReminderTicks = stop;
    })
    .catch(() => undefined);
});

onUnmounted(() => {
  stopReminderTicks?.();
  stopReminderTicks = null;
});
</script>

<template>
  <RouterView />
  <ContextMenuHost />
</template>
