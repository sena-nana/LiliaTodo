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

  it("记录覆盖凭据保存、立即同步、自动同步和结果展示的验收要点", () => {
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
    expect(checklist).toContain("同步结果 message");
    expect(checklist).toContain("本地清单变更");
    expect(checklist).toContain("远端清单");
    expect(checklist).toContain("新增一个清单");
    expect(checklist).toContain("归档刚创建的清单");
    expect(checklist).toContain("原清单内任务已迁移回收件箱");
    expect(checklist).toContain("sync_state.lastError");
    expect(checklist).toContain("应用密码");
    expect(checklist).toContain("已保存到本机安全存储");
    expect(checklist).toContain("自动后台同步");
    expect(checklist).toContain("恢复已授权状态");
    expect(checklist).toContain("idle 防抖窗口");
  });

  it("记录日历与 Agent 的当前验收边界", () => {
    const checklist = readFileSync(checklistPath, "utf-8");

    expect(checklist).toContain("日历与 Agent 验收边界");
    expect(checklist).toContain("`日` / `周` / `月` 视图");
    expect(checklist).toContain("拖拽到其他日期后任务截止时间随之更新");
    expect(checklist).toContain("不要再按旧的 7 天只读口径验收");
    expect(checklist).toContain("`Agent 收件箱`");
    expect(checklist).toContain("待确认队列");
    expect(checklist).toContain("确认后才执行并写入审计记录");
    expect(checklist).toContain("关闭 Agent 自动触发后");
    expect(checklist).toContain("runtime 未运行或未配置 backend");
  });

  it("明确不再回归到本地模拟或远程旧路径", () => {
    const checklist = readFileSync(checklistPath, "utf-8");

    expect(checklist).toContain("不再显示 `本地同步模拟` 按钮");
    expect(checklist).toContain("远程同步配置（旧 HTTP 通路）");
    expect(checklist).toContain("`apps/api/` 已整体下线");
    expect(checklist).toContain("WebDAV 后台或定时同步必须由用户在设置页显式授权");
    expect(checklist).toContain("关闭开关或清除凭据后不得继续后台触发");
  });
});
