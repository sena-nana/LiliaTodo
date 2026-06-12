<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, provide } from "vue";
import { RouterView } from "vue-router";
import { useAgentAutoTriggerController } from "./agent/autoTriggers";
import { TaskRepositoryKey, useTaskRepository } from "./data/TaskRepositoryContext";
import { listenReminderTicks, notifyDueReminders } from "./notifications";
import { createLazySettingsSyncRuntime } from "./sync/settingsSyncBootstrap";
import {
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "./sync/settingsSyncContext";
import { createWebdavObservedTaskRepository } from "./sync/webdavObservedRepository";

const ContextMenuHost = defineAsyncComponent(() => import("./components/ContextMenuHost.vue"));
const repository = useTaskRepository();
const agentAutoTrigger = useAgentAutoTriggerController();
const { settingsSyncRuntime, secretsStoreProvider } =
  createLazySettingsSyncRuntime(repository);
const observedRepository = createWebdavObservedTaskRepository(repository, settingsSyncRuntime.webdav);
let stopReminderTicks: (() => void) | null = null;
const reminderOptions = {
  onReminderDue: agentAutoTrigger.requestReminderDue.bind(agentAutoTrigger),
};

provide(WebdavSyncControllerKey, settingsSyncRuntime.webdav);
provide(WebdavSecretsStoreKey, secretsStoreProvider);
provide(TaskRepositoryKey, observedRepository);

onMounted(() => {
  void settingsSyncRuntime.webdav?.restoreAutoSync().catch(() => undefined);
  void agentAutoTrigger.runStartupChecks().catch(() => undefined);
  void notifyDueReminders(observedRepository, reminderOptions).catch(() => undefined);
  void listenReminderTicks(observedRepository, reminderOptions)
    .then((stop) => {
      stopReminderTicks = stop;
    })
    .catch(() => undefined);
});

onUnmounted(() => {
  stopReminderTicks?.();
  stopReminderTicks = null;
  agentAutoTrigger.stop();
});
</script>

<template>
  <RouterView />
  <ContextMenuHost />
</template>
