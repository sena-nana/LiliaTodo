# Momo · Desktop（Tauri 2 + Vue 3 + TypeScript）

桌面端前端优先工具。当前完成了 Tauri 2 + Vue 3 + TypeScript 壳、本地 SQLite 任务存储、今日 / 收件箱 / 日历 / 设置四个主页面、小组件窗口，以及通过 WebDAV（坚果云优先）完成多端同步的主路径。

## 前置工具链

| 组件 | 已验证版本 |
|---|---|
| Node.js | 24.13.0 |
| npm | 11.6.2 |
| Rust / cargo | 1.93.1 |
| Tauri CLI | 2.x（随 npm 依赖安装） |

Windows 上首次运行需要 **Microsoft Edge WebView2 Runtime**（Win10 1803+ 通常已内置）与 **MSVC build tools**（`rustup` 安装时若选 `default-host` 通常已带）。

## 安装

```bash
npm install
```

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 仅启动 Vite 前端（http://localhost:1420） |
| `npm run test` | 运行 Vitest 单元与页面测试 |
| `npm run build` | TypeScript 检查 + Vite 生产构建 |
| `npm run tauri dev` | 启动 Tauri 桌面壳（带 WebView 窗口） |
| `npm run tauri build` | 打包 Windows 安装器 |
| `cargo check`（在 `src-tauri/`） | 仅校验 Rust 端是否能编译 |
| `.\apps\desktop\node_modules\.bin\tsc.cmd -p packages\contracts\tsconfig.json`（在仓库根目录） | 校验共享契约包 |
| `npm run verify`（在仓库根目录） | 串行运行桌面端测试与构建、Tauri 检查、contracts/API TypeScript 检查 |

## 路由

`/login`, `/today`, `/inbox`, `/calendar`, `/settings`, `/widget`，根路径自动跳 `/today`。

## 本地数据

- SQLite 由 `@tauri-apps/plugin-sql` / `tauri-plugin-sql` 提供，连接固定为 `sqlite:momo.db`。
- 前端通过 `TaskRepository` 访问数据，页面不直接写 SQL。
- 当前 schema 包含 `schema_migrations`、`task_lists`、`tasks`、`local_changes`、`sync_state`、`sync_runs`、`task_sync_versions` 与 `entity_sync_versions`；`tags` 以 JSON text 存储，时间统一保存 ISO 字符串。
- 今日页支持快速添加今日或收件箱任务、查看逾期/今日/今日完成；收件箱页支持编辑、完成、删除无截止日期任务；日历页先提供未来 7 天只读日程。
- `local_changes` 记录本地任务 create / update / status / delete 与清单 create / update / archive / delete 变更，供 WebDAV 同步 push 阶段使用。
- `TaskRepository.getSyncState()` / `saveSyncState()` 读写本地同步状态：最新 server cursor、最近同步时间、最近错误与状态更新时间，作为 runner 自身循环所需的内部基线。
- `TaskRepository.recordSyncRun()` / `listRecentSyncRuns()` 维护同步运行历史：记录每次手动 WebDAV 同步的成功/失败、开始/结束时间、message 与 cursor，供调试与未来诊断使用，当前 UI 不再渲染。
- `entity_sync_versions` 保存远端 task / taskList version，`applyRemoteTask(task, remoteVersion)` 与 `applyRemoteList(list, remoteVersion)` 在 pull 应用时更新该基线，不把 version 泄进通用 UI 模型。
- 本地 `updateTask()` / `setStatus()` 记录 `local_changes` 时，如果存在远端版本，会把 `baseVersion` 写入 payload，用于后续冲突检测。

## WebDAV 同步（坚果云优先）

- 设置页的“WebDAV 同步”卡片是当前唯一活跃的同步入口；保存凭据后点击“立即同步”即触发真实 PUT/PROPFIND 到 WebDAV 服务。
- 默认 base URL 指向坚果云（`https://dav.jianguoyun.com/dav`）；其他 WebDAV 服务（Nextcloud / OwnCloud 等）也可填入。
- 凭据通过 `@tauri-apps/plugin-store` 持久化在系统用户目录；密码不会回填到表单输入框，清除按钮会立即从本机移除。
- `createWebdavRuntime()` 把 secretsStore → WebdavConfig → WebdavClient → WebdavSyncProvider → WebdavTaskSyncRunner 一处装配；凭据缺失或装配失败时返回 disabled 结果，UI 通过 inspect 提示原因。
- `WebdavTaskSyncRunner.runOnce()` 一次完整循环：push(本地 pending changes) → pull(从 server cursor 起) → 写回 sync_state → 记录 sync_runs。失败时仅记录 lastError，不滚动 cursor。
- 同步结果在 `WebdavSettingsCard` 上直接展示：成功时显示 runner 返回的人类可读 message（例如 `已上传 N 条本地任务变更，已上传 M 个本地清单变更，已应用 K 个远端清单`），失败时显示错误原因。

## 共享契约

- `packages/contracts` 定义 Task DTO、LocalChange DTO、Delta Push/Pull 请求响应类型，供未来真接入后端时复用。
- 旧的 `apps/api` 内存契约骨架已下线，不要恢复其内存 router 作为设置页默认 runner；接入服务端时直接基于 `packages/contracts` 的 DTO 在独立服务端项目重新搭建即可。

## 手动验收

- WebDAV 同步验收清单：`docs/local-sync-acceptance.md`。
- 运行 `npm run tauri dev`，打开设置页，配置 WebDAV 凭据后点击“立即同步”。
- 在同一台机器创建若干任务和清单，确认上传 ops 数与“待同步”归零。
- 在第二台机器（或同一机器换 SQLite 数据库副本）配同一组凭据，点击“立即同步”，确认能拉到对端任务和清单；归档清单后再次同步，确认对端清单归档且原清单任务回到收件箱。
- Vite 浏览器冒烟（`npm run dev`）只能验证路由与表单可访问性，不能完成完整 SQLite + plugin-http 链路。

## 当前限制

- 登录是纯前端跳转占位；真实账号体系由独立服务端项目承接。
- 当前桌面端不持有后端同步、协作或 Agent 执行能力；多端协同通过 WebDAV 同步链路完成。
- WebDAV 同步当前只支持手动触发，没有自动调度 / 后台同步 / 网络恢复重试。
- 尚未实现 Android 端。
- 小组件窗口已在 `tauri.conf.json` 声明 `transparent / alwaysOnTop / decorations:false`，但还没有 Win32 扩展样式桥接来管理 `WS_EX_TOOLWINDOW / NOACTIVATE` 等。
- Rust 端仍保留 `greet` 命令作为 Tauri invoke 冒烟测试，但主页面不再展示该调试入口。
