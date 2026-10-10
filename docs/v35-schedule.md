# ompMiniDesktop 三十五期（V35）：聊天流式「思考中…」指示 + 会话身份（前缀碰撞）与打开时的状态真值

> 基线：V34（0.11.1）已交付。本文记录用户本轮反馈的两个聊天形态缺陷——**用户口径 → 归因证据 → 实现口径 → 核验**。
> 用户口径：「现在聊天形态发送文字后无任何反应，需要在流式输出中添加思考状态。并且在工作中切换会话会直接造成该会话中止」。
> 另附截图：聊天形态里一条用户消息、状态胶囊「运行中」、消息列**空无一物**（连工具卡都没有）。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 「发送文字后无任何反应」 | 两层原因：①**慢模型**（推理档 max）从发送到首个 delta 可以几十秒到几分钟，期间消息列为空（截图正是这个窗口）；②**会话身份被 8 字符前缀污染**——打开 / 发消息时命中的是**另一个会话**，实时帧进了别人的通道（见下条），界面当然一直空着。修法 = 流式「思考中…」指示行（纯派生渲染）+ 会话定位 / `--resume` 一律用**完整 id**。 |
| 「工作中切换会话会直接造成该会话中止」 | **真凶是 8 字符前缀碰撞**：`session_file_for` / `spawn_session_runtime` 只用 uuid 前 8 位定位文件与 `--resume`——uuid v7 的前 8 位是毫秒时间戳高 32 位，**同一分钟内建的两个会话前 8 位必然相同**。真机证据：用户同一次尝试里建的两个聊天会话 `01a123c6-9b8c…`（11:06:20）与 `01a123c6-f958…`（11:06:44）前缀完全相同；omp 对 `--resume <前缀>` 的解析是「取最新匹配的那个」（实测，本文件 §1.2），于是打开「旧的」实际拉起「新的」、并以新会话身份登记进运行表——**若新会话正在跑，就被 `spawn_long_lived` 的同 id 补位顶掉（进程被杀、进行中的轮次中止）**；同时前端订的是旧会话的通道，帧全跑到新会话通道上，界面表现为「没反应」。另一处放大器：切回一个正在跑的会话时 `openSessionWithHistory` 把状态**压成 idle**，输入框于是把下一条当**新 prompt** 发出去（运行中应当走排队 / 转向）——一句追问就把进行中的轮次打断。 |
| 修法口径 | ①`session_file_for` 只认完整 id（`stem == id` 或 `stem` 以 `_<id>` 结尾），**全部调用点**（历史 / 删除 / 归档清单 / 位置偏好回写 / 未落盘补行 / 上下文分项）改传完整 id；`spawn_session_runtime` 的 `--resume` 给完整 id（终端侧 resume 一直是全 id 口径，omp 认）。②`SessionMeta` 增加 `status`（回读才有，取值来自 `SessionActivity`），`openSessionWithHistory` 不再把已有状态压成 idle，`applyRuntime` 用它把「切走期间错过」的状态事件补回真值。③`Thread` 增加流式「思考中…」指示行。 |

## 1. 归因证据

### 1.1 真机上确实存在前缀撞车的两个会话

`~/.omp/agent/sessions/-Desktop-WorkSpace-ompMiniDesktop/` 里（2026-10-10 当天）：

```
2026-10-10T03-06-20-940Z_01a123c6-9b8c-76a4-85ab-10ba5ee9d179.jsonl   # 11:06:20 建
2026-10-10T03-06-44-952Z_01a123c6-f958-7524-b1be-53b4fb030bf6.jsonl   # 11:06:44 建（同一条首条消息，用户重试）
```

两条会话 id 的前 8 位都是 `01a123c6`——**这不是巧合，而是规律**：uuid v7 的前 48 位是毫秒时间戳，前 8 个十六进制字符 = 时间戳高 32 位，**同一 65536ms 窗口内建的两个会话必然同前缀**。壳侧当时的 `session_file_for(agent, id_prefix)` 收的是调用方截断的 `id.chars().take(8)`，匹配规则是「文件名 `contains(前缀)` + 取字典序最大」——两个文件都命中，取更大的那个 = **f958（新的）**。同理删除、历史回放、位置偏好回写、上下文分项全都指向 f958。

