# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的极简桌面端：**左侧项目 / 分支树，右侧 omp 终端标签页**——每个终端就是一个 omp 会话。
Tauri v2 + React + TS + Tailwind v4 + Zustand，包管理 pnpm。

> **形态变更史（V11，2026-09-17 起）**：app 从「聊天界面壳」（RPC 流式渲染）颠覆性改为「终端工作区壳」。
> 聊天渲染、RPC 驱动、审批卡、输入框等全部退场——那些职责回到 omp 自己的 TUI。
> V1–V10 的文档（`docs/v1-design.md`、`docs/v2..v10-schedule.md`、`docs/rpc-memo.md`）是**历史存档**，
> 描述的是旧形态；现行口径以 `docs/v11-schedule.md` 为准。

## 文档索引

|文档|路径|说明|
|---|---|---|
|终端工作区（现行）|`docs/v11-schedule.md`|冻结设计稿 + 上游实测口径 + 完成口径（**改代码前先读这份**）|
|产品冻结稿（历史）|`docs/v1-design.md`|V1 聊天界面的设计（形态已被 V11 取代，仅作历史参考）|
|RPC 实测备忘（历史）|`docs/rpc-memo.md`|`omp --mode rpc` 协议的实测结论（V11 起壳侧不再驱动 RPC；留存给未来需要协议能力的场景）|
|功能排期（历史）|`docs/v2..v10-schedule.md`|各期明细与实测数据（设置页各页签的沿革在这批文档里）|
|自定义模型与添加供应商（现行）|`docs/v12-schedule.md`|`models.yml` 可视化 + 合并式「添加供应商」面板（V12c）的上游实测、实现与完成口径（**改这块前先读**）|
|设计真相|`design-system/MASTER.md`|token、布局、交互、组件命名（改 UI 先读）|
|应用图标|`design-system/icon/omp-mini-icon.svg`|π 字标矢量唯一源，`pnpm icon` 重新生成 `src-tauri/icons/`|
|更新日志|`CHANGELOG.md`|Keep a Changelog 风格，发版时归入新版本节|
|第三方声明|`THIRD-PARTY-NOTICES.md`|直接依赖清单，增删依赖时同步|

## 技术基线

- 桌面壳：Tauri v2（`src-tauri/`，identifier `com.omnidesktop.mini`；窗口 `titleBarStyle: Overlay` + `hiddenTitle`，标题栏是自绘的——顶栏与左栏红绿灯占位都挂 `data-tauri-drag-region`，拖动走 `core:window` 的 `start_dragging`。**该权限不在 `core:default` 里**，必须在 `src-tauri/capabilities/default.json` 显式加 `core:window:allow-start-dragging`）
- 前端：React 19 + TS + Vite + Tailwind v4 + Zustand（`src/`）+ `@xterm/xterm` 6（终端模拟器，DOM renderer）
- 后端：Rust + tokio + serde/serde_json + **`portable-pty`**（PTY 进程管理）+ tauri-plugin（dialog/opener/process/updater，`main.rs` 实注册）
- 工具链：Node 22 + pnpm 11；Rust stable（已验证 1.97）+ 本地 `@tauri-apps/cli`（`pnpm tauri:*` 走项目本地 CLI）
- 上游运行时：`omp` 18.x（已验证 18.2.2），不随仓库分发，用户另行安装

## 源码结构（V11 现行）

