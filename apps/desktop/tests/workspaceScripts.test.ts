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
      "verify:desktop:test": "pnpm --dir apps/desktop test",
      "verify:desktop:build": "pnpm --dir apps/desktop build",
      "verify:tauri": "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml",
      "verify:schema": "node node_modules/typescript/bin/tsc -p packages/schema/tsconfig.json",
      "verify:contracts": "node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json",
      verify:
        "pnpm typecheck:node-scripts && pnpm verify:desktop:test && pnpm verify:desktop:build && pnpm verify:tauri && pnpm verify:schema && pnpm verify:contracts",
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
    expect(packageJson.packageManager).toMatch(/^pnpm@4\.17\.1\+sha512\./);
  });

  it("桌面端 Tauri dev 脚本使用 LiliaTodo 动态端口变量", () => {
    const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const run = spawnSync("node", ["scripts/tauri-dev.mjs", "--verbose"], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        LILIATODO_TAURI_DEV_DRY_RUN: "1",
        LILIATODO_TAURI_DEV_PORT: "34120",
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
      LILIATODO_TAURI_DEV_PORT: "34120",
      LILIATODO_TAURI_DEV_STRICT_PORT: "1",
    });
  });

  it("工具链检查接受项目固定版本并拒绝其他 pnpm 版本", () => {
    const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.toLowerCase() === "npm_config_user_agent") {
        delete cleanEnv[key];
      }
    }

    const ok = spawnSync("node", ["scripts/check-toolchain.ts"], {
      cwd: desktopRoot,
      env: {
        ...cleanEnv,
        npm_config_user_agent: "pnpm/4.17.1 npm/? node/26.5.0",
      },
      encoding: "utf-8",
    });
    expect(ok.status).toBe(0);

    const bad = spawnSync("node", ["scripts/check-toolchain.ts"], {
      cwd: desktopRoot,
      env: {
        ...cleanEnv,
        npm_config_user_agent: "pnpm/4.14.1 npm/? node/26.5.0",
      },
      encoding: "utf-8",
    });
    expect(bad.status).toBe(1);
  });
});
