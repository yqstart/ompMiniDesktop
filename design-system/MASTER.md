# ompMiniDesktop 设计系统 MASTER（全局唯一真相）

> 适用范围：V11 全页面（终端工作区形态）。页面级覆盖文件放在 `design-system/pages/`，按需覆盖本文件。
> 风格锚点：精致的冷灰桌面工作台——内嵌工作面、清晰的导航与内容分层、克制靛蓝，保持终端工具的安静与效率。
> 技术栈：Tauri v2 + React + TS + Tailwind v4 + Zustand + Xterm.js。图标一律 **Reicon**（`reicon-react`、Outline 权重、具名导入，映射表见 §8），禁止 emoji 图标，也禁止再手写内联 SVG。

## 1. 产品模式与风格

- 产品模式：桌面端 **agent 终端工作台**（左侧项目 / 分支树 + 右侧 omp 终端标签页），不是聊天界面、不是 landing 页、不是 dashboard。终端里的输出就是终端，壳侧不做结构化渲染。
- 视觉风格：quiet utility（安静工具风）。外壳、工作面、内容卡片与浮层各有亮度层级；签名结构是「项目分支树 + 内嵌工作面」，不是仪表盘。
- 精致来自稳定的间距、统一轮廓与文字层级。项目头 36px、分支行 32px、设置导航 44px；正文 14px、控件 13px，避免密密麻麻的多重描边。
- 反模式：拒绝暖米色 + 衬线大标题、拒绝纯黑 + 荧光绿、拒绝报纸式 hairline 密排（三者都是 AI 默认脸，本项目禁用）。

## 2. 色彩（token 定义见 `src/index.css`）

浅色：冷灰侧栏托起接近白色的工作面与白色卡片；深色：中性黑灰工作面沉下去，侧栏、卡片、浮层依次抬亮。两套使用相同语义 token，不在组件里分叉配色。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `background` | `#F3F5F9` | `#171717` | 工作面 |
| `sidebar` | `#EAEEF5` | `#1F1F1F` | 应用外壳、左栏 |
| `surface` | `#FFFFFF` | `#282828` | 卡片、控件、激活标签 |
| `elevated` | `#FFFFFF` | `#323232` | 浮层、对话框 |
| `foreground` | `#202737` | `#E8E8E8` | 正文 |
| `muted` | `#515E73` | `#B8B8B8` | 次要文字 |
| `faint` | `#606B80` | `#9E9E9E` | 元信息 |
| `border` | `#D5DCE8` | `#3F3F3F` | 结构边界 |
| `border-soft` | `#E3E8F0` | `#2E2E2E` | 卡片与内部分隔 |
| `accent` | `#4F46E5` | `#A5B4FC` | 主动作、选中、链接 |
| `accent-foreground` | `#FFFFFF` | `#171717` | 强调色实心按钮文字 |
| `danger` | `#DC2626` | `#F87171` | 删除、拒绝、失败边 |
| `warn` | `#B45309` | `#FBBF24` | 审批、yolo、目录缺失 |
| `ok` | `#047857` | `#34D399` | 成功态 |
| `code` | `#E7EBF3` | `#101010` | 代码背景 |
| `hover` | accent 8% | accent 8% | 统一悬浮底 |
| `active` | accent 14% | accent 14% | 选中填充 |

- **皮肤切换**（跟随系统 / 深色 / 浅色）落在 `<html class="dark">` 这一个 class 上：
  浅色是 `:root` 默认值、深色全挂在 `.dark` 下（`src/index.css`），逻辑在 `src/lib/theme.ts`，
  入口是左栏底部「设置」行右侧的三档分段控件（`ThemeToggle`），它**左边紧邻界面语言**三档分段控件
  （`LanguageToggle`，跟随系统 / 中 / EN）——两个展示层偏好共用这一行，设置页都不重复放。纯展示层偏好，
  存 localStorage（`omp.theme.v1` / `omp.locale.v1`），不写 omp 配置、不写覆盖层；
  **侧栏最小值就是这一行的内容宽度**（§4）。

