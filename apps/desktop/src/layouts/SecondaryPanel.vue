<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { ArrowDown, ArrowUp, Check, FolderPlus, ListPlus, Pencil, Trash2, X } from "lucide-vue-next";
import {
  SIDEBAR_FOOTER_LINKS,
  SIDEBAR_FOOTER_STATUS,
  SIDEBAR_NAV,
} from "../config/appShell";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { notifyTaskListsChanged } from "../data/taskListEvents";
import { compareByOrder, moveItemById } from "../domain/order";
import type { TaskList, TaskListGroup } from "../domain/tasks";

const repository = useTaskRepository();
const lists = ref<TaskList[]>([]);
const groups = ref<TaskListGroup[]>([]);
const creating = ref(false);
const creatingGroup = ref(false);
const newName = ref("");
const newGroupName = ref("");
const editingListId = ref<string | null>(null);
const editingGroupId = ref<string | null>(null);
const editingName = ref("");
const editingGroupName = ref("");
const listError = ref<string | null>(null);
const UNGROUPED_ID = "__ungrouped";

const visibleLists = computed(() => lists.value.filter((item) => item.id !== "inbox"));
const groupedSections = computed(() => {
  const orderedGroups = [...groups.value].sort(compareByOrder);
  return [
    ...orderedGroups.map((group) => ({
      id: group.id,
      name: group.name,
      group,
      lists: visibleLists.value.filter((list) => list.groupId === group.id).sort(compareByOrder),
    })),
    {
      id: UNGROUPED_ID,
      name: "未分类",
      group: null,
      lists: visibleLists.value.filter((list) => !list.groupId).sort(compareByOrder),
    },
  ];
});

onMounted(() => {
  void loadLists();
});

async function loadLists() {
  try {
    [lists.value, groups.value] = await Promise.all([
      repository.listLists(),
      repository.listListGroups(),
    ]);
    listError.value = null;
  } catch (e) {
    listError.value = String(e);
  }
}

async function createList() {
  if (!newName.value.trim()) return;
  await runListMutation(async () => {
    await repository.createList({ name: newName.value });
    newName.value = "";
    creating.value = false;
  });
}

async function createGroup() {
  if (!newGroupName.value.trim()) return;
  await runListMutation(async () => {
    await repository.createListGroup({ name: newGroupName.value });
    newGroupName.value = "";
    creatingGroup.value = false;
  });
}

function beginRename(list: TaskList) {
  editingListId.value = list.id;
  editingName.value = list.name;
}

function beginRenameGroup(group: TaskListGroup) {
  editingGroupId.value = group.id;
  editingGroupName.value = group.name;
}

async function saveRename(list: TaskList) {
  if (!editingName.value.trim()) return;
  await runListMutation(async () => {
    await repository.updateList(list.id, { name: editingName.value });
    editingListId.value = null;
  });
}

async function saveGroupRename(group: TaskListGroup) {
  if (!editingGroupName.value.trim()) return;
  await runListMutation(async () => {
    await repository.updateListGroup(group.id, { name: editingGroupName.value });
    editingGroupId.value = null;
  });
}

async function deleteList(list: TaskList) {
  await runListMutation(() => repository.archiveList(list.id));
}

async function deleteGroup(group: TaskListGroup) {
  await runListMutation(() => repository.deleteListGroup(group.id));
}

async function moveList(list: TaskList, direction: -1 | 1) {
  const bucket = visibleLists.value
    .filter((item) => item.groupId === list.groupId)
    .sort(compareByOrder);
  const reordered = moveItemById(bucket, list.id, direction);
  if (!reordered) return;
  await runListMutation(() => Promise.all(
    reordered.map((nextList, order) => repository.updateList(nextList.id, { order })),
  ));
}

async function moveGroup(group: TaskListGroup, direction: -1 | 1) {
  const ordered = [...groups.value].sort(compareByOrder);
  const reordered = moveItemById(ordered, group.id, direction);
  if (!reordered) return;
  await runListMutation(() => Promise.all(
    reordered.map((nextGroup, order) => repository.updateListGroup(nextGroup.id, { order })),
  ));
}

