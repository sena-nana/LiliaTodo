/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const host = process.env.TAURI_DEV_HOST;
const liliatodoDevPort = Number.parseInt(process.env.LILIATODO_TAURI_DEV_PORT ?? "", 10);
const strictPort = process.env.LILIATODO_TAURI_DEV_STRICT_PORT === "1";
const port = Number.isInteger(liliatodoDevPort) ? liliatodoDevPort : 1420;

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
    execArgv: ["--no-experimental-webstorage"],
    setupFiles: [fileURLToPath(new URL("./tests/setupTests.ts", import.meta.url))],
  },
}));
