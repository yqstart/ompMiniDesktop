# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [Unreleased]

### 新增

- **归档对话管理面（V2 M11）**：左栏**不再展示已归档会话**（旧的「已归档（N）」折叠抽屉删除，分组头计数与批量只算进行中——归档看不见就不该在左栏被「删除全部对话」顺手删掉）；设置页加**分页签**（`通用` / `已归档对话`），新组件 `ArchivedSessions` 按项目分组（未归属单独一组、目录缺失走 warn 色）列出全部归档会话，分组级「恢复全部 / 删除全部」+ 行级「恢复 / 删除」，行标题可点开只读回放，删除走既有 `ConfirmDialog`；恢复/删除后同时刷新本页与左栏，恢复的会话立刻回到项目分组。后端新增 `list_archived_sessions`（**不受左栏 500 个扫描窗口限制**：按覆盖层 `archived` 标记逐个定位文件、只读路径里带 id 前缀的那些，解析头后复核 id 与标记；覆盖层里的失效 id 不冒空壳）与 `unarchive_sessions`（批量恢复，幂等，单次上限 200，与 `archive_sessions` 同构）。批量分档与失败聚合抽成 `src/lib/sessionBatch.ts`（左栏分组头与设置页共用同一份 `BATCH_LIMIT`），删除后的前端痕迹清理（`pruneDeletedSessions`）一并收口；新命令注册进 `ipc.ts`/`api.ts`/`main.rs` 与 `e2e:ipc` 自检（42 个命令）。Rust 新增 2 项真实临时目录测试（只列归档 + 备注覆盖标题 + cwd 回项目归属 + 失效 id 落空；倒序 + 未归属归类）。文案进 `lib/locale.ts` 中英字典。
- **正确性修复（P0，四项）**：审批卡回执后进入终态（展示"已允许/已拒绝"结论、按钮收起，不许重复点；失败给内联错误可重试）；图文混贴不再丢字（粘贴图片时同剪贴板的文字一并填入草稿；非图片拖入给中文提示）；发送加乐观回显（先落本地 `u-local-*` 消息，失败回滚不留幽灵；历史回放按文本合并去重，不翻倍）；本地命令（`/`）走 `command_output` 渲染 + `agentInvoked:false` 收敛 idle，不再无限转圈（前后端各 1 个单测）。
- **流式排队与转向（P1）**：新命令 `steer_message` / `follow_up_message`（后端 `send_prompt` 统一组装图片）；输入框流式中 Enter 排队（本轮后执行）、⌘/Ctrl+Enter 转向（下一个工具边界生效）、工具行「排队」按钮；工具行新增排队数徽标（`queuedMessageCount` 真值）。`pnpm e2e:rpc` 新增排队转向断言。
- **上下文压缩（P1）**：新命令 `compact_session{customInstructions?}`；上下文占用 ≥80% 时工具行出现「压缩 N%」按钮；压缩/重试/子代理生命周期帧渲染成分隔线。`e2e:rpc` 新增 compact 断言。
- **分支、`/` 命令、计划、补全（P1）**：新命令 `branch_session{entryId}` / `run_slash` / `complete_path{prefix}`（只读目录列举、前缀匹配、上限 20，`..` 直接拒绝）；`/` 开头自动走本地命令；`available_commands_update` 缓存进 `commandsBySession`，输入框行首 `/` 弹出命令补全（上下键导航、Tab/Enter 选中、Esc 关闭）；`@` 路径前缀 300ms 防抖补全（同套键盘交互）；`todoPhases` / `todo_reminder` 落成只读计划卡（`PlanCard`）；审批外 `select` 的 `optionDetails` 展示为选项描述。前端 5 项、Rust 1 项单测覆盖。
- **桌面本分（P2）**：ToolCard 参数摘要、`@文件` 芯片点击用系统默认应用打开（`opener` 插件终于被调用）；助手正文外链点击二次确认后打开（`csp: null` 保持不变，先收确认）；长任务完成/等待审批时窗口不在前台则系统通知（`notification` 插件，需首次授权）；草稿按会话持久化到 localStorage（启动水合，发送清空）。
- **依赖**：新增 `@tauri-apps/plugin-notification`（前后端）并注册 `notification:default` 能力。
- **设置页界面语言**：新增「界面语言」区（简体中文 / English 二选一，radio 语义 + 选中态 accent 稀释）。只作用于本应用展示层，不改 omp 配置、不写覆盖层；`src/lib/locale.ts` 存中英字典（模板占位 + 键一致性单测），`stores/app.ts` 新增 `locale/setLocale`（`omp.locale.v1` 走 localStorage 持久化，切换即写 `<html lang>`，启动回填一次）。

