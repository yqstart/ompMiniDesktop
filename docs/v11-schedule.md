# ompMiniDesktop 十一期（V11）：终端工作区重构

> 基线：V1–V10 已交付（见 `CHANGELOG.md`）。本文是**颠覆性变更**的冻结设计稿：
> 壳的形态从「聊天界面」改为「终端工作区」——左侧项目/分支树，右侧 omp 终端标签页。
> 参考产品：[Orca](https://github.com/stablyai/orca)（多 agent 工作台），取其结构、去其复杂。
> 未实测的结论一律标注；实测结论注明日期与版本。

## 0. 一句话

**左栏 = 项目 → 工作区（分支）；右侧 = omp 终端标签页（每个终端就是一个 omp 会话）；会话列表收进弹窗，归档体系原样保留。**

V1–V10 的聊天渲染（流式消息流 / 审批卡 / 工具行 / 输入框补全……）整体退场——那些职责全部回到 omp 自己的 TUI 里执行。
壳侧保留并继续负责：项目与工作区管理、会话的列表 / 归档 / 删除、设置页（供应商 / 模型 / 通用 / 记忆 / 使用统计）、omp 诊断与应用更新。

## 1. 用户口径（原话与解释）

> 「界面上参照如图，左侧展示项目、分支，现在项目下的会话先展示成弹窗（没想好，但归档功能要保留）；
> 右侧不再是会话而是 omp 的终端，点击"+"开启新的 omp 终端，相当于一个会话。主要是 orca 做的还是复杂了，我不需要那么复杂。」

| 原话 | 落地口径 |
|---|---|
| 左侧展示项目、分支 | 左栏 = 项目（可折叠）→ 工作区行（主目录 + git worktree）；工作区行 = 分支名 + 位置 |
| 会话展示成弹窗 | 项目行悬浮「会话」图标 → 弹窗列出该项目（含 worktree）的全部会话；点会话 = 在终端里 `--resume` |
| 归档功能保留 | 弹窗内可归档 / 恢复 / 删除；设置 ›「已归档对话」页原样保留 |
| 右侧是 omp 的终端 | xterm.js + PTY 直接跑 `omp`（TUI 默认模式），全屏交互，审批等一律由 TUI 处理 |
| 点击 + 开启新终端，相当于一个会话 | 标签栏右侧 `＋`：在**当前选中工作区**目录 spawn 一个新的 `omp` 进程 |
| 不需要那么复杂 | 不做：编辑器、浏览器、PR 集成、移动端、SSH、fleet 管理、agent 类型选择、通知中心、账号热切换 |

## 2. 上游事实（本机实测，omp 18.2.2）

### 2.1 omp TUI 在 PTY 下正常运行（2026-09-17 实测）

- `omp --cwd <dir>`（无 `--mode` 参数）即交互式 TUI；在真实 PTY 里启动输出完整 ANSI 序列（spike：6 秒 71KB，含 `Welcome back!` 边框、同步输出模式 `?2026`、OSC 标题 `\x1b]0;π > <目录>\x07`）。
- 终端环境变量：壳侧设 `TERM=xterm-256color`、`COLORTERM=truecolor`（xterm.js 支持 24bit 色）。
- omp 会发 OSC 0/2 更新窗口标题（`π > <会话名>`），壳侧可用它做标签标题。

### 2.2 omp 原生 worktree 支持（2026-09-17 实测）

`omp worktree`（别名 `omp wt`）子命令，管理 `~/.omp/wt` 下的 git worktree：

```
omp worktree list --json     # [{path, kind, parentRepo, branch}]
omp worktree add [PATH] [-b <new-branch>] [-B] [--detach] [<commit-ish>] [-C <repo>] [-q]
omp worktree clear [--dry-run] [--all]
```

实测行为：

- `omp worktree add <path> <branch>`：checkout 已有分支；**分支已被其他 worktree（含主目录）检出时报错** `'refs/heads/<b>' is already checked out`（exit 1）。
- `omp worktree add <path>`：以路径 basename 为新分支名，从当前 HEAD 创建。
- `omp worktree add -b <name> <path>`：创建新分支。
- 创建时若有 `worktree.clone=true`（本机默认）：走 **clone-first**（`Cloned from <repo> via apfs`，macOS 上 APFS clonefile 加速，实测 <0.5s）。
- 只有建在 `~/.omp/wt/` 下的 worktree 会进 `omp worktree list --json`（`kind: "pr-checkout"`，带 `parentRepo`）；手工建在别处的不会被登记，但 `git worktree list` 里在。
- 相关配置键：`worktree.base`（string，未设置）、`worktree.cleanSource`（false）、`worktree.clone`（true）。

壳侧决定：**工作区列表的真相源 = `git worktree list --porcelain`（git 是真相，手工建的也列）；
创建走 `omp worktree add`（借用 clone-first 与 omp 的管理目录约定）**，路径固定 `~/.omp/wt/<repo>-<branch-slug>`。

### 2.3 会话真相不变

`~/.omp/agent/sessions/<slug>/*.jsonl` 仍是唯一真相（TUI 与 RPC 同一套落盘）。
`--resume <id前缀|路径>` 在 CLI 层可用（`omp --resume <id>`），壳侧「会话弹窗 → 在终端恢复」直接用它。

## 3. 架构

### 3.1 数据流

```
左栏树 ← list_workspaces（项目 × 主目录 git 信息 × git worktree list）
终端   ← PTY（portable-pty）→ xterm.js
          spawn: pty_spawn(opts, Channel) → omp --cwd <dir> [--resume <id>]
          out:   读线程 → 增量 UTF-8 解码 → Channel<PtyEvent>{data} → xterm.write
          in:    键盘 → pty_write；尺寸 → pty_resize；关闭 → pty_kill
会话   ← list_sessions / list_archived_sessions（jsonl 扫描，不变）
          resume → 新的 PTY（omp --resume）
归档   ← overlay.json（不变；archive_sessions / unarchive_sessions / delete_sessions）
```

### 3.2 Rust 侧

| 文件 | 动作 |
|---|---|
| `pty.rs` | **新增**：portable-pty 进程表 + 读线程 + 增量 UTF-8 解码（含单测） |
| `git_info.rs` | 扩展 `list_worktrees`（`git worktree list --porcelain` 解析，含单测） |
| `commands/mod.rs` | 增 `pty_spawn/pty_write/pty_resize/pty_kill`、`list_workspaces`、`create_worktree`；删全部 RPC 会话命令 |
| `runtime.rs` | **删除**（RPC 会话进程管理整体退场） |
| `quota.rs` / `context.rs` | **删除**（用量限额 / 上下文容量的 UI 挂载点消失；omp TUI 自带 `/usage`、`/context`） |
| `session_scan.rs` / `overlay.rs` / `settings.rs` / `providers.rs` / `usage.rs` / `memories.rs` | 保留 |

会话归属扩展：`owner_project` 的匹配集合 = 项目路径 ∪ 其 worktree 路径（`git worktree list` 求得，注入归属映射），
worktree 里产生的会话归到所属项目，不再落「未归属」。

### 3.3 PTY 细节

- crate：`portable-pty = "0.9"`（wezterm 出品，跨平台）+ `libc`（强杀兜底）。
- spawn 返回立即，读循环在专用线程（阻塞读）；EOF 后 `child.wait()` 拿退出码，发 `PtyEvent::Exit{code}`。
- 数据编码：**增量 UTF-8 解码**（保留跨 chunk 的不完整多字节序列；异常时按 8 字节上限 lossy 兜底），
  Rust 侧发 `String`，前端 `xterm.write(string)`——避免 base64 膨胀，也避免撕裂中文 / emoji。
- 窗口大小：spawn 时带 `cols/rows`（前端先 `FitAddon` 测量）；`ResizeObserver` → `pty_resize`（隐藏面板不推）。
- **kill 是双保险（实测发现）**：`omp` 的 TUI **收到 SIGHUP 不退出**（探针实测：只发 SIGHUP 时
  `wait()` 永久挂住、ignored 测试 100s+ 不返回）。所以终止统一走
  **SIGHUP → 1 秒宽限 → SIGKILL 进程组**（`force_kill_group` 打 `-pid`，覆盖 omp fork 出来的工具子进程）；
  读线程收尾也用带宽限的 `wait_with_grace`。应用退出路径（`kill_all`）不等优雅窗口、直接补 SIGKILL
  （进程马上没了，延迟补刀跑不到）。修复后同一个真实 omp 测试 **3.3 秒完成**。
- 退出清理：`RunEvent::Exit` 时 kill 全部子进程（异常崩溃的孤儿进程接受为已知边界）；
  `PtyHandle.seq` 防「同 id 快速重启时旧读线程误删新句柄」。

### 3.4 前端依赖

| 包 | 用途 |
|---|---|
| `@xterm/xterm@6` | 终端模拟器（DOM renderer） |
| `@xterm/addon-fit@0.11` | 尺寸自适应 |

主题：xterm 的 `theme` 随应用 token 深浅色切换（从 CSS 变量取值喂给 xterm，不写死色值）。

## 4. 界面口径

### 4.1 左栏（`WorkspaceSidebar`）

```
＋ 添加项目                          ← 唯一添加主入口（不变）
──────────────────────────────
▾ 项目A ·······························  [⏱ 会话] [⋯]
    ● main ··············· 主目录
    ○ dev ················ worktree
▸ 项目B ·······························  [⏱ 会话] [⋯]
    ● main ··············· 主目录
──────────────────────────────
[设置]                       [语言][皮肤]     ← 保留（不变）
```

- 项目行：名称 + 悬浮槽位（会话弹窗入口、`⋯` 菜单：新建 worktree / 重定位 / 移除项目）。点击行本体 = 展开/折叠。
- 工作区行：状态点 · 分支名 · 位置（主目录 / worktree）+ 活跃终端指示（该工作区有终端时实心）。
- **点击工作区行**：若无该工作区的终端 → 新建终端并聚焦；若有 → 聚焦最近一个。
- 选中态 = accent 稀释填充 + 左侧 2px 竖条（沿用现有选中视觉）。
- 目录缺失：warn 标记，禁止开终端，可重定位 / 移除。

### 4.2 终端区（`TerminalView`）

- 顶部标签栏：每个终端一个标签（标题 = OSC 标题，缺省 = 工作区名）+ 状态点（运行中 / 已退出）+ `×`；右侧 `＋`。
- `＋`：在**当前选中工作区**新建终端；未选中时用第一个项目的第一个工作区；无项目 → 提示添加项目。
- 空态：无终端时给「选择一个工作区开始」+ `＋` 引导。
- 终端全尺寸铺满（`FitAddon`）；omp 退出后浮层显示「omp 已退出」（异常退出才带退出码）+ 重启 / 关闭按钮。
- 关闭运行中的终端：ConfirmDialog 二次确认（防误杀进行中的 agent）；已退出的直接关。
- 键盘：`⌘T` 新建终端，`⌘W` 关闭当前终端，`⌘1..9` 切换标签。
- **标签栏与设置标签（收口后调整）**：标签栏（`TerminalTabs`）在主区顶部**常驻**——终端标签 + 设置标签（单例）+ `＋`；设置**不是主区替换**，而是与终端并列的一个标签：`<TerminalView visible={!settingsTabActive} />` + `{settingsTabOpen && <SettingsPage visible={settingsTabActive} />}`。面板只切显隐——条件渲染（早期实现）会在打开设置时卸载整个终端区，`TerminalPane` 的清理 effect 随即 `pty_kill`，**正在跑的任务被直接打断**；现在隐藏期间面板按非活跃处理（不量尺寸 / 不推 resize），切回时按「切到本 tab」重新 fit + 聚焦，隐藏期间到达的输出照常进 xterm 缓冲，设置页的页签选择 / 滚动位置也保留（关标签才卸载）。左栏「设置」入口打开 / 聚焦该标签；`×` / ⌘W 关闭并回到上次的终端标签；终端关闭确认（`ConfirmDialog`）挂在 App 层，设置标签激活时点终端标签的 `×` 也弹得出来。

### 4.3 会话弹窗（`SessionPopup`）

- 入口：项目行悬浮「会话」图标；弹窗 = 居中浮层（复用 ConfirmDialog 的浮层语言）。
- 列表：该项目（含全部 worktree）的会话，按时间倒序；行 = 标题 + 时间 + 归档角标；
- 行操作：点击行 → **新终端 `omp --resume <id>` 恢复**（cwd = 会话原 cwd；目录不存在则禁用并提示）；
  「归档 / 恢复」按钮行内直发；「删除」走 ConfirmDialog（不可恢复黄字）。
- 弹窗内不做搜索（会话搜索的功能与页面随聊天界面一并退场；需要时从设置 › 已归档对话里管）。

### 4.4 保留但挪位

- 应用更新：顶栏 `UpdateBell` 退场 → 左栏底部「设置」入口上的小点角标（有更新时）；设置页「应用更新」区保留。
- omp 不可用：`HealthBanner` 保留（终端也依赖 omp）。
- 诊断：设置 › 通用 的 omp 诊断区保留。
- `tools.approvalMode`：原 `PermissionBadge` 入口退场 → 补进通用设置白名单（同义入口唯一性不破）。

## 5. 保留 / 退场清单

### 保留
- 左栏：项目 CRUD、重定位、目录缺失态、设置/语言/皮肤底部行。
- 会话：jsonl 扫描（窗口 + 补扫）、归档体系（弹窗 + 设置页）、批量逻辑（`sessionBatch`）。
- 设置页六页签全部：通用（40 项 + omp 诊断）、供应商、模型（角色 / 失败转移 / 目录）、记忆、使用统计、已归档对话。
- 覆盖层（projects / archived / notes）、omp 定位与自检、更新链路、语言与皮肤三档。

### 退场（代码删除）
- 聊天渲染：`Thread` / `Composer` / `AssistantText` / `ToolRow` / `ApprovalCard` / `UiRequestCard` / `MentionChips` / `StatusBar` / `PlanCard` / `ThinkingFold` / 全部 `pickers` / `SlashMenu` / `MentionList` / `ContextBar` / `ContextMeter` / `UsageLimits`。
- 数据链路：`lib/viewmsg` / `mergeEvents` / `useSessionEvents` / `toolLine` / `mentions` / `attachments` / `thinking` / `slashCommands` / `exportMd` / `ctxUsage` / `usageLimits` / `context` / `sessionOpen`（改写为 resume-终端版）。
- Rust：`runtime.rs`、`quota.rs`、`context.rs`、`commands` 内全部 RPC 会话命令、`fake-omp.mjs` 与 `e2e:rpc`（RPC 不再被壳驱动）。
- 会话级权限覆盖（`sessionApproval`）：RPC spawn 参数退场后无消费方；overlay 键保留兼容读取，新写入停止。

## 6. 完成口径（2026-09-17 收口）

- `pnpm check` 全绿：typecheck + lint（0 警告）+ **45 项单测** + `e2e:ipc`（**41 命令 × 双向一致**：
  `ipc.ts` ↔ `main.rs` ↔ 实现；`api.ts` 不再写裸命令名字符串）+ `pnpm build` 生产构建通过。
- `cargo test` **79 项全绿**（另有 2 项 `#[ignore]` 慢测试，`--ignored` 手动跑、**全过**）：
  `pty.rs` 的增量解码 8 项 + 真实 PTY 写读回环 + 「忽略 SIGHUP 的进程必须被强杀兜底收掉」+
  真实 `omp` TUI 端到端（spawn → 读到 TUI 画面 → kill → wait，3.3s）；
  `git_info.rs` 的 worktree 解析 + 真实仓库 `git worktree add` 端到端；
  `commands/mod.rs` 的归属 / 归档 / 窗口单测；设置 / 记忆 / 用量 / 供应商既有单测全数保留。
- **界面全流程核对**（`pnpm dev` + 浏览器注入 IPC mock，含 **Channel 协议**：
  `transformCallback` 回调表 + `{index, message}` 帧格式；mock 状态写进 `document.documentElement.dataset` 读回）：
  工作区树渲染（项目 / 主目录 / worktree 徽章）、点工作区开终端（spawn opts cwd 正确、fit 实测 124×41）、
  xterm 渲染 PTY 输出、多 tab（工作区间切换）、`⌘T` 新建 / `⌘W` 关闭（运行中 → ConfirmDialog 确认；
  已退出 → 直关）、退出浮层（「omp 已退出」+ 重启 / 关闭；重启触发第二次 spawn）、
  会话弹窗（列表 / 归档角标 / 归档·恢复·删除按钮）、深浅两套皮肤截图。
- **真机（Tauri WebView）交互级验证未做**：本机屏幕录制 / 辅助功能权限不可用（`computer.capabilities()`
  三项全 denied），无法对真实窗口截图 / 点按。窗口本身以 `pnpm tauri:dev` 启动运行无 panic 为据；
  PTY 与 omp TUI 的真实链路由 Rust 侧集成测试独立覆盖（不依赖 WebView）。
  **留待有权限的环境复验的点**：WebView 里 xterm 的渲染观感、Channel 在真实 IPC 下的吞吐、⌘ 快捷键在 WKWebView 的送达。
- 文档：`README`、`AGENTS.md`、`CHANGELOG`、`design-system/MASTER.md` 已同步；V1–V10 文档与 `rpc-memo.md`
  头部标注为历史存档。

### 6.1 实施记录（与设计稿的偏差）

- `quota.rs` / `context.rs`：按设计**删除**（含前端 `ctxUsage` / `usageLimits` / `ContextMeter` / `UsageLimits`）。
- `search_sessions`（V2 M7b）与 `session_scan.rs` 的搜索辅助函数：随左栏会话列表一并**删除**。
- `sessionApproval` 覆盖层字段：保留读取形状（旧 overlay 兼容），新写入停止（`set_session_approval` 删除）。
- `rename_session_note`（会话备注改名）：V11 无界面入口，命令删除（旧备注仍会被 `display_title` 读取显示）。
- 前端删除的组件 / 模块约 30 个文件（`components/thread|composer|pickers/*`、`lib/{viewmsg,mergeEvents,useSessionEvents,toolLine,mentions,attachments,slashCommands,fileKind,ctxUsage,usageLimits,context,sessionOpen,openPath,search,rpc-types}`、
  `components/update/UpdateBell` 等）；`UpdateDialog` 保留并由 App 常驻挂载。
- Tauri 插件收敛：删 `tauri-plugin-shell`（残留未用）、`tauri-plugin-store`（overlay 用 std::fs）、
  `tauri-plugin-notification`（`useTaskNotifications` 退场后无消费者）；`capabilities/default.json` 同步。

### 6.2 收口后修复与调整（2026-09-17）

- **打开设置页不再打断终端里跑着的任务**：主区从条件渲染（`settingsOpen ? <SettingsPage /> : <TerminalView />`）改为**终端区常驻挂载 + 设置页叠加**（口径见 §4.2）。核对（`pnpm dev` + 注入 IPC mock 驱动浏览器）：开终端收到输出后打开设置——`pty_kill` 计数不变、`.xterm` 仍在 DOM（`display:none` 隐藏）、spawn 不增加；设置页开着时继续推入的输出在返回后完整渲染（`TASK-RUNNING-1` + `TASK-RUNNING-2`）；返回触发 fit + `pty_resize`（139×46）。回归：关闭运行中终端仍弹二次确认并 kill（计数 +1）。反证：直接卸载终端树（`root.unmount()`，即旧条件渲染的等价路径）立即触发 `pty_kill`——确认根因。（该实现随后演进为标签栏里的设置标签，见下条。）

- **设置改为标签栏里的单例标签**（同日，收口后调整）：终端标签与设置标签并列于**常驻标签栏**（口径见 §4.2）；store 的 `settingsOpen` 拆成 `settingsTabOpen` / `settingsTabActive` + `openSettingsTab` / `closeSettingsTab`，切标签时 `activeTerminalId` 保持不变（作为「上次的终端」）。核对（注入 IPC mock）：开终端 → 打开设置（标签栏两枚标签、设置高亮、xterm 隐藏而 `pty_kill` 计数不变）→ 点终端标签切回（xterm 可见）→ 设置页内部页签（已归档对话）切走再切回仍保留 → ⌘W 关闭设置标签 → 设置标签激活时点终端标签的 `×` 弹确认、确认后 `pty_kill` +1 且无终端时自动切到设置标签；截图核对（标签栏两态）。

- **设置页改为左侧竖向菜单**（同日，收口后调整）：五个入口从顶部横排页签改为 176px 导航列（标题 / 菜单——副标题「omp 诊断、应用更新……」与底部「返回」按钮按用户口径删除，关闭设置标签走标签栏的 × / ⌘W），右侧内容区为唯一滚动容器（`role="tabpanel"` + `aria-labelledby`）；设置页整体宽 `max-w-3xl` → `max-w-4xl`。UI 口径同步 `design-system/MASTER.md`（§3 行长 / §4 布局 / §8 组件表）。核对（注入 IPC mock）：竖向排布（`aria-orientation="vertical"`、五项同列 x、31px 行高、y 递增）、选中态 `bg-active` + semibold、切换后 `tabpanel` 的 `aria-labelledby` 跟随（general → archived）、导航列只剩标题与菜单（无副标题、无「返回」按钮，页内无第二个关闭入口）；截图核对。

### 6.3 视觉精修（2026-09-17）

- 终端工作区保留原业务架构，视觉升级为冷灰/石墨蓝外壳与内嵌工作面。桌面主区外沿 8px、16px 圆角，标签栏升至 48px 且空态也常驻；窄窗提供项目抽屉入口。
- 项目侧栏增加品牌字标与工作区层级，40px 红绿灯占位；项目头 36px、分支行 32px，分支图标配选中左线。底部设置/语言/主题仍为一行。
- 设置页使用统一图标导航、内容卡片与表单语言，最大宽度 `max-w-6xl`；按容器宽度在 176px 文字导航 / 44px 图标导航间切换。弹窗、危险确认、统计与空态同步精修。细节以 MASTER 为现行口径，前文旧尺寸仅作演进记录。
- 验证：`pnpm check` 80 单测 / 43 IPC 命令与 `pnpm build` 通过；隔离 IPC 浏览器预览覆盖深浅色、中英文、375/768/1440px 五页无横向溢出、292px 英文侧栏底部单行、供应商弹窗全视口遮罩及连续输入。终端在设置隐藏期间保活且输出缓冲返回后完整显示；未声称完成原生 WebView 实测。

### 6.4 现有功能交互打磨（2026-09-17）

- 设置页纵向导航增加上下方向键/Home/End，隐藏面板用 inert 隔离焦点、返回恢复；终端继续保持挂载。
- `useDropdown.ts` 内统一三种模态的 Tab 圈定、焦点恢复与最上层 Esc；会话嵌套删除确认不再连带关闭父弹窗，异步操作期间防重复提交。下拉重渲染不重置焦点。
- 模型设置的数据安全、错误恢复与验证详见 `docs/v12-schedule.md` §8。前端 97 测试、IPC 43 命令与生产构建通过；后端 166 通过、5 项慢测试跳过。
- 隔离浏览器复验终端切设置：隐藏期间写入的 `DURING-SETTINGS` / `STILL-RUNNING` 返回后可见，切换前后 `pty_kill` 计数不变；不宣称原生 WebView 实测。

### 6.5 终端标签的 π 状态标（2026-09-18）

- **标签 = π 状态标 + 会话名**：去掉终端图标，标签的 π **颜色即 omp 的运行状态**——工作中 `accent` + `animate-pulse`、等待确认 `warn`、等待输入 / 正常退出 `ok`、异常退出 / 启动失败 `danger`、未知 `faint`。状态文字进 `sr-only`（屏幕阅读器）并作为 π 的悬停提示。
- **上游口径（omp 18.2.4 二进制实测核对）**：标题模块（`tui.titleState` 默认开）按 `π <分隔符> <会话名>` 组合——工作态转轮每 80ms 换一帧（`tui.titleSpinner` 四套：braille / pulse / dots / line；WSL / win32 为静态 `:`），`!` = agent 在等你（审批 / `ask` 工具挂起，`R6("attention")`），`>` = 轮到你；关掉 `tui.titleState` 是 `π: <会话名>`（无状态）。另一条可选通道 `terminal.showProgress`（OSC 9;4，**默认 false**）只表达「在跑」，信息量少于标题，未采用。
- **结构**：新增 `lib/termTitle.ts`（纯函数 + 5 项单测）解析标题成 `{phase, label}`；`TerminalView` 增 `state: TermTabState`、`title` 语义收成「展示用会话名」；`setTerminalTitle` 在 store 边界解析（转轮换帧不再触发整表更新）、`setTerminalStatus` 由退出码落 `exited` / `failed`、新增 `failTerminal`（spawn 失败落红）；`TerminalTabs` 换成 π；字典新增 `termState*` 5 键 × 2 语言。
- **验证**（`pnpm dev` + 注入 IPC mock，经 xterm 真实解析 OSC 0 字节驱动）：刚 spawn = faint / 无文字 → `π ⠋ 会话甲` = accent + `animate-pulse` + Working → 转轮换帧不抖动 → `π ! 会话甲` = warn + Waiting for confirmation → `π > 会话甲` = ok + Ready for input → `π: 会话甲` = faint 且名字仍剥前缀 → `exit 0` = ok + Exited（此后标题不再改状态）→ 第二终端 `exit 3` = danger + Failed → spawn 抛错 = danger + 终端内「Failed to start」；5 个终端同屏深浅两套皮肤截图核对（14px 状态标在 32px 标签内不溢出 `fits=true`）；`prefers-reduced-motion: reduce` 下呼吸动画被全局规则钳到 0.01ms / 1 次。`pnpm check` 全绿（103 单测）。

### 6.6 终端视图按工作区过滤（2026-09-23）

- **口径**：右栏（标签栏 / 面板 / `⌘1..9`）只显示**当前工作区**的终端——过滤键 = `activeWorkspacePath`，条件是 `cwd` 精确匹配（`lib/terminalScope.ts` 的 `terminalsInWorkspace`）。左栏选中 `login` 分支就只列 login 目录的终端；别的分支的终端照常跑，只是不在这个视图里（隐藏 = CSS 显隐，pane 仍挂载、不 kill）。
- **一致性不变式**：`activeTerminalId` 要么 null、要么落在 `activeWorkspacePath` 目录里。四处维持：`openTerminal` / `focusTerminal` 同步过滤键；`closeTerminal` 在**同工作区**的相邻终端里收敛（同工作区关完 → 空态且选中项不动，不跳到别的分支）；`loadWorkspaces` 选中项失效回退时同步收敛激活终端（否则视图会空掉）。
- **不丢终端**：左栏工作区行的状态区新增**终端数徽章**（`BrowserTerminal` + 数量，有运行中的上 `accent`；计数走 `countTerminalsIn` / `countRunningTerminalsIn`），`⌘⇧K` 快速切换仍全局列出所有终端与工作区，跳过去会带着左栏选中一起切。
- **空态**：`TerminalView` 的空态判定从 `terminals.length === 0` 改成「当前工作区没有激活终端」；`activeWorkspacePath == null`（一个可用工作区都没有）时**不过滤**——那种局面下藏终端只会让人以为终端丢了。`store` 的 `setActiveWorkspace`（无人调用的死代码）删除。
- **验证**：`pnpm check` 全绿（新增 `terminalScope.test.ts` 2 项、`stores/app.test.ts` 2 项、`workspaces.test.ts` 1 项、`App.test.tsx` 的 `⌘1..9` 用例；共 176 单测）。`pnpm dev` + 注入 IPC mock（工作区 main / login）全流程核对：点 main 开终端 → 标签仅 `/tmp/alpha`；点 login → 标签仅 `/tmp/alpha-login`（main 的 pane `display:none`，`pty_kill` 计数不变）；点回 main → 聚焦既有终端（`pty_spawn` 仍 2 次）；`⌘1` 在 login 视图不切到别的分支；`⌘T` 落在当前工作区（`cwd=/tmp/alpha-login`）；关掉 login 最后一个终端 → 空态 + 选中项留在 login + 该行徽章消失；`⌘⇧K` 列出 3 个终端 + 2 个工作区；键盘输入经 `pty_write` 到达（8 次）。截图核对两套选中态（main 行 `main 1` + login 行 `worktree 2`／反向）。

## 7. 明确不做（用户已确认）

- 编辑器 / 文件树 / diff 审查 / 浏览器 / SSH / 移动端 / PR 集成（Orca 的「复杂」部分）。
- 终端滚动缓冲区持久化（重启不恢复 tab）。
- 终端与 jsonl 会话的运行时绑定（tab 不追踪 session id；「运行中」标记退场）。
- 多窗口、分屏（split）——单栏多标签足够。
