import { vi } from "vitest";
import {
  createAgentActionDraft,
  type AgentAuditRecord,
  type AgentInboxSnapshot,
  type AgentPendingAction,
} from "../src/agent/actions";
import type { TaskRepository } from "../src/data/taskRepository";
import type {
  CreateTaskCategoryInput,
  CreateTaskInput,
  Task,
  TaskCategory,
  TaskList,
  TodayTaskGroups,
  UpdateTaskCategoryInput,
  UpdateTaskInput,
} from "../src/domain/tasks";

export interface FakeTaskRepositoryOverrides {
  today?: TodayTaskGroups;
  activeTasks?: Task[];
  statusTasks?: Record<string, Task[]>;
  searchResults?: Task[];
  inbox?: Task[];
  agenda?: Task[];
  lists?: TaskList[];
  categories?: Record<string, TaskCategory[]>;
  children?: Record<string, Task[]>;
  listTasks?: Record<string, Task[]>;
  dueReminders?: Task[];
  agentInbox?: AgentInboxSnapshot;
}

export function fakeTaskRepository(
  overrides: FakeTaskRepositoryOverrides = {},
): TaskRepository {
  const today = overrides.today ?? {
    overdue: [],
    dueToday: [],
    completedToday: [],
  };
  const syncState = {
    serverCursor: null,
    lastSyncedAt: null,
    lastError: null,
    updatedAt: null,
  };
  const defaultAgentSource = {
    trigger: "manual_scan" as const,
    envelopeId: "test-envelope",
    summary: "测试触发",
    taskIds: ["task-1"],
  };
  const defaultAgentAction = createAgentActionDraft(
    { type: "task.update", taskId: "task-1", patch: { priority: 2 } },
    defaultAgentSource,
  );
  const defaultPending: AgentPendingAction = {
    id: "agent-action-1",
    actionType: defaultAgentAction.action.type,
    status: "pending",
    summary: defaultAgentAction.summary,
    risk: defaultAgentAction.risk,
    source: defaultAgentAction.source,
    payload: defaultAgentAction.action,
    dryRun: defaultAgentAction.dryRun,
    createdAt: "2026-05-16T12:00:00.000Z",
    decidedAt: null,
    decisionReason: null,
    auditBatchId: null,
    error: null,
  };
  const agentInbox = overrides.agentInbox ?? {
    pendingActions: [defaultPending],
    audits: [],
  };
  const defaultAudit: AgentAuditRecord = {
    id: "audit-1",
    batchId: "batch-1",
    actionId: defaultPending.id,
    actionType: defaultPending.actionType,
    payload: defaultPending.payload,
    summary: defaultPending.summary,
    status: "applied",
    reversible: true,
    before: null,
    after: null,
    source: defaultPending.source,
    error: null,
    createdAt: "2026-05-16T12:01:00.000Z",
    undoneAt: null,
  };

  function findTask(taskId: string) {
    const allTasks = [
      ...(overrides.inbox ?? []),
      ...(overrides.activeTasks ?? []),
      ...(overrides.agenda ?? []),
      ...today.overdue,
      ...today.dueToday,
      ...today.completedToday,
      ...Object.values(overrides.children ?? {}).flat(),
      ...Object.values(overrides.listTasks ?? {}).flat(),
    ];
    return allTasks.find((item) => item.id === taskId) ?? taskFixture({ id: taskId });
  }

  const repository = {
    databasePath: "sqlite:liliatodo.db",
    init: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockImplementation((input: CreateTaskInput) =>
      Promise.resolve(taskFixture({
        title: input.title,
        dueAt: input.dueAt ?? null,
        estimateMin: input.estimateMin ?? null,
        listId: input.listId ?? "inbox",
        categoryId: input.categoryId ?? null,
      })),
    ),
    updateTask: vi.fn().mockImplementation((id: string, patch: UpdateTaskInput) =>
      Promise.resolve(taskFixture({ ...findTask(id), ...patch, id })),
    ),
    setStatus: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(taskFixture({ ...findTask(id), status: "completed" })),
    ),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    restoreTask: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(taskFixture({ ...findTask(id), deletedAt: null })),
    ),
    purgeTask: vi.fn().mockResolvedValue(undefined),
    listTasksByStatus: vi.fn().mockImplementation((status: string) =>
      Promise.resolve(overrides.statusTasks?.[status] ?? []),
    ),
    searchTasks: vi.fn().mockResolvedValue(overrides.searchResults ?? []),
    batchUpdateTasks: vi.fn().mockImplementation((input) =>
      Promise.resolve({ succeeded: input.taskIds ?? [], failed: [] }),
    ),
    reorderTasks: vi.fn().mockImplementation((input) =>
      Promise.resolve((input.taskIds ?? []).map((id: string, order: number) => taskFixture({ ...findTask(id), childOrder: order }))),
    ),
    snoozeReminder: vi.fn().mockImplementation((id: string) => Promise.resolve(findTask(id))),
    dismissReminder: vi.fn().mockImplementation((id: string) => Promise.resolve(findTask(id))),
    applyRemoteTask: vi.fn().mockResolvedValue(undefined),
    deleteRemoteTask: vi.fn().mockResolvedValue(undefined),
    applyRemoteList: vi.fn().mockResolvedValue(undefined),
    deleteRemoteList: vi.fn().mockResolvedValue(undefined),
    applyRemoteCategory: vi.fn().mockResolvedValue(undefined),
    deleteRemoteCategory: vi.fn().mockResolvedValue(undefined),
    listActiveTasks: vi.fn().mockResolvedValue(overrides.activeTasks ?? []),
    listTasksByList: vi.fn().mockImplementation((listId: string) =>
      Promise.resolve(overrides.listTasks?.[listId] ?? (listId === "inbox" ? overrides.inbox ?? [] : [])),
    ),
    listTaskChildren: vi.fn().mockImplementation((parentId: string) =>
      Promise.resolve(overrides.children?.[parentId] ?? []),
    ),
    listLists: vi.fn().mockResolvedValue(overrides.lists ?? [taskListFixture()]),
    createList: vi.fn().mockImplementation((input) =>
      Promise.resolve(taskListFixture({ id: "list-new", name: input.name })),
    ),
    updateList: vi.fn().mockImplementation((id, patch) =>
      Promise.resolve(taskListFixture({
        id,
        name: patch.name ?? "清单",
        color: patch.color ?? null,
        order: patch.order ?? 0,
      })),
    ),
    archiveList: vi.fn().mockImplementation((id) =>
      Promise.resolve(taskListFixture({ id, archived: true })),
    ),
    listCategoriesByList: vi.fn().mockImplementation((listId: string) =>
      Promise.resolve(overrides.categories?.[listId] ?? []),
    ),
    createCategory: vi.fn().mockImplementation((input: CreateTaskCategoryInput) =>
      Promise.resolve(taskCategoryFixture({ id: "category-new", listId: input.listId, name: input.name })),
    ),
    updateCategory: vi.fn().mockImplementation((id: string, patch: UpdateTaskCategoryInput) =>
      Promise.resolve(taskCategoryFixture({ id, name: patch.name ?? "分类", order: patch.order ?? 0 })),
    ),
    deleteCategory: vi.fn().mockResolvedValue(undefined),
    listPendingChanges: vi.fn().mockResolvedValue([]),
    markChangeSynced: vi.fn().mockResolvedValue(undefined),
    getSyncState: vi.fn().mockResolvedValue(syncState),
    saveSyncState: vi.fn().mockResolvedValue(syncState),
    recordSyncRun: vi.fn().mockResolvedValue({
      id: "run-1",
      status: "succeeded",
      startedAt: "2026-05-16T12:00:00.000Z",
      finishedAt: "2026-05-16T12:00:00.000Z",
      message: "WebDAV 同步完成（无新增变更）",
      serverCursor: "cursor-0",
    }),
    listRecentSyncRuns: vi.fn().mockResolvedValue([]),
    listToday: vi.fn().mockResolvedValue(today),
    listInbox: vi.fn().mockResolvedValue(overrides.inbox ?? []),
    listAgenda: vi.fn().mockResolvedValue(overrides.agenda ?? []),
    listDueReminders: vi.fn().mockResolvedValue(overrides.dueReminders ?? []),
    getStats: vi.fn().mockResolvedValue({
      databasePath: "sqlite:liliatodo.db",
      totalTasks: 0,
      activeTasks: 0,
      completedTasks: 0,
      pendingLocalChanges: 0,
    }),
    createAgentPendingAction: vi.fn().mockImplementation((draft) =>
      Promise.resolve({
        id: "agent-action-new",
        actionType: draft.action.type,
        status: "pending",
        summary: draft.summary,
        risk: draft.risk,
        source: draft.source,
        payload: draft.action,
        dryRun: draft.dryRun,
        createdAt: "2026-05-16T12:00:00.000Z",
        decidedAt: null,
        decisionReason: null,
        auditBatchId: null,
        error: null,
      }),
    ),
    createAgentPendingActionFromTool: vi.fn().mockImplementation((action, source) =>
      repository.createAgentPendingAction(createAgentActionDraft(action, source)),
    ),
    getAgentInboxSnapshot: vi.fn().mockResolvedValue(agentInbox),
    approveAgentPendingAction: vi.fn().mockResolvedValue(defaultAudit),
    rejectAgentPendingAction: vi.fn().mockImplementation((id: string, reason?: string | null) =>
      Promise.resolve({
        ...defaultPending,
        id,
        status: "rejected",
        decisionReason: reason ?? null,
        decidedAt: "2026-05-16T12:02:00.000Z",
      }),
    ),
    undoAgentAuditBatch: vi.fn().mockResolvedValue([
      { ...defaultAudit, status: "undone", undoneAt: "2026-05-16T12:03:00.000Z" },
    ]),
  } satisfies TaskRepository;

  return repository;
}

export function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "task",
    title: "Task",
    notes: null,
    status: "active",
    priority: 0,
    startAt: null,
    dueAt: null,
    estimateMin: null,
    resources: [],
    reminders: [],
    checklist: [],
    parentId: null,
    childOrder: 0,
    tags: [],
    listId: "inbox",
    categoryId: null,
    recurrence: null,
    deletedAt: null,
    lastReminderNotifiedAt: null,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

export function taskListFixture(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: "inbox",
    name: "收件箱",
    color: null,
    archived: false,
    order: 0,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    ...overrides,
  };
}

export function taskCategoryFixture(overrides: Partial<TaskCategory> = {}): TaskCategory {
  return {
    id: "category",
    listId: "inbox",
    name: "分类",
    order: 0,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    ...overrides,
  };
}
