<script setup lang="ts">
import { Loader2, ShieldCheck } from "lucide-vue-next";
import { useWebdavSync } from "../composables/useWebdavSync";
import { buildEditableContextMenuItems, useContextMenu } from "./contextMenu";
import WebdavCredentialsForm from "./WebdavCredentialsForm.vue";
import WebdavSyncStatus from "./WebdavSyncStatus.vue";

const contextMenu = useContextMenu();
function onEditableContextMenu(event: MouseEvent) {
  contextMenu.show(event, buildEditableContextMenuItems(event));
}

const webdav = useWebdavSync();
</script>

<template>
  <div class="card">
    <div class="section-title">
      <h2>WebDAV 同步（坚果云优先）</h2>
      <ShieldCheck :size="16" aria-hidden="true" />
    </div>
    <p v-if="!webdav.secretsStore" class="empty-text">
      未注入凭据存储，请确认 plugin-store 已启用。
    </p>
    <p v-else-if="webdav.initialLoading.value" class="empty-text">
      <Loader2 class="spin" :size="14" aria-hidden="true" /> 正在读取本机凭据…
    </p>
    <template v-else>
      <WebdavCredentialsForm
        :form="webdav.form"
        :saving="webdav.saving.value"
        :has-saved-secrets="webdav.hasSavedSecrets.value"
        :password-placeholder="webdav.passwordPlaceholder.value"
        :save-ok="webdav.saveOk.value"
        :form-error="webdav.formError.value"
        @save="webdav.handleSave"
        @clear="webdav.handleClear"
        @editable-context-menu="onEditableContextMenu"
      />
      <WebdavSyncStatus
        :controller-available="Boolean(webdav.controller)"
        :syncing="webdav.syncing.value"
        :has-saved-secrets="webdav.hasSavedSecrets.value"
        :inspect-reason="webdav.formError.value ? null : webdav.inspectReason.value"
        :sync-error="webdav.syncError.value"
        :sync-report="webdav.syncReport.value"
        @sync-now="webdav.handleSyncNow"
      />
    </template>
  </div>
</template>
