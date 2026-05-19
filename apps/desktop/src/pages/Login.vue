<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

const email = ref("");
const router = useRouter();

function onSubmit() {
  void router.push("/today");
}
</script>

<template>
  <div class="auth">
    <form class="auth__card" @submit.prevent="onSubmit">
      <h1>Momo</h1>
      <p class="auth__hint">
        登录链路由独立服务端项目承接，当前为前端占位入口。
      </p>
      <label class="auth__label">
        邮箱
        <input
          v-model="email"
          type="email"
          placeholder="you@example.com"
          required
        />
      </label>
      <button type="submit">继续</button>
    </form>
  </div>
</template>
