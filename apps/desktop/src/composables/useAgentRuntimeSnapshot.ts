import { computed, ref } from "vue";
import {
  formatAgentRuntimeLifecycle,
  isAgentRuntimeRunning,
  loadAgentRuntimeSnapshot,
  startAgentRuntimeAndLoadSnapshot,
  stopAgentRuntimeAndLoadSnapshot,
  type AgentRuntimeSnapshot,
  type AgentRuntimeStatusSnapshot,
  type RuntimeEventShape,
  type ScalarValue,
} from "../agentRuntime";

export type AgentRuntimeCommand = "refresh" | "start" | "stop";

export function useAgentRuntimeSnapshot() {
  const status = ref<AgentRuntimeStatusSnapshot | null>(null);
  const events = ref<RuntimeEventShape[]>([]);
  const loading = ref(true);
  const busyAction = ref<AgentRuntimeCommand | null>(null);
  const error = ref<string | null>(null);
  const runtimeRunning = computed(() => isAgentRuntimeRunning(status.value));

  async function refresh(action: "refresh" | null = null) {
    await run(action, loadAgentRuntimeSnapshot, { setLoading: true });
  }

  async function start() {
    await run("start", startAgentRuntimeAndLoadSnapshot);
  }

  async function stop() {
    await run("stop", stopAgentRuntimeAndLoadSnapshot);
  }

  async function run(
    action: AgentRuntimeCommand | null,
    command: () => Promise<AgentRuntimeSnapshot>,
    options: { setLoading?: boolean } = {},
  ) {
    busyAction.value = action;
    if (options.setLoading) loading.value = true;
    error.value = null;
    try {
      const snapshot = await command();
      status.value = snapshot.status;
      events.value = snapshot.events;
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
      busyAction.value = null;
    }
  }

  return {
    status,
    events,
    loading,
    busyAction,
    error,
    runtimeRunning,
    refresh,
    start,
    stop,
  };
}

export function formatRuntimeEventValue(value: ScalarValue) {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

export { formatAgentRuntimeLifecycle };
