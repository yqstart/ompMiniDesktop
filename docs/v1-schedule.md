# 0.1.0 形态收敛（终端形态下线）

> 目标：终端形态的全部代码与概念退场；聊天形态成为唯一形态，**承接原有全部有效能力**。
> 性质：以删除为主的版本。数据层（会话 runtime、扫描、覆盖层、git、设置面）不动。
> 前置阅读：`../AGENTS.md`（现状结构）、`roadmap.md`。

## 1. 删除范围

### 1.1 前端——删除

| 模块 | 说明 |
|---|---|
| `components/terminal/` 下 `TerminalView` / `TerminalTabs` / `TerminalPane` | 终端面板区 / 标签栏 / xterm 实例与 PTY 管道 |
| `components/sidebar/WorkspaceSidebar` | 终端形态左栏（工作区树） |
| `components/sidebar/ProjectGroup` | 终端形态项目组 / 目录行 / 徽章体系 |
| `components/sidebar/SessionPopup` | 终端会话弹窗（resume 到终端） |
| `components/AppModeToggle` | 形态切换控件（形态唯一后无意义） |
| `lib/termTheme.ts` / `termTitle.ts` / `termRename.ts` / `termRef.ts` / `termWheel.ts` / `termIme.ts` / `termAppearance.ts` / `termInput.ts` / `terminalScope.ts` | 终端专属逻辑（配色镜像 / OSC 标题解析 / 注入改名 / bracketed paste / 回看滚动 / IME 镜像 / 皮肤通知 / 漏键补丁 / 范围过滤） |
| store 终端域 | `terminals` / `activeTerminalId` / `collab` / `spawnSeq` 等终端字段与动作 |
| App 装配 | 终端区容器、终端关闭确认 `ConfirmDialog`、⌘T/⌘W/⌘1..9 的终端语义、`appMode` 及其 localStorage |
| `index.css` | `.xterm` / IME 合成视图 / 滚动 (`--term-*`) 等终端样式段 |
| 依赖与资产 | `@xterm/xterm`；`public/fonts/omp-nerd-icons.woff2` 与 `scripts/build-nerd-icons-font.py`（终端图标字体，聊天形态不消费）；`scripts/e2e-ipc-selfcheck.mjs` 中 PTY 命令条目 |
| 测试 | 全部 `term*.test.*`、PTY 相关前端测试 |

### 1.2 后端——删除

| 模块 | 说明 |
|---|---|
| `src-tauri/src/pty.rs` | PTY 进程表 + spawn 参数组装（含 V33 覆盖层注入中服务终端的部分） |
| 命令注册 | `main.rs` / `lib.rs` 的 PTY 命令面与退出路径收尾 |
| `commands/mod.rs` | `pty_spawn` / `pty_write` / `pty_resize` / `pty_kill` / `pty_list` 等命令 |
| 依赖 | `portable-pty` |
| 共享常量 | `shared/ipc.ts` 与 `shared/api.ts` 的 PTY 命令常量 |

## 2. 迁移范围（能力不许回退）

| 能力 | 现状位置 | v1 处置 |
|---|---|---|
| 工作区容器（新建 / 编辑 / 删除 / 成员） | 聊天左栏已有（`ChatSidebar` + `WorkspaceGroupDialog`） | 保留不动 |
| 添加 / 移除项目 | 聊天左栏标题行已有 | 保留不动 |
| **项目拖拽排序** | `lib/projectDrag.ts` + `WorkspaceSidebar` 控制器 | **迁移**：拖拽控制器搬进 `ChatSidebar`（纯逻辑已独立，UI 采用现成幽灵卡 / 插入线） |
| 跨项目文件引用（⌘⇧P） | `ReferencePicker` 两形态共用 | 保留：注入目标只剩聊天草稿（`refPickerTarget` 收敛为单一语义） |
| 会话打开 / resume / 归档 / 删除 | `lib/sessionOpen.ts` + `ChatSidebar` | 保留（移除 `resumeSessionInTerminal` 分支） |
| 提交 / 推送面板 | `CommitTaskPanel`（全局挂载） | 保留；入口 = `ContextBar` 提交键（终端目录行入口随终端退场） |
| 供应商用量 | `ProviderUsageDialog`（聊天顶栏 Gauge） | 保留（终端标签栏入口随终端退场） |
| 设置（七页签） | `SettingsPage`（聊天形态已可进） | 保留；进入 = 左栏底部「设置」，关闭 = 「返回聊天」/ ⌘W / 再点一次 |
| omp / 应用更新 chip、健康检查、omp 诊断 | `SidebarTop` / `HealthBanner` / `OmpUpdateDialog` | 保留不动 |
| 皮肤 / 语言切换 | `SidebarBottom` | 保留；`termAppearance` 通知逻辑随终端删 |
| git 徽章（dirty / ahead / behind） | 聊天项目分组头 | 保留 |
| 长按评估项 | `OmpPiMark`（π 字标） | 评估：聊天空态可复用则保留，否则删除 |

## 3. 收敛后的形态基线

- 启动即聊天形态；`appMode` 概念删除（localStorage 键清理）。
- 左栏 = `ChatSidebar`：工作区标题行（新建工作区 / 添加项目）+ 搜索 + 按工作区分段（项目分组 + 会话行 + 未归属）+ 拖拽排序 + 归档。
- 主区 = `ChatView`：TopBar（会话名 / 用量入口）+ Thread + StatusBar + Composer。
- 设置 = 设置视图（覆盖主区，`showClose` 语义保留）；「设置是标签」的旧口径作废。
- 快捷键（v1 收敛版）：⌘T 新建聊天、⌘W 关设置、⌘⇧P 引用工作区文件、⌘K 命令中心、⌘F 查找、⌘[ / ⌘] 会话导航。

## 4. 验收清单（逐项冒烟）

1. `pnpm check`（typecheck / lint / test / e2e:ipc）与 `cargo test --manifest-path src-tauri/Cargo.toml` 全过。
2. 残留审计：`grep -ri "terminal\|pty\|xterm"` 在 `src/`、`src-tauri/src/`、`scripts/` 无预期外命中（保留项：注释中的历史说明除外）。
3. 功能冒烟（全部走聊天形态）：
   - 新建会话 → 流式回复 → 工具卡 → 中断 → 队列（Tab 排队 / 插话 / 撤回）；
   - 审批卡 / ask 卡 / 计划目标行；
   - fork / 编辑重发 / 归档 / 恢复 / 删除；
   - 工作区新建 / 编辑 / 删除、项目添加 / 移除 / 拖拽排序；
   - ⌘⇧P 引用其他项目文件注入草稿；
   - 提交面板（快速轨 + 完整轨入口、勾选、提交）；
   - 设置七个页签可达；皮肤 / 语言切换；两个更新 chip；供应商用量弹窗。
4. 长会话滚动核对（30 轮以上）：消息列独立滚动、贴底跟随、回看不被拽底。
