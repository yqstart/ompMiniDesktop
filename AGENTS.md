# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的桌面端：**聊天形态的 omp 工作台**（Tauri v2 + React 19 + TS + Tailwind v4 + Zustand，包管理 pnpm）。

> 改代码前先读 `docs/roadmap.md`（版本规划）与对应版本排期。

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/roadmap.md` | 版本规划总纲（首个版本 0.1.0 = 形态收敛 + 聊天对标 + 设置重构；0.2.0 = 右栏工作台 + 会话读数 + omp 约束）|
| `docs/v1-schedule.md` | 排期 1：终端形态删除清单 / 迁移清单 / 验收（**已实施**，2026-10-14）|
| `docs/v2-schedule.md` | 排期 2：布局 / 流式 / 聊天框对标 Codex、ZCode |
| `docs/v3-schedule.md` | 排期 3：设置重构（功能保留、形态重做）|
| `docs/v4-schedule.md` | 排期 4：右栏工作台——文件目录 + 项目脚本 + 多开终端（**已实施**）|
| `docs/v5-schedule.md` | 排期 5：会话读数——输入卡底部统计条（会话统计 / Token 用量 / 上下文 / 供应商用量）（**已实施**）|
| `docs/v6-schedule.md` | 排期 6：设置 ›「omp 约束」——全局 AGENTS.md / RULES.md / rules/*.md 的可视化编辑（**已实施**）|
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
  components/workbench/      # 右栏工作台（V42 / V43 / V44）：WorkbenchPanel（停靠 + 文件/脚本/终端三页签 + 宽度拖拽 + 终端标签行）/ FileTree（只读目录树 + 快速过滤 + 变更标色 + 引用注入）/ FileIcon（Material 类型图标）/ ScriptsPanel（项目脚本识别 + 自定义脚本）/ TerminalPane（xterm.js + PTY 管道，一实例一终端）
  components/thread/         # 消息列：ChatView / TopBar / Thread / AssistantText / ToolRow / ToolRunRow / TurnRow / ApprovalCard / UiRequestCard / ChatEmptyState / PlanCard（任务清单浮卡）/ FindBar / BtwPanel / SessionStatsBar（卡底统计条）/ ContextMeter / SessionStatsDialog / DiffDialog…
  components/composer/       # 输入卡（v2）：Composer（卡顶行项目/分支 + 提交键 → 卡底工具行：`+`/执行模式/压缩/模型/思考档/发送 → 卡底统计条：SessionStatsBar = 会话统计/Token 用量/上下文/供应商用量）/ CommitButton / ApprovalModeMenu / ModelMenu / ThinkingMenu / PlusMenu / GoalRow / MentionList / SlashMenu / UsageLimits
  components/pickers/        # 选择器：ProjectPicker / BranchPicker（内嵌输入卡顶行；分支清单点选即切）
  components/settings/       # GeneralSettingsPanel / ConstraintsPanel（omp 约束：全局 AGENTS.md / RULES.md / rules/*.md 的可视化编辑）/ ModelsPanel / PluginsPanel / SkillsPanel / ProvidersSection（供应商：登录型 + 自定义）/ CustomProviderEditForm（只配供应商字段）/ CustomProviderModelsDialog（自定义端点的模型清单：获取可用模型 + 勾选 + 调参）/ ProviderModelsDialog（登录型的星标挑选）/ MemoryPanel / UsagePanel / SettingsSearch（v3 顶部搜索）/ Highlight（命中高亮）…
  components/usage/ update/ git/   # 供应商用量 / 更新弹窗 / 提交面板
  components/SettingsPage.tsx / ReferencePicker.tsx / HealthBanner.tsx …
  lib/                       # viewmsg / mergeEvents / threadLayout / termTheme（终端配色）/ useSessionEvents / sessionOpen / streamReveal / mdBlocks / streamCaret / usePopoverAnchor（卡内浮层锚到被点的项）/ useGitInfo / localNote / promptHistory / useVisibleRefresh（设置页焦点回读）/ btw / checkouts / workspaceGroups / projectDrag / useElapsed / useText / locale / theme / platform / settingsTabs / settingsSearch / useSettingsSearchSources / …
  shared/                    # api（invoke 唯一入口）/ ipc（命令与事件常量唯一清单）/ types
  stores/app.ts              # Zustand 全局状态（会话 / 消息流 / 队列 / 未读标 / 右栏开关 / 引用浮层 / 设置视图 / 更新 / 提交任务 / 工作区）
src-tauri/src/
  runtime.rs                 # 会话的 RPC 运行时（spawn 握手 → pump → kill_all；事件面泛型）
  pty.rs                     # 右栏终端：PTY 里的登录 shell（spawn / write / resize / kill / kill_all，输出走 Channel）
  proc.rs                    # 进程与环境工具（登录 shell PATH 探测 / 进程组强杀；runtime / pty / git_commit / commit_msg / omp_update 复用）
  commands/mod.rs            # RPC 命令面 + 项目 / 工作区 / 会话 / git 命令
  context.rs session_scan.rs overlay.rs git_info.rs git_commit.rs git_ops.rs project_files.rs workspace_fs.rs project_scripts.rs
  plugins.rs skills.rs settings.rs themes.rs models_config.rs constraints.rs title_prompt.rs omp_update.rs
  providers.rs memories.rs usage.rs provider_usage.rs extra_usage.rs provider_models.rs live_stats.rs   # usage.rs = 使用统计（jsonl 聚合 + 壳侧账本）；live_stats.rs = 单会话累计统计（卡底统计条）；provider_models.rs = 端点模型探测（「获取可用模型」）
scripts/                     # e2e-ipc-selfcheck / generate-icons / generate-material-icons（文件树图标子集）/ changelog-notes / fixup-latest-json / make-signing-cert / tauri-build
```