### 变更

- **界面语言覆盖到全界面（此前只管设置页）**：左栏（项目分组 / 会话行 / 搜索与命中 / 批量与二次确认 / 扫描窗口 / 设置入口）、空态、顶栏、消息流（工具卡 / 审批卡 / UI 请求卡 / 计划卡 / 思考 / 文件芯片 / 加载更早）、输入区（附件与提及提示、`/` 与 `@` 补全、占位文案、排队与发送-停止）、工具行（模型 / 思考档 / 权限 / 状态胶囊 / 用量 / 压缩 / 排队数）、上下文条与项目·分支选择器、更新铃铛与弹窗、健康横幅、通用确认框，统一走同一份中英字典 `src/lib/locale.ts`：`TEXT[locale]` 为全量字典（英文键由中文键推导，漏键编译期报错 + 单测守着），`fmt(t.key, v1, v2)` 填 `{0}`/`{1}` 占位（原 `{v}` 占位一并归一），组件取文案的唯一入口是新增的 `src/lib/useText.ts`（单独成文件以避开 `locale.ts` ↔ `stores/app` 的循环依赖）。数据层生成的展示文本同样按语言给：历史 / 实时归一的分隔线标签（`viewMsgsFromJsonlLines` / `frameToViewMsgs` 收 `Text` 参数）、被用户拒绝回执、`summarizeArgs` 不再内嵌「（无参数）」占位（改由 `ToolCard` 按当前语言兜底，`mergeToolCard` 因此按 `state === "streaming"` 判断而非比字符串）、导出 Markdown 标签、附件校验错误、诊断 / 更新 / 路径 / 通知提示。**上游数据不进字典**：会话标题、工具名/意图/输出、omp 的 UI 请求文案、后端错误一律原样透传。口径：数据层文本取当归一 / 当次调用时的语言——切语言后已渲染的旧消息要重开会话（重新归一）才换；字典新增「英文不含中文」与键数下限单测（漏译 / 整块漏迁立刻红）。
- **切换项目 = 在该项目下新建对话；刚新建的会话立刻归到该项目**（修两项）。输入框上方项目下拉此前是「切过去并打开该项目最近一个会话」——会把上一个对话的上下文带进来，现在 `switchProject` 的 `newSession` 分支直接走 `createSessionIn`（切上下文 + 建新会话 + 选中；点当前项目只收下拉、不重复新建，失败在内联 danger 文案里给提示）。同时修掉「新建的会话不展示当前项目」的根因：omp 的 jsonl 是**懒写盘**（首个 turn 才落文件），`create_session` / `open_session` 读不到文件头 cwd 就把 `projectId` 给成 null（补进左栏后落进「未归属」），而左栏归组用的是真实路径前缀（`project_of`）——两套规则分叉。现在归属判定收口成唯一入口 `owner_project`（与 `list_sessions` 同规则：最长前缀 + 符号链接展开），读不到文件头时退回 spawn 时的 `--cwd`（`owner_cwd` + runtime 新增的 `RunningChild.cwd`），`create_session` / `open_session` / `list_sessions` / 归档清单四处共用（后两处顺带去掉重复实现）。`list_sessions` 另把「runtime 里还没落盘」的会话按 spawn 事实补进列表（`unlanded_views`：cwd / 时间 / 归属全是真值，已落盘的候选不重复补），切换项目等任何一次刷新都不会再让刚新建的会话行消失；新建 / 打开回包在文件头为空时用 spawn 时刻兜底时间戳（此前左栏显示成 1970 的「01-01」）。修复后点「新建会话」左栏立刻在对应项目分组下出现该会话、上下文条显示该项目。Rust 3 项单测（前缀匹配含 `/tmp` 符号链接写法、懒写盘兜底、未落盘补行不重复）。
- **左栏搜索框去掉内层焦点环**：聚焦时输入框自身那圈 2px outline 与容器外框叠成「双框」，现在只留外层——输入框加 `no-focus-ring`（`src/index.css` 新增，`outline: none`），焦点仍由容器的 `focus-within:border-accent/60` 表达，可访问性不降级。注意这份自定义 CSS 不分层、优先级高于 utilities，Tailwind 的 `outline-none` 压不住全局 `:where(input):focus-visible`，必须显式关（口径记入 MASTER §5 焦点例外 + §4 搜索框）。
- **左栏批量操作收窄到「进行中」+ 指向新归档页**：分组头「删除全部对话 / 删除工作区」的确认文案改按进行中计数，并写明「已归档的对话不在这里删（去设置 › 已归档对话）」；打开归档会话时的顶部横幅从「取消归档后可继续对话」改为「到『设置 › 已归档对话』恢复后可继续对话」——左栏已无归档入口，文案不能再指向一个不存在的地方。
- **`parity` 对拍测试改为对拍头部切片**：原本拿整份会话断言「每条用户消息都出现在 `omp render --plain` 输出里」，但该命令是**视口渲染**（拼一帧即 emit，超长线程的后续内容不出现，emit 长度还随调用方 TTY / 终端尺寸变化），于是测试成了「当前会话有多长」的函数——本机 `pnpm check` 时红时绿。改为只对拍「会话头 + 前 40 条」切片（样例同样取自该切片），连跑 3 次全绿；被截掉的历史中段不再参与比对，解析口径仍由 `viewmsg` 单测守着。
- **左栏「添加项目」与搜索框固定在最上方**：此前两块（连同整个侧栏内容）都在同一个滚动容器里，会话一多就被滚走。现在它们包在 `sticky top-0 z-10` 的不透明底固定区里（`-mx-2 px-2` 让底色铺满，滚过去的会话行不会从两侧露出），只有会话列表滚。**同时给列表加 `scrollbar-gutter: stable`**：滚动条出现/消失时内容宽度不变，不再横向跳一下（MASTER §7「禁止内容跳动」补上滚动条这一条）。固定区与列表共用同一条滚动条留白，搜索框与会话行宽度始终对齐。
- **新建会话顶部不再冒「思考等级已设为 max」**：omp 建会话时就把初始档位 / 模型落盘（`--model` / `--thinking` → `thinking_level_change` / `model_change`），历史回放把这两行当「会话中切换」渲染成系统分隔线，于是每个新对话顶部凭空多一行提示。现在口径统一为**首条用户消息之前的模型 / 思考档记录不渲染**（历史回放按 `userSeen` 判，实时流按「该会话是否已有用户消息」判，两条路径同一套判据），会话中切模型 / 切档的分隔线照旧。3 项单测（含真实 jsonl 首行形态；去掉判据即失败）。
- **中央空态去掉 3 个示例问题按钮**（「这个项目是做什么的？」等）：空态只留「会话会在哪个项目下新建」+ 快捷键提示 + 「新建会话」按钮，不再替用户起话头；`EmptyState` 随之不再需要草稿写入。
- **左栏选中态改用主按钮同色的稀释填充**：此前会话行选中是「比背景深一档的灰 + 1px 低对比描边」，在侧栏底上几乎看不出选中；现在统一为与顶部「添加项目」主按钮**同色**（`accent`）的稀释填充 `bg-accent/15` + 左侧全色 3px 竖条，会话行与当前项目分组头**共用同一套**，选中行标题 `font-semibold`（深色预览可见项目头/会话行同时高亮，浅色同构）。文件夹类标题（项目 / 已归档 / 未归属）一并凸显：加 `Folder` / `Archive` / `Inbox` 图标 + `font-semibold`，项目名 12px → 13px。口径写进 MASTER §2（accent 用途 + 稀释配方）与 §4（会话行 / 项目分组头）。
- **二期 M8：先量后做，结论是不上虚拟列表，改行级 `memo`**。新增测量夹具 `src/lib/historyScale.test.ts`（`OMP_BENCH=1` 才跑，默认跳过以免 CI 依赖本机数据），在本机 69 个真实会话上测得：最大会话 8.1MB / 1867 行，后端口径（5000 行、2000 条）下 1411 块 → 698 条 ViewMsg **归一只要 2–4ms**，且该会话是工具卡密集（488 张卡 / 201 thinking / 6 文本）而非文本密集——瓶颈不在数据层也不在条数。真正浪费的是渲染：流式每个 delta 都会更新 store，整列跟着重渲染时每次 token 都要重算所有 Markdown / 工具卡。因此把消息行抽成 `memo` 化的 `ThreadRow`（依赖 `mergeViewMsgs` 对未变化消息保持同一对象引用，补 2 条引用稳定性断言防止这条前提被改坏）。复评阈值写进 MASTER §7 与 `docs/v2-schedule.md`：单会话 > 5000 条 / > 30MB / 明显掉帧才回来做 windowing。

