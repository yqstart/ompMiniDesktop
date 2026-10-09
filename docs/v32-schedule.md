# ompMiniDesktop 三十二期（V32）：双形态——终端工作区 ⇄ 聊天界面

> 基线：V1–V31 已交付（见 `CHANGELOG.md`）。本文是**形态扩展**的设计与实现记录：
> app 在「终端工作区」（V11 起的现行形态）与「聊天界面」（V1–V10 的形态，恢复）之间切换。
> 上游实测口径注明版本与日期；未实测的结论一律标注。
> 参考产品：用户口径里的「codex / zcode 形态」= V1–V10 的聊天界面（消息流 + 审批卡 + 输入框）。

## 0. 一句话

**同一个 app、两种形态，左栏与主区都随形态切换**：
终端形态 = 工作区树左栏 + 标签栏 + PTY 里的 omp TUI；聊天形态 = 会话侧栏左栏 + 顶栏 + 消息流 + Composer（RPC 里的 omp 会话）。
切换入口在左栏顶栏（**原字标位**，`AppModeToggle`，持久化 `omp.appMode.v1`）；**两侧运行中的进程都不中断**。

> **二次口径（2026-10-09，用户口径）**：切换键从底部区**上移到字标位**、字标「ompMiniDesktop」退场；
> **左栏随形态切换**（终端 = 工作区树，聊天 = 会话侧栏，V1–V10 的 Sidebar 骨架恢复并适配）——
> 详见 §7；本文 §1–§6 保留 V32 交付时的原始记录，凡与 §7 冲突处**以 §7 为准**。

## 1. 用户口径与决策（2026-10-08）

| 决策点 | 选择 | 落地口径 |
|---|---|---|
| 切换粒度 | **全局切换** | 整个 app 在两种形态间整体切换（**左栏与主区都互换**——二次口径；V32 交付时是「左栏共享，主区互换」），同一时间只有一种形态 |
| 聊天形态的左栏 | **~~沿用当前工作区树~~ → 会话侧栏**（二次口径 2026-10-09 改） | ~~不恢复 V10 的独立 Sidebar；聊天入口接进现有左栏（目录行点击 / 项目会话弹窗 / 归档页）~~；现行为 `ChatSidebar`（V1–V10 的 Sidebar 骨架恢复并适配：添加项目 + 会话搜索 + 项目分组会话列表 + 未归属 + 扫描窗口），工作区树只在终端形态可见，见 §7 |
| 功能范围 | **V10 全量恢复** | 消息流 / 审批卡 / 工具行 / 思考折叠 / 模型与思考档切换 / 权限 / @提及 / `/` 命令 / 图片附件 / 上下文条 / 计划 todo / 导出 Markdown / 任务通知 |

由此推出的两个关键设计（本文的根）：

1. **左栏是共享的导航骨架，主区是形态的载体**。V10 的「项目分组 + 会话列表」左栏不再存在：
   会话的浏览入口 = 项目行的 Clock 弹窗（`SessionPopup`，V11 起就有）；打开行为**随形态分流**
   （`lib/checkouts.ts` 的 `resumeSessionInApp`：终端形态 = `omp --resume` 开终端；聊天形态 = `open_session` 进聊天视图）。
   目录行的点击同理（`openOrFocusCheckout`：终端形态开/聚焦终端；聊天形态聚焦该目录运行中的聊天、没有就新建）。
2. **切换 = CSS 显隐，不卸载任何一侧**。终端面板卸载会连带 kill 全部 PTY（V11 的教训），
   聊天侧的订阅与流同样不能断（切走期间到达的帧若没有监听者就被丢弃）——所以 ChatView 与终端面板
   **都常驻挂载**，`appMode` 只决定谁可见（`App.tsx`）。

## 2. 上游事实（omp 18.8.3 实测，2026-10-08）

rpc-memo（18.1/18.2 时代）的关键结论在 18.8.3 上**逐条复核通过**，并有两处新事实：

### 2.1 握手与状态（复核通过）

- `omp --mode rpc-ui --cwd <dir>` 首帧仍为 `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],...}`；
  `negotiate_protocol` v2 → `{"success":true,"data":{"protocolVersion":2}}`。
- 帧序仍为 `ready → setWidget → advisor_cost_changed → available_commands_update → response(neg) → response(state)`——
  **握手期攒帧回放**（`runtime.rs` 的 leftover 机制）依然是命令面不丢的前提。
- `get_state` 的新增字段：`goal`（goal 模式状态）、`isSettled`、`queuedMessageCount`、`hasPendingAsyncWork`——
  旧代码不读它们，透传层不受影响。
- `available_commands_update` 仍在（形状不变：`input.hint` / `subcommands`）。

### 2.2 prompt 全链路（复核通过 + 一处新帧）

一条最小 prompt 的真实帧链：

```
response(prompt,true) → agent_start → turn_start → message_start(user) → message_end(user)
→ message_start(assistant) → message_update(text_start|delta×3|text_end) → message_end(assistant)
→ turn_end → extension_ui_request(setWidget,单向) → agent_end(isTerminal:true) → prompt_result → session_settled
```

