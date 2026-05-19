<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Database, Loader2, RefreshCw } from "lucide-vue-next";
import { useTaskRepository } from "../data/TaskRepositoryContext";
import type { DatabaseStats, SyncRun, SyncState } from "../data/taskRepository";
import type { PendingLocalChangeSummary } from "../data/changeSummary";
import { summarizePendingLocalChanges } from "../data/changeSummary";
import WebdavSettingsCard from "../components/WebdavSettingsCard.vue";

const repository = useTaskRepository();

const stats = ref<DatabaseStats | null>(null);
const syncState = ref<SyncState | null>(null);
const syncRuns = ref<SyncRun[]>([]);
const pendingChanges = ref<PendingLocalChangeSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const syncRunsLoading = ref(false);
const syncRunsError = ref<string | null>(null);
const pendingChangesLoading = ref(false);
const pendingChangesError = ref<string | null>(null);

onMounted(() => {
  void load();
});

async function load() {
  loading.value = true;
  error.value = null;
  syncRunsError.value = null;
  try {
    const [nextStats, nextSyncState] = await Promise.all([
      repository.getStats(),
      repository.getSyncState(),
    ]);
    stats.value = nextStats;
    syncState.value = nextSyncState;
  } catch (e) {
    stats.value = null;
    syncState.value = null;
    error.value = String(e);
  } finally {
    loading.value = false;
  }

  await Promise.all([loadSyncRuns(), loadPendingChanges()]);
}

async function loadSyncRuns() {
  syncRunsLoading.value = true;
  syncRunsError.value = null;
  try {
    syncRuns.value = await repository.listRecentSyncRuns(3);
  } catch (e) {
    syncRuns.value = [];
    syncRunsError.value = String(e);
  } finally {
    syncRunsLoading.value = false;
  }
}

async function loadPendingChanges() {
  pendingChangesLoading.value = true;
  pendingChangesError.value = null;
  try {
    const changes = await repository.listPendingChanges();
    pendingChanges.value = summarizePendingLocalChanges(changes, 5);
  } catch (e) {
    pendingChanges.value = [];
    pendingChangesError.value = String(e);
  } finally {
    pendingChangesLoading.value = false;
  }
}

function displayError(value: string) {
  const message = value.replace(/^Error:\s*/, "");
  return `错误：${message}`;
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h1>设置</h1>
      <span class="page__sub">偏好 · WebDAV 同步 · 模型路由 · 安全</span>
    </header>
    <div class="card">
      <h2>构建</h2>
      <ul class="kv">
        <li><span>阶段</span><b>Foundation / MVP-bootstrap</b></li>
        <li><span>前端</span><b>Tauri 2 + Vue 3 + TypeScript</b></li>
        <li><span>同步</span><b>WebDAV（坚果云优先）</b></li>
      </ul>
    </div>

    <WebdavSettingsCard @sync-done="load" />

    <div class="card">
      <div class="section-title">
        <h2>本地数据库</h2>
        <Database :size="16" aria-hidden="true" />
      </div>
      <div v-if="error" class="state state--error">
        <p>{{ displayError(error) }}</p>
        <button type="button" @click="load">
          <RefreshCw :size="16" aria-hidden="true" />
          重试
        </button>
      </div>
      <div v-if="loading && !error" class="state state--inline">
        <Loader2 class="spin" :size="18" aria-hidden="true" />
        <p>正在加载数据库状态...</p>
      </div>
      <ul v-if="stats && !loading && !error" class="kv">
        <li><span>路径</span><b>{{ stats.databasePath }}</b></li>
        <li><span>任务总数</span><b>{{ stats.totalTasks }}</b></li>
        <li><span>进行中</span><b>{{ stats.activeTasks }}</b></li>
        <li><span>已完成</span><b>{{ stats.completedTasks }}</b></li>
        <li><span>待同步</span><b>{{ stats.pendingLocalChanges }}</b></li>
      </ul>
    </div>

    <div v-if="syncState && !loading && !error" class="card">
      <div class="section-title">
        <h2>同步状态</h2>
      </div>
      <ul class="kv">
        <li><span>服务端游标</span><b>{{ syncState.serverCursor ?? "无" }}</b></li>
        <li><span>最近同步</span><b>{{ syncState.lastSyncedAt ?? "从未同步" }}</b></li>
        <li><span>最近错误</span><b>{{ syncState.lastError ?? "无" }}</b></li>
        <li><span>更新时间</span><b>{{ syncState.updatedAt ?? "未记录" }}</b></li>
      </ul>
    </div>

    <div
      v-if="(pendingChanges.length > 0 || pendingChangesError) && !loading && !error"
      class="card"
    >
      <div class="section-title">
        <h2>待同步变更</h2>
        <span class="pill">{{ pendingChanges.length }}</span>
      </div>
      <div v-if="pendingChangesError" class="state state--error">
        <p>{{ displayError(pendingChangesError) }}</p>
        <button type="button" :disabled="pendingChangesLoading" @click="loadPendingChanges">
          <RefreshCw :size="16" aria-hidden="true" />
          重试待同步变更
        </button>
      </div>
      <ul class="conflict-list">
        <li v-for="change in pendingChanges" :key="change.id">
          <div>
            <strong>{{ change.id }}</strong>
            <span class="pill">{{ change.action }}</span>
          </div>
          <p>{{ change.entityLabel }}</p>
          <p>{{ change.payloadSummary }}</p>
          <p class="muted">创建于 {{ change.createdAt }}</p>
        </li>
      </ul>
    </div>

    <div v-if="(syncRuns.length > 0 || syncRunsError) && !loading && !error" class="card">
      <div class="section-title">
        <h2>同步历史</h2>
        <span class="pill">{{ syncRuns.length }}</span>
      </div>
      <div v-if="syncRunsError" class="state state--error">
        <p>{{ displayError(syncRunsError) }}</p>
        <button type="button" :disabled="syncRunsLoading" @click="loadSyncRuns">
          <RefreshCw :size="16" aria-hidden="true" />
          重试同步历史
        </button>
      </div>
      <ul class="conflict-list">
        <li v-for="run in syncRuns" :key="run.id">
          <div>
            <strong>{{ run.message }}</strong>
            <span class="pill">{{ run.status }}</span>
          </div>
          <p>游标：<span>{{ run.serverCursor ?? "无" }}</span></p>
          <p class="muted">开始 {{ run.startedAt }} · 完成 {{ run.finishedAt }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>
