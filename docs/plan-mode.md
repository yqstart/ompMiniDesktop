# 计划模式（omp plan mode）能力边界与落地方案

> 日期：2026-10-20。结论基于 omp **18.12.3** 实机探测（`--mode rpc` / `rpc-ui`）与二进制命令表核对。
> 回答的问题：**壳侧能不能实现「计划模式」？** 结论：**启动级可以，运行中切换与交互式审批不可以。**

## 结论

| 能力 | 是否可行 | 依据 |
|---|---|---|
| 新会话以计划模式启动（只读规划 → 自动批准 → 执行） | **可以** | `--plan-yolo` 在 rpc 模式实测完整跑通 |
| 运行中进入 / 退出 / 暂停计划模式 | **不可以** | rpc 命令表 115 条无 plan 相关命令；候选命令全部 `Unknown command` |
| 用户批准 / 拒绝计划（交互式审批） | **不可以** | 无对应 RPC；`--plan-yolo` 是自动批准 |
| 从状态面读「当前是否计划模式」 | **不可以** | `get_state` 无 `planMode` 字段 |
| 壳侧识别计划模式的痕迹 | **可以（推断）** | `customType:"plan-mode-context"` 的 custom 消息、`write local://…-plan.md` / `write xd://propose` 工具调用 |

一句话：**omp 的计划模式是真的，但它的控制面在 TUI / 启动参数，不在 rpc-ui 的 RPC 里。**

## 实测证据

### 1. 上游能力存在

`omp --help`（18.12.3）：

- `--plan=<value>`：架构规划用的 plan 模型（`PI_PLAN_MODEL`）。
- `--plan-yolo`：启动即强制只读计划模式，模型首次 resolve 时自动批准计划，然后切到 `--plan-yolo-into` 执行。
- `--goal cannot be combined with --plan-yolo or --no-tools.`（二进制内校验文案）——计划模式与目标模式互斥。

`omp config list --json`：

| 键 | 默认 | 说明 |
|---|---|---|
| `plan.enabled` | **true** | 启用计划模式（只读探索 + 规划） |
| `plan.defaultOnStartup` | false | 每个新会话自动进入计划模式 |
| `plan.autosave` | false | 计划批准后自动落盘 |
| `plan.autosaveDir` | 空 | 自动保存目录（默认 `<project>/.omp/plans/`） |

二进制内还有完整的 TUI 侧实现：`getPlanModeState` / `setPlanModeState` / `handlePlanModeCommand`、`"Toggle plan mode (agent plans before executing)"`、`"Plan mode enabled. Plan file: "`、`"Exit plan mode?"`、`" to submit the plan for approval. Valid only while plan mode is active."`。

### 2. RPC 命令面没有计划模式

从 `omp` 二进制的 RPC dispatch（`case "<command>":`）提取出 115 条命令，**没有** plan / plan-mode 相关项。实测候选命令：

```
set_plan_mode   => Unknown command: set_plan_mode
plan_mode       => Unknown command: plan_mode
enter_plan_mode => Unknown command: enter_plan_mode
get_plan_mode   => Unknown command: get_plan_mode
plan            => Unknown command: plan
```

`get_state` 的键（实测）：`model, thinkingLevel, isStreaming, isCompacting, steeringMode, followUpMode, interruptMode, sessionId, autoCompactionEnabled, queuedMessageCount, hasPendingAsyncWork, isSettled, queuedMessages, todoPhases, fastModeEnabled, tokensPerSecond, fastModeActive, slowModeSupported, slowModeEnabled, messageCount, systemPrompt, dumpTools, contextUsage, goal`——**无 planMode**。

`rpc-ui` 的 `get_available_commands`（实测 60 条）**不含 `/plan`**（也不含 goal）；`model` / `modelpreset` 是名称里带 `model` 的误匹配。

### 3. `--plan-yolo` 在 rpc 模式下的实际帧序

探测条件：`omp --mode rpc --no-session --plan-yolo --cwd /tmp/omp-plan-probe`，prompt 要求「只读检查 + 给出计划，不要真的执行」。关键帧：

