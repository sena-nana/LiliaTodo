import { fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { expect, vi } from "vitest";
import type { Component } from "vue";
import { TaskRepositoryKey } from "../src/data/TaskRepositoryContext";
import { AgentAutoTriggerKey } from "../src/agent/autoTriggers";
import { WebdavSecretsStoreKey, WebdavSyncControllerKey } from "../src/sync/settingsSyncContext";
import type { TaskRepository } from "../src/data/taskRepository";
import type { WebdavSyncController } from "../src/sync/defaultSettingsSyncRuntime";
import type { WebdavRunOnceResult, WebdavRunReport, WebdavRuntimeResolution, WebdavSecretsStore } from "../src/sync/webdav";
import Today from "../src/pages/Today.vue";
import Inbox from "../src/pages/Inbox.vue";
import Calendar from "../src/pages/Calendar.vue";
import TaskListPage from "../src/pages/TaskListPage.vue";
import App from "../src/App.vue";
import { createLiliaTodoRouter } from "../src/router";
import { fakeTaskRepository as fakeRepository, taskCategoryFixture, taskListFixture, taskFixture as task } from "./taskFixtures";

const hoistedInvokeMock = vi.hoisted(() => vi.fn());
const hoistedNotificationMocks = vi.hoisted(() => ({
  notifyDueReminders: vi.fn().mockResolvedValue(0),
  listenReminderTicks: vi.fn().mockResolvedValue(vi.fn()),
}));
export const invokeMock = hoistedInvokeMock;
export const notificationMocks = hoistedNotificationMocks;

vi.mock("@tauri-apps/api/core", () => ({ invoke: hoistedInvokeMock }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../src/notifications", () => ({
  OPEN_TASK_EVENT: "liliatodo:open-task",
  notifyDueReminders: hoistedNotificationMocks.notifyDueReminders,
  listenReminderTicks: hoistedNotificationMocks.listenReminderTicks,
}));

