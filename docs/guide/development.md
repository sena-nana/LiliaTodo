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

本仓库通过 Corepack 使用 Yarn 4.14.1。建议从仓库根目录运行命令。

```bash
corepack enable
corepack prepare yarn@4.14.1 --activate
yarn install
yarn tauri:dev
```

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

## 图标

Tauri 图标位于 `apps/desktop/src-tauri/icons/`。如需替换图标，先更新源图，再使用 Tauri CLI 重新生成平台图标。