```
src/
  app/App.tsx              # 顶层装配：左栏（可拖宽/窄窗抽屉）+ 标签栏（终端 + 设置）+ 面板区 + 终端关闭确认 + 全局快捷键（⌘T/⌘W/⌘1..9）
  components/health…       # HealthBanner（omp 不可用横幅）
  components/SettingsPage.tsx        # 设置页外壳（左栏竖向菜单：通用 / 模型 / 记忆 / 使用统计 / 已归档对话 + 右侧内容区）
  components/ArchivedSessions.tsx    # 设置 ›「已归档对话」：恢复（= 取消归档 + 终端 resume）/ 删除，行级与分组级
  components/ConfirmDialog.tsx       # 通用二次确认浮层（跨分组危险操作用它）
  components/LanguageToggle.tsx      # 界面语言三档（跟随系统 / 中 / EN），挂左栏底部「设置」行右侧
  components/ThemeToggle.tsx         # 皮肤三档（跟随系统 / 深色 / 浅色），挂「设置」行右侧
  components/sidebar/
    WorkspaceSidebar.tsx   # 左栏：添加项目 + 项目列表 + 底部「设置/语言/皮肤」行（更新小点在设置入口上）
    ProjectGroup.tsx       # 项目组：折叠头（会话入口 / 新建 worktree）+ 工作区行 + WorktreePanel（分支过滤 + 新建分支）
    SessionPopup.tsx       # 项目会话弹窗：resume 到终端 / 归档 / 恢复 / 删除
  components/terminal/
    TerminalView.tsx       # 终端面板区：全部终端面板（隐藏不销毁）+ 空态（标签栏与关闭确认归 App）
    TerminalTabs.tsx       # 标签栏（常驻）：终端标签（状态点 + OSC 标题 + 关闭）+ 设置标签（单例）+ ＋
    TerminalPane.tsx       # 单个终端：xterm 实例 + PTY 管道（Channel）+ fit/resize + 退出浮层（重启/关闭）
  components/settings/     # GeneralSettingsPanel（通用）/ ModelsPanel（模型页壳：我的模型 / 供应商 / 角色 / 转移）/ ProvidersSection（供应商合并区块：已添加列表 + 两个弹窗）/ ProviderPicker（提供商搜索选择器）/ ProviderModelsDialog（挑选模型弹窗 + 列表）/ CustomProviderEditForm（models.yml 表单）/ DialogShell（设置页模态壳）/ FallbackChains / ModelPickList / MemoryPanel / UsagePanel / StarToggle + Switch（共享小件）
  components/update/       # UpdateDialog（App 常驻挂载，updateDialogOpen 控制；有更新的提醒在左栏设置入口小点）
  lib/                     # 见下
  shared/                  # api（invoke 唯一入口，命令名走 IPC 常量）/ ipc（命令与事件常量的唯一清单）/ types
  stores/app.ts            # Zustand 全局状态（项目/工作区/终端/语言/皮肤/设置页/更新）
src-tauri/src/
  main.rs / lib.rs         # 插件注册 + 命令注册（generate_handler 是命令面真相）；RunEvent::Exit 收掉全部 PTY 进程
  pty.rs                   # PTY 进程表（portable-pty）+ 读线程 + 增量 UTF-8 解码 + Channel 推送（含真实 PTY 单测）
  commands/mod.rs          # 项目 / 工作区 / 会话列表与归档 / omp 定位 / git_info 命令 + 归属判定（owner_project / ownership_scope）
  session_scan.rs          # agentDir 解析 + jsonl 头解析 + cwd 归组（含单测）
  overlay.rs               # overlay.json 读写与版本归一（含单测）
  git_info.rs              # git 只读查询（当前分支 / 本地分支 / 脏工作区 / **worktree list**）+ git 路径探测缓存（含单测）
  settings.rs              # 设置 › 通用后端：`omp config list/set/reset` 三个命令（含单测）
  models_config.rs         # 设置 › 供应商 ›「自定义模型」后端：`<agentDir>/models.yml` 的读 / 写（保真文本由前端给，后端做 hash 乐观锁 + 预校验 + 备份 + 原子写；含单测）
  providers.rs             # 设置 › 供应商 / 模型后端：auth-broker login/logout + modelRoles + retry.fallbackChains
  memories.rs              # 设置 › 记忆后端：列 / 读 / 删 omp 项目记忆（含单测）
  usage.rs                 # 设置 › 使用统计后端：扫会话 jsonl 聚合用量（只读；含单测）
scripts/                   # e2e-ipc-selfcheck.mjs（IPC 契约双向自检）、generate-icons.mjs
```

`lib/` 明细（V11）：

