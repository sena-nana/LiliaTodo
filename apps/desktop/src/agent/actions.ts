import {
  DEFAULT_TASK_LIST_ID,
  type CreateTaskCategoryInput,
  type CreateTaskInput,
  type CreateTaskListInput,
  type Task,
  type UpdateTaskInput,
} from "../domain/tasks";

export const AGENT_ACTION_TYPES = [
  "task.create",
  "task.update",
  "task.complete",
  "task.restore",
  "task.delete",
  "task.move",
  "task.reparent",
  "taskList.create",
  "taskCategory.create",
] as const;

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];
export type AgentRiskLevel = "low" | "medium" | "high";
export type AgentPendingActionStatus = "pending" | "approved" | "rejected" | "failed";
export type AgentAuditStatus = "applied" | "undone" | "undo_failed";
export type AgentTriggerType =
  | "task.created"
  | "task.updated"
  | "task.overdue"
  | "task.reminder_due"
  | "daily_startup"
  | "manual_scan";

export interface AgentActionSource {
  trigger: AgentTriggerType;
  envelopeId: string;
  summary: string;
  taskIds: string[];
  codexThreadId?: string | null;
  codexTurnId?: string | null;
}

export type AgentToolInput =
  | { type: "task.create"; input: CreateTaskInput }
  | { type: "task.update"; taskId: string; patch: UpdateTaskInput }
  | { type: "task.complete"; taskId: string }
  | { type: "task.restore"; taskId: string }
  | { type: "task.delete"; taskId: string }
  | { type: "task.move"; taskId: string; listId: string; categoryId?: string | null }
  | { type: "task.reparent"; taskId: string; parentId: string | null; childOrder?: number }
  | { type: "taskList.create"; input: CreateTaskListInput }
  | { type: "taskCategory.create"; input: CreateTaskCategoryInput };

export interface AgentToolDefinition {
  type: AgentActionType;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  defaultRisk: AgentRiskLevel;
  requiresConfirmation: true;
}

export interface AgentActionDraft {
  action: AgentToolInput;
  source: AgentActionSource;
  summary: string;
  risk: AgentRiskLevel;
  dryRun: AgentDryRunResult;
}

export interface AgentDryRunResult {
  reversible: boolean;
  requiresConfirmation: true;
  affectedTaskIds: string[];
  impact: string;
}

export interface AgentPendingAction {
  id: string;
  actionType: AgentActionType;
  status: AgentPendingActionStatus;
  summary: string;
  risk: AgentRiskLevel;
  source: AgentActionSource;
  payload: AgentToolInput;
  dryRun: AgentDryRunResult;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  auditBatchId: string | null;
  error: string | null;
}

export interface AgentAuditRecord {
  id: string;
  batchId: string;
  actionId: string;
  actionType: AgentActionType;
  payload: AgentToolInput;
  summary: string;
  status: AgentAuditStatus;
  reversible: boolean;
  before: unknown;
  after: unknown;
  source: AgentActionSource;
  error: string | null;
  createdAt: string;
  undoneAt: string | null;
}

export interface AgentInboxSnapshot {
  pendingActions: AgentPendingAction[];
  audits: AgentAuditRecord[];
}

export const TODO_AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  tool("task.create", "创建任务", "创建一个新任务，可设置备注、时间、估时、标签和提醒。", "low", {
    title: "string",
    notes: "string|null",
    priority: "0|1|2|3",
    startAt: "iso|null",
    dueAt: "iso|null",
    estimateMin: "number|null",
    tags: "string[]",
    reminders: "TaskReminder[]",
    listId: "string",
    categoryId: "string|null",
  }),
  tool("task.update", "更新任务", "更新任务标题、备注、优先级、时间、估时、标签或提醒。", "medium", {
    taskId: "string",
    patch: "UpdateTaskInput",
  }),
  tool("task.complete", "完成任务", "把任务标记为已完成。", "high", { taskId: "string" }),
  tool("task.restore", "恢复任务", "把已完成任务恢复为 active。", "medium", { taskId: "string" }),
  tool("task.delete", "删除任务", "删除指定任务。", "high", { taskId: "string" }),
  tool("task.move", "移动任务", "移动任务到指定清单或分类。", "high", {
    taskId: "string",
    listId: "string",
    categoryId: "string|null",
  }),
  tool("task.reparent", "调整父子关系", "调整任务父级和子任务顺序。", "high", {
    taskId: "string",
    parentId: "string|null",
    childOrder: "number",
  }),
  tool("taskList.create", "创建清单", "创建新的任务清单。", "low", {
    name: "string",
    color: "string|null",
  }),
  tool("taskCategory.create", "创建分类", "在指定清单下创建分类。", "low", {
    listId: "string",
    name: "string",
  }),
];

export function createAgentActionDraft(
  action: AgentToolInput,
  source: AgentActionSource,
): AgentActionDraft {
  const risk = riskForAction(action);
  return {
    action,
    source,
    summary: summarizeAgentAction(action),
    risk,
    dryRun: dryRunAgentAction(action),
  };
}

