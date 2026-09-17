# ompMiniDesktop 六期（V6）功能排期：用量限额入口

> **历史存档（V11 起）**：本文档描述 V1–V10 的「聊天界面」形态；现行形态是终端工作区
> （见 `docs/v11-schedule.md`）。文中涉及聊天渲染 / RPC 驱动的部分已不再对应当前代码，
> 其余（设置页各页签、语言/皮肤、发版等）仍然有效。


> 基线：V1–V5 已交付（见 `CHANGELOG.md`）；本文只排六期，不重开已冻结的口径。
> 目标：把**供应商侧的配额窗口**（opencode 网站那种「5 小时 / 每周 / 每月」限额）搬到对话界面——
> 输入框上方的上下文条（项目 / 分支之后）加一个进度条入口，点开看全部供应商的窗口明细。
> 约束不变：真相在上游；壳侧只映射 omp 已暴露的能力，不自己调 API、不碰凭证库、不自算比例。

## 0. 范围与口径

用户口径：「在输入框上方（项目 / 分支右侧）加一个 usage，点击可以查看用量——像 opencode 网站上的
5 小时 / 周 / 月用量那样」。

| 位置 | 区块 | 映射的上游物 | 写入什么 |
|---|---|---|---|
| 输入框上方上下文条 | 收起态：当前供应商主窗口的进度条 + 百分比 | `omp usage --json` | **不写** |
| 同上 | 展开态：按供应商分段的窗口明细（标签 + 进度条 + 百分比 + 重置倒计时 + 更新时间） | 同上 | — |
| 同上 | 无用量数据的供应商：一块说明（配了它、但上游没有该供应商的探针） | 模型目录缓存里的供应商集合 − 有报告的供应商 | — |

**这不是**设置页那张「使用统计」（那是本地会话 jsonl 的 token 聚合，`usage.rs`），
也**不是**输入框工具行的上下文容量环（那是上下文窗口占用，`ContextMeter`）。
三者数据源与语义各不相同，不许互相替代或合并。

范围外（本批不做）：历史趋势（`omp usage --history`）、按客户端拆 token（`omp usage clients`）、
强制清缓存（`omp usage invalidate` 是写操作）、超阈值系统通知、账号身份展示（上游 JSON 里本来就没有）。

## 1. 上游事实（omp 18.2.1 本机实测）

**① `omp usage` 是 omp 自带的一等命令，且支持机读**

```
$ omp usage --help
Show provider usage limits for every authenticated account

USAGE
  $ omp usage [ACTION] [FLAGS]

ARGUMENTS
  ACTION   Optional subcommand to execute (invalidate|clients)

FLAGS
  -j, --json              Output usage reports as JSON
  -p, --provider=<value>  Only show usage for this provider id (e.g. anthropic)
  -r, --redact            Redact account emails/ids (shortest unique prefix) for sharing screenshots
      --history           Show recorded usage-limit history (hourly snapshots) instead of a live snapshot
  -d, --days=<int>        History window in days (with --history or clients)
```

omp 内部为 22 个供应商实现了用量探针（`packages/ai/src/usage/*`：opencode-go / claude / openai-codex /
cursor / zai / kimi / minimax-code / cline-pass / github-copilot …）。**壳侧不需要知道任何一家的
端点与字段**——那是 omp 的事。没有用量模块的供应商（如 `commandcode`、`deepseek`）不会出现在报告里。

**② JSON 形状（本机实测，opencode-go）**

