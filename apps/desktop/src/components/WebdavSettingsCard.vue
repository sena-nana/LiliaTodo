<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref } from "vue";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-vue-next";
import {
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "../data/TaskRepositoryContext";
import { WEBDAV_DEFAULT_ROOT, type WebdavSecrets } from "../sync/webdav";
import type { WebdavRunReport } from "../sync/webdav";
import { buildEditableContextMenuItems, useContextMenu } from "./contextMenu";

const contextMenu = useContextMenu();
function onEditableContextMenu(event: MouseEvent) {
  contextMenu.show(event, buildEditableContextMenuItems(event));
}

interface SecretsFormState {
  baseUrl: string;
  root: string;
  username: string;
  password: string;
  deviceId: string;
}

const secretsStore = inject(WebdavSecretsStoreKey, null);
const controller = inject(WebdavSyncControllerKey, null);

const form = reactive<SecretsFormState>({
  baseUrl: "https://dav.jianguoyun.com/dav",
  root: WEBDAV_DEFAULT_ROOT,
  username: "",
  password: "",
  deviceId: "",
});

const initialLoading = ref(true);
const saving = ref(false);
const syncing = ref(false);
const formError = ref<string | null>(null);
const saveOk = ref<string | null>(null);
const syncReport = ref<WebdavRunReport | null>(null);
const syncError = ref<string | null>(null);
const inspectReason = ref<string | null>(null);

const hasSavedSecrets = ref(false);

const passwordPlaceholder = computed(() =>
  hasSavedSecrets.value ? "（已保存；留空则保持不变）" : "应用密码 / 第三方授权",
);

onMounted(async () => {
  if (!secretsStore) {
    initialLoading.value = false;
    return;
  }
  try {
    const existing = await secretsStore.load();
    if (existing) {
      hasSavedSecrets.value = true;
      form.baseUrl = existing.baseUrl;
      form.root = existing.root;
      form.username = existing.username;
      form.deviceId = existing.deviceId;
      // 密码不回填到表单输入框，避免无意覆盖。
      form.password = "";
    } else {
      form.deviceId = form.deviceId || generateDeviceId();
    }
  } catch (e) {
    formError.value = displayError(String(e));
  } finally {
    initialLoading.value = false;
  }
  if (controller) {
    const status = await controller.inspect();
    inspectReason.value = status.kind === "disabled" ? status.reason : null;
  }
});

async function handleSave() {
  if (!secretsStore) return;
  formError.value = null;
  saveOk.value = null;
  try {
    const secrets = await buildSecretsFromForm();
    saving.value = true;
    await secretsStore.save(secrets);
    hasSavedSecrets.value = true;
    form.password = "";
    saveOk.value = "已保存到本机安全存储";
    if (controller) {
      const status = await controller.inspect();
      inspectReason.value = status.kind === "disabled" ? status.reason : null;
    }
  } catch (e) {
    formError.value = displayError(String(e));
  } finally {
    saving.value = false;
  }
}

async function handleClear() {
  if (!secretsStore) return;
  formError.value = null;
  saveOk.value = null;
  try {
    await secretsStore.clear();
    hasSavedSecrets.value = false;
    form.password = "";
    saveOk.value = "已清除本机 WebDAV 凭据";
    if (controller) {
      const status = await controller.inspect();
      inspectReason.value = status.kind === "disabled" ? status.reason : null;
    }
  } catch (e) {
    formError.value = displayError(String(e));
  }
}

async function handleSyncNow() {
  if (!controller) return;
  syncing.value = true;
  syncReport.value = null;
  syncError.value = null;
  try {
    const result = await controller.runOnce();
    if (result.ok) {
      syncReport.value = result.report;
    } else {
      syncError.value = displayError(result.error);
    }
  } finally {
    syncing.value = false;
  }
}

async function buildSecretsFromForm(): Promise<WebdavSecrets> {
  const baseUrl = form.baseUrl.trim();
  const root = form.root.trim() || WEBDAV_DEFAULT_ROOT;
  const username = form.username.trim();
  const deviceId = form.deviceId.trim() || generateDeviceId();
  if (!baseUrl) throw new Error("WebDAV base URL 不能为空");
  if (!username) throw new Error("WebDAV 用户名不能为空");
  let password = form.password;
  if (!password) {
    if (!hasSavedSecrets.value) {
      throw new Error("首次保存必须填写应用密码");
    }
    const existing = await secretsStore!.load();
    if (!existing) throw new Error("既有凭据已丢失，请重新输入密码");
    password = existing.password;
  }
  return { baseUrl, root, username, password, deviceId };
}

function generateDeviceId() {
  if (globalThis.crypto?.randomUUID) {
    return `desk-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `desk-${Math.random().toString(36).slice(2, 10)}`;
}

function displayError(value: string) {
  const message = value.replace(/^Error:\s*/, "");
  return `错误：${message}`;
}
</script>

<template>
  <div class="card">
    <div class="section-title">
      <h2>WebDAV 同步（坚果云优先）</h2>
      <ShieldCheck :size="16" aria-hidden="true" />
    </div>
    <p v-if="!secretsStore" class="empty-text">
      未注入凭据存储，请确认 plugin-store 已启用。
    </p>
    <p v-else-if="initialLoading" class="empty-text">
      <Loader2 class="spin" :size="14" aria-hidden="true" /> 正在读取本机凭据…
    </p>
    <template v-else-if="secretsStore">
      <form class="form" @submit.prevent="handleSave">
        <label class="field">
          <span>Base URL</span>
          <input v-model="form.baseUrl" type="url" autocomplete="off" required @contextmenu="onEditableContextMenu" />
        </label>
        <label class="field">
          <span>根目录</span>
          <input v-model="form.root" type="text" autocomplete="off" placeholder="/momo" @contextmenu="onEditableContextMenu" />
        </label>
        <label class="field">
          <span>用户名</span>
          <input v-model="form.username" type="text" autocomplete="off" required @contextmenu="onEditableContextMenu" />
        </label>
        <label class="field">
          <span>应用密码</span>
          <input
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            :placeholder="passwordPlaceholder"
            @contextmenu="onEditableContextMenu"
          />
        </label>
        <label class="field">
          <span>设备 ID</span>
          <input v-model="form.deviceId" type="text" autocomplete="off" @contextmenu="onEditableContextMenu" />
        </label>
        <div class="form__actions">
          <button type="submit" :disabled="saving">
            <Loader2 v-if="saving" class="spin" :size="14" aria-hidden="true" />
            保存凭据
          </button>
          <button type="button" :disabled="!hasSavedSecrets" @click="handleClear">
            清除凭据
          </button>
        </div>
      </form>
      <p v-if="saveOk" class="ok">{{ saveOk }}</p>
      <p v-if="formError" class="err">{{ formError }}</p>
      <p v-if="inspectReason && !formError" class="muted">{{ inspectReason }}</p>

      <div v-if="controller" class="form__actions">
        <button type="button" :disabled="syncing || !hasSavedSecrets" @click="handleSyncNow">
          <Loader2 v-if="syncing" class="spin" :size="14" aria-hidden="true" />
          <RefreshCw v-else :size="14" aria-hidden="true" />
          立即同步
        </button>
      </div>
      <p v-if="syncError" class="err">{{ syncError }}</p>
      <p v-if="syncReport" class="ok">{{ syncReport.message }}</p>
    </template>
  </div>
</template>

<style scoped>
.form {
  display: grid;
  gap: 8px;
}
.field {
  display: grid;
  grid-template-columns: 96px 1fr;
  align-items: center;
  gap: 8px;
}
.field input {
  padding: 4px 8px;
  border: 1px solid var(--c-border, #ccc);
  border-radius: 4px;
  background: var(--c-input-bg, transparent);
  color: inherit;
}
.form__actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.ok {
  color: var(--c-ok, #2c8a3f);
  margin-top: 4px;
}
.err {
  color: var(--c-err, #c0392b);
  margin-top: 4px;
}
.muted {
  color: var(--c-muted, #888);
  margin-top: 4px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
