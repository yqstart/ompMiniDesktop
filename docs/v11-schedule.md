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

## 7. 明确不做（用户已确认）

- 编辑器 / 文件树 / diff 审查 / 浏览器 / SSH / 移动端 / PR 集成（Orca 的「复杂」部分）。
- 终端滚动缓冲区持久化（重启不恢复 tab）。
- 终端与 jsonl 会话的运行时绑定（tab 不追踪 session id；「运行中」标记退场）。
- 多窗口、分屏（split）——单栏多标签足够。
