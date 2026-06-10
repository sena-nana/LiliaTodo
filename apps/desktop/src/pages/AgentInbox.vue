<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Bot, Loader2, RefreshCw } from "lucide-vue-next";
import {
  getAgentRuntimeStatus,
  listAgentRuntimeEvents,
  type AgentRuntimeStatusSnapshot,
  type RuntimeEventShape,
  type ScalarValue,
} from "../agentRuntime";

const status = ref<AgentRuntimeStatusSnapshot | null>(null);
const events = ref<RuntimeEventShape[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const statusTone = computed(() => {
  if (!status.value) return "";
  return status.value.lifecycle === "disabled" ? "warn" : "ok";
});

onMounted(() => {
  void load();
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [nextStatus, nextEvents] = await Promise.all([
      getAgentRuntimeStatus(),
      listAgentRuntimeEvents(),
    ]);
    status.value = nextStatus;
    events.value = nextEvents.events;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function lifecycleLabel(value: AgentRuntimeStatusSnapshot["lifecycle"] | null | undefined) {
  switch (value) {
    case "bootstrapping":
      return "初始化中";
    case "disabled":
      return "已禁用";
    default:
      return "未知";
  }
}

function phaseLabel(value: AgentRuntimeStatusSnapshot["agent_phase"]) {
  switch (value) {
    case "spawn":
      return "Spawn";
    case "awake":
      return "Awake";
    case "sleep":
      return "Sleep";
    case "stop":
      return "Stop";
    default:
      return "未创建";
  }
}

function displayError(value: string) {
  return value.replace(/^Error:\s*/, "错误：");
}

function formatScalar(value: ScalarValue) {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}
</script>

<template>
  <section class="page">
    <div v-if="loading" class="card state">
      <Loader2 class="spin" :size="18" aria-hidden="true" />
      <p>正在加载 Agent runtime 状态...</p>
    </div>
    <div v-else-if="error" class="card state state--error">
      <p>{{ displayError(error) }}</p>
      <button type="button" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />
        重试
      </button>
    </div>
    <template v-else-if="status">
      <section class="card">
        <div class="agent-inbox__headline">
          <div class="agent-inbox__title">
            <Bot :size="18" aria-hidden="true" />
            <strong>Agent Inbox</strong>
          </div>
          <button type="button" @click="load">
            <RefreshCw :size="16" aria-hidden="true" />
            刷新
          </button>
        </div>
        <p
          class="agent-inbox__banner"
          :class="{ 'agent-inbox__banner--warn': statusTone === 'warn' }"
        >
          {{
            status.disabled_reason
              ?? "runtime 已初始化。当前页面仅展示最小状态骨架。"
          }}
        </p>
        <ul class="kv">
          <li>
            <span>生命周期</span>
            <span>{{ lifecycleLabel(status.lifecycle) }}</span>
          </li>
          <li>
            <span>Agent ID</span>
            <span>{{ status.agent_id ?? "未创建" }}</span>
          </li>
          <li>
            <span>Phase</span>
            <span>{{ phaseLabel(status.agent_phase) }}</span>
          </li>
          <li>
            <span>Backend</span>
            <span>{{ status.backend_configured ? "已配置" : "未配置" }}</span>
          </li>
          <li>
            <span>事件缓冲</span>
            <span>{{ status.buffered_event_count }} 条</span>
          </li>
        </ul>
      </section>

      <section class="card">
        <h2>最近事件</h2>
        <p v-if="events.length === 0" class="empty-text">当前还没有 runtime 事件。</p>
        <ol v-else class="agent-inbox__events">
          <li v-for="event in events" :key="event.sequence" class="agent-inbox__event">
            <div class="agent-inbox__event-main">
              <span class="agent-inbox__event-seq">#{{ event.sequence }}</span>
              <strong>{{ event.name }}</strong>
              <span class="agent-inbox__event-kind">{{ event.kind }}</span>
            </div>
            <p class="agent-inbox__event-meta">
              Agent {{ event.agent_id ?? "runtime" }}
            </p>
            <ul
              v-if="Object.keys(event.attributes).length > 0"
              class="agent-inbox__attributes"
            >
              <li v-for="(value, key) in event.attributes" :key="key">
                <span>{{ key }}</span>
                <code>{{ formatScalar(value) }}</code>
              </li>
            </ul>
            <p v-if="event.error" class="agent-inbox__event-error">
              {{ event.error.code }} · {{ event.error.route }}
            </p>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<style scoped>
.agent-inbox__headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.agent-inbox__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.agent-inbox__banner {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.agent-inbox__banner--warn {
  background: var(--warn-soft);
  color: var(--warn);
}

.agent-inbox__events {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-inbox__event {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-soft);
}

.agent-inbox__event:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.agent-inbox__event-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.agent-inbox__event-seq,
.agent-inbox__event-kind {
  color: var(--text-muted);
  font-size: 12px;
}

.agent-inbox__event-meta,
.agent-inbox__event-error {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.agent-inbox__event-error {
  color: var(--err);
}

.agent-inbox__attributes {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-inbox__attributes li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
</style>
