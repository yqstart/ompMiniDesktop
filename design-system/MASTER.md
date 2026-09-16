# ompMiniDesktop 设计系统 MASTER（全局唯一真相）

> 适用范围：V1 全页面。页面级覆盖文件放在 `design-system/pages/`，按需覆盖本文件。
> 风格锚点：Cursor / Codex 桌面端式的**稳重**——四层灰阶拉开结构、单强调色稀释使用、密度高但装饰低。
> 技术栈：Tauri v2 + React + TS + Tailwind v4 + Zustand。图标一律 **Reicon**（`reicon-react`、Outline 权重、具名导入，映射表见 §8），禁止 emoji 图标，也禁止再手写内联 SVG。

## 1. 产品模式与风格

- 产品模式：桌面端 agent 会话壳（dense chat + 回放），不是 landing 页，不是 dashboard。
- 视觉风格：quiet utility（安静工具风）。分级靠**亮度**（background → sidebar → surface → elevated 四层）与 1px 低对比线，不靠装饰；唯一记忆点是「工具调用卡的紧凑时间线」。
- 稳重 = 少动效、少圆角、少强调色占比；形状统一（同一类控件只有一种圆角/一种悬浮色），层次清楚（段落之间有明确分隔），密度紧凑（列表行 32px、正文 14px、控件 13px）。
- 反模式：拒绝暖米色 + 衬线大标题、拒绝纯黑 + 荧光绿、拒绝报纸式 hairline 密排（三者都是 AI 默认脸，本项目禁用）。

## 2. 色彩（token 定义见 `src/index.css`）

四层灰阶，深色从下往上逐层变亮、浅色从上往下逐层变暗；边界优先靠**亮度差**表达，
1px 边框只做最后一道描线。浅色中性偏冷（不带暖偏移），深色不落纯黑。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `background` | `#FBFBFC` | `#0B0B0D` | 应用底、消息流底 |
| `sidebar` | `#F4F4F6` | `#0F0F12` | 左栏底 |
| `surface` | `#FFFFFF` | `#16161A` | 卡片、气泡、工具卡、输入框 |
| `elevated` | `#FFFFFF` | `#1C1C21` | 下拉面板、浮层、对话框 |
| `foreground` | `#17171A` | `#E9E9EC` | 正文 |
| `muted` | `#5B5B66` | `#9A9AA4` | 次要文字（≥4.5:1） |
| `faint` | `#6E6E79` | `#7C7C87` | 元信息（时间 / 计数 / 路径，≥4.5:1） |
| `border` | `#E5E5EA` | `#232329` | 分隔线、卡边、输入框边 |
| `border-soft` | `#EFEFF2` | `#1A1A1F` | 弱分隔（分组引导线、卡内分隔线） |
| `accent` | `#4F46E5` | `#818CF8` | 发送、主按钮、运行态、链接、选中 |
| `danger` | `#DC2626` | `#F87171` | 删除、拒绝、失败边 |
| `warn` | `#B45309` | `#FBBF24` | 审批、yolo、目录缺失 |
| `ok` | `#047857` | `#34D399` | 成功态 |
| `code` | `#F1F1F4` | `#121216` | 行内代码与代码块底 |
| `hover` | accent 15% | accent 15% | **全局唯一悬浮底** |
| `active` | accent 22% | accent 22% | 选中底（行 / 分组头 / 菜单当前项） |

- **强调色只用一个**（`accent`），禁止第二强调色。审批卡的「允许一次」用 `accent` 实心按钮、Deny 用 `danger` 描边（hover 走 `bg-danger/15`，不整块翻红）。
- **悬浮色全局统一为 `hover`**：行、按钮、菜单项、下拉项、补全项、图标按钮一律 `hover:bg-hover`。禁止再出现 `hover:bg-background` / `hover:bg-surface` 这类第二套悬浮灰（同一个界面里飘着三四种灰是上一版最主要的不统一）。危险项 hover 用 `hover:bg-danger/15`，warning 项用 `hover:bg-warn/15`。
- **选中态 = `bg-active` + 左侧 2px `accent` 竖条 + 标题 `font-semibold`**，会话行与当前项目分组头共用同一套。悬浮（15%）与选中（22%）同源同色系，靠深浅拉开，不再发明第二套选中配色。
- 主入口「添加项目」是稀释强调色（`bg-accent/10` + `border-accent/25` + `text-accent`），不是实心色块——侧栏顶部放一块高饱和实心按钮太吵。
- 对比底线：正文与次要文字均 ≥ 4.5:1，元信息 `faint` 也 ≥ 4.5:1（本表已满足，勿再调浅）。

