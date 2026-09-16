# ompMiniDesktop 设计系统 MASTER（全局唯一真相）

> 适用范围：V1 全页面。页面级覆盖文件放在 `design-system/pages/`，按需覆盖本文件。
> 风格锚点：Cursor / Codex 桌面端式的**稳重**——四层灰阶拉开结构、单强调色稀释使用、密度高但装饰低。
> 技术栈：Tauri v2 + React + TS + Tailwind v4 + Zustand。图标一律 **Reicon**（`reicon-react`、Outline 权重、具名导入，映射表见 §8），禁止 emoji 图标，也禁止再手写内联 SVG。

## 1. 产品模式与风格

- 产品模式：桌面端 agent 会话壳（dense chat + 回放），不是 landing 页，不是 dashboard。
- 视觉风格：quiet utility（安静工具风）。分级靠**亮度**（background → sidebar → surface → elevated 四层）与 1px 低对比线，不靠装饰；唯一记忆点是「工具调用行的紧凑时间线」（一行一个调用，不许做成卡片，见 §8 `ToolRow`）。
- 稳重 = 少动效、少圆角、少强调色占比；形状统一（同一类控件只有一种圆角/一种悬浮色），层次清楚（段落之间有明确分隔），密度紧凑（列表行 32px、正文 14px、控件 13px）。
- 反模式：拒绝暖米色 + 衬线大标题、拒绝纯黑 + 荧光绿、拒绝报纸式 hairline 密排（三者都是 AI 默认脸，本项目禁用）。

## 2. 色彩（token 定义见 `src/index.css`）

四层灰阶，两套皮肤**同向**：应用底 → 侧栏 → 卡片 → 悬浮逐层变亮（侧栏比消息流亮一档：
导航面稍亮、内容面沉下去，VSCode 式）；边界优先靠**亮度差**表达，1px 边框只做最后一道描线。
两套皮肤同一个冷青灰色相家族（H≈200°，不带暖偏移）：浅色不刺白、深色不落纯黑。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `background` | `#EDF0F2` | `#1B1F21` | 应用底、消息流底 |
| `sidebar` | `#F6F8F9` | `#222628` | 左栏底（**深色主色**） |
| `surface` | `#FFFFFF` | `#2A2F32` | 卡片、气泡、工具卡、输入框 |
| `elevated` | `#FFFFFF` | `#31363A` | 下拉面板、浮层、对话框 |
| `foreground` | `#1E2226` | `#E9ECEE` | 正文 |
| `muted` | `#4C565D` | `#B0B7BC` | 次要文字（≥4.5:1） |
| `faint` | `#626C74` | `#8E969B` | 元信息（时间 / 计数 / 路径，≥4.5:1） |
| `border` | `#D3DADE` | `#3A4145` | 分隔线、卡边、输入框边 |
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
- **会话流里的色彩分工（八期补：输出不再全是灰白）**：整段对话默认灰阶，彩色只落在四处「锚点」上，且全部取自本表的 token——不引第二套色板、不写死色值：
  - **用户气泡** = `border-accent/25` + `bg-accent/10`：右侧对齐 + 底色双信号，「这是我说的」不必读文字就知道；助手正文保持裸 Markdown 无底色，两侧一眼分得开。
  - **工具行**：图标与动词**同色**，按**动作性质**分——读 / 搜 / 跑 = `accent`、写 = `ok`、改 = `warn`、未知工具 = `muted`；`main`（文件基名 / 命令）保持正文色。语义色在这里只表**身份**：成功 / 失败仍走原信号（失败 = `danger` 的 X + danger 主文本、运行中 = spinner），所以「颜色不作唯一信号」不破。
  - **Markdown 正文**：标题 = accent 与正文色 `color-mix`（50%，h1/h2 另加一条 `border-soft` 下划线）、列表符号 `::marker` = accent、行内代码 = accent 65% 混正文色、引用左条 = accent 45% 混边框色、表头文字 = accent 45% 混正文色；代码块高亮沿用既有 `hljs-*` → token 映射（关键字 accent / 字符串 ok / 数字 warn / 删除 danger）——它们本来就是彩色，别重复上色。
  - **计划卡与本地命令**：任务状态符号 ✓ `ok` / ◐ `accent` / ○ `faint`（旁边仍有状态词与 `sr-only`）；`/` 命令的 `command_output` 给 accent 左条 + 正文色（它是用户主动要的结果，不是备注，不用 muted）。
  - **元信息一律保持灰阶**：分隔线、时间戳、路径、计数、工具输出的 `pre` 底——彩色只留给"内容"。

## 3. 字体

