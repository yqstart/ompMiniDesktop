# omp RPC 驱动协议备忘（Phase 0 spike 实测结论）

> 日期：2026-09-15 | omp 实测版本：18.1.22（`/opt/homebrew/bin/omp`）| 权威上游文档：[rpc.md](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/rpc.md)（fork `can1357/oh-my-pi`，主仓 `ldx/oh-my-pi` 同协议）
> 本备忘只记录**实测验证过**的结论，未实测的一律标注。V1 设计依据见 `docs/v1-design.md`。

## 0. 一句话结论

**长驻驱动协议完全走通，无需回退方案。** 后端 per-会话 spawn `omp --mode rpc`，stdin 写 JSONL 命令、stdout 读 JSONL 事件，即可覆盖 V1 全部需求：建会话、发消息、流式输出、审批拦截、中途切模型/思考档、历史回放。`--mode json` 不必用，`acp` 不必碰。

## 1. 启动与握手（已实测）

```bash
omp --mode rpc --cwd <项目目录> [--resume <sessionId前缀>] [--model <selector>] [--thinking <level>] [--approval-mode <always-ask|write|yolo>] [--no-session]
```

- 首帧必为 `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,...}`。
- 客户端应立即回 `{id,type:negotiate_protocol,protocolVersion:2}`（v2 大帧分片 `rpc_chunk`，TypeScript 有 `RpcFrameDecoder` 可抄；V1 消息小，可先按行解析 + 留好分片接口）。
- 其后固定跟 `extension_ui_request{method:setWidget}`（可忽略）+ `advisor_cost_changed` + `available_commands_update`。
- **帧序实测（omp 18.2.1，2026-09-16 复测）：这三帧到在 `negotiate_protocol` / `get_state` 的回包**之前**，即
  `ready → setWidget → advisor_cost_changed → available_commands_update → response(h-neg) → response(h-state)`。
  所以握手循环不能把「不是 h-state 回包」的行丢掉——早先正是如此，`available_commands_update` 从未抵达前端，
  `/` 补全一个候选都不弹、后端命令面缓存也一直是空的。现在握手期攒下的帧按原序回放，且**进程先登记进 runtime map 再回放**
  （回放要走 `update_meta` 写命令面缓存，快照里没这一条就白回）。
- `available_commands_update.commands[]` 形状：`{name, aliases?, description, input?:{hint?}, subcommands?:[{name, description, usage?}], source}`。
  本机实测 48 条（内置 + 技能命令）；`input.hint` 是**参数提示**（`/compact` → `[soft|remote|snapcompact] [focus]`），补全行要带上它才说得清参数怎么给。
- **内建斜杠命令分两类，RPC 只能驱动其中一类**（二进制里逐条命令的实现 + 真机逐条发 prompt 验证）：
  每个内建项都带 `handle`（ACP/RPC 用）与 `handleTui`（终端 TUI 用）两个实现，**只有 `handle` 的才能在 RPC 里跑**。
  - 两类都有（RPC 可驱动）：`fast` / `skillful` / `extended-context` / **`computer`** / **`advisor`** / `model` / `usage` / `stats` / `compact` / `todo` / `session` …（就是 `available_commands_update` 里那 48 条）。
  - **只有 `handleTui`（RPC 驱动不了）**：`plan` / `plan-review` / `goal` / `guided-goal` / `vibe` / `loop` / `queue` / `setup`。
    把 `/plan` 当普通 prompt 发出去**不会**触发命令，而是真的开一个 agent turn 把这段文字喂给模型（实测：`agent_start` + 工具调用全跑起来了）——所以壳侧**不能**靠发 `/plan` 来切计划模式，只能如实标为「仅 TUI」。
  - 计划 / 目标模式的状态也不在 `get_state` 里（`get_state` 只有 `fastModeEnabled/fastModeActive`、`autoCompactionEnabled`、`steeringMode/followUpMode/interruptMode`、`todoPhases` 等）。
    `goal` 连配置项都没有（`omp config list --json` 里没有 `goal.*`）；`plan` 有 `plan.enabled` / `plan.defaultOnStartup`，`computer` 有 `computer.enabled`，`advisor` 有 `advisor.enabled`。
- `computer` / `advisor` 的**状态只能从它们自己的输出里读**（`get_state` 没有这两个字段）：
  - `/computer status` → `Computer use: enabled · prelude: active · configured: display=all, maxWidth=3840, maxHeight=2400`
  - `/advisor status` → `Advisor is enabled (provider/model). Context: … Spend: …` / `Advisor is disabled.`
  - 开关自己的回执**不带状态**（`Computer use enabled for this session.` / `Advisor disabled.`），所以「切完」要再发一次 `status` 才能把状态确认下来。
