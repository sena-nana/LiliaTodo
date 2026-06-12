import { fireEvent, screen, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeMock, renderWithRepository, resetPageTestMocks } from "./pageTestUtils";
import AgentInbox from "../src/pages/AgentInbox.vue";
import { fakeTaskRepository as fakeRepository, taskCategoryFixture, taskListFixture, taskFixture as task } from "./taskFixtures";

afterEach(resetPageTestMocks);

it('Agent 收件箱显示只读复盘报告', async () => {
  const repository = fakeRepository({ agentInbox: { pendingActions: [], audits: [] } });
  renderWithRepository(AgentInbox, repository);
  expect(await screen.findByRole('heading', { name: '复盘报告' })).toBeInTheDocument();
  expect(repository.updateTask).not.toHaveBeenCalled();
});

describe("pages.agent", () => {
  it("Agent 收件箱页面显示未配置 backend 时的禁用状态", async () => {
    renderWithRepository(AgentInbox, fakeRepository());

    expect(await screen.findByText("Agent 收件箱")).toBeInTheDocument();
    expect(screen.getByText("尚未配置 backend，Agent 已禁用。", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("已禁用")).toBeInTheDocument();
    expect(screen.getByText("backend 未配置")).toBeInTheDocument();
    expect(screen.getByText("#2 runtime.disabled")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "触发扫描" })).toBeDisabled();
  });


  it("Agent 收件箱触发扫描后写入待确认操作", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const repository = fakeRepository({
      activeTasks: [task({ id: "task-1", title: "整理报告" })],
      lists: [taskListFixture({ id: "inbox", name: "收件箱" })],
      categories: {
        inbox: [taskCategoryFixture({ id: "work", listId: "inbox", name: "工作" })],
      },
      agentInbox: { pendingActions: [], audits: [] },
    });
    const action = { type: "task.update" as const, taskId: "task-1", patch: { priority: 2 } };
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "agent_runtime_get_status") {
        return Promise.resolve({
          lifecycle: "running",
          agent_id: "momo-agent",
          agent_phase: "awake",
          backend_configured: true,
          disabled_reason: null,
          buffered_event_count: 0,
        });
      }
      if (command === "agent_runtime_list_events") {
        return Promise.resolve({ events: [] });
      }
      if (command === "agent_runtime_trigger_scan") {
        return Promise.resolve({
          status: "ready",
          diagnostic: "Codex 扫描完成，生成 1 条待确认建议。",
          suggestions: [{
            action_type: "task.update",
            summary: "提高任务优先级",
            risk: "medium",
            action,
            task_ids: ["task-1"],
            codex_thread_id: "thread-1",
            codex_turn_id: "turn-1",
          }],
          args,
        });
      }
      return Promise.reject(new Error(`未预期的 Tauri 命令：${command}`));
    });

    renderWithRepository(AgentInbox, repository);

    await screen.findByText("Agent 收件箱");
    await fireEvent.click(screen.getByRole("button", { name: "触发扫描" }));

    await waitFor(() => {
      expect(repository.createAgentPendingActionFromTool).toHaveBeenCalledWith(action, expect.objectContaining({
        trigger: "manual_scan",
        envelopeId: expect.stringMatching(/^manual-scan-/),
        summary: "手动扫描",
        taskIds: ["task-1"],
        codexThreadId: "thread-1",
        codexTurnId: "turn-1",
      }));
    });
    const triggerCall = invokeMock.mock.calls.find(([command]) => command === "agent_runtime_trigger_scan");
    expect(triggerCall?.[1]).toEqual({
      snapshot: expect.objectContaining({
        tasks: [expect.objectContaining({ id: "task-1", title: "整理报告" })],
        lists: [expect.objectContaining({ id: "inbox", name: "收件箱" })],
        categories: [expect.objectContaining({ id: "work", name: "工作" })],
      }),
    });
    expect(repository.listActiveTasks).toHaveBeenCalled();
    expect(repository.listLists).toHaveBeenCalled();
    expect(repository.listCategoriesByList).toHaveBeenCalledWith("inbox");
    expect(repository.getAgentInboxSnapshot).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("Codex 扫描完成，生成 1 条待确认建议。")).toBeInTheDocument(),
    );
  });


  it("Agent 收件箱运行中会刷新后台入队的待确认操作", async () => {
    vi.useFakeTimers();
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const repository = fakeRepository({ agentInbox: { pendingActions: [], audits: [] } });
    const pendingAction = {
      id: "agent-action-auto",
      actionType: "task.update" as const,
      status: "pending" as const,
      summary: "更新任务 task-1：优先级",
      risk: "medium" as const,
      source: {
        trigger: "task.updated" as const,
        envelopeId: "auto-envelope",
        summary: "任务更新",
        taskIds: ["task-1"],
      },
      payload: { type: "task.update" as const, taskId: "task-1", patch: { priority: 2 } },
      dryRun: {
        reversible: true,
        requiresConfirmation: true as const,
        affectedTaskIds: ["task-1"],
        impact: "将影响 1 个任务，确认后写入本地任务库。",
      },
      createdAt: "2026-05-16T12:00:00.000Z",
      decidedAt: null,
      decisionReason: null,
      auditBatchId: null,
      error: null,
    };
    vi.mocked(repository.getAgentInboxSnapshot)
      .mockResolvedValueOnce({ pendingActions: [], audits: [] })
      .mockResolvedValue({ pendingActions: [pendingAction], audits: [] });
    invokeMock.mockImplementation((command: string) => {
      if (command === "agent_runtime_get_status") {
        return Promise.resolve({
          lifecycle: "running",
          agent_id: "momo-agent",
          agent_phase: "awake",
          backend_configured: true,
          disabled_reason: null,
          buffered_event_count: 2,
        });
      }
      if (command === "agent_runtime_list_events") {
        return Promise.resolve({ events: [{
          sequence: 2,
          kind: "backend",
          name: "codex.runner.scan.completed",
          agent_id: "momo-agent",
          attributes: { suggestion_count: 1 },
          error: null,
        }] });
      }
      return Promise.reject(new Error(`未预期的 Tauri 命令：${command}`));
    });

    renderWithRepository(AgentInbox, repository);

    expect(await screen.findByText("Agent 收件箱")).toBeInTheDocument();
    expect(screen.getByText("当前没有待确认操作。")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(8_000);

    await waitFor(() => expect(screen.getByText("更新任务 task-1：优先级")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText("#2 codex.runner.scan.completed")).toBeInTheDocument(),
    );
    vi.useRealTimers();
  });


  it("Agent 收件箱支持确认、拒绝和撤销操作", async () => {
    const repository = fakeRepository({
      agentInbox: {
        pendingActions: [
          {
            id: "agent-action-1",
            actionType: "task.update",
            status: "pending",
            summary: "更新任务 task-1：优先级",
            risk: "medium",
            source: {
              trigger: "manual_scan",
              envelopeId: "envelope-1",
              summary: "手动扫描",
              taskIds: ["task-1"],
            },
            payload: { type: "task.update", taskId: "task-1", patch: { priority: 2 } },
            dryRun: {
              reversible: true,
              requiresConfirmation: true,
              affectedTaskIds: ["task-1"],
              impact: "将影响 1 个任务，确认后写入本地任务库。",
            },
            createdAt: "2026-05-16T12:00:00.000Z",
            decidedAt: null,
            decisionReason: null,
            auditBatchId: null,
            error: null,
          },
        ],
        audits: [
          {
            id: "audit-1",
            batchId: "batch-1",
            actionId: "agent-action-old",
            actionType: "task.update",
            payload: { type: "task.update", taskId: "task-1", patch: { priority: 2 } },
            summary: "更新任务 task-1：优先级",
            status: "applied",
            reversible: true,
            before: null,
            after: null,
            source: {
              trigger: "manual_scan",
              envelopeId: "envelope-old",
              summary: "手动扫描",
              taskIds: ["task-1"],
            },
            error: null,
            createdAt: "2026-05-16T12:01:00.000Z",
            undoneAt: null,
          },
        ],
      },
    });

    const firstRender = renderWithRepository(AgentInbox, repository);
    await screen.findAllByText("更新任务 task-1：优先级");
    await fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(repository.approveAgentPendingAction).toHaveBeenCalledWith("agent-action-1"));
    firstRender.unmount();

    const secondRender = renderWithRepository(AgentInbox, repository);
    await screen.findAllByText("更新任务 task-1：优先级");
    await fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(repository.rejectAgentPendingAction).toHaveBeenCalledWith("agent-action-1", "用户拒绝"));
    secondRender.unmount();

    renderWithRepository(AgentInbox, repository);
    await screen.findAllByText("更新任务 task-1：优先级");
    await fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(repository.undoAgentAuditBatch).toHaveBeenCalledWith("batch-1"));
  });


});