- **强调色只用一个**（`accent`）。实心主按钮用 `text-accent-foreground`，保证深色亮强调底上的文字对比；危险按钮用 danger 稀释填充与描边，不铺大红色块。
- **悬浮色全局统一为 `hover`**：行、按钮、菜单项、下拉项、补全项、图标按钮一律 `hover:bg-hover`。禁止再出现 `hover:bg-background` / `hover:bg-surface` 这类第二套悬浮灰（同一个界面里飘着三四种灰是上一版最主要的不统一）。危险项 hover 用 `hover:bg-danger/15`，warning 项用 `hover:bg-warn/15`。
- **树行选中态 = `bg-active` + 左侧 2px `accent` 竖条 + `font-semibold`**。设置导航选中用 `bg-active` + 强调色文字；终端激活标签用 `surface` + 描边，以页签形状表达层级。
- 「添加项目」采用 surface 描边按钮，图标用 accent；不在左栏顶部铺高饱和色块。
- 对比底线：正文与次要文字均 ≥ 4.5:1，元信息 `faint` 也 ≥ 4.5:1（本表已满足，勿再调浅）。
- **终端 16 色（V11）**：`--term-*` 两套色板（浅 / 深各一份，定义在 `index.css`，语义对齐应用 token：红=danger、绿=ok、黄=warn、蓝=accent，灰阶取四层亮度体系）。xterm 的 `theme` 只吃具体颜色、不吃 CSS 变量，所以由 `src/lib/termTheme.ts` 在运行时读取喂给它——**终端色值只准写在 `--term-*`**（组件与数据层都不写死终端颜色；终端背景 = `--background`、前景 = `--foreground`、光标 = `--accent`、选区 = accent 30%）。皮肤切换时终端实时换色（`<html class="dark">` 的 MutationObserver）。
- **元信息一律保持灰阶**：时间戳、路径、计数、次要说明——彩色只留给"内容"与状态信号。

## 3. 字体

