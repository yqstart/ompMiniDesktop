# ompMiniDesktop 七期（V7）功能排期：输入框上下文容量

> **历史存档（V11 起）**：本文档描述 V1–V10 的「聊天界面」形态；现行形态是终端工作区
> （见 `docs/v11-schedule.md`）。文中涉及聊天渲染 / RPC 驱动的部分已不再对应当前代码，
> 其余（设置页各页签、语言/皮肤、发版等）仍然有效。


> 基线：V1–V6 已交付（见 `CHANGELOG.md`）；本文只排七期，不重开已冻结的口径。
> 目标：把 omp 的**上下文窗口占用**搬到对话界面——输入框工具行、模型选择器**左侧**一个容量环，
> 点开看这一轮上下文里各块各占多少（对标 ZCode 会话内的「上下文容量」浮层）。
> 约束不变：真相在上游；壳侧只映射 omp 已暴露的能力，不自己调 API、不自造 token 数。

## 0. 范围与口径

用户口径：「如图是 ZCode 每个会话内的上下文展示，我需要你在输入框的模型前添加一个同样的功能」。

| 位置 | 区块 | 映射的上游物 | 写入什么 |
|---|---|---|---|
| 输入框工具行（`ModelPicker` 左侧） | 收起态：容量环 + 占用百分比 | `get_state.contextUsage`（`omp-state` 真值） | **不写** |
| 同上 | 展开态：总量条 + 分项行 + 会话平均缓存命中率 + 估算口径说明 | `get_context_breakdown` 命令 | — |

**这不是**设置页那张「使用统计」（本地会话 jsonl 的 token 聚合，`usage.rs`），
也**不是**输入框上方的「用量限额」（供应商侧配额窗口，`quota.rs`）。
三者数据源与语义各不相同，不许互相替代或合并：

- 上下文容量 = **这一次请求的上下文窗口**被谁占了（系统提示词 / 工具 / 消息…）；
- 使用统计 = **历史上所有请求**消耗了多少 token / 多少钱；
- 用量限额 = **供应商那边**还剩多少额度（5 小时 / 每周 / 每月）。

范围外（本批不做）：自动压缩缓冲与可用余量两行（omp `/context` 有，但要读 `compaction` 配置组才准）、
按工具逐个列占用、快照 / 历史对比、把容量环做成交互式（点它只开面板，不触发压缩——压缩入口是
`CompactButton`，两者不许合并）。不写 omp 配置、不写覆盖层、不新增任何写入路径。

## 1. 上游事实（omp 18.2.1 本机实测）

**① RPC 只暴露总量，不暴露分项。** `get_state.contextUsage` = `{tokens, contextWindow, percent}`，
其中 `percent` **实测就是 0–100 的百分比**（`tokens: 28529, contextWindow: 1000000, percent: 2.8529`），
不是 0–1 比例。RPC 命令表（`negotiate_protocol` … `transcribe` 共 50 个）里**没有**任何上下文分解方法；
omp 自己的 `/context` 斜杠命令与 TUI 状态行用的是内部 `computeContextBreakdown`，只在进程内可见。

> 历史坑：早期代码照「≤1 就乘 100」猜过一版百分比换算，会把真正占 **0.9%** 的会话显示成 **90%**
> （连带误触发「上下文 ≥80%」的压缩入口）。现在全应用统一走 `src/lib/ctxUsage.ts` 的
> `contextPercent()`，不再做任何区间猜测。

**② 非消息总量是落盘真值。** `get_state` 里还有 `systemPrompt`（字符串数组）与 `dumpTools`
（`{name, description, parameters}`），但**不含** token 数；omp 把「非消息部分」的 token 数写进了
每条 assistant 消息的 `contextSnapshot`：

```jsonc
// ~/.omp/agent/sessions/<slug>/<ts>_<id>.jsonl
{"type":"message","message":{"role":"assistant","usage":{…},
  "contextSnapshot":{"promptTokens":34901,"nonMessageTokens":26703,"compactionEpoch":0}}}
```

