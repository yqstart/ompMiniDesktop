# ompMiniDesktop V1 功能排期（可直接开工版）

> 基线：`docs/v1-design.md`（冻结稿）、`docs/rpc-memo.md`（Phase 0 实测）、`design-system/MASTER.md`（设计真相）
> 技术栈：Tauri v2 + React + TS + Tailwind v4 + Zustand，包管理 pnpm
> 范围：V1 只做最小单元——添加项目、移除项目、新建会话、归档会话、删除会话、切换模型、切换思考等级、agent 输出渲染、权限。设置只留入口。不做自动化、插件管理。

## 0. 目标与成功标准

**目标**：按冻结稿交付 V1 极简桌面壳，跑通「加项目 → 建会话 → 提问 → 流式输出 → 审批 → 切模型/思考档 → 归档/删除」全链路。设置只留入口。

**V1 成功标准（与设计稿 §1.2 对齐）**：用户不看文档走通全链路（含审批通过/拒绝双分支）；杀子进程后可恢复历史；无 omp 二进制时有引导横幅而非白屏；浅/深色 + 375px 窄窗无横向滚动；审批按钮键盘可达；`prefers-reduced-motion` 生效；同一会话 `omp render --plain` 对拍文本一致。

**非目标**：自动化/定时任务、插件/Skill/MCP/Hook 管理、主题市场、云同步、多窗口协作、PTY 终端仿真、diff 合并编辑器、用量统计。看到这些需求一律推迟到 V2，不在本排期内讨论实现。

## 1. 现状输入与技术约束

- 本仓现状：空仓，仅 `LICENSE` + `docs/v1-design.md` + `docs/rpc-memo.md` + `design-system/MASTER.md`。无 `package.json`、无 `src/`、无 `src-tauri/`。第一个里程碑必须搭脚手架。
- 协议现状（Phase 0 已实测）：`omp --mode rpc` 握手/prompt/审批（select 双分支）/切模型/切思考档/resume 回放全部走通。V1 后端只用最小命令集：`negotiate_protocol、get_state、prompt、abort、set_model、set_thinking_level、get_available_models、switch_session、get_messages_page、extension_ui_response、bash（诊断用）`。
- 工具链实测：node v22.23.1、npm 10.9.8、pnpm 11.22.0、rustc/cargo 1.97.1、`cargo-tauri` 可用。包管理选 **pnpm**（两边参照项目 OmpConfig、PrismCode 均用 pnpm）。
- 复用锚点（不另起炉灶）：PrismCode 的 `src-tauri/tauri.conf.json + Cargo.toml` 结构（含 `tauri-plugin-dialog/opener/store`、release profile）照抄裁剪；OmpConfig 的 `src/main/omp/locate.ts` 定位策略（登录 shell → which → 已知前缀 → 手动指定）与 `settings.ts` 的 `config set` 链路翻译为 Rust 实现；设计 token 以 `design-system/MASTER.md` 为准，组件名以其 §8 速查表为准，禁止同义重复组件。

## 2. 里程碑总览

| 里程碑 | 目标 | 依赖 | 估算（单人全职） | 产出门 |
|---|---|---|---|---|
| M0 脚手架与基线 | 可 `pnpm tauri dev` 跑起空壳，两栏空态 + 深浅色 + 自检横幅 | 无 | 2–3 天 | 空壳启动、自检探针、检查脚本可跑 |
| M1 项目/会话/历史 | 项目 CRUD + 会话列表/归档/删除 + 历史回放（无实时流） | M0 | 5–7 天 | 列表与 jsonl 真相对得上，归档/删除语义正确 |
| M2 实时会话核心 | 长驻 spawn + 流式渲染 + composer/停止 + 审批卡 | M1 | 7–10 天 | 提问→审批→总结全链路双分支走通 |
| M3 切换与打磨 | 模型/思考档/权限三档 + 状态条 + 虚拟化/快捷键/窄窗/动效 | M2 | 5–7 天 | 顶栏三选择器可用，设计稿 §13 DoD 全过 |
| M4 发布硬化（可并入 M3 尾） | 打包、诊断页、损坏容错、文档 | M2 起可并行准备，收尾在 M3 后 | 3–5 天 | mac arm64 dmg 可安装启动，README 写清安装/排障 |