- 界面：系统栈 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Inter, sans-serif`。中文优先苹方 / 微软雅黑。
- 等宽（工具参数、路径、session id 前缀）：`"JetBrains Mono", "SF Mono", Menlo, monospace`，12–13px；等宽文本自动带 `tabular-nums`（时间、token 数、行号对齐不跳动）。
- 字阶（**只有三级**，禁止再发明）：正文 14px（消息正文行高 1.7，`leading-[1.7]`）；控件 13px（按钮、页签、选择器触发、输入框上方上下文条、下拉项）；元信息 11px（时间、计数、路径、用量、状态胶囊，配 `font-mono` 或 `faint` 色）。
- 行长：中央消息列 `max-w-3xl`（约 65–75 字符），超长代码块横向滚动不撑破布局。

## 4. 布局

- V1 两栏：左栏可拖拽（**292–480px，默认 292**，`sidebarWidth` 存 Zustand + localStorage 持久化；窄窗 <768px 收抽屉）→ 中央流式列居中 `max-w-3xl`。右侧栏 V1 不做。**下限 = 左栏底部那一行的内容宽度**（设置全称 + 语言 + 皮肤并排不挤压，按最宽的英文界面算；实测 288px 临界 + 4px 字体余量），不为审美而定——改它之前先量那一行。
- 左栏：顶部主入口「添加项目」（稀释强调色，`FolderPlus`；与中央空态「选择目录」共用 `src/lib/projects.ts` 的 `pickAndAddProject`）→ 会话搜索框 → 按项目分组的手风琴会话组（旋转 chevron + 左侧 hairline 引导线）+ 未归属组 → 底固定「设置」行（左「设置」，右端依次是 `LanguageToggle` 与 `ThemeToggle`）。**「添加项目」+ 搜索框是固定区**（`sticky top-0` + `bg-sidebar` 不透明底 + `z-10`，`-mx-2 px-2` 让底色铺满）：只有会话列表滚，两块不跟着滚走；用 sticky 而不是拆成两个滚动容器，是为了让搜索框与会话行共用同一条滚动条留白、宽度始终对齐。**左栏只列进行中的会话**：已归档的对话不在左栏出现（V2 M11），统一在「设置 › 已归档对话」里看、恢复与删除。
- 会话行：单行 `● 标题 … 时间/归档`，右侧 68px 固定槽位（时间与操作按钮同槽互斥：hover 时时间 `visibility` 藏、按钮绝对覆盖淡入），行高锁定 `h-8`，悬浮零跳动。**行首不设复选框**：不做多选/批量工具条，**行内只保留单会话的「归档」**——删除不可逆，左栏不提供（会话文件是唯一真相，密集列表里误点代价太大），要删去「设置 › 已归档对话」（有二次确认）。选中态见 §2：`bg-active` 底 + 2px accent 左竖条 + 标题 `font-semibold`（未选中行 `hover:bg-hover`）。
- 项目分组头：单行（chevron + 弹性标题 + 右侧固定槽位：数量与操作图标同槽互斥、垂直居中 `items-center`），悬浮零跳动；缺失态在标题旁常驻小角标，hover 操作区照常可用。分组头**没有任何删除入口**（同会话行口径：左栏不做不可逆操作），hover 槽位里是**新建会话（`Plus`）+ 归档全部对话（`Archive`）**两个图标（都带 `aria-label` 与 `title`），只作用于该分组；「归档全部对话」直接执行（可逆，去设置页可恢复）。**分组为空时 `＋` 常驻不藏**（数量位让给 `＋`——新建的入口不能只活在悬浮里），此时不显示归档图标。**会话行不设复选框**，多选/批量工具条一律不做，批量入口只在分组头。当前项目（`activeProjectId`）用与会话行同一套选中视觉（`bg-accent/15` 底 + 3px accent 左竖条 + accent 文件夹图标），文件夹类标题（项目 / 未归属）统一 `font-semibold` + 图标，层级靠字号与深浅而非第二种颜色。
- 状态收敛：标题框外的独立状态条已下线（`StatusBar` 仅保留读屏播报位）；状态统一进输入框工具行——`OmpStatusPill`（常驻展示，借鉴 Cursor / Codex 底部状态条：就绪显示「就绪」绿点常亮，非就绪用颜色 + 文字双信号强调，避免用户误以为状态丢失）+ `RuntimeStats`（上下文占用 / 本轮 token / 耗时 / TTFT，全部来自 `omp-state` 真值透传，无真值整块不渲染）；工具行**右组**（`ml-auto`）自左向右是 `ContextMeter`（容量环，七期）→ `ModelPicker` → `ThinkingPicker` → 发送 / 停止。
- 窄窗抽屉入口：桌面侧栏 `hidden md:block`，顶栏左侧常驻「打开侧栏」按钮（`md:hidden`）——否则 <768px 下项目列表与设置完全不可达。打开会话 / 新建会话会自动收起抽屉。
- 左栏搜索框（Cursor / DSH 式一体搜索框）：图标内置、整块 `rounded-md` + `border-border`；`focus-within:border-accent/70`（焦点**只**由这圈外框表达，输入框自身不画内层焦点环：`no-focus-ring`）；有字时才出现清除按钮（`X`），不占位跳动；有过滤词时分组头上方显示「N 个标题匹配」，无匹配分组自动折叠。输入 ≥2 字时下方另起**内容命中**区（V2 M7b）：行 = 标题 + 归档角标 + 命中次数（11px mono）+ 两行片段（`line-clamp-2`，命中词 `<mark class="bg-accent/25">`），整行可点即打开会话；顶部一行说明「内容命中 N 个会话 / 正在搜索正文…」，被预算截断时补「已到预算上限，结果可能不全」。
- 左栏扫描窗口提示（V2 M7a）：列表底部固定区只放「设置」行（设置 + 语言与皮肤切换）；会话文件总数超过本次扫描窗口时，在「设置」上方加一条 11px muted 提示「已扫描最近 N 个会话（共 M 个）」+ 细边按钮「继续扫描更早的 500 个」（达上限显示「已达上限（5000）」并禁用）。**不占会话行、不进分组头**，因为它不属于任何项目。
- 左栏项目结构（单层分组，禁止双层）：顶部「添加项目」→ 一体搜索框 → 按项目分组的手风琴会话组（分组头即项目入口：名 + mono 路径尾段 + 右侧 76px 固定槽位；点击分组头切换 `activeProjectId`，新建会话落到它；缺失态在标题旁常驻小角标）→ 未归属组。**禁止在分组上方另起一排项目快捷卡片**（之前红框那排与分组重复，造成“一个项目出现两次”，已删除）。
- 输入框工具行与上方上下文条下拉互斥：`composerMenu: model | thinking | permission | project | branch | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）。
- 输入框上方上下文条（`ContextBar`，在输入框卡片**外**、卡片上方，与卡片内文字左对齐）：左「项目」右「git 分支」，再往右「用量限额」（`UsageLimits`，没有配额数据时自身不渲染），13px muted，与卡片同宽 `max-w-3xl` + 容器 `px-4`；三者都可点开且统一向上弹（只遮消息流，不遮正在打字的输入框）。一个项目都没有时整条不渲染。项目名 / 分支名不截断，窄窗口由整行 `flex-wrap` 换行兜底。分支是**只读**控件：非 git 目录显示「非 Git 目录」，不无声消失。
- 中央三段：顶栏 44px（标题 13px/600 + 复制会话为 Markdown + 更新入口，1px `border` 分隔）→ 消息流（用户气泡右对齐 `rounded-lg rounded-br-sm` + `border-border`，不用 inset-ring 代替边框；**只有用户气泡、审批卡、UI 请求卡、计划卡是"块"**，助手正文是裸 Markdown、工具调用与思考是一行式痕迹见 §8）→ 会话输入框（整块 `rounded-xl` 卡：`focus-within:border-accent/70`、等待审批时 `border-warn/60`，发送为 28px 方形箭头按钮）。
- 圆角（`@theme` 覆盖了 Tailwind 默认刻度）：`rounded-sm` 5px（小徽章）/ `rounded-md` 7px（按钮、列表行、搜索框、下拉项、工具卡内块）/ `rounded-lg` 10px（卡片、气泡、下拉面板、对话框）/ `rounded-xl` 12px（输入框卡）/ `rounded-2xl` 14px（备用大容器）。**按钮不再用 `rounded-full`**——只有状态点、选中竖条这类圆点用。
- 边框：默认 `border-border`；卡内 / 分组内的弱分隔用 `border-border-soft`。禁止再用 `border-border/60`、`/70` 这类透明度档现场手调。
- 阴影只有两档：`shadow-pop`（下拉、浮层、代码块复制按钮所在层）、`shadow-dialog`（对话框、抽屉）。普通卡片一律不用阴影，靠 `surface` + 边框分层。
- 间距：4 / 8 / 12 / 16 / 24 五档，卡内 padding 12，卡间距 8，流内消息间距 16，列表行高 32px（`h-8`）。
- z-index：`10` 下拉菜单，`20` 审批卡吸顶提示，`30` 对话框，`50` toast。
- 响应：窄窗（375px）左栏收成抽屉，中央列占满；禁止横向滚动（代码块内部滚除外）。