1. `message_start role=user` → assistant 调 `read .` / `read seed.txt`（只读）；
2. assistant 调 `bash "wc -c -l seed.txt; od -c seed.txt"`（只读）；
3. assistant 调 `write {path:"local://seed-summary-plan.md", content:"# seed.txt 摘要计划…"}`——**计划文件走 `local://`，不碰工作区**；
4. assistant 调 `write {path:"xd://propose", content:"…"}`——提交计划；
5. `notice`：`Plan-yolo: plan approved, switched to commandcode/deepseek/deepseek-v4.1-flash-fast to implement "seed-summary-seedtxt".`（source `plan-yolo`）；
6. 切执行模型继续 `bash` / `read`，最后 `agent_end` / `session_settled`。

**没有任何审批帧**——`plan-yolo` 的批准是自动的；壳侧只能旁观。

### 4. 计划模式的上下文消息

`agent_end` 的 `messages` 里能看到：

```json
{"role":"custom","customType":"plan-mode-context","content":"<critical>\nPlan mode active.\n- Working tree/system read-only: NEVER create, edit, delete, or rename working-tree files; …"}
```

壳侧 `lib/viewmsg.ts` 目前对 custom 只认 `tool_execution_start` / `tool_execution_end`，其余 customType（含 `plan-mode-context`）丢弃——所以现在界面上看不到「计划模式」状态，只能从 `write local://…-plan.md` 工具行推断。

### 5. `plan.defaultOnStartup` 不是可靠入口

用 `--config` overlay（`plan:\n  defaultOnStartup: true`）在 rpc 模式复跑同样的 prompt：**没有** `plan-mode-context` custom 消息、**没有** `local://…-plan.md` / `xd://propose`、也没有审批帧——agent 按普通轮次读了目录并直接输出计划文本。

结论：`plan.defaultOnStartup` 在 rpc 模式下**至少没有可观察到的效果**（也可能 overlay 未被该启动路径命中）。**落地只能用 `--plan-yolo`**，不要依赖 `plan.defaultOnStartup`。

## 可行方案

### 方案 A（已实施，2026-10-20）：新会话以计划模式启动

- **后端**：`SpawnOpts` 增加 `plan_yolo: bool`，`create_session` 接受 `plan: Option<bool>`，spawn 时传 `--plan-yolo`（必要时 `--plan-yolo-into=<模型>`）。**不要**用 `plan.defaultOnStartup`（rpc 下未观察到效果，见上）。降级重试保留 plan；resume / 重启一律 `plan_yolo: false`。
- **计划阶段模型 = `modelRoles.plan`**（2026-10-20 补）：omp 的 TUI 进入计划模式会把活动模型切到 `plan` 角色，但 rpc-ui 的 `--plan-yolo` 启动路径不会自己做这一步。壳侧在 spawn 前读项目 cwd 的有效 `modelRoles.plan`：配置了就用 `--model @plan`（角色 selector 的 `:档位` 后缀交给 omp 解析），**不传**项目 `last_model` / `last_thinking`；没配置时沿用项目偏好。批准后仍由 omp 的 `--plan-yolo-into` 默认切到 `smol` 角色（未配置时 omp 按默认档兜底）。
- **入口（2026-10-20 修订）**：工具行 `+` 旁的「计划」chip **常驻**（不再随空态消失）。
  - **空态**（没有活动会话）= 切换下一次新建会话的开关：空态第一条消息 = `createChatIn(dir, { plan: true })` → 新建 `--plan-yolo` 会话 → 发送 → 开关复位（一次性）；点项目选择器同样带着开关新建（`ProjectPicker` → `startChatInProject({ plan })`）。
  - **有会话**（2026-10-20 修订）：若当前会话**完全空**（无对话内容 / 无草稿 / 无附件 / 未运行）→ 直接**开 / 关**计划模式：`runSessionBatch("delete",[sid])` 删掉这个没有 jsonl 的空会话，再用同一目录 `createChatIn(cwd, { plan: !active })` 新建（已计划就换回普通会话；只换 id，不给用户留两个空会话）。否则打开 `composer/PlanStartDialog.tsx`：未计划 = 说明「运行中不能切换」+ 「用当前目录新建计划会话」；已计划 = 「计划模式（已启用），运行中无法关闭」+ 「新建普通会话」。计划会话在 `store.planSessions` 本地标记，工具行 chip 显示 accent（`get_state` 不返回 planMode）。
  - 已打开的会话不能切——运行中没有 RPC，重启 resume 的语义也不是「继续当前任务」。
