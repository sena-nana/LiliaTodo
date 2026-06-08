#!/usr/bin/env node

import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
);
const requiredPackageManager = packageJson.packageManager;
const userAgent = process.env.npm_config_user_agent ?? "";

const yarnMatch = userAgent.match(/\byarn\/([^\s]+)/);
const yarnVersion = yarnMatch?.[1];
const yarnMajor = Number.parseInt(yarnVersion?.split(".")[0] ?? "", 10);

if (yarnMajor >= 4) {
  process.exit(0);
}

const reason = yarnVersion
  ? `Detected Yarn ${yarnVersion}.`
  : userAgent
    ? `Detected package manager: ${userAgent}.`
    : "Could not detect the active package manager.";

console.error(formatMessage(reason));
process.exit(1);

function formatMessage(reason) {
  return [
    "",
    "Momo 需要通过 Corepack 使用 Yarn 4。",
    reason,
    "",
    `期望的包管理器：${requiredPackageManager}`,
    "",
    "修复方式：",
    "  corepack enable",
    `  corepack prepare ${requiredPackageManager} --activate`,
    "  yarn install",
    "",
    "如果 `yarn` 命令仍然解析到 Yarn 1，请通过 Corepack 运行：",
    "  corepack yarn install",
    "  corepack yarn dev",
    "",
  ].join("\n");
}
