<script setup lang="ts">
import { ListTodo, Settings } from "lucide-vue-next";

defineEmits<{ "open-settings": [] }>();
</script>

<template>
  <aside class="activity-bar">
    <div class="activity-bar__top">
      <button
        type="button"
        class="activity-bar__item is-active"
        aria-label="任务"
        title="任务"
      >
        <ListTodo :size="20" aria-hidden="true" />
      </button>
    </div>
    <div class="activity-bar__bottom">
      <button
        type="button"
        class="activity-bar__item"
        aria-label="设置"
        title="设置"
        @click="$emit('open-settings')"
      >
        <Settings :size="20" aria-hidden="true" />
      </button>
    </div>
  </aside>
</template>
