import type {
  LocalChange,
  LocalChangeRow,
  SyncRun,
  SyncRunRow,
  SyncState,
  SyncStateRow,
} from "./taskRepository";

export function mapLocalChangeRow(row: LocalChangeRow): LocalChange {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  };
}

export function mapSyncStateRow(row: SyncStateRow): SyncState {
  return {
    serverCursor: row.server_cursor,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function mapSyncRunRow(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    message: row.message,
    serverCursor: row.server_cursor,
  };
}

export function emptySyncState(): SyncState {
  return {
    serverCursor: null,
    lastSyncedAt: null,
    lastError: null,
    updatedAt: null,
  };
}

function parsePayload(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