- `command_output` 帧的正文在 **`text`** 字段（`{type:"command_output", text:"…"}`，实测 omp 18.2.1）。壳侧早期按 `output` 读，真实 omp 的命令输出整段被丢掉（只有 canned 脚本发的 `output` 能显示）；现在两个字段都认。
- `/` 命令的**执行**就是普通 `prompt`：`{type:"prompt", message:"/usage"}` → `command_output{text}` + `response{command:"prompt", success:true, data:{agentInvoked:false}}`，
  **没有 agent turn、不会有 `agent_end`**（壳据此把状态收敛回 idle，见 `is_local_prompt_result`）。
- `get_state` 返回：`model{provider,id,…} / thinkingLevel / isStreaming / sessionFile / sessionId / messageCount / contextUsage{tokens,contextWindow,percent}`。注意**没有 `sessionName`**（实测 `undefined`）——会话名显示走 jsonl 的 `title`，不要指望 state。
- 新建会话不传 `--resume` 即新建，`sessionFile` 形如 `~/.omp/agent/sessions/<slug>/<ts>_<uuid>.jsonl`；slug 如 `--private-tmp-omp-spike-test--`，**不要复刻 slug 算法**，列表按 `session.cwd` 前缀匹配归组。
- stdin 关闭 → 进程退出 code 0（优雅）。后端 kill 后重建即 `open_session`。

## 2. 发消息与流式事件（已实测）

- 发：`{id, type:prompt, message}` → 立即回 `{type:response, command:prompt, success:true}`（仅代表接受，**不代表做完**）。
- 完成信号：`agent_end` 且 `isTerminal !== false`。流式中再发必须带 `streamingBehavior: steer|followUp`，否则失败——V1 策略：流式中 composer 只允许「停止」，不排队（`abort` 即 `{"type":"abort"}`）。
- 事件线序（bash 场景实录）：`agent_start → turn_start → message_start(user) → message_end → message_start(assistant, thinking…) → message_update{thinking_start/delta…/end} → {toolcall_start/delta…/end} → message_end → tool_execution_start → extension_ui_request(select) → tool_execution_end → message_start(toolResult) → … → turn_end → turn_start → message_start(assistant text) → message_update{text_start/delta…} → … → agent_end`。
- `message_update.assistantMessageEvent` 三类 delta：`thinking_delta{delta}` / `toolcall_delta{delta}`（参数 JSON 字符串拼片）/ `text_delta{delta}`，各带 `contentIndex` + `partial`（当前完整块，可直接用 partial 覆盖渲染，容错率高）。
- `toolcall_end.toolCall = {id, name, arguments, partialArgs, streamIndex, intent?}`；`message_end.message` 即完整 assistant 块（含 `usage{input,output,cacheRead,cacheWrite,totalTokens,cost} / duration / ttft / responseId`）——状态条数据源。
- jsonl 文件是同一语义的落盘版：`message{role:user/assistant/toolResult/fileMention, content:[{type:text/thinking/toolCall}]}` + `custom{tool_execution_start…}` + `title/model_change/thinking_level_change/session_exit`。历史回放优先用 RPC `get_messages_page`（分页、防大帧），离线列表用扫文件读头。

## 3. 切模型 / 切思考档（已实测）

- 模型：`{type:set_model, provider, modelId}`（注意是两个字段，不是 selector 字符串；`provider:"commandcode", modelId:"claude-haiku-4-5-20251001"` 实测通过）→ `response{command:set_model, success, data:{…完整模型}}` + 独立事件 `{"type":"model_changed"}`（无多余字段）。
- 思考：`{type:set_thinking_level, level:"off"}` → response + `{"type":"thinking_level_changed","thinkingLevel":"off"}`。
- **档位合法性（2026-09 补测）**：合法档 = `model.thinking.efforts`，但 `off` **恒合法**（不在 efforts 内也生效，无思考模型亦可设）；`auto` 会落到具体档（实测 `auto`→`high`）、`minimal` 抬到最低档（opus 系 →`low`）；**非法档同样回 `{success:true}`**（静默忽略，不报错）——前端必须自己过滤，不能靠报错兜底。
- **切模型不修正档位（补测）**：`set_model` 成功后思考档不会自动跟随；切到无思考模型（`claude-haiku-4-5`）时 `get_state.thinkingLevel` 键**整个消失**，切回多档模型也不恢复。app 策略：切模型成功后由后端 runtime 自动跟进 `set_thinking_level`（取新模型 `efforts` 最高档；无思考则 `off`），随后 `get_state` 回读真值；切换失败也回读，用于纠正前端乐观态。
- **档位真值来源（补测）**：`get_state.data.model.thinking.efforts: string[]`（rich 结构，与 `omp models --json` 的 `thinking: string[]|null` 同源）；`set_model` 的 response `data` 即**完整模型对象**（同样带 `thinking`），切完即可知道新模型的档位集。
- 可用档查询：`omp models --json`（字段 `thinking:string[]|null`，`null`=无思考）+ RPC `get_available_models`（ richer：含 `thinking{mode,efforts}`）。V1 用前者做选择器过滤，后者做运行时校验。
- CLI 侧 `--thinking off|minimal|low|medium|high|xhigh|max|auto`（`--help` 原文）。