总估算约 4–6 周单人全职。若双人并行：M1 与 M2 的 Rust 运行时可提前并行，但 M2 联调仍需等 M1 的列表与覆盖层接口冻结。

## 3. 分系统实施（按子系统分组，跨里程碑复用）

### 3.1 工程脚手架（M0）

- 初始化：pnpm + Vite + React + TS + Tailwind v4 + Zustand + vitest + eslint/prettier；`src-tauri/`（Tauri v2，identifier 如 `com.omnidesktop.mini`，productName `ompMiniDesktop`，devUrl 1420，frontendDist `../dist`）。
- Rust 依赖基线：`tauri / tauri-plugin-dialog / tauri-plugin-opener / tauri-plugin-store / serde + serde_json / tokio(process, io-util, sync) / walkdir / chrono`。release profile 照抄 PrismCode（opt-level 3、thin LTO）。
- 目录骨架：`src/{app,components/{sidebar,thread,composer,pickers},stores,lib/{rpc-types,viewmsg,models},styles}`；`src-tauri/src/{main.rs,lib.rs,commands/{omp,projects,sessions,runtime},overlay.rs,session_scan.rs}`；`scripts/fake-omp.mjs`（M1 起用）；`docs/` 维持设计稿 + 本排期。
- 基线 UI：两栏空态（无项目/无会话/归档只读横幅三态）+ 设置占位页 + omp 缺失横幅。深浅色、375px 抽屉、focus ring 一次做对，后面不再返工。

### 3.2 Rust 后端：定位、自检与覆盖层（M0–M1）

- omp 定位：翻译 OmpConfig `locate.ts`——登录 shell `command -v omp` → `which` → `/opt/homebrew/bin/omp、/usr/local/bin/omp、~/.local/bin/omp` → 手动指定（overlay 持久化）。启动自检 `omp --version` + `omp models --json` 探针，失败经 `omp-status://health` 推横幅。
- agentDir 解析：`omp config path` 成功取末行绝对路径，否则 `~/.omp/agent`，再被 `PI_CODING_AGENT_DIR` 覆盖。三者优先级在 `session_scan.rs` 写死并单测。
- 覆盖层 `overlay.json`（tauri-plugin-store，`$APPDATA/omp-mini/overlay.json`，schema 见 §4）：读写经 `overlay.rs` 串行化，原子写 + 版本字段校验；未知字段保留透传，`version != 1` 时备份后重置并 toast 提示。

### 3.3 项目与会话管理（M1）

- 会话扫描：递归扫 `sessions/**/*.jsonl`，只读每文件前 N 行取 `session` 行（`id/cwd/timestamp/title`）+ 尾部扫 `title_change` 最新值；按 `cwd` 真实路径前缀归属项目，不猜 slug；损坏文件标记 `corrupt` 不阻塞列表；超大目录分页/增量（先 500 文件上限 + 后台补全）。
- 项目命令：`add_project(path)` 校验存在可读、拒绝 `$HOME` 根、去重按规范化路径；`remove_project(id)` 仅解绑 + 级联清该项目会话的归档/备注/权限键并在确认框写清；目录缺失标 `missing`，禁新建、可重定位/移除/回放。
- 会话命令：`create_session`（不带 resume，开后用 `get_state` 的 sessionFile/sessionId 回填并选中）、`open_session`（已有子进程直接聚焦，否则 `--resume <id前缀> --cwd` + `switch_session` 兜底 + `get_messages_page` 回放）、`archive/unarchive`（只改覆盖层，流式中先停）、`delete_session`（二次确认：kill → 删 `<ts>_<id>.jsonl` 及同名前缀目录 → 清覆盖层键）。顶栏改名只写 `notes`，禁用 `set_session_name`。