- 界面：系统栈 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Inter, sans-serif`。中文优先苹方 / 微软雅黑。
- 等宽（工具参数、路径、session id 前缀）：`"JetBrains Mono", "SF Mono", Menlo, monospace`，12–13px；等宽文本自动带 `tabular-nums`（时间、token 数、行号对齐不跳动）。**末尾挂一枚内嵌的图标字体 "OMP Nerd Icons"**（`--font-mono` 里排在系统字体之后，只补图标码点）：终端里 omp 的 `symbolPreset: nerd` 图标由它渲染，单宽（1 字符 = 1 cell，与 Menlo/JetBrains Mono/SF Mono 的 advance 对齐），源见 `scripts/build-nerd-icons-font.py` 与 `THIRD-PARTY-NOTICES.md`「字体资源」。
- 字阶：正文 14px；控件 13px（标签栏 12px）；元信息 11px；设置标题 17px；终端空态标题 24px / 宽窗 28px。空态展示标题是唯一大字使用场景。终端仍是 13px 等宽、1.25 行高。
- 设置页 `max-w-6xl` 居中；依据实际内容宽度做容器查询，导航在设置容器 <640px 时缩成 44px 图标栏，否则 176px；面板是唯一滚动区。

## 4. 布局

- V11 两栏：左栏可拖拽（**292–480px，默认 292**，`sidebarWidth` 存 Zustand + localStorage 持久化；窄窗 <768px 收抽屉）→ 右侧工作区（**常驻标签栏**：终端标签 + 设置标签；xterm 全尺寸铺满）。**下限 = 左栏底部那一行的内容宽度**（设置全称 + 语言 + 皮肤并排不挤压，按最宽的英文界面算；实测 288px 临界 + 4px 字体余量），不为审美而定——改它之前先量那一行。
- 左栏：40px macOS 红绿灯占位 → ompMiniDesktop 字标 → 36px 添加项目按钮 → 工作区标题与项目树 → 固定底栏。字标区同样支持拖窗；滚动区预留滚动条槽位。
- 项目组：36px 折叠头（chevron + 24px 文件夹图标底 + 项目名）与 hover/focus 操作槽（会话、新建 worktree）；缺失目录给 warning 修复条，不在树里放不可逆操作。
- 工作区：32px 行，`DiagramTree` + 等宽分支名 + worktree 徽章；选中左线、填充与加粗。主目录图标 accent，普通 worktree faint；缺失目录禁用。从属关系用弱引导线表达。
- 右侧工作面：桌面端外沿 8px 留白、16px 圆角与轻描边；终端本身无额外 padding。48px 常驻标签栏（即便没有任何标签也保留工作区标题与新建入口）——**终端标签按左栏选中的工作区过滤**（只列当前分支的终端，别的分支的终端照常跑、不在这个视图里），激活标签 surface 填充与细边框；窄窗左端显示项目抽屉按钮。标题截断、关闭入口和常驻 `＋` 行为不变；标签溢出时栏内横向滚动、隐藏滚动条（`.no-scrollbar`，垂直滚轮映射为横向）；终端和设置面板只切显隐，不卸载。
- **终端标签 = π 状态标 + 会话标题**（`π` 是 omp 血统；标签上不再用终端图标）：π 用 mono 14px，**颜色即 omp 的运行状态**（`lib/termTitle.ts` 从 OSC 标题读）：工作中 `accent` + `animate-pulse` 呼吸、等待确认 `warn`、等待输入与正常退出 `ok`、异常退出与启动失败 `danger`、未知 `faint`。颜色不是唯一信号——状态文字进 `sr-only`（屏幕阅读器）并作为 π 的 `title` 悬停提示；π 的呼吸动画在 `prefers-reduced-motion` 下由全局规则关掉（§5 动效）。名字位显示**会话标题**；omp 在会话还没有标题时广播的是 cwd 末段目录名（回退值）——壳侧识别后不显示，退回工作区显示名「项目 · 分支」。**标签只占一行**（V18）：不显示 cwd 第二行（工作目录由左栏选中项与标签栏的工作区过滤表达，完整 cwd 留在悬停提示里）；会话标题的语言随界面语言（V18 写 `<agentDir>/TITLE_SYSTEM.md`，见 `AGENTS.md` 数据流）。**双击标签 = 改名**（V17）：内联输入框替换名字行（draft 初值 = 当前会话标题，Enter 提交 / Esc / 失焦取消），提交走 omp 原生命令 `/rename`（`lib/termRename.ts`）；失败（标题为空 / 含控制字符，或会话不在等待输入）时留在编辑态、输入框描边转 danger 并在名字行下方显示 danger 文案（编辑期标签高度自适应，常态 36px 单行）。
- 终端面板：xterm 全尺寸铺满（`FitAddon` 跟随容器；隐藏面板不与后端同步尺寸），**不显示滚动条**（xterm 6 自绘 overlay，`index.css` 全局 `display:none`；滚轮/键盘/回看照常）。omp 退出后浮层 = `bg-background/75` 遮罩 + `bg-elevated` 小卡（13px muted「omp 已退出」；异常退出显示「omp 意外退出（退出代码 N）」+「重启」accent 实心键 +「关闭」描边键）。**终端自己就是内容面**——不再套卡片、边框或内边距。
- 终端空态：64px 图标盒、等宽终端标识、24/28px 邀请式标题、限宽说明、稀释强调色新建按钮与快捷键提示；无项目时提示先添加项目。
- 圆角：`rounded-sm` 5px / `rounded-md` 8px / `rounded-lg` 12px / `rounded-xl` 16px / `rounded-2xl` 20px。圆角全局 token 驱动，不现场定第二套。
- 边框：默认 `border-border`；分组内的弱分隔用 `border-border-soft`。禁止 `border-border/60`、`/70` 这类透明度档现场手调。
- 阴影只有两档：`shadow-pop`（下拉、浮层）、`shadow-dialog`（对话框、抽屉）。普通容器不用阴影，靠亮度与边框分层。
- 间距：4 / 8 / 12 / 16 / 20 / 24；设置卡片 16–20px padding，对话框 16–24px，空态保留更宽的呼吸区。
- z-index：`10` 下拉 / 菜单浮层，`20` worktree 创建面板，`30` 对话框。
- 响应：窄窗（<768px）左栏收成抽屉（遮罩 + 侧滑面板），终端区占满；禁止横向滚动。

## 5. 交互

- 触控目标 ≥ 44px（小图标按钮用 28px 可视 + 44px 热区 padding）。
- 过渡统一 100ms（`duration-100`，弹层出入可到 150ms），只做 `color / opacity / transform`，禁止布局抖动（hover 不许 scale 位移）。
- 按钮：async 操作期间禁用 + spinner（worktree 创建、归档批量等）。
- 终端焦点：切到某终端 tab 时把键盘焦点交给 xterm（`term.focus()`）；快捷键（⌘T / ⌘W / ⌘1..9）在 window 层监听，与 xterm 的按键处理不冲突（组合键不被 xterm 消费）。
- 焦点：所有可交互元素可见 focus ring（`accent` 2px outline）。**例外**：焦点已由容器表达的输入框不画内层环（如 worktree 面板的搜索输入框）
- 动效：`prefers-reduced-motion` 时禁用旋转指示（loader），改为静态文案。
- 模态键盘行为统一由 `useDialogFocus` 提供：Tab / Shift+Tab 只遍历最上层可见模态中的启用控件，Esc 先关内部下拉、再关最上层模态；关闭恢复触发焦点。隐藏设置面板 `inert`，不抢终端焦点、不消费 Esc；纵向设置导航用上下方向键与 Home/End 切换，只有选中页签进入 Tab 顺序。
- 自定义供应商错误紧邻字段并关联 `aria-describedby`；保存失败聚焦错误、保留草稿；保存中整表禁用且关闭入口无效。筛选模型时明确显示「全选匹配项 / 清空匹配项」及匹配数，禁用无实际变化的批量操作。模型选择器同时显示名称和 id，用选中态标识当前值，不用裸数字表示思考能力。

## 6. 文案语气

- 中文、主动语态、句式收敛：按钮即动作（「新建会话」「允许一次」「恢复」「归档全部对话」），toast 即结果（「已归档」「已删除，不可恢复」）。
- 空态是邀请不是叹息：给下一步动作（「选择一个本地目录作为项目」+ 按钮）。
- 错误说清原因和修复：「目录不存在，只能移除或重定位」「模型目录加载失败，重试或检查网络」。

## 7. 可访问性与性能

- icon-only 按钮必须 `aria-label`；图片/fileMention 芯片有文字替代；表单/select 有 label。
- 颜色不作唯一信号：状态同时有文字（运行中/成功/失败/等待审批）。
- 异步内容预留占位，禁止内容跳动（content-jumping）。**滚动条也要占位**：左栏会话列表 `[scrollbar-gutter:stable]`——列表从「不满一屏」长到「有滚动条」时，内容宽度不变、横向不跳一下。

## 8. 组件速查（V11 终端工作区 + 设置页七项菜单）

### 图标（Reicon）

- 库：`reicon-react`，具名导入（`import { Check, Copy } from "reicon-react"`），构建期 tree-shake。
- 权重：一律 `Outline`（默认值，填充路径写成线框，轮廓方正）；**不要用 `Filled`**——实心块在密集列表与工具行里太重。
- 尺寸只有四档：12（行内：行内按钮、芯片、徽章）/ 13–14（列表、按钮、工具卡、状态）/ 15–16（顶栏、卡片标题、发送键）/ 20（空态）。颜色继承 `currentColor`，不传 `color`。
- **旧名映射**（Reicon 无同名时按下表；未列出的同名直用）：`ArchiveRestore` → `Undo`、`RotateCcw` → `Undo`、`FolderSearch` → `FolderError`、`GitBranch` → `DiagramTree`、`Boxes` → `Layers`、`SlidersHorizontal` → `Sliders`、`ExternalLink` → `ArrowUpRightSquare`、`KeyRound` → `Key`、`Languages` → `Language`、`MessageSquareQuote` → `QuoteDownSquare`、`RefreshCw` → `Refresh`、`Loader2` → `Loader`、`TriangleAlert` / `FileWarning` → `TriangleWarning`。
- 禁止内联手写 SVG（空态与发送键的自绘图标已并入 Reicon）；禁止 emoji 当图标。

### V11 组件（终端工作区）

- `WorkspaceSidebar`（`src/components/sidebar/WorkspaceSidebar.tsx`）= 左栏主容器：红绿灯占位 +「添加项目」+ 项目组列表 + 底部「设置」行（`LanguageToggle` / `ThemeToggle` / 更新小点）。添加项目失败等错误用内联 danger 条 + 关闭按钮，不造第三种提示样式。
- `ProjectGroup`（`src/components/sidebar/ProjectGroup.tsx`）= 项目组：折叠头（chevron + `Folder` + 名称 + 悬浮槽位 `Clock`（会话弹窗）/ `Nodes`（新建 worktree））+ 工作区行 + `WorktreePanel` + 目录缺失时的「重定位」行。悬浮槽位只在 hover / focus-within 出现。
- `WorktreePanel`（ProjectGroup 内私有）= 新建 worktree 面板（绝对定位浮层：`left-2 right-2 top-full` + `shadow-pop`，点外部 / Esc 关）：输入框（过滤未检出的本地分支）→ 候选行（圆点 + mono 分支名）→「新建分支「输入名」」选项（输入非空且不在候选时出现）；创建中禁用控件，失败回抛左栏错误条。
- `WorkspaceRow`（ProjectGroup 内私有）= 工作区行（口径见 §4）：工作区图标 + 分支名（mono）+「worktree」徽章 + 缺失态；行尾状态区 = 终端数徽章（`BrowserTerminal` + 数量，有进程在跑时上 `accent`——右栏只显示当前工作区的终端，别的分支靠它提示）/ dirty 小点（`accent`）/ 领先远程徽章（`BranchUp` + 数量，`accent`，点击 = 推送）/ 落后远程徽章（`BranchDown` + 数量，`warn`，只读）/ 上游缺失标记（`LinkOff`，`faint`；无上游 / 上游已被删除——留白表示与远程一致）/ 任务徽章（`Loader` 运行中 / `AlertTriangle` 失败，点击 = 打开任务浮层），hover 出现「提交并推送」按钮（V14）；点击行 = 打开 / 聚焦该目录的终端（`lib/workspaces.ts` 的 `openOrFocusWorkspace`）。
- `TerminalView`（`src/components/terminal/TerminalView.tsx`）= 终端面板区：全部终端面板（`hidden` 切显隐不销毁，按当前工作区过滤显示）+ 空态引导（当前工作区没有激活终端时）。标签栏与关闭确认（一个 `ConfirmDialog` 实例，`closingTerminalId` 驱动）都挂在 `App` 层——设置标签激活时它们也要可见 / 可弹。
- `TerminalTabs`（`src/components/terminal/TerminalTabs.tsx`）= 标签栏（视觉口径见 §4）：**只列当前工作区的终端标签**（`cwd` 命中 `activeWorkspacePath`，`lib/terminalScope.ts`；设置标签不受影响）——终端标签（**π 状态标**（颜色 = omp 状态，`lib/termTitle.ts`）+ 会话标题 + 关闭；**双击标签改名**，内联输入框 + 失败文案见 §4）+ **设置标签（单例，`settingsTabOpen` / `settingsTabActive`）** + `＋`；`role="tab"` + `aria-selected`，Enter / Space 聚焦；关闭按钮 `aria-label` 走字典（设置标签走 `closeSettingsTab`，不进确认流程）；`＋` 常驻最右。
- `TerminalPane`（`src/components/terminal/TerminalPane.tsx`）= 单个终端：xterm 实例（随 id 建立 / 销毁，切 tab 不丢滚动缓冲）+ PTY 管道（`pty_spawn` 的 Channel 直推）+ fit / resize（仅可见时）+ 退出浮层（重启 / 关闭）。
- `SessionPopup`（`src/components/sidebar/SessionPopup.tsx`）= 项目会话弹窗（`fixed inset-0 z-30` 遮罩 + `max-w-lg` 卡，`max-h-[70vh]`）：标题（`项目名 · 会话` + mono 路径 + ×）→ 搜索框 + 元信息行（已加载 / 匹配 / 扫描窗口 +「全选（N）」，作用在当前过滤结果上）→ 会话行（**行首勾选框** + 标题 + 时间 + 归档角标；行点击 = 新终端 `omp --resume`；hover 槽位 = 归档 / 恢复 + 删除）→ 有选中时的底部操作条（已选 N 项 · 归档 / 恢复（各按适用项过滤，无适用项禁用）· 删除 · 清除选择）。删除走 `ConfirmDialog`（单条标题 = 会话名，批量 = 「删除选中的 N 个会话？」）；挂载方用 `key={project.id}` 保证换项目即重挂载。
- `HealthBanner`（`src/components/HealthBanner.tsx`）= omp 不可用横幅（warn 边），按钮「重新检测」「指定路径」。
- `UpdateDialog`（`src/components/update/UpdateDialog.tsx`）= 应用更新弹窗（App 常驻挂载、`updateDialogOpen` 控制显隐；有更新时的常驻提醒是左栏「设置」入口角上的小点，顶栏 Bell 已随 V11 退场；重新打开的入口 = 设置 ›「关于」的更新区块「查看详情」）。「发现新版本」态除了版本行还有**「本次更新」块**：内容 = Release 的 `latest.json` 里 `notes`（CHANGELOG 该版本整节，Markdown）→ `max-h-64` 可滚动、复用记忆页的 `.md-body` 排版（标题 / 列表 / 行内代码 / 加粗），链接交给系统浏览器（`openUrl`），`notes` 为空时整块不出（不留空框）。
- `ConfirmDialog`（`src/components/ConfirmDialog.tsx`）已落地：受控浮层、Esc / 遮罩取消、焦点默认在「取消」、危险操作走 danger 色。**全 app 唯一的确认浮层**——终端关闭、会话删除、归档删除、供应商登出、记忆删除都走它；不许再造第二种确认样式。
- `CommitTaskPanel`（`src/components/git/CommitTaskPanel.tsx`）= 工作区「提交并推送」任务浮层（V14，App 常驻挂载、`activeCommitCwd` 控制显隐）：标题（提交并推送 · 项目 · 分支）+ 阶段徽章（`Loader` 转 / `CheckCircle` / `AlertTriangle` / `X`）+ 流式日志（mono、后端已去 ANSI、自动滚底、上限 1000 行）+ 提交结果列表（split 场景多条）+ 错误与 hint + **提交信息语言**（三档分段控件：系统默认 / 简体中文 / English，与左栏两个控件同款 `role="radiogroup"` + `role="radio"` + 左右方向键；右侧「记住选择（本项目）」用共享 `Switch`；**按项目记忆** localStorage `omp.commitLang.v1`，运行中整组禁用并给一行说明、终态可改，中文档常驻一行摘要首词约束提示）+ 底部按钮（运行中：取消 / 后台运行；committed：推送 / 关闭；failed：重试 / 关闭）。`fixed inset-0 z-30` 遮罩 + `max-w-lg` 卡（对话框层）；关闭 = **转后台**（任务继续，行徽章指示），失败记录保留到用户关闭（已阅即清）。
- `ThemeToggle`（`src/components/ThemeToggle.tsx`）= 皮肤三档分段控件（跟随系统 / 深色 / 浅色），**只挂在左栏底部「设置」行右侧**：`role="radiogroup"` + 三个 `role="radio"`（`aria-checked`），左右方向键组内循环；选中 `bg-active`。只切 `<html class="dark">`（localStorage `omp.theme.v1`），不写 omp 配置。终端配色跟着它换（`--term-*`）。
- `LanguageToggle`（`src/components/LanguageToggle.tsx`）= 界面语言三档分段控件（跟随系统 / 简体中文 / English），**只挂在左栏底部、`ThemeToggle` 左侧**，样式同款。语言名是自称（`LOCALE_NAMES` / `LOCALE_SHORT` 不进字典）；`system` 档实际语言由 `resolveLocale` 解析（`zh*` → 中文）。偏好存 localStorage `omp.locale.v1`。
- `SettingsPage` = 设置标签面板，左侧**七项**图标导航分**两组**（**omp**：常用设置 / 模型 / 记忆 / 供应商用量；**本应用**：关于 / 使用统计 / 已归档对话），组标题是 11px `faint` 小字（**无标题行，菜单从顶端开始**）+ 组间分隔线；窄导航（44px）下组标题与页签名一起收进 `sr-only`（`not-sr-only` 在容器 ≥640px 恢复）。右侧为唯一滚动内容区，宽窗 176px 导航 / 紧凑 44px 图标导航（保留可访问名称与 title）；44px 导航行。七个入口与隐藏保活语义不变，**页内不再有快捷定位 chips**（左栏切页即导航）；组件用 `@container/settings` / `@container/panel` 随可用空间换行，不按全窗口宽度猜测面板宽度。
- `GeneralSettingsPanel`（`src/components/settings/GeneralSettingsPanel.tsx`）= 「设置 › 常用设置」的「omp 常用设置」：**41 个常用键**（白名单 / 分组 / 枚举取值表在 `src/lib/ompSettings.ts`；V11 起含 `tools.approvalMode`）的读写面。折叠分组 + 开关 / 行内枚举 / 数字框 + 行尾「恢复 omp 默认值」；写入乐观更新、失败回滚；整行 `title` 是上游英文说明。**V11 的 V11 键块（`s_tools_approvalMode` 等）与值标签（`svApproval*`）是动态字典键，不许被"未使用键"清理误删。**
- `ProviderPicker` / `CustomProviderEditForm` / `ProviderModelsDialog` / `DialogShell`（`src/components/settings/`）= 「添加供应商」与「挑选模型」两个模态（V12c）：选择器（搜索 + 已配置置顶 + 首项「自定义」）、models.yml 表单（名称可改 / 接口类型两档 / 只有 API Key / 模型列表）、供应商模型星标列表（全选 / 清空作用于过滤结果）、模态壳（`fixed` 全屏遮罩 + 居中卡片，Esc / 遮罩 / × 关）。`StarToggle`（`src/components/settings/StarToggle.tsx`）= 共享挑选星标（挑选面板 / 我的模型列表共用一份）；`Switch`（`src/components/settings/Switch.tsx`）= 共享开关（通用设置行、自定义模型表单、提交浮层的「记住选择」共用一份，不许各写一份）。
- `ModelsPanel`（`src/components/settings/ModelsPanel.tsx`）= 「设置 › 模型」的页壳（V12b 起为**唯一模型管理面**，四区块顺序：**供应商 → 我的模型 → 模型角色 → 失败转移**——供应商置顶，因为「先添加供应商、再在弹窗里挑模型」是使用动线）；`ProvidersSection`（登录 / 登出 + 已添加列表 + 「添加供应商」/「挑选模型」两个弹窗）/ `FallbackChains` / `ModelPickList` / `MemoryPanel` / `ArchivedSessions` / `UsagePanel` / `ProviderUsagePanel`：设置页其余区块 / 页签，口径同各自排期文档（v3 / v4 / v5 / v9 / v12 §6 / v15）。其中 `ArchivedSessions`（`src/components/ArchivedSessions.tsx`）= 「已归档对话」：标题行（计数 + 刷新）→ 口径说明 → 按项目分组（组头 = 折叠 + 名称 + 路径 + 计数 + 恢复全部 / 删除全部）→ 会话行（**点击 = 恢复并在终端里继续**（V11：unarchive + 新终端 resume；旧「只读回放」已随聊天界面退场）+ 日期 + 恢复 / 删除）。删除走 `ConfirmDialog`。数据来自 `list_archived_sessions`（不看扫描窗口）。
- 新增组件先查此表，禁止同义重复（如第二种 confirm 框、第二种标签栏）。

## 9. 应用图标

- 唯一矢量源 `design-system/icon/omp-mini-icon.svg`。改图标只改这个文件，再跑 `pnpm icon` 重新生成 `src-tauri/icons/`（icns / ico / 各尺寸 png）。
- 造型：oh-my-pi 的血脉是 Pi，故图标取 **π 作字标**——不加文字、不加第二个符号。
- 几何：1024 画布，内容圆角方 824×824 居中（圆角 186，macOS Big Sur 图标网格）；π 视觉盒 600×464 居中，笔画 96 全圆头，两腿相对横杠两端内缩 26%。T 型交汇处填 4 个 R46 内圆角（曲边三角，**不是整圆**——填整圆会在笔画外冒出珠子），横杠两端与腿底全圆头。
- 配色：**图标是品牌物，允许走出 §2 的单强调色约束**。π 走极光渐变 `#5EEAD4 → #38BDF8 → #A78BFA → #F472B6`（沿横杠左上 → 右腿右下流动），石墨底 `#232329 → #07070A` 上叠三处同色辉光（左下取极光首色、右上取末色、中央取过渡色）。
- 底线：16px 下仍要读出「一条横杠 + 两条腿」；辉光只柔化边缘，不许糊掉字形。
- 验证方式：**`pnpm tauri:dev` 里看不到自定义图标，这不是 bug**——macOS 下 dev 跑的是裸二进制（`target/debug/omp-mini-desktop`，无 .app bundle、无 `CFBundleIdentifier`），系统只给它通用可执行文件图标，根本不会去读 `src-tauri/icons/`。要验图标必须出应用包：`pnpm tauri:build` → `src-tauri/target/release/bundle/macos/ompMiniDesktop.app`。
- `src-tauri/build.rs` 里的 `println!("cargo:rerun-if-changed=icons")` 不许删：`tauri-build` 的 rerun-if-changed 只覆盖 `tauri.conf.json` / dist / Info.plist / capabilities，不覆盖 `icons/`，删掉后换了图标 cargo 不重建，产物里还是旧图标。
