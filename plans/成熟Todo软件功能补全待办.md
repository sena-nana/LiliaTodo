# 成熟 Todo 软件与 Agent 化功能补全待办

> 本文件基于当前 Momo / LiliaTodo 桌面端源码整理，不是通用产品幻想清单。当前仓库主战场是 Tauri 桌面端、本地 SQLite 任务库、WebDAV 同步和本地任务体验；Agent 化补全以嵌入式运行核心、确认队列、审计撤销和 Agent 收件箱为主线。

## 关键决策

- Agent 目标：做主动执行闭环，优先补 Agent 特色，不只做聊天式建议。
- 运行核心：通过 Git submodule 引入远程 MutsukiCore 仓库，实际依赖范围限定为 Rust crates，并锁定到明确 commit。
- 嵌入方式：Tauri Rust 嵌入 `mutsuki-runtime-contracts` / `mutsuki-runtime-core` / `mutsuki-runtime-host`；前端通过 Tauri command 和事件订阅消费 Agent 状态。
- 模型后端：复用 Lilia 风格 Node runner + Codex app-server 适配子集，作为 Mutsuki 的 `StrategyBackend` / capability backend。
- 职责边界：`mutsuki-runtime-core` 是 Agent lifecycle、routing、resource、event 的运行核心；Codex app-server 是策略 / 模型后端，二者不能混为一层。
- UI 入口：新增 Agent 收件箱，用于查看运行状态、建议操作、待确认队列、执行历史、审计记录和撤销入口。
- 自动触发：第一版只覆盖低频关键事件，包括任务创建 / 更新、逾期、提醒到期、每日首次启动。
- 上下文范围：第一版只读取本地任务库、清单、分类、时间、提醒、标签、估时和完成状态。
- 写入权限：关键写入必须先进 Agent 收件箱，用户逐条或批量确认后才落库；执行后必须有审计记录和按批次撤销能力。

## 当前实现基线

- [x] 已有 Tauri 2 + Vue 3 + TypeScript 桌面壳，主窗口、托盘、小组件窗口和窗口状态持久化已具备基础。
- [x] 已有本地 SQLite 任务库，页面通过 `TaskRepository` 访问数据，不直接写 SQL。
- [x] 已有收件箱、今日、日历、所有任务、四象限、时间线、清单详情、设置页和小组件路由。
- [x] 任务模型已覆盖标题、备注、状态、优先级、开始时间、截止时间、估时、资源、提醒、检查项、父任务、标签、清单、分类和完成时间。
- [x] 任务详情抽屉支持编辑主要字段、资源、提醒、检查项、父子任务、清单和分类。
- [x] 今日页支持快速添加今日 / 收件箱任务，展示逾期、今日到期和今日完成。
- [x] 收件箱和清单页支持快速添加、打开详情、完成、删除、部分排序和分类分组。
- [x] 日历页已有未来 7 天只读日程视图，但还不是成熟日历。
- [x] 全局任务视图已有所有、四象限和时间线三种只读 / 操作入口。
- [x] WebDAV 同步主路径已具备手动触发、凭据保存、push / pull、冲突基线和运行结果展示。
- [x] 当前仓库尚未实现 Agent runtime、Agent 收件箱、Codex runner 桥、确认队列、审计撤销、真实系统通知、重复任务和全局搜索筛选。

## P0 Agent 闭环主线

- [x] P0-01 接入 MutsukiCore Rust crates 子仓库
  - 目标：让 Momo 可以稳定复用 MutsukiCore 的 Rust Agent runtime kernel。
  - 当前状态：Momo 已通过 `.gitmodules` 引入远程仓库 `https://github.com/sena-nana/MutsukiCore.git`，子模块路径为 `third_party/MutsukiCore`，当前锁定到远程可获取的 commit `bab974dab8f3f36f6c4180d8a8c078fa77e6c566`。
  - 实现要点：在 Momo 中以 Git submodule 引入 MutsukiCore，依赖面只使用 Rust crates；`apps/desktop/src-tauri/Cargo.toml` 使用锁定 commit 对应的子模块 path dependency；不要依赖父目录或开发机上的本地 `MutsukiCore` checkout。
  - 验收标准：新环境 clone 后可初始化 submodule；`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` 能解析 runtime crates；未把 Python reference 或业务语义引入 Tauri 主 crate。
  - 升级流程：执行 `git -C third_party/MutsukiCore fetch origin`，再 `git -C third_party/MutsukiCore checkout <remote-commit>`，回到 Momo 提交 `third_party/MutsukiCore` 的 gitlink 变更；不使用 `C:\Files\workspace\MutsukiCore` 之类本地路径作为集成来源。

