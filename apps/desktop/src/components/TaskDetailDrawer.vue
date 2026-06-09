<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Plus, Save, Trash2, X } from 'lucide-vue-next';
import type { Task, TaskChecklistItem, TaskList, TaskPriority, TaskReminder, TaskResource, TaskResourceType, UpdateTaskInput } from '../domain/tasks';
import { taskHasDueReminder } from '../domain/tasks';
import { buildEditableContextMenuItems, useContextMenu } from './contextMenu';

const props = defineProps<{
  task: Task | null;
  lists: TaskList[];
  parentCandidates: Task[];
  children: Task[];
  saving?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [taskId: string, patch: UpdateTaskInput];
  complete: [task: Task];
  openTask: [task: Task];
}>();

interface Draft {
  title: string;
  notes: string;
  priority: TaskPriority;
  startAtInput: string;
  dueAtInput: string;
  estimateInput: string;
  resources: DraftResource[];
  reminders: TaskReminder[];
  checklist: TaskChecklistItem[];
  parentId: string;
  tagsInput: string;
  listId: string;
}

type DraftResource = Omit<TaskResource, 'amount'> & {
  amount: number | string | null;
};

const contextMenu = useContextMenu();
const draft = ref<Draft>(emptyDraft());
const dueReminder = computed(() => props.task ? taskHasDueReminder(props.task) : false);
const validParentCandidates = computed(() => {
  if (!props.task) return props.parentCandidates;
  const excluded = descendantIds(props.task.id, [...props.parentCandidates, ...props.children]);
  excluded.add(props.task.id);
  return props.parentCandidates.filter((candidate) => !excluded.has(candidate.id));
});

watch(() => props.task, (task) => {
  draft.value = task ? taskToDraft(task) : emptyDraft();
}, { immediate: true });

function onEditableContextMenu(event: MouseEvent) {
  contextMenu.show(event, buildEditableContextMenuItems(event));
}

function save() {
  if (!props.task || !draft.value.title.trim()) return;
  emit('save', props.task.id, {
    title: draft.value.title,
    notes: draft.value.notes,
    priority: draft.value.priority,
    startAt: draft.value.startAtInput ? dateTimeInputToIso(draft.value.startAtInput) : null,
    dueAt: draft.value.dueAtInput ? dateTimeInputToIso(draft.value.dueAtInput) : null,
    estimateMin: draft.value.estimateInput ? estimateInputToNumber(draft.value.estimateInput) : null,
    resources: normalizeDraftResources(draft.value.resources),
    reminders: draft.value.reminders,
    checklist: draft.value.checklist,
    parentId: draft.value.parentId || null,
    tags: splitTags(draft.value.tagsInput),
    listId: draft.value.listId,
  });
}

function addResource() {
  draft.value.resources.push({ id: createLocalId('resource'), type: 'other', label: '', amount: null, unit: null });
}

function addReminder() {
  const trigger = new Date();
  trigger.setMinutes(trigger.getMinutes() + 30);
  draft.value.reminders.push({ id: createLocalId('reminder'), triggerAt: trigger.toISOString(), status: 'pending', message: null });
}

function addChecklistItem() {
  draft.value.checklist.push({ id: createLocalId('check'), title: '', done: false, order: draft.value.checklist.length });
}

function removeChecklistItem(index: number) {
  draft.value.checklist.splice(index, 1);
  draft.value.checklist.forEach((item, order) => { item.order = order; });
}

function reminderInput(reminder: TaskReminder) {
  return isoToDateTimeInput(reminder.triggerAt);
}

function updateReminderTime(reminder: TaskReminder, value: string) {
  reminder.triggerAt = value ? dateTimeInputToIso(value) : reminder.triggerAt;
}

function emptyDraft(): Draft {
  return { title: '', notes: '', priority: 0, startAtInput: '', dueAtInput: '', estimateInput: '', resources: [], reminders: [], checklist: [], parentId: '', tagsInput: '', listId: 'inbox' };
}

function taskToDraft(task: Task): Draft {
  return {
    title: task.title,
    notes: task.notes ?? '',
    priority: task.priority,
    startAtInput: isoToDateTimeInput(task.startAt),
    dueAtInput: isoToDateTimeInput(task.dueAt),
    estimateInput: task.estimateMin?.toString() ?? '',
    resources: task.resources.map((item) => ({ ...item })),
    reminders: task.reminders.map((item) => ({ ...item })),
    checklist: task.checklist.map((item) => ({ ...item })),
    parentId: task.parentId ?? '',
    tagsInput: task.tags.join(', '),
    listId: task.listId,
  };
}

function isoToDateTimeInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function dateTimeInputToIso(value: string) { return new Date(value).toISOString(); }
function estimateInputToNumber(value: string) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function splitTags(value: string) { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
function createLocalId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function normalizeDraftResources(resources: DraftResource[]): TaskResource[] {
  return resources.map((resource) => {
    const amount = resource.amount === '' || resource.amount == null
      ? null
      : Number(resource.amount);
    return { ...resource, amount };
  });
}

function descendantIds(taskId: string, tasks: Task[]) {
  const byParent = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const bucket = byParent.get(task.parentId) ?? [];
    bucket.push(task);
    byParent.set(task.parentId, bucket);
  }
  const result = new Set<string>();
  const stack = [...(byParent.get(taskId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || result.has(current.id)) continue;
    result.add(current.id);
    stack.push(...(byParent.get(current.id) ?? []));
  }
  return result;
}

const resourceTypes: Array<{ value: TaskResourceType; label: string }> = [
  { value: 'person', label: '人员' },
  { value: 'tool', label: '工具' },
  { value: 'space', label: '空间' },
  { value: 'budget', label: '预算' },
  { value: 'material', label: '物料' },
  { value: 'other', label: '其他' },
];
</script>

<template>
  <Teleport to="body">
    <div v-if="task" class="drawer-backdrop" @click.self="emit('close')">
      <aside class="task-drawer" aria-label="任务详情">
        <header class="task-drawer__header">
          <div>
            <p v-if="dueReminder" class="task-drawer__alert">提醒已到</p>
            <h2>{{ task.title }}</h2>
          </div>
          <button type="button" class="icon-button" aria-label="关闭任务详情" @click="emit('close')"><X :size="16" aria-hidden="true" /></button>
        </header>

        <form class="task-drawer__body" @submit.prevent="save">
          <label><span>任务名</span><input v-model="draft.title" @contextmenu="onEditableContextMenu" /></label>
          <label><span>详细内容</span><textarea v-model="draft.notes" rows="4" @contextmenu="onEditableContextMenu" /></label>

          <div class="drawer-grid">
            <label><span>优先级</span><select v-model.number="draft.priority"><option :value="0">P0</option><option :value="1">P1</option><option :value="2">P2</option><option :value="3">P3</option></select></label>
            <label><span>所属清单</span><select v-model="draft.listId"><option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option></select></label>
            <label><span>开始时间</span><input v-model="draft.startAtInput" type="datetime-local" @contextmenu="onEditableContextMenu" /></label>
            <label><span>截止时间</span><input v-model="draft.dueAtInput" type="datetime-local" @contextmenu="onEditableContextMenu" /></label>
            <label><span>估时分钟</span><input v-model="draft.estimateInput" type="number" min="1" step="1" @contextmenu="onEditableContextMenu" /></label>
            <label><span>父任务</span><select v-model="draft.parentId"><option value="">无</option><option v-for="candidate in validParentCandidates" :key="candidate.id" :value="candidate.id">{{ candidate.title }}</option></select></label>
          </div>

          <label><span>标签</span><input v-model="draft.tagsInput" placeholder="用逗号分隔" @contextmenu="onEditableContextMenu" /></label>

          <section class="drawer-section">
            <div class="drawer-section__title"><h3>资源</h3><button type="button" @click="addResource"><Plus :size="15" aria-hidden="true" />新增</button></div>
            <div v-for="(resource, index) in draft.resources" :key="resource.id" class="drawer-row drawer-row--resource">
              <select v-model="resource.type"><option v-for="type in resourceTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select>
              <input v-model="resource.label" placeholder="资源名称" @contextmenu="onEditableContextMenu" />
              <input v-model.number="resource.amount" type="number" min="0" step="0.1" placeholder="数量" @contextmenu="onEditableContextMenu" />
              <input v-model="resource.unit" placeholder="单位" @contextmenu="onEditableContextMenu" />
              <button type="button" class="icon-button icon-button--danger" :aria-label="`删除资源 ${index + 1}`" @click="draft.resources.splice(index, 1)"><Trash2 :size="15" aria-hidden="true" /></button>
            </div>
          </section>

          <section class="drawer-section">
            <div class="drawer-section__title"><h3>提醒</h3><button type="button" @click="addReminder"><Plus :size="15" aria-hidden="true" />新增</button></div>
            <div v-for="(reminder, index) in draft.reminders" :key="reminder.id" class="drawer-row drawer-row--reminder">
              <input :value="reminderInput(reminder)" type="datetime-local" @input="updateReminderTime(reminder, ($event.target as HTMLInputElement).value)" />
              <select v-model="reminder.status"><option value="pending">未提醒</option><option value="fired">已提醒</option><option value="dismissed">已关闭</option></select>
              <input v-model="reminder.message" placeholder="提醒内容" @contextmenu="onEditableContextMenu" />
              <button type="button" @click="reminder.status = 'dismissed'">关闭</button>
              <button type="button" class="icon-button icon-button--danger" :aria-label="`删除提醒 ${index + 1}`" @click="draft.reminders.splice(index, 1)"><Trash2 :size="15" aria-hidden="true" /></button>
            </div>
          </section>

          <section class="drawer-section">
            <div class="drawer-section__title"><h3>检查清单</h3><button type="button" @click="addChecklistItem"><Plus :size="15" aria-hidden="true" />新增</button></div>
            <div v-for="(item, index) in draft.checklist" :key="item.id" class="drawer-row drawer-row--check">
              <input v-model="item.done" type="checkbox" />
              <input v-model="item.title" placeholder="检查项" @contextmenu="onEditableContextMenu" />
              <button type="button" class="icon-button icon-button--danger" :aria-label="`删除检查项 ${index + 1}`" @click="removeChecklistItem(index)"><Trash2 :size="15" aria-hidden="true" /></button>
            </div>
          </section>

          <section class="drawer-section">
            <div class="drawer-section__title"><h3>子任务</h3></div>
            <p v-if="children.length === 0" class="drawer-empty">暂无子任务。</p>
            <button v-for="child in children" :key="child.id" type="button" class="child-row" @click="emit('openTask', child)"><span>{{ child.title }}</span><span>{{ child.status === 'completed' ? '已完成' : '进行中' }}</span></button>
          </section>

          <p v-if="error" class="drawer-error">{{ error.replace(/^Error:\s*/, '错误：') }}</p>
          <footer class="task-drawer__footer">
            <button type="button" @click="emit('complete', task)"><Check :size="16" aria-hidden="true" />完成</button>
            <button type="submit" class="primary" :disabled="saving || !draft.title.trim()"><Save :size="16" aria-hidden="true" />保存</button>
          </footer>
        </form>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-backdrop { position: fixed; inset: 0; z-index: 30; display: flex; justify-content: flex-end; background: rgba(0, 0, 0, 0.24); }
.task-drawer { width: min(560px, 100vw); height: 100%; background: var(--bg-elev); border-left: 1px solid var(--border); box-shadow: -18px 0 42px rgba(0, 0, 0, 0.24); display: flex; flex-direction: column; }
.task-drawer__header, .task-drawer__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.task-drawer__footer { border-top: 1px solid var(--border); border-bottom: 0; position: sticky; bottom: 0; background: var(--bg-elev); }
.task-drawer__header h2 { margin: 0; font-size: 18px; }
.task-drawer__alert { margin: 0 0 2px; color: var(--warn); font-size: 12px; font-weight: 700; }
.task-drawer__body { flex: 1; overflow: auto; padding: 14px 16px 0; display: flex; flex-direction: column; gap: 14px; }
label { display: flex; flex-direction: column; gap: 5px; min-width: 0; color: var(--text-muted); font-size: 12px; }
label input, label select, textarea { width: 100%; color: var(--text); }
textarea { resize: vertical; min-height: 92px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg-subtle); font: inherit; }
.drawer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.drawer-section { border-top: 1px solid var(--border-soft); padding-top: 12px; }
.drawer-section__title { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
.drawer-section__title h3 { margin: 0; font-size: 13px; }
.drawer-row { display: grid; gap: 8px; align-items: center; margin-top: 8px; }
.drawer-row--resource { grid-template-columns: 88px minmax(0, 1fr) 76px 70px 32px; }
.drawer-row--reminder { grid-template-columns: 170px 90px minmax(0, 1fr) 54px 32px; }
.drawer-row--check { grid-template-columns: 24px minmax(0, 1fr) 32px; }
.drawer-row input[type='checkbox'] { width: 18px; height: 18px; }
.child-row { width: 100%; height: auto; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-soft); }
.child-row span:last-child, .drawer-empty { color: var(--text-muted); font-size: 12px; }
.drawer-error { margin: 0; color: var(--err); }
@media (max-width: 720px) { .drawer-grid, .drawer-row--resource, .drawer-row--reminder { grid-template-columns: 1fr; } }
</style>
