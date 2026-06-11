import type { TaskRepository } from "./taskRepository";
import {
  emptySyncState,
  mapLocalChangeRow,
  mapSyncRunRow,
  mapSyncStateRow,
} from "./taskRepositoryRows";
import { SYNC_STATE_ID } from "./taskRepositorySql";
import type {
  LocalChangeRow,
  RepositoryContext,
  SyncRun,
  SyncRunRow,
  SyncStateRow,
} from "./taskRepositoryCore";

export type TaskRepositorySyncMethods = Pick<
  TaskRepository,
  | "listPendingChanges"
  | "markChangeSynced"
  | "getSyncState"
  | "saveSyncState"
  | "recordSyncRun"
  | "listRecentSyncRuns"
>;

export function createTaskRepositorySync(ctx: RepositoryContext): TaskRepositorySyncMethods {
  const { getDb, init, now, syncRunId } = ctx;

  return {
    async listPendingChanges() {
      await init();
      const db = await getDb();
      const rows = await db.select<LocalChangeRow>(
        `SELECT * FROM local_changes
         WHERE synced_at IS NULL
         ORDER BY created_at ASC`,
      );
      return rows.map(mapLocalChangeRow);
    },

    async markChangeSynced(changeIdToMark, syncedAt = now()) {
      await init();
      const db = await getDb();
      await db.execute("UPDATE local_changes SET synced_at = $1 WHERE id = $2", [
        syncedAt.toISOString(),
        changeIdToMark,
      ]);
    },

    async getSyncState() {
      await init();
      const db = await getDb();
      const rows = await db.select<SyncStateRow>(
        "SELECT * FROM sync_state WHERE id = $1 LIMIT 1",
        [SYNC_STATE_ID],
      );
      return rows[0] ? mapSyncStateRow(rows[0]) : emptySyncState();
    },

    async saveSyncState(input) {
      await init();
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute(
        `INSERT INTO sync_state (
          id, server_cursor, last_synced_at, last_error, updated_at
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(id) DO UPDATE SET
          server_cursor = excluded.server_cursor,
          last_synced_at = excluded.last_synced_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`,
        [SYNC_STATE_ID, input.serverCursor, input.lastSyncedAt, input.lastError, timestamp],
      );
      return { ...input, updatedAt: timestamp };
    },

    async recordSyncRun(input) {
      await init();
      const run: SyncRun = { id: syncRunId(), ...input };
      const db = await getDb();
      await db.execute(
        `INSERT INTO sync_runs (
          id, status, started_at, finished_at, message, server_cursor
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [run.id, run.status, run.startedAt, run.finishedAt, run.message, run.serverCursor],
      );
      return run;
    },

    async listRecentSyncRuns(limit) {
      await init();
      const normalizedLimit = Math.max(0, Math.floor(limit));
      if (normalizedLimit === 0) return [];
      const db = await getDb();
      const rows = await db.select<SyncRunRow>(
        `SELECT * FROM sync_runs
         ORDER BY started_at DESC
         LIMIT $1`,
        [normalizedLimit],
      );
      return rows.map(mapSyncRunRow);
    },
  };
}
