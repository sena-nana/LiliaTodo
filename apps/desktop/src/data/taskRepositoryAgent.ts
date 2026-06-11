import {
  createAgentActionDraft,
  type AgentActionDraft,
  type AgentActionSource,
  type AgentActionType,
  type AgentAuditRecord,
  type AgentAuditStatus,
  type AgentInboxSnapshot,
  type AgentPendingAction,
  type AgentPendingActionStatus,
  type AgentRiskLevel,
  type AgentToolInput,
} from "../agent/actions";
import { executeAgentAction, undoAgentAction } from "../agent/executor";
import type { TaskRepository } from "./taskRepository";
import type { RepositoryContext } from "./taskRepositoryCore";
import { readableError } from "./taskRepositoryUtils";

interface AgentPendingActionRow {
  id: string;
  action_type: AgentActionType;
  status: AgentPendingActionStatus;
  summary: string;
  risk: AgentRiskLevel;
  source: string;
  payload: string;
  dry_run: string;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  audit_batch_id: string | null;
  error: string | null;
}

interface AgentAuditRecordRow {
  id: string;
  batch_id: string;
  action_id: string;
  action_type: AgentActionType;
  action_payload?: string;
  summary: string;
  status: AgentAuditStatus;
  reversible: number | boolean;
  before_payload: string;
  after_payload: string;
  source: string;
  error: string | null;
  created_at: string;
  undone_at: string | null;
}

export type TaskRepositoryAgentMethods = Pick<
  TaskRepository,
  | "createAgentPendingAction"
  | "createAgentPendingActionFromTool"
  | "getAgentInboxSnapshot"
  | "approveAgentPendingAction"
  | "rejectAgentPendingAction"
  | "undoAgentAuditBatch"
>;

