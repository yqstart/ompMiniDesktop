# ompMiniDesktop 二期（V2）功能排期

> 基线：V1 已交付（`0.1.0` + Unreleased 硬化，见 `CHANGELOG.md`）；本文只排二期，不重开 V1 已冻结的口径。
> 范围来源：① V1 文档里**显式**标「留 V2 / Phase 2 补」的事项；② 从 omp `18.1.22` 内嵌源码实测到、V1 未接的上游协议能力。
> 约束不变：真相在 omp/jsonl；覆盖层只有 `overlay.json`；不用轮询文件做伪实时；前端不自算 token；不写 omp 配置。

## 0. 范围与口径

二期只做两件事：**把 V1 承诺过的坑填平**、**把上游已经给的能力接上**。不引入新架构（仍是 Tauri v2 + React + Zustand + 单一覆盖层）。

**仍不做（要做得单独决策，不在本排期默认范围内）**：插件 / Skill / MCP / Hook 管理面板、主题市场、云同步、多窗口协作、PTY 终端仿真、diff 合并编辑器、用量统计报表（V1 非目标清单原样保留）。

> 范围假设：用户若另有二期清单（例如点名要插件管理或云同步），以用户口径为准，本文件随后改写。

## 1. 里程碑总览

| 里程碑 | 目标 | 来源 | 状态 |
|---|---|---|---|
| M5 通用 UI 请求 | `extension_ui_request` 全方法正确处理：`confirm` / `input` / `editor` / 非审批 `select` 回包语义正确、服务端 `cancel` 能撤回卡片、`notify` 可见、单向方法不误判为审批 | `docs/rpc-memo.md` §6-2「Phase 2 补」 | 已完成 |
| M6 图片与 @文件 | `prompt.images` 透传（粘贴 / 拖拽 / 选择文件），用户气泡缩略图；`@文件` 文本芯片与路径补全 | `docs/v1-design.md` §8.4「images 透传是 Phase 2 事项」 | 已完成 |
| M7 会话发现与规模 | 扫描分页（>500 个 jsonl 不再截断）；左栏搜索覆盖会话内容 | `docs/v1-schedule.md` §3.3「分页/后台补全留 V2」 | 已完成 |
| M8 长会话渲染 | windowing 级虚拟化复议（>2000 条上限） | `docs/v1-schedule.md` M3-5「留 V2 复议」 | 已完成（结论：不做虚拟列表） |
| M9 消息操作与导出 | 「复制会话为 Markdown」+ 消息级复制（已完成）；重发 / 导出 .md 文件（候选，需用户确认） | 二期新增 | 已完成（候选另议） |
| M10 竞品对标补齐 | P0 四项正确性修复 + 排队/转向 + 压缩 + 分支 + `/` 命令补全 + `@` 补全 + 计划卡 + 路径点击 + 系统通知 + 草稿持久化 | 评审建议 | 已完成 |

## 2. 上游协议事实（M5 / M6 的实现依据）

以下均取自本机 omp `18.1.22` 二进制内嵌源码（`strings` + 定位 rpc 模式实现），不是推测：

**`extension_ui_request` 方法集与回包语义**

| 方法 | 请求字段 | 期望回包 | 说明 |
|---|---|---|---|
| `select` | `title, options[], optionDetails?` | `{value}` / `{cancelled:true}` | 审批复用同一条通道：`options` 含 `Approve` |
| `confirm` | `title, message, timeout?` | `{confirmed:boolean}` / `{cancelled:true, timedOut?}` | **不是** `{value:"Approve"}`（V1 回错了方法） |
| `input` | `title, placeholder, timeout?` | `{value:string}` / `{cancelled:true}` | 超时/取消回落 `undefined` |
| `editor` | `title, prefill, promptStyle?` | `{value:string}` / `{cancelled:true}` | 多行编辑 |
| `notify` | `message, notifyType` | 无需回包 | 单向提示 |
| `setStatus` / `setWidget` / `setTitle` / `set_editor_text` | 各自字段 | 无需回包 | 单向；**不得**触发「等待审批」状态 |
| `cancel` | `targetId` | 无需回包 | 服务端发起：请求已被 abort/超时，卡片应撤回 |

**`prompt` 帧支持图片**：`{type:"prompt", message, images?, streamingBehavior?}`；图片对象形如 `{type:"image", data:<base64>, mimeType:"image/png", detail?}`（与 jsonl 内 `image` 内容块同构）。`steer` / `follow_up` / `abort_and_prompt` 同样接受 `images`——二期只接 `prompt`。

