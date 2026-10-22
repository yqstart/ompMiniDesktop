# 排期 5：会话统计条（输入卡底部读数）

> 状态：**已实施**（2026-10-16）。锚点 = 用户口径「参考 deepseek harness 把一些会话的统计信息放到聊天框下面——除了图中的会话信息、Token 用量、上下文，还要把供应商用量也放到下面」；两处确认：① 工具行里原有的上下文容量环与供应商用量**移走**，只在统计条显示（同一个数字不出现两次）；② 供应商用量在条上给**最紧窗口的读数 + 窗口名**（多窗口补「+N」），浮层内容不变。
> 性质：**输入卡底部新增一行** + 一条新数据链路（单会话 jsonl 聚合）+ 两个入口搬家。会话运行时、消息流、左栏 / 右栏、设置面都不动。
> 前置阅读：`../AGENTS.md`（工程导航）、`roadmap.md`、`design-system/MASTER.md` §4.3 / §4.10。

## 1. 范围

### 1.1 新增

| 模块 | 说明 |
|---|---|
| `src-tauri/src/live_stats.rs` | 单会话累计统计：扫该会话 jsonl 聚合轮 / 步 / 工具调用 / 模型用时 / 工具用时 / TTFT / 吞吐 / token 累计 / 缓存命中率 / 成本；进程内按 mtime + size 缓存 |
| `live_stats::get_session_live_stats` | 新命令（注册在 `main.rs` 的 RPC 命令面里，紧邻 `context::get_context_breakdown`） |
| `src/lib/sessionLiveStats.ts` | 前端数据层：按会话 id 的模块级快照、2 秒节流、单飞、失败保留旧值；展示口径纯函数 `fmtSpan` / `fmtTps` / `fmtHitRate` / `liveStatsReadable` / `liveTokensReadable` |
| `src/components/thread/SessionStatsBar.tsx` | 统计条容器 + 会话统计项 + Token 用量项（各自浮层）；容器决定整条是否露面 |
| store 字段 | `composerMenu` 新增两档 `"liveStats"` / `"liveTokens"`（浮层互斥槽，与模型 / 执行模式等共用） |
| 字典 | `liveStats*` / `span*` / `usageLimitsMore`（中英同键） |
| 单测 | `live_stats.rs` 6 例（口径 / 空会话 / 无解码时间 / 推理与缺失合计 / 只数有步的轮 / 并行工具各计一份）、`sessionLiveStats.test.ts` 9 例、`SessionStatsBar.test.tsx` 6 例 |

### 1.2 搬迁与改动

| 位置 | 变化 |
|---|---|
| 卡底工具行 | 移走 `ContextMeter`（容量环）与 `UsageLimits`（供应商用量），只剩 `+` / 执行模式 / 压缩行动点 / 模型 ▾ / 思考档 ▾ / 发送 / 停止 |
| `thread/ContextMeter.tsx` | 触发件改成条内形态（读数 `text-muted`、浮层从 `right-0` 改 `left-0`、内边距与统计条对齐）；**面板内容与数据口径不动** |
| `composer/UsageLimits.tsx` | 触发件从「只一个图标」改成「图标 + 最紧窗口读数 + 窗口名 + `+N`」；`entryGlance` 增返 `tightest`（档位优先、同档比已用比例，`extra` = 其余窗口数） |
| `lib/useSessionEvents.ts` | `forgetSession` 顺带清统计快照（归档 / 删除后不留旧读数） |
| `Composer.tsx` | 卡底工具行之后挂 `<SessionStatsBar />`；顶部注释与 MASTER §4.3 同步 |
| 既有测试 | `usageLimits.test.ts` 补 `tightest` 断言、`Composer.test.tsx` 两条口径更新（读数上条、容量环位置） |
| 2026-10-16 修订（用户口径） | ① 统计条**独占一行并整条靠右**（卡片直接子元素、`justify-end`，不许塞进工具行的 `flex-wrap` 容器）；② 四项浮层的水平位置改由 `lib/usePopoverAnchor` **实测锚到被点的项**（包含块仍是条根、只写 style 不走 state；`right-0` 只作无布局环境兜底）；③ `composer/UsageLimits.tsx` 触发件**回到「只一个图标」**——读数 / 窗口名 / `+N` 全部下沉到悬停提示与浮层（`entryGlance` 的 `tightest` 保留为入口摘要口径，不再上条） |

