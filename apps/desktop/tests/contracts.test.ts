import { describe, expect, it } from "vitest";
import {
  SYNC_CONTRACT_VERSION,
  createDeltaPullRequest,
  createDeltaPushRequest,
  createListTaskConflictsRequest,
  createTaskConflict,
  type DeltaPullResponse,
  type LocalChangeDto,
  type TaskListDto,
  type TaskDto,
} from "../../../packages/contracts/src";

describe("同步契约", () => {
  it("同步契约版本随任务分类 wire shape 升级到 3", () => {
    expect(SYNC_CONTRACT_VERSION).toBe(3);
  });

  it("TaskDto 覆盖结构化任务字段", () => {
    const task: TaskDto = {
      id: "task-1",
      workspaceId: "local",
      title: "写计划",
      notes: "补齐字段",
      status: "active",
      priority: 2,
      startAt: "2026-05-16T01:00:00.000Z",
      dueAt: "2026-05-16T02:00:00.000Z",
      estimateMin: 60,
      resources: [
        { id: "res-1", type: "person", label: "自己", amount: 1, unit: "人" },
      ],
      reminders: [
        {
          id: "rem-1",
          triggerAt: "2026-05-16T01:30:00.000Z",
          status: "pending",
          message: "开始收尾",
        },
      ],
      checklist: [{ id: "check-1", title: "确认字段", done: false, order: 0 }],
      parentId: null,
      childOrder: 0,
      tags: ["sync"],
      listId: "inbox",
      categoryId: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:30:00.000Z",
      completedAt: null,
      version: 2,
    };

    expect(task.resources[0].type).toBe("person");
    expect(task.reminders[0].status).toBe("pending");
    expect(task.listId).toBe("inbox");
  });

  it("从本地变更构造带版本的 delta push 请求", () => {
    const changes: LocalChangeDto[] = [
      {
        id: "change-1",
        entityType: "task",
        entityId: "task-1",
        action: "task.create",
        payload: { title: "Write plan" },
        createdAt: "2026-05-16T04:00:00.000Z",
      },
      {
        id: "change-list-create",
        entityType: "taskList",
        entityId: "list-1",
        action: "taskList.create",
        payload: {
          id: "list-1",
          name: "项目",
          color: null,
          archived: false,
          order: 0,
          createdAt: "2026-05-16T04:00:00.000Z",
          updatedAt: "2026-05-16T04:00:00.000Z",
        },
        createdAt: "2026-05-16T04:00:00.000Z",
      },
      {
        id: "change-list-archive",
        entityType: "taskList",
        entityId: "list-1",
        action: "taskList.archive",
        payload: {
          id: "list-1",
          archived: true,
          updatedAt: "2026-05-16T05:00:00.000Z",
        },
        createdAt: "2026-05-16T05:00:00.000Z",
      },
    ];

    expect(
      createDeltaPushRequest({
        workspaceId: "local",
        deviceId: "desktop-1",
        changes,
        now: new Date("2026-05-16T05:00:00.000Z"),
      }),
    ).toEqual({
      contractVersion: SYNC_CONTRACT_VERSION,
      workspaceId: "local",
      deviceId: "desktop-1",
      changes,
      clientSentAt: "2026-05-16T05:00:00.000Z",
    });
  });

  it("TaskListDto 和 delta pull 响应覆盖清单同步字段", () => {
    const taskList: TaskListDto = {
      id: "list-1",
      name: "项目",
      color: "#ff0000",
      archived: false,
      order: 1,
      createdAt: "2026-05-16T04:00:00.000Z",
      updatedAt: "2026-05-16T05:00:00.000Z",
    };
    const response: DeltaPullResponse = {
      contractVersion: SYNC_CONTRACT_VERSION,
      tasks: [],
      taskLists: [taskList],
      taskCategories: [],
      deletedTaskIds: [],
      deletedTaskListIds: ["list-old"],
      deletedTaskCategoryIds: [],
      serverCursor: "cursor-list",
      serverTime: "2026-05-16T05:01:00.000Z",
    };

    expect(response.taskLists[0]).toEqual(taskList);
    expect(response.deletedTaskListIds).toEqual(["list-old"]);
  });

  it("构造允许空 cursor 的带版本 delta pull 请求", () => {
    expect(
      createDeltaPullRequest({
        workspaceId: "local",
        deviceId: "desktop-1",
        sinceCursor: null,
      }),
    ).toEqual({
      contractVersion: SYNC_CONTRACT_VERSION,
      workspaceId: "local",
      deviceId: "desktop-1",
      sinceCursor: null,
    });
  });

  it("构造用于人工同步解决的任务冲突 DTO", () => {
    expect(
      createTaskConflict({
        id: "conflict-1",
        workspaceId: "local",
        taskId: "task-1",
        changeId: "change-1",
        reason: "Task changed on server after local edit",
        clientPayload: { title: "Client title" },
        serverTask: null,
        now: new Date("2026-05-16T06:00:00.000Z"),
      }),
    ).toEqual({
      id: "conflict-1",
      workspaceId: "local",
      taskId: "task-1",
      changeId: "change-1",
      reason: "Task changed on server after local edit",
      clientPayload: { title: "Client title" },
      serverTask: null,
      createdAt: "2026-05-16T06:00:00.000Z",
    });
  });

  it("构造带版本的冲突列表请求", () => {
    expect(
      createListTaskConflictsRequest({
        workspaceId: "local",
        deviceId: "desktop-1",
      }),
    ).toEqual({
      contractVersion: SYNC_CONTRACT_VERSION,
      workspaceId: "local",
      deviceId: "desktop-1",
    });
  });
});