### 1.2 omp 对 `--resume <前缀>` 的解析（实测，本机 omp 18.8.7）

用两份**构造的**同名前缀会话文件（id `ffffffff-1111-…` / `ffffffff-aaaa-…`，时间戳旧的在前）在临时 cwd 下探针：

| 命令 | 实际粒度 |
|---|---|
| `omp --mode rpc-ui --cwd <tmp> --resume ffffffff`（8 字符前缀） | `sessionId = ffffffff-aaaa-…`（**新的那个**，等于壳侧 `session_file_for` 的选择） |
| `omp --mode rpc-ui --cwd <tmp> --resume ffffffff-aaaa-bbbb-cccc-dddddddddddd`（完整 id） | 同一个文件、同一次身份——完整 id 口径无歧义 |

**结论**：前缀在 omp 侧同样是「取最新匹配」，壳侧必须传完整 id。终端形态的 `omp --resume <完整 id>`（`resumeSessionInTerminal`）一直是全 id 口径，所以只有聊天侧会踩。

### 1.3 中止是怎么发生的（代码链）

`open_session(id)` / `send_prompt` 的自动恢复（`spawn_session_runtime(id)`）：

1. 8 字符前缀命中**另一个会话的文件** → 返回的 `head.id` 是那个会话；
2. `SpawnOpts.resume = Some(前缀)` → 新进程实际 resume 的也是那个会话 → 握手回包的 sid 同样是它；
3. `spawn_long_lived` 的登记处有一道「同一会话旧进程先杀」的防线（`m.remove(&sid)` + kill，防重复 open 的竞态）——**sid 撞上了正在跑的那个会话** → 它的进程被顶掉、stdin 关闭、进行中的轮次结束（jsonl 停在半途）；
4. 前端订的仍是**发起方**那个会话的通道（`omp-event://<旧 id>`），而帧全在新会话的通道上 → 消息列从此不再更新。
   这一条同时解释用户的两个症状：**「看起来被中止」+「发送后没反应」**。

### 1.4 第二处放大器：切回正在跑的会话被压成 idle

`sessionOpen.ts` 的 `openSessionWithHistory` 在 open 返回后无条件写 `statusBySession[id] = { state: "idle" }`（V32 遗留的「先按 idle 起手」）。切走再切回一个**仍在中途**的会话时：

- 胶囊显示「就绪」（真相是 running）；Composer 的 `running` 判定为假 → Enter 走 `api.sendMessage`（**prompt**）而不是 `followUpMessage` / `steerMessage`——omp 收到 prompt 即开新一轮，**把进行中的轮次打断**；
- 新的「思考中…」指示以 `status === "running"` 为前提，压 idle 会让它在该窗口里也不出现。

## 2. 实现

### 2.1 后端：会话定位 / resume 一律完整 id（`commands/mod.rs`、`context.rs`）

- `session_file_for(agent, id)` 重写：只认完整 id（`stem == id` 或 `stem.ends_with("_" + id)`，`.jsonl` 后缀剥掉后比），同一 id 命中多个 slug 目录时取字典序最大的整条路径；**`parse_session_head` 损坏兜底给的文件名主干**（`<时间戳>_<id>`）由 `stem == id` 一支兼容。
- 全部调用点改传完整 id：`open_session`（已运行分支读头）、`spawn_session_runtime`、`get_history`、`delete_session_inner`、`remember_project_pref`、`unlanded_views`、`get_context_breakdown`；`list_archived_in` 的「按 id 找文件」过滤也改成完整 id（原先的前缀过滤会把无关文件读进来，靠头里的 id 复核兜住——复核保留）。
- `spawn_session_runtime` 的 `--resume` 改传完整 id（`Some(id.to_string())`）。

### 2.2 后端：活动态真值进回读（`runtime.rs`、`commands/mod.rs`）

- `SessionMeta` 新增 `status: Option<String>`（`idle` / `running` / `awaiting-approval` / `exited`）+ `activity_state_label(u8)`（`error` / `exited` 两档共用活动态，回读统一报 `exited`——前端两档的展示同为「不在跑」）；
- `get_session_runtime` 回读时从 `RunningChild.activity` 现取（`SessionActivity::state` 开放为 `pub`）；**事件推送（`omp-state://`）不带它**（保持 `None`），前端按事件维护自己那份副本，只有回读负责补真值。

