# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的极简桌面端：把终端里的 agent 会话装进安静的两栏界面。
Tauri v2 + React + TS + Tailwind v4 + Zustand，包管理 pnpm。

## 文档索引

| 文档 | 路径 | 说明 |
|---|---|---|
| 产品冻结稿 | `docs/v1-design.md` | 范围、布局、事件→组件映射、权限、数据接口 |
| RPC 实测备忘 | `docs/rpc-memo.md` | `omp --mode rpc` 握手/流式/审批/切换的实测结论 |
| 功能排期 | `docs/v1-schedule.md` | M0–M4 里程碑与任务明细 |
| 二期排期 | `docs/v2-schedule.md` | M5–M8 里程碑、上游协议事实、完成口径 |
| 三期排期 | `docs/v3-schedule.md` | 供应商页（login / logout / model roles 映射）的实测口径与完成口径 |
| 四期排期 | `docs/v4-schedule.md` | 记忆页（omp 项目记忆的查看 / 删除）的实测口径与完成口径 |
| 设计真相 | `design-system/MASTER.md` | token、布局、交互、组件命名（改 UI 先读） |
| 应用图标 | `design-system/icon/omp-mini-icon.svg` | π 字标矢量唯一源，`pnpm icon` 重新生成 `src-tauri/icons/` |
| 更新日志 | `CHANGELOG.md` | Keep a Changelog 风格，发版时归入新版本节 |
| 第三方声明 | `THIRD-PARTY-NOTICES.md` | 直接依赖清单，增删依赖时同步 |

## 技术基线

- 桌面壳：Tauri v2（`src-tauri/`，identifier `com.omnidesktop.mini`）
- 前端：React 19 + TS + Vite + Tailwind v4 + Zustand（`src/`）
- 后端：Rust + tokio（子进程管理）+ serde/serde_json + tauri-plugin（dialog/opener/store/updater/process，`main.rs` 实注册；`tauri-plugin-shell` 仅在 Cargo 依赖残留，代码未引用）
- 工具链：Node 22 + pnpm 11；Rust stable（已验证 1.97）+ 本地 `@tauri-apps/cli`（`pnpm tauri:*` 走项目本地 CLI，不依赖全局 `cargo-tauri`）
- 上游运行时：`omp` 18.x（已验证 18.1.22），不随仓库分发，用户另行安装

## 源码结构（当前）

