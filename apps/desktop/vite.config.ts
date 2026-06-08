/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process 是 Node.js 全局对象
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process 是 Node.js 全局对象
const momoDevPort = Number.parseInt(process.env.MOMO_TAURI_DEV_PORT ?? "", 10);
// @ts-expect-error process 是 Node.js 全局对象
const strictPort = process.env.MOMO_TAURI_DEV_STRICT_PORT === "1";
const port = Number.isInteger(momoDevPort) ? momoDevPort : 1420;

export default defineConfig(async () => ({
  plugins: [vue()],

  // 这些 Vite 选项面向 Tauri 开发，只在 `tauri dev` 或 `tauri build` 中生效
  //
  // 1. 防止 Vite 遮蔽 Rust 错误
  clearScreen: false,
  // 2. Tauri 需要固定端口，端口不可用时直接失败
  server: {
    port,
    strictPort: strictPort || port === 1420,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. 告诉 Vite 忽略 `src-tauri` 监听
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./tests/setupTests.ts", import.meta.url))],
  },
}));
