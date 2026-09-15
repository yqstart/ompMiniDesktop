# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的极简桌面端：把终端里的 agent 会话装进安静的两栏界面。
Tauri v2 + React + TS + Tailwind v4 + Zustand，包管理 pnpm。

## 文档索引

| 文档 | 路径 | 说明 |
|---|---|---|
| 产品冻结稿 | `docs/v1-design.md` | 范围、布局、事件→组件映射、权限、数据接口 |
| RPC 实测备忘 | `docs/rpc-memo.md` | `omp --mode rpc` 握手/流式/审批/切换的实测结论 |
| 功能排期 | `docs/v1-schedule.md` | M0–M4 里程碑与任务明细 |
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
  components/SettingsPage.tsx  # 设置占位页（omp 诊断区：路径/版本/agentDir + 重新检测 + 指定路径 + 复制）
  components/sidebar/      # Sidebar（分组会话列表 + 缺失态重定位）、EmptyState
  components/thread/       # TopBar（标题备注 + 窄窗抽屉入口 + UpdateBell）、Thread（首屏 200 条 + 增量加载）、AssistantText（Markdown + 代码高亮 + 复制 + 流式骨架）、ToolCard、ApprovalCard、StatusBar（OmpStatusPill + RuntimeStats 用量透传）
  components/composer/     # Composer（一体式输入框 + 工具行）、ContextBar（输入框上方一行：项目 + git 分支）
  components/pickers/      # ModelPicker、ThinkingPicker、PermissionBadge（挂输入框工具行）；ProjectPicker、BranchPicker（挂 ContextBar）
  components/update/       # UpdateBell、UpdateDialog（应用内更新）
  lib/                     # viewmsg（ViewMsg 归一 + 单测）、mergeEvents（实时流按 id 合并 + 单测）、thinking（思考档推导 + 单测）、sessions（分组 + 单测）、context（上下文条取值 + 单测）、sessionOpen（打开/新建会话的唯一实现）、projects（添加项目 / 切换项目）、ompDiag（omp 自检与手动指定路径）、useSessionEvents（事件归一 + 真值回填）、useDropdown、appUpdate、rpc-types
  shared/                  # api（invoke 唯一入口）、ipc（通道常量）、types
  stores/app.ts            # Zustand 全局状态（含 currentModel/currentThinking/currentEfforts/currentRuntime、composerMenu、sidebarWidth、threadLimit、update）
eslint.config.js           # ESLint flat config（typescript-eslint + react-hooks + react-refresh）
src-tauri/src/
  main.rs / lib.rs         # 插件注册（dialog/opener/process/updater/store）
  commands/mod.rs          # 30 个 Tauri commands（与 src/shared/ipc.ts 一一对应，见 e2e:ipc）
  runtime.rs               # per-会话长驻 omp 子进程 + rpc_chunk 重组 + 事件分发 + 真值回读（omp-state）+ 切模型自动最高档
  overlay.rs               # overlay.json 读写与版本归一（含单测）
  session_scan.rs          # agentDir 解析 + jsonl 头解析 + cwd 归组（含单测）
  git_info.rs              # git 只读查询（当前分支 / 本地分支 / 脏工作区）+ git 路径探测缓存（含单测与真实仓库端到端测试）
