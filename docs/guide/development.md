# 开发启动

## 项目结构

```text
LiliaTodo/
├── apps/
│   └── desktop/         # Tauri 2 + Vue 3 桌面端
│       ├── src/         # 前端源码
│       ├── src-tauri/   # Rust 端
│       ├── scripts/     # 桌面端本地脚本
│       └── tests/       # Vitest + Testing Library
├── packages/            # schema / contracts 等共享包
└── package.json         # workspace 脚本入口
```

## 本地运行

本仓库使用 Node.js 26.5.0，并通过 Corepack 0.35.0 固定 Yarn 4.17.1。建议从仓库根目录运行命令。

```bash
npm install --global corepack@0.35.0
corepack enable
corepack yarn install
yarn tauri:dev
```

`.env.yarn` 会为 Yarn 命令启用可移植的 Node 模块编译缓存；Node 26 也会直接执行仓库内部的 `check-toolchain.ts`，其类型由 `yarn typecheck:node-scripts` 验证。

`yarn tauri:dev` 会进入 `apps/desktop`，自动寻找可用本地端口，再把对应 `devUrl` 传给 Tauri。

## 验证

```bash
yarn verify:desktop:test
yarn verify:desktop:build
yarn verify:tauri
yarn verify:schema
yarn verify:contracts
yarn verify
```

按影响范围运行最小必要验证。涉及构建配置、壳层布局、路由或 Tauri 端改动时，优先运行 `yarn verify`。

## 文档站

文档站使用 VitePress，源码位于 `docs/`，本地构建命令为：

```bash
yarn docs:build
```

`yarn docs:build` 的默认输出目录是 `docs/.vitepress/dist/`，VitePress 本地缓存目录是 `docs/.vitepress/cache/`；二者都是生成产物，不应提交。GitHub Pages 工作流上传的目录也应保持为 `docs/.vitepress/dist/`。

## 图标

Tauri 图标位于 `apps/desktop/src-tauri/icons/`。如需替换图标，先更新源图，再使用 Tauri CLI 重新生成平台图标。