```json
{ "generatedAt": 1789551241099,
  "reports": [{ "provider": "opencode-go", "fetchedAt": 1789551241090,
    "limits": [
      { "id": "rolling-5h", "label": "5 Hour limit",
        "scope": { "provider": "opencode-go", "windowId": "5h", "shared": true },
        "window": { "id": "5h", "label": "5 Hour", "resetsAt": 1789554297142, "durationMs": 18000000 },
        "amount": { "used": 26, "usedFraction": 0.26, "remainingFraction": 0.74, "unit": "percent" },
        "status": "ok" },
      { "id": "weekly",  "window": { "id": "7d", "label": "Weekly", "resetsAt": ..., "durationMs": 604800000 }, ... },
      { "id": "monthly", "window": { "id": "monthly", "label": "Monthly", "resetsAt": ... }, ... } ],
    "metadata": { "planType": "OpenCode Go", "endpoint": "https://opencode.ai/zen/go/v1/usage" } }],
  "accountsWithoutUsage": [], "disabledCredentials": [], "capacity": { ... } }
```

- 时间戳（`generatedAt` / `fetchedAt` / `window.resetsAt`）全是 **epoch 毫秒整数**，不是 ISO 串；
- `amount.used` 是 **0–100 刻度**，`usedFraction` / `remainingFraction` 是 **0–1 小数**；
- `window.durationMs` 对 **monthly 缺失**（月窗锚定订阅周年日，不是固定时长）→ 必须按可选字段解析；
- `metadata` 是 provider 自定义对象，字段不保证存在；
- JSON 里**不含账号身份**（`--redact` 对 JSON 是 no-op），所以壳侧不传该 flag。

**③ 无数据 = `reports: []` + 退出码 0**

provider id 写错、未认证、上游失败都是同一形状（exit 0 + 空报告）。**不能靠退出码判错**——
空报告是正常结果（界面据此显示「没有可显示的用量限额」），只有"输出根本不是 JSON"才算失败。

**④ 调用成本与缓存**

冷启动约 **1.0s**，omp 自身报告缓存命中约 **0.19s**（`fetchedAt` 不变而 `generatedAt` 变）；
缓存 TTL 实测 ≥74s（omp 侧 5 分钟量级）。所以壳侧的刷新节奏取 **5 分钟**（页面可见时），
打开浮层时强制拉一次——频率再高也只是重复读同一份缓存。

**⑤ `omp models --json` 很贵（冷启动约 10s，实测可到分钟级），不能塞进配额刷新路径**

「配了哪些供应商」只能从模型目录拿，但那条命令冷启动实测 **10.36s**（要逐个供应商探测；
omp 自身有缓存时 ~0.2s）。所以：壳侧**只读 `state.models_cache`**（`get_models` 的 5 分钟内存缓存，
过期也照用——供应商集合是慢变量），完全没有缓存时不带这份数据（界面退化为不显示说明行）；
`App.tsx` 启动时静默把模型目录拉进 store，让缓存通常都在。**任何"顺手跑一下 `omp models`"
的写法都会让用量入口在冷启动时卡十几秒。**

## 2. 实现

**后端（`src-tauri/src/quota.rs`，1 个命令）**

| 命令 | 干什么 |
|---|---|
| `get_provider_usage()` | 跑 `omp usage --json`，解析成 `ProviderUsage{generatedAt, reports[], accountsWithoutUsage, disabledCredentials, configuredProviders[]}`；`configuredProviders` 取自模型目录的**内存缓存**（不自己跑 `omp models --json`） |

- 进程调用复用 `providers.rs` 的 `run_omp`（同一套 30s 超时与 stderr 尾部报错口径），omp 路径走
  `discover_omp_path`（与「指定 omp 路径」同一条解析链）。
- 纯解析函数 `parse_usage_json` 单独成函数：只要求 `limits[].id` 存在，其余全容错
  （缺 `window` / `amount` / `status` 都给中性值，缺 id 的窗口跳过）；**空 reports 返回 Ok**。
- **只读**：不调 `invalidate`（清缓存是写操作），不读凭证库、不落盘。
- 6 项单测：真实输出逐窗口解析、月窗无 `durationMs`、空 reports 不是错误、坏 JSON 报错、
  缺字段容错 + 缺 id 跳过 + 只有 `used` 时按 0–100 折算、多供应商顺序与 `exhausted` 状态。