export function resetPageTestMocks() {
  invokeMock.mockReset();
  notificationMocks.notifyDueReminders.mockClear();
  notificationMocks.listenReminderTicks.mockClear();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export function renderWithRepository(
  component: Component,
  repository: TaskRepository,
  options: Record<string, unknown> = {},
) {
  const agentAutoTrigger = {
    runStartupChecks: vi.fn().mockResolvedValue(undefined),
    requestReminderDue: vi.fn(),
    stop: vi.fn(),
  };
  return render(component, {
    ...options,
    global: {
      ...(options.global as Record<string, unknown> | undefined),
      provide: {
        [TaskRepositoryKey as symbol]: repository,
        [AgentAutoTriggerKey as symbol]: agentAutoTrigger,
        ...(((options.global as { provide?: Record<symbol, unknown> } | undefined)?.provide) ?? {}),
      },
    },
  });
}

interface DrawerPageScenario {
  name: string;
  taskId: string;
  taskTitle: string;
  makeRepository: (overrides?: { children?: DrawerChildren }) => TaskRepository;
  render: (repository: TaskRepository) => Promise<unknown> | unknown;
  loadCount: (repository: TaskRepository) => number;
}

type DrawerTask = ReturnType<typeof task>;
type DrawerChildren = Record<string, DrawerTask[]>;
type FakeRepositoryOptions = Parameters<typeof fakeRepository>[0];

export const drawerRole = "complementary";

export function drawerPageScenarios(): DrawerPageScenario[] {
  const lists = [
    taskListFixture({ id: "inbox", name: "收件箱", order: 0 }),
    taskListFixture({ id: "project", name: "项目", order: 1 }),
  ];
  const todayTask = task({ id: "today-task", title: "今日任务" });
  const inboxTask = task({ id: "inbox-task", title: "收件箱任务" });
  const calendarTask = task({
    id: "calendar-task",
    title: "日历任务",
    dueAt: "2026-05-17T02:30:00.000Z",
  });
  const listTask = task({ id: "list-task", title: "清单任务", listId: "project" });
  const createDrawerScenario = (
    options: Omit<DrawerPageScenario, "taskId" | "taskTitle" | "makeRepository"> & {
      task: DrawerTask;
      repositoryOptions: (task: DrawerTask, children?: DrawerChildren) => FakeRepositoryOptions;
    },
  ): DrawerPageScenario => ({
    name: options.name,
    taskId: options.task.id,
    taskTitle: options.task.title,
    makeRepository: ({ children } = {}) => fakeRepository({
      lists,
      ...options.repositoryOptions(options.task, children),
    }),
    render: options.render,
    loadCount: options.loadCount,
  });

  return [
    createDrawerScenario({
      name: "Today",
      task: todayTask,
      repositoryOptions: (item, children) => ({
        today: { overdue: [], dueToday: [item], completedToday: [] },
        children,
      }),
      render: (repository) => renderWithRepository(Today, repository),
      loadCount: (repository) => vi.mocked(repository.listToday).mock.calls.length,
    }),
    createDrawerScenario({
      name: "Inbox",
      task: inboxTask,
      repositoryOptions: (item, children) => ({ inbox: [item], children }),
      render: (repository) => renderWithRepository(Inbox, repository),
      loadCount: (repository) => vi.mocked(repository.listInbox).mock.calls.length,
    }),
    createDrawerScenario({
      name: "Calendar",
      task: calendarTask,
      repositoryOptions: (item, children) => ({ agenda: [item], children }),
      render: (repository) => renderWithRepository(Calendar, repository),
      loadCount: (repository) => vi.mocked(repository.listAgenda).mock.calls.length,
    }),
    createDrawerScenario({
      name: "TaskListPage",
      task: listTask,
      repositoryOptions: (item, children) => ({
        listTasks: { project: [item] },
        children,
      }),
      render: (repository) => renderAppAt("/lists/project", repository),
      loadCount: (repository) => vi.mocked(repository.listTasksByList).mock.calls.length,
    }),
  ];
}

export async function openDrawerTask(scenario: DrawerPageScenario, repository: TaskRepository) {
  await scenario.render(repository);
  await clickPageTask(scenario);
  return screen.findByRole(drawerRole, { name: "任务详情" });
}

export async function clickPageTask(scenario: DrawerPageScenario) {
  const item = await screen.findByText(scenario.taskTitle);
  await fireEvent.click(item);
}

export async function sectionByHeading(name: string) {
  const heading = await screen.findByRole("heading", { level: 2, name });
  const section = heading.closest("section, .task-view-section");
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

export function getDrawer() {
  return screen.getByRole(drawerRole, { name: "任务详情" });
}

export function expectDrawerHeading(drawer: HTMLElement, title: string) {
  expect(within(drawer).getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
}

export async function saveCommonDrawerFields(drawer: HTMLElement, scenario: DrawerPageScenario) {
  const controls = within(drawer);
  await fireEvent.update(controls.getByLabelText("任务名"), `${scenario.name}已更新`);
  await fireEvent.update(controls.getByLabelText("详细内容"), `${scenario.name}详细内容`);
  await fireEvent.update(controls.getByLabelText("优先级"), "2");
  await fireEvent.update(controls.getByLabelText("所属清单"), "project");
  await fireEvent.click(controls.getByRole("button", { name: "保存" }));
}

export async function expectPageReloaded(scenario: DrawerPageScenario, repository: TaskRepository) {
  await waitFor(() => expect(scenario.loadCount(repository)).toBeGreaterThan(1));
}

export async function expectDrawerError(message: string) {
  expect(await screen.findByText(`错误：${message}`)).toBeInTheDocument();
  expect(getDrawer()).toBeInTheDocument();
}

export async function renderAppAt(
  path: string,
  repository: TaskRepository,
  provide: Record<symbol, unknown> = {},
) {
  const router = createLiliaTodoRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();

  return renderWithRepository(App, repository, {
    global: {
      plugins: [router],
      provide,
    },
  });
}

interface FakeWebdavControllerOptions {
  kind: "enabled" | "disabled";
  result?: WebdavRunOnceResult;
}

export function fakeWebdavController(
  options: FakeWebdavControllerOptions,
): WebdavSyncController & {
  runOnce: ReturnType<typeof vi.fn>;
  onRunCompleted: ReturnType<typeof vi.fn>;
  emitRunCompleted(report: WebdavRunReport): void;
} {
  const result: WebdavRunOnceResult =
    options.result ?? { ok: false, error: "尚未配置 WebDAV 凭据" };
  const resolution: WebdavRuntimeResolution =
    options.kind === "enabled"
      ? {
        kind: "enabled",
        runner: { runOnce: vi.fn() },
        secrets: {
          baseUrl: "https://dav.jianguoyun.com/dav",
          root: "/liliatodo",
          username: "u",
          password: "p",
          deviceId: "desk-1",
        },
        layout: {} as never,
        provider: {} as never,
        client: {} as never,
      }
      : { kind: "disabled", reason: "尚未配置 WebDAV 凭据" };
  const runOnce = vi.fn().mockResolvedValue(result);
  const listeners = new Set<(report: WebdavRunReport) => void>();
  return {
    inspect: vi.fn().mockResolvedValue(resolution),
    runOnce,
    onRunCompleted: vi.fn((listener: (report: WebdavRunReport) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emitRunCompleted(report: WebdavRunReport) {
      listeners.forEach((listener) => listener(report));
    },
  };
}

export function fakeSecretsStore(saved: Parameters<WebdavSecretsStore["save"]>[0] | null): WebdavSecretsStore {
  return {
    load: vi.fn().mockResolvedValue(saved),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