### 新增

- **二期 M9（部分）：顶栏「复制会话为 Markdown」**。把界面上已渲染的 `ViewMsg` 经 `src/lib/exportMd.ts` 拼成 Markdown 写进剪贴板——不读盘、不落盘、不加后端命令，导出内容与界面所见一致。语法取舍：思考包进 `<details>` 可折叠；工具卡带状态 + 围栏输出并**沿用界面口径截断、在截断处明写「已截断」**（不假装全文）；内容含 ``` 时自动换更长围栏；图片只写张数（不内联 base64）；`@文件` 芯片写「读入上下文：路径（N 行）/（已跳过：原因）」。7 项单测。同一批还加了**消息级复制**：用户气泡与助手正文 hover 出「复制」按钮（复制原文，助手正文只在流式结束后出现），实现为行内独立 `CopyAction` 组件、自带 copied 状态，不破坏 M8 的行级 memo。
- **二期 M7b：左栏搜索覆盖会话正文**。新增后端 `search_sessions`：只搜 `message` 行里 user / assistant 的 text 块（工具输出、thinking、JSON 字段名都不进搜索面——否则搜 "user" 会命中每一行），逐行读取并有四道预算（命中数 30 / 文件数 1000 / 总字节 96MB / 墙钟 1.5s，单文件 8MB 上限），任何一道到点即停并把 `truncated` 置真。前端输入 ≥2 字才搜（单字命中面太大）、300ms 防抖，「N 个标题匹配」下方新增「内容命中 N 个会话」区：标题 + 归档角标 + 命中次数 + 单行片段（命中词高亮全部出现位置，`src/lib/search.ts` + 单测），点击直接打开会话；被预算截断时明写「已到预算上限，结果可能不全」。命中会话可能落在扫描窗口外，`openSessionWithHistory` 打开后会把它补进列表，避免顶栏显示「未命名会话」。Rust 侧新增 3 个真实临时目录行为测试（命中/归档标记/短查询/命中上限）。
- **二期 M7a：会话扫描分页，超过 500 个会话不再静默截断**。`list_sessions` 改为返回 `{sessions, totalFiles, scannedFiles}`（`totalFiles` = sessions 目录下 jsonl 总数，`scannedFiles` = 本次真正解析头部的数量），新增 `limit`（默认 500，夹在 1..=5000）与 `offset` 参数；左栏底部在 `totalFiles > scannedFiles` 时显示「已扫描最近 N 个会话（共 M 个）」+「继续扫描更早的 500 个」按钮（按 500 递增，上限 5000）。口径是「窗口外不是不存在，是没解析」。前端新增 `src/lib/sessionList.ts` 的 `loadSessions()` 作为会话列表 + 扫描统计的唯一落库入口，散落各处的裸 `api.listSessions()` 调用（Sidebar / TopBar 备注改名 / createSessionIn / switchProject）统一收口。
- **二期 M6（`@文件` 部分）：提及芯片与读入回执**。关键事实是**展开由 omp 自己做**（prompt 时把命中的文件读成 `role:"fileMention"` 消息），所以壳侧不重复读文件，只做两件事：输入框把草稿里的 `@路径` 显示成芯片并用新命令 `check_paths`（只 stat、相对会话 cwd 词法归一）标出「路径不存在」（omp 对不存在的路径是静默跳过，不提示就会以为读进去了）；转录区新增 `MentionChips` 把 `fileMention` 渲染成一排文件芯片，被跳过的文件（`skippedReason`：binary / tooLarge）走 warn 色 + 「已跳过自动读取」tooltip。解析规则与上游 `extractFileMentions` 逐条对齐（`src/lib/mentions.ts`：引号形式、行首/空白边界、ASCII 首尾修剪），带 6 项单测。
- **二期 M6（图片部分）：输入框支持图片附件**——粘贴（⌘V）、拖拽文件、点回形针选文件三条入口都可用；图片读成 base64 只存在内存里（`attachmentsBySession`，按会话隔离），发送时随 `prompt{message, images:[{type:"image",data,mimeType}]}` 一次性交给 omp，应用不落盘、不写覆盖层。用户气泡内直接渲染缩略图（`data:` URL，本地显示），历史回放读 omp 写进 jsonl 的 `image` 内容块（兼容 anthropic 风格 `source.data`）；模型目录 `input` 不含 `image` 时给内联提醒。校验：只收 PNG/JPEG/WebP/GIF、单张 ≤ 10MB（前后端各兜一道），历史回放里单张 base64 超过 512KB 的块省略并提示张数，避免长会话把内存吃光。新增后端 `read_image_file`（选文件入口用：WebView 拿不到任意本地路径内容）与 `b64encode`。
- **二期 M5：omp 通用 UI 请求全类型接住**（此前只精做审批 `select`，其余一律塞进审批卡且**回包格式错误**——`confirm` 回了 `{value:"Approve"}`，`input`/`editor` 干脆不渲染，agent 侧等一个永远不来的回包）。现在按上游真实语义分流：`confirm`（双按钮，回 `{confirmed}`）、`input`（单行 + Enter 提交）、`editor`（多行 + ⌘/Ctrl+Enter 提交）、非审批 `select`（选项按钮，回 `{value}`）走新组件 `UiRequestCard`，取消/跳过统一回 `{cancelled:true}`；`notify` 渲染为分隔线，`setStatus`/`setWidget`/`setTitle`/`set_editor_text` 作为单向宿主指令丢弃且不告警；服务端 `cancel{targetId}` 会撤回对应卡片（不留点不动的死卡）。后端新增 `respond_ui(id, uiId, kind, value?, confirmed?)` 命令（与 `approve` 分工：审批多一步会话级 yolo 意向）；`awaiting-approval` 状态只由这四类交互方法触发，单向方法与撤回不再误锁 composer。上游方法集与回包字段取自 omp 18.1.22 内嵌源码实测，记入 `docs/v2-schedule.md` §2。
- 新增二期排期 `docs/v2-schedule.md`：M5 通用 UI 请求（本批）/ M6 图片与 `@文件` / M7 会话扫描分页与搜索 / M8 长会话 windowing 复议，含从 `prompt{message, images}` 实测到的图片透传口径。
- 项目分组头新增「删除工作区」入口（`FolderMinus`，hover 操作区第三个按钮）：二次确认后只解绑目录、不删任何 jsonl 文件；名下对话（含进行中）由后端 `remove_project` 按 cwd 扫描后全部标记归档保留，可在「未归属会话」的已归档里找回。
- 思考档新增真值回读通道：后端 `get_session_runtime` 命令 + `omp-state://<sessionId>` 事件推送模型 / 可用思考档（omp `thinking.efforts`）/ 当前档，打开会话即回填，不再靠前端猜。
- 输入框上方新增**上下文条**（`ContextBar`）：左「项目」右「git 分支」。项目认会话归属（会话未归属就显示「未归属」，不回退左栏 `activeProjectId`），点开列全部项目、选中即切上下文并打开该项目最近会话；分支为**只读**展示——收起态显示分支名（detached 显示短 sha + 「游离」角标，有未提交改动带 warn 圆点），展开态列本地分支（当前分支置顶打勾）+ 手动刷新 + 「切分支请在终端操作」，非 git 目录显示「非 Git 目录」。两者与工具行下拉共用互斥槽 `composerMenu`，同一时刻只开一个。
- 后端新增 `get_git_info` 只读命令：git CLI 查询当前分支 / 本地分支清单 / 脏工作区标记；`git` 路径按 PATH → 登录 shell `command -v git` → 常见绝对路径探测并缓存（GUI 应用的 PATH 只有 launchd 默认值），单条查询 4s 超时。目录缺失 / 非仓库 / 未装 git 一律返回 `isRepo:false` 降级值，不弹错。
- 助手正文新增 **Markdown 渲染 + 代码高亮**（`AssistantText`）：走 `react-markdown`（不注入原始 HTML）+ `rehype-highlight`，配色在 `src/index.css` 用项目 token 定义（深浅色自动跟随，不引第三方主题）；代码块带复制按钮，表格/列表/引用排版齐全，流式中未闭合的围栏代码块给 skeleton 占位。Markdown 渲染链单独分包（`markdown-*.js`），主包体积不变。
- 状态条补齐**真值透传**：上下文占用（`get_state.contextUsage`）、本轮 token 用量、耗时与 TTFT（`message_end.message.usage/duration/ttft`）由后端提取后随 `omp-state://<id>` 推送，输入框工具行新增只读 `RuntimeStats`（前端只做格式化，不自算 token）。单位经真实会话 jsonl 确认：omp 的 `duration` / `ttft` 就是毫秒。
- 消息流新增**首屏增量**（MASTER §7）：默认只渲染最后 200 条，向上滚动或点「加载更早的 N 条」按页展开，加载后保持视口位置不跳；窗口按会话重置。
- 新增 `pnpm e2e:rpc`（`scripts/e2e-rpc.mjs`）：用 fake-omp 驱真实行协议跑**行为级**端到端——握手 → get_state → prompt → 审批通过/拒绝 → 多工具并行 → 流式中断，并断言事件序列与 toolCallId 一致性；`fake-omp` 补齐 `multi`（双工具一成一败）与 `abort`（流式中断）场景。CI 增加 lint 与 e2e:rpc 两步，另加 `pnpm check` 一键跑全部检查。
- 新增 `eslint.config.js`（flat config：typescript-eslint + react-hooks + react-refresh）：此前 `package.json` 声明了 `lint` 脚本却没有配置文件，`pnpm lint` 一直以 exit 2 失败。规则按仓库实际取舍（类型重活交给 `tsc`），`pnpm lint` 现已 0 报错。
- 设置页新增 **omp 诊断区**：omp 路径 / 版本 / agentDir（带复制）+ 重新检测 + 手动指定 omp 可执行文件；顶部「未找到可用的 omp」横幅同样补这两个动作（GUI 启动的 PATH 常不含 homebrew 目录，此前横幅只能看不能修）。指定路径只写应用覆盖层，不改 omp 配置。
- 项目目录缺失时，左栏分组内新增「重定位」入口（后端 `relocate_project` 此前没有 UI 入口）。
- 窄窗（<768px）顶栏新增「打开侧栏」按钮：桌面侧栏是 `hidden md:block`，而抽屉状态此前无人置 true，窄窗下项目列表与设置完全不可达。
- 中央空态补「会话会在哪个项目下新建」说明与 3 个示例问题（点示例即新建会话并填入草稿）；「新建会话」按钮此前只关抽屉、不建会话。
- 新增通用 `ConfirmDialog`（MASTER §8）：受控浮层、Esc/遮罩取消、焦点默认落在「取消」、危险操作走 danger 色。批量删除改走它，仓库里最后一处 `window.confirm` 随之消失（项目分组内的轻量确认仍是内联浮层，不撑布局）。
- 会话扫描加**规模保护**：`list_sessions` 先按修改时间取最近 500 个 jsonl 再解析（超出打日志），避免共享 agentDir 上千文件时拖慢列表。
- 协议漂移可观测：前端遇到未知事件类型时按类型各告警一次（`console.warn` 带原始帧），不再是"静默忽略、出问题只能猜"。