```
locale.ts        # 全界面中英字典（~300 键）+ 语言偏好三档 + 解析纯函数（含单测）
theme.ts         # 皮肤三档归一 + localStorage + resolveTheme + applyTheme（含单测）
termTheme.ts     # 终端配色：从 CSS `--term-*` 读值喂给 xterm（组件不写死色值）
useText.ts       # 组件取文案的唯一入口
useDropdown.ts   # 单开下拉容器（点外部 / Esc 关闭）
workspaces.ts    # 工作区逻辑：loadWorkspaces（唯一刷新入口）/ 显示名 / 点工作区开终端 / ＋ 新建 / resume 到终端
projects.ts      # 添加项目（pickAndAddProject 唯一实现）
sessions.ts      # 会话按项目分组（归档页用；含单测）
sessionBatch.ts  # 批量归档/恢复/删除的唯一实现（BATCH_LIMIT 200 + 失败聚合）
myModels.ts / modelSelector.ts / modelNames.ts / roleNames.ts / ompSettings.ts  # 设置页数据层（含单测；myModels = 我的模型，模型选择器的候选范围）
customModels.ts  # 自定义模型（models.yml）保真编辑数据层（yaml 包；含单测）
ompDiag.ts       # omp 自检与手动指定路径
appUpdate.ts     # 应用内更新状态机
```

## 核心数据流（不许违背）

