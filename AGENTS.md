# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的桌面端：**聊天形态的 omp 工作台**（Tauri v2 + React 19 + TS + Tailwind v4 + Zustand，包管理 pnpm）。

> 改代码前先读 `docs/roadmap.md`（版本规划）与对应版本排期。

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/roadmap.md` | 版本规划总纲（0.1.0 形态收敛 → 0.2.0 聊天对标 → 0.3.0 设置重构）|
| `docs/v1-schedule.md` | 0.1.0：终端形态删除清单 / 迁移清单 / 验收（**已实施**，2026-10-14）|
| `docs/v2-schedule.md` | 0.2.0：布局 / 流式 / 聊天框对标 Codex、ZCode |
| `docs/v3-schedule.md` | 0.3.0：设置重构（功能保留、形态重做）|
| `docs/benchmark-codex-desktop.md` | Codex Desktop 对标调研（含截图证据与设计语言合约）|
| `docs/benchmark-zcode-desktop.md` | Zcode Desktop 对标调研 |
| `design-system/MASTER.md` | 设计系统（颜色 / 布局 / 组件 / 层级真相；改 UI 先读）|
| `CHANGELOG.md` | 更新日志（发版节 = Release 说明）|

## 技术基线

- 壳：Tauri v2（`src-tauri/`，identifier `com.omnidesktop.mini`；自绘标题栏用 `data-tauri-drag-region` + `core:window:allow-start-dragging` 权限；macOS 产物走自签名证书，见 `scripts/`）。
- 前端：React 19 + Vite + Tailwind v4 + Zustand。
- 后端：Rust + tokio + serde；`reqwest`（供应商用量补充探针）。
- 工具链：Node 22 + pnpm 11；Rust stable。上游运行时：`omp` 18.x（不随仓库分发）。

## 源码结构

```
src/
  app/App.tsx                # 顶层装配（左栏 + 聊天主区 + 设置视图 + 全局浮层与快捷键）
  components/sidebar/        # 左栏：ChatSidebar（含项目拖拽排序控制器）/ SidebarTop / SidebarBottom / WorkspaceGroupDialog / RowAction / DropLine / OmpUpdateChip / AppUpdateChip
  components/thread/         # 消息列：ChatView / TopBar / Thread / AssistantText / ToolRow / ApprovalCard / UiRequestCard / ChatEmptyState / FindBar / BtwPanel / SessionStatsDialog / DiffDialog / SubAgentStrip…
  components/composer/       # 输入区：Composer / GoalRow / ContextBar / MentionList / SlashMenu / UsageLimits
  components/pickers/        # 选择器：ModelPicker / ThinkingPicker / PermissionBadge / ProjectPicker / BranchPicker
  components/settings/       # GeneralSettingsPanel / ModelsPanel / PluginsPanel / SkillsPanel / ProvidersSection / MemoryPanel / UsagePanel…
  components/usage/ update/ git/   # 供应商用量 / 更新弹窗 / 提交面板
  components/CommandPalette.tsx / SettingsPage.tsx / ReferencePicker.tsx / HealthBanner.tsx …
  lib/                       # viewmsg / mergeEvents / useSessionEvents / sessionOpen / streamReveal / mdBlocks / streamCaret / promptHistory / commandPalette / btw / checkouts / workspaceGroups / projectDrag / useElapsed / useText / locale / theme / platform / …
  shared/                    # api（invoke 唯一入口）/ ipc（命令与事件常量唯一清单）/ types
  stores/app.ts              # Zustand 全局状态（会话 / 消息流 / 队列 / 引用浮层 / 设置视图 / 更新 / 提交任务 / 工作区）
src-tauri/src/
  runtime.rs                 # 会话的 RPC 运行时（spawn 握手 → pump → kill_all；事件面泛型）
  proc.rs                    # 进程与环境工具（登录 shell PATH 探测 / 进程组强杀；git_commit / commit_msg / omp_update 复用）
  commands/mod.rs            # RPC 命令面 + 项目 / 工作区 / 会话 / git 命令
  context.rs session_scan.rs overlay.rs git_info.rs git_commit.rs git_ops.rs project_files.rs
  plugins.rs skills.rs settings.rs themes.rs models_config.rs title_prompt.rs omp_update.rs
  providers.rs memories.rs usage.rs provider_usage.rs extra_usage.rs