## 5. 交互

- 触控目标 ≥ 44px（小图标按钮用 28px 可视 + 44px 热区 padding）。
- 过渡统一 100ms（`duration-100`，弹层出入可到 150ms），只做 `color / opacity / transform`，禁止布局抖动（hover 不许 scale 位移）。
- 按钮：async 操作期间禁用 + spinner；审批按钮键盘可达（Tab 顺序 = 视觉顺序，Enter 触发）。
- 流式：文本打字机追加 + 代码块 skeleton 占位；thinking 默认折叠，流式时显示「思考中…」。- 焦点：所有可交互元素可见 focus ring（`accent` 2px outline）。**例外**：焦点已由容器表达的输入框不画内层环（左栏搜索框、会话输入框，容器 `focus-within:border-accent/70` 即焦点指示）——`src/index.css` 的 `.no-focus-ring` 显式关掉，避免内外双框（输入框无圆角且比卡片窄一圈，内层方环会横跨卡片的圆角，看起来就是"一个圆角的一个方形的"两层框）；该自定义 CSS 不分层，优先级高于 utilities，Tailwind 的 `outline-none` 压不住全局 input 焦点环。
- 动效：`prefers-reduced-motion` 时关闭打字机/旋转指示，改为静态文案。

## 6. 文案语气

- 中文、主动语态、句式收敛：按钮即动作（「新建会话」「允许一次」「恢复」「归档全部对话」），toast 即结果（「已归档」「已删除，不可恢复」）。
- 空态是邀请不是叹息：给下一步动作（「选择一个本地目录作为项目」+ 按钮）。
- 错误说清原因和修复：「目录不存在，只能移除或重定位」「模型目录加载失败，重试或检查网络」。

## 7. 可访问性与性能

- icon-only 按钮必须 `aria-label`；图片/fileMention 芯片有文字替代；表单/select 有 label。
- 颜色不作唯一信号：状态同时有文字（运行中/成功/失败/等待审批）。
- 会话流首屏增量渲染前 200 条 + 行级 `memo`（V2 M8 实测结论）：真实最大会话 8.1MB / 1411 块 → 归一只要 ~2ms，
  瓶颈在渲染而不在数据层，所以**不上虚拟列表**，改为 `ThreadRow` 行级 `React.memo`（依赖 `mergeViewMsgs`
  对未变化消息保持同一对象引用）——流式每个 delta 只重渲染正在流式的那一行，其余行跳过。
  复评阈值：单个会话 > 5000 条消息、或文件 > 30MB、或展开后交互明显掉帧，再回来做 windowing。
  测量夹具：`OMP_BENCH=1 pnpm test src/lib/historyScale.test.ts`（默认跳过，避免 CI 依赖本机数据）。
- toolResult 默认截断（前 2000 字符 + 「展开全文」）。
- 异步内容预留占位，禁止内容跳动（content-jumping）。**滚动条也要占位**：左栏会话列表 `[scrollbar-gutter:stable]`——列表从「不满一屏」长到「有滚动条」时，内容宽度不变、横向不跳一下。

## 8. 组件速查（V1 + 二期 M5 + 三期供应商 / 模型页 + 四期记忆页 + 五期使用统计页 + 六期用量限额 + 七期上下文容量 + 八期通用设置 + 九期模型页失败转移链）

### 图标（Reicon）

- 库：`reicon-react`，具名导入（`import { Check, Copy } from "reicon-react"`），构建期 tree-shake。
- 权重：一律 `Outline`（默认值，填充路径写成线框，轮廓方正）；**不要用 `Filled`**——实心块在密集列表与工具行里太重。
- 尺寸只有四档：12（行内：行内按钮、芯片、徽章）/ 13–14（列表、按钮、工具卡、状态）/ 15–16（顶栏、卡片标题、发送键）/ 20（空态）。颜色继承 `currentColor`，不传 `color`。
- **旧名映射**（Reicon 无同名时按下表；未列出的同名直用）：`ArchiveRestore` → `Undo`、`RotateCcw` → `Undo`、`FolderSearch` → `FolderError`、`GitBranch` → `DiagramTree`、`Boxes` → `Layers`、`SlidersHorizontal` → `Sliders`、`ExternalLink` → `ArrowUpRightSquare`、`KeyRound` → `Key`、`Languages` → `Language`、`MessageSquareQuote` → `QuoteDownSquare`、`RefreshCw` → `Refresh`、`Loader2` → `Loader`、`TriangleAlert` / `FileWarning` → `TriangleWarning`。
- 禁止内联手写 SVG（空态与发送键的自绘图标已并入 Reicon）；禁止 emoji 当图标。