- **展示（已做）**：
  - `write` 的 `path` 以 `local://` 且以 `-plan.md` 结尾 → 工具行标成「计划」（`lib/toolLine.ts` 的 `toolVerbPlan`）。
- **展示（未做，可选）**：`write` 的 `path === "xd://propose"` 标成「提交计划」；`customType:"plan-mode-context"` 渲染成一条 `divider:"reminder"` 紧凑行「计划模式：只读规划」。
- **代价**：自动批准，没有人工确认；计划阶段用 `plan` 角色（未配置则项目偏好），执行阶段默认 smol 角色（可用 `--plan-yolo-into` 指定），与用户偏好模型可能不同。
- **风险**：`--plan-yolo` 与 `--goal` 互斥（`create_session` 目前不带 `--goal`，不冲突）；计划文件在 omp 的 `local://` 存储里，壳侧无法直接打开，只能从工具参数读全文。

### 方案 B（不推荐、未实施）：壳侧提示词计划

原设想由工具行「计划」chip 发送一条「只读分析 → 输出计划」的结构化提示，用户确认后再发「执行」。**没有 omp 的只读强制**，模型可能越界写文件；配合 `always-ask` 也只能在写入审批时兜底。属于「看起来像计划模式」的壳侧约定，与项目「不塞假命令」的口径冲突，已否决。

### 方案 C（后续）：omp 扩展桥

扩展 API 有 `session.getPlanModeState()` / `setPlanModeState()`（二进制里可见），但**扩展能否注册 RPC 命令、能否桥接计划审批未验证**。成本高，且 rpc-ui 的扩展宿主行为需要单独实测，暂不作为首选。

## 当前决定（2026-10-20 已落地）

- **入口 = 工具行常驻的「计划」chip**（用户口径）：空态（没有活动会话）点击 = 切换下一次新建会话的计划开关，空态第一条消息 = 新建 `--plan-yolo` 会话再发送，成功后复位；有会话时若当前会话完全空（无内容 / 无草稿 / 未运行）→ 直接开 / 关（删掉空会话、同目录重建），否则打开 `PlanStartDialog` 说明「运行中不能切换」并给出新建计划 / 普通会话的动作。**`+` / `/` 面板里没有「计划」项**（入口只在工具行）。
- **实现落点**：
  - 后端：`runtime.rs` 的 `SpawnOpts.plan_yolo` / `SpawnOpts::args`；`commands/mod.rs` 的 `spawn_new`、`create_session(plan: Option<bool>)`、`create_session_in(..., plan)`。
  - 前端：`shared/api.ts` 的 `createSession(cwd, plan?)`；`lib/sessionOpen.ts` 的 `createChatIn(..., { plan })`；`stores/app.ts` 的 `planModeNext` / `setPlanModeNext`；`composer/Composer.tsx` 的空态草稿键 `NEW_DRAFT = "__new__"`、`sendFirstInNewChat`、`sendTextTo`、常驻「计划」入口；`composer/PlanStartDialog.tsx`（有会话时的说明 + 新建计划会话）；`pickers/ProjectPicker.tsx` / `lib/projects.ts`（点项目也带 plan）；`lib/toolLine.ts` 的计划文件标记。
- **验证**：前端 `pnpm check`（typecheck / lint / 882 单测 / e2e:ipc）通过；Rust `cargo test` 296 通过（19 ignored，含 `spawn_args_use_rpc_ui_mode` 断言 `--plan-yolo` 落进参数）；空态开关关闭 / 打开两态截图；`--plan-yolo` 在 rpc 模式的只读规划 → 自动批准 → 执行帧序实测（见上）。**未在桌面壳内点完整条「空态 → 开关 → 新建 → 计划」链路**（需要真实 omp + UI 交互）。
- **仍未做**：交互式审批（需上游 RPC）、`xd://propose` / `plan-mode-context` 的额外标记、`plan.defaultOnStartup` 入口（不可靠）。