## 3. M5 通用 UI 请求（已完成）

**问题**：V1 只精做审批 `select`，其余一律塞进通用确认框且**回包用审批格式**——`confirm` 回 `{value:"Approve"}`（omp 期待 `{confirmed}`），`input` / `editor` 直接不渲染。真实后果是 agent 侧等一个永远不来的回包。

**做法**

- 后端新增 `respond_ui(id, uiId, kind, value?, confirmed?)`：`kind ∈ value | confirm | cancel`，与 `approve` 分工明确（`approve` 仍管审批决策 + 会话级 yolo 意向）。
- `runtime.rs` 判定「等待用户输入」的方法集改为 `select | confirm | input | editor`；`notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text` 不再进该状态。
- 前端新增 `ViewMsg` 两型：`ui`（交互请求）与 `ui-cancel`（撤回）；`mergeViewMsgs` 按 `uiId` 原位合并、收到 `ui-cancel` 删除卡片。
- 新组件 `UiRequestCard`（MASTER §8 登记）：confirm 双按钮 / input 单行 + Enter 提交 / editor 多行 + Cmd+Enter 提交 / 非审批 select 选项按钮；统一带「取消」（回 `{cancelled:true}`），等待中 composer 仍锁定。
- `notify` 渲染为 `SystemDivider`（不打断、不占交互位）。

**验收（已通过）**

- `pnpm e2e:rpc` 新增 `ui` 场景：fake-omp 依次发 `confirm → input → editor → select( + cancel)`，脚本按方法回包并断言 fake-omp 收到的回包语义正确（含 cancel 后卡片不再等待）。
- vitest：`frameToViewMsgs` 对四类方法 + `cancel` + 单向方法的映射断言；`mergeViewMsgs` 去重与撤回断言。

## 4. M6 图片与 @文件（已完成）

**图片**

- composer 三条入口：粘贴（`onPaste`）、拖拽（`onDrop`）、点回形针（`dialog.open` → 后端 `read_image_file` 读文件转 base64）；三条都做类型 / 体积校验（PNG/JPEG/WebP/GIF，单张 ≤ 10MB），不合法给中文内联提示。
- 发送：`prompt{message, images:[{type:"image", data:<base64>, mimeType}]}`，字段口径取自 omp 内嵌源码（`RpcClient.prompt(message, images)`）；**不发空数组**，应用不落盘、不写覆盖层。
- 渲染：用户气泡内缩略图（`data:` URL，本地显示）；渲染只认消息内容块里的 `type:"image"`（实时帧与 jsonl 同构，兼容 anthropic 风格 `source.data` / `media_type`）。
- 内存保护：历史回放里单张 base64 > 512KB 的块省略并以「N 张图片因体积过大未在回放中展开」提示，不做无上限常驻。
- 交互提示：模型目录 `input` 不含 `image` 时给内联 warn（目录未加载不做判断，不误报）。

**`@文件` 提及**

- 关键事实（omp 内嵌源码实测）：**展开是 omp 自己在 prompt 路径里做的**——`extractFileMentions(text)` 抽出 `@路径`，`_Rs()` 把命中的文件读成 `{role:"fileMention", files:[{path, content, lineCount, byteSize?, skippedReason?}]}` 消息塞进本轮上下文。所以壳侧**不自己读文件**，只做两件事：
  1. 输入框把草稿里的提及显示成芯片，并用后端 `check_paths`（只 stat、相对会话 cwd 词法归一）标出「路径不存在」——omp 对不存在的路径是静默跳过，不提示就会以为读进去了；
  2. 转录区把 `fileMention` 渲染成一排文件芯片（`MentionChips`），`skippedReason`（binary / tooLarge）走 warn 色。
- 解析规则与上游逐条对齐（`src/lib/mentions.ts` + 单测）：引号形式 `@"a b.md"`、`@` 必须在行首或紧跟 `空白([{<"'`、ASCII 首尾修剪（全角标点不在规则内，刻意保持一致——**规则漂移会让芯片与真正读进上下文的文件对不上**）。

## 5. M7 / M8（后续）

**M7 扫描分页（已完成）**

