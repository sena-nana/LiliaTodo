import { readFileSync } from "node:fs";
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
});