## 核心数据流（不许违背）

- **聊天会话 = per-会话长驻 `omp --mode rpc-ui` 进程**（`runtime.rs`）：握手（negotiate / get_state / 子代理订阅 / ask 对话框开关）→ pump（stdin 写、stdout 读、`rpc_chunk` 重组、帧分类）。事件三通道 **`omp-event/status/state://<sid>` 用会话 id 命名**。kill 走 `kill_runtime`；应用退出 `kill_all`。
- **会话身份 = 完整 uuid**（jsonl 文件名里的 uuid）：**任何定位 / `--resume` 都不许退回 8 字符前缀**（uuid v7 前 8 位同一分钟内必然相同，会读错历史 / 删错文件 / resume 到别的会话并顶掉它正在跑的进程）。`session_file_for` 只认完整 id。
- **open-elsewhere = omp 的保护性 fork**：打开一个已被**其他进程**持有的会话时，omp 会把本次打开分到**新身份**（新 jsonl、`parentSession` 指向原会话、标题继承；日志 `Session moved to a new file / reason: open-elsewhere`）——列表里因此会出现两个同名会话（原会话 + 副本），常见触发是两个壳实例（安装版 + dev）同时打开同一会话。**壳侧口径：以 spawn 返回的真实 sid 为准**——`spawn_session_runtime` 身份漂移分支（`sid != 请求 id` 时按新身份的文件读头返回；`send_prompt` 自动恢复同口径），前端 `openSessionWithHistory` 全程用 `opened.id`（激活 / 历史 / 导航栈 / 发消息），漂移时补一条说明分隔行——不许用请求 id 继续（会错位到原会话并反复拉起新进程）。
- **新建会话的启动参数（`create_session`）**：项目里记的 `last_model` / `last_thinking` 只是**偏好**，不许让它把「新建会话」整条路堵死——omp 对不存在的 `--model` / 非法 `--thinking` 是**直接退出**（实测 `Error: Model "…" not found`，stdout 一帧都没有，壳只看到 EOF）。三层口径（用户实测的坑，2026-10-16 修）：① omp 的 stderr 由 `StderrBuf` 采集并接进错误（`spawn_long_lived` 失败路径统一 `with_stderr_reason`，`stderr_first_line` 只脱壳加的那一层括号）——「进程意外退出」这类错误必须自带原因；② 首发被拒 → 去掉这两个参数**降级重试**一次（omp 用默认档），成功即按 `Plan::Degraded` 清掉项目里那对失效偏好（不自愈的话每次新建都白失败一次），并把 `FallbackNotice` 随回包返回；前端在会话流尾落一条本地说明行（`appendLocalNote`），不许静默换模型；③ 降级后 omp 仍没拿到模型（问题不在偏好上）→ 如实说明，**不动用户的项目偏好**。resume 路径不带这两个参数，故不受影响。
- **发送语义**：idle = Enter 发送（`/` 开头先查壳本地命令）；running = **Enter 插话（steer）/ Tab 排队（follow_up）/ Esc 中断并交还队列**（`abort_and_restore_queue`）。队列 = omp 真值（`queue_update` 帧落 `store.queuedBySession`，`applyQueue` 唯一写入面；行可撤回 / 编辑 / 提升）。
- **输入框 = Lexical 草稿编辑器（2026-10-17，形态照 DeepSeek Harness 的 composer）**：`components/composer/draft/` 三个文件——`DraftEditor.tsx`（Lexical plain-text：读写句柄、capture 阶段把键盘 / 粘贴转给 Composer、`DraftTextSource` 来源标记）、`ReferenceChipNode.ts`（`DecoratorNode`：携带 `{path,label,isDir}`，`getTextContent()` = `@真路径`（目录补尾斜杠），`isKeyboardSelectable() = false`）、`ReferenceChip.tsx`（图标 + 短标签的视觉本体）。**草稿恒定一个段落**，换行是 LineBreakNode——Lexical 不把段落分隔写进 `getTextContent()`，而「按段落自己拼换行」会撞上它的规范化中间态（实测段落数指数增长直到 OOM）。Store 里的草稿是**编辑器的投影**：`sync` 来源（store → 编辑器）**不回写**（否则迟到的投影通知会覆盖更新的草稿，例如发送失败的回滚），`insert`（壳插引用 / `#N` 占位 / 粘贴转文件）回写但不打断历史浏览，`user` 回写并退出历史浏览。外部往草稿插引用走 `store.pendingReference` 通道（编辑器非受控，改草稿文本插不出芯片）。
- **输入框 `@` 提及口径（2026-10-17，两轮用户口径）**：输入框里写的是**短标签**，进上下文的是**真路径**。
  - **写入的是短标签**（`@components/`、`@FileTree.tsx`）——**最短唯一后缀**：`workspace_fs.rs` 的 `unique_labels(all, targets)` 段数从 1 增长，取第一个全库唯一的后缀，都不唯一就退完整相对路径（绝不产生歧义标签）；条目表 `entries_for(root)` 全量遍历一次（跳依赖目录、带预算、30s 缓存）。来源：右栏文件树 / 快速过滤的「引用到输入框」走 `mention_label(base, path)`（前端串行队列，连点也不乱序）；`@` 补全的候选自带 `label`（`PathCandidate.label`）。会话目录之外（⌘⇧P 跨项目引用）仍写绝对路径——该浮层里**文件与文件夹都能引用**（目录行尾 hover 的链接键，或 ↑↓ 停在目录行后 Enter；`flattenRefTree` 的行序号含目录行、默认落点是第一条文件行），投 `isDir: true` 后芯片序列化补尾斜杠（`@/abs/dir/`），omp 的 `fileMention` 对目录给条目清单。目录开合口径：**浏览态默认折叠**（打开只铺顶层，点着往下展开；用户点过的记成「与默认相反的例外」，见 `dirCollapsed`），**搜索态默认展开**（命中的深层文件必须可见），查询一变例外即作废。
  - **取词**在后端 `complete_path`（纯逻辑 `complete_candidates`）：**空 token / 带目录**（`@`、`@components/`）列那一层——目录名是短标签时先按后缀反解出真目录再列，候选仍按用户写的前缀展示（「选中短标签后继续往里打」是连贯的）；**有名字、没写目录**（`@baselin`）递归搜名字（`search_entries`：忽略大小写、名字包含、浅层与前缀命中优先）。浮层三态**必须可见**（`MentionList.status`）：搜索中 / 没有匹配 / 候选——**不许无声消失**。Esc 关掉后继续打字重新打开（`mentionDismissed`，与 `/` 命令面同口径）。
  - **选中候选分两种动作**（2026-10-17 用户实测「进不了文件夹」后定稿）：**目录 = 下钻**——把光标前的 `@token` 换成一段**路径文本** `@<短标签>/`（`replaceMentionWithText`，光标停在其后），浮层立刻接着列这一层（想引用整个目录就直接发送这段文本，语义与 omp 的 `@dir/` 一致）；**文件 = 引用芯片**（`replaceMention`，显示短标签、序列化真路径、尾随一个空格收口）。**目录不能插成芯片**：原子节点挡住后续输入，用户就打不出下一段路径了。
  - **取词会接上紧邻的芯片**（`$textBeforeCaret` 从光标往前凑、`$mentionRange` 按字符数找回 `@`）：右栏注入的目录芯片（`@dist/`）后面接着打 `app` 时 token 是 `@dist/app`，补全能继续往下钻。`$mentionRange` 构造的是**跨节点选区**——起点落在芯片上时用「父元素 + 子索引」的 element point（decorator 不能做 text point），整段一次删掉再插入，避免"选中文件静默失败"。
  - **解析**（`check_paths` → `PathCheck.resolved`）：直接解析（相对 / 绝对）→ **短标签后缀唯一反解**（真路径回填 `resolved`）→ 都不行记不存在。**歧义一律不猜**（两个 `index.ts` → `@index.ts` 就是「不存在 + 警告」）。**展示只保留正文这一种**（2026-10-17 用户口径：别又排 tag 又显路径）——引用不单独排芯片行；完整路径在**输入框的悬停提示**（`title` 逐行 `@标签 → 真路径`）与补全候选里；只有 `exists === false` 的引用才在输入框上方给一行警告（`mentionsMissingHint` + 解析不到的写法原文）。
  - **发送前还原**（`Composer.expandMentions` → `lib/mentions.ts` 的 `rewriteMentions`）：**只对手打的纯文本短标签**——芯片（`ReferenceChipNode`）序列化出来已经是真路径，`check_paths` 直接解析命中、不改写。`send` / `sendQueued`（steer / followUp）三条路都过一遍（目录写法保留尾斜杠；解不出来就按原文发，芯片此前已用警告色说明）。**回显 / prompt 历史 / 发送失败回滚都用原文**（用户看到的是自己写/插的样子）；队列消息「编辑」退回草稿时反向缩短（`shortenMentions` → `mention_label`）。完整路径两个入口：**芯片自身的悬停提示**（`title` = 真路径）与**输入框整体的悬停提示**（逐行 `@标签 → 真路径`）。