scripts/                   # fake-omp.mjs（canned RPC 联调：history|approve|deny|multi|abort 全为分支实现）、e2e-ipc-selfcheck.mjs（IPC 静态契约自检）、e2e-rpc.mjs（fake-omp 驱动的行为级端到端）、generate-icons.mjs（从矢量源重生成桌面图标）
```

## 核心数据流（不许违背）

- 会话真相永远是 `~/.omp/agent/sessions/<slug>/*.jsonl`（`PI_CODING_AGENT_DIR` 可覆盖）；app 只存轻量覆盖层 `$APPDATA/omp-mini/overlay.json`（项目列表/归档/备注/会话级权限）。app 可删可重装，不丢会话。
- 实时输出只走 RPC 事件流，不轮询文件。文件只用于列表与历史回放。
- 后端 per-会话 spawn `omp --mode rpc`，stdout 行解析 → `rpc_chunk` 重组 → `omp-event://<sessionId>`，状态机推 `omp-status://<sessionId>`；运行时真值（模型 / 可用思考档 / 当前档 / 上下文占用 / 本轮用量与耗时）推 `omp-state://<sessionId>`，打开会话时另经 `get_session_runtime` 补拉一次以消除订阅竞态。用量真值来自 `message_end.message.usage`（`duration` / `ttft` 实测就是毫秒，原样透传不换算）；`get_state` 回读时保留用量字段，不许被抹掉。
- `prompt` 的即时 ack 只代表接受，完成信号以 `agent_end(isTerminal !== false)` 为准；流式中 composer 只允许停止（`abort`），不排队。
- V1 最小命令集：`negotiate_protocol、get_state、prompt、abort、set_model、set_thinking_level` 走 stdin 长驻通道（命令名以 `src/lib/rpc-types.ts` 为准）；`get_available_models、switch_session、get_messages_page、bash（诊断）` 仅在该类型声明中保留，Rust 后端当前未发送。历史回放走后端 `get_history`（直读 jsonl，前 5000 行、最多 2000 条 message/custom 系），不是 `get_messages_page`。
- 切模型发 `set_model{provider, modelId}`（两个字段，非 selector 字符串）；切思考档发 `set_thinking_level{level}`。**omp 切模型后不会修正思考档**（切到无思考模型直接丢档）：后端收到 `set_model` 成功回包即自动跟进 `set_thinking_level`（新模型 `efforts` 最高档，无思考则 `off`），再 `get_state` 回读真值推 `omp-state`；失败也回读以纠正前端乐观态。
- 思考档可用集 = omp 真值 `currentEfforts`（`omp-state` / `get_session_runtime`）∪ `{off}`（`off` 恒合法）；下拉**只列支持档**，禁止列全集再置灰或先发再报错（非法档 omp 静默忽略且回 success）。
- 审批线序：`toolcall_end` → `tool_execution_start` → `extension_ui_request{method:select, options:["Approve","Deny"]}`；通过回 `value:"Approve"`，拒绝回 `cancelled:true`（turn 正常结束，不是中断）。
- git 上下文**只读**：`get_git_info(path)` 走 git CLI 只读查询（`rev-parse --is-inside-work-tree` / `symbolic-ref --short HEAD` / `for-each-ref refs/heads` / `status --porcelain --untracked-files=no`），不写仓库、不切分支；结果只用于输入框上方上下文条展示。

## 前端约定（血泪规则）

- RPC 帧与 jsonl 文件块统一归一为 `ViewMsg`（`src/lib/viewmsg.ts`），历史与实时同一入口合并；未知 `type` 只记日志不崩。
- 实时流的合并只走 `mergeViewMsgs`（`src/lib/mergeEvents.ts`）：`text` 流式按同 id 覆盖，工具卡统一用 `tool:<toolCallId>` 作 id **原位合并**（状态/输出取新值，名称/意图/参数摘要这类只在早期事件里出现的元数据从旧卡继承）。**一次工具调用只许出一张卡**——此前各阶段无脑追加会渲染 2–3 张卡、"输入中"那张永远转圈，并触发 React 重复 key。
- 组件命名以 `design-system/MASTER.md` §8 速查表为准，禁止同义重复组件；`ModelPicker/ThinkingPicker/PermissionBadge` 只挂输入框工具行，顶栏不再重复。
- 工具行 `ModelPicker`/`ThinkingPicker` 触发按钮按内容自适应宽度、**不截断**（`whitespace-nowrap` + `shrink-0`，不设 `max-w-*`）：模型名再长也完整显示，空间不足由工具行 `flex-wrap` 换行兜底。
- 输入框工具行与上方上下文条下拉互斥：`composerMenu: model | thinking | permission | project | branch | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）；下拉统一向上弹。
- 输入框上方上下文条（`ContextBar` = `ProjectPicker` + `BranchPicker`，在输入框卡片**外**上方、与卡片内文字左对齐）：项目名认**会话归属**，`projectId` 为 null 就显示「未归属」，禁止回退 `activeProjectId`（否则会显示成消息在 A 项目里、实际发进未归属目录的会话）；切项目走 `switchProject(id, { openRecent: true })`（切上下文 + 刷新列表 + 打开该项目最近会话，没有则回空态），保证「显示的项目 = 消息真正发去的项目」。分支是**只读**控件（只列本地分支 + 刷新，禁止 checkout 或任何 git 写操作），非 git 目录显示「非 Git 目录」而不是无声消失。git 查询走后端 `get_git_info`，找不到 git / 非仓库 / 超时一律降级为 `isRepo:false`——git 出任何问题都不许影响输入与发送。项目名 / 分支名不截断（与工具行选择器同规矩，窄窗口整行 `flex-wrap` 兜底）。
- 状态收敛：标题框外无独立状态条（`StatusBar` 仅保留读屏播报位）；状态统一进输入框工具行——`OmpStatusPill`（常驻，就绪也占位显示「就绪」）+ `RuntimeStats`（上下文占用 / 本轮 token / 耗时 / TTFT，全部来自 `omp-state` 真值，**无真值整块不渲染**，前端只做格式化不自算）。
- 助手正文渲染走 `AssistantText`（`react-markdown` + `remark-gfm` + `rehype-highlight`）：**不许 `dangerouslySetInnerHTML`**（正文按不可信输入处理）；代码高亮配色只写在 `src/index.css`（项目 token 派生，深浅色自动跟随），不引第三方主题 CSS；代码块横滚不撑破布局，流式中未闭合围栏给 skeleton。
- 消息流首屏增量：默认只渲染最后 `THREAD_PAGE`（200）条（`stores/app.ts` 的 `threadLimit`，按会话重置），向上滚动或点按钮按页展开，加载后保持视口位置；不许一次性 map 全部消息（MASTER §7）。
- 会话行单行 `● 标题 … 时间/操作`：右侧 68px 固定槽位，时间与操作按钮互斥（hover 时时间 `visibility` 藏、按钮绝对覆盖淡入），行高锁定，悬浮零跳动；删除二次确认用浮层，不撑布局。
- 会话行不设复选框：不做多选、不做「已选 N」批量工具条；批量归档/删除只挂在分组头——项目分组头三个入口 = 归档全部对话 / 删除全部对话 / 删除工作区（后两者各自走分组内浮层二次确认；删除工作区只解绑目录、名下会话全部归档保留），「未归属会话」分组头 = 归档全部 / 删除全部对话。批量走 `archive_sessions`/`delete_sessions`，单次上限 200，前端 `BATCH_LIMIT` 分批。
- 左侧栏可拖拽调宽 220–480px（默认 264，`sidebarWidth` 持久化 localStorage）；窄窗 <768px 收抽屉。
- 四个禁止：不轮询文件做伪实时；前端不自算 token（状态与用量一律透传 `omp-state` 真值）；不写回 omp 标题（改名只写覆盖层 `notes`，禁用 `set_session_name`）；设置页不改 omp 配置（诊断区只读 + 「指定 omp 路径」只写应用覆盖层 `ompPath`，更新区除外）。

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

联调无需真实 LLM：`OMP_FAKE_SCENARIO=approve|deny|history|multi|abort node scripts/fake-omp.mjs`（canned RPC 事件，覆盖审批双分支、多工具并行与流式中断）。

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包并生成 `latest.json` 供应用内 updater 拉取。
- updater 需签名校验：`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 当前为 TODO 占位；正式发版前用 `pnpm tauri signer generate` 生成密钥对，公钥填配置、私钥全文进仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`（见 README「应用内更新」节）。
- 升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 Unreleased 条目归入新版本节并写明日期）。

## V1 明确不做

自动化/定时任务、插件/Skill/MCP/Hook 管理、主题市场、云同步、多窗口协作、终端 PTY 仿真、diff 合并编辑器、用量统计面板（只透传 omp 给的单轮用量与上下文占用，不做聚合/报表/成本分析）。相关需求直接归档到 V2，不在本仓库讨论实现。

## 命名与变更约定

- 对外名称：ompMiniDesktop；仓库/包名：`ompMiniDesktop` / `omp-mini-desktop`；标识符、文件名：英文；界面文案、注释、文档、提交说明：中文。
- 架构级变更（创建/删除/移动文件或目录、核心数据流变更）必须同步更新本文档、`docs/` 与 `design-system/MASTER.md`。
- 增删前后端依赖时同步 `THIRD-PARTY-NOTICES.md`；密钥、Token、私钥、签名证书、个人路径一律不得进仓库。
