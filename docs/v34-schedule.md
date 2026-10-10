# ompMiniDesktop 三十四期（V34）：聊天会话进程闲置回收 + 前端历史缓存治理

> 基线：V33 已交付（app 内所有输入框不再弹「输入提示」）。本文记录这一期的内存治理——**用户反馈 → 归因 → 实现口径 → 核验**。
> 用户口径：「现在 app 随着运行占用的内存越来越大，甚至高达 5、6GB，看看怎么优化一下」。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 5–6GB 是谁的？ | **大头是常驻的 omp 进程**。每个聊天会话是**一个长驻 `omp --mode rpc-ui` 进程**（Bun 单文件二进制，空闲 footprint ≈ 500MB、RSS ≈ 770MB，干活时 1.05GB——V17 实测）；每个终端 tab 是一个 `omp` TUI 进程（同量级）。「越来越大」的形状 = **浏览过的会话 / 开过的 tab 越攒越多**，而不是单进程缓慢泄漏。 |
| 壳侧的问题在哪？ | 三处累积：①**聊天 runtime 从不回收**——只有归档 / 删除 / 移除项目才 kill，切走、闲置都不停（浏览 10 个会话 = 10 个进程）；②**前端 `eventsBySession` 从不清理**——每个打开过的会话的全量消息（含工具**全量输出文本**）常驻内存；③归档 / 删除后前端缓存不清理 + `listen` 注册竞态泄漏监听器。 |
| 优化口径 | 壳侧能做的全部做到，不做「限制用户开 tab / 会话」这类产品级限制：①**闲置回收**（idle 30 分钟 + 已落盘 → kill，重新打开 / 直接发消息自动 resume，用户无感）；②**历史 LRU**（内存只留最近 3 个会话的完整历史，切回时重新 `get_history` 拉回——本来就是每次打开都全量拉）；③**工具全量输出封顶**（>100K 字符不再保留「展开查看」的全文）；④归档 / 删除清缓存、修监听竞态。 |
| 为什么不减 omp 进程本身的占用？ | omp 的 footprint 与上下文规模强相关（Bun VM 特性），是上游运行时开销，壳侧不代偿（V17 既有结论）。壳侧能做的是**别让进程越攒越多**。 |

## 1. 归因（代码审计）

### 1.1 聊天 runtime 的生命周期

- `commands/mod.rs` 的 `kill_runtime` 只有三个调用点：`archive_sessions` / `delete_sessions` / `remove_project`；
- `open_session` 对没有长驻进程的会话 `spawn`，`stop_session` 只发 `abort`（中断当前轮，不杀进程）；
- 于是**用户浏览会话列表点开过的每一个会话都留一个进程**，切走、闲置、跑完都不回收——浏览 8 个会话就是 5–8GB。

### 1.2 前端的两处累积

- `eventsBySession`：`useSessionEvents` 的事件 handler 把每个会话的全量消息写进 store，`openSessionWithHistory` 每次都 `get_history`（后端上限 5000 行 / 2000 条）全量拉——**没有任何清理路径**（删除会话也不清）；
- 工具输出：`viewmsg.ts` 的 `truncate(text)` 把 >2000 字符的输出截前 2000 展示，**完整全文放进 `outputFull`**（供「展开查看」）——**无上限**。长会话里几十次大输出（日志 / 构建产物）的全文常驻内存；
- `useSessionEvents` 的三条 `listen`（chatEvent / chatStatus / chatRuntime）是**异步注册**的：cleanup 先于注册完成时，`off1?.()` 还是 undefined，注册完成后监听器永远不解除（快速切会话会攒监听器）。

### 1.3 事件通道的口径缺陷（`start_pump` 用占位 key 命名通道）

`runtime.rs` 的 `start_pump` 用 **spawn 时的 key** 构事件三通道名（`omp-event://{key}` 等），而 `create_session` 的 key 是 `new-<ts>` 占位、拿到真实 sid 后才换 map 的 key——**pump 通道停在 `new-<ts>`**，前端订阅的却是 `omp-event://<sid>`。

当时有两种可能（后来实测定性）：
- resume / open 既有会话：key = sid，通道 = sid，正常；
- **新建会话**：帧全部发往 `omp-event://new-<ts>`——按推测前端一条都收不到。