- `ProjectRow` / `SessionRow` / `EmptyState`（空态：无项目 / 无会话两种都是「图标 → 16px semibold 标题 → 13px muted 说明」居中；**无项目**态用图标盒 `h-11 w-11` 圆角 `rounded-lg` + `border-border` + `text-muted` 包一个 20px 图标，并给「选择目录」主按钮；**无会话**态用**应用自己的图标**（π 字标，`design-system/icon/omp-mini-icon.svg` 直接引入，不复制第二份——它自带石墨底与圆角，不再包图标盒、不再加边框），只说明「消息会发到哪个目录」与快捷键，**不放新建按钮**：新建会话的入口是左栏项目分组头悬浮槽位里的 `＋`） / `UserBubble` / `AssistantText` / `ThinkingFold` / `ToolRow` / `ApprovalCard` / `UiRequestCard` / `MentionChips` / `MentionList` / `SlashMenu` / `PlanCard` / `SystemDivider` / `Composer`（会话输入框：工具行含 `ModelPicker` / `ThinkingPicker` / `PermissionBadge`，三者只在此出现；另有 `MentionList` = `@` 路径补全浮层、`SlashMenu` = `/` 命令补全浮层，两者都是 `role="listbox"`、上下键导航 / Tab·Enter 选中 / Esc 关闭，都限高内部滚动、**不挤压输入框**） / `ModelPicker` / `ThinkingPicker` / `PermissionBadge` / `ContextBar` / `ContextMeter`（含文件内私有 `Ring`） / `ProjectPicker` / `BranchPicker` / `UsageLimits`（含文件内私有 `LimitBar`） / `StatusBar` / `ConfirmDialog` / `LanguageToggle` / `ThemeToggle` / `ProvidersPanel`（含 `LoginPanel` 子组件） / `ModelsPanel`（含 `StarToggle` 子组件） / `ArchivedSessions` / `MemoryPanel` / `UsagePanel`（含 `Tile` / `ShareBar` / `DayBar` 文件内私有子组件）。
- `ApprovalCard` 与 `UiRequestCard` 分工固定，不许互相替代：`ApprovalCard` 只管审批（`extension_ui_request{method:"select", options 含 "Approve"}`，三按钮 = 允许一次 / 总是允许（本会话）/ 拒绝，warn 色边 + 盾牌；回执后进入终态：按钮收起、展示"已允许/已拒绝"结论，不许重复点）；`UiRequestCard` 管其余交互请求（`confirm` 双按钮、`input` 单行、`editor` 多行、非审批 `select` 选项按钮 + `optionDetails` 描述行，accent 色边 + 引号图标），两者出现都滚入视野、等待期间 composer 锁定、取消都回 `{cancelled:true}`。
- `ContextBar` = 输入框上方一行，由 `ProjectPicker`（项目下拉：切上下文 + 打开该项目最近会话）、`BranchPicker`（git 分支只读指示器）与 `UsageLimits`（用量限额：供应商配额）组成；下拉展开列表里分支项是**静态文本不是按钮**（没有切换动作，只给「刷新」），项目项才是可点按钮。三者只在此出现，左栏分组头不再重复一套。
- `UsageLimits`（`src/components/composer/UsageLimits.tsx`）= **供应商侧的配额进度条 + 展开明细**（5 小时 / 每周 / 每月——opencode 网站那种限额），数据来自 `omp usage --json`。收起态 = `Gauge` 图标 + 窗口名（5 小时 / 每周 / 每月）+ 细进度条 + 百分比，显示当前会话供应商的**主窗口**（优先 5 小时）；展开态 = 按供应商分段（当前供应商排首位）列出全部窗口，行 = 窗口名 + 进度条 + 百分比 + 「N 后重置」，标题行给「用量限额 · 更新于 N 前」+ 刷新。**一份窗口都拿不到时整块不渲染**（一个供应商都没配就没有入口）；**但「配了供应商、上游却拿不到用量」要显式列出来**——一块「`provider` · 无用量数据 · omp 暂不支持查询这个供应商的用量（模型仍可正常使用）」，最多 4 块、其余折叠成一行（沉默地少一块比一行灰字糟糕得多）。**收起态的可用性 = 「当前模型能不能查」**：有数据 → 进度条 + 可点；没有查询路径（omp 没做这个供应商的探针）或从未查到且失败 → **置灰不可点**（`disabled` + `opacity-40` + `cursor-default`，原因只放悬浮说明，按钮上不写字、不摆假数字）；没有「在用的模型」时仍可点（看全部供应商），有旧数据但刷新失败继续显示旧值。进度条配色走语义色：<80% `accent`、≥80% `warn`、≥100% 或 `exhausted` `danger`（阈值对齐 omp 自己的判定），纯 CSS 百分比宽度、不引图表库，颜色之外还有百分比数字（不作唯一信号）。**它和 `UsagePanel`（设置 › 使用统计 = 本地 jsonl 的 token 聚合）、`ContextMeter`（上下文窗口占用）是三件事**，不许互相替代或合并。
- `ContextMeter`（`src/components/composer/ContextMeter.tsx`）= **上下文窗口占用**：挂在输入框工具行、`ModelPicker` **左侧**，收起态 = 容量环（纯 CSS `conic-gradient` + 径向遮罩掏空中心的 14px 圆环）+ 11px mono 百分比；占用 ≥80% 转 `warn`（与压缩入口 `CompactButton` 同阈值）。展开态（向上弹）自下而上：标题行（「上下文容量」+ mono 读数 `28.5K/1M（2.9%）`）→ 分段总量条（按窗口占比堆叠，段序与分项行一一对应，颜色只用 accent 的透明度档）→ 分项行（色点 + 名称 + 百分比 + token 数）→ 分隔线 + 「平均缓存命中率」→ 一行 11px `faint` 的估算口径说明。**它只是读数，不是行动点**：上下文满了要压缩走 `CompactButton`，两者不许合并。**没有 `omp-state` 真值时整块不渲染**；分项里「总量 / 窗口 / 消息」是 omp 真值，非消息各档是估算（界面已标注）。**它和 `UsagePanel`（本地 jsonl 的 token 聚合）、`UsageLimits`（供应商配额）是三件事**，不许互相替代或合并。
- `SlashMenu`（`src/components/composer/SlashMenu.tsx`）= **输入框 `/` 命令补全浮层**（卡片内、输入框上方；与 `MentionList` 同一套浮层语言：`max-h-56` 内部滚动 + 底部提示行，**不挤压输入框**——上一版命令列表被撤掉正是因为 48 条把输入框顶出了屏幕）。数据是 **omp 自己的命令面**（`available_commands_update` 透传，本机实测 52 条）：**技能就是命令面里 `skill:<名>` 的那批**（`source:"skill"`），所以**不另扫技能目录**（会与命令面重复，还要复刻 omp 的加载优先级与 shadow 规则）；**子智能体没有输入框触发路径**（`/agents` hub 是终端 TUI 专属，RPC 命令面里不含它们），**这组不做**——不摆点了没用的行。
  行 = `/` + 命令名（前缀 `faint`、名字正文色；技能行的前缀是 `/skill:`，因为补全后写进输入框的确实就是它）+ 描述（`truncate`）+ 参数提示（右侧 `faint` mono、限宽截断，`title` 给全文）。**分组固定为「命令组（无标题）→ 技能组（标题「技能」）」**，组内按匹配质量排（名字前缀 > 名字子串 > 别名 > 描述子串，同分保持 omp 原序）——分组优先于分数，列表结构才不随输入跳动。空查询给全量 + 提示行「输入内容以搜索命令或技能」；零命中列表区给「没有匹配的命令」而**面板不消失**（消失会让人以为命令不存在）。选中写回 `/<完整命令名> `（尾随空格，接着可打参数）。**打全即发**：草稿首 token 已是某个候选的完整命令名（含别名）时 Enter 直接发送、补全不拦截——否则打完 `/usage` 回车只会被补成 `/usage ` 停在原地。**流式中不弹**：那时 Enter 走 `follow_up` 排队，`/xxx` 是当文本发出去的，弹出来等于暗示它能当命令跑。
