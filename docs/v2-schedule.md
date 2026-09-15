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
| M6 图片与 @文件 | `prompt.images` 透传（粘贴 / 拖拽 / 选择文件），用户气泡缩略图；`@文件` 文本芯片与路径补全 | `docs/v1-design.md` §8.4「images 透传是 Phase 2 事项」 | 图片已完成，`@文件` 待做 |
| M7 会话发现与规模 | 扫描分页 / 后台补全（>500 个 jsonl 不再截断）；左栏搜索覆盖会话内容 | `docs/v1-schedule.md` §3.3「分页/后台补全留 V2」 | 待做 |
| M8 长会话渲染 | windowing 级虚拟化复议（>2000 条上限） | `docs/v1-schedule.md` M3-5「留 V2 复议」 | 待做 |
| M9 消息操作与导出 | 单条复制 / 重发、会话导出 Markdown（只读，不写 omp） | 二期新增（候选） | 候选 |

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

## 4. M6 图片与 @文件（图片已完成，`@文件` 待做）

**图片（已完成）**

- composer 三条入口：粘贴（`onPaste`）、拖拽（`onDrop`）、点回形针（`dialog.open` → 后端 `read_image_file` 读文件转 base64）；三条都做类型 / 体积校验（PNG/JPEG/WebP/GIF，单张 ≤ 10MB），不合法给中文内联提示。
- 发送：`prompt{message, images:[{type:"image", data:<base64>, mimeType}]}`，字段口径取自 omp 内嵌源码（`RpcClient.prompt(message, images)`）；**不发空数组**，应用不落盘、不写覆盖层。
- 渲染：用户气泡内缩略图（`data:` URL，本地显示）；渲染只认消息内容块里的 `type:"image"`（实时帧与 jsonl 同构，兼容 anthropic 风格 `source.data` / `media_type`）。
- 内存保护：历史回放里单张 base64 > 512KB 的块省略并以「N 张图片因体积过大未在回放中展开」提示，不做无上限常驻。
- 交互提示：模型目录 `input` 不含 `image` 时给内联 warn（目录未加载不做判断，不误报）。

**`@文件`（待做）**

- 输入框识别 `@path`，展开为芯片并按 MASTER §3 用 mono 显示；V2 只做**路径芯片 + 存在性提示**，不做全文内联。
- 消息里的 `fileMention` 角色消息（omp 自己写进 jsonl）在气泡里显示为文件芯片。

## 5. M7 / M8（后续）

- M7：`list_sessions` 分页参数（`cursor` / `limit`）+ 首屏只解析最近 N 个文件，其余后台补全；扫描超限时左栏给「已显示最近 500 个会话 · 继续加载」入口。左栏搜索从「标题/备注」扩到「命中内容片段」（读 jsonl 头尾之外的中段需按需读，禁止全量预读）。
- M8：先量后做——用真实长会话（>2000 条）测首屏与滚动帧率，再决定上不上 windowing；不达标才引入虚拟列表，避免为假想问题加复杂度。

## 6. 每批的完成口径

- `pnpm check`（typecheck + lint + test + e2e:ipc + e2e:rpc）全绿 + `cargo test` 全绿。
- 文档同步：本文件、`AGENTS.md` 源码结构与命令数、`docs/v1-schedule.md` §4 命令全集、`design-system/MASTER.md` §8 组件表、`CHANGELOG.md` Unreleased。