export function summarizeAgentAction(action: AgentToolInput) {
  switch (action.type) {
    case "task.create":
      return `创建任务「${action.input.title.trim()}」`;
    case "task.update":
      return `更新任务 ${action.taskId}：${summarizePatch(action.patch)}`;
    case "task.complete":
      return `完成任务 ${action.taskId}`;
    case "task.restore":
      return `恢复任务 ${action.taskId}`;
    case "task.delete":
      return `删除任务 ${action.taskId}`;
    case "task.move":
      return `移动任务 ${action.taskId} 到清单 ${action.listId}`;
    case "task.reparent":
      return `调整任务 ${action.taskId} 的父子关系`;
    case "taskList.create":
      return `创建清单「${action.input.name.trim()}」`;
    case "taskCategory.create":
      return `创建分类「${action.input.name.trim()}」`;
  }
}

export function dryRunAgentAction(action: AgentToolInput): AgentDryRunResult {
  const affectedTaskIds = affectedTasksForAction(action);
  return {
    reversible: action.type !== "task.delete",
    requiresConfirmation: true,
    affectedTaskIds,
    impact: impactForAction(action, affectedTaskIds.length),
  };
}

export function riskForAction(action: AgentToolInput): AgentRiskLevel {
  if (action.type === "task.delete" || action.type === "task.complete" || action.type === "task.move" || action.type === "task.reparent") {
    return "high";
  }
  if (action.type === "task.update" || action.type === "task.restore") {
    return "medium";
  }
  return "low";
}

export function buildUndoAction(
  action: AgentToolInput,
  before: unknown,
  after: unknown = null,
): AgentToolInput | null {
  switch (action.type) {
    case "task.create": {
      const created = after as Task | null;
      return created?.id ? { type: "task.delete", taskId: created.id } : null;
    }
    case "task.complete":
    case "task.restore": {
      const task = before as Task | null;
      if (!task) return null;
      return task.status === "completed"
        ? { type: "task.complete", taskId: task.id }
        : { type: "task.restore", taskId: task.id };
    }
    case "task.update":
    case "task.move":
    case "task.reparent": {
      const task = before as Task | null;
      if (!task) return null;
      return task.status === "completed"
        ? { type: "task.complete", taskId: task.id }
        : {
            type: "task.update",
            taskId: task.id,
            patch: taskToUpdatePatch(task),
          };
    }
    default:
      return null;
  }
}

export function taskToUpdatePatch(task: Task): UpdateTaskInput {
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    startAt: task.startAt,
    dueAt: task.dueAt,
    estimateMin: task.estimateMin,
    resources: task.resources,
    reminders: task.reminders,
    checklist: task.checklist,
    parentId: task.parentId,
    childOrder: task.childOrder,
    tags: task.tags,
    listId: task.listId || DEFAULT_TASK_LIST_ID,
    categoryId: task.categoryId,
  };
}

function tool(
  type: AgentActionType,
  title: string,
  description: string,
  defaultRisk: AgentRiskLevel,
  inputSchema: Record<string, unknown>,
): AgentToolDefinition {
  return {
    type,
    title,
    description,
    inputSchema,
    defaultRisk,
    requiresConfirmation: true,
  };
}

function affectedTasksForAction(action: AgentToolInput) {
  switch (action.type) {
    case "task.create":
    case "taskList.create":
    case "taskCategory.create":
      return [];
    default:
      return [action.taskId];
  }
}

function impactForAction(action: AgentToolInput, affectedCount: number) {
  switch (action.type) {
    case "task.create":
      return "将新增 1 个任务，确认后进入本地变更和 WebDAV 同步链路。";
    case "taskList.create":
      return "将新增 1 个清单。";
    case "taskCategory.create":
      return "将新增 1 个分类。";
    case "task.delete":
      return "将删除 1 个任务，执行前必须单独确认，审计中标记为不可撤销。";
    default:
      return `将影响 ${Math.max(affectedCount, 1)} 个任务，确认后写入本地任务库。`;
  }
}

function summarizePatch(patch: UpdateTaskInput) {
  const labels: string[] = [];
  if ("title" in patch) labels.push("标题");
  if ("notes" in patch) labels.push("备注");
  if ("priority" in patch) labels.push("优先级");
  if ("startAt" in patch) labels.push("开始时间");
  if ("dueAt" in patch) labels.push("截止时间");
  if ("estimateMin" in patch) labels.push("估时");
  if ("tags" in patch) labels.push("标签");
  if ("reminders" in patch) labels.push("提醒");
  if ("listId" in patch) labels.push("清单");
  if ("categoryId" in patch) labels.push("分类");
  if ("parentId" in patch || "childOrder" in patch) labels.push("父子关系");
  return labels.length > 0 ? labels.join("、") : "无字段变更";
}
