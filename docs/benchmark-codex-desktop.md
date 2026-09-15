# 对标调研：Codex Desktop

> 用途：v2「聊天对标」的布局 / 流式 / 聊天框依据，`design-system/MASTER.md` 的母版来源。
> 证据：OpenAI 官方文档（ChatGPT 桌面应用、Codex app、设置参考）、Codex app 截图 7 张（社区复刻项目 `Yrd980/codex-web-ui-clone` 的 `docs/references/codex-app-screenshots/`，逆向自真实应用）、同仓库 `DESIGN.md` 设计合约（对 Codex 设计语言的逆向整理）。整理日期：2026-10-14。

## 1. 产品概览

Codex 是 OpenAI 的编码代理，桌面形态（Codex app，集成在 ChatGPT 桌面应用中）定位为「并行处理 Codex 会话的专注工作台」：内置 worktree 支持、自动化工具与 Git 功能。界面由四大件构成：

- **项目侧栏（project sidebar）**：项目 → 会话树；
- **活动线程（active thread）**：消息流 + 底部 composer；
- **审查面板（review pane）**：Git 变更 / diff / PR 上下文；
- **任务侧栏（task sidebar）**：代理的计划、来源、生成物、子代理的实时结构化视图。

会话模型分两类：**Projects**（绑定项目目录，完整 Git 集成与沙箱）与 **Chats**（无项目的轻量会话，落在 `~/.codex/threads`，用于研究 / 规划 / 分析）。

## 2. 界面解剖

### 2.1 三栏布局（证据：01 / 06 / 07 截图）

| 区域 | 内容 | 细节 |
|---|---|---|
| 左栏（固定窄栏） | 顶部长驻命令：`New chat` / `Search` / `Plugins` / `Automations`；`Projects` 分组（项目名可折叠 → 会话行：标题 + 右侧相对时间 + 运行状态；当前会话高亮）；底部 `Settings` | 会话行有完成勾 / 运行转圈等状态标；行的悬停操作极简 |
| 中列 | 顶部会话标题栏（标题居中 + 左侧 `···` 菜单 + 右侧工具组：终端开关、面板切换、`+`、右栏开关）；消息流；底部 composer | 标题栏高而轻，工具组用图标钮 |
| 右栏（可开关） | `Environment` 卡：`Changes +X −Y` / 运行环境 / 分支 / `Commit or push` / `Create pull request` / PR 状态；`Progress`：任务清单（带状态圆圈，✓/○）；`Subagents`：子代理列表（名称 + 图标）；`Sources`：来源列表 | 面板内容按区块 + 分区标题组织，不做嵌套卡片 |

### 2.2 消息流表达（证据：01 / 02 / 06 / 07 截图）

- **用户消息 = 右侧小灰泡**（右对齐、窄宽、灰底）；**助手消息 = 通栏正文**（无气泡，Markdown 渲染，代码块带复制键、语言标签）。
- **摘要式折叠行**（内联在正文流中，单行、低噪声）：
  - `Worked for 5m 32s ›`——整轮时长行，可展开；
  - `Ran 3 commands`——命令批折叠行；
  - `Created 1 agent`——子代理创建行；
  - 文档卡：文件名 + `Document · MD` + `Open in ▾` 按钮（生成或引用的文件以卡片入流）;
  - 编辑卡：`Edited 2 files  +26 −1` + `Undo ↺` / `Review` 按钮 + 文件行（路径 + 行级 `+N −M`）。
- **运行中状态**：工具行内联转圈 + 命令原文摘要（`Running $=1; Get-Content …`）；正文流底部出现 `Thinking` 指示行；composer 发送键变停止方块。
- 流式期间工具行与正文同流推进，不弹窗、不打断阅读。

### 2.3 Composer（证据：01 / 02 / 06 截图）

- **大圆角输入卡**浮在底部（四周留白，与消息流同宽或略宽）。
- placeholder 为情景文案（新会话是引导语，跟进时是 `Ask for follow-up changes`）。
- **底部工具行**（单行）：
  - 左：`+`（添加上下文）；**执行模式菜单**（`Full access ▾`）——四项：`Ask before changes`（Ask before file changes.）/ `Edit automatically`（Edit files automatically.）/ `Plan mode`（Plan before editing.）/ `Full access`（Run with fewer confirmations.），每项 = 图标 + 名称 + 说明，当前项打勾；
  - 右：模型 + 思考档合并显示（`5.5 Extra High ▾`）；发送键（圆形 `↑`；运行中变停止方块）。
- 设置里可配：Enter 直接发送 / ⌘Enter 多行；**Follow-up behavior**——运行中发消息是 steer（插话）还是排队等下一轮。

### 2.4 命令与浮层（证据：05 截图）

