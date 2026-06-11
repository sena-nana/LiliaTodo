import type { TaskRepository } from "./taskRepository";

const LILIATODO_DATABASE_PATH = "sqlite:liliatodo.db";

type RepositoryMethodName = {
  [K in keyof TaskRepository]: TaskRepository[K] extends (...args: never[]) => unknown ? K : never;
}[keyof TaskRepository];

let repositoryPromise: Promise<TaskRepository> | null = null;

async function getRepository() {
  repositoryPromise ??= import("./taskRepository").then(({ createTaskRepository }) =>
    createTaskRepository(),
  );
  return repositoryPromise;
}

function delegate<K extends RepositoryMethodName>(method: K): TaskRepository[K] {
  return (async (...args: unknown[]) => {
    const repository = await getRepository();
    const target = repository[method] as (...nextArgs: unknown[]) => unknown;
    return Reflect.apply(target, repository, args);
  }) as TaskRepository[K];
}

export function createLazyTaskRepository(): TaskRepository {
  return {
    databasePath: LILIATODO_DATABASE_PATH,
    init: delegate("init"),
    findTaskById: delegate("findTaskById"),
    createTask: delegate("createTask"),
    updateTask: delegate("updateTask"),
    setStatus: delegate("setStatus"),
    deleteTask: delegate("deleteTask"),
    restoreTask: delegate("restoreTask"),
    purgeTask: delegate("purgeTask"),
    listTasksByStatus: delegate("listTasksByStatus"),
    searchTasks: delegate("searchTasks"),
    batchUpdateTasks: delegate("batchUpdateTasks"),
    reorderTasks: delegate("reorderTasks"),
    snoozeReminder: delegate("snoozeReminder"),
    dismissReminder: delegate("dismissReminder"),
    applyRemoteTask: delegate("applyRemoteTask"),
    deleteRemoteTask: delegate("deleteRemoteTask"),
    applyRemoteList: delegate("applyRemoteList"),
    deleteRemoteList: delegate("deleteRemoteList"),
    applyRemoteCategory: delegate("applyRemoteCategory"),
    deleteRemoteCategory: delegate("deleteRemoteCategory"),
    listActiveTasks: delegate("listActiveTasks"),
    listTasksByList: delegate("listTasksByList"),
    listTaskChildren: delegate("listTaskChildren"),
    listLists: delegate("listLists"),
    createList: delegate("createList"),
    updateList: delegate("updateList"),
    archiveList: delegate("archiveList"),
    listCategoriesByList: delegate("listCategoriesByList"),
    createCategory: delegate("createCategory"),
    updateCategory: delegate("updateCategory"),
    deleteCategory: delegate("deleteCategory"),
    listPendingChanges: delegate("listPendingChanges"),
    markChangeSynced: delegate("markChangeSynced"),
    getSyncState: delegate("getSyncState"),
    saveSyncState: delegate("saveSyncState"),
    recordSyncRun: delegate("recordSyncRun"),
    listRecentSyncRuns: delegate("listRecentSyncRuns"),
    listToday: delegate("listToday"),
    listInbox: delegate("listInbox"),
    listAgenda: delegate("listAgenda"),
    listDueReminders: delegate("listDueReminders"),
    getStats: delegate("getStats"),
    createAgentPendingAction: delegate("createAgentPendingAction"),
    createAgentPendingActionFromTool: delegate("createAgentPendingActionFromTool"),
    getAgentInboxSnapshot: delegate("getAgentInboxSnapshot"),
    approveAgentPendingAction: delegate("approveAgentPendingAction"),
    rejectAgentPendingAction: delegate("rejectAgentPendingAction"),
    undoAgentAuditBatch: delegate("undoAgentAuditBatch"),
  };
}