### 3.4 实时运行时与事件管线（M2 核心，M1 预留接口）

- 进程表：`HashMap<SessionId, RunningChild>`；spawn 参数 `omp --mode rpc --cwd <dir> [--resume] [--model] [--thinking] [--approval-mode]`；stdin 按行写 JSONL（互斥写锁），stdout 按行解析 → 先过 `rpc_chunk` 分片重组器（V1 先实现透传 + 校验拒绝，M2 末补全重组）→ 按 `type` 分发为 `omp-event://<sessionId>`，状态机推 `omp-status://<sessionId>`（running/idle/awaiting-approval/error/exited）。
- 前端管线：事件 → `lib/viewmsg.ts` 归一为 `ViewMsg`（见 §4）→ 落 `eventsBySession`（history 与实时同一入口合并，按 `contentIndex` 追加，不每 token 建消息，30ms 节流刷）→ 组件渲染。`prompt` 只在 idle 可发，流式中 composer 仅允许停止（`abort`）；`agent_end(isTerminal!==false)` 为唯一完成信号。
- fake-omp：`scripts/fake-omp.mjs` 用 canned 事件（含 thinking/toolcall/审批 select/拒绝分支/切模型事件）驱动联调与自动化测试，M1 建、M2 作为验收主力，脱离真实 LLM 与网络。

### 3.5 消息渲染与 Composer（M2）

- 组件（严格用 MASTER §8 名）：`UserBubble、AssistantText、ThinkingFold、ToolCard、ApprovalCard、SystemDivider、Composer、StatusBar、ConfirmDialog`。Markdown 渲染 + 代码高亮 + skeleton 占位；toolResult 截断 2000 字 + 展开全文；失败红边；denied 明示「被用户拒绝」。
- ToolCard 四态：streaming/in-progress/done/failed；标题行永远一行（图标 + 工具名 + intent + 状态点）；参数摘要按工具定制（read→path+行号、bash→command、grep/glob→pattern+path、edit/write→path+行数、未知→JSON 首行截断）；默认折叠，失败/待审批自动展开一次（用户折叠后不再强展）。
- Composer：多行输入 + 发送/停止；Enter 发送、Shift+Enter 换行、Esc 停止；draft 按会话隔离常驻内存，发送前不落盘；等待审批时锁定 + 提示。

### 3.6 模型/思考档/权限/设置占位（M3）

- 模型：`get_models/refresh_models`（`omp models --json` 缓存 5 分钟）+ `set_model{provider,modelId}`；选择器搜索 + provider 分组 + context/thinking/images 角标；成功收 `model_changed` 插分隔线并更新 `lastModel`；失败内联错误不闪切。
- 思考档：全集 `off/minimal/low/medium/high/xhigh/max/auto`，可用集取模型 `thinking`（null 仅 off）；`set_thinking` + `thinking_level_changed` 分隔线；不支持档 disabled + tooltip，禁止先发再报错。
- 权限：全局 `get/set_global_approval` 走 `omp config list --json` 读 + `omp config set tools.approvalMode` 写；会话 `set_session_approval` 存覆盖层并在下次 spawn 以 `--approval-mode` 传入；「总是允许（本会话）」实现为会话级 yolo 意向，不伪装逐工具 API。ApprovalCard 三按钮：允许一次（`value:"Approve"`）/ 总是允许本会话（Approve + 写覆盖层）/ 拒绝（`cancelled:true`）。
- 设置页：纯占位文案 + 只读 `config path` + 复制按钮，零写入。诊断信息（omp 路径/版本/agentDir/自检错误）并入此页或启动横幅。

## 4. 公共 API、Schema、数据流（冻结口径，实现照此）

