<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import type { Task } from "../domain/tasks";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import PageStateBlock from "../components/PageStateBlock.vue";
import { formatDisplayError } from "../utils/errors";

const repository = useTaskRepository();
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const {
  selectedTask,
  childTasks,
  lists,
  saving,
  drawerError,
  parentCandidates,
  openTask,
  saveTask,
  completeTask,
  deleteTask,
  reorderChildTasks,
  closeTask,
} = useTaskDetailDrawer({
  repository,
  reload: load,
  getParentCandidates: () => tasks.value,
});

onMounted(() => {
  void load();
});

async function load() {
  loading.value = true;
  error.value = null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  try {
    tasks.value = await repository.listAgenda(start, end);
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function formatAgendaDate(value: string | null) {
  if (!value) return "未安排";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

</script>

<template>
  <section class="page">
    <PageStateBlock v-if="loading" kind="loading" title="正在加载日程..." />
    <PageStateBlock v-else-if="error" kind="error" :title="formatDisplayError(error)" @action="load" />
    <PageStateBlock v-else-if="tasks.length === 0" kind="empty" title="未来 7 天暂无已安排任务。" />
    <ol v-if="!loading && !error && tasks.length > 0" class="timeline">
      <li v-for="task in tasks" :key="task.id" class="timeline__item task-item--clickable" @click="openTask(task)">
        <time>{{ formatAgendaDate(task.startAt ?? task.dueAt) }}</time>
        <div>
          <b>{{ task.title }}</b>
          <p v-if="task.notes">{{ task.notes }}</p>
          <p v-if="task.dueAt">截止 {{ formatAgendaDate(task.dueAt) }}</p>
        </div>
      </li>
    </ol>
    <AsyncTaskDetailDrawer
      v-if="selectedTask"
      :task="selectedTask"
      :lists="lists"
      :parent-candidates="parentCandidates"
      :children="childTasks"
      :saving="saving"
      :error="drawerError"
      @close="closeTask"
      @save="saveTask"
      @complete="completeTask"
      @delete="deleteTask"
      @open-task="openTask"
      @reorder-children="reorderChildTasks"
    />
  </section>
</template>
