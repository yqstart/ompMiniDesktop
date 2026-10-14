# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的桌面端：**聊天形态的 omp 工作台**（Tauri v2 + React 19 + TS + Tailwind v4 + Zustand，包管理 pnpm）。

> 改代码前先读 `docs/roadmap.md`（版本规划）与对应版本排期。

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/roadmap.md` | 版本规划总纲（首个版本 0.1.0 = 形态收敛 + 聊天对标 + 设置重构）|
| `docs/v1-schedule.md` | 排期 1：终端形态删除清单 / 迁移清单 / 验收（**已实施**，2026-10-14）|
| `docs/v2-schedule.md` | 排期 2：布局 / 流式 / 聊天框对标 Codex、ZCode |
| `docs/v3-schedule.md` | 排期 3：设置重构（功能保留、形态重做）|
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
  app/App.tsx                # 顶层装配（左栏 + 中列 + 右栏上下文面板 + 设置视图 + 全局浮层与快捷键）
  components/sidebar/        # 左栏：ChatSidebar（常驻命令行 + 会话树 + 项目拖拽排序控制器）/ SidebarTop / SidebarBottom / WorkspaceGroupDialog / RowAction / DropLine / OmpUpdateChip / AppUpdateChip
  components/panel/          # 右栏上下文面板（v2）：ContextPanel（停靠/抽屉 + 区块导航）/ PanelSection / ChangesSection / ProgressSection / SubagentsSection / SourcesSection
  components/thread/         # 消息列：ChatView / TopBar / Thread / AssistantText / ToolRow / ToolRunRow / TurnRow / ApprovalCard / UiRequestCard / ChatEmptyState / FindBar / BtwPanel / SessionStatsDialog / DiffDialog…
  components/composer/       # 输入卡（v2）：Composer（卡顶行项目/分支 + 卡底工具行：`+`/执行模式/压缩/容量环/用量/模型/思考档/发送）/ ApprovalModeMenu / ModelMenu / ThinkingMenu / PlusMenu / GoalRow / MentionList / SlashMenu / UsageLimits
  components/pickers/        # 选择器：ProjectPicker / BranchPicker（内嵌输入卡顶行）
  components/settings/       # GeneralSettingsPanel / ModelsPanel / PluginsPanel / SkillsPanel / ProvidersSection / MemoryPanel / UsagePanel / SettingsSearch（v3 顶部搜索）/ Highlight（命中高亮）…
  components/usage/ update/ git/   # 供应商用量 / 更新弹窗 / 提交面板
  components/CommandPalette.tsx / SettingsPage.tsx / ReferencePicker.tsx / HealthBanner.tsx …
  lib/                       # viewmsg / mergeEvents / threadLayout / panelSources / useSessionEvents / sessionOpen / streamReveal / mdBlocks / streamCaret / useGitInfo / localNote / promptHistory / commandPalette / btw / checkouts / workspaceGroups / projectDrag / useElapsed / useText / locale / theme / platform / settingsTabs / settingsSearch / useSettingsSearchSources / …
  shared/                    # api（invoke 唯一入口）/ ipc（命令与事件常量唯一清单）/ types
  stores/app.ts              # Zustand 全局状态（会话 / 消息流 / 队列 / 未读标 / 右栏开关 / 引用浮层 / 设置视图 / 更新 / 提交任务 / 工作区）
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
- **open-elsewhere = omp 的保护性 fork**：打开一个已被**其他进程**持有的会话时，omp 会把本次打开分到**新身份**（新 jsonl、`parentSession` 指向原会话、标题继承；日志 `Session moved to a new file / reason: open-elsewhere`）——列表里因此会出现两个同名会话（原会话 + 副本），常见触发是两个壳实例（安装版 + dev）同时打开同一会话。**壳侧口径：以 spawn 返回的真实 sid 为准**——`spawn_session_runtime` 身份漂移分支（`sid != 请求 id` 时按新身份的文件读头返回；`send_prompt` 自动恢复同口径），前端 `openSessionWithHistory` 全程用 `opened.id`（激活 / 历史 / 导航栈 / 发消息），漂移时补一条说明分隔行——不许用请求 id 继续（会错位到原会话并反复拉起新进程）。
- **发送语义**：idle = Enter 发送（`/` 开头先查壳本地命令）；running = **Enter 插话（steer）/ Tab 排队（follow_up）/ Esc 中断并交还队列**（`abort_and_restore_queue`）。队列 = omp 真值（`queue_update` 帧落 `store.queuedBySession`，`applyQueue` 唯一写入面；行可撤回 / 编辑 / 提升）。
- **执行模式（权限档）真值**：输入卡上的档位 = **本会话生效档**（覆盖层 `sessionApproval` 优先，否则 omp `tools.approvalMode`）；两个来源都不许「兜底成某一档」——没读到就显示「读取中…」。写入只走 `lib/sessionApproval.ts`：菜单选择 = 写 omp 全局默认（新会话档位）+ 本会话覆盖（idle 重启 runtime 立即生效 / running 挂起到本轮结束），Shift+Tab 循环只动本会话覆盖；启动时 `loadApprovalState()` 水合覆盖层 + 全局档（`get_overlay` 的 wire 是覆盖层文件格式 snake_case，别按 camelCase 猜）。
- **思考档默认口径**（2026-10-14 拆分模型 / 思考档两个选择器）：默认档 = omp 配置的 `defaultThinkingLevel`（`get_default_thinking_level` → `omp config get`；前端单飞读在 `lib/thinkingDefault.ts`、后端在 `settings::read_default_thinking_level`）。实测（18.10.3 rpc-ui）：切模型时 omp **保留仍然合法的档位**、切到无思考模型直接丢档且切回不恢复——所以壳侧只在「档位缺失 / 对新模型非法」时落默认档（`runtime.rs` 的 `auto_think_level` 夹到该模型支持集；不覆盖用户已选的有效档），前端显示与乐观更新镜像同一口径（`lib/thinking.ts` 的 `clampThinking` / `resolveThinking`），真值经 `omp-state://` 回读收敛。模型目录行**必须带供应商**（同名模型来自 ark.cn / ccproxy / commandcode 多家，只给名字分不出来）。
- **供应商用量入口口径**（输入卡工具行的用量键）：看**全部已配置供应商**的限额窗口，与当前会话的模型**无关**——**收起态只有一个图标**（配色档由最紧的窗口定：`entryGlance`），点开才是内容（浮层按上游顺序列全部窗口 + 「配了但没探针」的供应商）；只有「一次都没拿到数据且最近一次查询失败」才置灰（`lib/usageLimits.ts` 的 `usageEntryDisabled`，不许再按 `currentModel` 的供应商过滤或置灰）。窗口**读数**口径唯一（`lib/providerUsage.ts` 的 `limitReading`，弹窗与浮层共用）：有比例才画条 + 百分比、余额型给「$X 剩余」、计数型给数量原文——percent 缺省 0 不是读数，拿它显示就是编造「0.0%」。
- **状态收敛**：终态 `agent_end` → idle；**`agent_end{isTerminal:false, awaitingAsyncWork:true}`（等后台完成投递）也折算 idle**（活动态单列 `idle-awaiting`，闲置回收跳过）；`session_settled` 同样收敛（`get_state` 真值回读挂在「终态 agent_end ∪ session_settled」上——运行中注入的补标题 `/rename` 会把本轮 agent_end 变非终态，只认终态会漏掉首轮回读；**运行中另有一路**：每个 assistant 步收尾（`message_end`）按 ≥2s 节流补一发 `get_state`，`contextUsage` 才会随长任务推进增长，见 `runtime.rs` 的 `midrun_sync_due`）。前端状态不许在 `open_session` 回包时被压成 idle（会打断进行中的轮次）。**列表「运行中」标与状态收敛同源**：`SessionView.running` 由进程表活动态派生（`running_snapshot` → `activity_is_busy`：只有 running / awaiting-approval 才算），不许再存「进程在任」快照——打开过的空闲会话不该转圈、跑完的任务不许一直转，「跑完未读」完成勾就是它 running→非 running 的翻转。
- **流式渲染管线**：`frameToViewMsgs` → `mergeEvents`（rAF 合并缓冲：同 id 折叠、工具卡合并）→ `useSessionEvents`（历史 LRU：只留最近 3 个会话；running 豁免）→ `Thread`：
  - `AssistantText` 两段式分块（`mdBlocks`：冻结前缀 memo + 活跃尾块每帧重走；围栏骨架只在「围栏开、无内容」时）；
  - 平滑揭示（`streamReveal`：有界追赶、complete 立即全量）；
  - 光标 = **测量覆盖**（`streamCaret` 只写 style，不许搬 React 管理的 DOM）；
  - 贴底跟随 = sticky 语义（`useLayoutEffect` + `onScroll` / `followBottom` 共用 `userScrolledAway` + ResizeObserver 回调 ref；`events` 引用变化即跟）。释放只看「用户上翻」（scrollTop 净位移 > 8px 且离底 ≥ 80px）——按「距底距离」判会把视口变矮（输入框长高 / 查找条 / 窗口缩放）当成滚开，跟随会永久死亡。
  - 无内容文本块（只有空白 / 孤立标点的 `{"type":"text"}`）不落正文行（`textHasContent`，历史与实时同口径）。
  - 实时行 id = `${sid}:${msgSeq}:${contentIndex}`（contentIndex 每条消息从 0 重数，只用它会撞车）；重开实时流过的会话按「类别 + 全文」与历史配对，不许翻倍。
  - `text_end` 是文本块完结信号（消费它，行才收敛）；工具占位卡从 `partial` 取真名 / 真 id / 半截参数。
  - **注入消息分类**：`role=developer`（omp TTSR 规则提醒 `<system-reminder …>`）不落正文——历史回放与实时帧都渲染成一条 `divider:"reminder"` 紧凑行（规则名进文案，正文不入流）；其余未知 role 一律不按正文渲染（正文只认 assistant，注入内容落成正文就是泄漏）。
