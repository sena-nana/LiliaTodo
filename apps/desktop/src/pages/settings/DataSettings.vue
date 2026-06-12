<script setup lang="ts">
import { computed, ref } from "vue";
import { useTaskRepository } from "../../data/TaskRepositoryContext";
import { exportTasks, importTaskRecords, type TaskImportExportFormat } from "../../domain/taskImportExport";
import { formatDisplayError } from "../../utils/errors";

const repository = useTaskRepository();
const format = ref<TaskImportExportFormat>("json");
const exportText = ref("");
const importText = ref("");
const busy = ref(false);
const message = ref<string | null>(null);
const error = ref<string | null>(null);
const canImport = computed(() => importText.value.trim().length > 0 && !busy.value);

async function runExport() {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const tasks = await repository.listActiveTasks();
    exportText.value = exportTasks(tasks, format.value);
    message.value = `已导出 ${tasks.length} 个任务。`;
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function runImport() {
  busy.value = true;
  error.value = null;
  message.value = null;
  let importedCount = 0;
  try {
    const records = importTaskRecords(importText.value, format.value);
    for (const record of records) {
      const created = await repository.createTask(record.input);
      importedCount += 1;
      if (record.status !== "active") {
        await repository.setStatus(created.id, record.status);
      }
    }
    message.value = `已导入 ${records.length} 个任务。`;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    error.value = importedCount > 0
      ? `Error: 已导入 ${importedCount} 个任务，随后失败：${detail}`
      : e instanceof Error ? String(e) : `Error: ${detail}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card data-settings" aria-label="数据导入导出">
    <div class="settings-row">
      <div class="settings-row__label">
        <strong>导入导出格式</strong>
        <div class="settings-row__hint">支持 JSON、CSV 和 Markdown 文本，适合迁移和备份。</div>
      </div>
      <select v-model="format" aria-label="导入导出格式">
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
        <option value="markdown">Markdown</option>
      </select>
    </div>

    <div class="data-settings__actions">
      <button type="button" class="primary" :disabled="busy" @click="runExport">导出任务</button>
      <button type="button" :disabled="!canImport" @click="runImport">导入任务</button>
    </div>

    <p v-if="message" class="ok">{{ message }}</p>
    <p v-if="error" class="err">{{ formatDisplayError(error) }}</p>

    <label class="data-settings__field">
      <span>导出文本</span>
      <textarea v-model="exportText" aria-label="导出文本" readonly rows="8" />
    </label>

    <label class="data-settings__field">
      <span>导入文本</span>
      <textarea v-model="importText" aria-label="导入文本" rows="8" placeholder="粘贴要导入的任务文本" />
    </label>
  </section>
</template>

<style scoped>
.data-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.data-settings__actions {
  display: flex;
  gap: 8px;
}

.data-settings__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.data-settings__field textarea {
  min-height: 148px;
  resize: vertical;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-subtle);
  color: var(--text);
  font: inherit;
}
</style>