- `message_end(assistant).message.usage` 结构不变（`input/output/totalTokens/cacheRead/cacheWrite/cost.total`），
  `duration` / `ttft` 毫秒仍在。
- **新帧 `session_settled`**（18.8.3 新增）：`runtime.rs` 的 dispatch 对未知帧走透传，前端忽略即可，无需改动。
- **`message_end.message.content` 携带全文**（`[{type:"text",text:"OK了老铁\n\nok"}]`）——
  V1–V10 的前端在 `message_end` 处**再推一条随机 id 的文本行**，而流式 deltas 已经渲染过一遍，
  真机会出现**双份文本**。恢复时已修正：终帧文本与流式路径**共用同一个 id**（`${sid}:${contentIndex}`）
  以 `__append` 原地补全（见 §3.3 与 `lib/useSessionEvents.test.ts`）。

## 3. 架构与实现

### 3.1 进程模型：两个互不相干的进程表

| | 终端形态 | 聊天形态 |
|---|---|---|
| 进程 | per-终端 `omp` TUI（PTY，`pty.rs`） | per-会话长驻 `omp --mode rpc-ui`（`runtime.rs`） |
| 传输 | 字节流进 xterm（Channel 直推） | JSONL 帧 → 事件 `omp-event://<id>`（归一成 ViewMsg） |
| 生命周期 | 关标签才 kill（`SIGHUP → 宽限 → SIGKILL 进程组`） | 归档 / 删除 / 删项目时 kill；应用退出 `runtime::kill_all` |
| 状态标记 | 标签上的 π（OSC 标题解析） | `omp-status://<id>`（后端 pump 推 running / idle / awaiting-approval / exited） |

两张表共享 `AppState`（`runtime` / `running` 字段与 `pty` 并存），互不感知：
同一个目录可以同时开着终端与聊天（omp 层面两个进程，各自读写自己的会话）。

### 3.2 后端（恢复 + 适配）

- `runtime.rs`（V11 的 1075 行整件恢复；改动仅在事件面泛型化，见下）：
  spawn 握手（negotiate v2 / get_state / `set_subagent_subscription=progress`）→ pump
  （stdin 写 + stdout 读、`rpc_chunk` 重组、帧分类 `StateSync/Forward/Swallow` 与 `set_model → 自动最高档` 跟进）→
  `message_end` 用量 / `agent_end` 状态回读（`contextUsage` 只在 get_state 回包里）→
  `kill_all`（应用退出路径）。
  **泛型化**：`spawn_long_lived` 等函数从 `&AppHandle` 改为 `&AppHandle<R: tauri::Runtime>`——
  为真机慢测试用 `tauri::test` 的 mock app 提供 AppHandle（生产侧无行为变化）。
- `context.rs`（V7 的 490 行整件恢复）：`get_context_breakdown`——上下文分项面板的数据源
  （已用 / 窗口 = omp 真值；非消息分项按字符量估算后缩放到 `nonMessageSnapshot` 真值）。
- `commands/mod.rs`：移植 V1–V10 的 RPC 命令面（`create_session` / `open_session` / `send/steer/follow_up` /
  `run_slash` / `compact` / `branch` / `approve` / `respond_ui` / `set_model` / `set_thinking` /
  `get_session_runtime` / `get_history` / `read_image_file` / `check_paths` / `complete_path` /
  `stop_session` / `rename_session_note` / 权限三命令 / `get_git_info`），并做四处**适配**：
  1. `create_session` 从「按 projectId」改为**按 cwd**（左栏是目录行体系；worktree 目录同样能开会话），
     模型 / 思考档仍沿用所属项目在覆盖层里的 `lastModel / lastThinking`；
  2. `list_sessions` / `list_archived_sessions` 增加 `running` 字段（聊天会话的「运行中」标记）与
     「刚建好尚未落盘」的补行（omp 的 jsonl 懒写盘，扫盘扫不到）；
  3. 归档 / 删除 / 移除项目时**先 kill 聊天进程**（`kill_runtime`；删除时进程还在写盘会把文件重新写出来）；
  4. `get_/set_global_approval` 走 `providers::run_omp_in`（cwd 钉 agentDir 读全局层，与设置页同层）。
- 事件通道：`omp-event://<id>` / `omp-status://<id>` / `omp-state://<id>`（`shared/ipc.ts` 的
  `chatEvent/chatStatus/chatRuntime`）。
- `tauri-plugin-notification`（Rust + JS 双端）：V10 的「长任务完成通知」所需；V11 删除过，本期随形态恢复装回。

### 3.3 前端