`nonMessageTokens` = 系统提示词 + 工具 + 技能 + 系统上下文（omp `ph()` = `countTokens(systemPrompt)`
+ 工具 schema），`promptTokens` 就是 omp 的 `usedTokens`。同一次 turn 的实时 `message_end` 事件里
`contextSnapshot` **是 null**（实测），所以只能按需读一次会话文件。

**③ omp 自己的五档口径**（`/context` 真机输出，1M 窗口、0 消息的新会话）：

```
Context window: 1000000 tokens (3% used)
  System prompt     5515 tokens     prompt[0] 去掉 <skills> 段
  System tools     10947 tokens     dumpTools（名字带 mcp__ 的是 MCP 工具）
  System context   11649 tokens     prompt[1..]（工作目录 / 仓库规则 / git 状态）
  Skills             418 tokens     prompt[0] 里的 <skills>…</skills> 段
  Auto-compact buf 150000 tokens ／ Free 821471 tokens
```

四档相加 **正好等于** `usedTokens`（5515+10947+11649+418 = 28529）。

**④ 会话累计缓存用量在会话文件里**：逐条 assistant 的 `usage.cacheRead / input / cacheWrite` 求和，
命中率口径与设置页「使用统计」一致（`cacheRead / (input + cacheRead)`）。

## 2. 实现

**后端 `src-tauri/src/context.rs`（1 个命令 `get_context_breakdown`）**

- **真值与估算的分界**：`usedTokens` / `contextWindow` / `nonMessageTokens` 是 omp 真值，
  「消息 = 已用 − 非消息」也是真值；**非消息的五档（消息以外）是按字符量估算**再整体缩放到
  `nonMessageTokens` 的结果——所以「各档之和恒等于真值」这条不变量成立，档与档之间怎么切才是估算。
  界面底部明写这一点，不给估算披真值的外衣。
- **估算系数**（按字符类）：ASCII 字母数字 ÷4、CJK/全角 ×0.8、其余 ÷4。系数是拿上面 ③ 的真机
  `/context` 输出校准的，同一份数据复算偏差：系统提示词 +1.0% / 工具 +0.5% / 系统上下文 −1.8% /
  技能 +22.5%（技能是 1.5% 的小档，绝对误差 94 token）。
- **会话文件扫描**：逐行找最后一条带 `contextSnapshot` 的 assistant 消息，同时累计逐轮 usage；
  行级前置筛 `"assistant"` 子串再解析 JSON；单文件超过 64MB 整块放弃（宁可少几行，不给偏低数字）。
- **读不到锚点就不硬凑**：文件里有 assistant 消息但没有 `contextSnapshot` → 不出分项，只给总量与缓存；
  文件里还没有 assistant 消息（新建会话）→ 锚点 = 已用（整段都是非消息，消息为 0，这是**准确**的）。
- **算术闭合**：最后一档（系统上下文）用减法收尾，保证各档之和**精确等于** `usedTokens`，
  不因四舍五入漂移。
- **顺带修一处真值回读缺口**：`contextUsage` 只在 `get_state` 回包里，此前只在 `set_model` /
  `set_thinking_level` 后回读——工具行上的上下文占用会一直停在「打开会话那一刻」（压缩入口也就
  永远不触发）。现在终态 `agent_end` 也回读一次（非终态不回读：还有排队 / 子代理在跑）。

**前端 `src/components/composer/ContextMeter.tsx` + `src/lib/ctxUsage.ts`**

- 挂在输入框工具行 `ModelPicker` **左侧**：容量环（`conic-gradient` + 径向遮罩掏空中心的**纯 CSS**
  圆环，与全项目图表同规矩，不引库、不引第二强调色）+ 11px mono 百分比；占用 ≥80% 转 `warn` 色
  （与压缩入口同阈值，颜色之外还有数字，不作唯一信号）。
