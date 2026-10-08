# ompMiniDesktop 三十二期（V32）：双形态——终端工作区 ⇄ 聊天界面

> 基线：V1–V31 已交付（见 `CHANGELOG.md`）。本文是**形态扩展**的设计与实现记录：
> app 在「终端工作区」（V11 起的现行形态）与「聊天界面」（V1–V10 的形态，恢复）之间切换。
> 上游实测口径注明版本与日期；未实测的结论一律标注。
> 参考产品：用户口径里的「codex / zcode 形态」= V1–V10 的聊天界面（消息流 + 审批卡 + 输入框）。

## 0. 一句话

**同一个 app、两种形态，左栏共用（工作区 → 项目 → 目录行），主区互换**：
终端形态 = 标签栏 + PTY 里的 omp TUI；聊天形态 = 顶栏 + 消息流 + Composer（RPC 里的 omp 会话）。
切换入口在左栏底部行（`AppModeToggle`，持久化 `omp.appMode.v1`）；**两侧运行中的进程都不中断**。

## 1. 用户口径与决策（2026-10-08）

| 决策点 | 选择 | 落地口径 |
|---|---|---|
| 切换粒度 | **全局切换** | 整个 app 在两种形态间整体切换（左栏共享，主区互换），同一时间只有一种形态 |
| 聊天形态的左栏 | **沿用当前工作区树** | 不恢复 V10 的独立 Sidebar；聊天入口接进现有左栏（目录行点击 / 项目会话弹窗 / 归档页） |
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
  `App.tsx` 用 CSS 显隐同时挂载两侧；聊天形态下：
  - 设置页（`settingsTabOpen/settingsTabActive` 复用）盖住主区，页内多一个「返回聊天」（`showClose`），
    左栏「设置」按钮在聊天形态是开 / 关切换，`⌘W` 也关设置；
  - 终端快捷键（⌘T / ⌘1..9 / ⌘⇧K / ⌘⇧P）不参与，`⌘T` 改为「新建聊天」（`newChatInSelection`）。
- **跨形态的会话行为**（`lib/checkouts.ts` / `lib/sessionOpen.ts`）：
  - `resumeSessionInApp`：会话弹窗与归档页的「打开」按当前形态分流；
  - `openOrFocusCheckout`：目录行点击按当前形态分流；
  - `createChatIn(cwd)`：新建聊天（懒写盘：不跑 turn 不落 jsonl，空转无副作用）。
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

- **形态切换键**（左栏底部区第一行）：两档分段控件（`Command` = 终端 / `Chat` = 聊天），
  与语言 / 皮肤切换同款视觉（radiogroup + 方向键循环 + 24×26 档位按钮 + `bg-active` 选中底）；
  右侧跟一行 `应用形态` 小字标签。**不挤底部那行**——「设置 / 语言 / 皮肤」的最小宽度（288px 临界）
  是既有的硬约束，形态切换单独占一行。
- 聊天形态主区：`TopBar`（会话名可点击改备注 + 复制 Markdown；更新入口不再放这里——那是左栏字标行两枚 chip 的职责）
  / `Thread`（消息流，首屏 200 条按需加载）/ `Composer`（上下文条 + 附件 + 输入 + 工具行：图片 / 权限 / 模型 / 思考档 / 状态胶囊 / 上下文环 / 发送·停止）。
- 聊天侧空态：无项目 → 与左栏同一份「选择目录」入口；有项目但未打开会话 → 「从左栏选目录 / 会话开始」；
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

## 6. 边界与未做

- **不做**：聊天形态的标签体系（单会话视图，V10 口径）；会话与终端的**运行时绑定**（同一会话在两个形态各开一个进程是允许的
  ——omp 层面互不感知，壳侧不做互斥提示）；聊天形态的工作区协作注入（`--add-dir` / 拓扑 prompt 是终端 spawn 的事，
  RPC 侧不适用）；聊天形态的提交 / 推送面板（V19 是终端形态专属）；形态切换快捷键（底部键 + 持久化已覆盖主要场景）。
- **沿用 V1–V10 的旧边界**：审批语义（once/always/deny）、思考档前端过滤、`/plan` `/goal` 等 TUI-only 命令在聊天里不出现。
- `<cwd>/.omp/config.yml` 等项目级配置对聊天会话同样生效（omp 侧行为，壳侧不干预）。
