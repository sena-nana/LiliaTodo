import { computed, inject, onMounted, reactive, ref } from "vue";
import {
  WebdavSecretsStoreKey,
  WebdavSyncControllerKey,
} from "../sync/settingsSyncContext";
import { WEBDAV_DEFAULT_ROOT, type WebdavSecrets } from "../sync/webdav";
import type { WebdavRunReport, WebdavSecretsStore } from "../sync/webdav";
import type { WebdavSyncController } from "../sync/defaultSettingsSyncRuntime";

export interface WebdavSecretsFormState {
  baseUrl: string;
  root: string;
  username: string;
  password: string;
  deviceId: string;
}

interface UseWebdavSyncOptions {
  secretsStore?: WebdavSecretsStore | null;
  controller?: WebdavSyncController | null;
}

export function useWebdavSync(options: UseWebdavSyncOptions = {}) {
  const secretsStore =
    options.secretsStore ?? inject(WebdavSecretsStoreKey, null);
  const controller =
    options.controller ?? inject(WebdavSyncControllerKey, null);

  const form = reactive<WebdavSecretsFormState>({
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
    await loadInitialState();
  });

  async function loadInitialState() {
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
    await refreshInspectReason();
  }

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
      await refreshInspectReason();
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
      await refreshInspectReason();
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

  async function refreshInspectReason() {
    if (!controller) return;
    const status = await controller.inspect();
    inspectReason.value = status.kind === "disabled" ? status.reason : null;
  }

  return {
    secretsStore,
    controller,
    form,
    initialLoading,
    saving,
    syncing,
    formError,
    saveOk,
    syncReport,
    syncError,
    inspectReason,
    hasSavedSecrets,
    passwordPlaceholder,
    handleSave,
    handleClear,
    handleSyncNow,
  };
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
