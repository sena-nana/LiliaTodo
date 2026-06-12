<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import { useTaskDetailDrawer } from "../composables/useTaskDetailDrawer";
import {
  buildCalendarLoadAnalysis,
  buildScheduleSuggestions,
  buildTaskReschedulePatch,
  detectCalendarConflicts,
  getCalendarDays,
  getCalendarRange,
  getCalendarTitle,
  groupTasksByCalendarDate,
  moveCalendarAnchor,
  taskCalendarTime,
  toDateKey,
  type CalendarViewMode,
} from "../domain/calendar";
import type { Task } from "../domain/tasks";
import type { ScheduleSuggestion } from "../domain/calendar";
import { AsyncTaskDetailDrawer } from "../components/AsyncTaskDetailDrawer";
import PageStateBlock from "../components/PageStateBlock.vue";
import { formatDisplayError } from "../utils/errors";

const repository = useTaskRepository();
const tasks = ref<Task[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const anchorDate = ref(new Date());
const viewMode = ref<CalendarViewMode>("week");
const draggingTaskId = ref<string | null>(null);
const {
  selectedTask,
  childTasks,
  lists,
  categories,
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

const calendarDays = computed(() => getCalendarDays(viewMode.value, anchorDate.value));
const tasksByDate = computed(() => groupTasksByCalendarDate(tasks.value));
const rangeTitle = computed(() => getCalendarTitle(viewMode.value, anchorDate.value));
const scheduleSuggestions = computed(() => buildScheduleSuggestions(tasks.value));
const loadAnalysis = computed(() => buildCalendarLoadAnalysis(tasks.value));
const calendarConflicts = computed(() => detectCalendarConflicts(tasks.value));
const overflowTasks = computed(() => {
  const visibleDays = new Set(calendarDays.value.map((day) => day.key));
  return tasks.value.filter((task) => {
    const value = taskCalendarTime(task);
    if (!value) return false;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) || !visibleDays.has(toDateKey(date));
  });
});
const calendarHours = Array.from({ length: 15 }, (_, index) => index + 7);

onMounted(() => {
  void load();
});

watch([viewMode, anchorDate], () => {
  void load();
});

async function load() {
  loading.value = true;
  error.value = null;
  const range = getCalendarRange(viewMode.value, anchorDate.value);

  try {
    tasks.value = await repository.listAgenda(range.start, range.end);
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

function selectViewMode(mode: CalendarViewMode) {
  if (viewMode.value === mode) return;
  viewMode.value = mode;
}

function goToday() {
  anchorDate.value = new Date();
}

function moveRange(direction: -1 | 1) {
  anchorDate.value = moveCalendarAnchor(viewMode.value, anchorDate.value, direction);
}

function tasksForDay(key: string) {
  return tasksByDate.value[key] ?? [];
}

function taskTimeLabel(task: Task) {
  const value = taskCalendarTime(task);
  if (!value) return "09:00";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "无时间";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function dayHeading(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function dayNumber(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
  }).format(date);
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function resourceSummary() {
  if (loadAnalysis.value.topResources.length === 0) return "暂无资源占用";
  return loadAnalysis.value.topResources.map((item) => `${item.label} ${item.count}`).join("、");
}

function onTaskDragStart(task: Task) {
  draggingTaskId.value = task.id;
}

function onTaskDragEnd() {
  draggingTaskId.value = null;
}

async function onDayDrop(date: Date) {
  const taskId = draggingTaskId.value;
  draggingTaskId.value = null;
  if (!taskId) return;
  const task = tasks.value.find((item) => item.id === taskId);
  if (!task) return;

  error.value = null;
  try {
    await repository.updateTask(task.id, buildTaskReschedulePatch(task, date));
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

async function applyScheduleSuggestion(suggestion: ScheduleSuggestion) {
  if (!suggestion.taskId || !suggestion.patch) return;
  error.value = null;
  try {
    await repository.updateTask(suggestion.taskId, suggestion.patch);
    await load();
  } catch (e) {
    error.value = String(e);
  }
}

</script>

<template>
  <section class="page calendar-page">
    <header class="calendar-toolbar" aria-label="日历工具栏">
      <div class="calendar-toolbar__range">
        <button type="button" class="icon-button" aria-label="上一段" title="上一段" @click="moveRange(-1)">
          <ChevronLeft :size="17" aria-hidden="true" />
        </button>
        <button type="button" class="ghost" aria-label="今天" @click="goToday">
          <RotateCcw :size="15" aria-hidden="true" />
          今天
        </button>
        <button type="button" class="icon-button" aria-label="下一段" title="下一段" @click="moveRange(1)">
          <ChevronRight :size="17" aria-hidden="true" />
        </button>
        <strong>{{ rangeTitle }}</strong>
      </div>
      <div class="segmented" aria-label="日历视图">
        <button type="button" :class="{ 'is-active': viewMode === 'day' }" @click="selectViewMode('day')">日</button>
        <button type="button" :class="{ 'is-active': viewMode === 'week' }" @click="selectViewMode('week')">周</button>
        <button type="button" :class="{ 'is-active': viewMode === 'month' }" @click="selectViewMode('month')">月</button>
      </div>
    </header>

    <PageStateBlock v-if="loading" kind="loading" title="正在加载日程..." />
    <PageStateBlock v-else-if="error && tasks.length === 0" kind="error" :title="formatDisplayError(error)" @action="load" />
    <p v-else-if="error" class="calendar-error">{{ formatDisplayError(error) }}</p>

    <section v-if="!loading && tasks.length > 0" class="calendar-load" aria-label="容量与负载">
      <div class="calendar-load__item">
        <span>估时总量</span>
        <b>{{ formatMinutes(loadAnalysis.totalEstimateMin) }}</b>
        <small v-if="loadAnalysis.unknownEstimateCount > 0">{{ loadAnalysis.unknownEstimateCount }} 个任务按 30 分钟估算</small>
      </div>
      <div class="calendar-load__item" :class="{ 'is-warn': loadAnalysis.overloadedDays.length > 0 }">
        <span>超载天数</span>
        <b>{{ loadAnalysis.overloadedDays.length }}</b>
        <small v-if="loadAnalysis.overloadedDays.length > 0">
          {{ loadAnalysis.overloadedDays.map((day) => day.date).join("、") }}
        </small>
      </div>
      <div class="calendar-load__item" :class="{ 'is-danger': loadAnalysis.overdueRiskCount > 0 }">
        <span>逾期风险</span>
        <b>{{ loadAnalysis.overdueRiskCount }}</b>
        <small>已过截止时间的活跃任务</small>
      </div>
      <div class="calendar-load__item">
        <span>资源占用</span>
        <b>{{ loadAnalysis.resourceTaskCount }}</b>
        <small>{{ resourceSummary() }}</small>
      </div>
    </section>

    <section v-if="!loading && calendarConflicts.length > 0" class="calendar-conflicts" aria-label="冲突检测">
      <div class="calendar-conflicts__header">
        <h2>冲突检测</h2>
        <span class="pill">{{ calendarConflicts.length }}</span>
      </div>
      <ol class="calendar-conflicts__list">
        <li
          v-for="conflict in calendarConflicts"
          :key="conflict.id"
          :class="`is-${conflict.severity}`"
        >
          <b>{{ conflict.title }}</b>
          <p>{{ conflict.detail }}</p>
        </li>
      </ol>
    </section>

    <section
      v-if="!loading && scheduleSuggestions.length > 0"
      class="schedule-suggestions"
      aria-label="排期建议"
    >
      <div class="schedule-suggestions__header">
        <h2>排期建议</h2>
        <span class="pill">{{ scheduleSuggestions.length }}</span>
      </div>
      <ol class="schedule-suggestions__list">
        <li v-for="suggestion in scheduleSuggestions" :key="suggestion.id">
          <div>
            <b>{{ suggestion.title }}</b>
            <p>{{ suggestion.detail }}</p>
          </div>
          <button
            v-if="suggestion.taskId && suggestion.patch"
            type="button"
            class="ghost"
            @click="applyScheduleSuggestion(suggestion)"
          >
            应用建议
          </button>
        </li>
      </ol>
    </section>

    <section
      v-if="!loading && tasks.length === 0 && !error"
      class="calendar-empty"
    >
      <PageStateBlock kind="empty" title="当前范围暂无已安排任务。" />
    </section>

    <section
      v-if="!loading && (tasks.length > 0 || error)"
      class="calendar-grid"
      :class="[`calendar-grid--${viewMode}`]"
    >
      <template v-if="viewMode === 'day'">
        <div class="calendar-day-panel">
          <div class="calendar-day-panel__hours" aria-hidden="true">
            <span v-for="hour in calendarHours" :key="hour">{{ hourLabel(hour) }}</span>
          </div>
          <div
            class="calendar-day calendar-day--single"
            :aria-label="`${toDateKey(calendarDays[0].date)} 日程`"
            @dragover.prevent
            @drop="onDayDrop(calendarDays[0].date)"
          >
            <div class="calendar-day__header">
              <span>{{ dayHeading(calendarDays[0].date) }}</span>
              <span class="pill">{{ tasksForDay(calendarDays[0].key).length }}</span>
            </div>
            <div class="calendar-day__tasks">
              <button
                v-for="task in tasksForDay(calendarDays[0].key)"
                :key="task.id"
                type="button"
                class="calendar-task"
                draggable="true"
                :aria-label="`${task.title} ${taskTimeLabel(task)}`"
                @click="openTask(task)"
                @dragstart="onTaskDragStart(task)"
                @dragend="onTaskDragEnd"
              >
                <time>{{ taskTimeLabel(task) }}</time>
                <span>{{ task.title }}</span>
                <b v-if="task.priority > 0">P{{ task.priority }}</b>
              </button>
              <p v-if="tasksForDay(calendarDays[0].key).length === 0" class="calendar-day__empty">暂无任务。</p>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div
          v-for="day in calendarDays"
          :key="day.key"
          class="calendar-day"
          :class="{ 'calendar-day--muted': !day.inCurrentRange }"
          :aria-label="`${day.key} 日程`"
          @dragover.prevent
          @drop="onDayDrop(day.date)"
        >
          <div class="calendar-day__header">
            <span v-if="viewMode === 'week'">{{ dayHeading(day.date) }}</span>
            <span v-else>{{ dayNumber(day.date) }}</span>
            <span class="pill">{{ tasksForDay(day.key).length }}</span>
          </div>
          <div class="calendar-day__tasks">
            <button
              v-for="task in tasksForDay(day.key)"
              :key="task.id"
              type="button"
              class="calendar-task"
              draggable="true"
              :aria-label="`${task.title} ${taskTimeLabel(task)}`"
              @click="openTask(task)"
              @dragstart="onTaskDragStart(task)"
              @dragend="onTaskDragEnd"
            >
              <time>{{ taskTimeLabel(task) }}</time>
              <span>{{ task.title }}</span>
              <b v-if="task.priority > 0">P{{ task.priority }}</b>
            </button>
            <p v-if="viewMode === 'week' && tasksForDay(day.key).length === 0" class="calendar-day__empty">暂无任务。</p>
          </div>
        </div>
      </template>
    </section>

    <section v-if="!loading && overflowTasks.length > 0" class="calendar-overflow" aria-label="其他日程">
      <div class="calendar-overflow__header">
        <h2>其他日程</h2>
        <span class="pill">{{ overflowTasks.length }}</span>
      </div>
      <div class="calendar-day__tasks">
        <button
          v-for="task in overflowTasks"
          :key="task.id"
          type="button"
          class="calendar-task"
          draggable="true"
          :aria-label="`${task.title} ${taskTimeLabel(task)}`"
          @click="openTask(task)"
          @dragstart="onTaskDragStart(task)"
          @dragend="onTaskDragEnd"
        >
          <time>{{ taskTimeLabel(task) }}</time>
          <span>{{ task.title }}</span>
          <b v-if="task.priority > 0">P{{ task.priority }}</b>
        </button>
      </div>
    </section>

    <AsyncTaskDetailDrawer
      v-if="selectedTask"
      :task="selectedTask"
      :lists="lists"
      :categories="categories"
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

<style scoped>
.calendar-page {
  min-width: 0;
}

.calendar-toolbar {
  min-height: 42px;
  padding: 4px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.calendar-toolbar__range {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.calendar-toolbar__range strong {
  margin-left: 4px;
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.calendar-error {
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 1px solid var(--err);
  border-radius: 8px;
  background: var(--err-soft);
  color: var(--err);
}

.calendar-empty {
  margin-top: 4px;
}

.calendar-load {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.calendar-load__item {
  min-width: 0;
  min-height: 76px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.calendar-load__item span,
.calendar-load__item small {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.calendar-load__item b {
  display: block;
  margin-top: 2px;
  font-size: 18px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.calendar-load__item.is-warn b {
  color: var(--warn);
}

.calendar-load__item.is-danger b {
  color: var(--err);
}

.calendar-conflicts {
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  overflow: hidden;
}

.calendar-conflicts__header {
  height: 38px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
}

.calendar-conflicts__header h2 {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.calendar-conflicts__list {
  list-style: none;
  padding: 4px 10px;
  margin: 0;
}

.calendar-conflicts__list li {
  padding: 7px 0 7px 10px;
  border-left: 2px solid var(--warn);
  border-bottom: 1px solid var(--border-soft);
}

.calendar-conflicts__list li:last-child {
  border-bottom: 0;
}

.calendar-conflicts__list li.is-danger {
  border-left-color: var(--err);
}

.calendar-conflicts__list b {
  display: block;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.calendar-conflicts__list p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.schedule-suggestions {
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  overflow: hidden;
}

.schedule-suggestions__header {
  height: 38px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
}

.schedule-suggestions__header h2 {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.schedule-suggestions__list {
  list-style: none;
  padding: 4px 10px;
  margin: 0;
}

.schedule-suggestions__list li {
  padding: 7px 0;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.schedule-suggestions__list li:last-child {
  border-bottom: 0;
}

.schedule-suggestions__list b {
  display: block;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.schedule-suggestions__list div {
  min-width: 0;
}

.schedule-suggestions__list button {
  flex: 0 0 auto;
}

.schedule-suggestions__list p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.calendar-grid {
  display: grid;
  gap: 8px;
}

.calendar-grid--week {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.calendar-grid--month {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.calendar-day-panel {
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr);
  gap: 8px;
}

.calendar-day-panel__hours {
  display: grid;
  grid-template-rows: repeat(15, 32px);
  padding-top: 42px;
  color: var(--text-muted);
  font-size: 12px;
}

.calendar-day {
  min-width: 0;
  min-height: 158px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  overflow: hidden;
}

.calendar-grid--month .calendar-day {
  min-height: 112px;
}

.calendar-day--single {
  min-height: 522px;
}

.calendar-day--muted {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

.calendar-day__header {
  height: 38px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.calendar-day__tasks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px;
}

.calendar-task {
  width: 100%;
  min-height: 30px;
  height: auto;
  padding: 5px 7px;
  justify-content: flex-start;
  gap: 6px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 12px;
  line-height: 1.35;
  text-align: left;
}

.calendar-task:hover {
  background: var(--bg-hover);
}

.calendar-task time {
  flex: 0 0 auto;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.calendar-task span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.calendar-task b {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.calendar-day__empty {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.calendar-overflow {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  overflow: hidden;
}

.calendar-overflow__header {
  height: 38px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--border-soft);
}

.calendar-overflow__header h2 {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .calendar-load {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .calendar-grid--week,
  .calendar-grid--month {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .calendar-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .calendar-toolbar__range {
    flex-wrap: wrap;
  }

  .calendar-grid--week,
  .calendar-grid--month {
    grid-template-columns: 1fr;
  }

  .calendar-load {
    grid-template-columns: 1fr;
  }

  .calendar-day-panel {
    grid-template-columns: 1fr;
  }

  .calendar-day-panel__hours {
    display: none;
  }
}
</style>