- **Search chats**：搜索浮层，`Recent chats` 列表（标题 + 项目名 + `Ctrl+1..9` 编号快捷键），输入即过滤；
- **工具切换浮层**（右栏的切换器）：`Review`（`Ctrl+Shift+G`）/ `Terminal`（`` Ctrl+` ``）/ `Browser`（`Ctrl+T`）/ `Files`（`Ctrl+P`）/ `Side chat`（`Ctrl+Alt+S`）——每项图标 + 名称 + 右侧快捷键；
- **文件查看**：中列可切成「聊天 + 文件查看器」双列，文件查看器有面包屑（`WalnutPi > docs > x.md`）、Markdown 渲染、代码块复制键；文件树列有 `Filter files...`、目录树、Git 改动徽章（`M`）。

### 2.5 设置（证据：04 截图 + 官方设置文档）

- 打开方式：`⌘,` 或应用菜单；顶部 `← Back to app` 返回。**设置是独立视图，不是标签**。
- **左导航**：顶部 `Search settings...` 搜索框；分组：
  - `Personal`：General / Appearance / Configuration / Personalization / Keyboard shortcuts
  - `Integrations`：MCP servers / Browser / Computer use
  - `Coding`：Hooks / Connections / Git / Environments / Worktrees
  - `Archived`：Archived chats
- **控件语言**（General 页实拍）：
  - **卡片式单选项**（`Work mode`：For coding / For everyday work，横向卡片、选中描边）；
  - **开关行列表**（`Permissions`：Default permissions / Auto-review / Full access，逐行 = 名称 + 描述 + 开关）；
  - **行式下拉**（`General` 组：Default open destination / Agent environment，左名称右下拉）。
- 内容面（官方文档）：
  - General：Enter 发送行为、Prevent sleep、**Follow-up behavior（steer / wait）**；
  - Appearance：基础主题 + accent / 背景 / 前景颜色 + UI 与代码字体 + 分享主题；
  - Keyboard Shortcuts：**可按命令名或按键搜索、可改绑定、可重置**；
  - Notifications：回合完成通知的时机与权限；
  - Archived chats：带日期与项目上下文，`Unarchive` 恢复；
  - Personalization：AGENTS.md 指令、Suggested prompts、Memories 开关。

### 2.6 设计语言（证据：复刻项目的 `DESIGN.md`）

该文件是对 Codex 设计语言的逆向合约，要点：

- **氛围**：工作台优先（无落地页 / hero / 营销构图）；密度高而不挤（短标签、紧凑行、可见结构）；原生开发工具感——冷静、哑光、低对比、快；空白用于分隔工作区，不造戏剧性。
- **Token 分层**：原语（颜色 / 字级 / 圆角 / 阴影 / 动效 / 图标尺寸 / 控件尺寸 / z-index）+ **语义**（chrome 高度 / 工作区头高 / 面板条高 / 行高 / 侧栏与面板比例 / 菜单宽 / 骨架宽）。新增 token 以「表达可复用决策」为准。
- **颜色**：单一 accent，**只用于活动态、焦点、选中项与重要状态**；状态色保留（diff added / removed、permission）；禁止新增强调色、渐变、霓虹与纯黑；新状态用 `color-mix()` 从既有 token 派生。
- **字体**：mono-forward 栈；正文基准 + 小号元数据（`sm`/`xs`）；层级优先用字重与透明度而非放大字号；标题罕见（工具面板用紧凑标签，不用页面标题式排版）；代码、路径、快捷键、时间戳用等宽 / 表格数字。
- **控件**：图标钮 / 命令钮（图标 + 文字）/ 行钮（菜单、侧栏、文件树、可选列表）三类；行高按角色分档（菜单行 / 紧凑动作行 / 命令面板行 / 工具切换与设置行）。
- **面板**：chrome 栏 / 工作区头 / 面板条 / 次工具条 / 嵌入式迷你条分层；popover 统一不复写；浮动高亮面（环境卡、composer）单独成类。面板内容以分隔线与行分组组织，**不做嵌套卡片**。
- **布局**：保持「侧栏 + 主区 + 可选环境面板 + 可选工具面」形态；比例进语义变量；**宽屏停靠、窄屏浮层**；应用高度用 `dvh`。
- **层级**：命名层（ground / panel / floating / resize / drawer / popover / overlay），禁止组件里裸写 z-index。
- **动效**：短而实用；只动 color / opacity / transform，不动布局尺寸；按下有微小下移；尊重 `prefers-reduced-motion`。

## 3. 对本站的对齐清单（落地到 v2）

| 项 | Codex 范式 | 本站现状 | v2 动作 |
|---|---|---|---|
| 布局 | 左栏 + 中列 + 右面板 | 双栏（左栏 + 中列），无右面板 | 新增右「上下文面板」（变更 / 进度 / 子代理 / 来源） |
| 消息流 | 用户右泡 + 助手通栏 + 摘要行 | 已有基础（V38–V46 流式管线） | 重排视觉：摘要行、编辑卡、文档卡、时长行 |
| Composer | 卡片 + 底部工具行 + 模式菜单 | 顶部 `ContextBar` + 底部工具行混排 | 收敛为「卡内底部工具行」；模式菜单四档评估映射 |
| 命令 | Search chats + 编号键 | ⌘K 命令中心（V41） | 加会话编号快捷键（⌃1..9 风格） |
| 设置 | 独立视图 + 分组导航 + 搜索 | 七页签（标签形态） | v3 全量重构（见 v3-schedule） |
| 设计 token | 语义 token + 命名层级 | 已有近黑 / 近白 token 体系（V42） | 按本文 §2.6 补齐语义层与层级命名 |

**不适用项**：worktree / cloud 会话模式、PR 集成、Computer Use、Pets、硬件（Codex Micro）——omp 语境不同，不引入。
