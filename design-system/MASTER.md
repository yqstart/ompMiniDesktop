# ompMiniDesktop 设计系统 MASTER（全局唯一真相）

> 适用范围：V1 全页面。页面级覆盖文件放在 `design-system/pages/`，按需覆盖本文件。
> 风格锚点：DeepSeek Harness 主界面式极简——安静底色、单强调色、高密度但低装饰。
> 技术栈：Tauri v2 + React + TS + Tailwind v4 + Zustand。图标一律 Lucide SVG，禁止 emoji 图标。

## 1. 产品模式与风格

- 产品模式：桌面端 agent 会话壳（dense chat + 回放），不是 landing 页，不是 dashboard。
- 视觉风格：quiet utility（安静工具风）。大面积留白、细边框、低对比分隔，唯一记忆点是「工具调用卡的紧凑时间线」，其余全部克制。
- 反模式：拒绝暖米色 + 衬线大标题、拒绝纯黑 + 荧光绿、拒绝报纸式 hairline 密排（三者都是 AI 默认脸，本项目禁用）。

## 2. 色彩（冻结 V1）

深色走 opencode / deepseek-harness 式分层锌灰：`bg #0A0A0A` 应用底 →
`sidebar #101010` 侧栏 → `surface #161616` 卡片/气泡，边框 `border #232323`
只用 1px 低对比线。浅色同构：`bg #FAFAF9` → `sidebar #F4F4F2` → `surface #FFFFFF`。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `bg` | `#FAFAF9` | `#0A0A0A` | 应用底 |
| `sidebar` | `#F4F4F2` | `#101010` | 左栏底（新增，与底色拉开一层） |
| `surface` | `#FFFFFF` | `#161616` | 卡片、气泡、输入框 |
| `fg` | `#1C1917` | `#EDEDED` | 正文 |
| `muted` | `#57534E` | `#9E9E9E` | 次要文字（浅色对比约 7:1，深色约 5.5:1） |
| `border` | `#E7E5E4` | `#232323` | 分隔线、卡边 |
| `accent` | `#4F46E5` | `#818CF8` | 仅发送按钮/运行态/链接 |
| `danger` | `#DC2626` | `#F87171` | 删除、拒绝、失败边 |
| `warn` | `#D97706` | `#FBBF24` | yolo 警告、审批注意 |
| `ok` | `#059669` | `#34D399` | 成功态 |

- 强调色只用一个，禁止第二强调色。审批卡的 Approve 用 `accent` 实心按钮，Deny 用描边按钮，删除用 `danger`。
- 代码块背景：浅色 `#F5F5F4`，深色 `#1C1917`。
- 对比底线：正文 ≥ 4.5:1，次要文字 ≥ 4.5:1（本表已满足，勿再调浅）。

## 3. 字体

- 界面：系统栈 `-apple-system, "PingFang SC", "Microsoft YaHei", Inter, sans-serif`。中文优先苹方 / 微软雅黑。
- 等宽（工具参数、路径、session id 前缀）：`"JetBrains Mono", "SF Mono", Menlo, monospace`，12–13px。
- 字阶：正文默认 14px（body 基准，`text-sm`）；会话标题 15px/600，消息正文 14px/1.7，时间/角标 11px mono，顶栏选择器 13px；工具行 compact 触发态 12px。元信息（时间/计数/路径）统一 11px mono muted，禁止再发明新字阶。
- 行长：中央消息列 `max-w-3xl`（约 65–75 字符），超长代码块横向滚动不撑破布局。

## 4. 布局