**前端（`src/components/composer/UsageLimits.tsx` + `src/lib/usageLimits.ts`）**

- 位置：`ContextBar`（输入框上方一行）第三项，紧跟分支选择器；复用 `composerMenu` 互斥槽
  （新增 `"usage"`）与 `useDropdown`（点击外部 / Esc 关闭）。
- 收起态：`Gauge` 图标 + 窗口名（5 小时 / 每周 / 每月）+ 细进度条 + 百分比。显示**当前会话模型
  的供应商**（`currentModel` 的 `provider/` 前缀）的主窗口（优先 `5h`——最先撞墙）；
  当前供应商没有配额数据但别的供应商有时，退化为中性的「用量」按钮。
- 展开态：按供应商分段（当前供应商排首位，其余保持上游顺序），每窗口一行 =
  窗口名 + 进度条 + 百分比 + 「N 后重置」；标题行给「用量限额 · 更新于 N 前」+ 刷新按钮。
- **一份窗口都拿不到时整块不渲染**（配额是可选面，未登录支持的供应商就没有入口）。
- 刷新：挂载静默拉一次、页面可见时每 5 分钟一次、打开浮层强制一次、浮层内手动一次；
  失败**保留上一份数据** + 一行错误，不闪空。
- 载入态与错误都存 store（`providerUsage` / `providerUsageLoading` / `providerUsageError`），
  组件内不持 loading state（React 规则：effect 里不同步 setState），切设置页回来不重拉。
- 配色：<80% `accent`、≥80% `warn`、≥100% 或 `exhausted` `danger`（阈值对齐 omp 自己的判定），
  纯 CSS 百分比宽度，不引图表库；颜色之外还有百分比数字，不作唯一信号。
- 窗口名走本应用字典（5 小时 / 每周 / 每月），未知 `windowId` 回退上游 `label` 原文。

**契约与文案**

- `src/shared/ipc.ts` 新增 `getProviderUsage`；`src/shared/types.ts` 新增 `UsageLimit` /
  `ProviderUsageReport` / `ProviderUsage`；`src/shared/api.ts` 新增 `getProviderUsage()`；
  `src-tauri/src/main.rs` 注册命令；`scripts/e2e-ipc-selfcheck.mjs` 把 `quota.rs` 纳入实现位置扫描。
- 字典新增 12 键 × 2 语言（`usageLimitsTitle` … `usageLimitsFoot`）；上游数据（provider / planType /
  上游窗口名 / 百分比）不进字典，原样透传或只做格式化。

**多供应商与「拿不到用量」的展示（V6 追加设计）**

`omp usage` 只对**有探针**的供应商报配额；配了没探针的供应商时（本机实测：`commandcode` 有
api-key 登录与 69 个模型，但 omp 18.2.1 里**没有**它的用量实现——上游 issue `can1357/oh-my-pi#10169`
仍开着，端点是 `https://api.commandcode.ai/alpha/billing/credits` 这类未文档化 alpha 接口），
`omp usage --json` 里**连 `accountsWithoutUsage` 都不出现**，等于该供应商在数据里不存在。
如果界面也不提，用户看到的就是「我明明配了，它却不见了」——沉默比一行说明糟糕得多。

于是：

- 后端 `get_provider_usage` 把模型目录里的供应商集合作为 `configuredProviders` 返回（与设置页
  「已配置」同一条口径，复用 `providers.rs::configured_set`）。**注意它读的是现有缓存，不自己跑
  `omp models --json`**：实测那条命令冷启动约 **10 秒**（要逐个供应商探测），配额刷新不该被它拖住；
  供应商集合是慢变量，缓存过期也照用，完全没有缓存时才不带这份数据（界面退化为不显示说明行）。
  配套地 `App.tsx` 启动时就把模型目录拉进 store（后台静默），这样缓存通常都在。
