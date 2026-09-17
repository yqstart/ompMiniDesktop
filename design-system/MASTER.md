# ompMiniDesktop 设计系统 MASTER（全局唯一真相）

> 适用范围：V11 全页面（终端工作区形态）。页面级覆盖文件放在 `design-system/pages/`，按需覆盖本文件。
> 风格锚点：Cursor / Codex 桌面端式的**稳重**——四层灰阶拉开结构、单强调色稀释使用、密度高但装饰低。
> 技术栈：Tauri v2 + React + TS + Tailwind v4 + Zustand + Xterm.js。图标一律 **Reicon**（`reicon-react`、Outline 权重、具名导入，映射表见 §8），禁止 emoji 图标，也禁止再手写内联 SVG。

## 1. 产品模式与风格

- 产品模式：桌面端 **agent 终端工作台**（左侧项目 / 分支树 + 右侧 omp 终端标签页），不是聊天界面、不是 landing 页、不是 dashboard。终端里的输出就是终端，壳侧不做结构化渲染。
- 视觉风格：quiet utility（安静工具风）。分级靠**亮度**（background → sidebar → surface → elevated 四层）与 1px 低对比线，不靠装饰；唯一记忆点是「终端标签栏 + 工作区树的紧凑结构」。
- 稳重 = 少动效、少圆角、少强调色占比；形状统一（同一类控件只有一种圆角/一种悬浮色），层次清楚，密度紧凑（列表行 32px、正文 14px、控件 13px）。
- 反模式：拒绝暖米色 + 衬线大标题、拒绝纯黑 + 荧光绿、拒绝报纸式 hairline 密排（三者都是 AI 默认脸，本项目禁用）。

## 2. 色彩（token 定义见 `src/index.css`）

四层灰阶，两套皮肤**同向**：应用底 → 侧栏 → 卡片 → 悬浮逐层变亮（侧栏比消息流亮一档：
导航面稍亮、内容面沉下去，VSCode 式）；边界优先靠**亮度差**表达，1px 边框只做最后一道描线。
两套皮肤同一个冷青灰色相家族（H≈200°，不带暖偏移）：浅色不刺白、深色不落纯黑。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `background` | `#EDF0F2` | `#1B1F21` | 应用底、消息流底 |
| `sidebar` | `#F6F8F9` | `#222628` | 左栏底（**深色主色**） |
| `surface` | `#FFFFFF` | `#2A2F32` | 卡片、下拉、输入框 |
| `elevated` | `#FFFFFF` | `#31363A` | 下拉面板、浮层、对话框 |
| `foreground` | `#1E2226` | `#E9ECEE` | 正文 |
| `muted` | `#4C565D` | `#B0B7BC` | 次要文字（≥4.5:1） |
| `faint` | `#626C74` | `#8E969B` | 元信息（时间 / 计数 / 路径，≥4.5:1） |
| `border` | `#D3DADE` | `#3A4145` | 分隔线、卡边 |
| `border-soft` | `#E6EBED` | `#2F3538` | 弱分隔（分组引导线、卡内分隔线） |
| `accent` | `#4F46E5` | `#818CF8` | 发送、主按钮、运行态、链接、选中 |
| `danger` | `#DC2626` | `#F87171` | 删除、拒绝、失败边 |
| `warn` | `#B45309` | `#FBBF24` | 审批、yolo、目录缺失 |
| `ok` | `#047857` | `#34D399` | 成功态 |
| `code` | `#E1E7E9` | `#15181A` | 行内代码与代码块底（比应用底再深一档，否则糊在消息流里） |
| `hover` | accent 15% | accent 15% | **全局唯一悬浮底** |
| `active` | accent 22% | accent 22% | 选中底（行 / 分组头 / 菜单当前项） |

- **皮肤切换**（跟随系统 / 深色 / 浅色）落在 `<html class="dark">` 这一个 class 上：
  浅色是 `:root` 默认值、深色全挂在 `.dark` 下（`src/index.css`），逻辑在 `src/lib/theme.ts`，
  入口是左栏底部「设置」行右侧的三档分段控件（`ThemeToggle`），它**左边紧邻界面语言**三档分段控件
  （`LanguageToggle`，跟随系统 / 中 / EN）——两个展示层偏好共用这一行，设置页都不重复放。纯展示层偏好，
  存 localStorage（`omp.theme.v1` / `omp.locale.v1`），不写 omp 配置、不写覆盖层；
  **侧栏最小值就是这一行的内容宽度**（§4）。