### 1.3 不动

- `/status` 会话统计**模态弹窗**（`SessionStatsDialog`，数据源是 omp 的 `get_session_stats`）保留：它是「一次看全」的入口，统计条是常驻读数，两者不互相替代。
- 设置 ›「使用统计」（`usage.rs`，跨会话 + 壳侧账本）与本会话累计是**两条口径**：前者答「我一共花了多少」，后者答「这个会话花了多少」。

## 2. 口径（不许违背）

### 2.1 读数口径（对齐 DeepSeek Harness 的 `sessionStats` / `tokenUsage` 投影；上游逆向证据见 §4）

| 指标 | 口径 |
|---|---|
| 轮 | **真的出现过模型步的轮数**（用户发了消息却没有任何 assistant 步的空轮不计；与 DH 的「有已关闭步的 turn」同口径） |
| 步 | assistant 消息条数（工具循环里的每一次模型调用；失败 / 取消 / max-tokens 的步照算） |
| 工具调用 | `toolResult` 条数 |
| 模型用时 | Σ`message.duration`（毫秒） |
| 工具调用用时 | 每个 `toolResult` 的 `timestamp` − 发起它的那次 assistant 的 `completedAt`，**逐个调用求和**（并行工具各计一份，与上游按 callId 配对求和同口径）；遇到用户消息即作废起算点（跨轮那段是用户思考时间） |
| 首 token 平均（TTFT） | Σ`ttft` ÷ 有 ttft 的步数（按步算术平均） |
| 输出速度（TPS） | **输出 token ÷ 解码墙钟**，解码墙钟 = Σ(`duration` − `ttft`)，且**只认既有首 token 又有输出的步**（TTFT 被单独减掉） |
| Token 总计 | 三桶计费输入（未缓存输入 + 缓存读 + 缓存写）+ 输出（= omp 的 `totalTokens`） |
| 缓存命中 | `cacheRead ÷（未缓存输入 + 缓存读 + 缓存写）`——**分母含缓存写**（与 DH 同式；设置页「使用统计」用的是 `cacheRead ÷ (input + cacheRead)`，两处口径不同、不互相改） |
| 成本 | Σ`usage.cost.total` |

**派生指标一律后端算好**（与 `omp-state` / 使用统计同一条工程口径），前端只格式化、不自算 token、不猜单位。

### 2.2 展示口径

1. **位置**（2026-10-20 已修订：统计条移到**输入卡外部、卡片下方**独立一行，同宽、`mt-1.5`，不再有 `border-t`；卡片内部只保留输入区与工具行。以下为 0.2.0 当时的卡片内形态）：输入卡**卡片内部最底部**（工具行之下、卡边框之内），`border-t border-border-soft` 分隔；四项一行、整条**靠右**（`justify-end`）、可换行、`text-[11px]`。**统计条是卡片的直接子元素**（工具行容器之后）——不许塞进工具行的 `flex-wrap` 容器：那样它只是行尾的又一个 flex item，会与模型 / 思考档 / 发送键同行、分隔线只剩半截宽（2026-10-16 修，用户实测的错位）。
2. **每项都是可点开的浮层**（朝上开、`bottom-full mb-1`；互斥槽 = `store.composerMenu`，与模型 / 思考档 / 执行模式同一个）。**包含块 = 统计条根**（`relative` 在条根、按钮包装器不带定位），**水平位置锚到被点的项**（`lib/usePopoverAnchor`：实测居中于按钮、夹在 `[0, 条宽 − 浮层宽]`；只写 style 不走 state，无布局环境退回 CSS 的 `right-0`）——既不溢出输入卡（相对按钮 `left-0` 的宽浮层会被中列 `overflow-hidden` 裁掉），也不像贴条缘那样离靠左的项很远。会话统计与 Token 用量的浮层分别对齐 DH 的「会话统计」「Token 用量」两张卡（四行读数 / 四项分解 + 一行口径注脚）。
3. **门槛与 DH 同**：**整条**在四项都没内容时不渲染（不留空行、不留分隔线）；会话统计项要求「步数 > 0」，Token 项要求「计费输入或输出 ≠ 0」，上下文 / 供应商沿用各自原有门槛。**文件读不全（超 64MB 字节上限）时按没有读数处理**，不给偏低数字。
4. **格式化**：时长 `<1 分钟` 给一位小数的秒、其后「N 分 N 秒」/「N 小时 N 分」；吞吐 ≥10 取整、<10 一位小数；命中率整数百分比；token 用既有 `fmtTokens` 紧凑档（B / M / K），浮层里给千分位精确值。
5. **颜色不是唯一信号**：上下文 ≥80% 转 warn、供应商最紧窗口到 warn / danger 时图标换色，但数字本身始终在（供应商项 2026-10-16 起条上只有图标，数字在**悬停提示 `title` / `aria-label`**——读屏与悬停都能拿到，颜色不作唯一信号）。
6. **收敛方式**：omp 不推这类投影——打开拉一次、**运行中每 3 秒**回读一次、终态翻转再拉一次（拿到终值）。前端 2 秒节流 + 单飞 + 失败保留旧值（不闪空）；后端按 mtime + size 缓存（文件没变不重扫）。归档 / 删除会话时 `forgetSession` 一并清快照。
7. **只读**：后端只读会话 jsonl，不启动进程、不下发命令、不写任何 omp 文件；会话文件不存在（新会话尚未落盘 / 已删除）时命令返回 `NO_SESSION_FILE`，前端按「没有读数」处理，不弹错。