- 前端 `providersWithoutUsage(usage, provider)` = `configuredProviders − reports[].provider`，
  **当前会话的供应商排首位**（它最可能是「我明明在用」的那一个）。
- 浮层里每个这样的供应商一块：`provider id + 「无用量数据」+ 「omp 暂不支持查询这个供应商的用量
  （模型仍可正常使用）」`；最多列 4 个，其余折叠成「另有 N 个供应商无用量数据」。
- 入口渲染条件从「有窗口数据」放宽为「有窗口数据 **或** 配了供应商 **或** 最近一次查询失败」——
  否则只配了 `commandcode` 的用户完全没有入口，也就看不到任何解释。
- **收起态的可用性直接编码「能不能查」**（用户口径：能查到就能点，查不到就置灰）：
  - 当前模型的供应商有窗口数据 → 进度条 + 可点；
  - 当前模型的供应商**已知没有查询路径** → **置灰不可点**（`disabled` + `opacity-40` +
    `cursor-default`），悬浮说明写清是哪个供应商、为什么；
  - 一次都没查到且最近一次失败 → 同样置灰，悬浮说明是错误原因；
  - 没有「在用的模型」（未选会话）→ 可点（看全部供应商的额度）；
  - **有旧数据但刷新失败** → 继续显示旧值（可点，浮层里给一行错误）——不该把已经能看到的东西收走。
  判定收在 `usageEntryDisabled(usage, provider, error)` 一个纯函数里（5 项单测：unsupported /
  failed / idle / 有旧数据不置灰 / 旧后端缺字段不误判）。
  - **不摆假数字、不拿别家的额度顶上**：置灰就是置灰，不换个供应商的数字充数。

**要不要壳侧自己实现 commandcode 的探针**：不做——那需要从 omp 取 API key（壳侧接触凭证，
违反「不直读凭证库」的口径），且端点是逆向的 alpha 契约（字段大小写都不稳）。
正确的路径是等 omp 上游实现探针（issue 已开），届时这里**自动**多出一块，无需改代码。



- `pnpm check` 全绿（typecheck + lint + test + e2e:ipc + e2e:rpc）：`e2e:ipc` 覆盖 **57** 个命令。
- `cargo test` 全绿（lib 72 项 + 主二进制 87 项通过 / 1 项 `#[ignore]` 真机基准，其中 quota 6 项）。
- 前端 vitest **147** 项通过（1 项 bench 跳过），其中 `src/lib/usageLimits.test.ts` **21** 项：
  供应商前缀解析、报告选择与排序、主窗口挑选、告警档阈值、`hasLimits` / `hasUsageEntry`、
  `providersWithoutUsage`（已配置 − 有报告、当前供应商优先、旧后端缺字段兜底）、
  `usageEntryDisabled`（unsupported / failed / idle / 有旧数据不置灰 / 缺字段不误判）、
  中英相对时间文案（含负数时钟偏差）。
- 真机实测（`pnpm tauri:dev` 裸二进制 + omp 18.2.1 / opencode-go，2026-09-16 17:5x）：
  - `omp usage --json` 基线：`opencode-go`（`OpenCode Go`）5 小时 **31%** · 每周 **39%** · 每月 **20%**
    （`resetsAt` 为毫秒整数）；冷启动约 1.0s，第二次 0.19s（omp 侧报告缓存）。
  - 界面浮层逐项对齐（同一账号，几分钟后再次读取随用量推进到 **34% / 40% / 20%**）：
    「用量限额 · 更新于 2 分钟前」+ provider 行（`OpenCode Go` + `opencode-go`）+
    三行窗口（`5 小时 34% 26 分钟后重置` / `每周 40% 4 天 14 小时后重置` / `每月 20% 25 天 20 小时后重置`）
    + 脚注「数据来自 omp 的用量查询 · 只读」。倒计时与 `resetsAt - now` 手算一致。
  - 收起态：有会话且当前供应商有配额时，按钮 aria 为「用量限额：5 小时 已用 34%」，
    视觉为 `Gauge` 图标 + 「5 小时」+ 40px 进度条 + `34%`；无会话（`currentModel` 未回填）或
    当前供应商没有配额数据时退化为中性的「用量」按钮（不猜、不显示别的供应商的额度）。
  - 位置与共存：位于上下文条第三项（项目 / 分支之后），与工具行的 `ContextMeter`（上下文容量）
    和模型 / 思考档选择器互不干扰；浮层向上弹，只遮消息流。
  - 打开浮层时按当前状态重拉（`generatedAt` 推进），失败保留旧值（未在真机复现失败路径，
    由单测与代码路径保证）。