- **强调色只用一个**（`accent`），禁止第二强调色。审批卡的「允许一次」用 `accent` 实心按钮、Deny 用 `danger` 描边（hover 走 `bg-danger/15`，不整块翻红）。
- **悬浮色全局统一为 `hover`**：行、按钮、菜单项、下拉项、补全项、图标按钮一律 `hover:bg-hover`。禁止再出现 `hover:bg-background` / `hover:bg-surface` 这类第二套悬浮灰（同一个界面里飘着三四种灰是上一版最主要的不统一）。危险项 hover 用 `hover:bg-danger/15`，warning 项用 `hover:bg-warn/15`。
- **选中态 = `bg-active` + 左侧 2px `accent` 竖条 + 标题 `font-semibold`**，会话行与当前项目分组头共用同一套。悬浮（15%）与选中（22%）同源同色系，靠深浅拉开，不再发明第二套选中配色。
- 主入口「添加项目」是稀释强调色（`bg-accent/10` + `border-accent/25` + `text-accent`），不是实心色块——侧栏顶部放一块高饱和实心按钮太吵。
- 对比底线：正文与次要文字均 ≥ 4.5:1，元信息 `faint` 也 ≥ 4.5:1（本表已满足，勿再调浅）。
- **终端 16 色（V11）**：`--term-*` 两套色板（浅 / 深各一份，定义在 `index.css`，语义对齐应用 token：红=danger、绿=ok、黄=warn、蓝=accent，灰阶取四层亮度体系）。xterm 的 `theme` 只吃具体颜色、不吃 CSS 变量，所以由 `src/lib/termTheme.ts` 在运行时读取喂给它——**终端色值只准写在 `--term-*`**（组件与数据层都不写死终端颜色；终端背景 = `--background`、前景 = `--foreground`、光标 = `--accent`、选区 = accent 30%）。皮肤切换时终端实时换色（`<html class="dark">` 的 MutationObserver）。
- **元信息一律保持灰阶**：时间戳、路径、计数、次要说明——彩色只留给"内容"与状态信号。

## 3. 字体

