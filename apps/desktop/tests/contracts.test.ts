import { describe, expect, it } from "vitest";
import {
  SYNC_CONTRACT_VERSION,
  createDeltaPullRequest,
  createDeltaPushRequest,
  createListTaskConflictsRequest,
  createTaskConflict,
  type LocalChangeDto,
} from "../../../packages/contracts/src";

describe("同步契约", () => {
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
