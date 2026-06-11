<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Loader2, Play, RefreshCw, Square } from "lucide-vue-next";
import { useAgentSettings } from "../../agent/settings";
import {
  formatAgentRuntimeLifecycle,
  listAgentRuntimeEvents,
  loadAgentRuntimeSnapshot,
  startAgentRuntime,
  stopAgentRuntime,
  type AgentRuntimeStatusSnapshot,
  type RuntimeEventShape,
  type ScalarValue,
} from "../../agentRuntime";
import { formatDisplayError } from "../../utils/errors";

const settings = useAgentSettings();
const status = ref<AgentRuntimeStatusSnapshot | null>(null);
const events = ref<RuntimeEventShape[]>([]);
const loading = ref(true);
const busyAction = ref<"start" | "stop" | "refresh" | null>(null);
const error = ref<string | null>(null);

const runtimeRunning = computed(() => status.value?.lifecycle === "running");
const automaticTriggerState = computed(() => {
  if (!settings.value.automaticTriggersEnabled) return "已关闭";
  return runtimeRunning.value ? "自动触发运行中" : "等待 runtime 启动";
});

onMounted(() => {
  void loadRuntime();
});

async function loadRuntime(action: "refresh" | null = null) {
  busyAction.value = action;
  loading.value = true;
  error.value = null;
  try {
    const snapshot = await loadAgentRuntimeSnapshot();
    status.value = snapshot.status;
    events.value = snapshot.events;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
    busyAction.value = null;
  }
}

async function startRuntime() {
  await runRuntimeCommand("start", startAgentRuntime);
}

async function stopRuntime() {
  await runRuntimeCommand("stop", stopAgentRuntime);
}

async function runRuntimeCommand(action: "start" | "stop", command: () => Promise<AgentRuntimeStatusSnapshot>) {
  busyAction.value = action;
  error.value = null;
  try {
    status.value = await command();
    events.value = (await listAgentRuntimeEvents()).events;
  } catch (e) {
    error.value = String(e);
  } finally {
    busyAction.value = null;
    loading.value = false;
  }
}

function formatScalar(value: ScalarValue) {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}
</script>

<template>
  <section class="page">
    <div class="card agent-settings">
      <div class="agent-settings__row">
        <div>
          <strong>Runtime 控制</strong>
          <p>控制本机 Agent runtime 的启停，所有写入仍进入确认队列。</p>
        </div>
        <div class="agent-settings__actions">
          <button class="primary" type="button" :disabled="busyAction !== null || runtimeRunning" @click="startRuntime">
            <Loader2 v-if="busyAction === 'start'" class="spin" :size="14" aria-hidden="true" />
            <Play v-else :size="14" aria-hidden="true" />
            启动 runtime
          </button>
          <button type="button" :disabled="busyAction !== null || !runtimeRunning" @click="stopRuntime">
            <Loader2 v-if="busyAction === 'stop'" class="spin" :size="14" aria-hidden="true" />
            <Square v-else :size="14" aria-hidden="true" />
            停止 runtime
          </button>
          <button type="button" :disabled="busyAction !== null" @click="loadRuntime('refresh')">
            <Loader2 v-if="busyAction === 'refresh'" class="spin" :size="14" aria-hidden="true" />
            <RefreshCw v-else :size="14" aria-hidden="true" />
            刷新
          </button>
        </div>
      </div>

      <p v-if="error" class="agent-settings__error">{{ formatDisplayError(error) }}</p>

      <ul class="kv">
        <li>
          <span>运行状态</span>
          <span>{{ loading && !status ? "加载中" : formatAgentRuntimeLifecycle(status?.lifecycle) }}</span>
        </li>
        <li>
          <span>backend</span>
          <span>{{ status?.backend_configured ? "已配置" : "未配置" }}</span>
        </li>
        <li>
          <span>runtime 事件</span>
          <span>{{ status?.buffered_event_count ?? events.length }} 条</span>
        </li>
        <li v-if="status?.disabled_reason">
          <span>禁用原因</span>
          <span>{{ status.disabled_reason }}</span>
        </li>
      </ul>

      <div class="agent-settings__row">
        <div>
          <strong>自动触发</strong>
          <p>任务创建、更新、逾期、提醒到期和每日首次启动时生成建议。</p>
        </div>
        <label class="switch">
          <input v-model="settings.automaticTriggersEnabled" type="checkbox" />
          <span>{{ automaticTriggerState }}</span>
        </label>
      </div>

      <ul class="kv">
        <li>
          <span>写入保护</span>
          <span>所有 Agent 写入进入确认队列</span>
        </li>
        <li>
          <span>审计撤销</span>
          <span>确认执行后按批次记录</span>
        </li>
        <li>
          <span>默认后端</span>
          <span>未配置时保持禁用</span>
        </li>
      </ul>

      <div class="agent-settings__events">
        <div class="agent-settings__section-head">
          <strong>最近 runtime 事件</strong>
          <span>{{ events.length }} 条</span>
        </div>
        <ol v-if="events.length > 0" class="agent-settings__event-list">
          <li v-for="event in events.slice(-6)" :key="event.sequence">
            <span>#{{ event.sequence }} {{ event.name }}</span>
            <code v-for="(value, key) in event.attributes" :key="key">
              {{ key }}={{ formatScalar(value) }}
            </code>
          </li>
        </ol>
        <p v-else class="agent-settings__empty">当前没有 runtime 事件。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.agent-settings__row p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.agent-settings__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.agent-settings__error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--err-soft);
  border-radius: 6px;
  background: var(--err-soft);
  color: var(--err);
  font-size: 12px;
}

.agent-settings__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.agent-settings__section-head strong {
  color: var(--text);
}

.agent-settings__event-list {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
}

.agent-settings__event-list li {
  display: flex;
  min-height: 30px;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-muted);
  font-size: 12px;
}

.agent-settings__event-list li:last-child {
  border-bottom: 0;
}

.agent-settings__empty {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

@media (max-width: 720px) {
  .agent-settings__row {
    align-items: flex-start;
    flex-direction: column;
  }

  .agent-settings__actions {
    justify-content: flex-start;
  }
}
</style>