async function moveListToGroup(list: TaskList, value: string) {
  const groupId = value === UNGROUPED_ID ? null : value;
  await runListMutation(() => repository.updateList(list.id, { groupId }));
}

async function runListMutation(mutation: () => Promise<unknown>) {
  listError.value = null;
  try {
    await mutation();
    notifyTaskListsChanged();
    await loadLists();
  } catch (e) {
    listError.value = String(e);
  }
}

function displayError(value: string) {
  return value.replace(/^Error:\s*/, "错误：");
}
</script>

<template>
  <aside class="secondary-panel">
    <div class="sb-section">
      <div class="sb-section__header">
        <span class="sb-section__title">任务</span>
      </div>
      <nav class="sb-tree" aria-label="主导航">
        <RouterLink
          v-for="item in SIDEBAR_NAV"
          :key="item.label"
          :to="item.to ?? '/'"
          class="sb-tree__row"
          active-class="is-active"
          :aria-disabled="item.disabled ? 'true' : undefined"
        >
          <component :is="item.icon" :size="14" aria-hidden="true" />
          <span class="sb-tree__name">{{ item.label }}</span>
        </RouterLink>
      </nav>
    </div>
    <div class="sb-section">
      <div class="sb-section__header">
        <span class="sb-section__title">清单</span>
        <div class="sb-section__tools">
          <button type="button" class="sb-section__icon" aria-label="新增分类" @click="creatingGroup = true">
            <FolderPlus :size="13" aria-hidden="true" />
          </button>
          <button type="button" class="sb-section__icon" aria-label="新增清单" @click="creating = true">
            <ListPlus :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>
      <form v-if="creatingGroup" class="sb-list-form" @submit.prevent="createGroup">
        <input v-model="newGroupName" aria-label="分类名称" placeholder="分类名称" />
        <button type="submit" aria-label="保存分类"><Check :size="13" aria-hidden="true" /></button>
        <button type="button" aria-label="取消新增分类" @click="creatingGroup = false"><X :size="13" aria-hidden="true" /></button>
      </form>
      <form v-if="creating" class="sb-list-form" @submit.prevent="createList">
        <input v-model="newName" aria-label="清单名称" placeholder="清单名称" />
        <button type="submit" aria-label="保存清单"><Check :size="13" aria-hidden="true" /></button>
        <button type="button" aria-label="取消新增清单" @click="creating = false"><X :size="13" aria-hidden="true" /></button>
      </form>
      <p v-if="listError" class="state state--error state--inline sb-list-error">{{ displayError(listError) }}</p>
      <nav class="sb-tree" aria-label="任务清单">
        <div v-for="section in groupedSections" :key="section.id" class="sb-group">
          <form v-if="section.group && editingGroupId === section.group.id" class="sb-list-form" @submit.prevent="saveGroupRename(section.group)">
            <input v-model="editingGroupName" :aria-label="`重命名分类 ${section.group.name}`" />
            <button type="submit" :aria-label="`保存分类 ${section.group.name}`"><Check :size="13" aria-hidden="true" /></button>
            <button type="button" :aria-label="`取消分类 ${section.group.name}`" @click="editingGroupId = null"><X :size="13" aria-hidden="true" /></button>
          </form>
          <div v-else class="sb-group__header">
            <span class="sb-group__name">{{ section.name }}</span>
            <template v-if="section.group">
              <button type="button" class="sb-section__icon" :aria-label="`上移分类 ${section.name}`" @click="moveGroup(section.group, -1)">
                <ArrowUp :size="12" aria-hidden="true" />
              </button>
              <button type="button" class="sb-section__icon" :aria-label="`下移分类 ${section.name}`" @click="moveGroup(section.group, 1)">
                <ArrowDown :size="12" aria-hidden="true" />
              </button>
              <button type="button" class="sb-section__icon" :aria-label="`重命名分类 ${section.name}`" @click="beginRenameGroup(section.group)">
                <Pencil :size="12" aria-hidden="true" />
              </button>
              <button type="button" class="sb-section__icon" :aria-label="`删除分类 ${section.name}`" @click="deleteGroup(section.group)">
                <Trash2 :size="12" aria-hidden="true" />
              </button>
            </template>
          </div>
          <div v-for="list in section.lists" :key="list.id" class="sb-list-row">
            <form v-if="editingListId === list.id" class="sb-list-form sb-list-form--wide" @submit.prevent="saveRename(list)">
              <input v-model="editingName" :aria-label="`重命名 ${list.name}`" />
              <button type="submit" :aria-label="`保存 ${list.name}`"><Check :size="13" aria-hidden="true" /></button>
              <button type="button" :aria-label="`取消 ${list.name}`" @click="editingListId = null"><X :size="13" aria-hidden="true" /></button>
            </form>
            <template v-else>
              <RouterLink :to="`/lists/${list.id}`" class="sb-tree__row" active-class="is-active">
                <span class="sb-tree__name">{{ list.name }}</span>
              </RouterLink>
              <button type="button" class="sb-section__icon" :aria-label="`上移清单 ${list.name}`" @click="moveList(list, -1)">
                <ArrowUp :size="12" aria-hidden="true" />
              </button>
              <button type="button" class="sb-section__icon" :aria-label="`下移清单 ${list.name}`" @click="moveList(list, 1)">
                <ArrowDown :size="12" aria-hidden="true" />
              </button>
              <button type="button" class="sb-section__icon" :aria-label="`重命名 ${list.name}`" @click="beginRename(list)">
                <Pencil :size="12" aria-hidden="true" />
              </button>
              <button type="button" class="sb-section__icon" :aria-label="`删除清单 ${list.name}`" @click="deleteList(list)">
                <Trash2 :size="12" aria-hidden="true" />
              </button>
              <select class="sb-list-group-select" :aria-label="`移动清单 ${list.name}`" :value="list.groupId ?? UNGROUPED_ID" @change="moveListToGroup(list, ($event.target as HTMLSelectElement).value)">
                <option :value="UNGROUPED_ID">未分类</option>
                <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
              </select>
            </template>
          </div>
        </div>
      </nav>
    </div>

    <SidebarFooter
      :links="SIDEBAR_FOOTER_LINKS"
      :status="SIDEBAR_FOOTER_STATUS"
    />
  </aside>