- **执行模式（权限档）真值**：输入卡上的档位 = **本会话生效档**（覆盖层 `sessionApproval` 优先，否则 omp `tools.approvalMode`）；两个来源都不许「兜底成某一档」——没读到就显示「读取中…」。写入只走 `lib/sessionApproval.ts`：菜单选择 = 写 omp 全局默认（新会话档位）+ 本会话覆盖（idle 重启 runtime 立即生效 / running 挂起到本轮结束），Shift+Tab 循环只动本会话覆盖；启动时 `loadApprovalState()` 水合覆盖层 + 全局档（`get_overlay` 的 wire 是覆盖层文件格式 snake_case，别按 camelCase 猜）。
- **思考档默认口径**（2026-10-14 拆分模型 / 思考档两个选择器）：默认档 = omp 配置的 `defaultThinkingLevel`（`get_default_thinking_level` → `omp config get`；前端单飞读在 `lib/thinkingDefault.ts`、后端在 `settings::read_default_thinking_level`）。实测（18.10.3 rpc-ui）：切模型时 omp **保留仍然合法的档位**、切到无思考模型直接丢档且切回不恢复——所以壳侧只在「档位缺失 / 对新模型非法」时落默认档（`runtime.rs` 的 `auto_think_level` 夹到该模型支持集；不覆盖用户已选的有效档），前端显示与乐观更新镜像同一口径（`lib/thinking.ts` 的 `clampThinking` / `resolveThinking`），真值经 `omp-state://` 回读收敛。模型目录行**必须带供应商**（同名模型来自 ark.cn / ccproxy / commandcode 多家，只给名字分不出来）。
- **供应商用量入口口径**（卡底统计条的最后一项，2026-10-16 从工具行搬下来）：看**全部已配置供应商**的限额窗口，与当前会话的模型**无关**——条上**只有图标**（2026-10-16 修订用户口径：读数 / 窗口名 / 「+N」都不再上条，只在悬停提示与浮层里；配色档由最紧的窗口定：`entryGlance`），点开才是内容（浮层按上游顺序列全部窗口 + 「配了但没探针」的供应商）；只有「一次都没拿到数据且最近一次查询失败」才置灰（`lib/usageLimits.ts` 的 `usageEntryDisabled`，不许再按 `currentModel` 的供应商过滤或置灰）。窗口**读数**口径唯一（`lib/providerUsage.ts` 的 `limitReading`，弹窗与浮层共用）：有比例才画条 + 百分比、余额型给「$X 剩余」、计数型给数量原文——percent 缺省 0 不是读数，拿它显示就是编造「0.0%」。
- **卡底统计条（会话读数，2026-10-16）**：输入卡**内部底部**一行四项、**整条靠右**（`justify-end`）——**会话统计**（`N 轮 M 步 · X tok/s`，点开：模型用时 / 工具调用用时 / 首发平均 TTFT / 输出速度 TPS）、**Token 用量**（`X tok · 缓存命中 P%`，点开：缓存命中 / 未缓存输入 / 缓存读取 / 输出 的分项与千分位总计）、**上下文占用**（容量环，点开分项）、**供应商用量**（只有图标 + 档位配色，点开全部窗口）——形态参照 DeepSeek Harness 的 composer dock（上游逆向口径：轮 = 有过步的轮、步 = 每次模型调用、模型用时 = Σ`duration`、工具用时 = 按调用逐个配对求和、TTFT = 按步算术平均、**TPS = 输出 token ÷ 解码墙钟（`duration` − `ttft`，不含首 token 等待）**、缓存命中 = `cacheRead ÷（未缓存输入 + 缓存读 + 缓存写）`、总计 = 三桶输入 + 输出）。**数据只由后端 `live_stats.rs` 扫该会话 jsonl 聚合**（派生指标后端算好、按 mtime+size 缓存），前端 `lib/sessionLiveStats.ts` 只做按会话快照 + 格式化（`fmtSpan` / `fmtTps` / `fmtHitRate`）。**收敛**：omp 不推这类投影——打开拉一次、**运行中每 3s** 回读、终态翻转再拉一次；2 秒节流 + 单飞 + 失败保留旧值；归档 / 删除走 `forgetSession` 一并清缓存。**门槛与 DH 同**：整条在四项都没内容时不渲染（不占版面），会话统计项要求步数 > 0、Token 项要求计费输入或输出非 0。**不许**把它做成第二个 `/status` 弹窗入口（`/status` 仍是独立模态，数据源是 omp 的 `get_session_stats`）。**四项浮层的包含块 = 整条统计条**（`relative` 挂在条根、按钮包装器不许带定位；浮层 `absolute right-0 bottom-full … max-w-full`，**水平位置由 `lib/usePopoverAnchor` 实测锚到被点的项**——居中于按钮再夹在条内，只写 style 不走 state，无布局环境退回 CSS 的 `right-0`）——相对按钮定位的宽浮层会在统计条换行时向左溢出输入卡、被中列的 `overflow-hidden` 裁掉，而贴条缘又会离靠左的项（会话统计 / Token 用量）很远（用户实测两条并存，口径见 MASTER §4.7）。
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
- **三栏布局（v2；右栏 V42 改造）**：左栏（`SidebarShell` + `ChatSidebar`）/ 中列（`ChatView`）/ 右栏**工作台**（`WorkbenchPanel`，装配在 `App` 主区内、`ChatView` 之侧）。右栏开关 = `store.workbenchOpen`（持久化、**默认收起**，⌘⇧G）；打开即停靠为第三栏（布局变三栏，会话列让位、不遮盖）。**右栏宽度可拖**（`store.workbenchWidth`：260–640、默认 320、持久化；手柄在左缘，另受「给中列留 420px」的窗口约束，窗口变窄自动收回超限值）。**右栏 = 文件 / 脚本 / 终端三个页签**（`store.workbenchTab`，持久化），面板**常驻挂载、只切显隐**（收起 / 切页签 / 切设置视图都不卸载：终端进程与 xterm 回看缓冲、文件树的展开位置都不丢）。
- **右栏工作台（V42 / V43）**：目标目录 = 当前会话 cwd（`lib/context.ts` 的 `resolveContext`），会话切换即跟着切。**文件页签** = 只读目录树（`workbench/FileTree.tsx`）：懒加载一层（`list_dir`，`withRepoRoot` 只在树根传）、目录优先 + 名称升序、每目录分片 200 条、单层超 2000 条截断；**类型图标 = Material Icon Theme**（`workbench/FileIcon.tsx` + `lib/fileIcons.ts`，资产由 `scripts/generate-material-icons.mjs` 从 devDependency `material-icon-theme` 裁剪生成到 `lib/materialIcons.generated.ts`；完整文件名 → 多段扩展名 → 扩展名 → 默认 `file`/`folder`，目录带展开态；只用于文件树与 ⌘⇧P 引用浮层的类型识别，是「单一 accent」的有意例外）；**顶部快速过滤** = 输入即搜（防抖 180ms → `search_paths`，后端 `workspace_fs.rs` **只读**递归搜名字 / 带 `/` 的相对路径，跳依赖与缓存目录、深度 24 / 扫描 20 万条 / 命中 800 三重预算），**文件与文件夹都出**，点结果 = 清空过滤 + 在树里逐级展开定位（1.6s 高亮）；未提交改动拿一次 `get_change_set`，按「仓库根 + 相对路径」换算成绝对路径打徽标（`M/A/D/R·C/?`）；点文件用系统默认程序打开，行尾 hover 出「引用到输入框」（与 `⌘⇧P` 引用浮层同一条投递口径：`mention_label` 取短标签 → `store.pendingReference` → Composer 插成引用芯片）与「在访达中显示」。「引用到输入框」写的是**短标签**（`@components/`、`@FileTree.tsx`——最短唯一后缀，见「输入框 `@` 提及口径」），完整相对路径在**输入框的悬停提示**里。**不许**变成编辑器：只读、不写文件、不预览内容。**脚本页签** = 项目脚本（`workbench/ScriptsPanel.tsx` + `project_scripts.rs` 的 `discover_scripts`）：后端**只读**扫清单文件给出候选命令——`package.json` 的 scripts（包管理器由锁文件 / `packageManager` 定）、`Cargo.toml`（固定五条 + `.cargo` 的 `[alias]`）、`go.mod`、`manage.py` / `pyproject.toml` 的 scripts 段、`Makefile` / `justfile` / `Taskfile`；解析全是**行扫描**（不为几个清单文件引 TOML / YAML 依赖，认不出的写法就是没有，不猜）。**自定义脚本** = 本应用偏好（`store.customScripts` 按 cwd 分组、localStorage `omp.scripts.v1`，**不写用户仓库**）。执行口径：点脚本 → `runInTerminal(cwd, command, title)` **新开一个终端**（标签名 = 脚本名）、展开右栏、切到终端页签、落 `store.pendingTerminalRun{terminalId}`，由**那个** `TerminalPane` 在首帧输出后（shell 起来、提示符出来）写进 PTY，1.5s 超时兜底（`flushPendingRun` 用 `consumedRunRef` 挡重复）——脚本面板不自己起进程；连点几条脚本就是几个终端，各跑各的。**终端页签** = **多开**的 PTY 登录 shell（`pty.rs` + `workbench/TerminalPane.tsx`）：`terminal_spawn` 建 PTY、输出走 Tauri Channel、`terminal_write` / `terminal_resize` / `terminal_kill` 三路寻址。实例表 = `store.terminals`（`{id, cwd, title}` + `activeTerminalId`）：页签内一条**标签行**（切换 / 新建 / 关闭，横向滚动、标签名截断），上限 6、超出淘汰最旧的**非活跃**项（组件卸载即 kill）；终端在创建时定格 cwd，**不随会话切换改目录、也不被会话切换杀掉**（切会话只影响「新建终端用哪个目录」）；高频字节流只进 xterm，**不进 store**；应用退出走 `pty::kill_all`。**不许**再引入终端形态的会话模型（π 标题 / 目录行 / 标签栏 / 覆盖层注入）。
- **消息列布局（v2）**：`lib/threadLayout.ts` 的 `buildThreadLayout(shown, running)` 是渲染前的唯一布局派生——相邻同类工具行聚合成摘要行（命令批 / 编辑卡 / 任务清单批——`todo` 工具行连成一段折成「更新了 N 次任务清单」，清单的当前状态看消息列底部浮卡），每轮末尾追加轮时长行（`user.at` → 该轮最后一条消息的 `at`；running 时跳过流尾轮）。`ViewMsg.at` 来源：历史 = jsonl 行的 `timestamp`（`lib/viewmsg.ts` 的 `lineAtOf`），实时 = 帧到达时刻（`useSessionEvents` 统一打戳）。聚合/时长只在布局层做，不改 `mergeViewMsgs` 的合并口径。
- **左栏未读完成标（v2）**：后台会话的**一轮起止**只有 `list_sessions` 快照看得到——`running` 字段 = **任务在跑**（进程表活动态派生，见「状态收敛」），`ChatSidebar.reload` 对比上一份快照，`running → 非 running` 且不在前台 → `store.markUnread`；打开会话（SessionRow 点击）`clearUnread`。运行期状态，不持久化。
- **删除 / 归档的列表缓存同步**：左栏的 `mergedSessions` 把 `store.sessions` 当真相覆盖，并把「扫描结果里没有的行」补回列表（服务的是刚新建、还没落盘的会话）——所以删除 / 归档 / 恢复**必须在 `runSessionBatch` 里同步这些行**（删除 = 丢行 + 清激活；归档 / 恢复 = 只改归档位）。漏掉这一步的后果（用户实测）：后端删掉 jsonl、下一次刷新扫不到它，缓存里那一行又被补回来（还被顶到组首），看着像「点删除以后又冒出一个会话」；归档同理——缓存里过期的 `archived: false` 会把扫描回传的 `archived: true` 顶掉，归档过的会话继续留在「进行中」。归档 / 恢复 / 删除都只走这一条实现（原命令面 ⌘K 的那枚动作已随功能删除，2026-10-19），不许各写一份「归档完清什么」。
- **左栏冷启动水合（2026-10-16 用户实测的坑）**：`projects` / `checkouts` / `workspaceGroups` 都是内存态，重启后为空的补齐**只有左栏挂载这一趟**（`ChatSidebar` 的 `coldLoaded`，目录行 + 工作区清单走 `loadCheckouts` 一次拉齐）——条件必须**各自独立**（谁的清单为空补谁），不许拿旁证当门：老实现把工作区清单挂在「已经有项目」下，冷启动时 `projects` 还是空的 → 那一趟整个跳过，项目拉回来了、工作区永远是空，左栏把建好的工作区渲染成平铺（`sections === null` 的平铺分支），看着像「重启后工作区丢了」（后端 `overlay.json` 数据完好，别去查后端）。同理 `loadCheckouts` 里两份数据**各落各的**（`allSettled`）：目录行要跑 `git worktree list`，它失败不许把工作区清单一起拖没（合并成败的后果就是上面那个平铺），目录行自己的失败照旧抛给调用方。
- **标题**：omp 对 `--mode rpc-ui` 强制关闭自动标题——壳侧两层补：pump 在首条用户消息帧（`message_start` role=user 等）一到就注入一次 `/rename`（`/` 开头在 omp 侧先过命令门、早于 streaming 判定，`/rename` 无参数走后台执行：运行中注入不插话、不排队、不阻塞——标题在任务跑完前就有），spawn 时（resume 旧会话）与每次终态 `agent_end`（失败兜底重试）各再看一眼，每进程至多成功一次 → `session_info_update` 帧回灌；后端扫描 `first_user_text` 派生显示标题兜底。标题语言随壳界面语言（`TITLE_SYSTEM.md`，用户自写文件不覆盖）。**标题显示口径**：omp 18.8.7+ 的标题卡（上游 `utils/title-card.ts`，`title.icons` 默认 `nf+emoji`）会在生成 / `/rename` 时把标题写成 `${icon} ${code}: ${title}`（实测 `󰜘 COMMIT: 提交推送后仍有修改标识`；图标是私有区码位，壳里没有覆盖私有区的字体，WebKit 会回退成 Apple Symbols 的杂物字形，U+F084D 画成 6 根横条），**显示层一律去掉开头这整段前缀（图标 + 大写短码）**（`lib/sessionTitle.ts` 的 `sessionTitleForDisplay`，侧栏行 / 删除确认 / 顶栏 / 归档页 / 设置搜索 / **改名输入框回显**同一口径；没有图标的裸 `HGT: ` 不是卡、不剥），数据保持原样（jsonl 标题、导出仍带前缀）。**改名交互**（顶栏点标题就地改名）：Enter 或**点输入框外**提交、Esc 取消，改过才写 omp 真名（原样提交 = 不写）——「点输入框外」走 document `pointerdown`，不用 blur（WKWebView 里点非聚焦元素不搬焦点）；同一次点击里 pointerdown 提交后 blur 的补发由一次性结算挡住。
- **内存治理**：每 60s 一轮闲置回收（idle 30 分钟且已落盘 → kill；重新打开 / 发消息自动 resume）；`eventsBySession` 只留最近 3 个会话（切会话时触发 LRU 裁剪）；工具全量输出封顶 100K 字符。
- **模型目录**（`omp models --json`，2–10s）：单飞 + 5 分钟缓存 + 过期后台刷新（`omp-models://catalog` 广播）；`omp config list --json` 一次读全部配置键。
- **使用统计（`usage.rs`）= omp 会话记录 ∪ 壳侧账本**：只扫 jsonl 的话**删掉会话，那部分用量就从统计里消失**，所以壳侧另记一份账本——每条 assistant `message_end`（`runtime.rs`，`totalTokens > 0` 才记）把那一轮 usage 追加进 `app_data_dir/omp-mini/usage-ledger.jsonl`（**只追加、不改写**，键已记过即跳过；`UsageLedger` 懒加载，首次记账才建目录 / 开文件 / 重建去重集合）。
  - **去重键唯一口径 = `usage.rs` 的 `usage_key`**：`sid|responseId` 优先，`responseId` 缺失（失败 / 重试调用）退回 `sid|时间戳|四段用量`；jsonl 解析与账本记录共用这一处，口径不一致就会重复计数。实测同一轮在实时帧与 jsonl 里的 `responseId` / `message.timestamp` / `usage` **完全一致**（探针：`rid=e4445cd1… ts=1792128700867 total=4260` 两边同值），**两路都有时以 jsonl 为准**（jsonl 先扫、先占键；账本随后扫，去重剩下的就是「jsonl 里已经没有的」）。两路都不看对方的状态，只认这一个全局键——**不许**再加时间窗口 / 「会话文件在不在」之类的额外判据（试过：老会话后来追加过消息时按 mtime 判会误杀，按数据时间窗判要么重复要么漏）。
  - 派生指标（命中率 / 活跃天数 / 连续天数 / 热力图）与 jsonl 同一条口径：账本事件同样进活跃日与热力图；返回的 `extras` = 只由账本补上、jsonl 里已经没有的条数（**仅数据面**——2026-10-19 用户口径：设置页不再拿它写来源说明行，界面只留读数）。账本读不完（超预算）与 jsonl 预算一样置 `truncated`，不假装统计完了。
  - 记账失败（磁盘满 / 权限）只影响「已删除会话的补记」，**不许拖累会话线程**；本应用只读 omp，账本写在自己的应用数据目录里。
