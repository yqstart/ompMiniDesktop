# 排期 4：右栏工作台（文件目录 + 项目脚本 + 多开终端）

> 状态：**已实施**（2026-10-16，随 `0.2.0` 发布前记录）。锚点 = 用户口径「右栏不要现在的上下文信息，改成文件目录和终端」（V42），随后按「为项目配置快捷执行的终端命令、识别项目语言自动出脚本、也可自定义」（V43）补第三个页签，再按「终端 tab 下要能多开，有时不止跑一个脚本」把终端做成标签行多开（V44）；形态参照 DeepSeek Harness 的工作区文件 / 终端入口。
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
| `components/workbench/WorkbenchPanel.tsx` | 右栏容器：三个页签（文件 / 脚本 / 终端）+ 关闭键 + 左缘宽度拖拽 + **终端标签行**（多开切换 / 新建 / 关闭）；**常驻挂载、只切显隐** |
| `components/workbench/FileTree.tsx` | 只读目录树：懒加载一层、变更标色、打开、引用到输入框 |
| `components/workbench/ScriptsPanel.tsx` | 项目脚本（识别结果，只读）+ 自定义脚本（增删改）+ 点击新开终端跑它 |
| `components/workbench/TerminalPane.tsx` | 一个终端实例：xterm.js + 到 PTY 的双向管道 + 消费 `pendingTerminalRun{terminalId}` |
| `lib/termTheme.ts` | 把 `--term-*` 的当前值读成 xterm 的 `ITheme`（皮肤切换跟色） |
| `src-tauri/src/pty.rs` | PTY 终端：`terminal_spawn` / `terminal_write` / `terminal_resize` / `terminal_kill` + `kill_all` |
| `src-tauri/src/workspace_fs.rs` | `list_dir`：单层目录列举；树根请求顺带返回 git 仓库根 |
| `src-tauri/src/project_scripts.rs` | `discover_scripts`：**只读**识别项目脚本（行扫描解析，一律不引 TOML / YAML 依赖） |
| store 字段 | `workbenchOpen` / `workbenchTab` / `workbenchWidth` / `terminals` / `activeTerminalId` / `terminalSeq` / `customScripts` / `pendingTerminalRun`（+ `terminalRunSeq`）与十二个动作 |
| 共享面 | `shared/ipc.ts` 六条命令常量、`shared/api.ts` 六个方法、`shared/types.ts` 六个类型 |
| 依赖 | `portable-pty 0.9`（Rust）、`@xterm/xterm 6` + `@xterm/addon-fit 0.11`（前端） |
| 样式 | `index.css` 的 `--term-*` 16 色 token（浅 / 深两套） |

## 2. 口径（不许违背）

