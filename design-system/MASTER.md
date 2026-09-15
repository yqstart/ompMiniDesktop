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
- 字阶：会话标题 15px/600，消息正文 14px/1.7，时间/角标 12px，顶栏选择器 13px。
- 行长：中央消息列 `max-w-3xl`（约 65–75 字符），超长代码块横向滚动不撑破布局。

## 4. 布局

- V1 两栏：左栏可拖拽（220–480px，默认 264，`sidebarWidth` 存 Zustand + localStorage 持久化；窄窗 <768px 收抽屉）→ 中央流式列居中 `max-w-3xl`。右侧栏 V1 不做。
- 左栏：顶部主入口「新建会话」（accent 实心）→ 会话搜索框 → 项目卡片 → 按项目分组的手风琴会话组（旋转 chevron + 左侧 hairline 引导线）+ 未归属组 → 底固定「添加项目 / 设置」。
- 会话行：单行 `● 标题 … 时间 操作`（标题省略 + 右侧 mono 时间 + hover 浮现归档/删除icon，选中行描边高亮）；归档、删除都在行内展示，不另起第二行。
- 状态收敛：标题框外的独立状态条已下线（`StatusBar` 仅保留读屏播报位）；状态统一进输入框工具行的 `OmpStatusPill`，且仅非就绪（运行中/等待审批/出错/已退出/omp 不可用）才出现，就绪态不占位。
- 输入框工具行下拉互斥：`composerMenu: model | thinking | permission | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）。
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
- 流式：文本打字机追加 + 代码块 skeleton 占位；thinking 默认折叠，流式时显示「思考中…」。
- 焦点：所有可交互元素可见 focus ring（`accent` 2px outline）。
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

## 8. 组件速查（V1）

- `ProjectRow` / `SessionRow` / `EmptyState` / `UserBubble` / `AssistantText` / `ThinkingFold` / `ToolCard` / `ApprovalCard` / `SystemDivider` / `Composer`（会话输入框：工具行含 `ModelPicker` / `ThinkingPicker` / `PermissionBadge`，三者只在此出现） / `ModelPicker` / `ThinkingPicker` / `PermissionBadge` / `StatusBar` / `ConfirmDialog`。
- 新增组件先查此表，禁止同义重复（如第二种 confirm 框、第二种 tool 卡）。