### 2.3 前端：状态不被压 idle + 回读落真值（`sessionOpen.ts`、`useSessionEvents.ts`、`shared/types.ts`）

- `openSessionWithHistory`：只在**还没有任何状态记录**的会话上给 idle 起手；已有记录（running / awaiting-approval…）保持，交给随后的 `syncSessionRuntime` 收敛；
- `applyRuntime`：`rt.status` 有值时写回 `statusBySession[sid]`（该 sid 仍是当前会话——既有守卫不变）。订阅建立与 open 之后的两处 `syncSessionRuntime` 因此都能把状态补回真值。

### 2.4 前端：流式「思考中…」指示行（`Thread.tsx`）

- 判定：`status === "running"` **且**流尾没有「正在输出」的行（`hasLiveTail`：流式文本 / `complete === false` 的思考 / `state` 为 `running`·`streaming` 的工具卡）→ 在消息列尾部渲染一条 `WorkingRow`（呼吸灯泡 + `t.thinking`「思考中…」，视觉与流式思考块同源）；
- **纯派生渲染**：不写 store、不进历史、不参与去重（切会话 / 重开都不会留痕）；
- 跟随滚动把「指示行出现」也算一次追加（贴着底时保持贴底）；
- 空态判定同步放宽：`events.length === 0 && !working` 才落空态（运行中即使一条消息都还没有也渲染指示行）。

## 3. 核验

| 项 | 证据 |
|---|---|
| 会话定位只认完整 id（碰撞夹具） | Rust 单测 `session_file_for_matches_full_id_only`：造 `01a123c6-9b8c…` / `01a123c6-f958…` 两个同前缀文件（真机形状），断言按完整 id 各自命中自己、8 字符前缀**不再命中任何文件**（旧口径会命中更大的那个 = 另一个会话）、损坏兜底的文件名主干仍可定位 |
| `--resume` 传完整 id | Rust 测试 `spawn_session_runtime_resumes_by_full_id`：桩 omp 脚本（记 argv → `ready` → 认 `h-state` 回身份）验证 `--resume` 后跟的是完整 id，且读到的文件头是目标会话自己的（旧口径此处两条断言都会红：argv 是前缀、文件头是另一个会话） |
| 打开会话的状态真值 | 前端 `sessionOpen.test.ts` 新增 3 条：已有 running 记录不被压成 idle / 无记录时起手 idle 但被回读 status 覆盖 / 回读 idle 时收敛回 idle；`useSessionEvents.test.ts` 新增 3 条：回读 status 落状态表、非当前会话不落、载荷无 status 时不动 |
| 流式「思考中…」指示 | `Thread.test.tsx` 新增 3 条：运行中且流尾是「已完成工具卡」时补一条（就是「工具跑完等模型下一步」的间隙）、流尾是流式文本 / 运行中工具卡时不补（界面本来就在动）、idle / 未知状态不渲染 |
| 真实 omp 冒烟 | `cargo test -- --ignored real_rpc_prompt_roundtrip`（spawn 握手 → 真实 prompt → 状态 `idle → running → idle`）与 `real_rpc_recycle_recover`（回收 → `send_prompt` 自动 resume，走的正是本次改过的 `spawn_session_runtime` 全 id `--resume`）双双通过 |
| 门禁 | `pnpm check`（typecheck + lint + 540 vitest + e2e:ipc 94 命令）· `cargo test --locked`（216 通过、0 失败）全绿 |

## 4. 边界与遗留

- **不做会话 id 的自动迁移 / 重命名**：omp 的 jsonl 文件名与会话 id 由上游决定，壳侧只读不写。
- **切走期间的实时帧仍然拿不到**（Tauri 事件无订阅即丢弃，这是推送模型的固有代价）：切回时靠 `get_history` 全量重拉 + 本轮后续增量；进行中文本的首个 delta 可能从中间开始，`message_end` 会用完整文本覆盖同一 id（V34 既有口径，不重复修）。
- **`status` 只在回读里带**：若会话连运行表条目都没有（进程早已回收 / 打不开），回读返回 `None`，状态维持前端已有值；这种情形只会出现在「进程不在且文件也打不开」的组合，界面另有胶囊与 `HealthBanner` 兜底。
