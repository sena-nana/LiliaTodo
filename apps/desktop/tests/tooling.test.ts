import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

describe("测试工具链", () => {
  it("运行在 Vitest 下", () => {
    expect(true).toBe(true);
  });

  it("记录中文文本开发规范", () => {
    const workspaceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const standard = readFileSync(resolve(workspaceRoot, "AGENTS.md"), "utf-8");

    expect(standard).toContain("中文文本开发规范");
    expect(standard).toContain(
      "页面文本、注释、测试描述、测试断言和文档默认使用中文",
    );
    expect(standard).toContain(
      "工程标识符、外部协议字段、路由、命令和环境变量保持英文",
    );
  });

  it("旧 Claude 配置不再存在于仓库", () => {
    const workspaceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );

    expect(existsSync(resolve(workspaceRoot, ".claude"))).toBe(false);
    expect(existsSync(resolve(workspaceRoot, ".claude-flow"))).toBe(false);
    expect(existsSync(resolve(workspaceRoot, ".mcp.json"))).toBe(false);
  });

  it("保持桌面端 UI 技术栈使用 Vue 而非 React", () => {
    const packagePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../package.json",
    );
    const pkg = JSON.parse(readFileSync(packagePath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    expect(dependencies.vue).toBeDefined();
    expect(dependencies["vue-router"]).toBeDefined();
    expect(dependencies["@vitejs/plugin-vue"]).toBeDefined();
    expect(dependencies.react).toBeUndefined();
    expect(dependencies["react-dom"]).toBeUndefined();
    expect(dependencies["react-router-dom"]).toBeUndefined();
    expect(dependencies["@vitejs/plugin-react"]).toBeUndefined();
  });

  it("确保桌面端源码不包含 React TSX 入口", () => {
    const desktopRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const sourceFiles = listFiles(resolve(desktopRoot, "src"));
    const testFiles = listFiles(resolve(desktopRoot, "tests"));
    const reactSourcePattern =
      /from\s+["'](?:react|react-dom|react-router-dom|lucide-react)["']|React\./;

    expect(
      [...sourceFiles, ...testFiles]
        .filter((file) => /\.(tsx|jsx)$/.test(file))
        .map((file) => file.replace(`${desktopRoot}\\`, "")),
    ).toEqual([]);
    expect(
      sourceFiles
        .filter((file) => /\.(ts|vue)$/.test(file))
        .filter((file) => reactSourcePattern.test(readFileSync(file, "utf-8")))
        .map((file) => file.replace(`${desktopRoot}\\`, "")),
    ).toEqual([]);
  });

  it("确保默认设置页路由只装配 WebDAV runner，不再引用旧本地/远程 runner", () => {
    // 目的：防止阶段 80 下线的本地模拟 / 远程 HTTP runner 被悄悄恢复成默认 runner。
    const desktopRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const appSource = readFileSync(resolve(desktopRoot, "src/App.vue"), "utf-8");
    const defaultRuntimeSource = readFileSync(
      resolve(desktopRoot, "src/sync/defaultSettingsSyncRuntime.ts"),
      "utf-8",
    );

    expect(appSource).toContain("createDefaultSettingsSyncRuntime");
    for (const forbidden of [
      "createRemoteSyncRunner",
      "createRemoteSyncConfig",
      "createLocalSyncRunner",
      "createHttpLikeSyncTransport",
      "createHttpSyncTransport",
      "RemoteSyncConfigKey",
      "RunLocalSyncSimulationKey",
    ]) {
      expect(appSource).not.toContain(forbidden);
      expect(defaultRuntimeSource).not.toContain(forbidden);
    }
  });

  it("已下线的 backend 抽象层与旧同步模块不再存在于源码树", () => {
    // 目的：阶段 80 已删除的死代码不应被恢复；如需重启「自建后端 / 远程 runner」请新开阶段。
    const desktopRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
    );

    expect(existsSync(resolve(desktopRoot, "src/backend"))).toBe(false);
    for (const removedSyncFile of [
      "src/sync/syncClient.ts",
      "src/sync/localSyncRunner.ts",
      "src/sync/httpLikeSyncTransport.ts",
      "src/sync/httpSyncTransport.ts",
      "src/sync/remoteSyncConfig.ts",
      "src/sync/remoteSyncRunner.ts",
    ]) {
      expect(existsSync(resolve(desktopRoot, removedSyncFile))).toBe(false);
    }
  });

  it("WebDAV 同步层不再 import 已废弃的 backend/contracts 子目录", () => {
    // 目的：防止 sync/webdav/* 继续依赖一个被废弃的 backend 抽象目录。
    // entity/op 数据格式已迁到 sync/types，是 WebDAV 同步层的共享格式。
    const desktopRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const webdavRoot = resolve(desktopRoot, "src/sync/webdav");
    const offenders = listFiles(webdavRoot)
      .filter((file) => /\.ts$/.test(file))
      .filter((file) =>
        /from\s+["'][^"']*backend\/contracts/.test(
          readFileSync(file, "utf-8"),
        ),
      )
      .map((file) => file.replace(`${desktopRoot}\\`, ""));

    expect(offenders).toEqual([]);
  });
});

function listFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = resolve(root, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}