## 3. 验收清单

1. `pnpm check`（typecheck / lint / test / e2e:ipc）与 `cargo test --manifest-path src-tauri/Cargo.toml` 全过。
2. 残留审计：`grep -rn "ContextMeter\|UsageLimits" src/components/composer/Composer.tsx` 只应出现在 `SessionStatsBar` 的引入链上（工具行里不再直接渲染这两个组件）。
3. 功能冒烟（桌面壳）：
   - 打开一个跑过的会话：卡底统计条出现，`N 轮 M 步 · X tok/s`、`X tok · 缓存命中 P%`、容量环百分比、供应商最紧读数四项都在；工具行里不再有容量环与供应商图标；
   - 点开四项各自浮层：会话统计四行与 DH 图对齐（模型用时 / 工具调用用时 / TTFT 平均 / 输出速度）、Token 用量给分项与千分位总计、上下文分项、供应商窗口清单；
   - 发一条消息 → 运行中读数每 3 秒推进（步数 / token 增长）→ 轮结束停在终值；
   - 新建会话（还没落盘的空白会话）：整条不渲染，输入卡底部不留空行；
   - 切换会话：读数跟着换（不串会话）；归档 / 删除后再打开同名会话不闪旧读数；
   - 深浅两套皮肤、窄窗（统计条换行）下都不破版；键盘可达（Tab 到每一项、Esc 关浮层、焦点恢复）。
4. 数字抽查：拿一个已知会话，用一段脚本独立算一遍轮 / 步 / Σ`duration` / Σ`ttft` / 输出 token / 四段 usage，与统计条读数逐项对齐（`live_stats.rs` 的单测覆盖口径，这一步验真实文件）。

## 4. 与上游 DeepSeek Harness 的差异（诚实说明）

| 维度 | DH（移动端 / 桌面端宿主） | 本应用 |
|---|---|---|
| 数据来源 | 宿主对**已提交会话事件**做事件级增量折叠（`sessionStats` / `tokenUsage` / `contextPressure` 三个投影），客户端纯订阅 push | **扫该会话 jsonl 聚合**（omp 不推这类投影），打开拉一次 + 运行中每 3 秒回读 |
| 轮 / 步 | `step/end` 事件条数 / 有已关闭步的 turn 数 | assistant 消息条数 / 有 assistant 步的轮数（近似，量纲一致） |
| 工具用时 | `tool/call` → `tool/result` 按 callId 逐个配对求和 | `toolResult` 落盘时刻 − assistant 完成时刻，逐个求和（量纲一致；jsonl 没有工具自己的耗时字段） |
| 缓存命中分母 | 未缓存输入 + 缓存读 + 缓存写 | 同 |
| 上下文百分比 | `contextPressure` 投影（提示词侧 + surface 位移） | omp `get_state.contextUsage` 真值（`percent` 直接给） |
| 供应商用量 | **没有这一项**（限额读数在 Platform Web 侧） | 本应用补的第四项：omp `usage --json` 拿全部已配置供应商的窗口 |
| 明细弹窗 | 会话统计 / Token 用量两张卡（点胶囊展开） | 同（另加上下文分项与供应商窗口两张，沿用原有浮层内容） |
