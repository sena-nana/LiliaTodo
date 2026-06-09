<script setup lang="ts">
import { Loader2 } from "lucide-vue-next";
import type { WebdavSecretsFormState } from "../composables/useWebdavSync";

defineProps<{
  form: WebdavSecretsFormState;
  saving: boolean;
  hasSavedSecrets: boolean;
  passwordPlaceholder: string;
  saveOk: string | null;
  formError: string | null;
}>();

defineEmits<{
  save: [];
  clear: [];
  editableContextMenu: [event: MouseEvent];
}>();
</script>

<template>
  <form class="form" @submit.prevent="$emit('save')">
    <label class="field">
      <span>Base URL</span>
      <input v-model="form.baseUrl" type="url" autocomplete="off" required @contextmenu="$emit('editableContextMenu', $event)" />
    </label>
    <label class="field">
      <span>根目录</span>
      <input v-model="form.root" type="text" autocomplete="off" placeholder="/momo" @contextmenu="$emit('editableContextMenu', $event)" />
    </label>
    <label class="field">
      <span>用户名</span>
      <input v-model="form.username" type="text" autocomplete="off" required @contextmenu="$emit('editableContextMenu', $event)" />
    </label>
    <label class="field">
      <span>应用密码</span>
      <input
        v-model="form.password"
        type="password"
        autocomplete="new-password"
        :placeholder="passwordPlaceholder"
        @contextmenu="$emit('editableContextMenu', $event)"
      />
    </label>
    <label class="field">
      <span>设备 ID</span>
      <input v-model="form.deviceId" type="text" autocomplete="off" @contextmenu="$emit('editableContextMenu', $event)" />
    </label>
    <div class="form__actions">
      <button class="primary" type="submit" :disabled="saving">
        <Loader2 v-if="saving" class="spin" :size="14" aria-hidden="true" />
        保存凭据
      </button>
      <button type="button" :disabled="!hasSavedSecrets" @click="$emit('clear')">
        清除凭据
      </button>
    </div>
  </form>
  <p v-if="saveOk" class="ok">{{ saveOk }}</p>
  <p v-if="formError" class="err">{{ formError }}</p>
</template>

<style scoped>
.form {
  display: grid;
  gap: 6px;
}
.field {
  display: grid;
  grid-template-columns: 88px 1fr;
  align-items: center;
  gap: 8px;
}
.field span {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}
.field input {
  height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.form__actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
</style>