- 已知的复验缺口（环境原因，非功能问题）：英文界面与窄窗换行未做真机截图（字典键一致性由
  `locale.test.ts` 守着）。**浮层「重置时间被截断」已修并在真机复验**（`w-80` → `w-96`、
  重置列 `w-24` → `w-32`、中文文案去空格后，「4 天 12 小时后重置」完整显示）。
- 多供应商真机复验（2026-09-16 19:1x）：本机配了 **`commandcode`（69 个模型）+ `opencode-go`（38 个）**，
  浮层如实渲染成两块——`OpenCode Go opencode-go` 三条窗口（`5 小时 1.0% · 4 小时 44 分后重置` /
  `每周 41% · 4 天 12 小时后重置` / `每月 21% · 25 天 18 小时后重置`，与 `omp usage` 输出一致），
  以及 `commandcode · 无用量数据 · omp 暂不支持查询这个供应商的用量（模型仍可正常使用）`。
- **置灰的真机复验（19:36，真实场景）**：当前会话的模型是 `commandcode/deepseek-v4.1-flash`（工具行显示
  `DeepSeek V4.1 Flash`）→ 上下文条上的按钮**置灰不可点**，无障碍名即悬浮说明
  「commandcode 没有用量数据（omp 暂不支持该供应商的用量查询）」，视觉上「用量」两个字明显比对侧的
  项目 / 分支暗（`opacity-40`）；切到 opencode-go 的会话即恢复成进度条。
- 时序说明：`configuredProviders` 要等模型目录进缓存（`App.tsx` 启动时拉，冷启动十几秒）——极端情况下
  "启动后立刻打开浮层"可能看不到说明行，等目录加载完再刷新（或 5 分钟后的自动刷新）就有。

## 4. 后续候选（需用户确认再开工）

- **壳侧自带探针**（commandcode 这类 omp 未实现的供应商）：技术上可行——`api.commandcode.ai`
  的 `/alpha/whoami` / `/alpha/billing/credits`（`windowLimits.fiveHour|weekly` + `credits`）
  就是官方 CLI `/usage` 用的同一套接口，凭证也用同一把 API key。但要走壳侧就要从 omp 取 key
  （或让用户为这个应用**单独**填一把），且契约是逆向的 alpha 接口（字段 camelCase/snake_case 两种形态、
  月额度要靠 planId 映射推算）。**建议先等 omp 上游**（issue 已开），除非用户明确接受这两条代价。
- **超阈值提醒**：占用 ≥80% / 用尽时给系统通知（现有 `useTaskNotifications` 通道），或把按钮点亮成 warn。
- **历史趋势**：`omp usage --history --days N` 已经有小时级快照，可画一张窗口占用曲线。
- **按客户端拆 token**：`omp usage clients --days N`（哪台机器 / 哪个 app 花了多少），与配额是同一套数据源。
- **账号级明细**：多账号时的分行展示（当前只按供应商聚合；上游 JSON 不含账号身份，需要读人类可读输出）。
- **设置页入口**：把同一份数据也放进设置 ›「使用统计」顶部，作为「本轮 / 全局」之外的第三块。
