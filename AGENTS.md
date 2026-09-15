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
  components/SettingsPage.tsx  # 设置占位页（只读 config path + 更新区）
  components/sidebar/      # Sidebar（分组会话列表）、EmptyState
  components/thread/       # TopBar（标题备注 + UpdateBell）、Thread、ToolCard、ApprovalCard、StatusBar（含 OmpStatusPill）
  components/composer/     # Composer（一体式输入框 + 工具行）
  components/pickers/      # ModelPicker、ThinkingPicker、PermissionBadge（只挂输入框工具行）
  components/update/       # UpdateBell、UpdateDialog（应用内更新）
  lib/                     # viewmsg（ViewMsg 归一 + 单测）、sessions（分组 + 单测）、useSessionEvents、useDropdown、appUpdate、rpc-types
  shared/                  # api（invoke 唯一入口）、ipc（通道常量）、types
  stores/app.ts            # Zustand 全局状态（含 composerMenu、sidebarWidth、update）
src-tauri/src/
  main.rs / lib.rs         # 插件注册（dialog/opener/process/updater/store）
  commands/mod.rs          # 26 个 Tauri commands（与 src/shared/ipc.ts 一一对应，见 e2e:ipc）
  runtime.rs               # per-会话长驻 omp 子进程 + rpc_chunk 重组 + 事件分发
  overlay.rs               # overlay.json 读写与版本归一（含单测）
  session_scan.rs          # agentDir 解析 + jsonl 头解析 + cwd 归组（含单测）
scripts/                   # fake-omp.mjs（canned RPC 联调：history|deny|multi 为分支实现；注释里的 approve-once 尚未实现）、e2e-ipc-selfcheck.mjs（契约自检）
```

## 核心数据流（不许违背）

- 会话真相永远是 `~/.omp/agent/sessions/<slug>/*.jsonl`（`PI_CODING_AGENT_DIR` 可覆盖）；app 只存轻量覆盖层 `$APPDATA/omp-mini/overlay.json`（项目列表/归档/备注/会话级权限）。app 可删可重装，不丢会话。
- 实时输出只走 RPC 事件流，不轮询文件。文件只用于列表与历史回放。
- 后端 per-会话 spawn `omp --mode rpc`，stdout 行解析 → `rpc_chunk` 重组 → `omp-event://<sessionId>`，状态机推 `omp-status://<sessionId>`。
- `prompt` 的即时 ack 只代表接受，完成信号以 `agent_end(isTerminal !== false)` 为准；流式中 composer 只允许停止（`abort`），不排队。
- V1 最小命令集：`negotiate_protocol、get_state、prompt、abort、set_model、set_thinking_level` 走 stdin 长驻通道（命令名以 `src/lib/rpc-types.ts` 为准）；`get_available_models、switch_session、get_messages_page、bash（诊断）` 仅在该类型声明中保留，Rust 后端当前未发送。历史回放走后端 `get_history`（直读 jsonl，前 5000 行、最多 2000 条 message/custom 系），不是 `get_messages_page`。
- 切模型发 `set_model{provider, modelId}`（两个字段，非 selector 字符串）；切思考档发 `set_thinking_level{level}`。
- 审批线序：`toolcall_end` → `tool_execution_start` → `extension_ui_request{method:select, options:["Approve","Deny"]}`；通过回 `value:"Approve"`，拒绝回 `cancelled:true`（turn 正常结束，不是中断）。

## 前端约定（血泪规则）

- RPC 帧与 jsonl 文件块统一归一为 `ViewMsg`（`src/lib/viewmsg.ts`），历史与实时同一入口合并；未知 `type` 只记日志不崩。
- 组件命名以 `design-system/MASTER.md` §8 速查表为准，禁止同义重复组件；`ModelPicker/ThinkingPicker/PermissionBadge` 只挂输入框工具行，顶栏不再重复。
- 输入框工具行下拉互斥：`composerMenu: model | thinking | permission | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）；下拉统一向上弹。
- 状态收敛：标题框外无独立状态条（`StatusBar` 仅保留读屏播报位）；状态统一进输入框内 `OmpStatusPill`，且仅非就绪（运行中/等待审批/出错/已退出/omp 不可用）才出现，就绪态不占位。
- 会话行单行 `● 标题 … 时间/操作`：右侧 68px 固定槽位，时间与操作按钮互斥（hover 时时间 `visibility` 藏、按钮绝对覆盖淡入），行高锁定，悬浮零跳动；删除二次确认用浮层，不撑布局。
- 左侧栏可拖拽调宽 220–480px（默认 264，`sidebarWidth` 持久化 localStorage）；窄窗 <768px 收抽屉。
- 四个禁止：不轮询文件做伪实时；前端不自算 token（状态条纯透传）；不写回 omp 标题（改名只写覆盖层 `notes`，禁用 `set_session_name`）；设置页零写入（只读 `config path` + 更新区）。

## 常用命令

```bash
pnpm install
pnpm tauri:dev              # 桌面壳联调
pnpm dev                    # 纯前端
pnpm typecheck && pnpm test && pnpm e2e:ipc   # 提交前全过
pnpm build                  # tsc + vite 构建
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build            # 本机发布构建，产物见 src-tauri/target/release/bundle/
```

联调无需真实 LLM：`OMP_FAKE_SCENARIO=approve|deny|history|multi node scripts/fake-omp.mjs`（canned RPC 事件，覆盖审批双分支）。

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包并生成 `latest.json` 供应用内 updater 拉取。
- updater 需签名校验：`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 当前为 TODO 占位；正式发版前用 `pnpm tauri signer generate` 生成密钥对，公钥填配置、私钥全文进仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`（见 README「应用内更新」节）。
- 升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 Unreleased 条目归入新版本节并写明日期）。

## V1 明确不做

自动化/定时任务、插件/Skill/MCP/Hook 管理、主题市场、云同步、多窗口协作、终端 PTY 仿真、diff 合并编辑器、用量统计。相关需求直接归档到 V2，不在本仓库讨论实现。

## 命名与变更约定

- 对外名称：ompMiniDesktop；仓库/包名：`ompMiniDesktop` / `omp-mini-desktop`；标识符、文件名：英文；界面文案、注释、文档、提交说明：中文。
- 架构级变更（创建/删除/移动文件或目录、核心数据流变更）必须同步更新本文档、`docs/` 与 `design-system/MASTER.md`。
- 增删前后端依赖时同步 `THIRD-PARTY-NOTICES.md`；密钥、Token、私钥、签名证书、个人路径一律不得进仓库。
