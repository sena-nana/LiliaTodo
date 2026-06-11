<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Bot, Check, RefreshCw, RotateCcw, X } from "lucide-vue-next";
import { TODO_AGENT_TOOL_DEFINITIONS, type AgentAuditRecord, type AgentInboxSnapshot, type AgentPendingAction } from "../agent/actions";
import { buildAgentTaskContextSnapshot } from "../agent/context";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import PageStateBlock from "../components/PageStateBlock.vue";
import { formatDisplayError } from "../utils/errors";
import {
  formatAgentRuntimeLifecycle,
  getAgentRuntimeStatus,
  isAgentRuntimeRunning,
  listAgentRuntimeEvents,
  triggerAgentRuntimeScan,
  type AgentRuntimeStatusSnapshot,
  type AgentRunnerTriggerResult,
  type RuntimeEventShape,
  type ScalarValue,
} from "../agentRuntime";

const repository = useTaskRepository();
const status = ref<AgentRuntimeStatusSnapshot | null>(null);
const events = ref<RuntimeEventShape[]>([]);
const inbox = ref<AgentInboxSnapshot>({ pendingActions: [], audits: [] });
const loading = ref(true);
const busyId = ref<string | null>(null);
const error = ref<string | null>(null);
const runnerResult = ref<AgentRunnerTriggerResult | null>(null);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const runtimeRunning = computed(() => isAgentRuntimeRunning(status.value));
const pendingActions = computed(() => inbox.value.pendingActions.filter((item) => item.status === "pending"));
const decidedActions = computed(() => inbox.value.pendingActions.filter((item) => item.status !== "pending").slice(0, 12));
const auditBatches = computed(() => {
  const groups = new Map<string, AgentAuditRecord[]>();
  for (const audit of inbox.value.audits) {
    const group = groups.get(audit.batchId) ?? [];
    group.push(audit);
    groups.set(audit.batchId, group);
  }
  return [...groups.entries()].map(([batchId, audits]) => ({
    batchId,
    audits,
    createdAt: audits[0]?.createdAt ?? "",
    reversible: audits.every((audit) => audit.reversible && audit.status === "applied"),
    status: audits.some((audit) => audit.status === "undo_failed")
      ? "撤销失败"
      : audits.every((audit) => audit.status === "undone")
        ? "已撤销"
        : "已执行",
  }));
});

