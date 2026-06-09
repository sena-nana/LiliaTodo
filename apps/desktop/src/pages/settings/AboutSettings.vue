<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getVersion, getName } from "@tauri-apps/api/app";

const appName = ref("LiliaTodo");
const appVersion = ref("");

onMounted(async () => {
  try {
    appName.value = await getName();
    appVersion.value = await getVersion();
  } catch {
    appVersion.value = "0.1.0";
  }
});
</script>

<template>
  <section class="page">
    <div class="card">
      <ul class="kv">
        <li><span>应用名称</span> {{ appName }}</li>
        <li><span>版本</span> v{{ appVersion }}</li>
        <li><span>框架</span> Tauri 2 + Vue 3</li>
      </ul>
    </div>
  </section>
</template>
