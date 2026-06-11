<script setup lang="ts">
import { useAgentSettings } from "../../agent/settings";

const settings = useAgentSettings();
</script>

<template>
  <section class="page">
    <div class="card agent-settings">
      <div class="agent-settings__row">
        <div>
          <strong>自动触发</strong>
          <p>任务创建、更新、逾期、提醒到期和每日首次启动时生成建议。</p>
        </div>
        <label class="switch">
          <input v-model="settings.automaticTriggersEnabled" type="checkbox" />
          <span>启用</span>
        </label>
      </div>
      <ul class="kv">
        <li>
          <span>写入保护</span>
          <span>所有 Agent 写入进入确认队列</span>
        </li>
        <li>
          <span>审计撤销</span>
          <span>确认执行后按批次记录</span>
        </li>
        <li>
          <span>默认后端</span>
          <span>未配置时保持禁用</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.agent-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.agent-settings__row p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