## 3. 字体

- 界面：系统栈 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Inter, sans-serif`。中文优先苹方 / 微软雅黑。
- 等宽（工具参数、路径、session id 前缀）：`"JetBrains Mono", "SF Mono", Menlo, monospace`，12–13px；等宽文本自动带 `tabular-nums`（时间、token 数、行号对齐不跳动）。
- 字阶（**只有三级**，禁止再发明）：正文 14px（消息正文行高 1.7，`leading-[1.7]`）；控件 13px（按钮、页签、选择器触发、输入框上方上下文条、下拉项）；元信息 11px（时间、计数、路径、用量、状态胶囊，配 `font-mono` 或 `faint` 色）。
- 行长：中央消息列 `max-w-3xl`（约 65–75 字符），超长代码块横向滚动不撑破布局。

## 4. 布局

- V1 两栏：左栏可拖拽（220–480px，默认 264，`sidebarWidth` 存 Zustand + localStorage 持久化；窄窗 <768px 收抽屉）→ 中央流式列居中 `max-w-3xl`。右侧栏 V1 不做。
- 左栏：顶部主入口「添加项目」（稀释强调色，`FolderPlus`；与中央空态「选择目录」共用 `src/lib/projects.ts` 的 `pickAndAddProject`）→ 会话搜索框 → 按项目分组的手风琴会话组（旋转 chevron + 左侧 hairline 引导线）+ 未归属组 → 底固定「设置」。**「添加项目」+ 搜索框是固定区**（`sticky top-0` + `bg-sidebar` 不透明底 + `z-10`，`-mx-2 px-2` 让底色铺满）：只有会话列表滚，两块不跟着滚走；用 sticky 而不是拆成两个滚动容器，是为了让搜索框与会话行共用同一条滚动条留白、宽度始终对齐。**左栏只列进行中的会话**：已归档的对话不在左栏出现（V2 M11），统一在「设置 › 已归档对话」里看、恢复与删除。
- 会话行：单行 `● 标题 … 时间/操作`，右侧 68px 固定槽位（时间与操作按钮同槽互斥：hover 时时间 `visibility` 藏、按钮绝对覆盖淡入），行高锁定 `h-8`，悬浮零跳动；删除二次确认用浮层，不撑布局。**行首不设复选框**：不做多选/批量工具条，行内只保留单会话的「归档」与「删除」；批量操作只挂在分组头。选中态见 §2：`bg-active` 底 + 2px accent 左竖条 + 标题 `font-semibold`（未选中行 `hover:bg-hover`）。
- 项目分组头：单行（chevron + 弹性标题 + 右侧 76px 固定槽位：数量与三个批量按钮同槽互斥、垂直居中 `items-center`），悬浮零跳动；缺失态在标题旁常驻小角标，hover 操作区三按钮照常可用。分组头三个操作 = **归档全部对话 / 删除全部对话 / 删除工作区**，**三者只作用于进行中的会话**（归档的对话归设置页管，不在这里被顺手删掉）：「归档全部对话」直接执行（可逆，去设置页可恢复）；「删除全部对话」走分组内浮层二次确认，真删这些会话的 jsonl、不可恢复；「删除工作区」同样浮层确认，只解绑目录、不删文件，名下对话全部归档保留（后端 `remove_project` 按 cwd 扫描 + `archived[id]=true`），可在「设置 › 已归档对话」里找回。确认框不撑布局。**会话行不设复选框**，多选/批量工具条一律不做，批量入口只在分组头。当前项目（`activeProjectId`）用与会话行同一套选中视觉（`bg-accent/15` 底 + 3px accent 左竖条 + accent 文件夹图标），文件夹类标题（项目 / 未归属）统一 `font-semibold` + 图标，层级靠字号与深浅而非第二种颜色。
- 状态收敛：标题框外的独立状态条已下线（`StatusBar` 仅保留读屏播报位）；状态统一进输入框工具行——`OmpStatusPill`（常驻展示，借鉴 Cursor / Codex 底部状态条：就绪显示「就绪」绿点常亮，非就绪用颜色 + 文字双信号强调，避免用户误以为状态丢失）+ `RuntimeStats`（上下文占用 / 本轮 token / 耗时 / TTFT，全部来自 `omp-state` 真值透传，无真值整块不渲染）。
- 窄窗抽屉入口：桌面侧栏 `hidden md:block`，顶栏左侧常驻「打开侧栏」按钮（`md:hidden`）——否则 <768px 下项目列表与设置完全不可达。打开会话 / 新建会话会自动收起抽屉。
- 左栏搜索框（Cursor / DSH 式一体搜索框）：图标内置、整块 `rounded-md` + `border-border`；`focus-within:border-accent/70`（焦点**只**由这圈外框表达，输入框自身不画内层焦点环：`no-focus-ring`）；有字时才出现清除按钮（`X`），不占位跳动；有过滤词时分组头上方显示「N 个标题匹配」，无匹配分组自动折叠。输入 ≥2 字时下方另起**内容命中**区（V2 M7b）：行 = 标题 + 归档角标 + 命中次数（11px mono）+ 两行片段（`line-clamp-2`，命中词 `<mark class="bg-accent/25">`），整行可点即打开会话；顶部一行说明「内容命中 N 个会话 / 正在搜索正文…」，被预算截断时补「已到预算上限，结果可能不全」。
- 左栏扫描窗口提示（V2 M7a）：列表底部固定区只放「设置」；会话文件总数超过本次扫描窗口时，在「设置」上方加一条 11px muted 提示「已扫描最近 N 个会话（共 M 个）」+ 细边按钮「继续扫描更早的 500 个」（达上限显示「已达上限（5000）」并禁用）。**不占会话行、不进分组头**，因为它不属于任何项目。
- 左栏项目结构（单层分组，禁止双层）：顶部「添加项目」→ 一体搜索框 → 按项目分组的手风琴会话组（分组头即项目入口：名 + mono 路径尾段 + 右侧 76px 固定槽位；点击分组头切换 `activeProjectId`，新建会话落到它；缺失态在标题旁常驻小角标）→ 未归属组。**禁止在分组上方另起一排项目快捷卡片**（之前红框那排与分组重复，造成“一个项目出现两次”，已删除）。
- 输入框工具行与上方上下文条下拉互斥：`composerMenu: model | thinking | permission | project | branch | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）。
- 输入框上方上下文条（`ContextBar`，在输入框卡片**外**、卡片上方，与卡片内文字左对齐）：左「项目」右「git 分支」，13px muted，与卡片同宽 `max-w-3xl` + 容器 `px-4`；两者都可点开且统一向上弹（只遮消息流，不遮正在打字的输入框）。一个项目都没有时整条不渲染。项目名 / 分支名不截断，窄窗口由整行 `flex-wrap` 换行兜底。分支是**只读**控件：非 git 目录显示「非 Git 目录」，不无声消失。
- 中央三段：顶栏 44px（标题 13px/600 + 复制会话为 Markdown + 更新入口，1px `border` 分隔）→ 消息流（用户气泡右对齐 `rounded-lg rounded-br-sm` + `border-border`，不用 inset-ring 代替边框）→ 会话输入框（整块 `rounded-xl` 卡：`focus-within:border-accent/70`、等待审批时 `border-warn/60`，发送为 28px 方形箭头按钮）。
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
- 流式：文本打字机追加 + 代码块 skeleton 占位；thinking 默认折叠，流式时显示「思考中…」。- 焦点：所有可交互元素可见 focus ring（`accent` 2px outline）。**例外**：焦点已由容器表达的输入框不画内层环（左栏搜索框，容器 `focus-within:border-accent/70` 即焦点指示）——`src/index.css` 的 `.no-focus-ring` 显式关掉，避免内外双框；该自定义 CSS 不分层，优先级高于 utilities，Tailwind 的 `outline-none` 压不住全局 input 焦点环。
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

