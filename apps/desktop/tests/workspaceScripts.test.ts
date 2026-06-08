import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("工作区验证脚本", () => {
  it("提供运行所有本地检查的根 verify 命令", () => {
    const packageJsonPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../package.json",
    );
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    expect(packageJson.scripts).toMatchObject({
      "verify:desktop:test": "yarn --cwd apps/desktop test",
      "verify:desktop:build": "yarn --cwd apps/desktop build",
      "verify:tauri": "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml",
      "verify:schema": "node node_modules/typescript/bin/tsc -p packages/schema/tsconfig.json",
      "verify:contracts": "node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json",
      verify:
        "yarn verify:desktop:test && yarn verify:desktop:build && yarn verify:tauri && yarn verify:schema && yarn verify:contracts",
    });
    expect(packageJson.scripts["verify:api"]).toBeUndefined();
  });

  it("保留 monorepo workspace 结构", () => {
    const packageJsonPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../package.json",
    );
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    expect(packageJson.workspaces).toEqual(["apps/desktop", "packages/*"]);
    expect(packageJson.packageManager).toBe("yarn@4.14.1");
  });

  it("桌面端 Tauri dev 脚本使用 Momo 动态端口变量", () => {
    const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const run = spawnSync("node", ["scripts/tauri-dev.mjs", "--verbose"], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        MOMO_TAURI_DEV_DRY_RUN: "1",
        MOMO_TAURI_DEV_PORT: "34120",
      },
      encoding: "utf-8",
    });

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as {
      args: string[];
      devUrl: string;
      env: Record<string, string>;
    };
    expect(parsed.devUrl).toBe("http://localhost:34120");
    expect(parsed.args).toContain("tauri");
    expect(parsed.args).toContain("dev");
    expect(parsed.args).toContain("--config");
    expect(parsed.args).toContain("--verbose");
    expect(parsed.env).toMatchObject({
      MOMO_TAURI_DEV_PORT: "34120",
      MOMO_TAURI_DEV_STRICT_PORT: "1",
    });
  });

  it("包管理器检查接受 Yarn 4 并拒绝其他入口", () => {
    const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.toLowerCase() === "npm_config_user_agent") {
        delete cleanEnv[key];
      }
    }

    const ok = spawnSync("node", ["scripts/check-package-manager.mjs"], {
      cwd: desktopRoot,
      env: {
        ...cleanEnv,
        npm_config_user_agent: "yarn/4.14.1 npm/? node/?",
      },
      encoding: "utf-8",
    });
    expect(ok.status).toBe(0);

    const bad = spawnSync("node", ["scripts/check-package-manager.mjs"], {
      cwd: desktopRoot,
      env: {
        ...cleanEnv,
        npm_config_user_agent: "npm/11.0.0 node/?",
      },
      encoding: "utf-8",
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("Momo 需要通过 Corepack 使用 Yarn 4。");
  });
});