scripts/                     # e2e-ipc-selfcheck / generate-icons / changelog-notes / fixup-latest-json / make-signing-cert / tauri-build
```

## 核心数据流（不许违背）

- **聊天会话 = per-会话长驻 `omp --mode rpc-ui` 进程**（`runtime.rs`）：握手（negotiate / get_state / 子代理订阅 / ask 对话框开关）→ pump（stdin 写、stdout 读、`rpc_chunk` 重组、帧分类）。事件三通道 **`omp-event/status/state://<sid>` 用会话 id 命名**。kill 走 `kill_runtime`；应用退出 `kill_all`。
- **会话身份 = 完整 uuid**（jsonl 文件名里的 uuid）：**任何定位 / `--resume` 都不许退回 8 字符前缀**（uuid v7 前 8 位同一分钟内必然相同，会读错历史 / 删错文件 / resume 到别的会话并顶掉它正在跑的进程）。`session_file_for` 只认完整 id。
- **发送语义**：idle = Enter 发送（`/` 开头先查壳本地命令）；running = **Enter 插话（steer）/ Tab 排队（follow_up）/ Esc 中断并交还队列**（`abort_and_restore_queue`）。队列 = omp 真值（`queue_update` 帧落 `store.queuedBySession`，`applyQueue` 唯一写入面；行可撤回 / 编辑 / 提升）。
- **状态收敛**：终态 `agent_end` → idle；**`agent_end{isTerminal:false, awaitingAsyncWork:true}`（等后台完成投递）也折算 idle**（活动态单列 `idle-awaiting`，闲置回收跳过）；`session_settled` 同样收敛。前端状态不许在 `open_session` 回包时被压成 idle（会打断进行中的轮次）。
- **流式渲染管线**：`frameToViewMsgs` → `mergeEvents`（rAF 合并缓冲：同 id 折叠、工具卡合并）→ `useSessionEvents`（历史 LRU：只留最近 3 个会话；running 豁免）→ `Thread`：
  - `AssistantText` 两段式分块（`mdBlocks`：冻结前缀 memo + 活跃尾块每帧重走；围栏骨架只在「围栏开、无内容」时）；
  - 平滑揭示（`streamReveal`：有界追赶、complete 立即全量）；
  - 光标 = **测量覆盖**（`streamCaret` 只写 style，不许搬 React 管理的 DOM）；
  - 贴底跟随 = sticky 语义（`useLayoutEffect` + `onScroll` 80px 判定 + ResizeObserver 回调 ref 两道防线；`events` 引用变化即跟）。
  - 实时行 id = `${sid}:${msgSeq}:${contentIndex}`（contentIndex 每条消息从 0 重数，只用它会撞车）；重开实时流过的会话按「类别 + 全文」与历史配对，不许翻倍。
  - `text_end` 是文本块完结信号（消费它，行才收敛）；工具占位卡从 `partial` 取真名 / 真 id / 半截参数。