## 8. 组件速查（V1 + 二期 M5 + 三期供应商 / 模型页）

### 图标（Reicon）

- 库：`reicon-react`，具名导入（`import { Check, Copy } from "reicon-react"`），构建期 tree-shake。
- 权重：一律 `Outline`（默认值，填充路径写成线框，轮廓方正）；**不要用 `Filled`**——实心块在密集列表与工具行里太重。
- 尺寸只有四档：12（行内：行内按钮、芯片、徽章）/ 13–14（列表、按钮、工具卡、状态）/ 15–16（顶栏、卡片标题、发送键）/ 20（空态）。颜色继承 `currentColor`，不传 `color`。
- **旧名映射**（Reicon 无同名时按下表；未列出的同名直用）：`ArchiveRestore` → `Undo`、`RotateCcw` → `Undo`、`FolderSearch` → `FolderError`、`GitBranch` → `DiagramTree`、`Boxes` → `Layers`、`SlidersHorizontal` → `Sliders`、`ExternalLink` → `ArrowUpRightSquare`、`KeyRound` → `Key`、`Languages` → `Language`、`MessageSquareQuote` → `QuoteDownSquare`、`RefreshCw` → `Refresh`、`Loader2` → `Loader`、`TriangleAlert` / `FileWarning` → `TriangleWarning`。
- 禁止内联手写 SVG（空态与发送键的自绘图标已并入 Reicon）；禁止 emoji 当图标。