### 变更

- 实时流的工具卡改为**一次调用只出一张卡**：统一用 `tool:<toolCallId>` 作卡 id，新增纯函数 `mergeViewMsgs`（`src/lib/mergeEvents.ts`）按 id 原位合并、保留早期事件里的参数摘要与意图。此前 `toolcall_delta` / `toolcall_end` / `tool_execution_start` / `tool_execution_end` / `toolResult` 各自追加，一次调用渲染 2–3 张卡且「输入中」那张永远转圈（历史回放路径早已合并，直播路径漏了），并伴随 React 重复 key 警告。
- 新建会话统一走 `createSessionIn`（`src/lib/sessionOpen.ts`）：左栏项目分组与中央空态共用一份实现，都会刷新列表、选中新会话、起 RPC 并拉历史。
- 会话级权限覆盖改为**直接订阅 store**（启动时经 `get_overlay` 水合），不再用本地 state 拷贝——此前重启后徽标只显示全局档，与真实会话覆盖不一致。
- 切模型 / 切档后的 `get_state` 真值回读会**顺带回写项目 `lastModel` / `lastThinking`**（新增 `remember_project_pref`）：`create_session` 一直会读这两个字段，但此前没有任何地方写，导致「新建会话沿用项目上次模型」实际永远落回全局默认。
- 左栏主入口改为「添加项目」：左上角原「新建会话」accent 按钮改为调目录选择器添加项目（与中央空态「选择目录」共用 `src/lib/projects.ts` 的 `pickAndAddProject`，失败走左栏内联错误条）；底部「设置」上方的重复「添加项目」入口移除。新建会话保留在各项目分组内与中央空态，不再占用主入口。
- 左侧栏移除会话行首复选框与「已选 N」批量工具条：会话行只保留单个会话的归档、取消归档与删除（二次确认浮层）；批量入口统一收归分组头——项目分组头 = 归档全部对话 / 删除全部对话 / 删除工作区（后两者各自浮层二次确认），「未归属会话」分组头 = 归档全部 / 删除全部对话。批量按后端 200 上限分批调用；删除成功后清掉被删会话的前端缓存，正在看的会话退回空态。
- 项目删除改为工作区语义：分组头 hover 出删除按钮，二次确认后只解绑目录、不删会话文件；名下会话全部归档保留，进「未归属会话」可找回；备注/权限覆盖保留。`remove_project` 流式中的会话先停再删。
- 输入框工具行模型/思考档下拉改为右对齐（`right-0` + `max-w-[calc(100vw-2rem)]`）：靠近输入框右侧的触发按钮不再被输入框右缘横向裁剪。
- 应用图标重做为 **π 字标**（呼应 oh-my-pi 的 Pi 血脉）：T 型交汇走 R46 内圆角、笔画全圆头，配色为**极光渐变**（青绿→天蓝→紫→粉）+ 石墨底三处同色辉光。替换 Tauri 默认图标；矢量源落在 `design-system/icon/omp-mini-icon.svg`，`pnpm icon` 一条命令重生成 icns / ico / 各尺寸 png。
- 模型选择器去掉「思N」角标（档位数不是决策信息），行内只留上下文（`1M`/`200K`）与图片（`图`）标记。
- 工具行模型名不再截断（原 `max-w-32` + `truncate` 会把 `Muse Spark 1.3 Contributor` 显示成 `Muse Spark 1....`）：改为按内容自适应宽度完整显示；窗口过窄时由工具行换行兜底，不省略模型名。
- 选择模型后思考档自动适配：可用档随模型自动识别，下拉**只列该模型真正支持的档位**（`off` 恒在首位，不再列全集置灰）；切模型后自动落到新模型最高档（无思考模型自动 `off`）——实测 omp 切模型不会自行修正档位，切到无思考模型甚至会直接丢掉档位。

