import type { TaskRepository } from "../data/taskRepository";
import type { Task } from "../domain/tasks";
import { buildUndoAction, type AgentToolInput } from "./actions";

export interface AgentActionExecutionResult {
  before: unknown;
  after: unknown;
  reversible: boolean;
}

export async function executeAgentAction(
  repository: Pick<
    TaskRepository,
    | "createTask"
    | "updateTask"
    | "setStatus"
    | "deleteTask"
    | "createList"
    | "createCategory"
    | "findTaskById"
  >,
  action: AgentToolInput,
): Promise<AgentActionExecutionResult> {
  switch (action.type) {
    case "task.create": {
      const task = await repository.createTask(action.input);
      return { before: task, after: task, reversible: true };
    }
    case "task.update": {
      const before = await repository.findTaskById(action.taskId);
      const after = await repository.updateTask(action.taskId, action.patch);
      return { before, after, reversible: true };
    }
    case "task.complete": {
      const before = await repository.findTaskById(action.taskId);
      const after = await repository.setStatus(action.taskId, "completed");
      return { before, after, reversible: true };
    }
    case "task.restore": {
      const before = await repository.findTaskById(action.taskId);
      const after = await repository.setStatus(action.taskId, "active");
      return { before, after, reversible: true };
    }
    case "task.delete": {
      const before = await repository.findTaskById(action.taskId);
      await repository.deleteTask(action.taskId);
      return { before, after: null, reversible: false };
    }
    case "task.move": {
      const before = await repository.findTaskById(action.taskId);
      const after = await repository.updateTask(action.taskId, {
        listId: action.listId,
        categoryId: action.categoryId ?? null,
      });
      return { before, after, reversible: true };
    }
    case "task.reparent": {
      const before = await repository.findTaskById(action.taskId);
      const after = await repository.updateTask(action.taskId, {
        parentId: action.parentId,
        childOrder: action.childOrder,
      });
      return { before, after, reversible: true };
    }
    case "taskList.create": {
      const list = await repository.createList(action.input);
      return { before: null, after: list, reversible: false };
    }
    case "taskCategory.create": {
      const category = await repository.createCategory(action.input);
      return { before: null, after: category, reversible: false };
    }
  }
}

export async function undoAgentAction(
  repository: Pick<TaskRepository, "updateTask" | "setStatus" | "deleteTask" | "findTaskById">,
  action: AgentToolInput,
  before: unknown,
  after: unknown,
) {
  const undoAction = buildUndoAction(action, before, after);
  if (!undoAction) {
    throw new Error("该操作不可撤销");
  }
  if (undoAction.type === "task.delete") {
    const created = before as Task | null;
    if (!created?.id) throw new Error("缺少可撤销任务");
    await repository.deleteTask(created.id);
    return;
  }
  if (undoAction.type === "task.complete") {
    await repository.setStatus(undoAction.taskId, "completed");
    return;
  }
  if (undoAction.type === "task.update") {
    await repository.updateTask(undoAction.taskId, undoAction.patch);
    return;
  }
  throw new Error("该操作不可撤销");
}