- `list_sessions` 改为返回 `{sessions, totalFiles, scannedFiles}`：`totalFiles` = sessions 目录下 jsonl 总数，`scannedFiles` = 本次真正解析头部的文件数；`limit` 默认 500、夹在 1..=5000，另接受 `offset`（窗口按 mtime 倒序切片）。
- 前端 `/lib/sessionList.ts` 的 `loadSessions()` 是唯一落库入口（会话数组 + 扫描统计一起更新）；`totalFiles > scannedFiles` 时左栏底部给「已扫描最近 N 个（共 M 个）· 继续扫描更早的 500 个」，上限 5000。
- 口径：窗口外不是"不存在"，是**没解析**——所以提示文案与按钮都按"已扫描"表述，不说"没有更多"。

**M7 搜索（已完成）**

- 后端 `search_sessions(query)`：**只搜 `message` 行里 user / assistant 的 text 块**——工具输出、thinking、JSON 字段名都不进搜索面（否则搜 "user" 会命中每一行）。逐行读取，四道预算：命中数（默认 30，夹 1..=200）/ 文件数（1000）/ 总字节（96MB）/ 墙钟时间（1.5s）；单文件 8MB 上限。任何一道到点即停并把 `truncated` 置 true。
- 命中返回 `{id, title, timestamp, snippet, hits, archived}`：`snippet` 是首个命中前后各 60 字的单行片段（按**字符**切，中文不截半），`hits` 是该会话正文里的命中次数。
- 前端：输入 ≥2 字才搜（单字命中面太大），300ms 防抖；「N 个标题匹配」下方另起「内容命中 N 个会话」区，每行 = 标题 + 归档角标 + 命中次数 + 片段（`highlightParts` 高亮**全部**命中），点击直接打开该会话；`truncated` 时明写「已到预算上限，结果可能不全」。
- 命中的会话可能落在扫描窗口外：`openSessionWithHistory` 打开后若发现它不在列表里，会把后端返回的会话行补进列表，避免顶栏显示「未命名会话」。

**M8 长会话 windowing：已测量，结论是不做虚拟列表（已完成）**

先量后做，测量夹具落在 `src/lib/historyScale.test.ts`（`OMP_BENCH=1` 才跑，默认跳过以免 CI 依赖本机数据），
在本机真实 agentDir（69 个会话）上取的数：

| 指标 | 实测 |
|---|---|
| 最大会话 | 8.1MB / 1867 行 / 1414 message + 740 custom |
| 超过 2000 条（message+custom）的会话 | 1 / 69 |
| 超过 500 条的会话 | 13 / 69 |
| 后端口径（5000 行、2000 条）下归一成本 | 1411 块 → 698 条 ViewMsg，**2–4ms** |
| 该会话 ViewMsg 分布 | tool 488 / thinking 201 / text 6 / user 1 |

结论：**瓶颈不在数据层，也不在"条数"本身**——真实长会话是工具卡密集（488 张卡）而不是文本密集，
而归一只花几毫秒。真正会浪费的是渲染：流式每个 delta 都会更新 store，若整列跟着重渲染，
展开到几百上千条时每次 token 都要重算所有 Markdown / 工具卡。

所以 M8 的落地不是虚拟列表，而是：

- `Thread.tsx` 把单行渲染抽成 `memo` 化的 `ThreadRow`：`mergeViewMsgs` 对未变化的消息保持**同一对象引用**，
  浅比较即让"只有正在流式的那一行"重渲染（`src/lib/mergeEvents.test.ts` 补两条引用稳定性断言，防止这条前提被改坏）。
- 首屏仍是 200 条 + 按页展开（M3-5 已实现），不做 `content-visibility` 之类的 CSS 技巧（在长历史里会引起滚动条跳动）。

**复评阈值**（到达任一条件再回来做 windowing）：单个会话 > 5000 条消息、会话文件 > 30MB、
或展开后滚动/输入明显掉帧。到那时优先上虚拟列表，而不是继续加 memo。

## 6. M9 消息操作与导出（进行中）

**「复制会话为 Markdown」（已完成）**

- `TopBar` 新增复制按钮（`Copy`/`Check` 图标）：把**界面上已渲染的 `ViewMsg`** 经 `src/lib/exportMd.ts` 拼成 Markdown 写进剪贴板。
  不读盘、不落盘、不加后端命令——导出内容与用户看到的一致，这是最不容易骗人的口径。
