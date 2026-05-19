import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checklistPath = resolve(
  desktopRoot,
  "docs/local-sync-acceptance.md",
);
const readmePath = resolve(desktopRoot, "README.md");

describe("WebDAV 同步验收清单", () => {
  it("被 README 手动验收章节链接", () => {
    const readme = readFileSync(readmePath, "utf-8");

    expect(readme).toContain("docs/local-sync-acceptance.md");
    expect(readme).toContain("WebDAV 同步验收清单");
  });

  it("记录覆盖凭据保存、立即同步、设置页刷新的验收要点", () => {
    expect(existsSync(checklistPath)).toBe(true);

    const checklist = readFileSync(checklistPath, "utf-8");

    expect(checklist).toContain("# WebDAV 同步验收清单");
    expect(checklist).toContain("范围");
    expect(checklist).toContain("前置准备");
    expect(checklist).toContain("Vite 冒烟");
    expect(checklist).toContain("Tauri WebView 完整 SQLite + WebDAV 流程");
    expect(checklist).toContain("失败路径");
    expect(checklist).toContain("回归护栏");
    expect(checklist).toContain("http://localhost:1420/settings");
    expect(checklist).toContain("npm run tauri dev");
    expect(checklist).toContain("立即同步");
    expect(checklist).toContain("WebDAV 同步（坚果云优先）");
    expect(checklist).toContain("待同步");
    expect(checklist).toContain("同步状态");
    expect(checklist).toContain("同步历史");
    expect(checklist).toContain("sync_state.lastError");
    expect(checklist).toContain("应用密码");
    expect(checklist).toContain("已保存到本机安全存储");
  });

  it("明确不再回归到本地模拟或远程旧路径", () => {
    const checklist = readFileSync(checklistPath, "utf-8");

    expect(checklist).toContain("不再显示 `本地同步模拟` 按钮");
    expect(checklist).toContain("远程同步配置（旧 HTTP 通路）");
    expect(checklist).toContain("apps/api/");
    expect(checklist).toContain("不要在没有用户授权的情况下启动后台或定时 WebDAV 同步");
  });
});