- **恢复的文件**（V11 删除、本期原样取回并适配）：
  - 组件：`components/thread/`（Thread / TopBar / AssistantText / ToolRow / ApprovalCard / UiRequestCard /
    MentionChips / StatusBar）、`components/composer/`（Composer / ContextBar / ContextMeter / MentionList /
    SlashMenu / UsageLimits）、`components/pickers/`（ModelPicker / ThinkingPicker / PermissionBadge / ProjectPicker / BranchPicker）；
  - 新增装配件：`components/thread/ChatView.tsx`（TopBar + Thread + StatusBar + Composer 的常驻容器，
    事件订阅与完成通知挂这里）、`components/AppModeToggle.tsx`（形态切换两档分段控件）、
    `components/thread/ChatEmptyState.tsx`（聊天侧空态，替代 V10 的 `sidebar/EmptyState`）；
  - lib：`viewmsg` / `mergeEvents` / `useSessionEvents` / `useTaskNotifications` / `sessionOpen` / `slashCommands` /
    `mentions` / `attachments` / `fileKind` / `exportMd` / `openPath` / `toolLine` / `context` / `ctxUsage` /
    `usageLimits`（薄化，见下）/ 各自单测。
- **不恢复的**（被 V11+ 的新实现取代或已死）：
  `favoriteModels`（→ `myModels`，ModelPicker 改读「我的模型」）、`quota.rs`（→ `provider_usage.rs`）、
  `usageLimits` 的拉取部分（→ `providerUsage.ts` 的模块级快照，与「供应商用量」弹窗共用一份数据；
  本模块只留入口侧的纯函数）、`sidebar/Sidebar.tsx` + `sidebar/EmptyState.tsx`（左栏沿用工作区树）、
  `settings/ProvidersPanel.tsx`（→ `ProvidersSection`）、`search.ts` / `sessionList.ts` / `rpc-types.ts`（死代码）、
  `scripts/e2e-rpc.mjs` + `scripts/fake-omp.mjs`（只驱动假 harness 自身、不经过我们的代码；
  RPC 层的真实验证改由 `runtime.rs` 的 `real_rpc_prompt_roundtrip` 慢测试承担，见 §5）。
- **共享文件的合并**：
  - `shared/types.ts`：追加聊天类型（ViewMsg / SessionRuntime / ImageAttachment / AvailableCommand / GitInfo…）；
  - `shared/ipc.ts` / `shared/api.ts`：追加 23 条命令与 3 个事件通道（`e2e:ipc` 自检同步扩到 95 条双向核对）；
  - `stores/app.ts`：追加聊天状态域（`sessions / activeSessionId / eventsBySession / statusBySession / drafts /
    attachmentsBySession / currentModel / currentThinking / currentEfforts / currentRuntime / plansBySession /
    sessionApprovals / composerMenu / threadLimit*`）与 `appMode`;
  - `lib/locale.ts`：从 V1–V10 迁回 357 个聊天文案键（中英同键）+ 4 个新键（形态切换 / 返回聊天 / 聊天空态）。
- **形态切换机制**：`appMode`（`"terminal" | "chat"`，localStorage `omp.appMode.v1`，默认 terminal）。
  `App.tsx` 用 CSS 显隐同时挂载两侧（~~左栏~~ 主区；**二次口径起左栏也随形态切换**，见 §7）；聊天形态下：
  - 设置页（`settingsTabOpen/settingsTabActive` 复用）盖住主区，页内多一个「返回聊天」（`showClose`），
    左栏「设置」按钮在聊天形态是开 / 关切换，`⌘W` 也关设置；
  - 终端快捷键（⌘T / ⌘1..9 / ⌘⇧K / ⌘⇧P）不参与，`⌘T` 改为「新建聊天」（`newChatInSelection`）。
- **跨形态的会话行为**（`lib/checkouts.ts` / `lib/sessionOpen.ts`）：
  - `resumeSessionInApp`：**归档页**的「打开」按当前形态分流（会话弹窗只在终端形态可见，见 §7）；
  - `createChatIn(cwd)`：新建聊天（懒写盘：不跑 turn 不落 jsonl，空转无副作用）。
  - ~~`openOrFocusCheckout`：目录行点击按当前形态分流~~（二次口径起工作区树只在终端形态可见，目录行点击 = 终端语义，见 §7）。
- **消息流修正（相对 V1–V10 的唯一行为改动）**：`message_end(assistant)` 的文本块不再另起随机 id
  新行，而是与流式 deltas 同 id `__append` 补全——真机（18.8.3）会双份渲染，见 §2.2。

### 3.4 数据流（聊天形态）

```
点击目录行 / 会话弹窗 / 空态  → createChatIn(cwd) 或 openSessionWithHistory(id)
open_session → spawn `omp --mode rpc-ui`（握手）→ omp-state://<id>（模型/档位/上下文/命令面）
get_history  → jsonl 原始行 → viewMsgsFromJsonlLines → ViewMsg[]（按 id 去重合并）
Composer 发送 → send_message / run_slash / steer / follow_up（流式中 Enter = follow_up、⌘Enter = steer）
pump 帧流     → omp-event://<id> → frameToViewMsgs + mergeViewMsgs → store.eventsBySession
状态 / 用量   → omp-status://<id> / omp-state://<id> → 状态胶囊、工具行的上下文/用量/耗时
审批          → extension_ui_request(select) → ApprovalCard → approve / respond_ui
```

## 4. 界面口径