- **设置写入口径**：omp 侧只经 `omp` CLI（`config set/reset`、`auth-broker`…）；**直接写文件的例外**：`models.yml`（hash 乐观锁 + 预校验 + 备份 + 原子写）与「omp 约束」的 `AGENTS.md` / `RULES.md` / `rules/*.md`（同款乐观锁 + 备份 + 原子写；上游没有写这些文件的 CLI）。本应用偏好不写 omp 配置。
- **omp 约束（设置 ›「omp 约束」，2026-10-19）**：可视化编辑 omp 的**全局**约束与规则文件——只碰 `<agentDir>` 下三处：`AGENTS.md`（native 用户级上下文文件，每次会话启动注入）、`RULES.md`（sticky 规则，始终 always-apply、每轮重挂）、`rules/*.{md,mdc}`（独立规则，文件名即规则名，`enabled: false` 停用）；项目级 `.omp/` 由 omp 自己发现，本页不碰。
  - **数据面**（`constraints.rs`）：`get_omp_constraints`（固定两份文件 + rules/ 列表，一次读全）/ `write_omp_constraint`（`expectHash` 乐观锁 → 备份到 `<appData>/omp-mini/backups/constraints/` → 原子写 → 回读）/ `create_omp_rule` / `delete_omp_rule`（先备份再删）。文件名白名单：`rules/` 下单层 `.md` / `.mdc`、不以 `.` 开头、无路径分隔符 / 控制字符 / Windows 非法字符；内容上限 2 MiB；规则 frontmatter 必须有结束行。`expectHash = ""` 表示「打开时文件不存在」——外部创建了也算冲突；`null` = 冲突对话框里的显式强制覆盖。
  - **编辑面**（`lib/constraints.ts`，`yaml` 的 `Document` API）：规则拆成 frontmatter 字段 + 正文——表单只改已知字段（description / enabled / alwaysApply / globs / condition / astCondition / question / scope / agents / interruptMode），**值没变的字段不重写**（尽量保住注释与写法），不认识的顶层字段原样保留；另有「源码」模式直接编辑整份 Markdown。保存前本地校验（大小 / NUL / YAML 可解析），失败不发请求。草稿在模块级缓存里跨设置页签 / 设置视图保留，「重新加载」才丢弃。
  - **生效**：omp 在会话启动 / `/clear` / `/new` 时重新发现规则与上下文文件，界面只说「新建的会话一定读到」；已打开会话是否热读未实测。
  - **设置搜索**：`constraints` 是独立数据源（条目名 / 文件名 / 路径 / 规则描述），命中跳转用 `focusKey = kind:name` 选中对应文件。