- 语法取舍：用户消息 `**你**` / 助手 `**助手**`；思考包在 `<details><summary>思考 N 秒</summary>` 里（可折叠，不删也不喧宾夺主）；
  工具卡写 `**名字 · 意图 · 参数摘要**` + 状态 + 围栏输出，**沿界面口径截断并在截断处明写「已截断」**；
  内容里出现 ``` 时自动换更长的围栏；图片只写张数（不内联 base64，否则 8MB 会话能导出成几十 MB 的 md）；
  `@文件` 芯片写「读入上下文：a.ts（42 行）、b.bin（已跳过：tooLarge）」。7 项单测覆盖上述规则。
- 空会话/未选中会话时按钮禁用；复制成功给 1.5s 的 `Check` 反馈，失败不弹错（沿用内联静默降级风格）。

**「单条消息复制」（已完成）**

- 用户气泡与助手正文 hover 出「复制」小按钮（`Copy`/`Check`，1.2s 反馈）：复制**原文**（不是渲染后的 HTML 文本），
  助手正文只在 `complete` 后出现——流式中复制半截内容没有意义。
- 实现放在 `ThreadRow` 内部的独立 `CopyAction` 组件里（自带 copied 状态）：状态提到行上会让每次点击重渲染整列，破坏 M8 的行级 memo。

**仍未做（候选，需用户确认后再开工）**

- 单条「重发」：把用户消息灌回 composer。**直接替换草稿会吃掉用户正在写的内容**，要先定交互（输入框非空时是否追加/是否二次确认），不适合按猜测开工。
- 导出为 `.md` 文件：需要新增「写文件」后端命令（当前 34 个命令里没有任何写文件能力）+ 保存对话框，属于会落盘的能力，同样先确认再动。

## 7. 每批的完成口径

- `pnpm check`（typecheck + lint + test + e2e:ipc + e2e:rpc）全绿 + `cargo test` 全绿。
- 文档同步：本文件、`AGENTS.md` 源码结构与命令数、`docs/v1-schedule.md` §4 命令全集、`design-system/MASTER.md` §8 组件表、`CHANGELOG.md` Unreleased。

## 8. M10 竞品对标补齐（已完成）

来源：对照 Cursor Agent / ChatGPT 桌面端 / 上游 RPC 全量的评审建议（P0–P2）。

**P0 正确性（四项 bug）**

- 审批卡终态：`ApprovalCard` 回执后收起按钮、展示结论，不许重复点；失败内联错误可重试。
- 图文混贴：粘贴图片时同剪贴板文字一并填入草稿；非图片拖入/粘贴给中文提示。
- 用户消息去重：发送加乐观回显（`u-local-*`），失败回滚；`openSessionWithHistory` 按文本合并历史版本。
- 本地命令收敛：后端 `dispatch` 对 `prompt{agentInvoked:false}` / `prompt_result{agentInvoked:false}` 直接推 idle；前端 `command_output` 渲染为 `command` 卡。

**P1 上游协议接入**

- 排队/转向：`steer_message` / `follow_up_message`（`send_prompt` 统一组装）；Composer 流式中 Enter 排队、⌘/Ctrl+Enter 转向、工具行「排队」按钮；排队数徽标读 `queuedMessageCount` 真值。
- 压缩：`compact_session{customInstructions?}`；上下文 ≥80% 时工具行「压缩 N%」按钮；压缩/重试/子代理帧渲染分隔线。
- 分支：`branch_session{entryId}`（新会话身份随事件流推出，落盘后可 resume）。
- `/` 命令：`run_slash`（`/` 开头自动走本地命令）；`available_commands_update` 缓存进 `commandsBySession`，行首 `/` 补全（8 条上限、键盘导航完整）。
- `@` 补全：`complete_path{prefix}`（只读目录列举、前缀匹配、20 条上限、`..` 拒绝）；300ms 防抖；Tab/Enter 选中、Esc 关闭。
- 计划卡：`todoPhases` / `todo_reminder` 落成只读 `plan` 卡；`select` 的 `optionDetails` 展示为选项描述。

**P2 桌面本分**

- ToolCard 参数摘要、`@文件` 芯片点击用 `opener` 打开本地路径；助手外链二次确认后打开。
- 长任务完成/等审批且窗口不在前台时系统通知（`notification` 插件）。
- 草稿按会话持久化 localStorage（启动水合）。

**完成口径**：`pnpm typecheck + lint + e2e:ipc + e2e:rpc` 全绿 + `cargo test` 全绿（38 项）+ vitest 84/85（唯一失败是 `parity` 对拍：新会话的第二条长用户消息被上游 `render --plain` 折叠，`viewmsg.ts` 本轮未动，与改动无关）。`e2e:rpc` 新增排队/本地命令/压缩分支三组断言（各用独立 drive，6 次连跑稳定通过）。

## 9. M11 归档对话管理面（已完成）

**问题**：归档只做了一半——会话被标记归档后仍留在左栏项目分组里（一个折叠的「已归档（N）」小抽屉），
既没把老会话真正收起来，批量取消归档 / 清理也只能一个个点，且左栏的「删除全部对话」会把看不见的
归档会话一起删掉。用户口径：**左栏不该再出现已归档的对话，归档要有一个正经的管理面**。

**后端（2 个新命令）**

- `list_archived_sessions()`：归档清单。与 `list_sessions` 的关键差别是**不看扫描窗口**——归档的意义
  就是把老会话收起来，它们大概率落在 500 个窗口之外，被窗口截掉等于「归档即失踪」。实现上只遍历
  `sessions/<slug>/*.jsonl`，**只读路径里带归档 id 前缀的文件**（真实布局 `<时间戳>_<id>.jsonl`，与
  `session_file_for` 同一套约定），解析头后再用头里的 id 复核一次标记，按 `timestamp` 倒序返回。
  覆盖层里残留的失效 id（文件已删）自然落空，不冒空壳行。
- `unarchive_sessions(ids)`：批量恢复（摘覆盖层标记，幂等；单次上限 200，返回 `{ok, failed}` 与
  `archive_sessions` 同构）。逐个 `unarchive_session` 也能做，但那意味着 N 次落盘。

**前端**

- 左栏只列**进行中**的会话：删掉项目组与未归属组里的「已归档（N）」抽屉，分组头计数只算进行中，
  分组头批量（归档全部 / 删除全部 / 删除工作区）**一并收窄到进行中**——归档不在左栏可见，就不该在
  左栏被「删除全部对话」顺手删掉。`projects.ts` 的「切项目打开最近会话」此前已按 `!archived` 过滤。
- 设置页加**分页签**（`通用` / `已归档对话`，「返回」在两页签之外）；新组件 `ArchivedSessions`：
  按项目分组（未归属单独一组、目录缺失用 warn 色）列全部归档会话，分组级「恢复全部 / 删除全部」+
  行级「恢复 / 删除」，行标题可点开只读回放（归档会话的 composer 本来就锁着）。删除走既有
  `ConfirmDialog`；恢复/删除后同时刷新本页与左栏，恢复的会话立刻回到项目分组。
- 批量分档与失败聚合抽成 `src/lib/sessionBatch.ts`（`BATCH_LIMIT` = 200）：左栏分组头与设置页共用
  同一份，避免「一次上限」出现两个会漂移的副本。删除后的前端痕迹清理（`pruneDeletedSessions`）
  也收在这里。设置页文案进 `lib/locale.ts` 字典（中英同键，有单测守着）。

**完成口径**：`pnpm check` 全绿 + `cargo test` 全绿（40 项，新增 2 项：归档清单只列归档并回项目归属 /
失效 id 不冒空壳 + 倒序与未归属归类）+ `pnpm e2e:ipc` 覆盖到 42 个命令。浏览器实测（假 IPC 注入）：
左栏无归档抽屉、tracsys 组只剩「0 / 暂无进行中的会话」；归档页按三组列出、计数与日期正确；行级「恢复」
后该组从归档页消失、左栏项目计数 +1 并出现该会话；行级「删除」弹 ConfirmDialog（焦点默认「取消」）、
确认后计数回落。


**顺带修复：`parity` 对拍测试的确定性**

`src/lib/parity.test.ts` 原本拿**整份**会话文件跑 `omp render --plain`，再断言「每条用户消息
都出现在渲染输出里」。实测这条前提不成立：`omp render` 是**视口渲染**——拼一帧就 emit，
超长线程的后续内容根本不出现，且 emit 长度还随调用方进程的 TTY / 终端尺寸变化（同一份
1.9MiB 会话：Bun 直接 spawn 拿到 ~78 万字符且内容完整，vitest 经 Node `execFileSync` 只拿到
19 万字符、尾部用户消息缺席）。结果是这条测试在本机时红时绿——`pnpm check` 会因为「当前
会话刚好很长」而失败。改为**只对拍「会话头 + 前 40 条」这个切片**（样例也从同一份切片取），
三个用例连跑 3 次全绿。代价是不再比对被截掉的历史中段；真正的解析口径仍由 `viewmsg` 的
单测守着。

