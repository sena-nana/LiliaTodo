export const TASK_LISTS_CHANGED_EVENT = 'momo:task-lists-changed';

export function notifyTaskListsChanged() {
  window.dispatchEvent(new CustomEvent(TASK_LISTS_CHANGED_EVENT));
}

export function onTaskListsChanged(listener: () => void) {
  window.addEventListener(TASK_LISTS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(TASK_LISTS_CHANGED_EVENT, listener);
}
