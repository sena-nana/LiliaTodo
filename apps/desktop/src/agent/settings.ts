import { ref, watch } from "vue";

export interface AgentSettings {
  automaticTriggersEnabled: boolean;
}

const STORAGE_KEY = "liliatodo.agentSettings";
const DEFAULT_SETTINGS: AgentSettings = {
  automaticTriggersEnabled: true,
};

const settings = ref<AgentSettings>(loadAgentSettings());

watch(
  settings,
  (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true },
);

export function useAgentSettings() {
  return settings;
}

export function loadAgentSettings(): AgentSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    return {
      automaticTriggersEnabled: parsed.automaticTriggersEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