- `ModelPicker` **下拉内容 = 常用模型**（设置 ›「模型」挑的星标，按挑选顺序）：常用为空**或**已挑模型在当前目录里全部不可用 → 回退为全部可用模型，此时下拉顶部有一行 11px `text-faint` 说明（「未挑选常用模型时显示全部可用模型 · 可在 设置 › 模型 里挑选」）；**不许出现空下拉**。触发按钮文案只按目录查 `currentModel`，查不到显示「模型」（不许回退目录首项）。行角标只留 context（`1M`/`200K`）与图片（`图`），不显示 thinking 档数；`ThinkingPicker` 只列当前模型支持的档位（`off` 恒在首位），无思考模型在下拉内提示「当前模型不支持思考」。两者触发按钮**按内容自适应宽度、不截断**（`whitespace-nowrap` + `shrink-0`，不设 `max-w-*`），空间不足时由工具行 `flex-wrap` 换行兜底；`ProjectPicker` / `BranchPicker` 触发按钮同规矩。
- `ToolRow`（`src/components/thread/ToolRow.tsx`，原 `ToolCard`）= **工具调用是一行，不是一个盒子**：`图标 + 动词 + 主片段 + 次要片段 + 行数增量`，13px，无边框无底色，hover / 展开时才铺一层全局 `hover` 底。这是消息流的主纹理（一次会话几百次调用），**禁止再给它加回卡边、卡底或独立卡片容器**——盒子一多，正文就被淹掉。
  - 取词与切分走纯函数 `src/lib/toolLine.ts`：`read`/`write`/`edit` = 文件基名（正文色）+ 目录（11px `faint` mono，保留结尾斜杠；omp 的 `path:行号:模式` 读法后缀剥掉，行号只出现在展开面板）；`bash` = 整条命令（可截断，`TerminalSquare` 图标）；`grep`/`glob` = 模式 + 路径；未知工具 = omp 的意图（没有才退回原始参数，不许把 `{"i":…}` 糊在行上）。动词进字典（读取 / 写入 / 编辑 / 终端 / 搜索）。
  - 行数增量（`+N −M`，`ViewMsg.diffStat`）取自 `write.content` / `edit.new_string` / `old_string` 的行数，由后端口径在归一时刻算好；`+N` 用 `ok` 色、`−M` 用 `danger` 色，为 0 的一侧不画。
  - 状态**只画需要说话的那几种**：成功不画勾（一行流过本身就是回执），失败 = `danger` 色 X + 自动展开，运行中 = `accent` 转圈；状态词始终在 `aria-label` 与 `sr-only` 里（颜色不作唯一信号）。点击整行展开：意图行 + 可点打开的参数摘要 + 输出块（沿用 `bg-code`，截断口径不变）。
  - 思考块（`ThinkingFold`）同规矩：`Bulb + 思考 · 持续了 N 秒 + chevron` 一行（无卡片外壳），展开才出正文。**连续的执行痕迹行之间用 `mb-1`**（`Thread.tsx` 的 `tight`），正文段落之间仍是 `mb-4`——成串的工具行读成一整段，而不是一摞盒子。
