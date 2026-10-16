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
| `docs/v4-schedule.md` | 排期 4：右栏改造——文件目录 + 终端（**已实施**）|
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
  app/App.tsx                # 顶层装配（左栏 + 中列 + 右栏工作台 + 设置视图 + 全局浮层与快捷键）
  components/sidebar/        # 左栏：ChatSidebar（常驻命令行 + 会话树 + 项目拖拽排序控制器）/ SidebarTop / SidebarBottom / WorkspaceGroupDialog / RowAction / DropLine / OmpUpdateChip / AppUpdateChip
  components/workbench/      # 右栏工作台（V42）：WorkbenchPanel（停靠 + 文件/终端双页签）/ FileTree（只读目录树 + 变更标色 + 引用注入）/ TerminalPane（xterm.js + PTY 管道）
  components/thread/         # 消息列：ChatView / TopBar / Thread / AssistantText / ToolRow / ToolRunRow / TurnRow / ApprovalCard / UiRequestCard / ChatEmptyState / PlanCard（任务清单浮卡）/ FindBar / BtwPanel / SessionStatsDialog / DiffDialog…
  components/composer/       # 输入卡（v2）：Composer（卡顶行项目/分支 + 提交键 + 卡底工具行：`+`/执行模式/压缩/容量环/用量/模型/思考档/发送）/ CommitButton / ApprovalModeMenu / ModelMenu / ThinkingMenu / PlusMenu / GoalRow / MentionList / SlashMenu / UsageLimits
  components/pickers/        # 选择器：ProjectPicker / BranchPicker（内嵌输入卡顶行；分支清单点选即切）
  components/settings/       # GeneralSettingsPanel / ModelsPanel / PluginsPanel / SkillsPanel / ProvidersSection / MemoryPanel / UsagePanel / SettingsSearch（v3 顶部搜索）/ Highlight（命中高亮）…
  components/usage/ update/ git/   # 供应商用量 / 更新弹窗 / 提交面板
  components/CommandPalette.tsx / SettingsPage.tsx / ReferencePicker.tsx / HealthBanner.tsx …
  lib/                       # viewmsg / mergeEvents / threadLayout / termTheme（终端配色）/ useSessionEvents / sessionOpen / streamReveal / mdBlocks / streamCaret / useGitInfo / localNote / promptHistory / commandPalette / btw / checkouts / workspaceGroups / projectDrag / useElapsed / useText / locale / theme / platform / settingsTabs / settingsSearch / useSettingsSearchSources / …
  shared/                    # api（invoke 唯一入口）/ ipc（命令与事件常量唯一清单）/ types
  stores/app.ts              # Zustand 全局状态（会话 / 消息流 / 队列 / 未读标 / 右栏开关 / 引用浮层 / 设置视图 / 更新 / 提交任务 / 工作区）
src-tauri/src/
  runtime.rs                 # 会话的 RPC 运行时（spawn 握手 → pump → kill_all；事件面泛型）
  pty.rs                     # 右栏终端：PTY 里的登录 shell（spawn / write / resize / kill / kill_all，输出走 Channel）
  proc.rs                    # 进程与环境工具（登录 shell PATH 探测 / 进程组强杀；runtime / pty / git_commit / commit_msg / omp_update 复用）
  commands/mod.rs            # RPC 命令面 + 项目 / 工作区 / 会话 / git 命令
  context.rs session_scan.rs overlay.rs git_info.rs git_commit.rs git_ops.rs project_files.rs workspace_fs.rs
  plugins.rs skills.rs settings.rs themes.rs models_config.rs title_prompt.rs omp_update.rs
  providers.rs memories.rs usage.rs provider_usage.rs extra_usage.rs
