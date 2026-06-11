import { invoke } from "@tauri-apps/api/core";
import type { AgentToolInput } from "./agent/actions";
import type { AgentTaskContextSnapshot } from "./agent/context";

export type AgentRuntimeLifecycle = "bootstrapping" | "disabled" | "running";
export type AgentPhase = "spawn" | "awake" | "sleep" | "stop";
export type RuntimeEventKind =
  | "lifecycle"
  | "routing"
  | "operation"
  | "resource"
  | "trace"
  | "backend";

export type ScalarValue = string | number | boolean;

export interface RuntimeErrorShape {
  code: string;
  source: string;
  route: string;
  lost_capability: string | null;
  recovery: string | null;
  cause: RuntimeErrorShape | null;
  evidence: Record<string, ScalarValue>;
}

export interface RuntimeEventShape {
  sequence: number;
  kind: RuntimeEventKind;
  name: string;
  agent_id: string | null;
  attributes: Record<string, ScalarValue>;
  error: RuntimeErrorShape | null;
}

export interface AgentRuntimeStatusSnapshot {
  lifecycle: AgentRuntimeLifecycle;
  agent_id: string | null;
  agent_phase: AgentPhase | null;
  backend_configured: boolean;
  disabled_reason: string | null;
  buffered_event_count: number;
}

export interface AgentRuntimeEventsSnapshot {
  events: RuntimeEventShape[];
}

export interface AgentRuntimeSnapshot {
  status: AgentRuntimeStatusSnapshot;
  events: RuntimeEventShape[];
}

export interface AgentRunnerSuggestion {
  action_type: string;
  summary: string;
  risk: string;
  action: AgentToolInput;
  task_ids: string[];
  codex_thread_id?: string | null;
  codex_turn_id?: string | null;
}

export interface AgentRunnerTriggerResult {
  status: "disabled" | "ready";
  diagnostic: string;
  suggestions: AgentRunnerSuggestion[];
}

const FALLBACK_AGENT_ID = "local-agent";
const FALLBACK_DISABLED_REASON = "尚未配置 backend，Agent 已禁用。";

const browserFallbackEvents: AgentRuntimeEventsSnapshot = {
  events: [
    {
      sequence: 1,
      kind: "lifecycle",
      name: "runtime.bootstrap",
      agent_id: FALLBACK_AGENT_ID,
      attributes: {},
      error: null,
    },
    {
      sequence: 2,
      kind: "lifecycle",
      name: "runtime.disabled",
      agent_id: FALLBACK_AGENT_ID,
      attributes: {
        reason: FALLBACK_DISABLED_REASON,
        backend_configured: false,
      },
      error: null,
    },
  ],
};

const browserFallbackStatus: AgentRuntimeStatusSnapshot = {
  lifecycle: "disabled",
  agent_id: FALLBACK_AGENT_ID,
  agent_phase: "stop",
  backend_configured: false,
  disabled_reason: FALLBACK_DISABLED_REASON,
  buffered_event_count: browserFallbackEvents.events.length,
};

function runningInTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAgentRuntimeStatus(): Promise<AgentRuntimeStatusSnapshot> {
  if (!runningInTauri()) return browserFallbackStatus;
  return invoke<AgentRuntimeStatusSnapshot>("agent_runtime_get_status");
}

export async function listAgentRuntimeEvents(): Promise<AgentRuntimeEventsSnapshot> {
  if (!runningInTauri()) return browserFallbackEvents;
  return invoke<AgentRuntimeEventsSnapshot>("agent_runtime_list_events");
}

export async function loadAgentRuntimeSnapshot(): Promise<AgentRuntimeSnapshot> {
  const [status, eventSnapshot] = await Promise.all([
    getAgentRuntimeStatus(),
    listAgentRuntimeEvents(),
  ]);
  return {
    status,
    events: eventSnapshot.events,
  };
}

export function isAgentRuntimeRunning(status: AgentRuntimeStatusSnapshot | null | undefined) {
  return status?.lifecycle === "running" && status.backend_configured;
}

export async function startAgentRuntime(): Promise<AgentRuntimeStatusSnapshot> {
  if (!runningInTauri()) return browserFallbackStatus;
  return invoke<AgentRuntimeStatusSnapshot>("agent_runtime_start");
}

export async function stopAgentRuntime(): Promise<AgentRuntimeStatusSnapshot> {
  if (!runningInTauri()) return browserFallbackStatus;
  return invoke<AgentRuntimeStatusSnapshot>("agent_runtime_stop");
}

export async function startAgentRuntimeAndLoadSnapshot(): Promise<AgentRuntimeSnapshot> {
  await startAgentRuntime();
  return loadAgentRuntimeSnapshot();
}

export async function stopAgentRuntimeAndLoadSnapshot(): Promise<AgentRuntimeSnapshot> {
  await stopAgentRuntime();
  return loadAgentRuntimeSnapshot();
}

export async function triggerAgentRuntimeScan(snapshot: AgentTaskContextSnapshot): Promise<AgentRunnerTriggerResult> {
  if (!runningInTauri()) {
    return {
      status: "disabled",
      diagnostic: "缺少 Codex CLI 或无法启动：当前浏览器预览不运行 Tauri runner。",
      suggestions: [],
    };
  }
  return invoke<AgentRunnerTriggerResult>("agent_runtime_trigger_scan", { snapshot });
}

export function formatAgentRuntimeLifecycle(value: AgentRuntimeLifecycle | null | undefined) {
  switch (value) {
    case "bootstrapping":
      return "初始化中";
    case "disabled":
      return "已禁用";
    case "running":
      return "运行中";
    default:
      return "未知";
  }
}