## 4. 审批流程（已实测，含通过/拒绝双分支）

- 触发时序：`toolcall_end` → `tool_execution_start{toolCallId,toolName,args,intent}` → `extension_ui_request{method:"select", title:"Allow tool: bash\nCommand: echo …", options:["Approve","Deny"]}`（注意：**没有 optionDetails**，之前设计稿里写的是推测，已删）。
- 通过：回 `{type:extension_ui_response, id, value:"Approve"}` → `tool_execution_end{isError:false, result:{content:[{type:text}], details}}` → agent 继续总结。
- 拒绝：回 `{type:extension_ui_response, id, cancelled:true}`（`value:"Deny"` 等价，未深测，统一用 cancelled）→ `tool_execution_end{isError:true, result:{content:[{text:"Tool call denied by user: bash"}]}}` → `message role=toolResult isError:true` → agent 输出「执行被拒绝」类总结，turn 正常结束（**不是 error，不是中断**）。
- `confirm` 类对话框（未在本 spike 触发，协议有）：回 `{confirmed:true/false}`。`input` 类回 `{value}`。未知 id 的回包被忽略（安全）。
- `--approval-mode always-ask|write|yolo` CLI 透传有效；`get_state` 不回显 approvalMode——全局档读 `omp config list --json`，写经 `omp config set tools.approvalMode <值>`。

## 5. 历史回放与辅助命令（已实测）

- `switch_session{sessionPath}` → `{success:true, data:{cancelled:false}}`，随后 `get_state.messageCount` 即该会话消息数。
- `get_messages_page{limit}` → `{messages, totalMessages}`（还有 `nextCursor`，V1 按 limit 一次拉足 + 虚拟化即可，游标分页留 Phase 3）。
- `bash{command}` 命令（RPC 内置，非工具）：`{exitCode, output, truncated, totalLines…}`，用于诊断页探针，不进会话。
- `omp render --plain <session>` 可作离线文本对拍；`omp models --json` 模型目录；`omp config path` 定位 agentDir；`omp gallery --plain` 看各工具四态 renderer（设计 ToolCard 时的文案参照）。

## 6. 风险与未实测项

| # | 事项 | 状态 | 缓解 |
|---|---|---|---|
| 1 | v2 `rpc_chunk` 大帧分片重组 | 未实测（V1 消息小，行解析够用） | 解析层预留分片接口；`get_messages_page` 本身就是防大帧设计 |
| 2 | `confirm/input/editor` 类 UI 请求的具体 title/字段 | **已解决（二期 M5）**：从本机 omp 18.1.22 内嵌源码取到权威口径——`confirm{title,message,timeout?}` 回 `{confirmed}`、`input{title,placeholder,timeout?}` 与 `editor{title,prefill,promptStyle?}` 回 `{value}`、`notify{message,notifyType}` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text` 为单向、服务端 `cancel{targetId}` 撤回。见 `docs/v2-schedule.md` §2 | 已落地：`respond_ui` + `UiRequestCard`，`pnpm e2e:rpc` 的 `ui` 场景覆盖 |
| 3 | 双开同一会话（TUI + app） | 未测 | V1 文档警告 + 后开只读提示（§12 设计稿） |
| 4 | 上游协议漂移（`can1357` fork vs 主仓版本） | 持续风险 | 启动时 `negotiate_protocol` + `--version` 记录；`unknown command` 回包 `id:undefined`，解析层不硬依赖 id 回显 |
| 5 | `set_session_name` 是否污染远端标题 | 未测 | V1 不用该命令，改名只写覆盖层 notes |

## 7. 最小可用命令表（V1 后端照此实现）

`negotiate_protocol → get_state → prompt → abort → set_model → set_thinking_level → get_available_models → switch_session → get_messages_page → extension_ui_response → bash（诊断）`。其余（steer/follow_up/subagent/host_tool/host_uri/compact/branch/handoff/login…）V1 一律不用。