- **形态切换键**（左栏顶栏、**原字标位**；二次口径见 §7）：两档分段控件（`Command` = 终端 / `Chat` = 聊天），
  与语言 / 皮肤切换同款视觉（radiogroup + 方向键循环 + 24×26 档位按钮 + `bg-active` 选中底）；
  字标「ompMiniDesktop」退场，右端两枚版本 chip 不动。~~交付时在左栏底部区第一行、右侧跟一行「应用形态」小字标签
  （单独占一行以避开底部 288px 临界）~~。
- 聊天形态左栏（`ChatSidebar`；二次口径，见 §7）：添加项目主入口 → 会话搜索（标题 / 目录过滤）→
  项目分组（进行中会话列表、行首绿点 = 进程在跑、悬浮归档）→「未归属会话」组 → 扫描窗口提示；
  顶栏 / 底栏与终端形态共用（`SidebarTop` / `SidebarBottom`）。
- 聊天形态主区：`TopBar`（会话名可点击改备注 + 复制 Markdown；更新入口不再放这里——那是左栏顶栏两枚 chip 的职责）
  / `Thread`（消息流，首屏 200 条按需加载）/ `Composer`（上下文条 + 附件 + 输入 + 工具行：图片 / 权限 / 模型 / 思考档 / 状态胶囊 / 上下文环 / 发送·停止）。
- 聊天侧空态：无项目 → 与左栏同一份「选择目录」入口；有项目但未打开会话 → 「从左栏选一个会话继续，或点 ＋ 新建」；
  会话已建好但还没有消息 → 「输入第一条消息」。
- 设置页在聊天形态下多一个「返回聊天」（左上），终端形态不变（关闭走标签栏 × / ⌘W）。

## 5. 验收与测试

- `pnpm check`：# typecheck + lint + 477 vitest + e2e:ipc（95 命令双向契约）。
  新增测试：`useSessionEvents.test.ts`（实时管线的文本不双份 / 工具卡合并）、
  `usageLimits.test.ts`（重写为新数据层形状）。
- `cargo test`：210 项（含 runtime.rs / context.rs 的全部单测）。
- `cargo test -- --ignored real_rpc`：**真实 omp 慢测试**（`runtime.rs::real_rpc_tests`）——
  mock app（`tauri::test`）提供 AppHandle，不需要真实窗口；完整走 spawn 握手 → 真实 prompt →
  `message_end` 用量回写 → `agent_end` 后的 `context_usage` 回读，并断言 `omp-event` / `omp-status`
  真的送达监听端。需要本机 omp + 一次真实 AI 调用；可用 `OMP_BIN` 指定二进制。
- 浏览器核对（构建产物 + `__TAURI_INTERNALS__` mock 的真实 Chromium，2026-10-08 实测）：
  终端形态渲染不变 → 切聊天形态（空态）→ 点目录行开会话（create/open/history 全链路）→
  发送 + 注入真实形状的流式帧（text_delta / message_end / agent_end）→ 消息流、状态胶囊
  （运行中 → 就绪）、工具行（模型 / 思考档 / 上下文）全部到位；设置打开有「返回聊天」、
  返回后聊天状态保留（显隐式切换生效）；切回终端形态正常。
- 上游口径复核（§2）：18.8.3 上握手 / prompt 链路 / 帧形状逐条实测。

- **不做**：聊天形态的标签体系（单会话视图，V10 口径）；会话与终端的**运行时绑定**（同一会话在两个形态各开一个进程是允许的
  ——omp 层面互不感知，壳侧不做互斥提示）；聊天形态的工作区协作注入（`--add-dir` / 拓扑 prompt 是终端 spawn 的事，
  RPC 侧不适用）；形态切换快捷键（形态键 + 持久化已覆盖主要场景）。
- **聊天形态的提交入口（2026-10-09 对齐补齐）**：V32 交付时写的是「聊天不做提交 / 推送面板（V19 终端专属）」——
  现已补齐：`CommitTaskPanel` 本来就全局挂载、数据层与形态无关，缺的只是入口。聊天左栏项目分组头
  （`ChatSidebar` 的提交键，走 `openCommitPanel(project.path)`）+ 输入框上方上下文条（`ContextBar` 的
  「提交…」键，cwd = 会话目录）两处入口；面板内的快 / 完整双轨、推送、取消、后台任务徽章口径与终端一致。
  分支切换仍只读（切分支回终端，`BranchPicker` 口径不变）。
- `<cwd>/.omp/config.yml` 等项目级配置对聊天会话同样生效（omp 侧行为，壳侧不干预）。

## 7. 二次口径（2026-10-09）：切换键上移 + 左栏随形态切换（含当日下午的第三轮：工作区分段 / 跨项目引用）

用户口径（截图 + 三点）：
1. 形态切换键放到**原字标位**（红框处），**「ompMiniDesktop」字标退场**；
2. **切换形态时左侧的工作区形态也要跟着切换**（此前两形态共用一套终端形态的工作区树）。

### 7.1 落地形态

