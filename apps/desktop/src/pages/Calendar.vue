<script setup lang="ts">
import { onMounted, ref } from "vue";
import { CalendarDays, Loader2, RefreshCw } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import type { Task } from "../domain/tasks";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";

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

function displayError(value: string) {
  return value.replace(/^Error:\s*/, "错误：");
}
</script>

<template>
  <section class="page">
    <div v-if="loading" class="card state">
      <Loader2 class="spin" :size="18" aria-hidden="true" />
      <p>正在加载日程...</p>
    </div>
    <div v-if="error" class="card state state--error">
      <p>{{ displayError(error) }}</p>
      <button type="button" @click="load">
        <RefreshCw :size="16" aria-hidden="true" />
        重试
      </button>
    </div>
    <div v-if="!loading && !error && tasks.length === 0" class="card empty">
      <CalendarDays :size="20" aria-hidden="true" />
      <p>未来 7 天暂无已安排任务。</p>
    </div>
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
    <TaskDetailDrawer
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
    />
  </section>
</template>