- **终端 = PTY 里的 `omp` TUI（V11 的根）**：每个终端 tab 在后端是一个 `omp --cwd <dir>` 进程跑在 PTY 里（**无 `--mode`** —— 交互式 TUI；`--resume <id>` 可选）。壳侧**不解析、不翻译**终端字节流：Rust 读线程做增量 UTF-8 解码后经 **Tauri Channel** 直推前端 `xterm.write`；键盘走 `pty_write`、尺寸走 `pty_resize`、关闭走 `pty_kill`。**kill 是双保险**：omp 的 TUI 收到 SIGHUP 不退出（实测），终止统一走 **SIGHUP → 1 秒宽限 → SIGKILL 进程组**（`force_kill_group` 打 `-pid`；应用退出路径直接补 SIGKILL）；读线程收尾用带宽限的 `wait_with_grace`，`PtyHandle.seq` 防「同 id 快速重启时旧读线程误删新句柄」。**高频字节流不进 Zustand**——store 只放 tab 元数据（id/cwd/label/title/status/exitCode/resume/spawnSeq）。
- **终端环境**：`TERM=xterm-256color`、`COLORTERM=truecolor`；`PATH` 取登录 shell 的一次性探测结果（GUI 启动的 .app 只有 launchd 默认 PATH）。omp 发 OSC 0/2 标题（`π > 会话名`）→ tab 标题（`setTerminalTitle` 只在变化时更新）。终端配色从 `--term-*`（两套皮肤）运行时读取；`<html class="dark">` 变化时所有 xterm 实例换色（MutationObserver）。
- **fit 只在可见时做**：`display:none` 里量不到尺寸——`ResizeObserver` 与切 tab 的 fit 都用 active 判断挡掉隐藏面板；切到本 tab 时 rAF 后 fit + `pty_resize` + focus。同一 id 快速重启有竞态防护（后端 `PtyHandle.seq` 比对，旧读线程不误删新句柄）。
- **主区 = 常驻标签栏 + 常驻面板（设置是标签，不是替换）**：`App` 里是 `<TerminalTabs />`（终端标签 + 设置标签 + ＋，只要有任何标签就常驻）+ `<TerminalView visible={!settingsTabActive} />` + `{settingsTabOpen && <SettingsPage visible={settingsTabActive} />}` + 终端关闭确认（`ConfirmDialog`，任意标签下都要弹得出来）。**面板只切显隐、不许条件渲染**——**卸载 `<TerminalView />` 会连带卸载每个 `TerminalPane`，其清理 effect 直接 `pty_kill`**（那是「关闭标签」才该发生的事；实测：卸载终端树 → kill 立即发生）。切到设置标签时 `visible=false` 让面板的 active 判定为假（不量尺寸 / 不推 resize），切回时按「切到本 tab」重新 fit + 聚焦；隐藏期间到达的输出照常进 xterm 缓冲，设置页的页签选择 / 滚动位置也保留（`settingsTabOpen` 置 false 才卸载）。`activeTerminalId` 在切去设置标签时保持不变，作为「上次的终端」。
- **终端 tab 不追踪 session id**：jsonl 的 sessionId 由 TUI 自己创建，壳侧不做运行时绑定（「运行中」标记不做）；`--resume` 由会话弹窗发起（cwd 用会话原目录）。
- **左栏 = 项目 → 工作区（主目录 + git worktree）**：`list_workspaces` 聚合（每个项目一次 `git worktree list --porcelain`；porcelain 第一块是主目录）。**worktree 真相 = git**（手工 `git worktree add` 的也列出）；**创建走 `omp worktree add`**（clone-first + `~/.omp/wt` 管理目录是 omp 的既有约定），路径 `~/.omp/wt/<repo>-<branch-slug>`，已检出的分支幂等复用（分支已 checkout 在别处时 git 会拒绝，错误透传）。点击工作区行：该目录已有终端 → 聚焦最近一个；否则新建。`＋`/`⌘T` 用 `activeWorkspacePath`（无选中时退第一个可用工作区）。
- **会话归属扩展到 worktree**：`ownership_scope(projects)` = 项目路径 ∪ 各项目全部 worktree 路径（`git worktree list` 求得）——`list_sessions` / `list_archived_sessions` / `get_usage_stats` / `list_memories` 的归属**全部走它**。worktree 里跑的会话（jsonl cwd = worktree 目录）必须归到所属项目，不许掉「未归属」。`owner_project` 仍是唯一判定入口（真实路径前缀匹配、最长优先）。
- **工作区树刷新入口唯一**：`lib/workspaces.ts` 的 `loadWorkspaces()`（拉取 + 落 store + 失效选中项回退）。项目增删 / worktree 创建后都调它（`refreshSidebar`）。
- **会话弹窗（项目行 Clock）**：数据 = `list_sessions(projectId)`（归属含 worktree）；行点击 = 新终端 `omp --resume <id>`；归档 / 恢复 = 覆盖层批量命令（单条=数组长度 1）；删除 = `delete_sessions` + ConfirmDialog。设置 ›「已归档对话」是归档的唯一管理面（不受扫描窗口限制），其「打开」= **恢复（unarchive）+ 终端 resume**（V11 没有只读回放渲染器）。
- **设置是标签栏里的单例标签**：左栏底部「设置」入口打开 / 聚焦（`openSettingsTab`），标签的 `×` 或 ⌘W 关闭（`closeSettingsTab`，回到上次的终端标签；关闭最后一个终端标签时若设置标签开着则自动切过去）。设置页五个页签仍是全 app 唯一改 omp 状态的地方（除本应用偏好）：通用（`omp config` 白名单 **41 项**——V11 把 `tools.approvalMode` 收回本页）/ **模型**（V12b 起为唯一模型管理面；V12c 把「供应商」与「自定义模型」并成**一个区块 + 两个弹窗**：**供应商在最上方** → 我的模型（挑选结果）→ `modelRoles` → `retry.fallbackChains`；「添加供应商」弹窗 = 可搜索的提供商选择器 → API key / OAuth 走 `auth-broker login`，首项「自定义」写 models.yml（自定义表单：**名称可改**——改键保位置与原注释，支持中文（omp 实测无字符集约束，只挡空白与 `/` 等歧义字符）；接口类型只给 `openai-completions` / `anthropic-messages` 两档，既有文件里的其它 `api` 值原样列出保留；**认证只有 API Key**，留空 = `auth: none`）；「挑选模型」弹窗 = 该供应商的模型星标；平铺的「可用模型」目录已删除；**从终端标签切回设置标签会重读 omp 的角色 / 转移链**——omp TUI 里改完即识别，模型目录走 `get_models` 的 5 分钟缓存不额外重拉）/ 记忆（只删不写）/ 使用统计（只读）/ 已归档对话（覆盖层 + 删文件）。读写口径与实测结论见 `docs/v8-schedule.md` / `docs/v9-schedule.md`（仍然有效）。
- **「我的模型」= 模型选择器的候选范围**（V12b；`lib/myModels.ts`，localStorage 键沿用 `omp.favoriteModels.v1`）：我挑过的 selector 非空时，`candidateModels` 让模型角色 / 失败转移目标的候选只列这些；空 = 全部可用模型（不挡新人）。**不写 omp 的 `enabledModels`**——实测那才是 omp 侧 TUI `/model` 的白名单（`[]` = 不限制），本应用明确不动它（`docs/v12-schedule.md` §6）。
- **自定义模型（V12；V12c 起入口在「供应商」区块的添加面板里，选择器首项「自定义」）直接写 `<agentDir>/models.yml`**——omp 没有 CLI 写入口（`omp models` 只有 ls / find / refresh，`omp config` 只管 `config.yml`），写文件是唯一路径；这是壳侧唯一直接写 omp 配置文件的例外。前端 `lib/customModels.ts`（`yaml` 包）做**保真编辑**：只改被编辑的节点，注释 / 格式 / 界面之外的字段（`headers` / `compat` / `modelOverrides` / `cost`…）原样保留；**覆盖型块（无 `models` 的覆盖字段块）界面只读**。后端 `models_config.rs` 四道闸：hash 乐观锁（外部改过即拒写）→ 预校验（临时 agentDir 跑一次 `omp models` 读 stderr，坏配置**不落盘**）→ 备份（`$APPDATA/omp-mini/backups/`，保留 10 份）→ 原子写。文件发现规则与 schema 细节见 `docs/v12-schedule.md`。
- **覆盖层**（`$APPDATA/omp-mini/overlay.json`）职责不变：项目列表 / 归档标记 / 备注 / `ompPath`。`sessionApproval` 是 V1 遗留字段（读旧文件时保持形状，新写入停止）。