```
src/
  app/App.tsx              # 顶层装配 + SidebarShell（拖拽调宽）+ 主题/自检/updater 启动
  components/HealthBanner.tsx  # omp 不可用横幅（与 OmpStatusPill 的常驻位区分）
  components/SettingsPage.tsx  # 设置页外壳（分页签：通用 / 供应商 / 模型 / 记忆 / 已归档对话；通用 = 界面语言中英切换 + omp 诊断区路径/版本/agentDir + 重新检测 + 指定路径 + 复制 + 应用更新）
  components/ArchivedSessions.tsx # 设置 ›「已归档对话」tab：按项目分组列全部归档会话（数据来自 list_archived_sessions，不受左栏扫描窗口限制），分组级/行级「恢复 / 删除」，删除走 ConfirmDialog
  components/ConfirmDialog.tsx # 通用二次确认浮层（受控；跨分组危险操作用它，分组内仍是轻量内联浮层）
  components/sidebar/      # Sidebar（分组会话列表，**只列进行中的会话** + 缺失态重定位）、EmptyState
  components/thread/       # TopBar（标题备注 + 窄窗抽屉入口 + 复制会话为 Markdown + UpdateBell）、Thread（首屏 200 条 + 增量加载 + 行级 memo + PlanCard 计划卡 + command 本地输出）、AssistantText（Markdown + 代码高亮 + 复制 + 流式骨架 + 外链二次确认）、ToolCard（参数摘要可点打开）、ApprovalCard（审批 select，终态展示结论）、UiRequestCard（confirm/input/editor/非审批 select，选项描述）、MentionChips（@文件 芯片排，可点打开）、StatusBar（OmpStatusPill + QueueBadge 排队数 + CompactButton 压缩入口 + RuntimeStats 用量透传）
  components/composer/     # Composer（一体式输入框 + 工具行 + 图片附件：粘贴/拖拽/选文件，发送随 prompt.images；流式中 Enter 排队 + ⌘/Ctrl+Enter 转向 + `/` 命令补全 + `@` 路径补全 + 图文混贴保留文字 + 乐观回显 + 草稿持久化）、ContextBar（输入框上方一行：项目 + git 分支）
  components/pickers/      # ModelPicker、ThinkingPicker、PermissionBadge（挂输入框工具行）；ProjectPicker、BranchPicker（挂 ContextBar）
  components/settings/     # ProvidersPanel（设置 ›「供应商」：omp 登录 / 登出）、ModelsPanel（设置 ›「模型」：常用模型挑选 + 模型角色分配 + 可用模型目录）、MemoryPanel（设置 ›「记忆」：omp 项目记忆清单 + 行内 Markdown 预览 + 单文件删除 / 整目录清空）
  components/update/       # UpdateBell、UpdateDialog（应用内更新）
  lib/                     # viewmsg（ViewMsg 归一 + 单测）、attachments（图片附件校验/base64/内容块提取 + 单测）、mentions（@文件 解析，与 omp 同规则 + 单测）、search（搜索片段高亮 + 单测）、exportMd（会话 → Markdown 只读导出 + 单测）、mergeEvents（实时流按 id 合并 + 单测）、thinking（思考档推导 + 单测）、sessions（分组 + 单测）、sessionList（会话列表刷新 + 扫描窗口的唯一入口）、sessionBatch（批量归档/恢复/删除的唯一实现：BATCH_LIMIT 分批 + 失败聚合 + 删除后清前端痕迹）、context（上下文条取值 + 单测）、favoriteModels（常用模型偏好：localStorage 归一/读写/星标开关 + 单测）、sessionOpen（打开/新建会话的唯一实现，含乐观消息合并）、projects（添加项目 / 切换项目）、ompDiag（omp 自检与手动指定路径）、locale（**全界面**中英字典 + fmt 占位 + localStorage 持久化 + 单测）、useText（组件取文案的唯一入口）、useSessionEvents（事件归一 + 真值回填，含本地命令/计划/压缩重试/子代理/命令面分支）、openPath（路径打开 + 草稿持久化）、useTaskNotifications（后台完成系统通知）、useDropdown、appUpdate、rpc-types
  shared/                  # api（invoke 唯一入口）、ipc（通道常量）、types
  stores/app.ts            # Zustand 全局状态（含 currentModel/currentThinking/currentEfforts/currentRuntime、favoriteModels/setFavoriteModels、composerMenu、sidebarWidth、threadLimit、update、locale/setLocale）
eslint.config.js           # ESLint flat config（typescript-eslint + react-hooks + react-refresh）
src-tauri/src/
  main.rs / lib.rs         # 插件注册（dialog/opener/process/updater/store）+ 命令注册
  commands/mod.rs          # 会话与设置类 Tauri commands（与 src/shared/ipc.ts 一一对应，见 e2e:ipc；含 steer/follow_up/compact/branch/run_slash/complete_path/list_archived_sessions/unarchive_sessions）
  providers.rs             # 供应商页后端（8 个命令）：OAuth 供应商清单 / login·logout（走 `omp auth-broker` CLI，不走 RPC）/ modelRoles 读写（`omp config set`）
  memories.rs              # 记忆页后端（4 个命令）：项目记忆清单 / 读取 / 删除（`<agentDir>/memories/` 按 cwd 编码的目录；目录名解码拿真实文件系统逐级匹配，路径入参一律 safe_path 校验不越界，含单测）
  runtime.rs               # per-会话长驻 omp 子进程 + rpc_chunk 重组 + 事件分发 + 真值回读（omp-state）+ 切模型自动最高档
  overlay.rs               # overlay.json 读写与版本归一（含单测）
  session_scan.rs          # agentDir 解析 + jsonl 头解析 + cwd 归组（含单测）
  git_info.rs              # git 只读查询（当前分支 / 本地分支 / 脏工作区）+ git 路径探测缓存（含单测与真实仓库端到端测试）
scripts/                   # fake-omp.mjs（canned RPC 联调：history|approve|deny|multi|abort|ui 全为分支实现）、e2e-ipc-selfcheck.mjs（IPC 静态契约自检）、e2e-rpc.mjs（fake-omp 驱动的行为级端到端）、generate-icons.mjs（从矢量源重生成桌面图标）
```

## 核心数据流（不许违背）

