export type TaskStatusDto = 'active' | 'completed' | 'archived';
export type TaskResourceTypeDto = 'person' | 'tool' | 'space' | 'budget' | 'material' | 'other';
export type TaskReminderStatusDto = 'pending' | 'fired' | 'dismissed';

export interface TaskResourceDto {
  id: string;
  type: TaskResourceTypeDto;
  label: string;
  amount: number | null;
  unit: string | null;
}

export interface TaskReminderDto {
  id: string;
  triggerAt: string;
  status: TaskReminderStatusDto;
  message: string | null;
}

export interface TaskChecklistItemDto {
  id: string;
  title: string;
  done: boolean;
  order: number;
}

export interface TaskListDto {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCategoryDto {
  id: string;
  listId: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDto {
  id: string;
  workspaceId: string;
  title: string;
  notes: string | null;
  status: TaskStatusDto;
  priority: 0 | 1 | 2 | 3;
  startAt: string | null;
  dueAt: string | null;
  estimateMin: number | null;
  resources: TaskResourceDto[];
  reminders: TaskReminderDto[];
  checklist: TaskChecklistItemDto[];
  parentId: string | null;
  childOrder: number;
  tags: string[];
  listId: string;
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
}