scripts/                     # e2e-ipc-selfcheck / generate-icons / changelog-notes / fixup-latest-json / make-signing-cert / tauri-build
```

## 核心数据流（不许违背）

- **聊天会话 = per-会话长驻 `omp --mode rpc-ui` 进程**（`runtime.rs`）：握手（negotiate / get_state / 子代理订阅 / ask 对话框开关）→ pump（stdin 写、stdout 读、`rpc_chunk` 重组、帧分类）。事件三通道 **`omp-event/status/state://<sid>` 用会话 id 命名**。kill 走 `kill_runtime`；应用退出 `kill_all`。
- **会话身份 = 完整 uuid**（jsonl 文件名里的 uuid）：**任何定位 / `--resume` 都不许退回 8 字符前缀**（uuid v7 前 8 位同一分钟内必然相同，会读错历史 / 删错文件 / resume 到别的会话并顶掉它正在跑的进程）。`session_file_for` 只认完整 id。
- **open-elsewhere = omp 的保护性 fork**：打开一个已被**其他进程**持有的会话时，omp 会把本次打开分到**新身份**（新 jsonl、`parentSession` 指向原会话、标题继承；日志 `Session moved to a new file / reason: open-elsewhere`）——列表里因此会出现两个同名会话（原会话 + 副本），常见触发是两个壳实例（安装版 + dev）同时打开同一会话。**壳侧口径：以 spawn 返回的真实 sid 为准**——`spawn_session_runtime` 身份漂移分支（`sid != 请求 id` 时按新身份的文件读头返回；`send_prompt` 自动恢复同口径），前端 `openSessionWithHistory` 全程用 `opened.id`（激活 / 历史 / 导航栈 / 发消息），漂移时补一条说明分隔行——不许用请求 id 继续（会错位到原会话并反复拉起新进程）。
- **新建会话的启动参数（`create_session`）**：项目里记的 `last_model` / `last_thinking` 只是**偏好**，不许让它把「新建会话」整条路堵死——omp 对不存在的 `--model` / 非法 `--thinking` 是**直接退出**（实测 `Error: Model "…" not found`，stdout 一帧都没有，壳只看到 EOF）。三层口径（用户实测的坑，2026-10-16 修）：① omp 的 stderr 由 `StderrBuf` 采集并接进错误（`spawn_long_lived` 失败路径统一 `with_stderr_reason`，`stderr_first_line` 只脱壳加的那一层括号）——「进程意外退出」这类错误必须自带原因；② 首发被拒 → 去掉这两个参数**降级重试**一次（omp 用默认档），成功即按 `Plan::Degraded` 清掉项目里那对失效偏好（不自愈的话每次新建都白失败一次），并把 `FallbackNotice` 随回包返回；前端在会话流尾落一条本地说明行（`appendLocalNote`），不许静默换模型；③ 降级后 omp 仍没拿到模型（问题不在偏好上）→ 如实说明，**不动用户的项目偏好**。resume 路径不带这两个参数，故不受影响。
- **发送语义**：idle = Enter 发送（`/` 开头先查壳本地命令）；running = **Enter 插话（steer）/ Tab 排队（follow_up）/ Esc 中断并交还队列**（`abort_and_restore_queue`）。队列 = omp 真值（`queue_update` 帧落 `store.queuedBySession`，`applyQueue` 唯一写入面；行可撤回 / 编辑 / 提升）。
- **执行模式（权限档）真值**：输入卡上的档位 = **本会话生效档**（覆盖层 `sessionApproval` 优先，否则 omp `tools.approvalMode`）；两个来源都不许「兜底成某一档」——没读到就显示「读取中…」。写入只走 `lib/sessionApproval.ts`：菜单选择 = 写 omp 全局默认（新会话档位）+ 本会话覆盖（idle 重启 runtime 立即生效 / running 挂起到本轮结束），Shift+Tab 循环只动本会话覆盖；启动时 `loadApprovalState()` 水合覆盖层 + 全局档（`get_overlay` 的 wire 是覆盖层文件格式 snake_case，别按 camelCase 猜）。
- **思考档默认口径**（2026-10-14 拆分模型 / 思考档两个选择器）：默认档 = omp 配置的 `defaultThinkingLevel`（`get_default_thinking_level` → `omp config get`；前端单飞读在 `lib/thinkingDefault.ts`、后端在 `settings::read_default_thinking_level`）。实测（18.10.3 rpc-ui）：切模型时 omp **保留仍然合法的档位**、切到无思考模型直接丢档且切回不恢复——所以壳侧只在「档位缺失 / 对新模型非法」时落默认档（`runtime.rs` 的 `auto_think_level` 夹到该模型支持集；不覆盖用户已选的有效档），前端显示与乐观更新镜像同一口径（`lib/thinking.ts` 的 `clampThinking` / `resolveThinking`），真值经 `omp-state://` 回读收敛。模型目录行**必须带供应商**（同名模型来自 ark.cn / ccproxy / commandcode 多家，只给名字分不出来）。
- **供应商用量入口口径**（输入卡工具行的用量键）：看**全部已配置供应商**的限额窗口，与当前会话的模型**无关**——**收起态只有一个图标**（配色档由最紧的窗口定：`entryGlance`），点开才是内容（浮层按上游顺序列全部窗口 + 「配了但没探针」的供应商）；只有「一次都没拿到数据且最近一次查询失败」才置灰（`lib/usageLimits.ts` 的 `usageEntryDisabled`，不许再按 `currentModel` 的供应商过滤或置灰）。窗口**读数**口径唯一（`lib/providerUsage.ts` 的 `limitReading`，弹窗与浮层共用）：有比例才画条 + 百分比、余额型给「$X 剩余」、计数型给数量原文——percent 缺省 0 不是读数，拿它显示就是编造「0.0%」。
- **状态收敛**：终态 `agent_end` → idle；**`agent_end{isTerminal:false, awaitingAsyncWork:true}`（等后台完成投递）也折算 idle**（活动态单列 `idle-awaiting`，闲置回收跳过）；`session_settled` 同样收敛（`get_state` 真值回读挂在「终态 agent_end ∪ session_settled」上——运行中注入的补标题 `/rename` 会把本轮 agent_end 变非终态，只认终态会漏掉首轮回读；**运行中另有一路**：每个 assistant 步收尾（`message_end`）按 ≥2s 节流补一发 `get_state`，`contextUsage` 才会随长任务推进增长，见 `runtime.rs` 的 `midrun_sync_due`）。前端状态不许在 `open_session` 回包时被压成 idle（会打断进行中的轮次）。**列表「运行中」标与状态收敛同源**：`SessionView.running` 由进程表活动态派生（`running_snapshot` → `activity_is_busy`：只有 running / awaiting-approval 才算），不许再存「进程在任」快照——打开过的空闲会话不该转圈、跑完的任务不许一直转，「跑完未读」完成勾就是它 running→非 running 的翻转。**前端显示层同口径**：左栏对**打开过的会话**（有 `statusBySession` 记录）的 `running` 一律按实时状态派生（`ChatSidebar.mergedSessions`，running / awaiting-approval = 在跑，与 Composer 同口径）——`store.sessions` 行的 `running` 只是 open / refresh 时刻的快照，任务结束没有写入面把它归零，整行覆盖扫描行会把跑完的会话永远钉在转圈（用户实测）；没打开过的行（无状态记录）才用行自带值。
- **任务清单（todo）口径**：**上游没有「清单更新」事件**——全量真值只有两处：todo 工具帧的 `result.details.phases`（`tool_execution_end` 与 `message_end{toolResult}` 两路同形，实测 18.10.4；`useSessionEvents` 的 handler 实时写 `store` 的 `applyPlans`——`plansBySession` 唯一写入面、值没变不写），与 `get_state.todoPhases` 回读（数组即覆盖、空数组 = 已清空并删浮卡状态；resume 历史会话靠它恢复）。`todo_reminder` 是「未完成项提醒」（`{todos,attempt,maxAttempts}`，不带 phases）——不解析、不进消息流；`todo_auto_clear` 收到即清空（探针 80s 未触发，兜底分支）。真值形状：phase / task **无 id**（key 用下标）、状态集含 `blocked`（带 `blocker` 文案）。展示**只有一处**（符号 / 色调 / 统计文案统一在 `lib/todoDisplay.ts`：`TODO_DISPLAY` / `countTodos` / `todoStatsText`）：消息列底部**浮卡**（`thread/PlanCard.tsx`——贴消息列底部、浮在输入卡上方的宽卡，挂 Thread 相对定位外壳、宽度 = `--measure-content` 与正文列同档，高度回报 Thread 给消息流垫等高留白、回底按钮随之让位；头部行 = 图标 + 「任务」+ 未完成档位统计「1 进行中 · 10 待处理」+ 折叠箭头，整行 = 开合开关；展开 = 清单区 `max-h` 内滚；开合在 `store.planCardBySession`——无记录 = 首次出现自动展开，全部完成只在 `allDone` 翻转那一下自动折成头部行，**没有隐藏档**；清空即退场）。
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
- **三栏布局（v2；右栏 V42 改造）**：左栏（`SidebarShell` + `ChatSidebar`）/ 中列（`ChatView`）/ 右栏**工作台**（`WorkbenchPanel`，装配在 `App` 主区内、`ChatView` 之侧）。右栏开关 = `store.workbenchOpen`（持久化、**默认收起**，⌘⇧G）；打开即停靠为第三栏（布局变三栏，会话列让位、不遮盖）。**右栏宽度可拖**（`store.workbenchWidth`：260–640、默认 320、持久化；手柄在左缘，另受「给中列留 420px」的窗口约束，窗口变窄自动收回超限值）。**右栏 = 文件 / 终端两个页签**（`store.workbenchTab`，持久化），面板**常驻挂载、只切显隐**（收起 / 切页签 / 切设置视图都不卸载：终端进程与 xterm 回看缓冲、文件树的展开位置都不丢）。
- **右栏工作台（V42）**：目标目录 = 当前会话 cwd（`lib/context.ts` 的 `resolveContext`），会话切换即跟着切。**文件页签** = 只读目录树（`workbench/FileTree.tsx`）：懒加载一层（`list_dir`，`withRepoRoot` 只在树根传）、目录优先 + 名称升序、每目录分片 200 条、单层超 2000 条截断；未提交改动拿一次 `get_change_set`，按「仓库根 + 相对路径」换算成绝对路径打徽标（`M/A/D/R·C/?`）；点文件用系统默认程序打开，行尾 hover 出「引用到输入框」（与 `⌘⇧P` 引用浮层同一条 `appendReference` 注入口径）与「在访达中显示」。**不许**变成编辑器：只读、不写文件、不预览内容。**终端页签** = PTY 里的登录 shell（`pty.rs` + `workbench/TerminalPane.tsx`）：`terminal_spawn` 建 PTY、输出走 Tauri Channel、`terminal_write` / `terminal_resize` / `terminal_kill` 三路寻址；终端**按 cwd 保留**（`store.terminalCwds`，RS 里上限 4——每个是一个常驻 shell，超出淘汰最旧的，对应组件卸载即 kill）；高频字节流只进 xterm，**不进 store**；应用退出走 `pty::kill_all`。**不许**再引入终端形态的会话模型（π 标题 / 目录行 / 标签栏 / 覆盖层注入）。
- **消息列布局（v2）**：`lib/threadLayout.ts` 的 `buildThreadLayout(shown, running)` 是渲染前的唯一布局派生——相邻同类工具行聚合成摘要行（命令批 / 编辑卡 / 任务清单批——`todo` 工具行连成一段折成「更新了 N 次任务清单」，清单的当前状态看消息列底部浮卡），每轮末尾追加轮时长行（`user.at` → 该轮最后一条消息的 `at`；running 时跳过流尾轮）。`ViewMsg.at` 来源：历史 = jsonl 行的 `timestamp`（`lib/viewmsg.ts` 的 `lineAtOf`），实时 = 帧到达时刻（`useSessionEvents` 统一打戳）。聚合/时长只在布局层做，不改 `mergeViewMsgs` 的合并口径。
- **左栏未读完成标（v2）**：后台会话的**一轮起止**只有 `list_sessions` 快照看得到——`running` 字段 = **任务在跑**（进程表活动态派生，见「状态收敛」），`ChatSidebar.reload` 对比上一份快照，`running → 非 running` 且不在前台 → `store.markUnread`；打开会话（SessionRow 点击）`clearUnread`。运行期状态，不持久化。
- **删除 / 归档的列表缓存同步**：左栏的 `mergedSessions` 把 `store.sessions` 当真相覆盖，并把「扫描结果里没有的行」补回列表（服务的是刚新建、还没落盘的会话）——所以删除 / 归档 / 恢复**必须在 `runSessionBatch` 里同步这些行**（删除 = 丢行 + 清激活；归档 / 恢复 = 只改归档位）。漏掉这一步的后果（用户实测）：后端删掉 jsonl、下一次刷新扫不到它，缓存里那一行又被补回来（还被顶到组首），看着像「点删除以后又冒出一个会话」；归档同理——缓存里过期的 `archived: false` 会把扫描回传的 `archived: true` 顶掉，归档过的会话继续留在「进行中」。命令面 ⌘K 的「归档当前会话」走同一入口，不许各写一份「归档完清什么」。
- **标题**：omp 对 `--mode rpc-ui` 强制关闭自动标题——壳侧两层补：pump 在首条用户消息帧（`message_start` role=user 等）一到就注入一次 `/rename`（`/` 开头在 omp 侧先过命令门、早于 streaming 判定，`/rename` 无参数走后台执行：运行中注入不插话、不排队、不阻塞——标题在任务跑完前就有），spawn 时（resume 旧会话）与每次终态 `agent_end`（失败兜底重试）各再看一眼，每进程至多成功一次 → `session_info_update` 帧回灌；后端扫描 `first_user_text` 派生显示标题兜底。标题语言随壳界面语言（`TITLE_SYSTEM.md`，用户自写文件不覆盖）。**标题显示口径**：omp 18.8.7+ 的标题卡（上游 `utils/title-card.ts`，`title.icons` 默认 `nf+emoji`）会在生成 / `/rename` 时把标题写成 `${icon} ${code}: ${title}`（实测 `󰜘 COMMIT: 提交推送后仍有修改标识`；图标是私有区码位，壳里没有覆盖私有区的字体，WebKit 会回退成 Apple Symbols 的杂物字形，U+F084D 画成 6 根横条），**显示层一律去掉开头这整段前缀（图标 + 大写短码）**（`lib/sessionTitle.ts` 的 `sessionTitleForDisplay`，侧栏行 / 删除确认 / 顶栏 / 命令面 / 归档页 / 设置搜索 / **改名输入框回显**同一口径；没有图标的裸 `HGT: ` 不是卡、不剥），数据保持原样（jsonl 标题、导出仍带前缀）。**改名交互**（顶栏点标题就地改名）：Enter 或**点输入框外**提交、Esc 取消，改过才写 omp 真名（原样提交 = 不写）——「点输入框外」走 document `pointerdown`，不用 blur（WKWebView 里点非聚焦元素不搬焦点）；同一次点击里 pointerdown 提交后 blur 的补发由一次性结算挡住。
- **内存治理**：每 60s 一轮闲置回收（idle 30 分钟且已落盘 → kill；重新打开 / 发消息自动 resume）；`eventsBySession` 只留最近 3 个会话（切会话时触发 LRU 裁剪）；工具全量输出封顶 100K 字符。
- **模型目录**（`omp models --json`，2–10s）：单飞 + 5 分钟缓存 + 过期后台刷新（`omp-models://catalog` 广播）；`omp config list --json` 一次读全部配置键。
- **设置写入口径**：omp 侧只经 `omp` CLI（`config set/reset`、`auth-broker`…）；**唯一例外**：`models.yml` 直接写文件（hash 乐观锁 + 预校验 + 备份 + 原子写）。本应用偏好不写 omp 配置。
- **设置视图（v3 设置重构）**：`SettingsPage` 覆盖主区（`store.settingsTabOpen/settingsTabActive`；打开 = 左栏「设置」/ `⌘,`，关闭 = 顶部返回 / `⌘W` / 再点一次）——顶部条（返回 + 当前条目名 + 搜索钮）+ 左导航**四组七条目**（通用 / 模型 / 扩展 / 数据；窄窗 44px 图标档，容器查询）+ 内容区唯一滚动。搜索 = `store.settingsSearchOpen`（`⌘F`），数据源走 `lib/settingsSearch.ts`（模块级缓存 + 懒加载，设置视图卸载即清；参数 = 常用设置目录 / 模型目录 / 插件 / 技能 / 记忆 / 归档），四档打分复用 `filterCatalog`；结果点击经 `navigateTo` 跳条目，常用设置项带 `SettingsFocusRequest{key,seq}` 定位（通用页展开分组 → 滚动到行 → 一次闪烁；seq 防重放、消费后回调清空）。
- **提交 / 推送**：两轨（快速 = 一次 `omp -p` 生成信息 + `git commit/push`；完整 = `omp commit`）；按 cwd 建任务表（并行 + BUSY + 取消 + 超时）；入口 = **卡顶行提交键**（V42 起右栏「变更」区块随上下文面板退场，这里是唯一入口；同一浮层链路、同一状态口径：运行中转圈 / 失败红点）+ 左栏任务徽章。
- **卡顶行 git 区（分支切换）**：`BranchPicker` 展开清单**点分支即切**（后端 `switch_branch` = `git switch <branch>`，只认分支、不会被同名路径抢语义）——脏工作区交给 git 裁决（带得走就带着走，冲突整条拒绝、错误原文就地显示，壳侧不 stash / 不 force）；切换成功走 `refreshWorkspaceGitState([cwd])`——它是 **git 状态的统一刷新入口**（刷新时机 = 启动 / 焦点 / 30s 轮询 / π 就绪 / 提交任务结束 / 分支切换），每次刷新自增 store 的 `gitInfoSeq`，`useGitInfo` 的全部挂载实例（输入卡顶行）一起重读、ahead/behind 快照同步刷新。只读查询仍是 `get_git_info`（4s 超时、降级不报错），写命令用 30s 超时。
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

- **做**：聊天唯一形态（v1 已实施）、Codex / ZCode 对标（v2 已实施）、设置重构（v3 已实施）、**右栏工作台**——文件目录 + 终端（V42 已实施，口径见 `docs/v4-schedule.md`）。
- **不做**：编辑器（文件只读浏览，打开交给系统默认程序）/ 内置浏览器 / SSH / 移动端 / PR 集成；分屏 / 多窗口；worktree 生命周期管理；云同步 / 定时任务。
- 终端**只作为右栏工作台的页签**存在：不许再长出终端形态的会话模型（π 标题 / 目录行 / 标签栏 / 覆盖层注入 / 多标签管理），也不许把文件树升级成编辑器或全屏工作区（`docs/v1-schedule.md` §1 的删除清单仍然有效，`docs/v4-schedule.md` 是唯一例外口）。