定性实验（临时探针测试，0 AI 调用）：spawn 用一个非 sid 的 key（`probe-hint`），拿 sid 后同时监听 `omp-event://probe-hint` 与 `omp-event://<sid>` 两条通道，发一条非 AI 命令（`set_thinking_level`）看响应帧落哪边：

| 通道 | 收到的帧 |
|---|---|
| `omp-event://probe-hint`（spawn key） | `extension_ui_request` / `advisor_cost_changed` / `available_commands_update` / `response` ×2 / `thinking_level_changed` |
| `omp-event://<sid>` | **空** |

**实锤**：修复前，新建会话（以及任何以占位键 spawn 的会话）的实时帧全部发到**无人订阅的通道**——「点开既有会话」正常（resume 的 key 就是 sid）、「新建会话」收不到流式与回复。这也解释了为什么缺陷一直潜伏：**日常路径（打开已有会话）通道一直是对的**，只有新建会话那一段会坏，且 mock 核对时手工注入的帧走的是「前端订阅的通道」，把真实通道名的问题整个盖住了。

**修法**：`start_pump` 的通道名与内部 map 查询键统一改用 **sid（会话 id）**——sid 才是「会话身份」的稳定真值（map key 只是调用方的事务键，create 会换名）。`omp-state://` 的开场真值帧（spawn 尾部）与 pump 内的 `handle_frame`（真值快照 / 命令面缓存 / 项目偏好回写）一并改用 sid；换名前的极短窗口内 map 查不到时按既有语义跳过（回读会补）。**`real_rpc_prompt_roundtrip` 慢测试**的订阅也改到 sid 通道（拿到 sid 之后订阅——握手回放的 `available_commands_update` 因此不再硬断言，该覆盖挪到 recycle 测试的 resume 场景：订阅先于 spawn，「回放必达」在那里可确定时序）。

## 2. 实现

### 2.1 后端：闲置回收（`runtime.rs` + `main.rs`）

- `SessionActivity`（`AtomicI64 last_active_ms` + `AtomicU8 state`）挂在每个 `RunningChild` 上，spawn 时创建、pump 与回收器共用同一份；
- **触达**：pump 每收到一帧 `touch()`（running 的会话一直在推帧、天然不会被回收；真闲下来才开始计时）；
- **状态**：所有 `omp-status://` 的 emit 点统一走 `emit_status`——字符串状态（idle / running / awaiting-approval / error / exited）与活动态一次更新（`error`/`exited` 归入「异常退出」，回收不认它）；`approve` / `respond_ui` 命令路径同步把状态落回 running；
- **判定**（纯函数 `idle_recyclable`）：`state == idle` 且 30 分钟（`IDLE_RECYCLE_MS`）没有任何帧。**只回收 idle**——running（哪怕某个工具长时间没输出）/ awaiting（等用户审批）/ exited 一律不碰；
- **回收器**（`start_idle_reaper`，`main.rs` setup 挂一次）：每 60 秒扫一遍 runtime 表，对满足条件的会话再查**已落盘**（`session_file.exists()`）——omp 的 jsonl 是懒写盘的（首个 turn 才落文件），刚建好还没说过话的会话被 kill 后磁盘上没有它、列表补行也无从谈起——然后走 `kill_runtime`（发哨兵 → pump 退出 → omp 随 stdin 关闭退出、把 jsonl 写完）。**静默回收**：不发状态事件（回收只发生在 idle，前端本就显示 idle；用户回来后发消息走自动恢复，不需要看见「已退出」的中间态）。

### 2.2 后端：发送自动恢复（`commands/mod.rs`）

- `open_session` 的 resume-spawn 段提取为 `spawn_session_runtime`（泛型 `AppHandle<R>`，测试与命令共用）；
- `send_prompt`（`send / slash / steer / follow_up` 共用）在**没有长驻进程**时：`prompt`（正常发消息 / `/` 命令）→ 先 `spawn_session_runtime` resume 拉起再发——**用户发消息不该因为后台回收而失败**；`steer` / `follow_up` 不代偿（没有进行中的轮次时这两个语义本身不成立，按原样报 `NOT_RUNNING`）。

### 2.3 前端：历史 LRU 与缓存清理（`useSessionEvents.ts` / `sessionBatch.ts`）

