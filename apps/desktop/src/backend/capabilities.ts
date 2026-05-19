// AB-01：服务端能力探测开关。
// UI 入口（例如「让 Agent 拆解任务」按钮）按 capabilities.has(cap) 决定是否可见/可点。
// 一期默认 has 全 false；未来连上服务端后由 meta.capabilities 响应填充。

export type Capability =
  | "sync"
  | "tasks"
  | "calendar"
  | "gates"
  | "sandbox"
  | "mcp";

export interface Capabilities {
  has(cap: Capability): boolean;
  version(cap: Capability): string | null;
}

export const noopCapabilities: Capabilities = {
  has() {
    return false;
  },
  version() {
    return null;
  },
};

export function createCapabilities(
  table: Partial<Record<Capability, string>>,
): Capabilities {
  return {
    has(cap) {
      return Object.prototype.hasOwnProperty.call(table, cap);
    },
    version(cap) {
      return table[cap] ?? null;
    },
  };
}