| 形态 | 左栏 | 主区 |
|---|---|---|
| `terminal` | `WorkspaceSidebar`（工作区树：快速切换 + 添加项目 + 新建工作区 + 项目 / 目录行） | 标签栏 + PTY 里的 omp TUI |
| `chat` | `ChatSidebar`（**V1–V10 的 Sidebar 骨架恢复并适配**：添加项目主入口 + 会话搜索 + **按工作区分段**（§7.4）+ 项目分组会话列表 +「未归属会话」组 + 扫描窗口提示） | 顶栏 + 消息流 + Composer |

- **共享件**：`components/sidebar/SidebarTop.tsx`（40px 红绿灯占位 + `AppModeToggle` + 右端两枚版本 chip；整行是拖窗区）
  与 `SidebarBottom.tsx`（设置入口 + 语言 + 皮肤）——两形态各渲染一份，几何一致；
  左栏底部回到**一行**（`SIDEBAR_MIN` 的 288px 临界口径不变）。
- **两栏都常驻、只切 CSS 显隐**（`visible` prop）：卸载会丢树的滚动位置 / 列表与搜索词，且每次切形态都要重拉
  `list_projects` + `git worktree list`（终端侧）与重扫会话目录（聊天侧）。聊天侧 **`chatFormUsed` 首次用到才挂载**
  （与 `ChatView` 同一门槛；纯终端用户不付聊天侧的读盘调用）。
- **`ChatSidebar` 的取数与刷新**：数据 = `list_sessions`（**组件局部持有**，不写 `store.sessions`——那一份是聊天视图
  「已知会话」的合并集，窗口外的老会话不该被顶掉）；项目清单用全局 `projects`（空的时候兜底拉一次）。
  刷新时机 = 挂载 / 切到聊天形态（`visible` 上升沿）/ 会话切换后（防抖 400ms——新建会话与 `running` 标记靠它进列表）/
  归档与添加项目后；「继续扫描」按 `SCAN_STEP`（500，上限 5000，与后端 `scan_window` 同口径）递增窗口重拉。
- **聊天左栏的动作**：行点击 = `openSessionWithHistory`（起 / 聚焦长驻 RPC + 拉历史）；项目分组头「＋」=
  `startChatInProject`（在该项目主目录下新建聊天）；行内 / 分组级归档走 `runSessionBatch`（与归档页同一份分批与失败聚合）；
  目录缺失的项目给「重定位」（`relocate_project`，只改覆盖层绑定）；「添加项目」成功后顺手 `loadCheckouts()`——
  两栏常驻，切回终端形态即是最新树。

### 7.2 随之收口的死代码与文案

- `openOrFocusCheckout` 的**聊天分支删除**（工作区树只在终端形态可见，目录行点击回到纯终端语义）；
  `openChatForCheckout` 仍在（`⌘T` 新建聊天的执行侧）。`resumeSessionInApp` 保留——**归档页**在所有形态都能用（设置入口）。
- 聊天侧空态引导语改口径（「从左栏选一个目录」→「从左栏选一个会话，或在项目上点 ＋ 新建」，中英同改）。
- `sessionList.ts` / `search.ts`（V2 M7b 正文搜索）**仍不恢复**：搜索只过滤标题与目录（`search_sessions` 随 V11 删除）。

### 7.3 验证（2026-10-09 实测）

- `pnpm check` 全绿（typecheck + lint + **483** vitest + e2e:ipc 95 命令双向核对）；新增 `App.test.tsx` 用例
  「形态切换：左栏随形态互换」（聊天侧栏懒挂载 + 两栏可见性随 `appMode`）。
- 构建产物 + `__TAURI_INTERNALS__` mock 的真实 Chromium（`init_scripts` 注入 + reload）逐项走通：
  终端形态顶栏 = 切换键 + 两枚 chip（无字标）→ 切聊天形态（DOM 上两栏、可见一份）→
  会话列表按项目分组（含 worktree 归属会话）/ 归档会话不列 / 扫描条「已扫描最近 500 个（共 683 个）」→
  搜索「CI」只剩命中行 + 「1 个标题匹配」→ 项目头 ＋ 走 `create_session` → 列表出现新会话 →
  行内归档走 `archive_sessions` → 行消失 → 切回终端形态（工作区树 + 快速切换回来）→ 再切聊天（列表状态保留）。
- 顺带修掉一个既有对拍缺陷（与本期改动无关、但会挡住 `pnpm check`）：`parity.test.ts` 的正文比对没抹
  **omp 自己的图片标记**——jsonl 里存的是 `[Image #1, 1159x200]`、`omp render --plain` 画的是 `🖼 #1`，
  含粘贴图片的会话必然假阴性（用 HEAD 干净工作树复现过）。现在两边各自抹掉自己的写法再比。

### 7.4 左栏第三轮（2026-10-09 下午）：聊天形态也要看得见「工作区」

用户口径（截图 + 一句）：终端工作区里「工作区 → 多个项目」，而聊天形态的左栏完全没有工作区概念。

- **`ChatSidebar` 按工作区分段**：数据直接用全局 `workspaceGroups` + `projects`（与终端树同一份）；
  排序 = `workspaceGroups` 的顺序 → 段内项目按 `projects` 顺序（= 左栏全局顺序）；
  段头 = `Layers` + 工作区名 + 成员项目数（`wsGroupCount` 的 aria/title）；
  没进组的项目收进「未分组」段（`wsGroupUngrouped`，与终端树同一套措辞）；**没有自定义工作区就平铺**
  （与终端树同一条口径：单项目 / 未分组用户无感）；**空工作区不占段**（聊天这里没有可聊的会话，
  容器的编辑 / 拖拽仍只在终端形态）。搜索时与项目分组同款：命中的段强制展开。
