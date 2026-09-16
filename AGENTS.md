# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的极简桌面端：把终端里的 agent 会话装进安静的两栏界面。
Tauri v2 + React + TS + Tailwind v4 + Zustand，包管理 pnpm。

## 文档索引

| 文档 | 路径 | 说明 |
|---|---|---|
| 产品冻结稿 | `docs/v1-design.md` | 范围、布局、事件→组件映射、权限、数据接口 |
| RPC 实测备忘 | `docs/rpc-memo.md` | `omp --mode rpc` 握手/流式/审批/切换的实测结论 |
| 功能排期 | `docs/v1-schedule.md` | M0–M4 里程碑与任务明细 |
| 二期排期 | `docs/v2-schedule.md` | M5–M8 里程碑、上游协议事实、完成口径 |
| 三期排期 | `docs/v3-schedule.md` | 供应商页（login / logout / model roles 映射）的实测口径与完成口径 |
| 四期排期 | `docs/v4-schedule.md` | 记忆页（omp 项目记忆的查看 / 删除）的实测口径与完成口径 |
| 五期排期 | `docs/v5-schedule.md` | 使用统计页（会话 jsonl 的用量聚合）的实测口径与完成口径 |
| 六期排期 | `docs/v6-schedule.md` | 用量限额入口（供应商配额：5 小时 / 每周 / 每月）的实测口径与完成口径 |
| 七期排期 | `docs/v7-schedule.md` | 输入框上下文容量（容量环 + 分项面板）的实测口径与完成口径 |
| 八期排期 | `docs/v8-schedule.md` | 通用设置（omp 常用配置项：40 项白名单 + 读写口径）的实测口径与完成口径 |
| 九期排期 | `docs/v9-schedule.md` | 模型页的失败转移链（`retry.fallbackChains`）与角色思考档的实测口径与完成口径 |
| 十期排期 | `docs/v10-schedule.md` | 输入框 `/` 命令补全（omp 命令面 + 技能分组）的实测口径与完成口径 |
| 设计真相 | `design-system/MASTER.md` | token、布局、交互、组件命名（改 UI 先读） |
| 应用图标 | `design-system/icon/omp-mini-icon.svg` | π 字标矢量唯一源，`pnpm icon` 重新生成 `src-tauri/icons/` |
| 更新日志 | `CHANGELOG.md` | Keep a Changelog 风格，发版时归入新版本节 |
| 第三方声明 | `THIRD-PARTY-NOTICES.md` | 直接依赖清单，增删依赖时同步 |

## 技术基线

- 桌面壳：Tauri v2（`src-tauri/`，identifier `com.omnidesktop.mini`；窗口 `titleBarStyle: Overlay` + `hiddenTitle`，标题栏是自绘的——顶栏 `TopBar` 与左栏红绿灯占位都挂 `data-tauri-drag-region`，拖动走 `core:window` 的 `start_dragging`。**该权限不在 `core:default` 里**：v2 的 window 默认集只含 `allow-internal-toggle-maximize` 这类只读项，所以必须在 `src-tauri/capabilities/default.json` 显式加 `core:window:allow-start-dragging`——否则标题栏点着不动、双击最大化却正常）
- 前端：React 19 + TS + Vite + Tailwind v4 + Zustand（`src/`）
- 后端：Rust + tokio（子进程管理）+ serde/serde_json + tauri-plugin（dialog/opener/store/updater/process，`main.rs` 实注册；`tauri-plugin-shell` 仅在 Cargo 依赖残留，代码未引用）
- 工具链：Node 22 + pnpm 11；Rust stable（已验证 1.97）+ 本地 `@tauri-apps/cli`（`pnpm tauri:*` 走项目本地 CLI，不依赖全局 `cargo-tauri`）
- 上游运行时：`omp` 18.x（已验证 18.1.22），不随仓库分发，用户另行安装

## 源码结构（当前）

