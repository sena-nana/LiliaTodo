<script setup lang="ts">
import type { RuntimeEventShape } from "../agentRuntime";
import { formatRuntimeEventValue } from "../composables/useAgentRuntimeSnapshot";

defineProps<{
  events: RuntimeEventShape[];
  limit?: number;
  ordered?: boolean;
}>();
</script>

<template>
  <component :is="ordered ? 'ol' : 'ul'" class="agent-runtime-events">
    <li v-for="event in events.slice(-(limit ?? events.length))" :key="event.sequence">
      <span>#{{ event.sequence }} {{ event.name }}</span>
      <code v-for="(value, key) in event.attributes" :key="key">
        {{ key }}={{ formatRuntimeEventValue(value) }}
      </code>
    </li>
  </component>
</template>

<style scoped>
.agent-runtime-events {
  list-style: none;
  padding: 0;
  margin: 0;
}

.agent-runtime-events li {
  display: flex;
  min-height: 30px;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-muted);
  font-size: 12px;
}

.agent-runtime-events li:last-child {
  border-bottom: 0;
}
</style>