- 会话真相永远是 `~/.omp/agent/sessions/<slug>/*.jsonl`（`PI_CODING_AGENT_DIR` 可覆盖）；app 只存轻量覆盖层 `$APPDATA/omp-mini/overlay.json`（项目列表/归档/备注/会话级权限）。app 可删可重装，不丢会话。
- 实时输出只走 RPC 事件流，不轮询文件。文件只用于列表与历史回放。
- 后端 per-会话 spawn `omp --mode rpc`，stdout 行解析 → `rpc_chunk` 重组 → `omp-event://<sessionId>`，状态机推 `omp-status://<sessionId>`；运行时真值（模型 / 可用思考档 / 当前档 / 上下文占用 / 本轮用量与耗时）推 `omp-state://<sessionId>`，打开会话时另经 `get_session_runtime` 补拉一次以消除订阅竞态。用量真值来自 `message_end.message.usage`（`duration` / `ttft` 实测就是毫秒，原样透传不换算）；`get_state` 回读时保留用量字段，不许被抹掉。
- `prompt` 的即时 ack 只代表接受，完成信号以 `agent_end(isTerminal !== false)` 为准；流式中 composer 只允许停止（`abort`），不排队。
- 图片附件（V2 M6）：三条入口（粘贴 / 拖拽 / 点回形针选文件）都读成 base64 存内存（`attachmentsBySession`），发送时随 `prompt{message, images:[{type:"image",data,mimeType}]}` 一次性交给 omp——**不落盘、不写覆盖层、不塞草稿**；选文件走后端 `read_image_file`（WebView 拿不到任意本地路径内容）。渲染只认消息内容块里的 `type:"image"`（实时与 jsonl 同构）；单张上限 10MB，历史回放里超过 512KB base64 的块按 `imagesOmitted` 计数省略，不许无上限常驻内存。
- `@文件` 提及（V2 M6b）：**展开动作是 omp 做的**（prompt 时把命中的文件读成 `role:"fileMention"` 消息），壳侧只做两件事——输入框把草稿里的提及显示成芯片并用后端 `check_paths`（只 stat）标出「路径不存在」，转录区把 `fileMention` 渲染成一排文件芯片（跳过项 `skippedReason` 用 warn 色）。解析规则与 omp 的 `extractFileMentions` 逐条对齐（`src/lib/mentions.ts`：引号形式、行首/空白边界、ASCII 首尾修剪）——**规则漂移会让芯片与真正读进上下文的文件对不上**。
- 会话列表扫描是**有窗口的**（V2 M7a）：`list_sessions` 返回 `{sessions, totalFiles, scannedFiles}`，默认只解析最近 500 个 jsonl（后端夹在 1..=5000），前端一律经 `src/lib/sessionList.ts` 的 `loadSessions()` 落库（会话数组 + 扫描统计一起更新，别再各处裸调 `api.listSessions`）；`totalFiles > scannedFiles` 时左栏底部给「继续扫描更早的 500 个」入口。窗口外不是"不存在"，是不解析。
- **归档会话不在左栏**（V2 M11）：左栏项目分组只列进行中的会话，归档的唯一管理面是「设置 › 已归档对话」（`src/components/ArchivedSessions.tsx`）——数据走 `list_archived_sessions`，它**不看扫描窗口**（只按覆盖层 `archived` 标记逐个定位文件，老到 500 个之外的归档也找得到），按项目分组（未归属单独一组）给分组级/行级的「恢复 / 删除」。恢复 = `unarchive_sessions` 摘掉覆盖层标记，会话立刻回到左栏对应项目分组；删除 = `delete_sessions` 真删 jsonl（ConfirmDialog 二次确认）。批量分档与失败聚合的唯一实现在 `src/lib/sessionBatch.ts`（`BATCH_LIMIT` 200），左栏分组头的批量也走它。
- **记忆不在项目仓库里**（V4）：omp 的项目记忆是 `<agentDir>/memories/` 下**按 cwd 一目录一份**（目录名 = `--` + 绝对路径去首斜杠、`/` `\` `:` 换成 `-` + `--`，如 `--Users-me-proj--`；**与 `sessions/` 的目录名不是一套编码**），目录内是 `MEMORY.md` / `memory_summary.md` / `raw_memories.md` / `rollout_summaries/*.md` / `skills/<name>/SKILL.md` / `learned.md`，全由 omp 启动时的后台整理流水线写出（`memory.backend: local` 时才有）。设置 ›「记忆」**只列 / 读 / 删**：`list_memories` 扫目录、`read_memory_file` 读正文（1MB 上限、按字符边界截断）、`delete_memory_file` / `delete_memory_project` 删文件 / 删目录——**没有任何写入路径**（上游没有 `omp memory` CLI，写记忆是 omp 的事）。目录名**不可逆**（路径里的 `-` 与分隔符同形，`a-b/c` 与 `a/b-c` 编码相同），解码只能拿真实文件系统逐级匹配（先少合并后多合并），解不出退回显示编码名；`dir`/`file` 入参一律按不可信输入处理，经 `safe_path` 校验（拒绝对路径 / `..`、canonicalize 后必须在记忆根内）。
- 会话内容搜索（V2 M7b）：后端 `search_sessions` 只搜 `message` 行里 **user / assistant 的 text 块**（工具输出、thinking、JSON 字段名都不进搜索面——否则搜 "user" 会命中每一行），逐行读取、有文件数/字节/墙钟时间/命中数四道预算，任何一道到点都把 `truncated` 置 true（**宁可说"可能不全"，不许假装搜完了**）；前端输入 ≥2 字才搜（单字命中面太大），300ms 防抖，结果行显示标题 + 命中片段（`highlightParts` 高亮全部命中）+ 命中次数 + 归档角标，点击即打开会话（命中的会话可能落在扫描窗口外，`openSessionWithHistory` 会把它补进列表，避免顶栏显示「未命名」）。
- V1 最小命令集：`negotiate_protocol、get_state、prompt、abort、set_model、set_thinking_level` 走 stdin 长驻通道（命令名以 `src/lib/rpc-types.ts` 为准）；`get_available_models、switch_session、get_messages_page、bash（诊断）` 仅在该类型声明中保留，Rust 后端当前未发送。历史回放走后端 `get_history`（直读 jsonl，前 5000 行、最多 2000 条 message/custom 系），不是 `get_messages_page`。
- 切模型发 `set_model{provider, modelId}`（两个字段，非 selector 字符串）；切思考档发 `set_thinking_level{level}`。**omp 切模型后不会修正思考档**（切到无思考模型直接丢档）：后端收到 `set_model` 成功回包即自动跟进 `set_thinking_level`（新模型 `efforts` 最高档，无思考则 `off`），再 `get_state` 回读真值推 `omp-state`；失败也回读以纠正前端乐观态。
- 思考档可用集 = omp 真值 `currentEfforts`（`omp-state` / `get_session_runtime`）∪ `{off}`（`off` 恒合法）；下拉**只列支持档**，禁止列全集再置灰或先发再报错（非法档 omp 静默忽略且回 success）。
- 审批线序：`toolcall_end` → `tool_execution_start` → `extension_ui_request{method:select, options:["Approve","Deny"]}`；通过回 `value:"Approve"`，拒绝回 `cancelled:true`（turn 正常结束，不是中断）。
- 其余 UI 请求（V2 M5）：`confirm` / `input` / `editor` / 非审批 `select` 走 `UiRequestCard`，回包统一经后端 `respond_ui`——`confirm` 回 `{confirmed:bool}`、`input`/`editor`/`select` 回 `{value}`、取消回 `{cancelled:true}`；`notify` 渲染为分隔线，`setStatus`/`setWidget`/`setTitle`/`set_editor_text` 是单向宿主指令（丢弃不告警），服务端 `cancel{targetId}` 撤回对应卡片。**只有这四类方法进 `awaiting-approval` 状态**（单向方法与服务端撤回不许锁 composer）。
- git 上下文**只读**：`get_git_info(path)` 走 git CLI 只读查询（`rev-parse --is-inside-work-tree` / `symbolic-ref --short HEAD` / `for-each-ref refs/heads` / `status --porcelain --untracked-files=no`），不写仓库、不切分支；结果只用于输入框上方上下文条展示。
- **设置 ›「供应商」与「模型」两个页签是全 app 唯一改 omp 状态的地方**（其余页面一律只读 omp：不写配置、不写标题、不写凭证；设置 ›「记忆」只删 omp 的记忆文件，不写任何配置，见下条）：
  - **供应商页签 · login / logout 走 `omp auth-broker` CLI 子进程，不走 RPC `login`**：实测 `omp --mode rpc` 在「一个供应商都没登录」的 agentDir 下**直接退出**（启动时要先解析出可用模型，报 "No models available"）——而那是这个页面最主要的首次使用场景。`auth-broker login|logout` 是纯凭证库操作（`SqliteAuthCredentialStore`），不建会话、不需要模型，任何状态都能跑。解析钉在上游打印顺序（`Open this URL in your browser:` 之后第一行 = 完整授权 URL，其余行原样透传，退出码 0 = 成功）；上游提问行（选端点 / 粘贴 API key）显示给用户并回填 stdin 一行，**输入内容不回显**（可能是 API key）。进度经 `omp-provider://login` 推全量快照，`get_provider_login` 供切走再回来补齐。
  - 「已配置」= 该供应商出现在 omp **当前模型目录**里（有凭证或免钥），**不直读 omp 的凭证库**；这张表只列 OAuth 可登录的供应商，API key 型供应商只在「模型」页签的可用模型里体现。登出走 `ConfirmDialog` 二次确认（删凭证不可撤销）。
  - **模型页签 · modelRoles 写全局配置**：`omp config set modelRoles '<JSON>'` 只接受整表（点路径 `modelRoles.smol` 实测报 `Unknown setting`），所以后端是「读 → 改一个键 → 写回」+ 互斥锁串行化 + **写完回读**；`modelRoleStorage=project` 时界面给 warn 提示（本页读写的是全局角色）。「可用模型」只读，与输入框 `ModelPicker` 共用同一份 `models` store。**「常用模型」是本应用偏好、不写 omp**：localStorage `omp.favoriteModels.v1` 存 selector 数组（`src/lib/favoriteModels.ts`），挑选只决定输入框 `ModelPicker` 列什么，不碰 `modelRoles`、不碰 `create_session` 的模型来源。
- **会话归属只认 cwd，覆盖层不存归属**：`owner_project`（`commands/mod.rs`）是唯一判定入口——真实路径前缀匹配、最长优先、符号链接展开，与左栏 `project_of` 同一条规则；`create_session` / `open_session` / `list_sessions` / 归档清单四处共用。**omp 的 jsonl 是懒写盘的**（首个 turn 才落文件），新建 / 打开的会话读不到文件头 cwd 时，归属退回 spawn 时的 `--cwd`（`owner_cwd` + `RunningChild.cwd`），不许因为「文件还不存在」把刚建好的会话退回「未归属」；`list_sessions` 还要把「runtime 里、磁盘上还没有 jsonl」的活跃会话按 spawn 事实补进列表（`unlanded_views`，否则任何一次刷新都会让刚新建的会话行消失）。

## 前端约定（血泪规则）

- RPC 帧与 jsonl 文件块统一归一为 `ViewMsg`（`src/lib/viewmsg.ts`），历史与实时同一入口合并；未知 `type` 只记日志不崩。
- 实时流的合并只走 `mergeViewMsgs`（`src/lib/mergeEvents.ts`）：`text` 流式按同 id 覆盖，工具卡统一用 `tool:<toolCallId>` 作 id **原位合并**（状态/输出取新值，名称/意图/参数摘要这类只在早期事件里出现的元数据从旧卡继承）。**一次工具调用只许出一张卡**——此前各阶段无脑追加会渲染 2–3 张卡、"输入中"那张永远转圈，并触发 React 重复 key。
- 组件命名以 `design-system/MASTER.md` §8 速查表为准，禁止同义重复组件；`ModelPicker/ThinkingPicker/PermissionBadge` 只挂输入框工具行，顶栏不再重复。
- 工具行 `ModelPicker`/`ThinkingPicker` 触发按钮按内容自适应宽度、**不截断**（`whitespace-nowrap` + `shrink-0`，不设 `max-w-*`）：模型名再长也完整显示，空间不足由工具行 `flex-wrap` 换行兜底。
- 输入框工具行与上方上下文条下拉互斥：`composerMenu: model | thinking | permission | project | branch | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）；下拉统一向上弹。
- 输入框上方上下文条（`ContextBar` = `ProjectPicker` + `BranchPicker`，在输入框卡片**外**上方、与卡片内文字左对齐）：项目名认**会话归属**，`projectId` 为 null 就显示「未归属」，禁止回退 `activeProjectId`（否则会显示成消息在 A 项目里、实际发进未归属目录的会话）；切项目走 `switchProject(id, { newSession: true })`（**在该项目下新建一个对话**并切过去：切换是「换到那个项目干活」，不继承上一个对话的上下文；点当前项目只收下拉、不重复新建），保证「显示的项目 = 消息真正发去的项目」。分支是**只读**控件（只列本地分支 + 刷新，禁止 checkout 或任何 git 写操作），非 git 目录显示「非 Git 目录」而不是无声消失。git 查询走后端 `get_git_info`，找不到 git / 非仓库 / 超时一律降级为 `isRepo:false`——git 出任何问题都不许影响输入与发送。项目名 / 分支名不截断（与工具行选择器同规矩，窄窗口整行 `flex-wrap` 兜底）。
- 状态收敛：标题框外无独立状态条（`StatusBar` 仅保留读屏播报位）；状态统一进输入框工具行——`OmpStatusPill`（常驻，就绪也占位显示「就绪」）+ `RuntimeStats`（上下文占用 / 本轮 token / 耗时 / TTFT，全部来自 `omp-state` 真值，**无真值整块不渲染**，前端只做格式化不自算）。
- 助手正文渲染走 `AssistantText`（`react-markdown` + `remark-gfm` + `rehype-highlight`）：**不许 `dangerouslySetInnerHTML`**（正文按不可信输入处理）；代码高亮配色只写在 `src/index.css`（项目 token 派生，深浅色自动跟随），不引第三方主题 CSS；代码块横滚不撑破布局，流式中未闭合围栏给 skeleton。
- 消息流首屏增量：默认只渲染最后 `THREAD_PAGE`（200）条（`stores/app.ts` 的 `threadLimit`，按会话重置），向上滚动或点按钮按页展开，加载后保持视口位置；不许一次性 map 全部消息（MASTER §7）。
- 消息行必须 `memo`（V2 M8 实测结论）：`Thread.tsx` 的 `ThreadRow` 是 `React.memo` 组件，前提是 `mergeViewMsgs` 对**未变化的消息保持同一对象引用**（有单测守着）。真实数据（8.1MB / 1411 块 → 698 条 ViewMsg，归一 2ms）证明瓶颈在渲染不在数据层，所以**不做虚拟列表**；复评阈值见 `docs/v2-schedule.md` M8（>5000 条 / >30MB / 明显掉帧）。测规模用 `OMP_BENCH=1 pnpm test src/lib/historyScale.test.ts`（默认跳过）。
- 会话行单行 `● 标题 … 时间/操作`：右侧 68px 固定槽位，时间与操作按钮互斥（hover 时时间 `visibility` 藏、按钮绝对覆盖淡入），行高锁定，悬浮零跳动；删除二次确认用浮层，不撑布局。
- 会话行不设复选框：不做多选、不做「已选 N」批量工具条；批量归档/删除只挂在分组头——项目分组头三个入口 = 归档全部对话 / 删除全部对话 / 删除工作区（后两者各自走分组内浮层二次确认；删除工作区只解绑目录、名下会话全部归档保留），「未归属会话」分组头 = 归档全部 / 删除全部对话。**这些批量只覆盖进行中的会话**（左栏已不列归档），批量走 `src/lib/sessionBatch.ts`（`BATCH_LIMIT` 200 分批 + 失败聚合），归档会话的管理（恢复 / 删除）在设置页。
- 左侧栏可拖拽调宽 220–480px（默认 264，`sidebarWidth` 持久化 localStorage）；窄窗 <768px 收抽屉。
- 导出是**只读**动作（V2 M9）：`TopBar` 的「复制会话为 Markdown」把界面上已渲染的 `ViewMsg` 经 `src/lib/exportMd.ts` 拼成 Markdown 写进剪贴板——不读盘、不落盘、不加后端命令；工具输出沿用界面口径截断并在截断处明写「已截断」，图片只写张数（不内联 base64）。消息级复制走行内 `CopyAction`（自带 copied 状态，**不许把状态提到 `ThreadRow` 上**，否则破坏 M8 的行级 memo）。
- 界面文案一律走字典（`src/lib/locale.ts` 的 `TEXT`）：组件内 `useText()`（`src/lib/useText.ts`）、非组件模块 `TEXT[useApp.getState().locale]`；插值用 `fmt(t.key, v1, v2)`（模板占位统一 `{0}`/`{1}`），**禁止硬编码界面文案**（含 `aria-label` / `title` / `placeholder` / 错误提示）。**上游数据不进字典**：会话标题、工具名/意图/输出、omp 的 UI 请求文案、后端错误一律原样透传。数据层生成的展示文本（分隔线标签、工具卡占位、导出 Markdown、附件校验）取**当归一 / 当次调用**时的语言——切语言后已渲染的旧消息要重开会话（重新归一）才会换。切语言只改本应用展示层（`omp.locale.v1` 走 localStorage），不写 omp 配置、不写覆盖层。
- 四个禁止：不轮询文件做伪实时；前端不自算 token（状态与用量一律透传 `omp-state` 真值）；不写回 omp 标题（改名只写覆盖层 `notes`，禁用 `set_session_name`）；设置页不改 omp 配置（语言只切本应用展示、走 localStorage 持久化；诊断区只读 + 「指定 omp 路径」只写应用覆盖层 `ompPath`，更新区除外）——**唯一例外是设置 ›「供应商」与「模型」两个页签**：用户在那里显式点「登录 / 登出 / 分配角色」，写的就是 omp 的凭证库与 `config.yml`（见「核心数据流」的供应商条目）。记忆页不在例外之列：它只删 `memories/` 下的文件、不写任何 omp 配置（写记忆是 omp 自己的事，壳侧没有写入口）。
- 设置页的「供应商」与「模型」两个页签（`src/components/settings/`，共五个页签：通用 / 供应商 / 模型 / 记忆 / 已归档对话）：**供应商**（`ProvidersPanel`：omp OAuth 供应商清单 + 「已配置 / 未配置」+ 登录 / 登出）与**模型**（`ModelsPanel`：常用模型挑选 → 模型角色分配 → 可用模型目录）。登录卡固定在供应商列表**上方**（列表二十多条，放尾部等于「点了没反应」）并自动滚入视野；角色选择器是**行内展开**而非浮层（设置页是可滚动容器，浮层会被裁掉），候选模型与输入框 `ModelPicker` **共用同一份 `models` store**（同一次刷新两处同步）；「可用模型」按供应商分组折叠，只读。登出走 `ConfirmDialog`。**这两个页签是全 app 唯一改 omp 状态的地方**（凭证库 + `config.yml`），其余页面一律只读；「记忆」页签（`MemoryPanel`）只列 / 读 / 删 omp 的项目记忆（删除走 `ConfirmDialog`），没有写入路径。
- `MemoryPanel`（`src/components/settings/MemoryPanel.tsx`）= 「设置 › 记忆」页签内容：标题行（`Notebook` 图标 + 「记忆」+ 项目计数 + 「刷新」）→ 一行口径说明（映射 `~/.omp/agent/memories`、omp 自动生成、本应用不写、删除不可撤销且下次整理可能重新生成）→ 按项目分组（组头 = 折叠箭头 + 项目名 + mono 路径或「原项目路径已不存在」warn 行 + 文件数与总大小 + 「清空记忆」，走 `ConfirmDialog`）+ 文件行（相对路径 + 分类标签 + 大小 + 日期 + 「删除」；分类与置顶顺序由后端给：`MEMORY.md` / `memory_summary.md` / `learned.md` / `raw_memories.md` 置顶，其余按路径序）。点文件行**行内展开** Markdown 预览（懒加载、一次只展开一个、删除后清缓存）——**不开浮层**：设置页是可滚动容器，浮层会被裁掉。
- **常用模型只决定输入框选择器列什么，不写 omp**：设置 ›「模型」的「常用模型」区块从「可用模型」目录用星标（`Star`，Outline/Filled 表示未选/已选）挑选，`ModelPicker` 下拉**只列挑过的模型**（按挑选顺序、仍按供应商分组）。**空下拉是禁止的**：常用为空**或**已挑模型在当前 omp 模型目录里全部不可用 → 回退为全部可用模型，并在下拉顶部加一行说明（`pickerAllModelsHint`）；设置页对目录里找不到的常用项照列不误并标「已不可用」（给人清理）。「可用模型」标题行下方有**过滤框**（按 `provider/id` + 名称），过滤态下命中组自动全部展开、组头退化为静态行（不许点了没反应）、标题行改显匹配数、零命中给「无匹配模型」——111 个模型不靠人肉展开找。偏好存 localStorage `omp.favoriteModels.v1`，唯一数据层是 `src/lib/favoriteModels.ts`（`loadFavorites`/`saveFavorites`/`toggleFavorite`/`favoriteEntries`，坏数据一律丢弃、去重保序）；**不回写 `modelRoles`、不写覆盖层、不改 `create_session` 的模型来源**。会话内切换行为不变（仍 RPC `set_model` → 后端跟进思考档 → `get_state` 回读）。`ModelPicker` 触发按钮文案**只按目录查 `currentModel`**，查不到显示「模型」——不许回退成目录里的第一个模型（会显示一个并不生效的模型名）。

## 常用命令

```bash
pnpm install
pnpm tauri:dev              # 桌面壳联调
pnpm dev                    # 纯前端
pnpm check                  # 提交前全过：typecheck + lint + test + e2e:ipc + e2e:rpc
pnpm typecheck              # tsc --noEmit
pnpm lint                   # eslint（flat config，0 警告）
pnpm test                   # vitest
pnpm e2e:ipc                # 前后端命令/通道/ViewMsg 静态契约自检
pnpm e2e:rpc                # fake-omp 驱动的行为级端到端（握手/审批双分支/多工具/中断）
pnpm build                  # tsc + vite 构建
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build            # 本机发布构建，产物见 src-tauri/target/release/bundle/
pnpm icon                   # 从 design-system/icon/omp-mini-icon.svg 重生成桌面图标
```

联调无需真实 LLM：`OMP_FAKE_SCENARIO=approve|deny|history|multi|abort|ui|mentions node scripts/fake-omp.mjs`（canned RPC 事件，覆盖审批双分支、多工具并行、流式中断、通用 UI 请求全方法与 @文件 提及）。

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包并生成 `latest.json` 供应用内 updater 拉取。
- updater 需签名校验：`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 当前为 TODO 占位；正式发版前用 `pnpm tauri signer generate` 生成密钥对，公钥填配置、私钥全文进仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`（见 README「应用内更新」节）。
- 升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 Unreleased 条目归入新版本节并写明日期）。

## 范围边界（V1 不做 / 二期已排）

自动化/定时任务、插件/Skill/MCP/Hook 管理、主题市场、云同步、多窗口协作、终端 PTY 仿真、diff 合并编辑器、用量统计面板（只透传 omp 给的单轮用量与上下文占用，不做聚合/报表/成本分析）——这些仍在范围外，要做得单独决策。
二期（V2）已排的是 V1 文档里显式留下的坑 + 上游已给的能力：M5 通用 UI 请求、M6 图片与 `@文件`、M7 扫描分页与内容搜索、M8 长会话渲染复议（结论：不做虚拟列表，改行级 memo）、M9 复制与导出——**全部完成**；M9 的「重发」「导出 .md 文件」两项是需要先定交互/涉及落盘的候选，开工前先问。明细与实测数据见 `docs/v2-schedule.md`。
三期（V3，已完成）**供应商页与模型页**：设置 ›「供应商」把 omp 的 `login` / `logout` 映射进界面；设置 ›「模型」把 `model roles`（9 个内置角色 + 自定义角色的模型分配）与可用模型目录映射进界面。这两个页签是全 app 唯一改 omp 凭证库与 `config.yml` 的地方，且必须如此——登录 / 登出本质就是写 omp 的凭证、角色分配本质就是写 omp 的配置。明细见 `docs/v3-schedule.md`。
四期（V4，已完成）**记忆页**：设置 ›「记忆」把 omp 的项目记忆映射进界面——按项目列出 `<agentDir>/memories/` 下的记忆目录，可查看（行内 Markdown 预览）、可删除（单文件 / 整目录清空）。**上游没有 `omp memory` CLI，记忆由 omp 自己的后台整理流水线写出，壳侧只列 / 读 / 删、从不写**（「设置页不写 omp」的口径不破：删除是文件系统操作，不碰配置与凭证）。明细见 `docs/v4-schedule.md`。**编辑 / 新增记忆、触发重新整理仍不做**（需先定边界）。

## 命名与变更约定

- 对外名称：ompMiniDesktop；仓库/包名：`ompMiniDesktop` / `omp-mini-desktop`；标识符、文件名：英文；界面文案、注释、文档、提交说明：中文。
- 架构级变更（创建/删除/移动文件或目录、核心数据流变更）必须同步更新本文档、`docs/` 与 `design-system/MASTER.md`。
- 增删前后端依赖时同步 `THIRD-PARTY-NOTICES.md`；密钥、Token、私钥、签名证书、个人路径一律不得进仓库。
