# 排期 4：右栏改造（文件目录 + 终端）

> 状态：**已实施**（2026-10-16，随 `0.2.0` 发布前记录）。锚点 = 用户口径「右栏不要现在的上下文信息，改成文件目录和终端」，形态参照 DeepSeek Harness 的工作区文件 / 终端入口。
> 性质：**右栏整栏替换** + 两条新数据链路（只读目录列举、PTY 终端）。左栏 / 中列 / 会话运行时 / 设置面不动。
> 前置阅读：`../AGENTS.md`（工程导航）、`roadmap.md`、`v1-schedule.md`（§1 的删除清单——本次是它唯一的例外口）。

## 1. 范围

### 1.1 移除（右栏旧形态）

| 模块 | 说明 |
|---|---|
| `components/panel/ContextPanel.tsx` | 右栏容器 + 区块导航浮层（v2 三栏的第三栏） |
| `components/panel/PanelSection.tsx` | 区块外壳（小标题 + 分隔线） |
| `components/panel/ChangesSection.tsx` | 「变更」区块（分支 / dirty / ±行数 / 提交推送入口） |
| `components/panel/ProgressSection.tsx` | 「进度」区块（任务清单停靠完整视图） |
| `components/panel/SubagentsSection.tsx` | 「子代理」区块（清单 + 输出内联展开） |
| `components/panel/SourcesSection.tsx` + `lib/panelSources.ts` | 「来源」区块与它的数据源（最近读入上下文的文件） |
| 上述组件的测试 | `ContextPanel.test.tsx` / `ChangesSection.test.tsx` / `SubagentsSection.test.tsx` / `panelSources.test.ts` |
| `store.contextPanelOpen` | 更名 `workbenchOpen`（localStorage 键 `omp.contextPanel.v1` 作废） |

**数据层不删**：`subagentsBySession`（事件面 + `get_subagents` 回读）、`plansBySession`（todo 帧 + `get_state.todoPhases` 回读）、`get_subagents` / `get_subagent_messages` / `cancel_subagent` 命令与提交 / 推送链路全部保留——它们各自还有别的消费者（提交键在卡顶行、任务清单在消息列浮卡），子代理事件面等下次形态决策再定去留。若后续要恢复「子代理清单」入口，数据是现成的。

### 1.2 新增

| 模块 | 说明 |
|---|---|
| `components/workbench/WorkbenchPanel.tsx` | 右栏容器：两个页签（文件 / 终端）+ 关闭键；**常驻挂载、只切显隐** |
| `components/workbench/FileTree.tsx` | 只读目录树：懒加载一层、变更标色、打开、引用到输入框 |
| `components/workbench/TerminalPane.tsx` | xterm.js 实例 + 到 PTY 的双向管道（一 cwd 一个终端） |
| `lib/termTheme.ts` | 把 `--term-*` 的当前值读成 xterm 的 `ITheme`（皮肤切换跟色） |
| `src-tauri/src/pty.rs` | PTY 终端：`terminal_spawn` / `terminal_write` / `terminal_resize` / `terminal_kill` + `kill_all` |
| `src-tauri/src/workspace_fs.rs` | `list_dir`：单层目录列举；树根请求顺带返回 git 仓库根 |
| store 字段 | `workbenchOpen` / `workbenchTab` / `workbenchWidth` / `terminalCwds` + 四个动作 |
| 共享面 | `shared/ipc.ts` 五条命令常量、`shared/api.ts` 五个方法、`shared/types.ts` 四个类型 |
| 依赖 | `portable-pty 0.9`（Rust）、`@xterm/xterm 6` + `@xterm/addon-fit 0.11`（前端） |
| 样式 | `index.css` 的 `--term-*` 16 色 token（浅 / 深两套） |

## 2. 口径（不许违背）

1. **右栏只有一个形态**：工作台（文件 / 终端双页签），停靠在主区第三栏；`⌘⇧G` 开关、**默认收起**、持久化。
2. **常驻挂载**：收起右栏 / 切页签 / 切设置视图都只改 `hidden`——终端进程、xterm 回看缓冲、文件树展开位置都不丢（`WorkbenchPanel` 不许写成 `if (!open) return null`）。
3. **目标目录 = 当前会话 cwd**（`resolveContext`），会话切换即跟着切；没有会话时两个页签都给空态文案。
4. **终端按 cwd 保留**（`store.terminalCwds`，上限 4）：切会话不杀上一个 shell，超出上限淘汰最旧的（组件卸载 = `terminal_kill`）；应用退出统一 `pty::kill_all`。
5. **高频字节流只进 xterm**，不进 store（与聊天流式同一治理口径）。
6. **文件树只读**：`list_dir` 不写盘、不读文件内容；打开交给系统默认程序（`openPath`，失败退 `revealItemInDir`）；「引用到输入框」与 `⌘⇧P` 引用浮层共用 `appendReference` 这一条注入口径。
7. **终端不许长出终端形态的会话模型**：不做 π 标题解析、不做目录行 / 标签栏、不做覆盖层注入——一个终端就是「一个 cwd 的登录 shell」。
8. **焦点与尺寸**：隐藏态不 fit、不推尺寸；可见时才 `fit()` + `terminal_resize` + `focus()`（隐藏态测不到尺寸是 xterm 的既有约束）。
9. **宽度可拖**（260–640，默认 320，localStorage 持久化）：手柄在右栏左缘，交互与左栏 `SidebarShell` 同一套（3px 隐身热区 / 悬停与拖拽中高亮 / 手柄聚焦时 ←→ 每次 8px 微调）；宽度按「指针到右栏右缘的距离」算（不受主区外边距影响），并以「给中列留 420px」为窗口上限——窗口变窄自动收回超限值，不许把消息列挤没。

## 3. 验收清单

1. `pnpm check`（typecheck / lint / test / e2e:ipc）与 `cargo test --manifest-path src-tauri/Cargo.toml` 全过。
2. 残留审计：`grep -rn "contextPanelOpen\|ContextPanel\|panelSources" src/` 无命中（文档里的历史说明除外）。
3. 功能冒烟（桌面壳）：
   - `⌘⇧G` 展开 / 收起右栏；顶栏右端键与关闭键同口径；
   - 文件页签：列目录 → 展开子目录（懒加载）→ 点文件打开 → 行尾「引用到输入框」写进草稿文本框 → 变更徽标与 `git status` 一致；
   - 终端页签：起 shell（`echo $SHELL` / `pwd` 对得上会话目录）→ 跑 `ls`、`vim` 之类全屏程序 → 拖窗 / 切页签后尺寸正确 → `exit` 后「重新打开」→ 切会话再切回来，原 shell 状态还在；
   - 收起右栏后终端里的长命令继续跑（常驻挂载的证据）；
   - 拖右栏左缘调宽：终端跟着 reflow（列数变化，`stty size` 对得上）、文件树行不破版；把窗口拉窄，右栏自动收回超限宽度；重开应用宽度还是拖完的值。