- **自定义供应商：供应商配置 与 模型清单 拆开（2026-10-17 用户口径）**：`CustomProviderEditForm` 只配 名称 / 接口地址 / 接口类型 / API Key（**不再内嵌模型编辑区**）；模型清单一律在**已配置的供应商行**上点「挑选模型」管——自定义端点走 `CustomProviderModelsDialog`（「获取可用模型」→ 候选勾选 → 逐项调参 → 保存），登录型仍是 omp 目录里的星标挑选（`ProviderModelsDialog`）。数据层两个写入面**各写各的、互不覆盖**：`customModels.ts` 的 `upsertProvider`（供应商级字段，**不碰 `models` 节点**）与 `setProviderModels`（模型清单，逐条复用原节点保真改，**空清单删掉 `models` 键**）。
  - **探测走壳侧**（`provider_models.rs` 的 `fetch_provider_models`，只读、不落盘）：口径对齐 DeepSeek Harness 的 `discoverModels`——只认三档 wire API（`openai-completions` / `openai-responses` / `anthropic-messages`，其余不猜，猜错会把鉴权失败报成「供应商没有模型」）；OpenAI 系 `GET {接口地址 去尾斜杠}/models`（**按前缀拼、不自动补 `/v1`**，保住 `/openai/v1` 这类部署路径）、Anthropic `GET {去掉末尾一个 /v1 的根}/v1/models?limit=1000`（只读一页，不跟 `has_more`）；认证 Anthropic 用 `x-api-key` + `anthropic-version: 2023-06-01`、其余 `Bearer`、**没填 key 就不带认证头**；解析 `data[]` 优先、其次 `models`（对象按 map，键名优先于条目 `id`），容量字段多别名兜底（`contextWindow` / `context_length` / `max_input_tokens` / `max_model_len`、`maxOutputTokens` / `max_completion_tokens`…），坏行跳过、缺名回退 id。**DSH 链路里没有超时**（UI 不传 signal、host 不加 AbortSignal），壳侧自加 20s 超时；响应体上限 4 MiB，**超限报错不截断**（截断的清单不可解析）。
  - **apiKey 三种写法**（omp 18.11 实测，探测与 omp 同口径）：`!命令` 执行取 stdout、裸名字**先当环境变量名查**（命中用其值）、其余按字面量；`${VAR}` 不展开。密钥只在本进程内用，不落盘、不进日志、不回传前端。
  - **omp 侧实测事实**（写入形状的依据）：没有 `models` 的自定义块**被 omp 接受**（`omp models --json` 退出码 0、stderr 空，只是该供应商不出现在目录里）——所以「先存供应商、后挑模型」成立；模型条目只给 `id`（或 `id`+`name`）时 omp 用默认值（上下文 128000 / 最大输出 16384 / 非推理 / 纯文本）；`models: []` 同样合法（界面仍选删键，文件更干净）；`models` 静态列表与 provider 级 `discovery` 共存时目录取并集（壳侧本轮未用 `discovery`——勾选即启用是用户口径，全靠静态 `models` 表达）。
