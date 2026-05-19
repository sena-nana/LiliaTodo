<script setup lang="ts">
import { RouterLink } from "vue-router";
import { Sun, Inbox, CalendarDays } from "lucide-vue-next";

const nav = [
  { to: "/today", label: "今日", icon: Sun },
  { to: "/inbox", label: "收件箱", icon: Inbox },
  { to: "/calendar", label: "日历", icon: CalendarDays },
];
</script>

<template>
  <aside class="secondary-panel">
    <h2 class="secondary-panel__title">任务</h2>
    <nav class="secondary-panel__nav">
      <RouterLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="secondary-panel__item"
        active-class="is-active"
      >
        <component :is="item.icon" :size="16" aria-hidden="true" />
        {{ item.label }}
      </RouterLink>
    </nav>
  </aside>
</template>
