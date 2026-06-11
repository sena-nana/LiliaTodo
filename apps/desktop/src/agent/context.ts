import type { TaskRepository } from "../data/taskRepository";
import type { Task, TaskCategory, TaskList } from "../domain/tasks";

export interface AgentTaskContextSnapshot {
  generatedAt: string;
  truncated: boolean;
  limits: {
    maxTasks: number;
    maxTextLength: number;
  };
  tasks: AgentTaskContextItem[];
  lists: TaskList[];
  categories: TaskCategory[];
}

export interface AgentTaskContextItem {
  id: string;
  title: string;
  notes: string | null;
  status: Task["status"];
  priority: Task["priority"];
  startAt: string | null;
  dueAt: string | null;
  estimateMin: number | null;
  tags: string[];
  reminders: Task["reminders"];
  checklist: Task["checklist"];
  parentId: string | null;
  listId: string;
  categoryId: string | null;
  completedAt: string | null;
}

export interface AgentContextOptions {
  now?: Date;
  maxTasks?: number;
  maxTextLength?: number;
}

const DEFAULT_MAX_TASKS = 120;
const DEFAULT_MAX_TEXT_LENGTH = 240;

export async function buildAgentTaskContextSnapshot(
  repository: Pick<TaskRepository, "listActiveTasks" | "listLists" | "listCategoriesByList">,
  options: AgentContextOptions = {},
): Promise<AgentTaskContextSnapshot> {
  const maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
  const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  const [tasks, lists] = await Promise.all([
    repository.listActiveTasks(),
    repository.listLists(),
  ]);
  const categories = (
    await Promise.all(lists.map((list) => repository.listCategoriesByList(list.id)))
  ).flat();
  const limitedTasks = tasks.slice(0, maxTasks);

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    truncated: tasks.length > limitedTasks.length,
    limits: { maxTasks, maxTextLength },
    tasks: limitedTasks.map((task) => toContextItem(task, maxTextLength)),
    lists,
    categories,
  };
}

function toContextItem(task: Task, maxTextLength: number): AgentTaskContextItem {
  return {
    id: task.id,
    title: truncateText(task.title, maxTextLength),
    notes: task.notes ? truncateText(task.notes, maxTextLength) : null,
    status: task.status,
    priority: task.priority,
    startAt: task.startAt,
    dueAt: task.dueAt,
    estimateMin: task.estimateMin,
    tags: task.tags,
    reminders: task.reminders,
    checklist: task.checklist.map((item) => ({
      ...item,
      title: truncateText(item.title, maxTextLength),
    })),
    parentId: task.parentId,
    listId: task.listId,
    categoryId: task.categoryId,
    completedAt: task.completedAt,
  };
}

function truncateText(value: string, maxTextLength: number) {
  return value.length > maxTextLength ? `${value.slice(0, maxTextLength)}...` : value;
}