**Tauri commands（V1 全集，M1/M2/M3 分批交付）**：`locate_omp、get_models、refresh_models、list_projects、add_project、remove_project、relocate_project、list_sessions、create_session、open_session、archive_session、unarchive_session、delete_session、rename_session_note、send_message、stop、approve、set_model、set_thinking、get_global_approval、set_global_approval、set_session_approval`。失败统一 `{ok:false, code, message, hint?}`，message 面向用户中文，hint 给修复动作。

**前端事件**：`omp-event://<sessionId>`（ViewMsg 载荷）、`omp-status://<sessionId>`（`running|idle|awaiting-approval|error|exited + detail`）、`omp-status://health`（自检）。未知 `type` 事件透传 `unknown` 进日志不崩溃。

**overlay.json v1**：`{version:1, projects:[{id,path,addedAt,lastModel,lastThinking}], archived:{sid:true}, notes:{sid:string}, sessionApproval:{sid:enum}, ompPath?:string}`。键全用 `session.id`（uuid），不用文件名前缀。

**ViewMsg（`src/lib/viewmsg.ts`）**：`UserMsg{text,mentions[]} | AssistantText{id,seq,text,complete} | Thinking{id,text,seconds,complete} | ToolCard{id,toolCallId,name,intent,argsSummary,state:streaming|running|ok|error,outputTruncated,outputFull?,streamIndex} | Approval{id,uiId,toolName,command,cwd,title} | Divider{kind:model|thinking|title|exit|turn,text}`。RPC `message_update` 三类 delta 与 jsonl 文件块在此统一。

**数据流**：omp 子进程 stdout → Rust 行解析/分片 → emit 事件 → 前端归一 ViewMsg → store → 虚拟化渲染；`get_messages_page` 历史与实时流同一归一入口，先历史后增量，`messageCount` 对不上时以后端 `switch_session` 重拉为准。

## 5. 里程碑任务明细与验收

### M0 脚手架（M0-1～M0-6）

- M0-1 初始化 pnpm/Vite/React/TS/Tailwind v4/Zustand/vitest Baseline，`tauri dev/build` 双通。
- M0-2 深浅色 + 两栏骨架 + 三空态 + 设置占位页 + 375px 抽屉。
- M0-3 `locate_omp` + 健康自检横幅（无 omp 时可截图验收）。
- M0-4 overlay 读写 + 通道常量（`src/shared/ipc.ts` 风格）+ stores 空架。
- M0-5 检查脚本：`typecheck、test、e2e:ipc`（fake-omp 占位）。
- M0 验收：全新检出 `pnpm i && pnpm tauri dev` 5 分钟内见空壳；删 omp 模拟（改 PATH）见引导横幅；`prefers-reduced-motion` 无动画。

### M1 项目/会话/历史（M1-1～M1-7）

- M1-1 session 扫描 + cwd 归组 + 损坏标记（含单测：正常/缺 title/损坏/超大）。
- M1-2 项目三命令 + 缺失态 + 重定位。
- M1-3 会话五命令（建/开/归档/取消/删除）+ 删除双删（文件 + 同名前缀目录）+ 流式中先停。
- M1-4 历史回放：`switch_session + get_messages_page` 经 fake-omp（含分页 `nextCursor` 预留），与 `render --plain` 对拍一致。
- M1-5 左栏全交互 + 标题规则（notes > title_change > session.title > 未命名+日期）。
- M1-6 空态/确认框/Toast 文案按 MASTER §6 定稿。
- M1 验收：用真实 `~/.omp` 目录截图——项目会话数正确；归档折叠计数正确；删除后文件与目录双清；损坏会话可删且不卡列表。

### M2 实时核心（M2-1～M2-7）