- **设置视图（v3 设置重构）**：`SettingsPage` 覆盖主区（`store.settingsTabOpen/settingsTabActive`；打开 = 左栏「设置」/ `⌘,`，关闭 = 顶部返回 / `⌘W` / 再点一次）——顶部条（返回 + 当前条目名 + 搜索钮）+ 左导航**四组八条目**（通用 / 模型 / 扩展 / 数据；通用组 = 常用设置 + omp 约束；窄窗 44px 图标档，容器查询）+ 内容区唯一滚动。搜索 = `store.settingsSearchOpen`（`⌘F`），数据源走 `lib/settingsSearch.ts`（模块级缓存 + 懒加载，设置视图卸载即清；参数 = 常用设置目录 / omp 约束 / 模型目录 / 插件 / 技能 / 记忆 / 归档），四档打分复用 `filterCatalog`；结果点击经 `navigateTo` 跳条目，常用设置项与约束文件带 `SettingsFocusRequest{key,seq}` 定位（通用页展开分组 → 滚动到行 → 一次闪烁；约束页选中文件；seq 防重放、消费后回调清空）。
- **提交 / 推送**：两轨（快速 = 一次 `omp -p` 生成信息 + `git commit/push`；完整 = `omp commit`）；按 cwd 建任务表（并行 + BUSY + 取消 + 超时）；入口 = **卡顶行提交键**（V42 起右栏「变更」区块随上下文面板退场，这里是唯一入口；同一浮层链路、同一状态口径：运行中转圈 / 失败红点）+ 左栏任务徽章。**提交键的可用性 = 有没有东西可提交或推送**（2026-10-17）：判定取 `store.workspaceGitStates[cwd]`——**与提交面板同源**（完整 `git status --porcelain -b`，含未跟踪新文件；提交走 `add -A`，口径一致），工作区干净且 `ahead === 0` 才置灰禁用（提示「没有可提交或推送的改动」），有改动则键尾一个 warn 圆点；**快照未知（还没回来）不置灰**（不把真实改动挡在门外，真裁决在后端预检）；任务在跑 / 失败一律可点（要能看进度与错误）。改动状态要**跟得上**：会话 `running → idle` 翻转那一下（= agent 刚写完文件）就重读本会话目录的快照（`scheduleWorkspaceGitRefresh`，2s 防抖 + 合并，只刷该目录；重复 idle 帧不触发），别等下一轮 30s 兜底轮询。
- **卡顶行 git 区（分支切换）**：`BranchPicker` 展开清单**点分支即切**（后端 `switch_branch` = `git switch <branch>`，只认分支、不会被同名路径抢语义）——脏工作区交给 git 裁决（带得走就带着走，冲突整条拒绝、错误原文就地显示，壳侧不 stash / 不 force）；切换成功走 `refreshWorkspaceGitState([cwd])`——它是 **git 状态的统一刷新入口**（刷新时机 = 启动 / 焦点 / 30s 轮询 / **会话一轮收敛到 idle** / 提交任务结束 / 分支切换），每次刷新自增 store 的 `gitInfoSeq`，`useGitInfo` 的全部挂载实例（输入卡顶行）一起重读、ahead/behind 快照同步刷新。只读查询仍是 `get_git_info`（4s 超时、降级不报错），写命令用 30s 超时。
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
pnpm icon                   # 从 design-system/icon/omp-mini-icon.svg 重生成应用图标
pnpm file-icons             # 从 material-icon-theme 重新生成右栏文件树的图标子集
```

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包 + `latest.json`；仓库必须 public（updater 匿名拉取）；`fixup` job 把资产链接改写为公开直链。
- 更新说明取 `CHANGELOG.md` 版本节（`scripts/changelog-notes.mjs`），版本节缺失会挡发版——**发版前先写 CHANGELOG**。
- macOS 签名用自签证书（`scripts/make-signing-cert.sh`；TCC 授权持久化）；CI 用 secrets `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`。
- 升版本号：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`（+ `Cargo.lock`）四处同步。