- 取数兜底：项目 / 工作区清单由终端侧栏在启动时拉过（两栏都常驻）；聊天侧只兜「一个项目都没有 /
  有项目但工作区还没拉回来」的冷路径，且**每次挂载只兜一次**（`coldLoaded` ref），不每次切形态都补。
- 测试：`ChatSidebar.test.tsx`（有工作区分段 + 未分组段 / 没有工作区就平铺 / 归档会话不列）。

### 7.5 左栏第三轮：聊天形态的跨项目文件引用（同一只 ⌘⇧P 浮层）

用户口径：「工作区可以包含多个项目，**并且项目间的文件可以选择**」。上游实测（2026-10-09，本机 omp 18.8.6）：

- 先探针确认了链路：`omp --mode rpc-ui` 的 `prompt` 会把 `@<绝对路径>`（**cwd 之外的路径**也算）
  展开成一条 `fileMention` 消息进上下文——模型直接答出文件内容、没有自己调工具；**不需要 `--add-dir`**。
  两个前提：`@` 必须在行首或**紧随空白**（`…是：@/tmp/x` 不展开、`…是： @/tmp/x` 展开，与
  `lib/mentions.ts` / 上游 `extractFileMentions` 同一口径）；文件必须存在。
- 于是聊天侧只剩「挑选」这一步：**复用 V22 的 `ReferencePicker`**，把目标从「终端 id」抽象成
  `RefPickerTarget = { kind: "terminal"; id } | { kind: "chat"; sessionId }`（`store.refPickerTarget`，旧字段
  `refPickerTerminalId` 删除）。cwd（= 解析「当前项目」的依据）从目标来：终端用它的 cwd、聊天用该会话的 cwd。
- 注入分流：终端仍是 bracketed paste 进 PTY（忙碌提示不变）；聊天**追加进该会话的 Composer 草稿**
  （`appendReference`：草稿末尾非空白先补空格 + `@"…"` 引号形式 + 尾随空格），随后
  `composerFocusSeq + 1` → Composer 的 textarea 拿回焦点；草稿里的提及芯片与 `check_paths` 校验照常生效。
- 入口：聊天形态 **⌘⇧P**（与终端同键；设置标签激活 / 没有打开会话时不触发）+ Composer 工具行的
  `Files` 键（原 `AtSign`，2026-10-09 晚换，见 §7.9；图标键，title/aria = 「引用工作区文件（⌘⇧P）：插入其他成员项目的文件路径」）。
- 测试：`workspaceFiles.test.ts` 的 `appendReference`（补空格 / 引号）、`ReferencePicker.test.tsx` 的
  聊天目标用例（追加草稿、不写 PTY、交还焦点、会话没了自收浮层）、`App.test.tsx` 的聊天 ⌘⇧P 用例。
- 浏览器核对（构建产物 + mock 的真实 Chromium）：聊天形态 → 打开会话（cwd = 成员项目 A）→ ⌘⇧P
  浮层只列 B 的 `src/api/client.ts` 等 → 搜 `client` → Enter → 草稿变成
  `@/w/tracsys_web/src/api/client.ts `、浮层关闭、焦点回到 `#composer`、`check_paths` 校验通过。

### 7.6 修复（2026-10-09）：聊天消息列丢了 `overflow` → 输入框上方「文字重叠」

用户实测（截图红框）：输入框正上方糊着一段重叠文字（读起来像「未归属会话」+「思考 · 持续了 0 秒」+「用量」三层叠在一起）。

- **根因**：那不是三层 DOM 叠着，而是**消息列没有 `overflow`、内容直接溢出到输入框那一条**——
  `Thread` 的滚动容器类 `.thread-scroll` 的规则（`overflow-y: scroll` + `overscroll-behavior: contain`）
  在 V11 重写样式时被并进 `.no-scrollbar` 一起删除；**V32 恢复聊天组件时只取回了 TSX、没取回这条 CSS**
  （`git grep thread-scroll` 当时只命中 `Thread.tsx`）。于是：溢出内容被浏览器画在输入框卡片周围
  （卡片不透明，遮住一部分，剩下的露在那一条里 = 用户看到的「重叠」）；`Thread.tsx` 里靠
  `scrollTop`/`clientHeight`/`onScroll` 的**跟随滚动 / 回看增量 / 加载更早 / 切会话读底**全部空转
  （长会话表现为「不滚、只看得到开头」）。
- **修复**：`src/index.css` 恢复 `.thread-scroll { overflow-y: auto; overscroll-behavior: contain; }`
  （滚动条仍交给全 app 的隐藏口径，不再抄 V10 那三条 `::-webkit-scrollbar`）。顺手做了一次全量排查：
  V10 的 `index.css` 选择器 vs 现在——**只有这一条丢了**（`.md-body` / `.no-focus-ring` / `.hljs-*` 都还在）。