- [ ] P0-02 建立 Tauri Agent runtime state
  - 目标：在 Tauri Rust 层持有 Mutsuki `AgentRuntime`、Agent spec、运行状态和事件缓冲。
  - 当前状态：Tauri Rust 端目前主要负责窗口、托盘、插件初始化和 `greet` smoke command，没有 Agent 状态。
  - 实现要点：新增 Agent 模块管理 runtime lifecycle；注册 Momo Todo source；把任务事件封装为 runtime envelope；对前端暴露启动、停止、触发扫描、读取状态、读取事件等 command。
  - 验收标准：应用启动后 Agent runtime 可初始化；未配置 Codex backend 时也能返回清晰 disabled 状态；runtime event sequence 可通过 Tauri command 读取。

- [ ] P0-03 复用 Lilia 风格 Codex app-server runner 桥
  - 目标：让 Mutsuki strategy backend 可以调用 Codex app-server 生成 Todo 操作建议。
  - 当前状态：Momo 没有 runner；Lilia 已有 Node runner 拉起 Codex app-server、处理 initialize、thread/start、turn/start、通知和用户交互的实现路径。
  - 实现要点：移植最小 Node runner / Codex app-server 适配子集；Tauri Rust 负责拉起 runner、写入任务上下文、读取 JSONL 事件；runner 输出结构化建议，不直接写任务库。
  - 验收标准：缺少 Codex CLI 或版本不满足时给出中文诊断；一次 Agent 触发能返回结构化建议事件；Codex app-server 被明确标记为策略 / 模型后端，而不是 runtime 核心。

- [ ] P0-04 新增 Agent 收件箱
  - 目标：给用户一个统一入口处理 Agent 建议、确认、执行结果和撤销。
  - 当前状态：侧边栏没有 Agent 入口，也没有建议队列 UI。
  - 实现要点：新增 `/agent-inbox` 路由和侧边栏项；页面分区展示运行状态、待确认操作、已执行批次、失败诊断和撤销入口；列表信息密度遵循现有任务工具风格。
  - 验收标准：用户能看到每条建议的来源事件、影响任务、操作摘要、风险等级和确认 / 拒绝按钮；批量确认不会隐藏单条风险信息。

- [ ] P0-05 定义首批 Todo Agent 工具集
  - 目标：让 Agent 可以围绕任务管理核心形成可执行闭环。
  - 当前状态：`TaskRepository` 已有任务、清单、分类的本地操作能力，但未包装成 Agent 工具。
  - 实现要点：首批工具覆盖创建任务、更新标题 / 备注 / 优先级 / 开始时间 / 截止时间 / 估时 / 标签 / 提醒、完成任务、删除任务、移动清单 / 分类、调整父子关系、创建清单、创建分类。
  - 验收标准：每个工具有稳定 action type、输入 schema、中文摘要生成和 dry-run 结果；删除、批量改期、批量完成、父子关系重排默认要求确认。

- [ ] P0-06 实现确认队列和写入保护
  - 目标：确保 Agent 的关键写入不会绕过用户确认。
  - 当前状态：任务写入都来自用户 UI 操作或同步应用，没有 Agent pending action 模型。
  - 实现要点：新增待确认操作表或 repository 层模型；Agent 只创建 pending action；用户确认后由本地执行器调用 `TaskRepository`；拒绝需记录原因或状态。
  - 验收标准：Agent 无法直接删除、批量完成、批量改期或批量移动任务；所有关键写入都能在 Agent 收件箱中确认或拒绝；确认后的任务变更仍进入现有本地变更 / WebDAV 同步链路。

- [ ] P0-07 实现审计记录和批次撤销
  - 目标：让主动执行闭环可追踪、可恢复。
  - 当前状态：`local_changes` 面向同步，不足以表达 Agent 执行来源、前后值和撤销批次。
  - 实现要点：为 Agent 执行新增审计模型，记录 action、before / after、来源 envelope、Codex thread / turn、执行结果、错误、batchId 和 createdAt；撤销按 batch 逆向生成安全 patch。
  - 验收标准：每次确认执行都会产生审计记录；用户可在 Agent 收件箱按批次撤销可逆操作；不可逆操作必须在执行前提示并在审计中标记不可撤销。

- [ ] P0-08 接入低频关键事件触发
  - 目标：让 Agent 能主动检查任务状态，但不制造噪音。
  - 当前状态：任务创建 / 更新、逾期、提醒到期和每日启动没有统一 Agent 触发层。
  - 实现要点：在任务创建 / 更新后节流触发；应用每日首次启动触发一次全局检查；逾期和提醒到期触发建议，不直接改期；触发事件进入 runtime envelope。
  - 验收标准：同一任务短时间多次变更会合并触发；用户可在设置中关闭自动触发；自动触发只生成建议，不跳过确认队列。