```
src/
  app/App.tsx              # 顶层装配 + SidebarShell（拖拽调宽）+ 皮肤落 class（useTheme）+ 系统语言跟随（useLocale）/自检/updater 启动
  components/HealthBanner.tsx  # omp 不可用横幅（与 OmpStatusPill 的常驻位区分）
  components/SettingsPage.tsx  # 设置页外壳（分页签：通用 / 供应商 / 模型 / 记忆 / 使用统计 / 已归档对话；通用 = omp 诊断区路径/版本/agentDir + 重新检测 + 指定路径 + 复制 + omp 常用设置 + 应用更新——界面语言不在设置页，入口是左栏底部的 LanguageToggle）
  components/ArchivedSessions.tsx # 设置 ›「已归档对话」tab：按项目分组列全部归档会话（数据来自 list_archived_sessions，不受左栏扫描窗口限制），分组级/行级「恢复 / 删除」，删除走 ConfirmDialog
  components/ConfirmDialog.tsx # 通用二次确认浮层（受控；跨分组危险操作用它，分组内仍是轻量内联浮层）
  components/LanguageToggle.tsx # 界面语言三档分段控件（跟随系统 / 中 / EN），只挂左栏底部「设置」行（皮肤切换左侧）
  components/ThemeToggle.tsx   # 皮肤三档分段控件（跟随系统 / 深色 / 浅色），只挂左栏底部「设置」行右侧
  components/sidebar/      # Sidebar（分组会话列表，**只列进行中的会话** + 缺失态重定位；**新建会话与归档全部分别是项目分组头悬浮槽位里的两个图标**，分组为空时 `＋` 常驻）、EmptyState（无会话态用应用图标 `design-system/icon/omp-mini-icon.svg` 直接引入，只做说明、不放新建按钮）
  components/thread/       # TopBar（标题备注 + 窄窗抽屉入口 + 复制会话为 Markdown + UpdateBell）、Thread（首屏 200 条 + 增量加载 + 行级 memo + PlanCard 计划卡 + command 本地输出）、AssistantText（Markdown + 代码高亮 + 复制 + 流式骨架 + 外链二次确认）、ToolRow（工具调用**一行**：图标 + 动词 + 文件基名 + 目录 + `+N −M`，点击展开意图/参数/输出）、ApprovalCard（审批 select，终态展示结论）、UiRequestCard（confirm/input/editor/非审批 select，选项描述）、MentionChips（@文件 芯片排，可点打开）、StatusBar（OmpStatusPill + QueueBadge 排队数 + CompactButton 压缩入口 + RuntimeStats 用量透传）
  components/composer/     # Composer（一体式输入框 + 工具行 + 图片附件：粘贴/拖拽/选文件，发送随 prompt.images；流式中 Enter 排队 + ⌘/Ctrl+Enter 转向 + `@` 路径补全 + 图文混贴保留文字 + 乐观回显 + 草稿持久化；`/` 开头作为本地命令直发）、SlashMenu（`/` 命令补全浮层：数据是 omp 自己的命令面 `available_commands_update`——**技能就是命令面里 `skill:<名>` 的那批**，不另扫技能目录；子智能体 RPC 无触发路径，不做。分组固定「命令 → 技能」，组内按名字前缀 > 名字子串 > 别名 > 描述子串打分、同分保持 omp 原序；技能行显示去掉 `skill:` 的名字但**插入完整 `/skill:<名>`**；行尾挂 `input.hint`；限高滚动、不挤压输入框；**打全即发**，**流式中不弹**）、MentionList（`@` 路径补全浮层：分组标题 + 文件类别图标 + 「基名亮 / 目录暗」两段行 + 操作提示行；行高 32px、高亮 `bg-hover`、键盘滚动跟随；类别判定在 `lib/fileKind.ts`）、ContextBar（输入框上方一行：项目 + git 分支 + 用量限额）、ContextMeter（上下文容量：模型选择器左侧的容量环 + 点开的分项面板，数据来自 `get_context_breakdown`）、UsageLimits（用量限额入口：当前会话供应商的配额进度条 + 展开的窗口明细，数据来自 `omp usage --json`；一份配额都拿不到时自身不渲染）
  components/pickers/      # ModelPicker、ThinkingPicker、PermissionBadge（挂输入框工具行）；ProjectPicker、BranchPicker（挂 ContextBar）
  components/settings/     # GeneralSettingsPanel（设置 ›「通用」：omp 常用设置 40 项——6 组可折叠 + 开关 / 行内展开的枚举下拉 / 数字框 + 行尾「恢复 omp 默认值」，写入乐观更新、失败回滚）、ProvidersPanel（设置 ›「供应商」：omp 登录 / 登出）、ModelsPanel（设置 ›「模型」：模型角色（角色行 = 名称 + 模型 + **`:思考档` 后缀的行内档位按钮**）→ 失败转移 → 常用模型 → 可用模型四段；同目录下 `FallbackChains.tsx` 是失败转移区块、`ModelPickList.tsx` 是角色与转移目标共用的模型选择列表）、MemoryPanel（设置 ›「记忆」：omp 项目记忆清单 + 行内 Markdown 预览 + 单文件删除 / 整目录清空）、UsagePanel（设置 ›「使用统计」：范围切换 + 总览卡 + 每日 Token 趋势 / 按模型 / 工具分布 / 时段分布 / 按项目，纯 CSS 图表不引库）
  components/update/       # UpdateBell、UpdateDialog（应用内更新）
  lib/                     # viewmsg（ViewMsg 归一 + diffStat 行数增量 + 单测）、toolLine（工具行取词与切分：动词/基名/目录/未知工具退回意图 + 单测）、attachments（图片附件校验/base64/内容块提取 + 单测）、mentions（@文件 解析，与 omp 同规则 + 单测）、fileKind（`@` 补全列表的图标类别：扩展名 + 惯用名 → dir/code/doc/image/archive/file 六档，认不出退回 file + 单测）、slashCommands（`/` 补全的数据层：命令面归一（`input.hint` 折平、丢缺 name 的坏项）+ 过滤打分 + 分组 + `isCompleteCommand` 的「打全即发」判定 + 插入文本 + 单测）、search（搜索片段高亮 + 单测）、exportMd（会话 → Markdown 只读导出 + 单测）、mergeEvents（实时流按 id 合并 + 单测）、thinking（思考档推导 + 单测）、sessions（分组 + 单测）、sessionList（会话列表刷新 + 扫描窗口的唯一入口）、sessionBatch（批量归档/恢复/删除的唯一实现：BATCH_LIMIT 分批 + 失败聚合 + 删除后清前端痕迹）、context（上下文条取值 + 单测）、ctxUsage（**上下文用量的唯一格式化口径**：percent 是 0–100、百分比/token/窗口三档写法 + 单测）、favoriteModels（常用模型偏好：localStorage 归一/读写/星标开关 + 单测）、ompSettings（设置 › 通用的 omp 常用设置白名单：40 键 / 6 组 / 枚举取值表 + `optionsFor` 兜底当前值 + `settingLabelKey` 字典键规则 + `tuiOnly` 标注（`plan.enabled` / `goal.enabled` 只影响 omp 自己的终端 TUI，行上标「仅 TUI 生效」）+ 单测）、modelSelector（**模型 selector 的 `:思考档` 后缀拆合**：只在 `:` 后那段是已知档时才拆，模型 id 里的其它冒号不误伤 + 单测）、roleNames（角色 id → 本应用文案，角色列表与失败转移的角色候选共用同一份）、modelNames（模型短名 / 上下文窗口紧凑写法）、sessionOpen（打开/新建会话的唯一实现，含乐观消息合并）、projects（添加项目 / 切换项目）、ompDiag（omp 自检与手动指定路径）、locale（**全界面**中英字典 + fmt 占位 + 语言偏好三档 `LOCALE_MODES` / `resolveLocale`（`zh*`→中文）/ `systemLang` + 语言名 / 简称常量 `LOCALE_NAMES`·`LOCALE_SHORT`（自称，不随界面语言翻译，所以不进字典）+ localStorage 持久化 + 单测）、theme（皮肤三档：system/dark/light 归一 + localStorage 持久化 + `resolveTheme` 纯函数 + `applyTheme` 落 `<html class="dark">` + 单测）、useText（组件取文案的唯一入口）、useSessionEvents（事件归一 + 真值回填，含本地命令/计划/压缩重试/子代理/命令面分支）、openPath（路径打开 + 草稿持久化）、useTaskNotifications（后台完成系统通知）、useDropdown、appUpdate、rpc-types
  shared/                  # api（invoke 唯一入口）、ipc（通道常量）、types
  stores/app.ts            # Zustand 全局状态（含 currentModel/currentThinking/currentEfforts/currentRuntime、favoriteModels/setFavoriteModels、composerMenu、sidebarWidth、threadLimit、update、localeMode/locale/setLocaleMode、theme/setTheme）
eslint.config.js           # ESLint flat config（typescript-eslint + react-hooks + react-refresh）
src-tauri/src/
  main.rs / lib.rs         # 插件注册（dialog/opener/process/updater/store）+ 命令注册
  commands/mod.rs          # 会话与设置类 Tauri commands（与 src/shared/ipc.ts 一一对应，见 e2e:ipc；含 steer/follow_up/compact/branch/run_slash/complete_path/list_archived_sessions/unarchive_sessions）
  providers.rs             # 供应商页后端（11 个命令）：OAuth 供应商清单 / login·logout（走 `omp auth-broker` CLI，不走 RPC）/ modelRoles 读写 / 失败转移链（`retry.fallbackChains` + `retry.modelFallback` / `retry.fallbackRevertPolicy`）。配置类写入都是「读 → 改一键 → 整表写回 → 回读」，`roles_edit` / `retry_edit` 两把锁分别串行化（record 只能整表写，点路径报 `Unknown setting`）；本页的 `retry.*` 读取走 `config_get_global`（钉 agentDir，见核心数据流）
  memories.rs              # 记忆页后端（4 个命令）：项目记忆清单 / 读取 / 删除（`<agentDir>/memories/` 按 cwd 编码的目录；目录名解码拿真实文件系统逐级匹配，路径入参一律 safe_path 校验不越界，含单测）
  usage.rs                 # 使用统计后端（1 个命令）：扫 `sessions/` 全部 jsonl 聚合用量（总量 / 按日 / 按模型 / 按项目 / 按工具 / 按小时 + 命中率、连续天数、峰值时段、最常用模型等派生指标；文件数 / 字节 / 墙钟三道预算 + truncated；含 10 项单测与 `#[ignore]` 真机基准）
  quota.rs                 # 用量限额后端（1 个命令）：跑 `omp usage --json` 解析各供应商的配额窗口（5 小时 / 每周 / 每月），从**模型目录缓存**里读「已配置供应商」（`configuredProviders`，用来把「配了但上游没有探针」的供应商如实列出来；不自己跑 `omp models --json`——实测冷启动 ~10s，会拖住配额刷新）；进程调用复用 providers.rs 的 run_omp，含 6 项解析单测。**只读**：不调 invalidate（清缓存是写操作）、不碰凭证库
  context.rs               # 上下文容量后端（1 个命令 `get_context_breakdown`）：读一次会话 jsonl 拿 `contextSnapshot.nonMessageTokens` 锚点与逐轮 usage 累计，配合运行时的 `get_state` 真值算出分项（总量 / 非消息 / 消息是 omp 真值，非消息各档按字符量估算后缩放到真值；含 10 项单测）。**只读**：不启动进程、不下发命令、不写任何东西
  settings.rs              # 通用设置后端（3 个命令）：`get_omp_settings`（一次 `omp config list --json` 501 项里挑白名单）/ `set_omp_setting`（`omp config set <key> -- <value>`，`--` 不可省——负数会被 yargs 当 flag）/ `reset_omp_setting`（`omp config reset`）；三个都**写完回读**。工作目录钉在 agentDir（`config list|get` 返回的是合并项目层后的有效值，agentDir 不存在才退回不指定目录），含 9 项单测（key 形状含 `_`/`-`、值序列化含 -1、挑键与缺失键、redacted 不当真值、批量上限）
  runtime.rs               # per-会话长驻 omp 子进程 + rpc_chunk 重组 + 事件分发 + 真值回读（omp-state）+ 切模型自动最高档
  overlay.rs               # overlay.json 读写与版本归一（含单测）
  session_scan.rs          # agentDir 解析 + jsonl 头解析 + cwd 归组（含单测）
  git_info.rs              # git 只读查询（当前分支 / 本地分支 / 脏工作区）+ git 路径探测缓存（含单测与真实仓库端到端测试）