- 新增组件先查此表，禁止同义重复（如第二种 confirm 框、第二种 tool 卡）。
- `AssistantText` = 助手正文（Markdown 渲染 + 代码高亮 + 代码块复制 + 流式未闭合围栏 skeleton），实现见 `src/components/thread/AssistantText.tsx`；用户气泡、工具输出不走 Markdown（前者是用户原话，后者是日志）。`RuntimeStats`（用量透传）与 `OmpStatusPill` 同属 `StatusBar.tsx`，只挂输入框工具行。
- `MentionChips`（`src/components/thread/MentionChips.tsx`）= `@文件` 提及被 omp 读进上下文后的芯片排：11px mono、`rounded-lg` 细边、`FileText` 图标 + 路径 + 「N 行 / NKB」；被跳过的文件（`skippedReason`）换 `FileWarning` + warn 色，tooltip 写「已跳过自动读取（原因）」。输入框里的**草稿芯片**复用同一视觉（在 `Composer` 内联，不另起组件），路径不存在时同样走 warn 色。
- `MentionList`（`src/components/composer/MentionList.tsx`）= 输入框 `@` 补全浮层（浮在输入框内部上方、`mx-3 mb-1`，`rounded-md` 边 + `bg-elevated` + `shadow-pop`）。三段固定：**分组标题**（11px `faint`「文件」）→ **候选行**（`max-h-52` 滚动 + 高亮项 `scrollIntoView({block:"nearest"})` 跟随键盘）→ **操作提示行**（11px `faint`：`↑↓ 选择 · Tab 或 Enter 补全 · Esc 关闭`，上边 `border-border-soft`）。行 = **图标 + 文件基名（13px `text-foreground`，完整显示）+ 目录（11px mono `faint`，保留结尾斜杠，`min-w-0 truncate`）**，行高 32px（对齐 §4 列表行口径），高亮走全局 `bg-hover`。**辨识度靠图标形状、不靠颜色**：类别判定在 `src/lib/fileKind.ts`（扩展名 + 少数无扩展名惯用名 → `dir` / `code` / `doc` / `image` / `archive` / `file`，认不出退回 `file`），图标一律 Outline、14px；颜色只有两级——**目录 `accent`**（与左栏文件夹同色）、**文件 `muted`**，不给文件名上色（§2 单强调色对这里同样有效）。`role="listbox"` 只包候选行，标题与提示行在它外面（它们不是可选项）。
- `ConfirmDialog`（`src/components/ConfirmDialog.tsx`）已落地：受控浮层、Esc/遮罩取消、焦点默认在「取消」、危险操作走 danger 色；批量删除等**跨分组**的危险操作走它，项目分组内的轻量确认仍是分组内联浮层（不撑布局）。`Toast` 仍未落地——新增提示优先用内联错误条，不要临时造第三种提示样式。
- `ThemeToggle`（`src/components/ThemeToggle.tsx`）= 皮肤三档分段控件（跟随系统 / 深色 / 浅色），**只挂在左栏底部「设置」行右侧**（全 app 唯一入口，设置页不再重复一份）：`role="radiogroup"` + 三个 `role="radio"`（`aria-checked`），左右方向键组内循环；容器 `rounded-md border-border` + `p-0.5`，档位按钮 26px 见方（`p-1.5` + 14px 图标 `Monitor`/`Moon`/`Sun`），选中项走全局同一套 `bg-active` 底 + `text-foreground`、未选中 `text-muted hover:bg-hover`。它只切 `<html class="dark">`（纯展示层，localStorage `omp.theme.v1`），不写 omp 配置、不写覆盖层。
- `LanguageToggle`（`src/components/LanguageToggle.tsx`）= 界面语言三档分段控件（**跟随系统 / 简体中文 / English**），**只挂在左栏底部「设置」行、`ThemeToggle` 左侧**（全 app 唯一入口，设置页不再重复一份）：`role="radiogroup"` + 三个 `role="radio"`（`aria-checked`），左右方向键组内循环；容器与选中态样式与 `ThemeToggle` 同款（`rounded-md border-border` + `p-0.5`、`bg-active` 选中底），「跟随系统」档与皮肤同款用 `Monitor` 图标（两处语义都是"听系统的"）、两个语言档显**自称简称**（`中` / `EN`）——窄处放不下全称，全称与「只改本应用展示、不写 omp 配置」那句口径说明进 `title` / `aria-label`；按钮高度对齐主题档位的 26px。语言名是**自称**（`LOCALE_NAMES` / `LOCALE_SHORT` 常量，不随界面语言翻译，所以不进字典）。**`system` 档的实际语言是解析出来的**（`resolveLocale`：`zh*` → 中文，其余 → 英文），系统语言变了界面跟着换；偏好存 localStorage `omp.locale.v1`。
- `SettingsPage`（`src/components/SettingsPage.tsx`）= 设置页外壳，顶部**分页签**（`role="tablist"`，选中页签用 accent 下划线 + 正文色）：`通用`（omp 诊断 / omp 常用设置 / 应用更新；界面语言不在这里——入口是左栏底部的 `LanguageToggle`）+ `供应商`（omp 登录登出）+ `模型`（模型角色 + 失败转移 + 常用模型 + 可用模型目录）+ `记忆`（omp 项目记忆的清单 / 预览 / 删除）+ `使用统计`（本机会话用量的只读聚合）+ `已归档对话`。底部「返回」按钮与页签平级，不属于任何页签。
- `GeneralSettingsPanel`（`src/components/settings/GeneralSettingsPanel.tsx`）= 「设置 › 通用」里的「omp 常用设置」：**omp 全局配置里 40 个常用键**（白名单 / 分组 / 枚举取值表都在 `src/lib/ompSettings.ts`）的读写面。标题行（`Sliders` +「omp 常用设置」+ 右侧「刷新」）→ 一行口径说明（写的是 omp 全局配置、新建会话一定读到、项目 `.omp/config.yml` 覆盖优先）→ 6 个**可折叠分组**（组头 = chevron + 组名 + mono 计数，默认全展开）。行 = 中文 label（13px）+ omp 键名（10px mono faint，`minusOneIsDefault` 的键在值为 `-1` 时追加「-1 = 默认」）+ 行尾「恢复 omp 默认值」（`Undo` 图标按钮）+ 控件；**整行的 `title` 是上游英文说明**（`description` 原样透传，不翻译）。控件三选一：**开关**（`Switch`，文件内私有：`role="switch"` + `aria-checked`，18px 高胶囊 + 14px 滑块，开 `bg-accent` / 关 `bg-border`，滑块 `bg-surface`）、**枚举**（触发按钮显示当前值 + chevron，点开**行内展开**选项列表——设置页是可滚动容器，浮层会被裁；当前值不在选项表里时原样补一条）、**数字框**（`input[type=number]`，Enter / 失焦提交，与当前值相同就不打扰 omp）。**写入先乐观改、失败回滚 + 内联错误条**；上游没有这个键的行标「当前 omp 版本没有这个设置」并禁用控件（不摆壳侧编的默认值）。图标只用 `Sliders` / `ChevronDown` / `ChevronRight` / `Undo` / `Loader` / `Refresh`。
- `ProvidersPanel`（`src/components/settings/ProvidersPanel.tsx`）= 「设置 › 供应商」页签内容：omp OAuth 供应商清单（名称 + id + 「已配置 / 未配置」+「登录」；已配置行多一个「登出」），标题行右侧「刷新」（供应商 + 模型目录一起刷，「已配置」标记取自目录）。登录卡（`LoginPanel`，文件内子组件）固定在列表**上方**并自动滚入视野：状态行（等待浏览器授权 / 登录成功 / 登录失败 / 已取消）+ 授权 URL（「打开浏览器」+「复制链接」）+ 上游输出窗口（`<pre>`，尾部 40 行）+ 输入行（回答上游提问）+ 「取消」。登出走 `ConfirmDialog`（danger）。
- `ModelsPanel`（`src/components/settings/ModelsPanel.tsx`）= 「设置 › 模型」页签内容，**四段固定顺序：模型角色 → 失败转移 → 常用模型 → 可用模型**。**模型角色**（角色行 = 中文名 + role id + 当前 selector 或「未配置」+ **档位按钮** +「选择 / 清除」；selector 拆成「模型 + `:档位` chip」两截显示，档位按钮只在该模型支持思考时出现、候选按模型声明的档裁剪（目录里查不到该 selector 时退化为 `THINKING_ORDER` 全集，不挡自定义与角色别名），点开是**行内芯片排** `默认 | off | low | … | max`——「默认」= 摘掉后缀、交给 omp 的 `defaultThinkingLevel`，点选即写回 `selector:档位`；选择器与档位芯片排都**行内展开**（`ModelPickList`：搜索框 + 按供应商分组的模型列表）；`modelRoleStorage=project` 时给 warn 提示）→ **失败转移**（见下条 `FallbackChains`）→ **常用模型**（本应用偏好，localStorage；说明行 + 空态「还没有常用模型——展开下方『可用模型』，点模型右侧的星标添加」+ 已挑项列表 = 星标（Filled/accent）+ 名称 + mono selector，目录里找不到的项标 warn 色「已不可用」；`StarToggle` 是文件内私有组件，目录行与常用列表共用，`aria-pressed` + 「加入/移出常用模型 {0}」）→ **可用模型**（只读，按供应商分组折叠，标题行给「共 N 个模型 · M 个供应商」+「刷新」；标题行下方是**过滤框**，按 `provider/id` 与名称收窄，过滤态下命中组一律展开、组头退化为静态行、标题行改显「匹配 N 个模型 · M 个供应商」、零命中给「无匹配模型」；每个模型行尾是常用星标）。角色的中文名映射挪到 `src/lib/roleNames.ts`（角色列表与失败转移的角色候选共用，两处各写一遍会漂），自定义角色原样显示 id。
- `FallbackChains`（`src/components/settings/FallbackChains.tsx`，导出 `FallbackChainsSection`）= 「设置 › 模型」里的**失败转移**区块（omp `retry.fallbackChains`）——模型请求失败时由谁来接手。标题行（`DiagramTree` +「失败转移」+「刷新」）→ 一行口径说明（**限流 / 过载 / 5xx / 网络**才触发、**上下文溢出不走这条**、键可以是角色名 / 模型 / 供应商通配）→ **总开关**（`role="switch"`，开=`border-accent/50 bg-active`、关=`border-border text-muted`；**关闭时下方给一行 `warn` 提示**「所有转移链都不生效」——链配好了却不生效是这块最容易踩的坑，不藏在悬浮提示里）+ **回归策略两档分段控件**（仅启用时出现，与 `ThemeToggle` 同款容器语言：`rounded-md border` + `p-0.5` + 选中 `bg-active`/未选中 `text-muted hover:bg-hover`，文字档按钮走 `text-[12px]` 而非图标）→ **链列表**（每条两块：上行 = 类型徽章（`border-border` 圆角小字：角色 / 模型 / 供应商通配）+ mono 键 +「编辑 / 删除」；下行 = 有序目标芯片排 `→ a → b`，`text-[11px] mono` ——**箭头必须保留**，顺序就是 omp 的尝试顺序）+「添加转移链」。**编辑区（新建与编辑共用 `ChainEditor`，行内展开）**：新建时先挑生效对象（三档分段：角色 / 模型 / 供应商通配，候选里**已在用的键置灰** `disabled:opacity-40`——一个键只能有一条链；模型档用 `ModelPickList`），再维护**有序目标列表**（每行 = 序号 + mono selector + 档位 chip + 上移 / 下移 / 移除；档位 chip 点开行内芯片排，**通配条目不给档位控件**——omp 规定它总是继承，只显示「继承档位」灰字；首行上移与末行下移 `disabled`）；底部「保存 / 创建 + 取消 + 转圈」。**编辑是草稿 + 显式保存**（增量写会留下中间态、也会打出很多次 omp 子进程），**删除走行内二次确认**（`确认删除？` + danger 删除 + 取消，三个按钮同排；设置页是可滚动容器，浮层会被裁掉，不用 `ConfirmDialog`）。写入失败保留草稿 + 区块顶部内联 `role="alert"` 错误条。
- `ModelPickList`（`src/components/settings/ModelPickList.tsx`）= 模型选择列表（搜索框 + 按供应商分组平铺 + 点选，行尾角标 = 上下文窗口 / 思考档数）。**设置 ›「模型」里两处共用**：角色行挑模型、失败转移挑目标——两处各写一遍会漂（一处能搜一处不能、角标不一致）。搜索按 `provider/id` 与名称收窄，零命中给「无匹配模型」。
- `ArchivedSessions`（`src/components/ArchivedSessions.tsx`）= 「设置 › 已归档对话」页签内容：标题行（`Archive` 图标 + 「已归档对话」+ mono 计数 + 右侧「刷新」）→ 一行口径说明 → 按项目分组（未归属单独一组；目录缺失时分组头用 warn 色 `FolderSearch`）→ 每组一行行头（组名 + mono 路径 + 计数 + 「恢复全部 / 删除全部」）+ 会话行（标题可点开只读回放 + 日期 + 「恢复 / 删除」）。删除走 `ConfirmDialog`（单个与分组同一个浮层实例）。数据来自 `list_archived_sessions`（不看左栏扫描窗口），恢复/删除经 `src/lib/sessionBatch.ts` 并即时刷新左栏。
- `UsagePanel`（`src/components/settings/UsagePanel.tsx`）= 「设置 › 使用统计」页签内容：标题行（`ChartBar` + 「使用统计」+ 范围切换 今日 / 近 7 日 / 近 30 日 / 全部 + 「刷新」）→ 口径说明 → 总览 9 卡（`Tile`：11px faint 标签 + mono 数值 + 可选副行，副行**换行不截断**）→ `DayBar` 每日趋势 → 按模型 / 工具分布 / 时段分布 / 按项目（行 = 名称 + mono 副信息 + `ShareBar` + 次数 / token / 费用）。**图表规则（五期新增，全项目通用）**：一律纯 CSS 百分比高度/宽度，**不引图表库**；配色只用 accent 的透明度档（实心 = 主序列、`/50`、`/25`/`/15` 依次减淡），**禁止引入第二强调色**（单强调色约束对图表同样有效）；比例条底槽 `bg-accent/15` + 实心段；柱体宽度设上限（`max-w-[28px]`）并居中，避免天数少时变成色块；悬停用全局 `hover` 底做整列高亮，读数显示在标题行的 mono 小字里（不弹浮层）；每根柱带 `role="img"` + 本地化 `aria-label`。
- `TopBar`（`src/components/thread/TopBar.tsx`）= 标题备注（点击改名）+ 窄窗抽屉入口 + **复制会话为 Markdown**（`Copy`/`Check` 图标按钮，纯前端剪贴板，导出内容 = 界面上看到的 `ViewMsg`，生成规则见 `src/lib/exportMd.ts`）+ `UpdateBell`。会话为空或未选中时导出按钮禁用。
- `PlanCard`（`Thread.tsx` 内联）= 任务计划只读卡（`todoPhases` / `todo_reminder`）：阶段名 + 任务清单（✓ 已完成 / ◐ 进行中 / ○ 待办，文字双信号）；`command` 本地输出渲染为灰字代码区（`command_output` 透传）。
- 流式中追问：输入框 Enter = 排队（`follow_up`，本轮后执行）、⌘/Ctrl+Enter = 转向（`steer`，下一个工具边界生效）、工具行「排队」按钮；排队数徽标（`QueueBadge`）与压缩入口（`CompactButton`，上下文 ≥80% 才出现）挂工具行。
- 消息行的复制（V2 M9）走 `ThreadRow` 内部 hover 出现的 `CopyAction`（11px muted + `Copy`/`Check`，用户气泡靠右下、助手正文靠左下；只在消息有正文且助手正文已完成时出现）。它**自带 copied 状态、不碰 store 与草稿**——这样行级 `memo` 不被破坏（把状态提到行上会让每次点击重渲染整列）。

