export type {
  TaskChecklistItemDto,
  TaskDto,
  TaskListDto,
  TaskReminderDto,
  TaskReminderStatusDto,
  TaskResourceDto,
  TaskResourceTypeDto,
  TaskStatusDto,
} from "../../schema/src/task";
import type { TaskDto } from "../../schema/src/task";
import type { TaskListDto } from "../../schema/src/task";

export const SYNC_CONTRACT_VERSION = 2;

export type LocalChangeActionDto =
  | "task.create"
  | "task.update"
  | "task.status"
  | "task.delete"
  | "taskList.create"
  | "taskList.update"
  | "taskList.archive"
  | "taskList.delete";

export type LocalChangeEntityTypeDto = "task" | "taskList";

export interface LocalChangeDto {
  id: string;
  entityType: LocalChangeEntityTypeDto;
  entityId: string;
  action: LocalChangeActionDto;
  payload: unknown;
  createdAt: string;
}

export interface TaskConflictDto {
  id: string;
  workspaceId: string;
  taskId: string;
  changeId: string;
  reason: string;
  clientPayload: unknown;
  serverTask: TaskDto | null;
  createdAt: string;
}

export interface ListTaskConflictsRequest {
  contractVersion: typeof SYNC_CONTRACT_VERSION;
  workspaceId: string;
  deviceId: string;
}

export interface ListTaskConflictsResponse {
  contractVersion: typeof SYNC_CONTRACT_VERSION;
  conflicts: TaskConflictDto[];
  serverCursor: string;
  serverTime: string;
}

export interface DeltaPushRequest {
  contractVersion: typeof SYNC_CONTRACT_VERSION;
  workspaceId: string;
  deviceId: string;
  changes: LocalChangeDto[];
  clientSentAt: string;
}

export interface DeltaPushResponse {
  contractVersion: typeof SYNC_CONTRACT_VERSION;
  acceptedChangeIds: string[];
  rejectedChanges: Array<{
    id: string;
    reason: string;
  }>;
  conflicts: TaskConflictDto[];
  serverCursor: string;
  serverTime: string;
}

export interface DeltaPullRequest {
  contractVersion: typeof SYNC_CONTRACT_VERSION;
  workspaceId: string;
  deviceId: string;
  sinceCursor: string | null;
}

export interface DeltaPullResponse {
  contractVersion: typeof SYNC_CONTRACT_VERSION;
  tasks: TaskDto[];
  taskLists: TaskListDto[];
  deletedTaskIds: string[];
  deletedTaskListIds: string[];
  serverCursor: string;
  serverTime: string;
}

export function createDeltaPushRequest(input: {
  workspaceId: string;
  deviceId: string;
  changes: LocalChangeDto[];
  now: Date;
}): DeltaPushRequest {
  return {
    contractVersion: SYNC_CONTRACT_VERSION,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    changes: input.changes,
    clientSentAt: input.now.toISOString(),
  };
}

export function createDeltaPullRequest(input: {
  workspaceId: string;
  deviceId: string;
  sinceCursor: string | null;
}): DeltaPullRequest {
  return {
    contractVersion: SYNC_CONTRACT_VERSION,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    sinceCursor: input.sinceCursor,
  };
}

export function createTaskConflict(input: Omit<TaskConflictDto, "createdAt"> & {
  now: Date;
}): TaskConflictDto {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    changeId: input.changeId,
    reason: input.reason,
    clientPayload: input.clientPayload,
    serverTask: input.serverTask,
    createdAt: input.now.toISOString(),
  };
}

export function createListTaskConflictsRequest(input: {
  workspaceId: string;
  deviceId: string;
}): ListTaskConflictsRequest {
  return {
    contractVersion: SYNC_CONTRACT_VERSION,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
  };
}