## 范围边界

- **做**：聊天唯一形态（v1 已实施）、Codex / ZCode 对标（v2 已实施）、设置重构（v3 已实施）、**右栏工作台**——文件目录 + 项目脚本 + 多开终端（V42 / V43 / V44 已实施，口径见 `docs/v4-schedule.md`）、**会话读数**——输入卡底部统计条（排期 5 已实施，口径见 `docs/v5-schedule.md`）、**omp 约束**——全局 `AGENTS.md` / `RULES.md` / `rules/*.md` 的可视化编辑（0.2.0 / 排期 6 已实施，口径见 `docs/v6-schedule.md`）。
- **不做**：编辑器（文件只读浏览，打开交给系统默认程序；**omp 约束页只编辑 omp 的全局约束 / 规则 Markdown，不是通用文件编辑器**）/ 内置浏览器 / SSH / 移动端 / PR 集成；分屏 / 多窗口；worktree 生命周期管理；云同步 / 定时任务。
- 终端**只作为右栏工作台的页签**存在：同一页签内允许多开（标签行切换，V44 用户口径），但不许长出终端形态的会话模型（π 标题解析 / 目录行 / 覆盖层注入 / 独立窗口 / 任意分屏）；也不许把文件树升级成编辑器或全屏工作区（`docs/v1-schedule.md` §1 的删除清单仍然有效，`docs/v4-schedule.md` 是唯一例外口）。