## 前端约定（血泪规则）

- **消息类渲染已全部退场**（Thread / Composer / 审批卡 / 工具行 / 视图归一 / 图片附件 / @提及 / `/` 补全）——不要在任何新代码里引用这些旧概念。终端里的输出就是终端，不做结构化渲染。
- **左栏选中态**：工作区行 = `bg-active` 填充 + 左侧 2px accent 线 + 等宽加粗分支名；`DiagramTree` 区分主目录与 worktree（主目录强调色、普通 worktree 灰色），与项目行共用悬浮语言。
- **终端关闭语义**：`requestCloseTerminal` 统一收口（running → ConfirmDialog 确认；exited → 直关）；关 = 从 store 移除 → 组件卸载 → kill 进程。重启 = `restartTerminal`（spawnSeq+1，TerminalPane 重新 spawn，xterm 实例与滚动缓冲保留）。
- **皮肤与语言仍是纯展示层偏好**：三档分段控件挂在左栏底部「设置」行右侧（语言在左、皮肤在右），不写 omp 配置、不进设置页；`--term-*` 两套色板跟着这两个开关走。深浅色不准用 Tailwind `dark:` 变体绕开 token；终端色值只准放 `index.css` 的 `--term-*`（`lib/termTheme.ts` 运行时读取）。
- **界面文案一律走字典**（`src/lib/locale.ts` 的 `TEXT`）：组件内 `useText()`、非组件模块 `TEXT[useApp.getState().locale]`；插值 `fmt(t.key, v1)`（占位 `{0}`）；**上游数据不进字典**（会话标题、omp 输出、后端错误原样透传）。设置项 label 是动态键（`s_` + 点换下划线 / 分组 `sg_` / 值标签 `sv*`）——**这批前缀的键不许被「未使用键清理」误删**（有单测守着）。
- 左侧栏宽度 **292–480px（默认 292，localStorage 持久化）**；下限由底部行内容决定（改 `SIDEBAR_MIN` 前先量那一行）。窄窗 <768px 收抽屉。
- 状态收敛：无独立状态条；omp 健康走 `HealthBanner`，更新提醒走左栏设置入口的小点（`update.status` 为 available/ready）。
- 导出 / 复制 / 草稿 / 队列这些聊天概念亦已退场；新功能不许把它们引回来。
- **视觉基线（2026-09-17 精修）**：冷灰外壳与内嵌工作面；桌面主区外沿 8px / 16px 圆角，48px 标签栏始终存在（空态仍保留工作区标题与新建按钮，窄窗提供项目抽屉入口）。设置页 `max-w-6xl`，通过容器查询在 176px 文字导航与 44px 图标导航间切换；五个页面共用卡片、控件与浮层层级。颜色与圆角真相见 `design-system/MASTER.md` / `index.css`，实心 accent 按钮文字用 `accent-foreground`。

