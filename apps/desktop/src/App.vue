<script setup lang="ts">
import { defineAsyncComponent, provide } from "vue";
import { RouterView } from "vue-router";
import { useTaskRepository } from "./data/TaskRepositoryContext";
import { createLazySettingsSyncRuntime } from "./sync/settingsSyncBootstrap";
import {
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "./sync/settingsSyncContext";

const ContextMenuHost = defineAsyncComponent(() => import("./components/ContextMenuHost.vue"));
const repository = useTaskRepository();
const { settingsSyncRuntime, secretsStoreProvider } =
  createLazySettingsSyncRuntime(repository);

provide(WebdavSyncControllerKey, settingsSyncRuntime.webdav);
provide(WebdavSecretsStoreKey, secretsStoreProvider);
</script>

<template>
  <RouterView />
  <ContextMenuHost />
</template>