- 界面：系统栈 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Inter, sans-serif`。中文优先苹方 / 微软雅黑。
- 等宽（工具参数、路径、session id 前缀）：`"JetBrains Mono", "SF Mono", Menlo, monospace`，12–13px；等宽文本自动带 `tabular-nums`（时间、token 数、行号对齐不跳动）。
- 字阶（**只有三级**，禁止再发明）：正文 14px；控件 13px（按钮、页签、下拉项、终端标签）；元信息 11px（时间、计数、路径、徽章，配 `font-mono` 或 `faint` 色）。终端内的字号由 xterm 自己管（13px 等宽 + 1.25 行高），不归字阶管。
- 行长：设置页内容列 `max-w-3xl` 居中；终端列随窗口（xterm 自动重排）。

## 4. 布局

- V11 两栏：左栏可拖拽（**292–480px，默认 292**，`sidebarWidth` 存 Zustand + localStorage 持久化；窄窗 <768px 收抽屉）→ 右侧终端工作区（标签栏 + xterm 全尺寸铺满）。**下限 = 左栏底部那一行的内容宽度**（设置全称 + 语言 + 皮肤并排不挤压，按最宽的英文界面算；实测 288px 临界 + 4px 字体余量），不为审美而定——改它之前先量那一行。
- 左栏（`WorkspaceSidebar`）：顶部固定区 = macOS 红绿灯占位行（`data-tauri-drag-region`，`h-9`）+「添加项目」主入口（稀释强调色，`FolderPlus`；与终端空态的引导共用 `src/lib/projects.ts` 的 `pickAndAddProject`）→ 滚动区 = 项目组列表（每项目 = 折叠头 + 工作区行）→ 底部固定「设置」行（左「设置」，右端依次 `LanguageToggle`、`ThemeToggle`；设置入口角上是「有可用更新」的小点）。滚动区用 `[scrollbar-gutter:stable]`，有无滚动条不横跳。
- 项目组（`ProjectGroup`）：**折叠头** = chevron + 文件夹图标 + 项目名（13px semibold）+ 悬浮槽位（`Clock` 会话弹窗入口 / `Nodes` 新建 worktree，都带 `aria-label` + `title`；目录缺失时标题旁常驻 warn 角标，并在下方给一行「重定位」）。**左栏不做不可逆操作**：删除只在会话弹窗与归档页，且都有二次确认。
- 工作区行：`圆点 · 分支名（mono 12.5px）· 位置徽章`——主目录圆点 `bg-accent`、worktree 圆点 `bg-faint` + 右侧「worktree」细边徽章（10px）；detached 显示「游离 + 短 sha」；目录缺失整行 50% 透明且不可点。选中态 = `bg-active` 底 + `text-foreground`（与全局选中视觉同源）；点击 = 打开 / 聚焦该目录的终端。从属关系用左侧 hairline 引导线（`border-l border-border-soft pl-1.5`）表达。
- 右侧终端工作区（`TerminalView`）：**标签栏 40px**（`h-10`，`bg-sidebar` + 下边框）→ 终端面板（绝对定位铺满）。标签栏整条挂 `data-tauri-drag-region`（空白处拖窗口；按钮自身的 mousedown 不触发拖拽）。标签 = `终端图标（运行中 accent / 已退出 faint）+ 标题（13px，truncate，max-w-220px）+ 关闭按钮`，激活标签 `bg-active`、未激活 `text-muted hover:bg-hover`；关闭按钮 hover / focus 才显形（激活标签常驻半透明），最右是常驻 `＋`（28px 方形圆角按钮）。标签标题 = omp 的 OSC 标题（`π > 会话名`），未发过就是工作区名。
- 终端面板：xterm 全尺寸铺满（`FitAddon` 跟随容器；隐藏面板不与后端同步尺寸）。omp 退出后浮层 = `bg-background/75` 遮罩 + `bg-elevated` 小卡（13px muted「omp 已退出」；异常退出显示「omp 意外退出（退出代码 N）」+「重启」accent 实心键 +「关闭」描边键）。**终端自己就是内容面**——不再套卡片、边框或内边距。
- 空态（无终端）：居中引导（`BrowserTerminal` 图标盒 + 15px semibold 标题 + 13px muted 说明 +「新建终端」主按钮；无项目时按钮位置换成「先添加一个项目」提示行）。
- 圆角（`@theme` 覆盖了 Tailwind 默认刻度）：`rounded-sm` 5px（小徽章）/ `rounded-md` 7px（按钮、列表行、下拉项）/ `rounded-lg` 10px（卡片、下拉面板、对话框）/ `rounded-xl` 12px（大容器）。**按钮不用 `rounded-full`**——只有状态点、圆点用。
- 边框：默认 `border-border`；分组内的弱分隔用 `border-border-soft`。禁止 `border-border/60`、`/70` 这类透明度档现场手调。
- 阴影只有两档：`shadow-pop`（下拉、浮层）、`shadow-dialog`（对话框、抽屉）。普通容器不用阴影，靠亮度与边框分层。
- 间距：4 / 8 / 12 / 16 四档常用；左栏项目行约 28–32px；对话框内边距 16。
- z-index：`10` 下拉 / 菜单浮层，`20` worktree 创建面板，`30` 对话框。
- 响应：窄窗（<768px）左栏收成抽屉（遮罩 + 侧滑面板），终端区占满；禁止横向滚动。

## 5. 交互

- 触控目标 ≥ 44px（小图标按钮用 28px 可视 + 44px 热区 padding）。
- 过渡统一 100ms（`duration-100`，弹层出入可到 150ms），只做 `color / opacity / transform`，禁止布局抖动（hover 不许 scale 位移）。
- 按钮：async 操作期间禁用 + spinner（worktree 创建、归档批量等）。
- 终端焦点：切到某终端 tab 时把键盘焦点交给 xterm（`term.focus()`）；快捷键（⌘T / ⌘W / ⌘1..9）在 window 层监听，与 xterm 的按键处理不冲突（组合键不被 xterm 消费）。
- 焦点：所有可交互元素可见 focus ring（`accent` 2px outline）。**例外**：焦点已由容器表达的输入框不画内层环（如 worktree 面板的搜索输入框）
- 动效：`prefers-reduced-motion` 时禁用旋转指示（loader），改为静态文案。

## 6. 文案语气

- 中文、主动语态、句式收敛：按钮即动作（「新建会话」「允许一次」「恢复」「归档全部对话」），toast 即结果（「已归档」「已删除，不可恢复」）。
- 空态是邀请不是叹息：给下一步动作（「选择一个本地目录作为项目」+ 按钮）。
- 错误说清原因和修复：「目录不存在，只能移除或重定位」「模型目录加载失败，重试或检查网络」。

## 7. 可访问性与性能

- icon-only 按钮必须 `aria-label`；图片/fileMention 芯片有文字替代；表单/select 有 label。
- 颜色不作唯一信号：状态同时有文字（运行中/成功/失败/等待审批）。
- 异步内容预留占位，禁止内容跳动（content-jumping）。**滚动条也要占位**：左栏会话列表 `[scrollbar-gutter:stable]`——列表从「不满一屏」长到「有滚动条」时，内容宽度不变、横向不跳一下。

## 8. 组件速查（V11 终端工作区 + 设置页五页签）

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
- `WorkspaceRow`（ProjectGroup 内私有）= 工作区行（口径见 §4）：圆点 + 分支名（mono）+「worktree」徽章 + 缺失态；点击 = 打开 / 聚焦该目录的终端（`lib/workspaces.ts` 的 `openOrFocusWorkspace`）。
- `TerminalView`（`src/components/terminal/TerminalView.tsx`）= 右侧容器：标签栏 + 全部终端面板（`hidden` 切显隐不销毁）+ 关闭确认（一个 `ConfirmDialog` 实例，`closingTerminalId` 驱动）+ 空态引导。
- `TerminalTabs`（`src/components/terminal/TerminalTabs.tsx`）= 标签栏（视觉口径见 §4）：`role="tab"` + `aria-selected`，Enter / Space 聚焦；关闭按钮 `aria-label` 走字典；`＋` 常驻最右。
- `TerminalPane`（`src/components/terminal/TerminalPane.tsx`）= 单个终端：xterm 实例（随 id 建立 / 销毁，切 tab 不丢滚动缓冲）+ PTY 管道（`pty_spawn` 的 Channel 直推）+ fit / resize（仅可见时）+ 退出浮层（重启 / 关闭）。
- `SessionPopup`（`src/components/sidebar/SessionPopup.tsx`）= 项目会话弹窗（`fixed inset-0 z-30` 遮罩 + `max-w-lg` 卡，`max-h-[70vh]`）：标题（`项目名 · 会话` + mono 路径 + ×）→ 会话行（标题 + 时间 + 归档角标；行点击 = 新终端 `omp --resume`；hover 槽位 = 归档 / 恢复 + 删除）→ 无底部按钮（关闭 = 遮罩 / Esc / ×）。删除走 `ConfirmDialog`；挂载方用 `key={project.id}` 保证换项目即重挂载。
- `HealthBanner`（`src/components/HealthBanner.tsx`）= omp 不可用横幅（warn 边），按钮「重新检测」「指定路径」。
- `UpdateDialog`（`src/components/update/UpdateDialog.tsx`）= 应用更新弹窗（App 常驻挂载、`updateDialogOpen` 控制显隐；有更新时的常驻提醒是左栏「设置」入口角上的小点，顶栏 Bell 已随 V11 退场）。
- `ConfirmDialog`（`src/components/ConfirmDialog.tsx`）已落地：受控浮层、Esc / 遮罩取消、焦点默认在「取消」、危险操作走 danger 色。**全 app 唯一的确认浮层**——终端关闭、会话删除、归档删除、供应商登出、记忆删除都走它；不许再造第二种确认样式。
- `ThemeToggle`（`src/components/ThemeToggle.tsx`）= 皮肤三档分段控件（跟随系统 / 深色 / 浅色），**只挂在左栏底部「设置」行右侧**：`role="radiogroup"` + 三个 `role="radio"`（`aria-checked`），左右方向键组内循环；选中 `bg-active`。只切 `<html class="dark">`（localStorage `omp.theme.v1`），不写 omp 配置。终端配色跟着它换（`--term-*`）。
- `LanguageToggle`（`src/components/LanguageToggle.tsx`）= 界面语言三档分段控件（跟随系统 / 简体中文 / English），**只挂在左栏底部、`ThemeToggle` 左侧**，样式同款。语言名是自称（`LOCALE_NAMES` / `LOCALE_SHORT` 不进字典）；`system` 档实际语言由 `resolveLocale` 解析（`zh*` → 中文）。偏好存 localStorage `omp.locale.v1`。
- `SettingsPage`（`src/components/SettingsPage.tsx`）= 设置页外壳（占满终端区），顶部页签（`role="tablist"`，选中页签 accent 下划线）：`通用` + `模型` + `记忆` + `使用统计` + `已归档对话`（V12b 起「供应商」并入「模型」，五页签）。底部「返回」。
- `GeneralSettingsPanel`（`src/components/settings/GeneralSettingsPanel.tsx`）= 「设置 › 通用」的「omp 常用设置」：**41 个常用键**（白名单 / 分组 / 枚举取值表在 `src/lib/ompSettings.ts`；V11 起含 `tools.approvalMode`）的读写面。折叠分组 + 开关 / 行内枚举 / 数字框 + 行尾「恢复 omp 默认值」；写入乐观更新、失败回滚；整行 `title` 是上游英文说明。**V11 的 V11 键块（`s_tools_approvalMode` 等）与值标签（`svApproval*`）是动态字典键，不许被"未使用键"清理误删。**
- `CustomProviders`（`src/components/settings/CustomProviders.tsx`）= 「设置 › 模型 › 自定义模型」（V12）：omp `models.yml` 的读写面。供应商行（自定义 / 覆盖内置徽章 + 生效模型数 + 编辑 / 删除；覆盖型只读）+ 行内展开表单（名称 / 接口地址 / 接口类型行内列表 / 认证两档分段 + key / 模型列表 + 保存 / 取消）+ 行内删除确认。错误用内联 danger 条（同页风格）。`StarToggle`（`src/components/settings/StarToggle.tsx`）= 共享挑选星标（可用模型目录 / 供应商挑选面板 / 我的模型列表共用一份）；`Switch`（`src/components/settings/Switch.tsx`）= 共享开关（通用设置行与自定义模型表单共用一份，不许各写一份）。
- `ModelsPanel`（`src/components/settings/ModelsPanel.tsx`）= 「设置 › 模型」的页壳（V12b 起为**唯一模型管理面**，六区块顺序：**我的模型 → 供应商 → 自定义模型 → 模型角色 → 失败转移 → 可用模型目录**）；`ProvidersSection`（登录 / 登出 + 已配置计划的「挑选模型」，挑选结果进「我的模型」）/ `FallbackChains` / `ModelPickList` / `MemoryPanel` / `ArchivedSessions` / `UsagePanel`：设置页其余区块 / 页签，口径同各自排期文档（v3 / v4 / v5 / v9 / v12 §6）。其中 `ArchivedSessions`（`src/components/ArchivedSessions.tsx`）= 「已归档对话」：标题行（计数 + 刷新）→ 口径说明 → 按项目分组（组头 = 折叠 + 名称 + 路径 + 计数 + 恢复全部 / 删除全部）→ 会话行（**点击 = 恢复并在终端里继续**（V11：unarchive + 新终端 resume；旧「只读回放」已随聊天界面退场）+ 日期 + 恢复 / 删除）。删除走 `ConfirmDialog`。数据来自 `list_archived_sessions`（不看扫描窗口）。
- 新增组件先查此表，禁止同义重复（如第二种 confirm 框、第二种标签栏）。

## 9. 应用图标

- 唯一矢量源 `design-system/icon/omp-mini-icon.svg`。改图标只改这个文件，再跑 `pnpm icon` 重新生成 `src-tauri/icons/`（icns / ico / 各尺寸 png）。
- 造型：oh-my-pi 的血脉是 Pi，故图标取 **π 作字标**——不加文字、不加第二个符号。
- 几何：1024 画布，内容圆角方 824×824 居中（圆角 186，macOS Big Sur 图标网格）；π 视觉盒 600×464 居中，笔画 96 全圆头，两腿相对横杠两端内缩 26%。T 型交汇处填 4 个 R46 内圆角（曲边三角，**不是整圆**——填整圆会在笔画外冒出珠子），横杠两端与腿底全圆头。
- 配色：**图标是品牌物，允许走出 §2 的单强调色约束**。π 走极光渐变 `#5EEAD4 → #38BDF8 → #A78BFA → #F472B6`（沿横杠左上 → 右腿右下流动），石墨底 `#232329 → #07070A` 上叠三处同色辉光（左下取极光首色、右上取末色、中央取过渡色）。
- 底线：16px 下仍要读出「一条横杠 + 两条腿」；辉光只柔化边缘，不许糊掉字形。
- 验证方式：**`pnpm tauri:dev` 里看不到自定义图标，这不是 bug**——macOS 下 dev 跑的是裸二进制（`target/debug/omp-mini-desktop`，无 .app bundle、无 `CFBundleIdentifier`），系统只给它通用可执行文件图标，根本不会去读 `src-tauri/icons/`。要验图标必须出应用包：`pnpm tauri:build` → `src-tauri/target/release/bundle/macos/ompMiniDesktop.app`。
- `src-tauri/build.rs` 里的 `println!("cargo:rerun-if-changed=icons")` 不许删：`tauri-build` 的 rerun-if-changed 只覆盖 `tauri.conf.json` / dist / Info.plist / capabilities，不覆盖 `icons/`，删掉后换了图标 cargo 不重建，产物里还是旧图标。