- 面板（向上弹，与其他下拉同规矩）：标题行读数 `28.5K/1M（2.9%）`→ 分段总量条（按窗口占比堆叠，
  段序与行序一一对应，颜色只用 accent 的透明度档）→ 分项行（点 + 名称 + 百分比 + token 数）
  → 分隔线 → 平均缓存命中率（悬停给「缓存读 / 未缓存输入 / 缓存写」明细）→ 估算口径说明。
- 数据按会话 id 归属缓存：切走再回来不闪空，切到别的会话绝不串数据；每次点开重拉一次
  （旧数据先显示着，拉回来再替换）；失败退回只用 `omp-state` 真值画总量条，不弹错。
- 拿不到 `contextUsage` 时**整块不渲染**（与 `RuntimeStats` 同规矩），不是渲染一个空环。

**契约与文案**

- `src/shared/ipc.ts` 新增 `getContextBreakdown`；`types.ts` 新增 `ContextBreakdown` /
  `ContextCacheStats` / `ContextPartId`；`api.ts` 新增 `getContextBreakdown()`；
  `stores/app.ts` 的 `composerMenu` 加 `"context"`；`main.rs` / `lib.rs` 注册模块与命令；
  `scripts/e2e-ipc-selfcheck.mjs` 把 `context.rs` 纳入实现位置扫描。
- 字典新增 18 键 × 2 语言（`ctxTitle` … `ctxAria`）。
- `src/lib/ctxUsage.ts` 是**上下文用量的唯一格式化入口**（`contextPercent` / `fmtPercent` /
  `fmtTokens` / `fmtWindow`），状态条与容量环共用——避免再出现第二套百分比口径。

## 3. 完成口径

- `pnpm check` 全绿（typecheck + lint + test + e2e:ipc + e2e:rpc）；`cargo test` 全绿。
- `context.rs` 单测 10 项：字符类估算、技能段剥离、MCP 工具按 `mcp__` 前缀归类、缺 `systemPrompt`
  时不出权重、**各档之和精确等于已用**（含五档齐全断言，防漏推一档导致残差全落到收尾档）、
  无锚点时不硬凑分项、`percent` 同式且窗口 0 时不给值、会话文件快照与缓存累计、新建会话锚点。
- `ctxUsage.test.ts` 6 项：0–100 口径、<1% 不被放大、缺 `percent` 时按同式补算、窗口 0 给 null、
  百分比 / token / 窗口三档格式化。
- 真机数据校准：用 omp 18.2.1 真实 `systemPrompt` + `dumpTools` 复算，四档偏差见 §2（已记录，
  临时校验脚本不入库）。
- 界面核对：**未完成真机 GUI 核对**——验证时该仓库有另一个 ZCode 会话在并行改同一批前端文件，
  且 Tauri dev 裸二进制无 bundle id 导致坐标点击不可用、无障碍元素动作返回 not_found。
  本轮以「Rust 单测 + 真机数据校准 + typecheck/lint/e2e 全绿」为验收依据，界面留待干净环境复验。

## 4. 后续候选（需用户确认再开工）

- **自动压缩缓冲 / 可用余量两行**：omp `/context` 有这两行（`compaction` 配置组算出的
  `autoCompactBufferTokens` 与 `freeTokens`），能回答「离自动压缩还有多远」。
- **按工具逐个列占用**：现在 MCP 工具是整档聚合，`dumpTools` 里其实有每个工具的名字与描述，
  可以列到工具级（工具多时列表会长，需要折叠）。
- **快照对比**：把每次打开面板的读数存进覆盖层，画一条「上下文增长曲线」（属于写覆盖层，要先定口径）。
- **精确分项**：想彻底去掉估算，只有让 omp 把 `computeContextBreakdown` 暴露成 RPC 方法
  （上游改动，壳侧无法单方面实现）。
