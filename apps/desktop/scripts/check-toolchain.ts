#!/usr/bin/env node

import { readFileSync } from "node:fs";

type PackageManifest = {
  packageManager?: string;
};

const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as PackageManifest;
const requiredPackageManager = packageJson.packageManager;

if (!requiredPackageManager?.startsWith("yarn@")) {
  throw new Error("根 package.json 必须声明 Yarn packageManager。");
}

const requiredYarnVersion = requiredPackageManager.slice("yarn@".length).split("+")[0];
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
const userAgent = process.env.npm_config_user_agent ?? "";
const yarnVersion = userAgent.match(/\byarn\/([^\s]+)/)?.[1];

const problems: string[] = [];
if (nodeMajor !== 26) {
  problems.push(`当前 Node.js 为 ${process.versions.node}，需要 Node.js 26。`);
}
if (yarnVersion !== requiredYarnVersion) {
  problems.push(
    yarnVersion
      ? `当前 Yarn 为 ${yarnVersion}，需要 Yarn ${requiredYarnVersion}。`
      : "当前命令不是通过 Yarn 启动。",
  );
}

if (problems.length > 0) {
  console.error(
    [
      "",
      "LiliaTodo 工具链不符合项目要求。",
      ...problems,
      "",
      "修复方式：",
      "  安装 Node.js 26.5.0",
      "  npm install --global corepack@0.35.0",
      "  corepack enable",
      "  corepack yarn install",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