- **实测（构建产物 + mock 的真实 Chromium，30 轮会话）**：
  - 修复前（临时 `overflow: visible` 复现）：`overflow-y: visible`、最后一行底边在 4466px（消息列盒子底 707px）、
    输入框那一条能命中消息内容（4 个采样点）；
  - 修复后：`overflow-y: auto`、`scrollHeight 4449 / clientHeight 654`、打开即自动读底 `scrollTop 3795`、
    最后一行底边 671 ≤ 消息列底 707（严格裁切）、输入框那一条 **0** 个消息像素。
- **核对清单增补**（写进 `AGENTS.md` 的界面核对段）：聊天形态的真实 UI 核对必须有「长会话」一档
  （`get_history` ≥ 30 轮），断言 `scrollHeight > clientHeight`、`scrollTop` 能到非 0、
  最后一条消息的底边不越过消息列的底边——**短会话（≤ 一屏）看不出来**，这正是 V32 交付时漏掉它的原因。

### 7.7 修复（2026-10-09）：设置标签激活时设置页被顶到下半屏

用户实测（截图红框）：设置标签打开后，主区上半屏（标签栏之下）是一整片空白，设置页从半屏处才开始。

- **根因**：V32 引入的「终端形态外壳容器」（`appMode === "terminal"` 时包住标签栏 + 终端区的
  `flex` 子列）在设置标签激活时**终端区已 `hidden`、容器里只剩 48px 标签栏**，但容器仍带
  `flex-1`——主区里设置页（`visible` 时也是 `flex-1`）与它对半分高，设置页被压到下半屏。
  旧结构（V11–V31）里标签栏是 `main` 的直接子项（按内容高、不 grow），终端区隐藏后只剩设置页
  一个 `flex-1`，所以不会分；V32 把两者包进同一个 `flex-1` 容器后才出现。
- **修复**（`src/app/App.tsx`）：容器在 `settingsTabActive` 时改 `flex-none`（只按内容占标签栏
  高度），其余时刻仍是 `flex-1`；关闭设置标签后自动恢复满高。
- **实测（mock 的真实 Chromium，768 高视口；`main` 直接子项的几何）**：

| 状态 | 修复前 | 修复后 |
|---|---|---|
| 开设置前 | 容器 h=750（唯一子项） | 同左 |
| 开设置后 | 容器 h=355 + 设置页 `top=364` / `h=395`（对半） | 容器 h=56 + 设置页 `top=65` / `h=694` |
| ⌘W 关设置后 | — | 容器 h=750（唯一子项，满高复原） |
### 7.8 对齐补齐（2026-10-09 下午）：聊天形态与终端形态的对齐

用户口径：「终端形态基本完备，聊天形态还有很多地方未跟终端对齐」——git 提交、跨项目引用、
输入框周围功能、标题生成都要对齐。

| # | 差距 | 修复 |
|---|---|---|
| 1 | 提交 / 推送只有终端目录行有入口，聊天形态完全发起不了（面板与数据层本来就与形态无关，全局挂载） | `ChatSidebar` 项目分组头加提交键（`openCommitPanel(project.path)`）+ `ContextBar` 加「提交…」键（cwd = 会话目录）；分支切换仍只读 |
| 2 | ⌘⇧P 在聊天输入框聚焦时被快捷键守卫吞掉（typing 一律 return），浮层打不开 | 引用键（⌘⇧P）在 typing 时放行，其余终端键仍挡住；`App.test.tsx` 补聚焦态用例 |
| 3 | `title_change` 实时帧直接进未知帧告警；rpc-ui 实测不产标题，聊天会话永久「未命名」 | 前端消费 `title_change` 进 `store.sessions`（有备注不覆盖）+ 首条发送后本地回退（前 12 字）+ 回读 omp 真值；后端 `dispatch` 补 `title_change` 透传 |
| 4 | 聊天左栏无 git 状态表达、会话行标题改名后陈旧、用量弹窗只有终端标签栏有入口 | 分组头加 git 徽章（dirty / 待推送可点 / 落后只读 / 任务态）+ 扫描行与 store 实时视图合并 + 工具行加 Gauge 键（同一弹窗） |

验证：`pnpm check`（523 vitest + e2e:ipc 95）+ `cargo test --locked`（211）全绿。

### 7.9 观感对齐（2026-10-09 晚，用户口径）：左栏组头去箭头 + 引用键不再用 `@`

用户口径两条：①「聊天形态左侧工作区去除展开收起的图标，样式上与终端形态保持一致」；
②「聊天形态引用工作区其他项目文件的图标换一个其他的图标，不要用 @ 符号」。