### 修复

- 审批拒绝分支在 `message_end{toolResult}` 路径不再显示 omp 原文（英文 `Tool call denied by user: bash`），统一渲染为「被用户拒绝」并置失败态（`isError` 也计入——此前只看文本关键字）。
- `confirm` 类 UI 请求的回包格式修正：此前复用审批回包 `{value:"Approve"}`，omp 侧期待的是 `{confirmed:true/false}`（实测内嵌源码 `WOt` 解析器），现在按方法组装。
- 修掉新 lint 配置查出的一批 React 反模式：拖拽态在 render 期读 ref（改 state）、`ContextBar` / `PermissionBadge` 在 effect 里同步 setState（改为派生值 / 直接订阅 store）、`useSessionEvents` 在 render 期写 ref（移到 effect）。
- 会话头解析不再整个读文件：大文件只读「头 64KB + 尾 64KB」两段（头段取 session/title、尾段取最新 title_change，各自跳过被切断的残行），列表扫描不再为每个会话把几十 MB 读进内存；补 4 个单测覆盖正常 / 缺 title / 损坏 / 超大头尾。
- 审批卡出现即滚入视野（长会话里审批可能落在视口之外）；下拉打开时自动聚焦首个可聚焦元素（模型下拉即搜索框）。
- 清理 Rust 死代码：`CmdError::new`、`emit_health`、`RunningChild` 未读字段，`cargo build` 回到零警告。
- 换图标后 cargo 不重建：`tauri-build` 的 `rerun-if-changed` 不覆盖 `icons/`，改由 `src-tauri/build.rs` 显式声明 `cargo:rerun-if-changed=icons`。
- 修掉模型/思考档两处「看着生效、实际没生效」的老问题：点选模型只改了前端 store、从未下发 `set_model`（omp 侧模型其实没切）；打开会话从不回填 omp 真值（界面显示的模型与档位可能与 omp 实际不一致）。同时把两个选择器改为响应式取值（此前选完按钮文字不更新）。

