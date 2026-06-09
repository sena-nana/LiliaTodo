import { vi } from "vitest";
import type { TaskRepository } from "../src/data/taskRepository";
import type {
  CreateTaskListGroupInput,
  CreateTaskInput,
  Task,
  TaskListGroup,
  TaskList,
  TodayTaskGroups,
  UpdateTaskListGroupInput,
  UpdateTaskInput,
} from "../src/domain/tasks";

export interface FakeTaskRepositoryOverrides {
  today?: TodayTaskGroups;
  inbox?: Task[];
  agenda?: Task[];
  lists?: TaskList[];
  listGroups?: TaskListGroup[];
  children?: Record<string, Task[]>;
  listTasks?: Record<string, Task[]>;
  dueReminders?: Task[];
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

  function findTask(taskId: string) {
    const allTasks = [
      ...(overrides.inbox ?? []),
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
    databasePath: "sqlite:momo.db",
    init: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockImplementation((input: CreateTaskInput) =>
      Promise.resolve(taskFixture({
        title: input.title,
        dueAt: input.dueAt ?? null,
        estimateMin: input.estimateMin ?? null,
        listId: input.listId ?? "inbox",
      })),
    ),
    updateTask: vi.fn().mockImplementation((id: string, patch: UpdateTaskInput) =>
      Promise.resolve(taskFixture({ ...findTask(id), ...patch, id })),
    ),
    setStatus: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(taskFixture({ ...findTask(id), status: "completed" })),
    ),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    applyRemoteTask: vi.fn().mockResolvedValue(undefined),
    deleteRemoteTask: vi.fn().mockResolvedValue(undefined),
    applyRemoteList: vi.fn().mockResolvedValue(undefined),
    deleteRemoteList: vi.fn().mockResolvedValue(undefined),
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
        groupId: "groupId" in patch ? patch.groupId ?? null : null,
      })),
    ),
    archiveList: vi.fn().mockImplementation((id) =>
      Promise.resolve(taskListFixture({ id, archived: true })),
    ),
    listListGroups: vi.fn().mockResolvedValue(overrides.listGroups ?? []),
    createListGroup: vi.fn().mockImplementation((input: CreateTaskListGroupInput) =>
      Promise.resolve(taskListGroupFixture({ id: "group-new", name: input.name })),
    ),
    updateListGroup: vi.fn().mockImplementation((id: string, patch: UpdateTaskListGroupInput) =>
      Promise.resolve(taskListGroupFixture({ id, name: patch.name ?? "分类", order: patch.order ?? 0 })),
    ),
    deleteListGroup: vi.fn().mockResolvedValue(undefined),
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
      databasePath: "sqlite:momo.db",
      totalTasks: 0,
      activeTasks: 0,
      completedTasks: 0,
      pendingLocalChanges: 0,
    }),
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
    groupId: null,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    ...overrides,
  };
}

export function taskListGroupFixture(overrides: Partial<TaskListGroup> = {}): TaskListGroup {
  return {
    id: "group",
    name: "分类",
    order: 0,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    ...overrides,
  };
}
