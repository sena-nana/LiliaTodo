import { describe, expect, it, vi } from 'vitest';
import { createWebdavObservedTaskRepository } from '../src/sync/webdavObservedRepository';
import { fakeTaskRepository, taskFixture } from './taskFixtures';

describe('WebDAV 自动同步仓储观察器', () => {
  it('任务写入成功后通知本地变更', async () => {
    const repository = fakeTaskRepository();
    const controller = { notifyLocalChange: vi.fn() } as never;
    const observed = createWebdavObservedTaskRepository(repository, controller);

    await observed.createTask({ title: '同步任务' });
    await observed.updateTask('task-1', { title: '更新任务' });
    await observed.setStatus('task-1', 'completed');

    expect(controller.notifyLocalChange).toHaveBeenCalledTimes(3);
  });

  it('写入失败时不通知本地变更', async () => {
    const repository = fakeTaskRepository();
    vi.mocked(repository.updateTask).mockRejectedValueOnce(new Error('写入失败'));
    const controller = { notifyLocalChange: vi.fn() } as never;
    const observed = createWebdavObservedTaskRepository(repository, controller);

    await expect(observed.updateTask('task-1', { title: '失败' })).rejects.toThrow('写入失败');

    expect(controller.notifyLocalChange).not.toHaveBeenCalled();
  });

  it('批量操作只有成功项时通知', async () => {
    const repository = fakeTaskRepository();
    vi.mocked(repository.batchUpdateTasks).mockResolvedValueOnce({ succeeded: [], failed: [] });
    vi.mocked(repository.reorderTasks).mockResolvedValueOnce([taskFixture({ id: 'task-1' })]);
    const controller = { notifyLocalChange: vi.fn() } as never;
    const observed = createWebdavObservedTaskRepository(repository, controller);

    await observed.batchUpdateTasks({ type: 'complete', taskIds: [] });
    await observed.reorderTasks({ taskIds: ['task-1'] });

    expect(controller.notifyLocalChange).toHaveBeenCalledTimes(1);
  });

  it('清单和分类写入成功后通知本地变更', async () => {
    const repository = fakeTaskRepository();
    const controller = { notifyLocalChange: vi.fn() } as never;
    const observed = createWebdavObservedTaskRepository(repository, controller);

    await observed.createList({ name: '项目' });
    await observed.updateList('list-1', { name: '项目二' });
    await observed.archiveList('list-1');
    await observed.createCategory({ listId: 'list-1', name: '工作' });
    await observed.updateCategory('category-1', { name: '工作二' });
    await observed.deleteCategory('category-1');

    expect(controller.notifyLocalChange).toHaveBeenCalledTimes(6);
  });

  it('远端回放写入不触发本地变更通知', async () => {
    const repository = fakeTaskRepository();
    const controller = { notifyLocalChange: vi.fn() } as never;
    const observed = createWebdavObservedTaskRepository(repository, controller);

    await observed.applyRemoteTask(taskFixture({ id: 'remote-task' }));
    await observed.deleteRemoteTask('remote-task');
    await observed.applyRemoteList({ id: 'list-1', name: '项目', color: null, archived: false, order: 0, createdAt: '2026-05-16T00:00:00.000Z', updatedAt: '2026-05-16T00:00:00.000Z' });
    await observed.deleteRemoteList('list-1');
    await observed.applyRemoteCategory({ id: 'category-1', listId: 'list-1', name: '工作', order: 0, createdAt: '2026-05-16T00:00:00.000Z', updatedAt: '2026-05-16T00:00:00.000Z' });
    await observed.deleteRemoteCategory('category-1');

    expect(controller.notifyLocalChange).not.toHaveBeenCalled();
  });

  it('Agent 确认和撤销成功后通知本地变更', async () => {
    const repository = fakeTaskRepository();
    const controller = { notifyLocalChange: vi.fn() } as never;
    const observed = createWebdavObservedTaskRepository(repository, controller);

    await observed.approveAgentPendingAction('agent-action-1');
    await observed.undoAgentAuditBatch('batch-1');

    expect(controller.notifyLocalChange).toHaveBeenCalledTimes(2);
  });

  it('Agent 拒绝建议不触发任务同步唤醒', async () => {
    const repository = fakeTaskRepository();
    const controller = { notifyLocalChange: vi.fn() } as never;
    const observed = createWebdavObservedTaskRepository(repository, controller);

    await observed.rejectAgentPendingAction('agent-action-1', '用户拒绝');

    expect(controller.notifyLocalChange).not.toHaveBeenCalled();
  });
});