## 9. 应用图标

- 唯一矢量源 `design-system/icon/omp-mini-icon.svg`。改图标只改这个文件，再跑 `pnpm icon` 重新生成 `src-tauri/icons/`（icns / ico / 各尺寸 png）。
- 造型：oh-my-pi 的血脉是 Pi，故图标取 **π 作字标**——不加文字、不加第二个符号。
- 几何：1024 画布，内容圆角方 824×824 居中（圆角 186，macOS Big Sur 图标网格）；π 视觉盒 600×464 居中，笔画 96 全圆头，两腿相对横杠两端内缩 26%。T 型交汇处填 4 个 R46 内圆角（曲边三角，**不是整圆**——填整圆会在笔画外冒出珠子），横杠两端与腿底全圆头。
- 配色：**图标是品牌物，允许走出 §2 的单强调色约束**。π 走极光渐变 `#5EEAD4 → #38BDF8 → #A78BFA → #F472B6`（沿横杠左上 → 右腿右下流动），石墨底 `#232329 → #07070A` 上叠三处同色辉光（左下取极光首色、右上取末色、中央取过渡色）。
- 底线：16px 下仍要读出「一条横杠 + 两条腿」；辉光只柔化边缘，不许糊掉字形。
- 验证方式：**`pnpm tauri:dev` 里看不到自定义图标，这不是 bug**——macOS 下 dev 跑的是裸二进制（`target/debug/omp-mini-desktop`，无 .app bundle、无 `CFBundleIdentifier`），系统只给它通用可执行文件图标，根本不会去读 `src-tauri/icons/`。要验图标必须出应用包：`pnpm tauri:build` → `src-tauri/target/release/bundle/macos/ompMiniDesktop.app`。
- `src-tauri/build.rs` 里的 `println!("cargo:rerun-if-changed=icons")` 不许删：`tauri-build` 的 rerun-if-changed 只覆盖 `tauri.conf.json` / dist / Info.plist / capabilities，不覆盖 `icons/`，删掉后换了图标 cargo 不重建，产物里还是旧图标。
