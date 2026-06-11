<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { ArrowDown, ArrowUp, Check, ListPlus, Pencil, Trash2, X } from "lucide-vue-next";
import {
  SIDEBAR_FOOTER_LINKS,
  SIDEBAR_FOOTER_STATUS,
  SIDEBAR_NAV,
} from "../config/appShell";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { notifyTaskListsChanged } from "../data/taskListEvents";
import { compareByOrder, moveItemById } from "../domain/order";
import type { TaskList } from "../domain/tasks";
import { formatDisplayError } from "../utils/errors";

const repository = useTaskRepository();
const lists = ref<TaskList[]>([]);
const creating = ref(false);
const newName = ref("");
const editingListId = ref<string | null>(null);
const editingName = ref("");
const listError = ref<string | null>(null);
const draggingListId = ref<string | null>(null);

const visibleLists = computed(() =>
  lists.value.filter((item) => item.id !== "inbox").sort(compareByOrder),
);

onMounted(() => {
  void loadLists();
});

async function loadLists() {
  try {
    lists.value = await repository.listLists();
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

function beginRename(list: TaskList) {
  editingListId.value = list.id;
  editingName.value = list.name;
}

async function saveRename(list: TaskList) {
  if (!editingName.value.trim()) return;
  await runListMutation(async () => {
    await repository.updateList(list.id, { name: editingName.value });
    editingListId.value = null;
  });
}

async function deleteList(list: TaskList) {
  await runListMutation(() => repository.archiveList(list.id));
}

async function moveList(list: TaskList, direction: -1 | 1) {
  const reordered = moveItemById(visibleLists.value, list.id, direction);
  if (!reordered) return;
  await runListMutation(() => Promise.all(
    reordered.map((nextList, order) => repository.updateList(nextList.id, { order })),
  ));
}

function onListDragStart(list: TaskList) {
  draggingListId.value = list.id;
}

async function onListDrop(target: TaskList) {
  const sourceId = draggingListId.value;
  draggingListId.value = null;
  if (!sourceId || sourceId === target.id) return;
  const ids = visibleLists.value.map((list) => list.id);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(target.id);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ids.splice(sourceIndex, 1);
  ids.splice(targetIndex, 0, sourceId);
  await runListMutation(() => Promise.all(
    ids.map((id, order) => repository.updateList(id, { order })),
  ));
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

</script>

<template>
  <aside class="secondary-panel">
    <div class="sb-section">
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
          <button type="button" class="sb-section__icon" aria-label="新增清单" @click="creating = true">
            <ListPlus :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>
      <form v-if="creating" class="sb-list-form" @submit.prevent="createList">
        <input v-model="newName" aria-label="清单名称" placeholder="清单名称" />
        <button type="submit" class="sb-section__icon" aria-label="保存清单"><Check :size="13" aria-hidden="true" /></button>
        <button type="button" class="sb-section__icon" aria-label="取消新增清单" @click="creating = false"><X :size="13" aria-hidden="true" /></button>
      </form>
      <p v-if="listError" class="state state--error state--inline sb-list-error">{{ formatDisplayError(listError) }}</p>
      <nav class="sb-tree" aria-label="任务清单">
        <template v-for="list in visibleLists" :key="list.id">
          <form v-if="editingListId === list.id" class="sb-list-form" @submit.prevent="saveRename(list)">
            <input v-model="editingName" :aria-label="`重命名 ${list.name}`" />
            <button type="submit" class="sb-section__icon" :aria-label="`保存 ${list.name}`"><Check :size="13" aria-hidden="true" /></button>
            <button type="button" class="sb-section__icon" :aria-label="`取消 ${list.name}`" @click="editingListId = null"><X :size="13" aria-hidden="true" /></button>
          </form>
          <RouterLink v-else v-slot="{ href, navigate, isActive }" :to="`/lists/${list.id}`" custom>
            <div
              class="sb-tree__row sb-tree__row--list"
              :class="{ 'is-active': isActive }"
              draggable="true"
              @dragstart="onListDragStart(list)"
              @dragover.prevent
              @drop="onListDrop(list)"
            >
              <a :href="href" class="sb-tree__link" @click="navigate">
                <span class="sb-tree__name">{{ list.name }}</span>
              </a>
              <div class="sb-tree__hover-tools" @click.stop>
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
              </div>
            </div>
          </RouterLink>
        </template>
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

.sb-tree__row--list {
  gap: 4px;
  padding-right: 4px;
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

.sb-tree__link {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
}

.sb-tree__hover-tools {
  display: inline-flex;
  gap: 1px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.sb-tree__row:hover .sb-tree__hover-tools,
.sb-tree__row:focus-within .sb-tree__hover-tools,
.sb-tree__row.is-active .sb-tree__hover-tools {
  opacity: 1;
}

.sb-list-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px 22px;
  align-items: center;
  gap: 4px;
  height: 28px;
}

.sb-list-form input {
  height: 28px;
  min-width: 0;
  padding: 4px 8px;
}

.sb-list-error {
  margin: 0;
  padding: 0 8px;
  font-size: 12px;
  line-height: 1.4;
}

</style>