- **消息列滚动**：`.thread-scroll` 必须保持 `overflow-y: auto`（`index.css`）——跟随 / 回看 / 加载更早全靠它（V32 曾漏恢复导致「输入框上方文字重叠」）。
- **三栏布局（v2）**：左栏（`SidebarShell` + `ChatSidebar`）/ 中列（`ChatView`）/ 右栏（`ContextPanel`，装配在 `App` 主区内、`ChatView` 之侧）。右栏开关 = `store.contextPanelOpen`（持久化、**默认收起**，⌘⇧G）；打开即停靠为第三栏（布局变三栏，会话列让位、不遮盖）。
- **消息列布局（v2）**：`lib/threadLayout.ts` 的 `buildThreadLayout(shown, running)` 是渲染前的唯一布局派生——相邻同类工具行聚合成摘要行（命令批 / 编辑卡），每轮末尾追加轮时长行（`user.at` → 该轮最后一条消息的 `at`；running 时跳过流尾轮）。`ViewMsg.at` 来源：历史 = jsonl 行的 `timestamp`（`lib/viewmsg.ts` 的 `lineAtOf`），实时 = 帧到达时刻（`useSessionEvents` 统一打戳）。聚合/时长只在布局层做，不改 `mergeViewMsgs` 的合并口径。
- **左栏未读完成标（v2）**：后台会话的**一轮起止**只有 `list_sessions` 快照看得到——`running` 字段 = **任务在跑**（进程表活动态派生，见「状态收敛」），`ChatSidebar.reload` 对比上一份快照，`running → 非 running` 且不在前台 → `store.markUnread`；打开会话（SessionRow 点击）`clearUnread`。运行期状态，不持久化。
- **标题**：omp 对 `--mode rpc-ui` 强制关闭自动标题——壳侧两层补：pump 在首条用户消息帧（`message_start` role=user 等）一到就注入一次 `/rename`（`/` 开头在 omp 侧先过命令门、早于 streaming 判定，`/rename` 无参数走后台执行：运行中注入不插话、不排队、不阻塞——标题在任务跑完前就有），spawn 时（resume 旧会话）与每次终态 `agent_end`（失败兜底重试）各再看一眼，每进程至多成功一次 → `session_info_update` 帧回灌；后端扫描 `first_user_text` 派生显示标题兜底。标题语言随壳界面语言（`TITLE_SYSTEM.md`，用户自写文件不覆盖）。
- **内存治理**：每 60s 一轮闲置回收（idle 30 分钟且已落盘 → kill；重新打开 / 发消息自动 resume）；`eventsBySession` 只留最近 3 个会话（切会话时触发 LRU 裁剪）；工具全量输出封顶 100K 字符。
- **模型目录**（`omp models --json`，2–10s）：单飞 + 5 分钟缓存 + 过期后台刷新（`omp-models://catalog` 广播）；`omp config list --json` 一次读全部配置键。
- **设置写入口径**：omp 侧只经 `omp` CLI（`config set/reset`、`auth-broker`…）；**唯一例外**：`models.yml` 直接写文件（hash 乐观锁 + 预校验 + 备份 + 原子写）。本应用偏好不写 omp 配置。
- **设置视图（v3 设置重构）**：`SettingsPage` 覆盖主区（`store.settingsTabOpen/settingsTabActive`；打开 = 左栏「设置」/ `⌘,`，关闭 = 顶部返回 / `⌘W` / 再点一次）——顶部条（返回 + 当前条目名 + 搜索钮）+ 左导航**四组七条目**（通用 / 模型 / 扩展 / 数据；窄窗 44px 图标档，容器查询）+ 内容区唯一滚动。搜索 = `store.settingsSearchOpen`（`⌘F`），数据源走 `lib/settingsSearch.ts`（模块级缓存 + 懒加载，设置视图卸载即清；参数 = 常用设置目录 / 模型目录 / 插件 / 技能 / 记忆 / 归档），四档打分复用 `filterCatalog`；结果点击经 `navigateTo` 跳条目，常用设置项带 `SettingsFocusRequest{key,seq}` 定位（通用页展开分组 → 滚动到行 → 一次闪烁；seq 防重放、消费后回调清空）。
- **提交 / 推送**：两轨（快速 = 一次 `omp -p` 生成信息 + `git commit/push`；完整 = `omp commit`）；按 cwd 建任务表（并行 + BUSY + 取消 + 超时）；入口 = 右栏「变更」区块的提交键与左栏任务徽章。
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

- **做**：聊天唯一形态（v1 已实施）、Codex / ZCode 对标（v2 已实施）、设置重构（v3 已实施）。
- **不做**：编辑器 / 文件树 / 内置浏览器 / SSH / 移动端 / PR 集成；分屏 / 多窗口；worktree 生命周期管理；云同步 / 定时任务。
- 终端形态的一切概念（PTY / xterm / π 标题 / 目录行 / 标签栏）**不许再出现在任何新代码里**（`docs/v1-schedule.md` §1 已把它们全部删除）。