export function createTaskRepositoryAgent(
  ctx: RepositoryContext,
  repository: () => TaskRepository,
): TaskRepositoryAgentMethods {
  const { getDb, init, now, id } = ctx;

  async function selectPendingAction(actionId: string) {
    const db = await getDb();
    const rows = await db.select<AgentPendingActionRow>(
      "SELECT * FROM agent_pending_actions WHERE id = $1 LIMIT 1",
      [actionId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("Agent 待确认操作不存在");
    }
    return mapAgentPendingActionRow(row);
  }

  async function insertAgentAuditRecord(
    action: AgentPendingAction,
    execution: Awaited<ReturnType<typeof executeAgentAction>>,
    batchId: string,
    createdAt: string,
  ) {
    const db = await getDb();
    const audit: AgentAuditRecord = {
      id: id(),
      batchId,
      actionId: action.id,
      actionType: action.actionType,
      payload: action.payload,
      summary: action.summary,
      status: "applied",
      reversible: execution.reversible,
      before: execution.before,
      after: execution.after,
      source: action.source,
      error: null,
      createdAt,
      undoneAt: null,
    };
    await db.execute(
      `INSERT INTO agent_audit_records (
        id, batch_id, action_id, action_type, action_payload, summary, status, reversible,
        before_payload, after_payload, source, error, created_at, undone_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        audit.id,
        audit.batchId,
        audit.actionId,
        audit.actionType,
        JSON.stringify(action.payload),
        audit.summary,
        audit.status,
        audit.reversible ? 1 : 0,
        JSON.stringify(audit.before),
        JSON.stringify(audit.after),
        JSON.stringify(audit.source),
        audit.error,
        audit.createdAt,
        audit.undoneAt,
      ],
    );
    return audit;
  }

  return {
    async createAgentPendingAction(draft: AgentActionDraft) {
      await init();
      const timestamp = now().toISOString();
      const action: AgentPendingAction = {
        id: id(),
        actionType: draft.action.type,
        status: "pending",
        summary: draft.summary,
        risk: draft.risk,
        source: draft.source,
        payload: draft.action,
        dryRun: draft.dryRun,
        createdAt: timestamp,
        decidedAt: null,
        decisionReason: null,
        auditBatchId: null,
        error: null,
      };
      const db = await getDb();
      await db.execute(
        `INSERT INTO agent_pending_actions (
          id, action_type, status, summary, risk, source, payload, dry_run,
          created_at, decided_at, decision_reason, audit_batch_id, error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          action.id,
          action.actionType,
          action.status,
          action.summary,
          action.risk,
          JSON.stringify(action.source),
          JSON.stringify(action.payload),
          JSON.stringify(action.dryRun),
          action.createdAt,
          action.decidedAt,
          action.decisionReason,
          action.auditBatchId,
          action.error,
        ],
      );
      return action;
    },

    async createAgentPendingActionFromTool(action: AgentToolInput, source: AgentActionSource) {
      return this.createAgentPendingAction(createAgentActionDraft(action, source));
    },

    async getAgentInboxSnapshot(): Promise<AgentInboxSnapshot> {
      await init();
      const db = await getDb();
      const [pendingRows, auditRows] = await Promise.all([
        db.select<AgentPendingActionRow>(
          `SELECT * FROM agent_pending_actions
           ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`,
        ),
        db.select<AgentAuditRecordRow>(
          `SELECT * FROM agent_audit_records
           ORDER BY created_at DESC
           LIMIT 80`,
        ),
      ]);
      return {
        pendingActions: pendingRows.map(mapAgentPendingActionRow),
        audits: auditRows.map(mapAgentAuditRecordRow),
      };
    },

    async approveAgentPendingAction(actionId: string) {
      await init();
      const action = await selectPendingAction(actionId);
      if (action.status !== "pending") {
        throw new Error("Agent 操作已处理");
      }
      const timestamp = now().toISOString();
      const batchId = id();
      const db = await getDb();
      try {
        const execution = await executeAgentAction(repository(), action.payload);
        const audit = await insertAgentAuditRecord(action, execution, batchId, timestamp);
        await db.execute(
          `UPDATE agent_pending_actions
           SET status = $1, decided_at = $2, audit_batch_id = $3, error = $4
           WHERE id = $5`,
          ["approved", timestamp, batchId, null, action.id],
        );
        return audit;
      } catch (error) {
        const message = readableError(error);
        await db.execute(
          `UPDATE agent_pending_actions
           SET status = $1, decided_at = $2, error = $3
           WHERE id = $4`,
          ["failed", timestamp, message, action.id],
        );
        throw new Error(message);
      }
    },

    async rejectAgentPendingAction(actionId: string, reason = null) {
      await init();
      const action = await selectPendingAction(actionId);
      if (action.status !== "pending") {
        throw new Error("Agent 操作已处理");
      }
      const timestamp = now().toISOString();
      const db = await getDb();
      await db.execute(
        `UPDATE agent_pending_actions
         SET status = $1, decided_at = $2, decision_reason = $3
         WHERE id = $4`,
        ["rejected", timestamp, reason, action.id],
      );
      return {
        ...action,
        status: "rejected",
        decidedAt: timestamp,
        decisionReason: reason,
      };
    },

    async undoAgentAuditBatch(batchId: string) {
      await init();
      const db = await getDb();
      const rows = await db.select<AgentAuditRecordRow>(
        `SELECT * FROM agent_audit_records
         WHERE batch_id = $1
         ORDER BY created_at DESC`,
        [batchId],
      );
      const audits = rows.map(mapAgentAuditRecordRow);
      if (audits.length === 0) {
        throw new Error("Agent 审计批次不存在");
      }
      const timestamp = now().toISOString();
      const results: AgentAuditRecord[] = [];
      for (const audit of audits) {
        if (audit.status !== "applied") {
          results.push(audit);
          continue;
        }
        if (!audit.reversible) {
          await db.execute(
            `UPDATE agent_audit_records
             SET status = $1, error = $2
             WHERE id = $3`,
            ["undo_failed", "该操作不可撤销", audit.id],
          );
          results.push({ ...audit, status: "undo_failed", error: "该操作不可撤销" });
          continue;
        }
        try {
          await undoAgentAction(repository(), auditActionPayload(audit), audit.before, audit.after);
          await db.execute(
            `UPDATE agent_audit_records
             SET status = $1, undone_at = $2, error = $3
             WHERE id = $4`,
            ["undone", timestamp, null, audit.id],
          );
          results.push({ ...audit, status: "undone", undoneAt: timestamp, error: null });
        } catch (error) {
          const message = readableError(error);
          await db.execute(
            `UPDATE agent_audit_records
             SET status = $1, error = $2
             WHERE id = $3`,
            ["undo_failed", message, audit.id],
          );
          results.push({ ...audit, status: "undo_failed", error: message });
        }
      }
      return results;
    },
  };
}

function mapAgentPendingActionRow(row: AgentPendingActionRow): AgentPendingAction {
  return {
    id: row.id,
    actionType: row.action_type,
    status: row.status,
    summary: row.summary,
    risk: row.risk,
    source: parseJson(row.source, fallbackSource()),
    payload: parseJson(row.payload, { type: row.action_type } as AgentToolInput),
    dryRun: parseJson(row.dry_run, {
      reversible: false,
      requiresConfirmation: true,
      affectedTaskIds: [],
      impact: "缺少 dry-run 结果",
    }),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    auditBatchId: row.audit_batch_id,
    error: row.error,
  };
}

function mapAgentAuditRecordRow(row: AgentAuditRecordRow): AgentAuditRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    actionId: row.action_id,
    actionType: row.action_type,
    payload: parseJson(row.action_payload ?? "{}", { type: row.action_type } as AgentToolInput),
    summary: row.summary,
    status: row.status,
    reversible: row.reversible === true || row.reversible === 1,
    before: parseJson(row.before_payload, null),
    after: parseJson(row.after_payload, null),
    source: parseJson(row.source, fallbackSource()),
    error: row.error,
    createdAt: row.created_at,
    undoneAt: row.undone_at,
  };
}

function auditActionPayload(audit: AgentAuditRecord): AgentToolInput {
  return audit.payload;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fallbackSource(): AgentActionSource {
  return {
    trigger: "manual_scan",
    envelopeId: "unknown",
    summary: "未知来源",
    taskIds: [],
  };
}