- `trimSessionHistories(activeId, keep = 3)`：内存只保留**最近 3 个激活过的**会话完整历史，更早的清掉（`folds` 折叠态一并清）；**正在跑 / 等审批的会话不碰**（流可能还在写、用户随时切回看中间态）。清掉是安全的——切回时 `openSessionWithHistory` 本来就每次 `get_history` 全量重拉（合并按 id 去重，空基底天然支持）；
- 触发点：① `activeSessionId` 变化（`useSessionEvents` 的订阅 effect）；② **切去终端形态**时收窄到只留当前会话（`appMode` effect）——聊天不在用时那几份历史也没必要挂着；
- `forgetSession(sid)`：清掉一个会话的全部前端缓存（事件流 / 状态 / 计划 / 附件 / 折叠态 / LRU 名单）——归档（成功且原为未归档）/ 删除（成功的 id）后调用；归档页与左栏弹窗的批量走 `runSessionBatch` 内置清理，单条操作在调用点清（失败的那些保持可读）。恢复（unarchive）不清——会话正要重新用起来。

### 2.4 前端：工具全量输出封顶（`viewmsg.ts` / `useSessionEvents.ts`）

- `TOOL_OUTPUT_FULL_MAX = 100_000`：超过 10 万字符的输出不再保留全文（`outputFull` 为空，ToolRow 的「展开」入口一起消失）；截断的前 2000 字符照常显示。长会话里的大输出（日志 / 构建产物）不再全文常驻。

### 2.5 前端：监听竞态修复（`useSessionEvents.ts`）

- 三条 `listen` 改为「注册完成后检查 `disposed`」模式：cleanup 先于注册完成时，注册到手立刻 `off()`——不再泄漏监听器（旧会话的帧不会再写进 store）。

### 2.6 后端：事件三通道改用会话 id（`runtime.rs`，§1.3 的修复）

- `start_pump` 的 `key` 参数改为 `sid`（会话 id）：`omp-event://` / `omp-status://` 的命名、pump 内 `handle_frame` 的 map 查询键（真值快照 / `remember_project_pref` 的项目偏好回写）全部用 sid；`spawn_long_lived` 尾部的 `omp-state://` 开场真值帧同步改 sid；
- 删掉 `start_pump` 冗余的 `worker_sid` 参数（它本来就是 sid）；
- 慢测试同步：`real_rpc_prompt_roundtrip` 改为拿到 sid 后再订阅 sid 通道（握手回放的竞态帧不再硬断言）；`real_rpc_recycle_recover` 保持「create 口径」（hint key → 换名 → 订阅 sid 通道），并新增 resume 场景「回放必达」断言。

## 3. 核验

| 项 | 证据 |
|---|---|
| 闲置判定（纯函数） | `idle_recyclable_only_for_stale_idle`：idle 超阈值可回收（含边界相等）、刚有帧不可、running / awaiting / exited 一律不回收；`session_activity_tracks_state_and_freshness`：起手 idle、set_state 生效、touch 刷新活动时刻 |
| 通道定性（临时探针，0 AI 调用） | 占位键通道收到全部 6 类帧、sid 通道空（§1.3 表）——修复前「新建会话的实时帧发往无人订阅的通道」实锤 |
| 通道修复 | 同一探针重跑：**sid 通道收到全部帧、占位键通道空** |
| 回收 → 自动恢复（真实慢测试） | `real_rpc_recycle_recover`（`--ignored`，真实 omp + 2 次 AI 调用）：真实一轮对话 → 等 jsonl 落盘 → `kill_runtime`（回收同一入口）→ 表里已无该会话 → `send_prompt` **自动 resume 并成功**（不报 NOT_RUNNING）→ 新进程在表里 → 新一轮 `message_end` + 握手回放帧到达 sid 通道（订阅先于 spawn，「回放必达」可确定时序） |
| roundtrip 回归 | `real_rpc_prompt_roundtrip`（`--ignored`）：22 帧（含 `available_commands_update` 回放）、状态序列 `idle → running → idle` |
| 前端 LRU / 清理 | `useSessionEvents.test.ts` 5 条：第 4 个会话打开后最早的历史被清、LRU 去重（反复激活不重复占位）、running / awaiting 豁免、`forgetSession` 四类键齐清、no-op 不伤其它会话 |
| 门禁 | `pnpm check`（typecheck + lint + vitest + e2e:ipc 95）· `cargo test --locked`（179 + 213 通过、0 失败） |

**修掉的顺带缺陷**：`create_session` 的「占位键换名」整段删除（spawn 内部以 sid 为 map 键，换名窗口消失——否则 pump 的首批帧按 sid 查表落空，命令面缓存与项目偏好回写都会丢）。
