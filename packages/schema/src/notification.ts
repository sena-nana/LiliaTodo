export type NotificationTypeDto =
  | "approval.required"
  | "conflict.raised"
  | "sync.run.failed"
  | "task.due";

export type NotificationStatusDto = "queued" | "acknowledged";
export type NotificationListStatusDto = NotificationStatusDto | "all";

export interface NotificationDto {
  id: string;
  workspaceId: string;
  type: NotificationTypeDto;
  status: NotificationStatusDto;
  title: string;
  body: string | null;
  sourceEventId: string | null;
  taskId?: string;
  changeId?: string;
  conflictId?: string;
  payload: unknown;
  createdAt: string;
  acknowledgedAt: string | null;
}
