export type TaskStatusDto = "active" | "completed" | "archived";

export interface TaskDto {
  id: string;
  workspaceId: string;
  title: string;
  notes: string | null;
  status: TaskStatusDto;
  priority: 0 | 1 | 2 | 3;
  dueAt: string | null;
  estimateMin: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
}
