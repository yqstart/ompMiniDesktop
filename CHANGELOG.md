# 更新日志

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循语义化版本。

## [Unreleased]

### 新增

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