- [ ] P0-09 本地任务上下文快照
  - 目标：为 Agent 提供足够但克制的 Todo 上下文。
  - 当前状态：页面各自读取任务数据，没有统一 Agent context builder。
  - 实现要点：构建本地任务库快照，包含任务、清单、分类、时间、提醒、标签、估时、完成状态和父子关系；限制数量和文本长度；不读取任意本地文件、邮件或网页。
  - 验收标准：上下文快照可被测试稳定断言；大任务库会截断并标注 truncated；敏感扩展上下文不在第一版出现。

## P1 成熟 Todo 基础能力

- [ ] P1-01 全局搜索与筛选：支持按标题、备注、标签、清单、分类、状态、优先级、时间范围和提醒状态检索任务。
- [ ] P1-02 重复任务：支持每日、每周、每月、自定义间隔和完成后生成下一次实例。
- [ ] P1-03 真实系统通知：提醒到期时通过 Tauri / 系统通知提示，支持稍后提醒、关闭和打开任务。
- [ ] P1-04 批量操作：支持多选任务后批量完成、改期、移动清单、设置标签、删除，并与 Agent 写入保护共用风险提示。
- [ ] P1-05 完成 / 归档管理：提供已完成、已归档、最近删除或等价恢复入口，避免任务完成后不可追踪。
- [ ] P1-06 清单 / 分类管理入口：在 UI 中补齐创建、重命名、排序、归档清单和创建、重命名、删除分类的完整入口。
- [ ] P1-07 拖拽排序与重排：收件箱、清单、分类、子任务和检查项支持稳定拖拽排序。
- [ ] P1-08 键盘快捷键：补齐快速添加、打开详情、完成、删除、搜索、跳转今日 / 收件箱 / Agent 收件箱等常用快捷键。
- [ ] P1-09 错误和空状态一致性：统一页面加载失败、空列表、同步失败、Agent 失败和权限不足的中文表达与重试入口。

## P2 计划与智能体验

- [ ] P2-01 日历周 / 月 / 日视图：从未来 7 天只读列表升级为可浏览、可拖拽改期的成熟日历。
- [ ] P2-02 自动排期建议：结合截止时间、估时、优先级、开始时间和每日容量生成排期建议。
- [ ] P2-03 容量与负载分析：按天 / 周展示估时总量、逾期风险、资源占用和过载提示。
- [ ] P2-04 冲突检测：检测时间重叠、父任务未拆解、提醒过晚、截止时间早于开始时间等问题。
- [ ] P2-05 智能视图保存：允许保存自定义筛选视图，例如“本周高优先级”“无计划任务”“等待确认”。
- [ ] P2-06 任务模板：支持把常用任务结构保存为模板，包括检查项、默认标签、估时和提醒。
- [ ] P2-07 导入导出：支持 Markdown / JSON / CSV 导入导出，便于迁移和备份。
- [ ] P2-08 Agent 复盘报告：按日 / 周生成完成情况、延期原因、计划偏差和下周建议。

## 暂不做

- [ ] 暂不做多人协作、共享空间、评论和实时协同。
- [ ] 暂不做移动端实现。
- [ ] 暂不做远程账号体系和服务端推送。
- [ ] 暂不读取任意外部文件、邮件、网页或第三方日历作为 Agent 默认上下文。
- [ ] 暂不允许 Agent 无确认直接删除、批量完成、批量改期或做其他破坏性写入。
- [ ] 暂不把旧 NanoBot Python reference 层作为 Momo runtime 事实源。
- [ ] 暂不恢复旧后端内存 router 或把业务调度搬到 Rust core。

## 首批 Agent 工具范围

| 范围 | 操作 | 默认保护 |
|---|---|---|
| 任务创建 | 创建任务，设置标题、备注、清单、分类、时间、估时、标签、提醒 | 进入确认队列 |
| 任务更新 | 更新标题、备注、优先级、开始时间、截止时间、估时、标签、提醒 | 进入确认队列 |
| 任务状态 | 完成任务、恢复任务、删除任务 | 删除和批量完成必须高风险确认 |
| 任务组织 | 移动清单 / 分类、调整父子任务关系 | 父子关系重排必须确认 |
| 清单分类 | 创建清单、创建分类 | 进入确认队列 |
| 批量操作 | 批量改期、批量完成、批量移动 | 必须显示影响数量和任务清单 |

## 验收检查

- [ ] 待办文件路径为 `plans/成熟Todo软件功能补全待办.md`。
- [ ] 文档为中文 Markdown checkbox；英文只用于技术名、协议名、字段名、路径和类型名。
- [ ] 每个 P0 项都包含“目标 / 当前状态 / 实现要点 / 验收标准”。
- [ ] 文档明确说明 `mutsuki-runtime-core` 是运行核心，Codex app-server 是策略 / 模型后端。
- [ ] 文档明确说明 Agent 写入必须经过确认队列，并支持审计和撤销。
- [ ] 文档没有要求本轮修改代码、改协议或执行 submodule 添加。
