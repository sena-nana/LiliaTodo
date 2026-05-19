<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { RefreshCw, Info } from "lucide-vue-next";
import TitleBar from "../components/TitleBar.vue";

const categories = [
  { to: "/settings-shell/sync", label: "同步", icon: RefreshCw },
  { to: "/settings-shell/about", label: "关于", icon: Info },
];
</script>

<template>
  <div class="settings-shell">
    <TitleBar title="Momo 设置" />
    <aside class="settings-shell__categories">
      <nav class="settings-shell__nav">
        <RouterLink
          v-for="item in categories"
          :key="item.to"
          :to="item.to"
          class="settings-shell__nav-item"
          active-class="is-active"
        >
          <component :is="item.icon" :size="16" aria-hidden="true" />
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="settings-shell__content">
      <RouterView />
    </main>
  </div>
</template>