- V1 两栏：左栏可拖拽（220–480px，默认 264，`sidebarWidth` 存 Zustand + localStorage 持久化；窄窗 <768px 收抽屉）→ 中央流式列居中 `max-w-3xl`。右侧栏 V1 不做。
- 左栏：顶部主入口「添加项目」（accent 实心，`FolderPlus`；与中央空态「选择目录」共用 `src/lib/projects.ts` 的 `pickAndAddProject`）→ 会话搜索框 → 按项目分组的手风琴会话组（旋转 chevron + 左侧 hairline 引导线）+ 未归属组 → 底固定「设置」。
- 会话行：单行 `● 标题 … 时间/操作`，右侧 68px 固定槽位（时间与操作按钮同槽互斥：hover 时时间 `visibility` 藏、按钮绝对覆盖淡入），行高锁定 `h-9`，悬浮零跳动；删除二次确认用浮层，不撑布局。**行首不设复选框**：不做多选/批量工具条，行内只保留单会话的归档（已归档时为取消归档）与删除；批量操作只挂在分组头。
- 项目分组头：单行（chevron + 弹性标题 + 右侧 76px 固定槽位：数量与三个批量按钮同槽互斥、垂直居中 `items-center`），悬浮零跳动；缺失态在标题旁常驻小角标，hover 操作区三按钮照常可用。分组头三个操作 = **归档全部对话 / 删除全部对话 / 删除工作区**：「归档全部对话」直接执行（可逆）；「删除全部对话」走分组内浮层二次确认，真删 jsonl、含已归档、不可恢复；「删除工作区」同样浮层确认，只解绑目录、不删文件，名下对话全部归档保留（后端 `remove_project` 按 cwd 扫描 + `archived[id]=true`），可进「未归属会话」的已归档里找回。确认框不撑布局。**会话行不设复选框**，多选/批量工具条一律不做，批量入口只在分组头。
- 状态收敛：标题框外的独立状态条已下线（`StatusBar` 仅保留读屏播报位）；状态统一进输入框工具行——`OmpStatusPill`（常驻展示，借鉴 Cursor / Codex 底部状态条：就绪显示「就绪」绿点常亮，非就绪用颜色 + 文字双信号强调，避免用户误以为状态丢失）+ `RuntimeStats`（上下文占用 / 本轮 token / 耗时 / TTFT，全部来自 `omp-state` 真值透传，无真值整块不渲染）。
- 窄窗抽屉入口：桌面侧栏 `hidden md:block`，顶栏左侧常驻「打开侧栏」按钮（`md:hidden`）——否则 <768px 下项目列表与设置完全不可达。打开会话 / 新建会话会自动收起抽屉。
- 左栏搜索框（Cursor / DSH 式一体搜索框）：图标内置、整块 `rounded-xl` + `border-border/60`；`focus-within:border-accent/60`；有字时才出现清除按钮（`X`），不占位跳动；有过滤词时分组头上方显示「N 个匹配」，无匹配分组自动折叠。
- 左栏项目结构（单层分组，禁止双层）：顶部「添加项目」→ 一体搜索框 → 按项目分组的手风琴会话组（分组头即项目入口：名 + mono 路径尾段 + 右侧 76px 固定槽位；点击分组头切换 `activeProjectId`，新建会话落到它；缺失态在标题旁常驻小角标）→ 未归属组。**禁止在分组上方另起一排项目快捷卡片**（之前红框那排与分组重复，造成“一个项目出现两次”，已删除）。
- 输入框工具行与上方上下文条下拉互斥：`composerMenu: model | thinking | permission | project | branch | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）。
- 输入框上方上下文条（`ContextBar`，在输入框卡片**外**、卡片上方，与卡片内文字左对齐）：左「项目」右「git 分支」，13px muted，与卡片同宽 `max-w-3xl` + 容器 `px-4`；两者都可点开且统一向上弹（只遮消息流，不遮正在打字的输入框）。一个项目都没有时整条不渲染。项目名 / 分支名不截断，窄窗口由整行 `flex-wrap` 换行兜底。分支是**只读**控件：非 git 目录显示「非 Git 目录」，不无声消失。
- 中央三段：顶栏 44px（标题 + 更新入口，无边框感）→ 消息流（用户气泡右对齐圆角 `rounded-2xl rounded-br-md` + inset ring）→ 会话输入框（整块 `rounded-2xl` 卡：`focus-within` accent 边 + 悬浮阴影，发送为圆形箭头按钮）。
- 圆角：卡片 `rounded-xl`（12px）、输入框/气泡 `rounded-2xl`（16px）、小按钮 `rounded-lg`、发送按钮圆形。边框一律 `border-border/70` 起步，选中/焦点才加深。
- 间距：4 / 8 / 12 / 16 / 24 五档，卡内 padding 12，卡间距 8，流内消息间距 20。
- 间距：4 / 8 / 12 / 16 / 24 五档，卡内 padding 12，卡间距 8，流内消息间距 16。
- z-index：`10` 下拉菜单，`20` 审批卡吸顶提示，`30` 对话框，`50` toast。
- 响应：窄窗（375px）左栏收成抽屉，中央列占满；禁止横向滚动（代码块内部滚除外）。

## 5. 交互

- 触控目标 ≥ 44px（小图标按钮用 28px 可视 + 44px 热区 padding）。
- 过渡 150–300ms，只做 `color / opacity / transform`，禁止布局抖动（hover 不许 scale 位移）。
- 按钮：async 操作期间禁用 + spinner；审批按钮键盘可达（Tab 顺序 = 视觉顺序，Enter 触发）。
- 流式：文本打字机追加 + 代码块 skeleton 占位；thinking 默认折叠，流式时显示「思考中…」。- 焦点：所有可交互元素可见 focus ring（`accent` 2px outline）。
- 动效：`prefers-reduced-motion` 时关闭打字机/旋转指示，改为静态文案。

## 6. 文案语气

- 中文、主动语态、句式收敛：按钮即动作（「新建会话」「允许一次」「取消归档」），toast 即结果（「已归档」「已删除，不可恢复」）。
- 空态是邀请不是叹息：给下一步动作（「选择一个本地目录作为项目」+ 按钮）。
- 错误说清原因和修复：「目录不存在，只能移除或重定位」「模型目录加载失败，重试或检查网络」。

## 7. 可访问性与性能

- icon-only 按钮必须 `aria-label`；图片/fileMention 芯片有文字替代；表单/select 有 label。
- 颜色不作唯一信号：状态同时有文字（运行中/成功/失败/等待审批）。
- 会话流虚拟化，toolResult 默认截断（前 2000 字符 + 「展开全文」），首屏增量渲染前 200 条。
- 异步内容预留占位，禁止内容跳动（content-jumping）。

## 8. 组件速查（V1 + 二期 M5）

- `ProjectRow` / `SessionRow` / `EmptyState` / `UserBubble` / `AssistantText` / `ThinkingFold` / `ToolCard` / `ApprovalCard` / `UiRequestCard` / `MentionChips` / `SystemDivider` / `Composer`（会话输入框：工具行含 `ModelPicker` / `ThinkingPicker` / `PermissionBadge`，三者只在此出现） / `ModelPicker` / `ThinkingPicker` / `PermissionBadge` / `ContextBar` / `ProjectPicker` / `BranchPicker` / `StatusBar` / `ConfirmDialog`。
- `ApprovalCard` 与 `UiRequestCard` 分工固定，不许互相替代：`ApprovalCard` 只管审批（`extension_ui_request{method:"select", options 含 "Approve"}`，三按钮 = 允许一次 / 总是允许（本会话）/ 拒绝，warn 色边 + 盾牌）；`UiRequestCard` 管其余交互请求（`confirm` 双按钮、`input` 单行、`editor` 多行、非审批 `select` 选项按钮，accent 色边 + 引号图标），两者出现都滚入视野、等待期间 composer 锁定、取消都回 `{cancelled:true}`。
- `ContextBar` = 输入框上方一行，由 `ProjectPicker`（项目下拉：切上下文 + 打开该项目最近会话）与 `BranchPicker`（git 分支只读指示器）组成；下拉展开列表里分支项是**静态文本不是按钮**（没有切换动作，只给「刷新」），项目项才是可点按钮。三者只在此出现，左栏分组头不再重复一套。
- `ModelPicker` 行角标只留 context（`1M`/`200K`）与图片（`图`），不显示 thinking 档数；`ThinkingPicker` 只列当前模型支持的档位（`off` 恒在首位），无思考模型在下拉内提示「当前模型不支持思考」。两者触发按钮**按内容自适应宽度、不截断**（`whitespace-nowrap` + `shrink-0`，不设 `max-w-*`），空间不足时由工具行 `flex-wrap` 换行兜底；`ProjectPicker` / `BranchPicker` 触发按钮同规矩。
- 新增组件先查此表，禁止同义重复（如第二种 confirm 框、第二种 tool 卡）。
- `AssistantText` = 助手正文（Markdown 渲染 + 代码高亮 + 代码块复制 + 流式未闭合围栏 skeleton），实现见 `src/components/thread/AssistantText.tsx`；用户气泡、工具输出不走 Markdown（前者是用户原话，后者是日志）。`RuntimeStats`（用量透传）与 `OmpStatusPill` 同属 `StatusBar.tsx`，只挂输入框工具行。
- `MentionChips`（`src/components/thread/MentionChips.tsx`）= `@文件` 提及被 omp 读进上下文后的芯片排：11px mono、`rounded-lg` 细边、`FileText` 图标 + 路径 + 「N 行 / NKB」；被跳过的文件（`skippedReason`）换 `FileWarning` + warn 色，tooltip 写「已跳过自动读取（原因）」。输入框里的**草稿芯片**复用同一视觉（在 `Composer` 内联，不另起组件），路径不存在时同样走 warn 色。
- `ConfirmDialog`（`src/components/ConfirmDialog.tsx`）已落地：受控浮层、Esc/遮罩取消、焦点默认在「取消」、危险操作走 danger 色；批量删除等**跨分组**的危险操作走它，项目分组内的轻量确认仍是分组内联浮层（不撑布局）。`Toast` 仍未落地——新增提示优先用内联错误条，不要临时造第三种提示样式。

## 9. 应用图标

- 唯一矢量源 `design-system/icon/omp-mini-icon.svg`。改图标只改这个文件，再跑 `pnpm icon` 重新生成 `src-tauri/icons/`（icns / ico / 各尺寸 png）。
- 造型：oh-my-pi 的血脉是 Pi，故图标取 **π 作字标**——不加文字、不加第二个符号。
- 几何：1024 画布，内容圆角方 824×824 居中（圆角 186，macOS Big Sur 图标网格）；π 视觉盒 600×464 居中，笔画 96 全圆头，两腿相对横杠两端内缩 26%。T 型交汇处填 4 个 R46 内圆角（曲边三角，**不是整圆**——填整圆会在笔画外冒出珠子），横杠两端与腿底全圆头。
- 配色：**图标是品牌物，允许走出 §2 的单强调色约束**。π 走极光渐变 `#5EEAD4 → #38BDF8 → #A78BFA → #F472B6`（沿横杠左上 → 右腿右下流动），石墨底 `#232329 → #07070A` 上叠三处同色辉光（左下取极光首色、右上取末色、中央取过渡色）。
- 底线：16px 下仍要读出「一条横杠 + 两条腿」；辉光只柔化边缘，不许糊掉字形。
- 验证方式：**`pnpm tauri:dev` 里看不到自定义图标，这不是 bug**——macOS 下 dev 跑的是裸二进制（`target/debug/omp-mini-desktop`，无 .app bundle、无 `CFBundleIdentifier`），系统只给它通用可执行文件图标，根本不会去读 `src-tauri/icons/`。要验图标必须出应用包：`pnpm tauri:build` → `src-tauri/target/release/bundle/macos/ompMiniDesktop.app`。
- `src-tauri/build.rs` 里的 `println!("cargo:rerun-if-changed=icons")` 不许删：`tauri-build` 的 rerun-if-changed 只覆盖 `tauri.conf.json` / dist / Info.plist / capabilities，不覆盖 `icons/`，删掉后换了图标 cargo 不重建，产物里还是旧图标。
