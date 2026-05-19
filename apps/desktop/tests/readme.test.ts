import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("桌面端 README 文档", () => {
  const readmePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../README.md",
  );
  const readme = () => readFileSync(readmePath, "utf-8");

  it("记录前端优先 + WebDAV 同步主路径", () => {
    const content = readme();

    expect(content).toContain("Tauri 2 + Vue 3 + TypeScript");
    expect(content).toContain("WebDAV（坚果云优先）");
    expect(content).toContain("前端优先工具");
    expect(content).toContain("本地数据");
    expect(content).toContain("共享契约");
    expect(content).toContain("WebDAV 同步（坚果云优先）");
    expect(content).toContain("手动验收");
    expect(content).toContain("当前限制");
    expect(content).toContain("npm run verify");
    expect(content).toContain("http://localhost:1420");
  });

  it("记录本地 SQLite schema 与同步基线", () => {
    const content = readme();

    expect(content).toContain("sync_state");
    expect(content).toContain("sync_runs");
    expect(content).toContain("task_sync_versions");
    expect(content).toContain("TaskRepository.getSyncState()");
    expect(content).toContain("TaskRepository.recordSyncRun()");
    expect(content).toContain("baseVersion");
  });

  it("记录 WebDAV runner 装配与同步结果展示", () => {
    const content = readme();

    expect(content).toContain("createWebdavRuntime()");
    expect(content).toContain("WebdavTaskSyncRunner.runOnce()");
    expect(content).toContain("立即同步");
    expect(content).toContain("WebdavSettingsCard");
    expect(content).toContain("@tauri-apps/plugin-store");
    expect(content).toContain("https://dav.jianguoyun.com/dav");
  });

  it("记录手动验收路径和当前限制", () => {
    const content = readme();

    expect(content).toContain("docs/local-sync-acceptance.md");
    expect(content).toContain("npm run tauri dev");
    expect(content).toContain("登录是纯前端跳转占位");
    expect(content).toContain("由独立服务端项目承接");
    expect(content).toContain("WebDAV 同步当前只支持手动触发");
    expect(content).toContain("尚未实现 Android 端");
  });

  it("不再引用已下线的本地模拟和 BE-* 命名的旧路线", () => {
    const content = readme();

    expect(content).not.toContain("本地同步模拟");
    expect(content).not.toContain("运行本地同步模拟");
    expect(content).not.toContain("远程同步配置");
    expect(content).not.toContain("VITE_MOMO_SYNC_BASE_URL");
    expect(content).not.toContain("VITE_MOMO_SYNC_TOKEN");
    expect(content).not.toContain("createLocalSyncRunner()");
    expect(content).not.toContain("createRemoteSyncRunner()");
    expect(content).not.toContain("BE-01");
    expect(content).not.toContain("BE-04");
    expect(content).not.toContain("BE-11");
    expect(content).not.toContain("IF-01");
  });
});