- M2-1 spawn/握手（ready → negotiate v2 → get_state）+ 进程表 + stdin 关闭重建。
- M2-2 prompt/abort + `agent_end` 完成判定 + 流式中禁发（仅停）。
- M2-3 三类 delta 归一 + AssistantText/ThinkingFold 流式（含 30ms 节流、partial 覆盖容错）。
- M2-4 ToolCard 四态 + 参数摘要 + toolResult 关联/截断/失败红边。
- M2-5 审批卡：select 接管、composer 锁定、滚动置顶、键盘可达；拒绝分支渲染「被用户拒绝」且 turn 正常结束。
- M2-6 composer/draft/快捷键（Enter/Shift+Enter/Esc）+ 停止。
- M2-7 fake-omp 全链路自动化（通过/拒绝/多工具并行/中断）。
- M2 验收：全链路双分支走通；kill -9 子进程重开恢复历史；`confirm` 外的未知 UI 请求不崩（通用确认框兜底）。

### M3 切换与打磨（M3-1～M3-7）

- M3-1 ModelPicker（搜索/分组/角标/高亮/手动刷新）+ 会中切换分隔线。
- M3-2 ThinkingPicker（过滤/置灰/tooltip/禁提交）。
- M3-3 权限三档 + 会话覆盖 + yolo 红警告。
- M3-4 StatusBar（token/上下文%/耗时/TTFT，纯透传不自算）。
- M3-5 虚拟化 + 首屏 200 条增量 + 代码块横滚不撑破。
- M3-6 快捷键/焦点/aria/对比度扫一遍；`confirm/input` 类 UI 通用框补齐。
- M3-7 设置占位定稿 + 诊断信息。
- M3 验收：设计稿 §13 DoD 全过（逐项打勾，窄窗/深浅色截图留档）。

### M4 发布硬化（可与 M3-5 起并行）

- mac arm64 dmg 打包签名（`-` 自签起步）、icon、updater 预留位（先关）。
- README：安装、omp 版本要求（18.x 验证）、排障（PATH、权限、目录缺失、协议漂移）。
- 协议漂移 guard：记录 `--version`，未知命令/事件只告警不崩。

## 6. 边界与失败模式（实现时逐项有归属）

omp 缺失/版本旧→M0 横幅；目录缺失→M1 缺失态；jsonl 损坏/超大→M1 标记 + M3 虚拟化；双开会话→M3 只读提示（M1 先文档警告）；删/归档流式中→先 abort/kill（M1）；不支持思考档→禁提交（M3）；stdin 关闭→重建（M2）；未知事件/无 id 回包→忽略+日志（M2）；overlay 版本漂移→备份重置（M0）。

## 7. 测试策略（每个里程碑的 Done 必须含）

- 单测（vitest + cargo test）：slug 无关的 cwd 归组、标题规则、档位过滤、overlay 迁移、行解析/分片校验、ViewMsg 归一（含 toolCallId 关联）。
- 集成：fake-omp 驱动 spawn→事件→审批→切模型全链路；`omp render --plain` 对拍文本一致性。
- 手工：§0 成功标准 + 设计稿 §13 DoD；双分支审批、kill -9 恢复、无 omp 引导、375px、深浅色、键盘全程操作各一遍。
- 禁止事项：不用轮询文件做伪实时；前端不自算 token；不写回 omp 标题；设置页零写入。

## 8. 风险与假设（显式）

- 风险 1：上游 RPC 漂移（fork/版本差）——缓解：negotiate + version 记录 + 未知帧容错（M2/M4）。
- 风险 2：v2 大帧 `rpc_chunk` 未实测——缓解：解析层先校验拒绝 + 预留重组接口，`get_messages_page` 防大帧（M2）。
- 风险 3：`confirm/input/editor` 字段未探全——缓解：V1 只精做审批 select，其余通用框（M2→M3）。
- 假设：单机单用户；`PI_CODING_AGENT_DIR` 覆盖路径；标题以 `title_change` 为准；token/耗时以后端透传为准；首发 mac arm64，Win/Linux 打包延后；omp 18.x。