## 常用命令

```bash
pnpm install
pnpm tauri:dev              # 桌面壳联调
pnpm dev                    # 纯前端
pnpm check                  # 提交前全过：typecheck + lint + test + e2e:ipc
pnpm typecheck              # tsc --noEmit
pnpm lint                   # eslint（flat config，0 警告）
pnpm test                   # vitest
pnpm e2e:ipc                # IPC 契约双向自检（ipc.ts ↔ main.rs ↔ 实现）
pnpm build                  # tsc + vite 构建
cargo test --manifest-path src-tauri/Cargo.toml    # Rust 单测（含真实 PTY 回环）
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored   # 慢测试：真实 omp TUI 冒烟 / 真实 agentDir 基准
pnpm tauri:build            # 本机发布构建，产物见 src-tauri/target/release/bundle/
pnpm icon                   # 从 design-system/icon/omp-mini-icon.svg 重生成桌面图标
```

界面核对（无屏幕权限时）：`pnpm dev` + 浏览器里注入 `window.__TAURI_INTERNALS__` mock（含 Channel 协议：`transformCallback` 回调表 + `{index, message}` 帧格式），可驱动全流程（开终端 / 多 tab / 退出浮层 / 会话弹窗）——mock 状态写进 `document.documentElement.dataset` 后用 DOM 读回；`page.evaluate` 与 `evaluateOnNewDocument` 之间 window 属性可能不保活，**断言要放在同一个 `tab.run` 里**。

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包并生成 `latest.json` 供应用内 updater 拉取。
- updater 需签名校验：`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 已配置（私钥全文需在仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`，见 README「应用内更新」节）。
- 升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 Unreleased 条目归入新版本节并写明日期）。

## 范围边界（V11 现行口径）

- **不做**：编辑器 / 文件树 / diff 审查 / 内置浏览器 / SSH / 移动端 / PR 集成（Orca 的「复杂」部分）；终端滚动缓冲持久化（重启不恢复 tab）；终端与 jsonl 会话的运行时绑定；分屏（split）；多窗口。
- 沿用旧口径的边界：自动化 / 定时任务、插件 / Skill / MCP / Hook 管理、主题市场、云同步——仍在范围外。
- 自定义模型的 **`discovery` 表单**与**覆盖型块的编辑**不做（见 `docs/v12-schedule.md` §5）；写的是 agentDir 的全局层——项目级 models 配置上游没有发现路径。
- 用量限额（V6）与上下文容量（V7）的**壳侧 UI 已随 V11 退场**（omp TUI 自带 `/usage`、`/context`）；后端对应模块已删除，需要时从 git 历史恢复。
- 旧的会话内容搜索（M7b）随左栏会话列表一并退场；已归档对话仍可搜索式管理？——**不**，归档页只按项目分组列出（无搜索）。要恢复先定交互（见 `docs/v11-schedule.md` §7）。

## 命名与变更约定

- 对外名称：ompMiniDesktop；仓库/包名：`ompMiniDesktop` / `omp-mini-desktop`；标识符、文件名：英文；界面文案、注释、文档、提交说明：中文。
- 架构级变更（创建/删除/移动文件或目录、核心数据流变更）必须同步更新本文档、`docs/` 与 `design-system/MASTER.md`。
- 增删前后端依赖时同步 `THIRD-PARTY-NOTICES.md`；密钥、Token、私钥、签名证书、个人路径一律不得进仓库。