scripts/                   # fake-omp.mjs（canned RPC 联调：history|approve|deny|multi|abort|ui 全为分支实现）、e2e-ipc-selfcheck.mjs（IPC 静态契约自检）、e2e-rpc.mjs（fake-omp 驱动的行为级端到端）、generate-icons.mjs（从矢量源重生成桌面图标）
```

## 核心数据流（不许违背）

- 会话真相永远是 `~/.omp/agent/sessions/<slug>/*.jsonl`（`PI_CODING_AGENT_DIR` 可覆盖）；app 只存轻量覆盖层 `$APPDATA/omp-mini/overlay.json`（项目列表/归档/备注/会话级权限）。app 可删可重装，不丢会话。
- 实时输出只走 RPC 事件流，不轮询文件。文件只用于列表与历史回放。
- 后端 per-会话 spawn `omp --mode rpc`，stdout 行解析 → `rpc_chunk` 重组 → `omp-event://<sessionId>`，状态机推 `omp-status://<sessionId>`；运行时真值（模型 / 可用思考档 / 当前档 / 上下文占用 / 本轮用量与耗时）推 `omp-state://<sessionId>`，`get_session_runtime` 补拉**两次**以消除两个方向的竞态：订阅建立时（推送可能早于订阅）+ `open_session` 返回后（resume 的长驻进程是在 open 里 spawn 的，订阅那次补拉必然早于它完成而拉空——不补第二次，打开旧会话后工具行上的模型与思考档就一直空着）；`spawn_long_lived` 握手完成后另主动推一发开场快照（握手回包只在本地消化、不进事件流，否则真值只能等下一次回读）。用量真值来自 `message_end.message.usage`（`duration` / `ttft` 实测就是毫秒，原样透传不换算）；`get_state` 回读时保留用量字段，不许被抹掉。
- `prompt` 的即时 ack 只代表接受，完成信号以 `agent_end(isTerminal !== false)` 为准；流式中 composer 只允许停止（`abort`），不排队。
- 图片附件（V2 M6）：三条入口（粘贴 / 拖拽 / 点回形针选文件）都读成 base64 存内存（`attachmentsBySession`），发送时随 `prompt{message, images:[{type:"image",data,mimeType}]}` 一次性交给 omp——**不落盘、不写覆盖层、不塞草稿**；选文件走后端 `read_image_file`（WebView 拿不到任意本地路径内容）。渲染只认消息内容块里的 `type:"image"`（实时与 jsonl 同构）；单张上限 10MB，历史回放里超过 512KB base64 的块按 `imagesOmitted` 计数省略，不许无上限常驻内存。
- `@文件` 提及（V2 M6b）：**展开动作是 omp 做的**（prompt 时把命中的文件读成 `role:"fileMention"` 消息），壳侧只做两件事——输入框把草稿里的提及显示成芯片并用后端 `check_paths`（只 stat）标出「路径不存在」，转录区把 `fileMention` 渲染成一排文件芯片（跳过项 `skippedReason` 用 warn 色）。解析规则与 omp 的 `extractFileMentions` 逐条对齐（`src/lib/mentions.ts`：引号形式、行首/空白边界、ASCII 首尾修剪）——**规则漂移会让芯片与真正读进上下文的文件对不上**。
- 会话列表扫描是**有窗口的**（V2 M7a）：`list_sessions` 返回 `{sessions, totalFiles, scannedFiles}`，默认只解析最近 500 个 jsonl（后端夹在 1..=5000），前端一律经 `src/lib/sessionList.ts` 的 `loadSessions()` 落库（会话数组 + 扫描统计一起更新，别再各处裸调 `api.listSessions`）；`totalFiles > scannedFiles` 时左栏底部给「继续扫描更早的 500 个」入口。窗口外不是"不存在"，是不解析。
- **归档会话不在左栏**（V2 M11）：左栏项目分组只列进行中的会话，归档的唯一管理面是「设置 › 已归档对话」（`src/components/ArchivedSessions.tsx`）——数据走 `list_archived_sessions`，它**不看扫描窗口**（只按覆盖层 `archived` 标记逐个定位文件，老到 500 个之外的归档也找得到），按项目分组（未归属单独一组）给分组级/行级的「恢复 / 删除」。恢复 = `unarchive_sessions` 摘掉覆盖层标记，会话立刻回到左栏对应项目分组；删除 = `delete_sessions` 真删 jsonl（ConfirmDialog 二次确认）。批量分档与失败聚合的唯一实现在 `src/lib/sessionBatch.ts`（`BATCH_LIMIT` 200），左栏分组头的批量也走它。
- **用量统计是全量现扫，不是窗口扫描**（V5）：`get_usage_stats(days)` 读 `sessions/*/*.jsonl` **整文件**逐行取 assistant 消息的 `usage`（`totalTokens = input + output + cacheRead + cacheWrite`，`input` 是未缓存输入；`reasoningTokens` 是 `output` 子集不重复计；`cost.total` 是 omp 定价估的美元值，本地 / 无定价为 0），工具调用取 `message.content` 的 `toolCall` 块，**时间取 `message.timestamp`（毫秒数字，不是 ISO 串）**。范围 `days` = 1 / 7 / 30 / null（全部），按**本地自然日**过滤并补零天（趋势图最多 120 天）；命中率 / 活跃天数 / 连续天数 / 峰值时段 / 日均 / 最常用模型占比等派生指标**一律后端算**，前端只格式化与按比例画柱。三道预算（文件数 3000 / 字节 256MB / 墙钟 5s）到点即停并置 `truncated`。会话 cwd 只在**文件头 32KB** 里找 `session` 行（实测不在首行），归属复用 `owner_project`——与左栏分组、归档面同一条规则；读不到 cwd 的归「未归属」。
- **用量限额是供应商侧的配额，不是本地统计**（V6）：输入框上方上下文条的 `UsageLimits` 显示的是 opencode 网站那种 **5 小时 / 每周 / 每月限额**，数据只来自 **omp 自带命令 `omp usage --json`**（`src-tauri/src/quota.rs` 跑子进程 + 解析，进程调用复用 `providers.rs` 的 `run_omp`，omp 路径走 `discover_omp_path`；22 个供应商的用量探针都在 omp 里，壳侧**不直连任何配额 API、不读凭证库**）。口径：时间戳（`generatedAt` / `fetchedAt` / `window.resetsAt`）全是 **epoch 毫秒**；`amount.used` 是 0–100、`usedFraction` 是 0–1；`window.durationMs` 对 monthly **缺失**（月窗锚定订阅周年日）；**无数据 = `reports: []` + 退出码 0**（provider 写错 / 未认证 / 上游失败同形，不能靠退出码判错，空报告是正常结果）。刷新：挂载一次 + 页面可见时每 5 分钟（omp 自身报告缓存 ~74s+，冷启动 ~1s / 缓存命中 ~0.2s）+ 打开浮层强制一次；**只读**——不调 `omp usage invalidate`（清缓存是写操作）。没有窗口可显示时入口整块不渲染；**「配了供应商、上游却拿不到用量」必须显式列出来**（如 `commandcode`：omp 有它的 api-key 登录但没有它的用量探针，`omp usage` 里连账号都不出现——后端从模型目录缓存里读 `configuredProviders`（不自己跑 `omp models --json`——冷启动 ~10s；目录由 `App.tsx` 启动时静默加载），前端做差集，浮层里给一块「无用量数据 + 原因」，**收起态把「能不能查」直接编码进可用性**——当前模型的供应商没有查询路径、或从未查到且失败就**置灰不可点**（`disabled` + `opacity-40`，悬浮说明写清原因），没有「在用的模型」时仍可点（看全部），有旧数据但刷新失败继续显示旧值；判定收在 `usageEntryDisabled()`；**不摆假数字、不拿别家额度顶上**；壳侧不自己去调它的 alpha 接口——那要从 omp 取 API key 且是逆向契约，等上游实现后这一块会自动变成真实窗口）；窗口标签（5 小时 / 每周 / 每月）走本应用字典，未知 `windowId` 回退上游 `label`。**和设置页「使用统计」是两套东西**（那边是本地 jsonl 的 token 聚合），也和工具行的 `ContextMeter`（上下文窗口占用）不同，三者不许互相替代。
- **上下文容量是真值 + 估算的混合体，界面必须标清哪一半是估算**（V7）：输入框工具行 `ModelPicker` 左侧的容量环与它点开的面板，走 `get_context_breakdown(id)`。**已用 / 窗口**来自 `get_state.contextUsage`（同一个 `tokens` 也是会话 jsonl 里 `message.contextSnapshot.promptTokens` 的落盘形态，运行时读不到时用它兜底——`percent` 实测就是 **0–100**，不是 0–1，见 `src/lib/ctxUsage.ts`）；**非消息总量**是 `contextSnapshot.nonMessageTokens`（omp 用自己的 tokenizer 算的**真值**，只在会话 jsonl 上，实时 `message_end` 的 `contextSnapshot` 实测为 null，所以按需读一次会话文件）；**「消息 = 已用 − 非消息」也是真值**。**非消息的五档**（系统提示词 / 技能 / 工具 / MCP 工具 / 系统上下文）omp 只在 TUI 侧算（`/context`），RPC 没有对应方法——壳侧按字符类估算（ASCII ÷4、CJK ×0.8、其余 ÷4）后**整体缩放到非消息真值**，所以「各档之和恒等于已用」这条不变量成立、只有档与档之间怎么切是估算；**读不到锚点就不出分项**（不硬凑）。平均缓存命中率是会话 jsonl 里逐轮 usage 的累计真值（口径与设置页「使用统计」一致：`cacheRead / (input + cacheRead)`）。整条链路**只读**：不启动进程、不下发命令、不写 omp 配置与覆盖层。它**不是**设置页的「使用统计」（历史 token 聚合），也**不是**上下文条上的「用量限额」（供应商配额）——三者数据源与语义各不相同，不许互相替代或合并。
- **`contextUsage` 靠回读刷新**：它只出现在 `get_state` 回包里，除了 `set_model` / `set_thinking_level` 之后，终态 `agent_end` 也要回读一次——否则工具行上的上下文占用会一直停在「打开会话那一刻」，压缩入口（≥80%）永远不触发。非终态 `agent_end`（还有排队 / 子代理在跑）不回读。
- **记忆不在项目仓库里**（V4）：omp 的项目记忆是 `<agentDir>/memories/` 下**按 cwd 一目录一份**（目录名 = `--` + 绝对路径去首斜杠、`/` `\` `:` 换成 `-` + `--`，如 `--Users-me-proj--`；**与 `sessions/` 的目录名不是一套编码**），目录内是 `MEMORY.md` / `memory_summary.md` / `raw_memories.md` / `rollout_summaries/*.md` / `skills/<name>/SKILL.md` / `learned.md`，全由 omp 启动时的后台整理流水线写出（`memory.backend: local` 时才有）。设置 ›「记忆」**只列 / 读 / 删**：`list_memories` 扫目录、`read_memory_file` 读正文（1MB 上限、按字符边界截断）、`delete_memory_file` / `delete_memory_project` 删文件 / 删目录——**没有任何写入路径**（上游没有 `omp memory` CLI，写记忆是 omp 的事）。目录名**不可逆**（路径里的 `-` 与分隔符同形，`a-b/c` 与 `a/b-c` 编码相同），解码只能拿真实文件系统逐级匹配（先少合并后多合并），解不出退回显示编码名；`dir`/`file` 入参一律按不可信输入处理，经 `safe_path` 校验（拒绝对路径 / `..`、canonicalize 后必须在记忆根内）。
- 会话内容搜索（V2 M7b）：后端 `search_sessions` 只搜 `message` 行里 **user / assistant 的 text 块**（工具输出、thinking、JSON 字段名都不进搜索面——否则搜 "user" 会命中每一行），逐行读取、有文件数/字节/墙钟时间/命中数四道预算，任何一道到点都把 `truncated` 置 true（**宁可说"可能不全"，不许假装搜完了**）；前端输入 ≥2 字才搜（单字命中面太大），300ms 防抖，结果行显示标题 + 命中片段（`highlightParts` 高亮全部命中）+ 命中次数 + 归档角标，点击即打开会话（命中的会话可能落在扫描窗口外，`openSessionWithHistory` 会把它补进列表，避免顶栏显示「未命名」）。
- V1 最小命令集：`negotiate_protocol、get_state、prompt、abort、set_model、set_thinking_level` 走 stdin 长驻通道（命令名以 `src/lib/rpc-types.ts` 为准）；`get_available_models、switch_session、get_messages_page、bash（诊断）` 仅在该类型声明中保留，Rust 后端当前未发送。历史回放走后端 `get_history`（直读 jsonl，前 5000 行、最多 2000 条 message/custom 系），不是 `get_messages_page`。
- 切模型发 `set_model{provider, modelId}`（两个字段，非 selector 字符串）；切思考档发 `set_thinking_level{level}`。**omp 切模型后不会修正思考档**（切到无思考模型直接丢档）：后端收到 `set_model` 成功回包即自动跟进 `set_thinking_level`（新模型 `efforts` 最高档，无思考则 `off`），再 `get_state` 回读真值推 `omp-state`；失败也回读以纠正前端乐观态。
- 思考档可用集 = omp 真值 `currentEfforts`（`omp-state` / `get_session_runtime`）∪ `{off}`（`off` 恒合法）；下拉**只列支持档**，禁止列全集再置灰或先发再报错（非法档 omp 静默忽略且回 success）。
- 审批线序：`toolcall_end` → `tool_execution_start` → `extension_ui_request{method:select, options:["Approve","Deny"]}`；通过回 `value:"Approve"`，拒绝回 `cancelled:true`（turn 正常结束，不是中断）。
- 其余 UI 请求（V2 M5）：`confirm` / `input` / `editor` / 非审批 `select` 走 `UiRequestCard`，回包统一经后端 `respond_ui`——`confirm` 回 `{confirmed:bool}`、`input`/`editor`/`select` 回 `{value}`、取消回 `{cancelled:true}`；`notify` 渲染为分隔线，`setStatus`/`setWidget`/`setTitle`/`set_editor_text` 是单向宿主指令（丢弃不告警），服务端 `cancel{targetId}` 撤回对应卡片。**只有这四类方法进 `awaiting-approval` 状态**（单向方法与服务端撤回不许锁 composer）。
- git 上下文**只读**：`get_git_info(path)` 走 git CLI 只读查询（`rev-parse --is-inside-work-tree` / `symbolic-ref --short HEAD` / `for-each-ref refs/heads` / `status --porcelain --untracked-files=no`），不写仓库、不切分支；结果只用于输入框上方上下文条展示。
- **设置 ›「供应商」「模型」「通用」三个页签是全 app 唯一改 omp 状态的地方**（其余页面一律只读 omp：不写配置、不写标题、不写凭证；设置 ›「记忆」只删 omp 的记忆文件，不写任何配置，见下条）：
  - **供应商页签 · login / logout 走 `omp auth-broker` CLI 子进程，不走 RPC `login`**：实测 `omp --mode rpc` 在「一个供应商都没登录」的 agentDir 下**直接退出**（启动时要先解析出可用模型，报 "No models available"）——而那是这个页面最主要的首次使用场景。`auth-broker login|logout` 是纯凭证库操作（`SqliteAuthCredentialStore`），不建会话、不需要模型，任何状态都能跑。解析钉在上游打印顺序（`Open this URL in your browser:` 之后第一行 = 完整授权 URL，其余行原样透传，退出码 0 = 成功）；上游提问行（选端点 / 粘贴 API key）显示给用户并回填 stdin 一行，**输入内容不回显**（可能是 API key）。进度经 `omp-provider://login` 推全量快照，`get_provider_login` 供切走再回来补齐。
  - 「已配置」= 该供应商出现在 omp **当前模型目录**里（有凭证或免钥），**不直读 omp 的凭证库**；这张表只列 OAuth 可登录的供应商，API key 型供应商只在「模型」页签的可用模型里体现。登出走 `ConfirmDialog` 二次确认（删凭证不可撤销）。
  - **模型页签 · modelRoles 写全局配置**：`omp config set modelRoles '<JSON>'` 只接受整表（点路径 `modelRoles.smol` 实测报 `Unknown setting`），所以后端是「读 → 改一个键 → 写回」+ 互斥锁串行化 + **写完回读**；`modelRoleStorage=project` 时界面给 warn 提示（本页读写的是全局角色）。「可用模型」只读，与输入框 `ModelPicker` 共用同一份 `models` store。**「常用模型」是本应用偏好、不写 omp**：localStorage `omp.favoriteModels.v1` 存 selector 数组（`src/lib/favoriteModels.ts`），挑选只决定输入框 `ModelPicker` 列什么，不碰 `modelRoles`、不碰 `create_session` 的模型来源。
  - **模型页签 · 失败转移链（V9）**：`retry.fallbackChains` 是 record——键三种形态（角色名 / 模型 selector / 供应商通配 `provider/*`，omp 也认 id 前缀通配但界面不做它的候选），值 = **有序**备用 selector 数组（顺序即 omp 的尝试顺序，排序会改变语义），匹配规则全在 omp 里、壳侧不复制。写入与 `modelRoles` 同款（整表 + `retry_edit` 锁 + 回读）。**触发时机 = 限流 / 过载 / 5xx / 网络类错误**，**上下文溢出不走这条**（走压缩）——界面说明行按此写死，不夸大覆盖范围；omp 侧 `retry_fallback_applied` / `retry_fallback_succeeded` 事件早已被渲染成会话分隔线，配置生效后用户立刻看得到。条目可带 `:档位` 后缀（不带则继承失败轮次的档位，`provider/*` 条目**总是**继承）。同区块映射两个配套开关：`retry.modelFallback`（**false 时链完全不生效**——所以开关与链同屏，关闭态给可见的 warn 提示）与 `retry.fallbackRevertPolicy`（上游只认 `cooldown-expiry` / `never`，壳侧先校验再发；bool 只发 `true`/`false` 字面量——实测传 `yes` 会被静默归一成 true）。**读这三个键必须钉 agentDir**（`config_get_global`）：实测 `omp config get` 返回的是**合并项目层之后**的有效值，而 `omp config set` 任何 cwd 下都只写全局层——读不钉层就会出现「界面显示项目覆盖值、改的其实是全局」的错位。编辑是**草稿 + 显式保存**（增量写会留下中间态，也会打出很多次 omp 子进程），删除走行内二次确认（设置页是可滚动容器，浮层会被裁掉）。**不做**：配额感知预切换（`usageAwareFallback` / `usageReserve*`）与重试预算的其余键（`retry.maxRetries` 在通用页签）。
- **会话归属只认 cwd，覆盖层不存归属**：`owner_project`（`commands/mod.rs`）是唯一判定入口——真实路径前缀匹配、最长优先、符号链接展开，与左栏 `project_of` 同一条规则；`create_session` / `open_session` / `list_sessions` / 归档清单四处共用。**omp 的 jsonl 是懒写盘的**（首个 turn 才落文件），新建 / 打开的会话读不到文件头 cwd 时，归属退回 spawn 时的 `--cwd`（`owner_cwd` + `RunningChild.cwd`），不许因为「文件还不存在」把刚建好的会话退回「未归属」；`list_sessions` 还要把「runtime 里、磁盘上还没有 jsonl」的活跃会话按 spawn 事实补进列表（`unlanded_views`，否则任何一次刷新都会让刚新建的会话行消失）。
- **通用页签 · omp 常用设置写全局配置**（V8）：设置 › 通用里「omp 常用设置」把 **40 个常用键**（6 组：会话与上下文 / 工具 / 终端与编辑 / 记忆与学习 / 任务与技能 / 交互与显示，白名单与分组见 `src/lib/ompSettings.ts`）映射成开关 / 下拉 / 数字框 + 行尾「恢复 omp 默认值」。读写全走 **`omp config` CLI 子进程**（`src-tauri/src/settings.rs`，3 个命令），壳侧不解析也不改写 `config.yml`：
  - **一次 `omp config list --json` 读全部**（501 项 / 90KB / 0.13s），不逐键 `config get`（40 项就是 40 个进程）；上游没有的键**整个缺席**，界面显示「当前 omp 版本没有这个设置」并禁用控件，**不补壳侧编的默认值**。
  - **写走 `omp config set <key> -- <value>`，`--` 不能省**：实测 `omp config set temperature -1` 会报 `error: Unknown option '-1'`（yargs 当 flag），而 `temperature` / `compaction.thresholdPercent` 的「默认」就是 `-1`。写完**回读**（返回真相，不停在乐观值上）；`omp config reset <key>` 写回 schema 默认值（不是删键），界面上的「恢复默认」用它。
  - **读数必须钉在 agentDir**：`config list|get` 返回的是**合并 `<cwd>/.omp/config.yml` 项目层之后的有效值**（实测同一 key 在有/无项目覆盖的目录下读到不同结果），所以 `run_omp_in(dir, …)` 把工作目录固定在 agentDir（那里不会有 `.omp/`）；否则从项目目录启动 app 时界面显示的是该项目的覆盖值，用户改全局会「看起来没生效」。agentDir 不存在时退回不指定目录（`settings_cwd`），不让整页报错。
  - **枚举取值表是壳侧自带的**：`config list --json` 只给 `"type":"enum"`，合法取值只出现在人读的文本输出里；上游加了新值时把当前值**原样补进下拉**（`optionsFor()`），不吞信息。label 进字典（键名 `s_` + key 变形，单测逐条守着），**说明文字用上游英文原样透传**（挂行 `title`）。
  - **改动何时生效未实测**（试过用 `extendedContext` + `get_state.contextWindow` 对拍，该键对当前模型无可观测差异；18.2.1 的 JS 已是字节码，`strings` 取不到加载逻辑）——界面只声明**必然为真**的那半句：「新建的会话一定读到新值」，不宣称已打开的会话会立刻应用。
  - 与「供应商」「模型」两个页签的分工：审批档 `tools.approvalMode` 在输入框的 `PermissionBadge`、`modelRoles` 与 `retry.fallbackChains` 在模型页签——**同义入口不许重复**，通用页签的白名单把这些键排除在外。

## 前端约定（血泪规则）

- RPC 帧与 jsonl 文件块统一归一为 `ViewMsg`（`src/lib/viewmsg.ts`），历史与实时同一入口合并；未知 `type` 只记日志不崩。
- 实时流的合并只走 `mergeViewMsgs`（`src/lib/mergeEvents.ts`）：`text` 流式按同 id 覆盖，工具卡统一用 `tool:<toolCallId>` 作 id **原位合并**（状态/输出取新值，名称/意图/参数摘要这类只在早期事件里出现的元数据从旧卡继承）。**一次工具调用只许出一张卡**——此前各阶段无脑追加会渲染 2–3 张卡、"输入中"那张永远转圈，并触发 React 重复 key。
- 消息流的形状：**助手正文是裸 Markdown、工具调用与思考是"一行式痕迹"**（`ToolRow` / `ThinkingFold`，对齐 ZCode 的对话流），只有用户气泡、审批卡、UI 请求卡、计划卡是带边带底的"块"。工具行 = 图标 + 本地化动词 + 文件基名 + 目录 + `+N −M`（`src/lib/toolLine.ts` 纯函数切分；未知工具退回 omp 的意图，不许把 `{"i":…}` 糊在行上），点开才给意图 / 参数摘要（可点打开）/ 输出。**禁止把工具行改回卡片**：一次会话几百次调用，盒子一多正文就被淹掉。状态只画需要说话的那几种（成功不画勾，失败 danger 色 X + 自动展开，运行中 accent 转圈）。`ViewMsg.diffStat` 由归一时从 `write.content` / `edit.new_string`·`old_string` 行数算好（只留计数不留原文），历史与实时两路都算、`mergeToolCard` 从旧卡继承。连续痕迹行之间间距 `mb-1`（`Thread.tsx` 的 `tight`），正文段落之间 `mb-4`。
- 组件命名以 `design-system/MASTER.md` §8 速查表为准，禁止同义重复组件；`ModelPicker/ThinkingPicker/PermissionBadge` 只挂输入框工具行，顶栏不再重复。
- 工具行 `ModelPicker`/`ThinkingPicker` 触发按钮按内容自适应宽度、**不截断**（`whitespace-nowrap` + `shrink-0`，不设 `max-w-*`）：模型名再长也完整显示，空间不足由工具行 `flex-wrap` 换行兜底。
- 输入框工具行与上方上下文条下拉互斥：`composerMenu: model | thinking | permission | project | branch | context | null` 存 Zustand，同时只开一个；点击外部 / Esc 关闭（`useDropdown`）；下拉统一向上弹。
- 输入框上方上下文条（`ContextBar` = `ProjectPicker` + `BranchPicker`，在输入框卡片**外**上方、与卡片内文字左对齐）：项目名认**会话归属**，`projectId` 为 null 就显示「未归属」，禁止回退 `activeProjectId`（否则会显示成消息在 A 项目里、实际发进未归属目录的会话）；切项目走 `switchProject(id, { newSession: true })`（**在该项目下新建一个对话**并切过去：切换是「换到那个项目干活」，不继承上一个对话的上下文；点当前项目只收下拉、不重复新建），保证「显示的项目 = 消息真正发去的项目」。分支是**只读**控件（只列本地分支 + 刷新，禁止 checkout 或任何 git 写操作），非 git 目录显示「非 Git 目录」而不是无声消失。git 查询走后端 `get_git_info`，找不到 git / 非仓库 / 超时一律降级为 `isRepo:false`——git 出任何问题都不许影响输入与发送。项目名 / 分支名不截断（与工具行选择器同规矩，窄窗口整行 `flex-wrap` 兜底）。
- 状态收敛：标题框外无独立状态条（`StatusBar` 仅保留读屏播报位）；状态统一进输入框工具行——`OmpStatusPill`（常驻，就绪也占位显示「就绪」）+ `RuntimeStats`（上下文占用 / 本轮 token / 耗时 / TTFT，全部来自 `omp-state` 真值，**无真值整块不渲染**，前端只做格式化不自算）。
- 上下文容量（V7）：输入框工具行、`ModelPicker` **左侧**的 `ContextMeter`——容量环（纯 CSS `conic-gradient` + 径向遮罩掏空中心）+ 11px mono 百分比，占用 ≥80% 转 `warn`（与压缩入口同阈值）。点开向上弹面板：标题行读数 → 分段总量条 → 分项行 → 平均缓存命中率 → 估算口径说明。**百分比口径唯一入口是 `src/lib/ctxUsage.ts` 的 `contextPercent()`**：omp 的 `percent` 实测就是 0–100，不许再写「≤1 就乘 100」那种区间猜测（会把 0.9% 显示成 90% 并误触发压缩入口）。拿不到 `contextUsage` 时整块不渲染；它**不是压缩入口**（压缩是 `CompactButton`），两者不许合并。
- 助手正文渲染走 `AssistantText`（`react-markdown` + `remark-gfm` + `rehype-highlight`）：**不许 `dangerouslySetInnerHTML`**（正文按不可信输入处理）；代码高亮配色只写在 `src/index.css`（项目 token 派生，深浅色自动跟随），不引第三方主题 CSS；代码块横滚不撑破布局，流式中未闭合围栏给 skeleton。
- 消息流首屏增量：默认只渲染最后 `THREAD_PAGE`（200）条（`stores/app.ts` 的 `threadLimit`，按会话重置），向上滚动或点按钮按页展开，加载后保持视口位置；不许一次性 map 全部消息（MASTER §7）。
- 消息行必须 `memo`（V2 M8 实测结论）：`Thread.tsx` 的 `ThreadRow` 是 `React.memo` 组件，前提是 `mergeViewMsgs` 对**未变化的消息保持同一对象引用**（有单测守着）。真实数据（8.1MB / 1411 块 → 698 条 ViewMsg，归一 2ms）证明瓶颈在渲染不在数据层，所以**不做虚拟列表**；复评阈值见 `docs/v2-schedule.md` M8（>5000 条 / >30MB / 明显掉帧）。测规模用 `OMP_BENCH=1 pnpm test src/lib/historyScale.test.ts`（默认跳过）。
- **omp 内建斜杠命令分两类，只有一类能在 RPC 里跑**：每个内建项都带 `handle`（ACP/RPC 用）与 `handleTui`（终端 TUI 用）两个实现，**只有 `handle` 的才能在 RPC 侧分发**。`computer` / `advisor` / `fast` / `skillful` / `extended-context` / `model` / `usage` / `stats` / `compact` / `todo` / `session` 这类两样都有，壳侧按普通 `prompt` 直发即可（本地命令，无 agent turn、不计 token）；**只有 `handleTui` 的**（`plan` / `plan-review` / `goal` / `guided-goal` / `vibe` / `loop` / `queue` / `setup` …）在 RPC 侧**没有分发入口**——实测把 `/plan` 当 prompt 发出去会真的开一个 agent turn 把这段文字喂给模型（比不做还糟），所以壳侧**不许**靠发 `/plan` 切模式，也不许为它们摆任何开关或入口（V10 之后这些命令连 omp 自己的 RPC 命令面 `available_commands_update` 都不出现，输入框 `/` 补全里自然也没有）。真要那几种模式，只有终端 TUI 一条路。
- `command_output` 帧的正文在 **`text`** 字段（实测 omp 18.2.1；`output` 是 canned 脚本的旧形状，两个都认）——壳侧曾按 `output` 读，真实 omp 的 `/` 命令输出整段被丢掉。
- 会话行单行 `● 标题 … 时间/归档`：右侧 68px 固定槽位，时间与归档按钮互斥（hover 时时间 `visibility` 藏、按钮绝对覆盖淡入），行高锁定，悬浮零跳动；**行内只有「归档」**。
- 左栏主入口是「添加项目」（`FolderPlus`，稀释强调色）；**新建会话挂在项目分组头的悬浮槽位里（`Plus` 图标）**，分组为空时这个 `＋` 常驻显示（数量位让给它——新建的入口不能只活在悬浮里，此时不显示归档图标）。中央空态仍是新项目的第一入口。（历史：左上角原「新建会话」accent 按钮 → 改为「添加项目」；分组内那行常驻的「新建会话」按钮 → 收进分组头悬浮槽位。）
- **左栏不做任何删除**（会话行与项目分组头都不做）：删除不可逆，而会话文件是唯一真相，密集列表里误点代价太大——要删就去「设置 › 已归档对话」（二次确认）。会话行不设复选框：不做多选、不做「已选 N」批量工具条；**批量只有归档**，挂在分组头——项目分组头 = 归档全部对话，「未归属会话」分组头 = 归档全部。**这些批量只覆盖进行中的会话**（左栏已不列归档），批量走 `src/lib/sessionBatch.ts`（`BATCH_LIMIT` 200 分批 + 失败聚合），归档会话的管理（恢复 / 删除）在设置页。项目条目的解绑（`remove_project`）目前也没有界面入口——后端命令保留，需要时再定入口。
- 左侧栏可拖拽调宽 **292–480px（默认 292，`sidebarWidth` 持久化 localStorage）**；窄窗 <768px 收抽屉。**下限不是审美数字，是底部那一行的内容宽度**：设置全称 + 语言切换 + 皮肤切换并排不挤压所需宽度（最宽文案按英文界面算，实测 288px 临界，留 4px 字体余量）——比这更窄，设置文案就会开始 `truncate`，所以不让用户拖到那里（改 `SIDEBAR_MIN` 前先量这一行）。
- **皮肤三档（跟随系统 / 深色 / 浅色）与界面语言三档（跟随系统 / 简体中文 / English）都是纯展示层偏好**，共用一个入口行：左栏底部「设置」行右侧，左 `LanguageToggle`、右 `ThemeToggle`（都是分段控件，「跟随系统」档都用 `Monitor` 图标）。两个控件都不在设置页重复放第二份（同义重复入口）。皮肤状态在 `stores/app.ts` 的 `theme`，数据层唯一实现在 `src/lib/theme.ts`（坏值回退 system），localStorage 键 `omp.theme.v1`。**语言的「偏好」与「实际语言」在 store 里分开**：`localeMode`（system / zh-CN / en）是偏好、`locale` 是解析结果（字典与 `<html lang>` 只认它）；解析规则是纯函数 `resolveLocale(mode, systemLang)`（`zh*` → 中文、其余 → 英文，见 `src/lib/locale.ts`），`system` 档下系统语言变了由 `App` 的 `useLocale` 监听 `languagechange` 重新解析（与 `useTheme` 听 `prefers-color-scheme` 同模式）；localStorage 键 `omp.locale.v1`（老版本存的 `"zh-CN"` / `"en"` 是合法档位，照旧生效；坏值回退 `system`）。落地方式是 `<html class="dark">` 这一个 class——浅色 token 是 `:root` 默认值、深色全挂在 `.dark` 下（`src/index.css`），**两套皮肤共用同一套 token 名**：组件里禁止写死色值、禁止用 Tailwind `dark:` 变体绕开 token（那是第二套皮肤实现）。两套都是「应用底最暗、侧栏比消息流亮一档」（导航面稍亮、内容面沉下去）：深色底 `#1B1F21` / 侧栏 `#222628`（**主色落在侧栏**），浅色底 `#EDF0F2` / 侧栏 `#F6F8F9`；两套同属冷青灰色相家族（色表见 MASTER §2）。两个易踩点：`index.html` 里有一段同步内联脚本在样式生效前先定 class（防首屏闪一帧），**键名与 `theme.ts` 必须一致**；`setTheme` 里同步调 `applyTheme` 而非只靠 effect（`useEffect` 在 paint 之后跑，只靠它会闪一帧旧皮肤）。切皮肤只改本应用展示层，不写 omp 配置、不写覆盖层。
- 导出是**只读**动作（V2 M9）：`TopBar` 的「复制会话为 Markdown」把界面上已渲染的 `ViewMsg` 经 `src/lib/exportMd.ts` 拼成 Markdown 写进剪贴板——不读盘、不落盘、不加后端命令；工具输出沿用界面口径截断并在截断处明写「已截断」，图片只写张数（不内联 base64）。消息级复制走行内 `CopyAction`（自带 copied 状态，**不许把状态提到 `ThreadRow` 上**，否则破坏 M8 的行级 memo）。
- 界面文案一律走字典（`src/lib/locale.ts` 的 `TEXT`）：组件内 `useText()`（`src/lib/useText.ts`）、非组件模块 `TEXT[useApp.getState().locale]`；插值用 `fmt(t.key, v1, v2)`（模板占位统一 `{0}`/`{1}`），**禁止硬编码界面文案**（含 `aria-label` / `title` / `placeholder` / 错误提示）。**上游数据不进字典**：会话标题、工具名/意图/输出、omp 的 UI 请求文案、后端错误一律原样透传。数据层生成的展示文本（分隔线标签、工具卡占位、导出 Markdown、附件校验）取**当归一 / 当次调用**时的语言——切语言后已渲染的旧消息要重开会话（重新归一）才会换。切语言只改本应用展示层（入口是左栏底部的 `LanguageToggle`，`omp.locale.v1` 走 localStorage），不写 omp 配置、不写覆盖层。
- 四个禁止：不轮询文件做伪实时；前端不自算 token（状态与用量一律透传 `omp-state` 真值；**聚合统计也一律由后端算好**，前端只格式化与按比例画柱）；不写回 omp 标题（改名只写覆盖层 `notes`，禁用 `set_session_name`）；设置页不改 omp 配置（诊断区只读 + 「指定 omp 路径」只写应用覆盖层 `ompPath`，更新区除外；界面语言与皮肤是纯展示层偏好，入口在左栏底部、走 localStorage，设置页没有这两项）——**唯一例外是设置 ›「供应商」「模型」「通用」三个页签**：用户在那里显式点「登录 / 登出 / 分配角色」或拨一个设置开关，写的就是 omp 的凭证库与 `config.yml`（见「核心数据流」的供应商条目与通用页签条目）。记忆页与使用统计页都不在例外之列：前者只删 `memories/` 下的文件、后者只读会话 jsonl，都不写任何 omp 配置（写记忆是 omp 自己的事，用量统计没有写入路径）。
- 设置页的「供应商」与「模型」两个页签（`src/components/settings/`，共六个页签：通用 / 供应商 / 模型 / 记忆 / 使用统计 / 已归档对话）：**通用**（`GeneralSettingsPanel`：omp 常用设置 40 项，6 组可折叠 + 开关 / 下拉 / 数字框 + 每行「恢复 omp 默认值」）、**供应商**（`ProvidersPanel`：omp OAuth 供应商清单 + 「已配置 / 未配置」+ 登录 / 登出）与**模型**（`ModelsPanel`：**模型角色 → 失败转移 → 常用模型 → 可用模型**四段）。登录卡固定在供应商列表**上方**（列表二十多条，放尾部等于「点了没反应」）并自动滚入视野；角色选择器是**行内展开**而非浮层（设置页是可滚动容器，浮层会被裁掉），候选模型与输入框 `ModelPicker` **共用同一份 `models` store**（同一次刷新两处同步）；「可用模型」按供应商分组折叠，只读。**角色行 = 名称 + 模型 + 档位按钮**：档位是 selector 的 `:档位` 后缀，空格拆分显示（`commandcode/claude-fable-5` + `xhigh`），按钮只在该模型支持思考时出现、候选按模型声明的档裁剪（目录里查不到该 selector 时退化为全集，不挡自定义与角色别名），「默认」= 不写后缀（交给 omp 的 `defaultThinkingLevel`）；拆合走 `lib/modelSelector.ts`（**只在 `:` 后那段是已知档时才拆**，模型 id 里的其它冒号不误伤）。**失败转移区块**（`FallbackChains.tsx`）= 总开关 + 回归策略两档 + 链列表（类型徽章「角色 / 模型 / 供应商通配」+ 有序目标芯片排）+ 「添加转移链」；新建时先挑生效对象（候选里已在用的键置灰，一个键只能有一条链），再维护有序目标（上移 / 下移 / 移除 / 行内选档位，通配条目不给档位——omp 规定它总是继承）；**编辑是草稿 + 显式保存**（保存 / 创建 / 取消三个动作都在编辑区底部），删除走行内二次确认。角色与转移目标共用 `ModelPickList.tsx` 的模型选择列表。登出走 `ConfirmDialog`。**这三个页签（供应商 / 模型 / 通用）是全 app 唯一改 omp 状态的地方**（凭证库 + `config.yml`），其余页面一律只读；「记忆」页签（`MemoryPanel`）只列 / 读 / 删 omp 的项目记忆（删除走 `ConfirmDialog`），「使用统计」页签（`UsagePanel`）只读会话 jsonl——两者都没有写入路径。
- `MemoryPanel`（`src/components/settings/MemoryPanel.tsx`）= 「设置 › 记忆」页签内容：标题行（`Notebook` 图标 + 「记忆」+ 项目计数 + 「刷新」）→ 一行口径说明（映射 `~/.omp/agent/memories`、omp 自动生成、本应用不写、删除不可撤销且下次整理可能重新生成）→ 按项目分组（组头 = 折叠箭头 + 项目名 + mono 路径或「原项目路径已不存在」warn 行 + 文件数与总大小 + 「清空记忆」，走 `ConfirmDialog`）+ 文件行（相对路径 + 分类标签 + 大小 + 日期 + 「删除」；分类与置顶顺序由后端给：`MEMORY.md` / `memory_summary.md` / `learned.md` / `raw_memories.md` 置顶，其余按路径序）。点文件行**行内展开** Markdown 预览（懒加载、一次只展开一个、删除后清缓存）——**不开浮层**：设置页是可滚动容器，浮层会被裁掉。
- `UsagePanel`（`src/components/settings/UsagePanel.tsx`）= 「设置 › 使用统计」页签内容：标题行（`ChartBar` 图标 + 「使用统计」+ 范围切换（今日 / 近 7 日 / 近 30 日 / 全部，稀释强调色按钮）+ 「刷新」）→ 一行口径说明 → 总览 9 卡（tokens 用量 / 预估费用 / 请求数 / 工具调用 / Cache 命中率 / 活跃天数 / 最常用模型 / 峰值时段 / 日均 tokens）→ **每日 Token 趋势**（堆叠柱：未缓存输入 `accent/25` / 缓存读·写 `accent/50` / 输出 `accent`，柱宽上限 28px，悬停整列高亮 + 标题行读数）→ 按模型 / 工具调用分布 / 时段分布 / 按项目（行 = 名称 + mono 副信息 + 比例条 + 次数 / token / 费用）。**图表是纯 CSS（百分比高度），不引图表库；颜色只用 accent 的透明度档**（单强调色约束不破）。数字与派生指标全部来自后端 `get_usage_stats`，前端只格式化；`truncated` 时明写「统计可能不全」。切范围 / 刷新时保留上一份数据显示（按钮转 loader），不闪空。
- **常用模型只决定输入框选择器列什么，不写 omp**：设置 ›「模型」的「常用模型」区块从「可用模型」目录用星标（`Star`，Outline/Filled 表示未选/已选）挑选，`ModelPicker` 下拉**只列挑过的模型**（按挑选顺序、仍按供应商分组）。**空下拉是禁止的**：常用为空**或**已挑模型在当前 omp 模型目录里全部不可用 → 回退为全部可用模型，并在下拉顶部加一行说明（`pickerAllModelsHint`）；设置页对目录里找不到的常用项照列不误并标「已不可用」（给人清理）。「可用模型」标题行下方有**过滤框**（按 `provider/id` + 名称），过滤态下命中组自动全部展开、组头退化为静态行（不许点了没反应）、标题行改显匹配数、零命中给「无匹配模型」——111 个模型不靠人肉展开找。偏好存 localStorage `omp.favoriteModels.v1`，唯一数据层是 `src/lib/favoriteModels.ts`（`loadFavorites`/`saveFavorites`/`toggleFavorite`/`favoriteEntries`，坏数据一律丢弃、去重保序）；**不回写 `modelRoles`、不写覆盖层、不改 `create_session` 的模型来源**。会话内切换行为不变（仍 RPC `set_model` → 后端跟进思考档 → `get_state` 回读）。`ModelPicker` 触发按钮文案**只按目录查 `currentModel`**，查不到显示「模型」——不许回退成目录里的第一个模型（会显示一个并不生效的模型名）。

## 常用命令

```bash
pnpm install
pnpm tauri:dev              # 桌面壳联调
pnpm dev                    # 纯前端
pnpm check                  # 提交前全过：typecheck + lint + test + e2e:ipc + e2e:rpc
pnpm typecheck              # tsc --noEmit
pnpm lint                   # eslint（flat config，0 警告）
pnpm test                   # vitest
pnpm e2e:ipc                # 前后端命令/通道/ViewMsg 静态契约自检
pnpm e2e:rpc                # fake-omp 驱动的行为级端到端（握手/审批双分支/多工具/中断）
pnpm build                  # tsc + vite 构建
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build            # 本机发布构建，产物见 src-tauri/target/release/bundle/
pnpm icon                   # 从 design-system/icon/omp-mini-icon.svg 重生成桌面图标
```

联调无需真实 LLM：`OMP_FAKE_SCENARIO=approve|deny|history|multi|abort|ui|mentions node scripts/fake-omp.mjs`（canned RPC 事件，覆盖审批双分支、多工具并行、流式中断、通用 UI 请求全方法与 @文件 提及）。

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包并生成 `latest.json` 供应用内 updater 拉取。
- updater 需签名校验：`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 当前为 TODO 占位；正式发版前用 `pnpm tauri signer generate` 生成密钥对，公钥填配置、私钥全文进仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`（见 README「应用内更新」节）。
- 升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 Unreleased 条目归入新版本节并写明日期）。

## 范围边界（V1 不做 / 二期已排）

自动化/定时任务、插件/Skill/MCP/Hook 管理、主题市场、云同步、多窗口协作、终端 PTY 仿真、diff 合并编辑器——这些仍在范围外，要做得单独决策。（原范围外的「用量统计面板」已在五期落地为「设置 › 使用统计」：只做**本机会话 jsonl 的只读聚合**，不做报表导出、不做成本预测、不做额度告警——见 `docs/v5-schedule.md` §4 的后续候选。）
二期（V2）已排的是 V1 文档里显式留下的坑 + 上游已给的能力：M5 通用 UI 请求、M6 图片与 `@文件`、M7 扫描分页与内容搜索、M8 长会话渲染复议（结论：不做虚拟列表，改行级 memo）、M9 复制与导出——**全部完成**；M9 的「重发」「导出 .md 文件」两项是需要先定交互/涉及落盘的候选，开工前先问。明细与实测数据见 `docs/v2-schedule.md`。
三期（V3，已完成）**供应商页与模型页**：设置 ›「供应商」把 omp 的 `login` / `logout` 映射进界面；设置 ›「模型」把 `model roles`（9 个内置角色 + 自定义角色的模型分配）与可用模型目录映射进界面。这两个页签是全 app 唯一改 omp 凭证库与 `config.yml` 的地方，且必须如此——登录 / 登出本质就是写 omp 的凭证、角色分配本质就是写 omp 的配置。明细见 `docs/v3-schedule.md`。
四期（V4，已完成）**记忆页**：设置 ›「记忆」把 omp 的项目记忆映射进界面——按项目列出 `<agentDir>/memories/` 下的记忆目录，可查看（行内 Markdown 预览）、可删除（单文件 / 整目录清空）。**上游没有 `omp memory` CLI，记忆由 omp 自己的后台整理流水线写出，壳侧只列 / 读 / 删、从不写**（「设置页不写 omp」的口径不破：删除是文件系统操作，不碰配置与凭证）。明细见 `docs/v4-schedule.md`。**编辑 / 新增记忆、触发重新整理仍不做**（需先定边界）。
五期（V5，已完成）**使用统计页**：设置 ›「使用统计」把本机会话记录里的用量聚合成一页只读统计（对标 ZCode 的「使用统计」，数据源换成 omp）——范围（今日 / 近 7 日 / 近 30 日 / 全部）+ 总览（tokens / 费用 / 请求 / 工具 / Cache 命中率 / 活跃天数 / 最常用模型 / 峰值时段 / 日均）+ 每日趋势 / 按模型 / 工具分布 / 时段分布 / 按项目。聚合全在后端（`src-tauri/src/usage.rs`，三道扫描预算 + `truncated`），前端只格式化、纯 CSS 画柱。明细见 `docs/v5-schedule.md`。
六期（V6，已完成）**用量限额入口**：输入框上方上下文条（项目 / 分支之后）加一个进度条入口，点开看**供应商侧的配额窗口**（opencode 网站那种 5 小时 / 每周 / 每月）。数据来自 omp 自带命令 `omp usage --json`（22 个供应商用量的上游探针都在 omp 里，壳侧只解析——不自己调 API、不碰凭证库，与供应商页走 `omp auth-broker` 同款）；后端 `src-tauri/src/quota.rs`（1 个命令，6 项解析单测），前端 `components/composer/UsageLimits.tsx` + `lib/usageLimits.ts`（12 项单测）。**与设置页「使用统计」是两回事**：那边统计本地会话 jsonl 的 token，这边展示供应商配额；也没有写入路径（不调 `omp usage invalidate`）。明细见 `docs/v6-schedule.md`。

七期（V7，已完成）**上下文容量**：输入框工具行、模型选择器**左侧**加一个容量环，点开看这次上下文里各块各占多少（对标 ZCode 会话内的「上下文容量」浮层）——总量 / 窗口 / 非消息是 omp 真值，「消息 = 已用 − 非消息」也是真值，非消息各档按字符量估算后对齐到真值（后端 `src-tauri/src/context.rs`，1 个只读命令 + 10 项单测），前端 `components/composer/ContextMeter.tsx` + `lib/ctxUsage.ts`（6 项单测）。**与设置页「使用统计」（历史 token 聚合）、上下文条上的「用量限额」（供应商配额）是三件不同的事**，不许合并。明细见 `docs/v7-schedule.md`。

八期（V8，已完成）**通用设置**：设置 › 通用里加「omp 常用设置」——从 `omp config` 的 **501 个键**里精选 **40 项**（6 组：会话与上下文 / 工具 / 终端与编辑 / 记忆与学习 / 任务与技能 / 交互与显示），开关 / 下拉 / 数字框直接改，行尾可「恢复 omp 默认值」（后端 `src-tauri/src/settings.rs`，3 个命令 + 9 项单测；前端 `components/settings/GeneralSettingsPanel.tsx` + `lib/ompSettings.ts`，12 项单测）。**这页是本 app 第三个改 omp 状态的地方**（前两个是供应商与模型页签）——写的是 **omp 全局配置** `config.yml`，`<cwd>/.omp/config.yml` 的项目覆盖优先于它（界面如实写明）。取舍原则：**同义入口不许重复**——`tools.approvalMode` 留在输入框的 `PermissionBadge`、`modelRoles` 与 `retry.fallbackChains` 留在模型页签，全都不进这张白名单。**不做**配置浏览器 / 项目级写入 / array·record 类型的键。**只影响 omp 自身 TUI 的键要如实标注**：`plan.enabled` / `goal.enabled` 只是功能总闸，对壳侧会话没有可观测效果（`plan.defaultOnStartup` 只被 TUI 启动流程消费；goal 工具只在 goal 模式激活时挂载，RPC 进不去），用 `SettingSpec.tuiOnly` 在行上标「仅 TUI 生效」。明细见 `docs/v8-schedule.md`。

十期（V10，已完成）**输入框 `/` 命令补全**：打 `/` 弹出 omp 自己的命令面（`available_commands_update`，本机实测 52 条），可搜索、可键盘导航、选中即补全——**技能就是命令面里 `skill:<名>` 的那批**（`source:"skill"`），单独成组显示但**不另扫技能目录**（会重复，还要复刻 omp 的加载优先级）；**子智能体不做**（RPC 命令面不含、`/agents` hub 是 TUI 专属，列出来就是假入口）。前端 `components/composer/SlashMenu.tsx` + `lib/slashCommands.ts`（16 项单测），**后端零改动**——命令面早就缓存在 `SessionMeta.commands` 并经 `get_session_runtime` 到了 store，只是没人读；本次只补了「会话开着时命令面又变了」那一路。**与上下文容量 / 用量统计 / 用量限额仍是几件不同的事**，本批不碰它们。明细见 `docs/v10-schedule.md`。

九期（V9，已完成）**失败转移链 + 角色思考档**：设置 ›「模型」新增**失败转移**区块（`retry.fallbackChains` + 两个配套开关），并把角色值本来就支持的 **`:思考档` 后缀**补进界面（此前 pick 模型时会丢掉档位）。后端 `src-tauri/src/providers.rs` 加 3 个命令（`get_fallback_chains` / `set_fallback_chain` / `set_retry_options`）+ 5 项单测；前端新增 `components/settings/FallbackChains.tsx` 与 `ModelPickList.tsx`、`lib/modelSelector.ts`（6 项单测），`ModelsPanel` 区块顺序变为**模型角色 → 失败转移 → 常用模型 → 可用模型**。**与通用页的分工**：array / record 型的键 V8 明确不做，`retry.fallbackChains` 与 `retry.modelFallback` 归本页；`retry.maxRetries` 等数字型归通用页。**与使用统计 / 用量限额 / 上下文容量仍是三件事**，本批不碰它们。明细见 `docs/v9-schedule.md`。

## 命名与变更约定

- 对外名称：ompMiniDesktop；仓库/包名：`ompMiniDesktop` / `omp-mini-desktop`；标识符、文件名：英文；界面文案、注释、文档、提交说明：中文。
- 架构级变更（创建/删除/移动文件或目录、核心数据流变更）必须同步更新本文档、`docs/` 与 `design-system/MASTER.md`。
- 增删前后端依赖时同步 `THIRD-PARTY-NOTICES.md`；密钥、Token、私钥、签名证书、个人路径一律不得进仓库。
