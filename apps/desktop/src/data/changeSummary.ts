import type { LocalChange } from "./taskRepository";

export interface PendingLocalChangeSummary {
  id: string;
  entityLabel: string;
  action: LocalChange["action"];
  createdAt: string;
  payloadSummary: string;
}

export function summarizePendingLocalChanges(
  changes: LocalChange[],
  limit = 5,
): PendingLocalChangeSummary[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  return changes.slice(0, normalizedLimit).map((change) => ({
    id: change.id,
    entityLabel: `${change.entityType}:${change.entityId}`,
    action: change.action,
    createdAt: change.createdAt,
    payloadSummary: summarizeClientPayload(change.payload),
  }));
}

function summarizeClientPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return String(payload);
  }

  const entries = Object.entries(payload as Record<string, unknown>).filter(
    ([key]) => key !== "id" && key !== "baseVersion" && key !== "updatedAt",
  );
  if (entries.length === 0) {
    return "空 payload";
  }

  return entries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
}