| # | 位置 | 改动 |
|---|---|---|
| 1 | `ChatSidebar` 工作区段头（`group/ws`） | 去 `ChevronRight`——终端 `WorkspaceGroupSection` 的组头本来就没有折叠箭头（点击整行即展开 / 收起）；`Layers` 从 13px 裸图标换成终端同款 `size-6 bg-surface` 小盒（展开时随 `group-open/ws:` 上强调色）、名字回 13px 并随展开上强调色、成员计数换成同款计数小盒（`h-6 min-w-6 bg-surface font-mono text-[10px]`） |
| 2 | `ChatSidebar` 项目头（`group/proj`） | 同上：去 `ChevronRight`，`Folder` 换 `size-6 bg-surface` 小盒（展开 accent / 目录缺失 warn），与终端 `ProjectGroup` 的项目头同款 |
| 3 | `Composer` 工具行引用键 | `AtSign`（@ 符号）换 `Files`（重叠文件图标）——`@` 与输入框里原生 @提及补全语义太容易混；title / aria 文案不变 |

「未归属会话」段（`group/orphan`）保持原样（仍有折叠箭头）——它不属于「工作区」，终端侧也没有对应物。
展开 / 收起状态仍由原生 `<details>` 的 `open` 属性承载（CSS `group-open/…:` 消费），两处头都不引 JS 状态。

验证：`pnpm check`（**525** vitest + e2e:ipc 95）全绿；构建产物 + `__TAURI_INTERNALS__` mock 的真实
Chromium（1280×820，`omp.appMode.v1 = chat`）实测：聊天左栏两个段头 / 三个项目头（DOM 断言）——
段头与项目头的**第一个子元素都是 `bg-surface` 小盒**（无折叠箭头）、段头 `summary` 里只剩 1 个 svg（Layers）、
整页 `summary` 里 `rotate-90` 箭头 **0 个**；整行点击仍收起 / 展开，且颜色状态正确（展开 = 图标与名字
accent `rgb(165,180,252)`、收起 = 图标 muted `rgb(184,184,184)` / 名字 foreground，与终端组头同款）；
Composer 工具行的引用键渲染 `Files` 图标（svg 首段 `M 8.3333 14.3333 …`，`aria-label` / `title` 不变），
`@` 不再出现；与终端形态左栏对照截图同一套盒语言。

### 7.10 打开会话：先把「已知视图」落进 store（2026-10-09 晚，用户口径）

用户口径：「点击已经存在的会话，输入框上方的项目有时展示不出来」（用户在弹出的定位里确认：就是
`ContextBar` 的项目选择器，与模型选择器无关）。

**根因**：`ContextBar` 的项目选择器读 `store.sessions`（`lib/context.ts` 的 `resolveContext`：只认会话归属，
`projectId` 为 null 就是「未归属」）。旧 `openSessionWithHistory(id)` 只拿 id，而 `open_session` 对**没开过**
的会话要 spawn `omp --mode rpc-ui --resume` 并等握手（实测 1–3 s）才返回 SessionView——选定一刻就已切
`activeSessionId`，但那一行要等返回才补进 store：这段空窗里选择器落到 `t.unassigned`「未归属」（顶栏同时
落「未命名会话」），`open_session` 失败时（catch 静默）就一直错着。触发条件「有时」= 该会话本次运行里
之前有没有打开过（第二次点已经是已知行，不闪）。

**改动**（`lib/sessionOpen.ts`）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `openSessionWithHistory(id, hint?)` | 新增 `SessionHint`（`Pick<SessionView,"id"\|"projectId"\|"title"\|"cwd"> & Partial<SessionView>` = 调用方手上的列表行）与 `hintRow()`（缺的字段给安全默认值：时间用当下、`running` 视为「正要跑」）；**还没这一行时先落进 store**，再切 `activeSessionId` |
| 2 | 同上（open 返回后） | 已有行只收敛后端说了算的四个字段（`running` / `archived` / `projectId` / `cwd`）——**标题仍归 open / `title_change` / 首条回退那几条既有路径**（本地乐观标题不能被「未命名会话」顶掉）；没有行才整行落 `opened`（原口径） |
| 3 | 同上（乱序回包） | 慢 open 的响应晚到时不再把 `activeSessionId` 写回旧会话（也不再把该会话的状态抹成 idle）——只在仍停在该会话时才写；历史落位后的读底同理 |
| 4 | 四个入口 | `ChatSidebar` 会话行（`s`）/ `createChatIn`（`created`）/ `openChatForCheckout`（store 行）/ `resumeSessionInApp`（归档页「打开」，先把 `archived` 按「已恢复」落） |

**实测**（构建产物 + `__TAURI_INTERNALS__` mock 的真实 Chromium；`open_session` 故意慢 3 s）：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 点一个本次运行没打开过的会话，读项目选择器 | 立刻「未归属」、400 ms 后仍「未归属」、3 s 后才变项目名 | 立刻就是项目名 |
| 先点 A（慢 3 s）再点 B（立即返回），3.3 s 后读选择器 | 被抢回 **A** 的项目（选中回退） | 停在 **B** 的项目 |
| 点「未归属会话」组的会话 | 「未归属」 | 「未归属」（该行本来就没有项目，属正确表达） |

回归：`sessionOpen.test.ts` 的「已知视图（hint）：先落地再等 open」两条（慢 open 期间项目 / 目录 / 标题已在；
慢 open 期间切走不抢选中、不抹状态）；`pnpm check` 全绿。

