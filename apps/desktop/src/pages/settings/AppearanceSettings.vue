<script setup lang="ts">
import { Moon, Sun } from "lucide-vue-next";
import { useTheme } from "../../composables/useTheme";

const { theme, setTheme } = useTheme();
</script>

<template>
  <section class="page">
    <div class="card">
      <div class="settings-row">
        <div class="settings-row__label">
          <div>主题</div>
          <div class="settings-row__hint">选择应用配色，立即生效并记忆到本地。</div>
        </div>
        <div class="segmented" role="radiogroup" aria-label="主题">
          <button
            type="button"
            role="radio"
            :aria-checked="theme === 'dark'"
            :class="{ 'is-active': theme === 'dark' }"
            @click="setTheme('dark')"
          >
            <Moon :size="14" aria-hidden="true" />
            暗色
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="theme === 'light'"
            :class="{ 'is-active': theme === 'light' }"
            @click="setTheme('light')"
          >
            <Sun :size="14" aria-hidden="true" />
            浅色
          </button>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">
          <div>语言</div>
          <div class="settings-row__hint">界面语言</div>
        </div>
        <span class="muted">简体中文</span>
      </div>
    </div>
  </section>
</template>
