import { invoke } from "@tauri-apps/api/core";

export type AgentRuntimeLifecycle = "bootstrapping" | "disabled";
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
