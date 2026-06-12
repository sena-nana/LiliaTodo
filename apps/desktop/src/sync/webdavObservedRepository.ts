import type { TaskRepository } from '../data/taskRepository';
import type { WebdavSyncController } from './defaultSettingsSyncRuntime';

export function createWebdavObservedTaskRepository(
  repository: TaskRepository,
  controller: WebdavSyncController | null,
): TaskRepository {
  if (!controller) return repository;
  const notify = () => controller.notifyLocalChange();
  return {
    ...repository,
    async createTask(input) {
      const task = await repository.createTask(input);
      notify();
      return task;
    },
    async updateTask(taskId, patch) {
      const task = await repository.updateTask(taskId, patch);
      notify();
      return task;
    },
    async setStatus(taskId, status) {
      const task = await repository.setStatus(taskId, status);
      notify();
      return task;
    },
    async deleteTask(taskId) {
      await repository.deleteTask(taskId);
      notify();
    },
    async restoreTask(taskId) {
      const task = await repository.restoreTask(taskId);
      notify();
      return task;
    },
    async purgeTask(taskId) {
      await repository.purgeTask(taskId);
      notify();
    },
    async batchUpdateTasks(input) {
      const result = await repository.batchUpdateTasks(input);
      if (result.succeeded.length > 0) notify();
      return result;
    },
    async reorderTasks(input) {
      const tasks = await repository.reorderTasks(input);
      if (tasks.length > 0) notify();
      return tasks;
    },
    async snoozeReminder(taskId, reminderId, until) {
      const task = await repository.snoozeReminder(taskId, reminderId, until);
      notify();
      return task;
    },
    async dismissReminder(taskId, reminderId) {
      const task = await repository.dismissReminder(taskId, reminderId);
      notify();
      return task;
    },
    async createList(input) {
      const list = await repository.createList(input);
      notify();
      return list;
    },
    async updateList(listId, patch) {
      const list = await repository.updateList(listId, patch);
      notify();
      return list;
    },
    async archiveList(listId) {
      const list = await repository.archiveList(listId);
      notify();
      return list;
    },
    async createCategory(input) {
      const category = await repository.createCategory(input);
      notify();
      return category;
    },
    async updateCategory(categoryId, patch) {
      const category = await repository.updateCategory(categoryId, patch);
      notify();
      return category;
    },
    async deleteCategory(categoryId) {
      await repository.deleteCategory(categoryId);
      notify();
    },
    async approveAgentPendingAction(actionId) {
      const audit = await repository.approveAgentPendingAction(actionId);
      notify();
      return audit;
    },
    async undoAgentAuditBatch(batchId) {
      const audits = await repository.undoAgentAuditBatch(batchId);
      if (audits.length > 0) notify();
      return audits;
    },
  };
}