- **消息列滚动**：`.thread-scroll` 必须保持 `overflow-y: auto`（`index.css`）——跟随 / 回看 / 加载更早全靠它（V32 曾漏恢复导致「输入框上方文字重叠」）。
- **标题**：omp 对 `--mode rpc-ui` 强制关闭自动标题——壳侧两层补：pump 在「有用户消息且无标题」时注入一次 `/rename`（spawn 时 + 每次终态 `agent_end`，每进程至多一次）→ `session_info_update` 帧回灌；后端扫描 `first_user_text` 派生显示标题兜底。标题语言随壳界面语言（`TITLE_SYSTEM.md`，用户自写文件不覆盖）。
- **内存治理**：每 60s 一轮闲置回收（idle 30 分钟且已落盘 → kill；重新打开 / 发消息自动 resume）；`eventsBySession` 只留最近 3 个会话（切会话时触发 LRU 裁剪）；工具全量输出封顶 100K 字符。
- **模型目录**（`omp models --json`，2–10s）：单飞 + 5 分钟缓存 + 过期后台刷新（`omp-models://catalog` 广播）；`omp config list --json` 一次读全部配置键。
- **设置写入口径**：omp 侧只经 `omp` CLI（`config set/reset`、`auth-broker`…）；**唯一例外**：`models.yml` 直接写文件（hash 乐观锁 + 预校验 + 备份 + 原子写）。本应用偏好不写 omp 配置。
- **提交 / 推送**：两轨（快速 = 一次 `omp -p` 生成信息 + `git commit/push`；完整 = `omp commit`）；按 cwd 建任务表（并行 + BUSY + 取消 + 超时）；入口 = `ContextBar` 提交键与任务徽章。
- **更新链路两条独立**：本应用（Tauri updater，`latest.json`）与 omp 运行时（`omp update`）互不相干；入口 = 左栏顶栏两枚 chip。

## 工程约定

- **语言**：界面文案 / 注释 / 文档 / 提交信息用简体中文；标识符英文。界面文案一律走 `lib/locale.ts` 字典（`s_` 前缀为设置项动态键，不许被清理误删）。
- **版本文案口径**：README / CHANGELOG / 文档里不写「仓库重置 / 版本归零 / 清除历史版本与发版记录」这类字样；版本历史只按实际版本节记录现状与变更。
- **文档更新**：架构级变更（文件增删 / 数据流变化）同步 `AGENTS.md` 与 `docs/`；UI 变更同步 `design-system/MASTER.md`。
- **提交信息**：`omp commit` 生成（type 英文 + summary 首词英文过去式 + 其余中文，30 字符内）。
- **输入框**：全 app 禁系统输入提示（`lib/inputAssist.ts` 全局挂 `spellcheck=false` 等），组件不许各自写。
- **滚动条**：全 app 不显示滚动条（`index.css` 全局规则），滚动照常。
- **弹层**：`lib/useDropdown.ts` 统一（最上层 Esc / Tab 圈定 / 焦点恢复 / 挂载层 = 最上层模态）；`EnumSelect` 面板 `width: max-content` 不许截断。
- **状态**：高频字节流 / 流式帧不进 Zustand 原始形态（rAF 合并后进）；解析放在 store 边界（值没变不写）。

## 常用命令

```bash
pnpm install
pnpm tauri:dev              # 桌面壳联调
pnpm dev                    # 纯前端
pnpm check                  # 提交前全过：typecheck + lint + test + e2e:ipc
pnpm typecheck / lint / test / e2e:ipc
pnpm build                  # tsc + vite 构建
cargo test --manifest-path src-tauri/Cargo.toml            # Rust 单测
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored   # 慢测试（真实 omp）
pnpm tauri:build            # 本机发布构建
pnpm icon                   # 从 design-system/icon/omp-mini-icon.svg 重生成图标
```

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包 + `latest.json`；仓库必须 public（updater 匿名拉取）；`fixup` job 把资产链接改写为公开直链。
- 更新说明取 `CHANGELOG.md` 版本节（`scripts/changelog-notes.mjs`），版本节缺失会挡发版——**发版前先写 CHANGELOG**。
- macOS 签名用自签证书（`scripts/make-signing-cert.sh`；TCC 授权持久化）；CI 用 secrets `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`。
- 升版本号：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`（+ `Cargo.lock`）四处同步。

## 范围边界

- **做**：聊天唯一形态（v1 已实施）、Codex / ZCode 对标（v2）、设置重构（v3）。
- **不做**：编辑器 / 文件树 / 内置浏览器 / SSH / 移动端 / PR 集成；分屏 / 多窗口；worktree 生命周期管理；云同步 / 定时任务。
- 终端形态的一切概念（PTY / xterm / π 标题 / 目录行 / 标签栏）**不许再出现在任何新代码里**（`docs/v1-schedule.md` §1 已把它们全部删除）。