onMounted(() => {
  void load();
  refreshTimer = setInterval(() => {
    if (document.visibilityState === "visible" && runtimeRunning.value && busyId.value === null) {
      void refreshRuntimeBacklog();
    }
  }, 8_000);
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await refreshRuntimeBacklog();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function refreshRuntimeBacklog() {
  try {
    const [nextStatus, nextEvents, nextInbox] = await Promise.all([
      getAgentRuntimeStatus(),
      listAgentRuntimeEvents(),
      repository.getAgentInboxSnapshot(),
    ]);
    status.value = nextStatus;
    events.value = nextEvents.events;
    inbox.value = nextInbox;
  } catch (e) {
    error.value = String(e);
  }
}

async function approve(action: AgentPendingAction) {
  await runAction(action.id, () => repository.approveAgentPendingAction(action.id));
}

async function reject(action: AgentPendingAction) {
  await runAction(action.id, () => repository.rejectAgentPendingAction(action.id, "用户拒绝"));
}

async function undoBatch(batchId: string) {
  await runAction(batchId, () => repository.undoAgentAuditBatch(batchId));
}

async function triggerScan() {
  if (!runtimeRunning.value) {
    runnerResult.value = {
      status: "disabled",
      diagnostic: status.value?.disabled_reason ?? "Agent runtime 未运行，请先启动 runtime。",
      suggestions: [],
    };
    return;
  }
  busyId.value = "trigger-scan";
  error.value = null;
  try {
    const snapshot = await buildAgentTaskContextSnapshot(repository);
    const result = await triggerAgentRuntimeScan(snapshot);
    runnerResult.value = result;
    if (result.status === "ready") {
      const envelopeId = `manual-scan-${snapshot.generatedAt}`;
      await Promise.all(result.suggestions.map((suggestion) =>
        repository.createAgentPendingActionFromTool(suggestion.action, {
          trigger: "manual_scan",
          envelopeId,
          summary: "手动扫描",
          taskIds: suggestion.task_ids ?? [],
          codexThreadId: suggestion.codex_thread_id ?? null,
          codexTurnId: suggestion.codex_turn_id ?? null,
        }),
      ));
    }
    await refreshRuntimeBacklog();
  } catch (e) {
    error.value = String(e);
  } finally {
    busyId.value = null;
  }
}

async function runAction(id: string, execute: () => Promise<unknown>) {
  busyId.value = id;
  error.value = null;
  try {
    await execute();
    await load();
  } catch (e) {
    error.value = String(e);
  } finally {
    busyId.value = null;
  }
}

function riskLabel(value: AgentPendingAction["risk"]) {
  return value === "high" ? "高风险" : value === "medium" ? "中风险" : "低风险";
}

function statusLabel(value: AgentPendingAction["status"]) {
  switch (value) {
    case "approved":
      return "已确认";
    case "rejected":
      return "已拒绝";
    case "failed":
      return "失败";
    default:
      return "待确认";
  }
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatScalar(value: ScalarValue) {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}
</script>

<template>
  <section class="page agent-inbox">
    <PageStateBlock v-if="loading" kind="loading" title="正在加载 Agent 收件箱..." />
    <div v-else>
      <PageStateBlock v-if="error" kind="error" :title="formatDisplayError(error)" @action="load" />

      <section class="agent-toolbar">
        <div class="agent-toolbar__status">
          <Bot :size="18" aria-hidden="true" />
          <strong>Agent 收件箱</strong>
          <span>{{ formatAgentRuntimeLifecycle(status?.lifecycle) }}</span>
          <span>{{ status?.backend_configured ? "backend 已配置" : "backend 未配置" }}</span>
          <span>{{ status?.buffered_event_count ?? 0 }} 条 runtime 事件</span>
        </div>
        <div class="agent-toolbar__actions">
          <button type="button" :disabled="busyId === 'trigger-scan' || !runtimeRunning" @click="triggerScan">
            <Bot :size="16" aria-hidden="true" />
            触发扫描
          </button>
          <button type="button" @click="load">
            <RefreshCw :size="16" aria-hidden="true" />
            刷新
          </button>
        </div>
      </section>

      <p v-if="status?.disabled_reason" class="agent-notice">
        {{ status.disabled_reason }}
      </p>
      <p v-if="runnerResult" class="agent-notice">
        {{ runnerResult.diagnostic }}
      </p>

      <section class="agent-grid">
        <div class="agent-panel agent-panel--main">
          <div class="agent-panel__head">
            <h2>待确认操作</h2>
            <span>{{ pendingActions.length }} 条</span>
          </div>
          <PageStateBlock v-if="pendingActions.length === 0" kind="empty" title="当前没有待确认操作。" />
          <ul v-else class="agent-action-list">
            <li v-for="action in pendingActions" :key="action.id" class="agent-action">
              <div class="agent-action__main">
                <span class="agent-risk" :class="`agent-risk--${action.risk}`">{{ riskLabel(action.risk) }}</span>
                <strong>{{ action.summary }}</strong>
                <span>{{ action.source.summary }}</span>
              </div>
              <div class="agent-action__meta">
                <span>{{ action.actionType }}</span>
                <span>影响 {{ action.dryRun.affectedTaskIds.length }} 个任务</span>
                <span>{{ action.dryRun.impact }}</span>
              </div>
              <div class="agent-action__buttons">
                <button type="button" class="primary" :disabled="busyId === action.id" @click="approve(action)">
                  <Check :size="16" aria-hidden="true" />
                  确认
                </button>
                <button type="button" :disabled="busyId === action.id" @click="reject(action)">
                  <X :size="16" aria-hidden="true" />
                  拒绝
                </button>
              </div>
            </li>
          </ul>
        </div>

        <aside class="agent-panel">
          <div class="agent-panel__head">
            <h2>工具集</h2>
            <span>{{ TODO_AGENT_TOOL_DEFINITIONS.length }} 个</span>
          </div>
          <ul class="agent-tool-list">
            <li v-for="tool in TODO_AGENT_TOOL_DEFINITIONS" :key="tool.type">
              <strong>{{ tool.title }}</strong>
              <span>{{ tool.type }} · {{ riskLabel(tool.defaultRisk) }}</span>
            </li>
          </ul>
        </aside>
      </section>

      <section class="agent-grid agent-grid--bottom">
        <div class="agent-panel">
          <div class="agent-panel__head">
            <h2>执行批次</h2>
            <span>{{ auditBatches.length }} 批</span>
          </div>
          <PageStateBlock v-if="auditBatches.length === 0" kind="empty" title="还没有已执行批次。" />
          <ul v-else class="agent-batch-list">
            <li v-for="batch in auditBatches" :key="batch.batchId">
              <div>
                <strong>{{ batch.audits[0]?.summary }}</strong>
                <span>{{ batch.status }} · {{ formatDate(batch.createdAt) }}</span>
              </div>
              <button
                type="button"
                :disabled="!batch.reversible || busyId === batch.batchId"
                @click="undoBatch(batch.batchId)"
              >
                <RotateCcw :size="16" aria-hidden="true" />
                撤销
              </button>
            </li>
          </ul>
        </div>

        <div class="agent-panel">
          <div class="agent-panel__head">
            <h2>最近处理</h2>
            <span>{{ decidedActions.length }} 条</span>
          </div>
          <ul v-if="decidedActions.length > 0" class="agent-compact-list">
            <li v-for="action in decidedActions" :key="action.id">
              <strong>{{ action.summary }}</strong>
              <span>{{ statusLabel(action.status) }} · {{ formatDate(action.decidedAt) }}</span>
            </li>
          </ul>
          <PageStateBlock v-else kind="empty" title="还没有处理记录。" />
        </div>

        <div class="agent-panel">
          <div class="agent-panel__head">
            <h2>Runtime 事件</h2>
            <span>{{ events.length }} 条</span>
          </div>
          <ol v-if="events.length > 0" class="agent-event-list">
            <li v-for="event in events.slice(-8)" :key="event.sequence">
              <span>#{{ event.sequence }} {{ event.name }}</span>
              <code v-for="(value, key) in event.attributes" :key="key">
                {{ key }}={{ formatScalar(value) }}
              </code>
            </li>
          </ol>
          <PageStateBlock v-else kind="empty" title="当前没有 runtime 事件。" />
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.agent-inbox {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-toolbar {
  min-height: 42px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.agent-toolbar__status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.agent-toolbar__status strong {
  color: var(--text);
  font-size: 14px;
}

.agent-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-notice {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--warn-soft);
  border-radius: 6px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
}

.agent-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 10px;
}

.agent-grid--bottom {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.agent-panel {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.agent-panel__head {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.agent-panel__head h2 {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.agent-panel__head span {
  color: var(--text-muted);
  font-size: 12px;
}

.agent-action-list,
.agent-tool-list,
.agent-batch-list,
.agent-compact-list,
.agent-event-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.agent-action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-soft);
}

.agent-action:last-child {
  border-bottom: 0;
}

.agent-action__main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.agent-action__main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-action__main span:last-child,
.agent-action__meta {
  color: var(--text-muted);
  font-size: 12px;
}

.agent-action__meta {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.agent-action__buttons {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-risk {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 12px;
}

.agent-risk--high {
  background: var(--err-soft);
  color: var(--err);
}

.agent-risk--medium {
  background: var(--warn-soft);
  color: var(--warn);
}

.agent-tool-list li,
.agent-compact-list li,
.agent-batch-list li,
.agent-event-list li {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12px;
}

.agent-tool-list li:last-child,
.agent-compact-list li:last-child,
.agent-batch-list li:last-child,
.agent-event-list li:last-child {
  border-bottom: 0;
}

.agent-tool-list li,
.agent-compact-list li {
  align-items: flex-start;
  flex-direction: column;
  justify-content: center;
}

.agent-tool-list span,
.agent-compact-list span,
.agent-batch-list span {
  color: var(--text-muted);
}

.agent-batch-list div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.agent-batch-list strong,
.agent-compact-list strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.agent-event-list li {
  justify-content: flex-start;
  flex-wrap: wrap;
  padding: 5px 0;
  color: var(--text-muted);
}

@media (max-width: 920px) {
  .agent-grid,
  .agent-grid--bottom {
    grid-template-columns: 1fr;
  }

  .agent-action {
    grid-template-columns: 1fr;
  }

  .agent-action__buttons {
    justify-content: flex-start;
  }
}
</style>
