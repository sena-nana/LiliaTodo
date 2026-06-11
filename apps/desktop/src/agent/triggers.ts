import type { AgentActionSource, AgentTriggerType } from "./actions";

export interface AgentTriggerSettings {
  automaticTriggersEnabled: boolean;
  throttleMs: number;
}

export interface AgentTriggerEvent {
  trigger: AgentTriggerType;
  taskId?: string;
  summary: string;
  createdAt: string;
}

export interface AgentTriggerEnvelope {
  id: string;
  trigger: AgentTriggerType;
  summary: string;
  taskIds: string[];
  createdAt: string;
}

const DEFAULT_THROTTLE_MS = 60_000;

export class AgentTriggerBuffer {
  private pending = new Map<string, AgentTriggerEnvelope>();

  constructor(
    private settings: AgentTriggerSettings = {
      automaticTriggersEnabled: true,
      throttleMs: DEFAULT_THROTTLE_MS,
    },
    private id: () => string = defaultId,
  ) {}

  updateSettings(settings: Partial<AgentTriggerSettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  push(event: AgentTriggerEvent): AgentTriggerEnvelope | null {
    if (!this.settings.automaticTriggersEnabled && event.trigger !== "manual_scan") {
      return null;
    }
    const key = `${event.trigger}:${event.taskId ?? "global"}`;
    const previous = this.pending.get(key);
    const eventTime = new Date(event.createdAt).getTime();
    if (previous) {
      const previousTime = new Date(previous.createdAt).getTime();
      if (eventTime - previousTime <= this.settings.throttleMs) {
        const merged = {
          ...previous,
          summary: event.summary,
          createdAt: event.createdAt,
          taskIds: event.taskId
            ? [...new Set([...previous.taskIds, event.taskId])]
            : previous.taskIds,
        };
        this.pending.set(key, merged);
        return merged;
      }
    }
    const envelope: AgentTriggerEnvelope = {
      id: this.id(),
      trigger: event.trigger,
      summary: event.summary,
      taskIds: event.taskId ? [event.taskId] : [],
      createdAt: event.createdAt,
    };
    this.pending.set(key, envelope);
    return envelope;
  }

  list() {
    return [...this.pending.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export function triggerEnvelopeToSource(envelope: AgentTriggerEnvelope): AgentActionSource {
  return {
    trigger: envelope.trigger,
    envelopeId: envelope.id,
    summary: envelope.summary,
    taskIds: envelope.taskIds,
  };
}

function defaultId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `agent-envelope-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
