import { describe, expect, it } from "vitest";
import { createAgentActionDraft, TODO_AGENT_TOOL_DEFINITIONS } from "../src/agent/actions";
import { buildAgentTaskContextSnapshot } from "../src/agent/context";
import { AgentTriggerBuffer } from "../src/agent/triggers";
import { fakeTaskRepository, taskFixture, taskListFixture } from "./taskFixtures";

describe("Todo Agent 基础能力", () => {
  it("首批工具定义都要求确认并能生成中文 dry-run 摘要", () => {
    expect(TODO_AGENT_TOOL_DEFINITIONS.map((tool) => tool.type)).toEqual([
      "task.create",
      "task.update",
      "task.complete",
      "task.restore",
      "task.delete",
      "task.move",
      "task.reparent",
      "taskList.create",
      "taskCategory.create",
    ]);

    const draft = createAgentActionDraft(
      { type: "task.delete", taskId: "task-1" },
      {
        trigger: "manual_scan",
        envelopeId: "envelope-1",
        summary: "手动扫描",
        taskIds: ["task-1"],
      },
    );

    expect(draft.summary).toBe("删除任务 task-1");
    expect(draft.risk).toBe("high");
    expect(draft.dryRun).toMatchObject({
      requiresConfirmation: true,
      reversible: false,
      affectedTaskIds: ["task-1"],
    });
  });

  it("构建本地任务上下文并限制任务数量和文本长度", async () => {
    const repository = fakeTaskRepository({
      activeTasks: [
        taskFixture({
          id: "task-1",
          title: "很长的任务标题",
          notes: "这是一段需要被截断的长备注",
          tags: ["focus"],
          estimateMin: 30,
        }),
        taskFixture({ id: "task-2", title: "第二个任务" }),
      ],
      lists: [taskListFixture()],
    });

    const snapshot = await buildAgentTaskContextSnapshot(repository, {
      now: new Date("2026-05-16T12:00:00.000Z"),
      maxTasks: 1,
      maxTextLength: 6,
    });

    expect(snapshot.generatedAt).toBe("2026-05-16T12:00:00.000Z");
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]).toMatchObject({
      id: "task-1",
      title: "很长的任务标...",
      notes: "这是一段需要...",
      tags: ["focus"],
      estimateMin: 30,
    });
  });

  it("自动触发会按任务和时间窗口合并，关闭后不生成自动 envelope", () => {
    const ids = ["envelope-1", "envelope-2"];
    const buffer = new AgentTriggerBuffer(
      { automaticTriggersEnabled: true, throttleMs: 60_000 },
      () => ids.shift() ?? "envelope-x",
    );

    const first = buffer.push({
      trigger: "task.updated",
      taskId: "task-1",
      summary: "任务更新",
      createdAt: "2026-05-16T12:00:00.000Z",
    });
    const second = buffer.push({
      trigger: "task.updated",
      taskId: "task-1",
      summary: "任务再次更新",
      createdAt: "2026-05-16T12:00:30.000Z",
    });

    expect(first?.id).toBe("envelope-1");
    expect(second?.id).toBe("envelope-1");
    expect(buffer.list()).toHaveLength(1);

    buffer.updateSettings({ automaticTriggersEnabled: false });
    expect(buffer.push({
      trigger: "task.updated",
      taskId: "task-2",
      summary: "关闭后更新",
      createdAt: "2026-05-16T12:02:00.000Z",
    })).toBeNull();
    expect(buffer.push({
      trigger: "manual_scan",
      summary: "手动扫描",
      createdAt: "2026-05-16T12:02:00.000Z",
    })?.id).toBe("envelope-2");
  });
});