1. **右栏只有一个形态**：工作台（文件 / 终端双页签），停靠在主区第三栏；`⌘⇧G` 开关、**每次启动都收起**（2026-10-19 用户口径，不恢复上次展开态）。
2. **常驻挂载**：收起右栏 / 切页签 / 切设置视图都只改 `hidden`——终端进程、xterm 回看缓冲、文件树展开位置都不丢（`WorkbenchPanel` 不许写成 `if (!open) return null`）。
3. **目标目录 = 当前会话 cwd**（`resolveContext`），会话切换即跟着切；没有会话时两个页签都给空态文案。
4. **终端多开、标签切换**（`store.terminals` + `activeTerminalId`，V44 用户口径：不分屏）：终端页签内一条标签行（切换 / `+` 新建 / 关闭），每个标签一个常驻 shell；上限 6、超出淘汰最旧的**非活跃**项（组件卸载 = `terminal_kill`）；终端在创建时定格 cwd，**切会话不改目录也不被杀**（切会话只影响「新建终端用哪个目录」）；应用退出统一 `pty::kill_all`。点脚本**每次新开一个终端**跑它（标签名 = 脚本名）。
5. **高频字节流只进 xterm**，不进 store（与聊天流式同一治理口径）。
6. **文件树只读**：`list_dir` 不写盘、不读文件内容；打开交给系统默认程序（`openPath`，失败退 `revealItemInDir`）；「引用到输入框」与 `⌘⇧P` 引用浮层共用 `appendReference` 这一条注入口径。
7. **终端不许长出终端形态的会话模型**：不做 π 标题解析、不做目录行 / 标签栏、不做覆盖层注入——一个终端就是「一个 cwd 的登录 shell」。
8. **焦点与尺寸**：隐藏态不 fit、不推尺寸；可见时才 `fit()` + `terminal_resize` + `focus()`（隐藏态测不到尺寸是 xterm 的既有约束）。终端容器**底部留 24px**（`absolute inset-x-0 top-0 bottom-6`）——最后一行不贴面板底，且必须用「抬高容器」而不是 `padding-bottom`：FitAddon 算可用高度时会再减一次容器 padding（`getComputedStyle().height` 已是 content 高），padding 会双重扣减。
9. **宽度可拖**（260–640，默认 320，localStorage 持久化）：手柄在右栏左缘，交互与左栏 `SidebarShell` 同一套（3px 隐身热区 / 悬停与拖拽中高亮 / 手柄聚焦时 ←→ 每次 8px 微调）；宽度按「指针到右栏右缘的距离」算（不受主区外边距影响），并以「给中列留 420px」为窗口上限——窗口变窄自动收回超限值，不许把消息列挤没。
10. **脚本页签（V43）**：**项目脚本只读识别、自定义脚本只存本应用偏好**——后端 `discover_scripts` 不执行命令、不写盘；自定义脚本按 cwd 存 `omp.scripts.v1`，不往用户仓库写文件。**识别口径**：`package.json`（包管理器按锁文件 / `packageManager`）、`Cargo.toml`（+ `.cargo` 的 `[alias]`）、`go.mod`、`manage.py` / `pyproject.toml`、`Makefile` / `justfile` / `Taskfile` 一律**行扫描**（不为几个清单文件引 TOML / YAML 依赖；认不出的写法就是没有，不猜）。**执行口径**：面板只投递（`runInTerminal` → `pendingTerminalRun`），由该 cwd 的 `TerminalPane` 在 PTY 建好后写进 PTY——写入走 `terminal_write_ready`：后端等 shell 进入行编辑器 raw 模式（`pty.rs` 的 `shell_ready`，8s 超时兜底）再落字，否则 cooked 期写入会被 tty 回显、行编辑器再重画一遍，命令在终端里出现两遍（`consumedRunRef` 防重复投递）——脚本面板自己不 spawn 进程；终端没开过就顺带把右栏与终端页签拉起来。

## 3. 验收清单

1. `pnpm check`（typecheck / lint / test / e2e:ipc）与 `cargo test --manifest-path src-tauri/Cargo.toml` 全过。
2. 残留审计：`grep -rn "contextPanelOpen\|ContextPanel\|panelSources" src/` 无命中（文档里的历史说明除外）。
3. 功能冒烟（桌面壳）：
   - `⌘⇧G` 展开 / 收起右栏；顶栏右端键与关闭键同口径；
   - 文件页签：列目录 → 展开子目录（懒加载）→ 点文件打开 → 行尾「引用到输入框」写进草稿文本框 → 变更徽标与 `git status` 一致；
   - 终端页签：起 shell（`echo $SHELL` / `pwd` 对得上会话目录）→ 跑 `ls`、`vim` 之类全屏程序 → 拖窗 / 切页签后尺寸正确 → `exit` 后「重新打开」→ 切会话再切回来，原 shell 状态还在；
   - 收起右栏后终端里的长命令继续跑（常驻挂载的证据）；
   - 拖右栏左缘调宽：终端跟着 reflow（列数变化，`stty size` 对得上）、文件树行不破版；把窗口拉窄，右栏自动收回超限宽度；重开应用宽度还是拖完的值；
   - 脚本页签：进面板看到识别到的生态与脚本（拿一个 Node / Rust 项目对一眼 `package.json` / `Cargo.toml`）→ 点某条脚本：右栏切到终端页签、**新开一个标签**并自动执行 → 再点另一条：第二个标签各跑各的（互不打断）→ 自定义脚本新建一条再点运行；删掉后行消失、重开应用不复活；
   - 终端多开：`+` 新建 → 标签行来回切（各自 shell 的状态与回看缓冲都在）→ 关掉其中一个不影响别的（`ps` 里对应 shell 消失）→ 切到别的会话再回来，标签行不动；开到第 7 个时最旧的非活跃标签被淘汰。