</template>

<style scoped>
.sb-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.sb-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  padding: 0 6px 0 8px;
  color: var(--text-faint);
}

.sb-section__icon {
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--text-muted);
}

.sb-section__tools {
  display: flex;
  align-items: center;
  gap: 2px;
}

.sb-section__title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.sb-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  min-height: 0;
}

.sb-tree__row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  min-width: 0;
}

.sb-tree__row:hover {
  background: var(--bg-hover);
}

.sb-tree__row.is-active {
  background: var(--bg-active);
  color: var(--accent);
}

.sb-tree__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 4px;
}

.sb-group__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px 22px 22px 22px;
  gap: 2px;
  align-items: center;
  min-height: 24px;
  padding-left: 8px;
}

.sb-group__name {
  min-width: 0;
  overflow: hidden;
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px 22px 22px 22px 82px;
  gap: 2px;
  align-items: center;
}

.sb-list-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px 22px;
  gap: 2px;
}

.sb-list-form--wide {
  grid-column: 1 / -1;
}

.sb-list-form input {
  height: 26px;
  min-width: 0;
  padding: 4px 7px;
}

.sb-list-error {
  margin: 0;
  padding: 0 8px;
  font-size: 12px;
  line-height: 1.4;
}

.sb-list-group-select {
  min-width: 0;
  height: 24px;
  padding: 2px 4px;
  font-size: 12px;
}
</style>