- `ProjectRow` / `SessionRow` / `EmptyState`（空态图标盒：`h-11 w-11` 圆角 `rounded-lg` + `border-border` + `text-muted`，标题 16px semibold，说明 13px muted，按钮 `rounded-md`） / `UserBubble` / `AssistantText` / `ThinkingFold` / `ToolCard` / `ApprovalCard` / `UiRequestCard` / `MentionChips` / `PlanCard` / `SystemDivider` / `Composer`（会话输入框：工具行含 `ModelPicker` / `ThinkingPicker` / `PermissionBadge`，三者只在此出现；另有 `/` 命令补全浮层与 `@` 路径补全浮层，`role="listbox"`，上下键导航/Tab·Enter 选中/Esc 关闭） / `ModelPicker` / `ThinkingPicker` / `PermissionBadge` / `ContextBar` / `ProjectPicker` / `BranchPicker` / `StatusBar` / `ConfirmDialog` / `ProvidersPanel`（含 `LoginPanel` 子组件） / `ModelsPanel`（含 `StarToggle` 子组件）。
- `ApprovalCard` 与 `UiRequestCard` 分工固定，不许互相替代：`ApprovalCard` 只管审批（`extension_ui_request{method:"select", options 含 "Approve"}`，三按钮 = 允许一次 / 总是允许（本会话）/ 拒绝，warn 色边 + 盾牌；回执后进入终态：按钮收起、展示"已允许/已拒绝"结论，不许重复点）；`UiRequestCard` 管其余交互请求（`confirm` 双按钮、`input` 单行、`editor` 多行、非审批 `select` 选项按钮 + `optionDetails` 描述行，accent 色边 + 引号图标），两者出现都滚入视野、等待期间 composer 锁定、取消都回 `{cancelled:true}`。
- `ContextBar` = 输入框上方一行，由 `ProjectPicker`（项目下拉：切上下文 + 打开该项目最近会话）与 `BranchPicker`（git 分支只读指示器）组成；下拉展开列表里分支项是**静态文本不是按钮**（没有切换动作，只给「刷新」），项目项才是可点按钮。三者只在此出现，左栏分组头不再重复一套。
- `ModelPicker` **下拉内容 = 常用模型**（设置 ›「模型」挑的星标，按挑选顺序）：常用为空**或**已挑模型在当前目录里全部不可用 → 回退为全部可用模型，此时下拉顶部有一行 11px `text-faint` 说明（「未挑选常用模型时显示全部可用模型 · 可在 设置 › 模型 里挑选」）；**不许出现空下拉**。触发按钮文案只按目录查 `currentModel`，查不到显示「模型」（不许回退目录首项）。行角标只留 context（`1M`/`200K`）与图片（`图`），不显示 thinking 档数；`ThinkingPicker` 只列当前模型支持的档位（`off` 恒在首位），无思考模型在下拉内提示「当前模型不支持思考」。两者触发按钮**按内容自适应宽度、不截断**（`whitespace-nowrap` + `shrink-0`，不设 `max-w-*`），空间不足时由工具行 `flex-wrap` 换行兜底；`ProjectPicker` / `BranchPicker` 触发按钮同规矩。
- 新增组件先查此表，禁止同义重复（如第二种 confirm 框、第二种 tool 卡）。
- `AssistantText` = 助手正文（Markdown 渲染 + 代码高亮 + 代码块复制 + 流式未闭合围栏 skeleton），实现见 `src/components/thread/AssistantText.tsx`；用户气泡、工具输出不走 Markdown（前者是用户原话，后者是日志）。`RuntimeStats`（用量透传）与 `OmpStatusPill` 同属 `StatusBar.tsx`，只挂输入框工具行。
- `MentionChips`（`src/components/thread/MentionChips.tsx`）= `@文件` 提及被 omp 读进上下文后的芯片排：11px mono、`rounded-lg` 细边、`FileText` 图标 + 路径 + 「N 行 / NKB」；被跳过的文件（`skippedReason`）换 `FileWarning` + warn 色，tooltip 写「已跳过自动读取（原因）」。输入框里的**草稿芯片**复用同一视觉（在 `Composer` 内联，不另起组件），路径不存在时同样走 warn 色。
- `ConfirmDialog`（`src/components/ConfirmDialog.tsx`）已落地：受控浮层、Esc/遮罩取消、焦点默认在「取消」、危险操作走 danger 色；批量删除等**跨分组**的危险操作走它，项目分组内的轻量确认仍是分组内联浮层（不撑布局）。`Toast` 仍未落地——新增提示优先用内联错误条，不要临时造第三种提示样式。
- `SettingsPage`（`src/components/SettingsPage.tsx`）= 设置页外壳，顶部**分页签**（`role="tablist"`，选中页签用 accent 下划线 + 正文色）：`通用`（界面语言 / omp 诊断 / 应用更新）+ `供应商`（omp 登录登出）+ `模型`（常用模型 + 模型角色 + 可用模型目录）+ `已归档对话`。底部「返回」按钮与页签平级，不属于任何页签。
- `ProvidersPanel`（`src/components/settings/ProvidersPanel.tsx`）= 「设置 › 供应商」页签内容：omp OAuth 供应商清单（名称 + id + 「已配置 / 未配置」+「登录」；已配置行多一个「登出」），标题行右侧「刷新」（供应商 + 模型目录一起刷，「已配置」标记取自目录）。登录卡（`LoginPanel`，文件内子组件）固定在列表**上方**并自动滚入视野：状态行（等待浏览器授权 / 登录成功 / 登录失败 / 已取消）+ 授权 URL（「打开浏览器」+「复制链接」）+ 上游输出窗口（`<pre>`，尾部 40 行）+ 输入行（回答上游提问）+ 「取消」。登出走 `ConfirmDialog`（danger）。
- `ModelsPanel`（`src/components/settings/ModelsPanel.tsx`）= 「设置 › 模型」页签内容，三段固定顺序：**常用模型**（本应用偏好，localStorage；说明行 + 空态「还没有常用模型——展开下方『可用模型』，点模型右侧的星标添加」+ 已挑项列表 = 星标（Filled/accent）+ 名称 + mono selector，目录里找不到的项标 warn 色「已不可用」；`StarToggle` 是文件内私有组件，目录行与常用列表共用，`aria-pressed` + 「加入/移出常用模型 {0}」）→ **模型角色**（角色行 = 中文名 + role id + 当前 selector 或「未配置」+「选择 / 清除」，选择器**行内展开**：搜索框 + 按供应商分组的模型列表；`modelRoleStorage=project` 时给 warn 提示）→ **可用模型**（只读，按供应商分组折叠，标题行给「共 N 个模型 · M 个供应商」+「刷新」；标题行下方是**过滤框**，按 `provider/id` 与名称收窄，过滤态下命中组一律展开、组头退化为静态行、标题行改显「匹配 N 个模型 · M 个供应商」、零命中给「无匹配模型」；每个模型行尾是常用星标）。角色的中文名映射（default→默认 / smol→快速 / slow→深思 / vision→视觉 / plan→架构规划 / commit→提交信息 / tiny→微型 / task→子任务 / advisor→顾问）只在本文件里，自定义角色原样显示 id。
- `ArchivedSessions`（`src/components/ArchivedSessions.tsx`）= 「设置 › 已归档对话」页签内容：标题行（`Archive` 图标 + 「已归档对话」+ mono 计数 + 右侧「刷新」）→ 一行口径说明 → 按项目分组（未归属单独一组；目录缺失时分组头用 warn 色 `FolderSearch`）→ 每组一行行头（组名 + mono 路径 + 计数 + 「恢复全部 / 删除全部」）+ 会话行（标题可点开只读回放 + 日期 + 「恢复 / 删除」）。删除走 `ConfirmDialog`（单个与分组同一个浮层实例）。数据来自 `list_archived_sessions`（不看左栏扫描窗口），恢复/删除经 `src/lib/sessionBatch.ts` 并即时刷新左栏。
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
