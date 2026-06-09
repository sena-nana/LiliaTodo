<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { Archive, Check, ListPlus, Pencil, X } from "lucide-vue-next";
import {
  SIDEBAR_FOOTER_LINKS,
  SIDEBAR_FOOTER_STATUS,
  SIDEBAR_NAV,
} from "../config/appShell";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { notifyTaskListsChanged } from "../data/taskListEvents";
import type { TaskList } from "../domain/tasks";

const repository = useTaskRepository();
const lists = ref<TaskList[]>([]);
const creating = ref(false);
const newName = ref("");
const editingListId = ref<string | null>(null);
const editingName = ref("");

onMounted(() => {
  void loadLists();
});

async function loadLists() {
  lists.value = await repository.listLists();
}

async function createList() {
  if (!newName.value.trim()) return;
  await repository.createList({ name: newName.value });
  newName.value = "";
  creating.value = false;
  await loadLists();
  notifyTaskListsChanged();
}

function beginRename(list: TaskList) {
  editingListId.value = list.id;
  editingName.value = list.name;
}

async function saveRename(list: TaskList) {
  if (!editingName.value.trim()) return;
  await repository.updateList(list.id, { name: editingName.value });
  editingListId.value = null;
  await loadLists();
  notifyTaskListsChanged();
}

async function archiveList(list: TaskList) {
  await repository.archiveList(list.id);
  await loadLists();
  notifyTaskListsChanged();
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
        <button type="button" class="sb-section__icon" aria-label="新增清单" @click="creating = true">
          <ListPlus :size="13" aria-hidden="true" />
        </button>
      </div>
      <form v-if="creating" class="sb-list-form" @submit.prevent="createList">
        <input v-model="newName" aria-label="清单名称" placeholder="清单名称" />
        <button type="submit" aria-label="保存清单"><Check :size="13" aria-hidden="true" /></button>
        <button type="button" aria-label="取消新增清单" @click="creating = false"><X :size="13" aria-hidden="true" /></button>
      </form>
      <nav class="sb-tree" aria-label="任务清单">
        <div v-for="list in lists.filter((item) => item.id !== 'inbox')" :key="list.id" class="sb-list-row">
          <form v-if="editingListId === list.id" class="sb-list-form" @submit.prevent="saveRename(list)">
            <input v-model="editingName" :aria-label="`重命名 ${list.name}`" />
            <button type="submit" :aria-label="`保存 ${list.name}`"><Check :size="13" aria-hidden="true" /></button>
            <button type="button" :aria-label="`取消 ${list.name}`" @click="editingListId = null"><X :size="13" aria-hidden="true" /></button>
          </form>
          <template v-else>
            <RouterLink :to="`/lists/${list.id}`" class="sb-tree__row" active-class="is-active">
              <span class="sb-tree__name">{{ list.name }}</span>
            </RouterLink>
            <button type="button" class="sb-section__icon" :aria-label="`重命名 ${list.name}`" @click="beginRename(list)">
              <Pencil :size="12" aria-hidden="true" />
            </button>
            <button type="button" class="sb-section__icon" :aria-label="`归档 ${list.name}`" @click="archiveList(list)">
              <Archive :size="12" aria-hidden="true" />
            </button>
          </template>
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

.sb-list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px 22px;
  gap: 2px;
  align-items: center;
}

.sb-list-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px 22px;
  gap: 2px;
}

.sb-list-form input {
  height: 26px;
  min-width: 0;
  padding: 4px 7px;
}
</style>