## [0.1.0] - 2026-09-15

首个可用版本：oh-my-pi 的极简桌面壳（Tauri v2 + React）。

### 新增

- 项目：添加本地目录、移除（仅解绑）、目录缺失标记与重定位。
- 会话：新建、打开（`--resume` 恢复）、归档/取消归档（只读横幅）、删除（二次确认，不可恢复）。
- 输出渲染：用户气泡、流式 Markdown、思考折叠、工具调用卡（输入中/运行中/成功/失败四态）、系统分隔线。
- 权限：全局三档（`always-ask`/`write`/`yolo`）+ 会话级覆盖；工具执行前内联审批卡（允许一次 / 总是允许本会话 / 拒绝）。
- 切换：模型选择器（搜索 + provider 分组 + 角标）/ 思考档选择器（按模型可用档过滤，不支持档禁提交）。
- 设置页占位：只读展示 `config path`，零写入。
- 联调工具：`scripts/fake-omp.mjs`（canned RPC 事件，覆盖审批双分支）。

### 已知限制

- 首发 macOS arm64；Windows / Linux 打包延后。
- `confirm`/`input` 类 UI 请求走通用确认框兜底，未逐类精做。
- v2 大帧 `rpc_chunk` 重组已实现但缺少大流量实测。
- 同一会话被 omp TUI 与本 app 双开时仅文档警告，未做文件锁检测。
