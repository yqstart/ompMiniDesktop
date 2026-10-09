# ompMiniDesktop 十五期（V15）：设置 ›「供应商用量」——设计稿

> 基线：V14 已交付（工作区提交并推送）。本文只排 V15；实现落地后同步 `AGENTS.md`、`CHANGELOG.md`、`MASTER.md`。
> 用户口径：「设置中新增一个功能：供应商用量，展现方式是一个菜单，在使用统计下面。此功能可以自定义各个
> 供应商的滚动用量。是否可以支持通过读取 omp 供应商直接拿到滚动用量？如果不能读取到 omp 配置，
> 是否可以支持自定义配置去获取用量？」

## 0. 结论先行（对用户两个问题的实测答复）

| 问题 | 结论 |
|---|---|
| 能否**通过读取 omp** 直接拿到滚动用量？ | **能**。`omp usage --json` 是 omp 自带的一等命令（"Show provider usage limits for every authenticated account"），直接给出每个已登录账户、每个供应商的滚动窗口（5 小时 / 每周 / 每月…）：已用比例、重置时刻、套餐名、状态。本版就照它实现——壳侧不直连任何供应商接口、不读凭证库。 |
| 如果不能，是否支持**自定义配置**去获取用量？ | **已升级为「壳侧补充探针」**（2026-09-18 第二轮，见 §6；2026-09-30 第四轮全量适配，见 §8）：对 omp 没有探针、但上游提供「API key 可用」查询接口的供应商，壳侧直接补查——**16 个 provider**（plan 型：commandcode / minimax-code-cn；余额型：deepseek / openrouter / vercel-ai-gateway / moonshot / siliconflow / stepfun / novita / deepinfra / aimlapi / aiand / nanogpt / kilo / venice / zenmux）；凭据只经 `omp token` 在内存中传递、不落盘、不回传前端。**API key 查不到用量的（如 xiaomi）直接提示**「未提供 API 用量 / 余额查询接口」——不做 Cookie 粘贴之类的代偿（xiaomi 的 API key 通道已复核确认不存在，见 §8.2）。仍无查询路径的供应商显式列「无用量数据」；查询失败的单独列「查询失败」。 |

## 1. 上游事实（omp 18.2.5 本机实测，2026-09-18；V6 的 18.2.1 结论继续有效）

**① `omp usage --json` 输出结构**（本机实测，逐字节）：

```json
{ "generatedAt": 1789717791117,
  "reports": [{ "provider": "opencode-go", "fetchedAt": 1789717741696,
    "limits": [
      { "id": "rolling-5h", "label": "5 Hour limit",
        "scope": { "provider": "opencode-go", "windowId": "5h", "shared": true },
        "window": { "id": "5h", "label": "5 Hour", "resetsAt": 1789728611833, "durationMs": 18000000 },
        "amount": { "used": 8, "usedFraction": 0.08, "remainingFraction": 0.92, "unit": "percent" },
        "status": "ok" }, …],
    "metadata": { "planType": "OpenCode Go", "endpoint": "https://opencode.ai/zen/go/v1/usage" } }],
  "accountsWithoutUsage": [], "disabledCredentials": [], "capacity": { … } }
```

- 时间戳（`generatedAt` / `fetchedAt` / `window.resetsAt`）全是 **epoch 毫秒整数**；`amount.used` 是 0–100 刻度，`usedFraction` / `remainingFraction` 是 0–1 小数；
- `window.durationMs` 对 monthly **缺失**（月窗锚定订阅周年日）；`window` / `amount` / `status` / `notes` 都按可选解析（上游按 provider 自定义字段）；
- `metadata` 可能有 `email` / `accountId` / `orgName`（多账号识别用；本机单账号时没有）；
- `accountsWithoutUsage`（有探针但没拿到报告的账号）与 `disabledCredentials`（刷新失败被**自动停用**的凭据，含 `cause` / `disabledAtMs`）都带明细；
- 上游 `usage-cli.ts`（unreportedAccounts 归因 / 状态分级 / 窗口标题合并）是本页展示口径的对齐依据。

**② 语义与成本**：

- **无数据 = `reports: []` + 退出码 0**（未认证 / 上游失败都是这个形状）——不能靠退出码判错，空报告是正常结果；
- 冷启动约 1s，omp 自身报告缓存命中约 0.2s；`fetchedAt` 是数据真实抓取时刻（界面「更新于 N 前」用它）；
- `omp usage --json` **不含 `--redact` 影响**（`--redact` 只作用于人类可读文本与身份字段，JSON 的账号身份字段照给）——本页原样展示本地身份，不落盘、不上报；
- **只读**：不调 `omp usage invalidate`（清缓存是写操作）、`--history`（快照趋势）与 `clients`（按客户端拆 token）本批不做。

**③ V6 沿用**（`docs/v6-schedule.md` §1）：探针列表、`omp models --json` 冷启动 ~10s 的教训（「已配置供应商」只从模型目录**内存缓存**取，绝不塞进本页刷新路径）、告警阈值对齐 omp 自身判定（≥80% warning、用尽 exhausted）。

## 2. 设计

### 2.1 位置与入口

**现址（2026-09-29）**：**标签栏右上角的 `Gauge` 键**（`TerminalTabs`，`＋` 在它左侧）→ `ProviderUsageDialog` 弹窗
（`DialogShell` 承载，`stores/app.ts` 的 `providerUsageOpen` 控制挂载；组件从 `components/settings/ProviderUsagePanel.tsx`
挪到 `components/usage/ProviderUsageDialog.tsx`）；字典键 `pusageTitle`（「供应商用量」/ "Provider usage"）。
设置页不再有这一页签（**九页签 → 八页签**）——那里的「刷新」与「更新于 N 前」进了弹窗正文首行，其余展示口径不动。
标签栏原先的「快速切换」搜索键被这一枚替换（用户口径），快速切换仍可从左栏底部行与 `⌘⇧K` 打开。

**原始口径（V15 交付时，留档）**：设置页左栏菜单第 5 项（**使用统计之下、已归档对话之上**），图标 `Gauge`，
字典键 `tabProviderUsage`（「供应商用量」/ "Provider usage"）。设置页从五个页签变六个。

**入口搬迁实测（2026-09-29，`pnpm build` + `vite preview` + Chromium 注入 `__TAURI_INTERNALS__` mock，
1568×1176 视口，mock 覆盖 `get_health` / `get_models` / `list_projects` / `list_workspaces` / `list_checkouts` /
`get_workspace_git_state` / `check_omp_update` / `sync_title_prompt` / `get_provider_usage`，启动零 missing 命令）**：

| 检查 | 结果 |
|---|---|
| 标签栏右端两枚键 | DOM 顺序 = `新建终端` → `供应商用量`（`aria-label` 序列末两位），截图核对：`＋` 在左、`Gauge` 在右（最右格） |
| 原搜索键 | 已不在标签栏（`aria-label` 序列里只有左栏底部行的「快速切换」） |
| 快速切换可达性 | 左栏底部行照常；`⌘⇧K` 实测打开 QuickSwitcher（`aria-label="Switch terminals or workspaces"`） |
| 点 `Gauge` | `[role="dialog"][aria-label="Provider usage"]` 打开：`updated <1m ago` + `Refresh` + 两张卡（OpenCode Go `5h 5.0% / Weekly 2.0% / Monthly 73%`、deepseek `¥12.19 left`）+ 页脚说明 |
| 关闭 | `Esc` 后 `[role="dialog"]` 消失（`DialogShell` / `useDialogFocus` 既有口径） |
| 回归 | `pnpm check` 全绿：typecheck + lint（0 警告）+ **308 项前端单测**（新增 `TerminalTabs.test.tsx` 2 项：入口打开弹窗 + 顺序钉死）+ `e2e:ipc` 70 命令双向一致 |

### 2.2 数据流

```
ProviderUsageDialog（弹窗；V15 交付时是设置页页签 ProviderUsagePanel，2026-09-29 见 §2.1）
  → lib/providerUsage.ts（模块级快照 store：节流 60s + 单飞 + 失败保留旧值）
    → api.getProviderUsage() → Tauri command get_provider_usage
      → providers.rs::run_omp 跑 `omp usage --json`（30s 超时、stderr 尾部报错）
        → provider_usage.rs::parse_usage_json（纯函数解析，字段全容错）
      → configuredProviders 从 state.models_cache 取（模型目录内存缓存，不跑 omp models）
```

### 2.3 界面口径

- 每个供应商一张卡：`planType ?? provider`（主）+ `provider id`（次）+ 多账号时账号数与账号标识（`metadata.email → accountId → orgName`）；
- 每窗口一行：窗口名（`5h` / `7d` / `monthly` 走字典，未知 `windowId` 回退上游 `windowLabel`）+ 纯 CSS 进度条 + 百分比 + 重置倒计时；`notes` 有则下一行小字；
- 状态：<80% `accent`、≥80%（或上游 `status:warning`）`warn`、用尽（`exhausted` / ≥100%，条钳在 100%）`danger`——颜色之外永远有百分比数字与 sr-only 状态词；
- 「无用量数据」块 = `configuredProviders − reports`（配了但上游没探针）；「已停用的凭据」块（`danger` 色调）列出自动停用的账号 + 原因 + 「重新登录可恢复」；`accountsWithoutUsage` 非空给一行计数；
  - **用户主动动作的墓碑不进警示块（2026-10-09 用户实测修订）**：`omp auth-broker logout`（应用供应商页的「登出」就是它）对凭据做的是**软删**——本机 `agent.db` 实测只写 `disabled_cause = "logged out by user"`（行留在库里、不会自己消失），而 `omp usage --json` 每次都把它报进 `disabledCredentials`（上游 18.8.6 的 `gyi()` 只过滤 `deleted by user` / `replaced by …` 两类，登出这类故意留着）。照单渲染的结果是自相矛盾：在应用里登出 cursor 后，用量弹窗又红字提示「重新登录该供应商即可恢复」，且只要不重登就一直提示（用户实测：「我的 cursor 已经登出了，但是查询用量处还是展示 cursor 相关的内容」）。现在 `lib/providerUsage.ts` 的 `disabledCredentialsToWarn` 把**登出 / 删除 / 被替换**三类墓碑滤出警示块（刷新失败 / 上游失效等真故障照旧提示「重新登录可恢复」），该供应商整个从弹窗消失——「无用量数据」判定仍用**上游原始清单**（`providersWithoutUsage`），登出的供应商不会换个块再冒出来。回归：`providerUsage.test.ts`（三类墓碑 + 大小写 + 无 cause）+ `ProviderUsageDialog.test.tsx`（只含登出条目时整块不渲染）。
- 刷新：进入页签拉一次（60s 内复用模块缓存，切页签往返不重拉）+ 手动刷新；**不自动轮询**（设置页是查看场景，omp 自身缓存也是分钟级；要实时看用 TUI 的 `/usage`）；
- 相对时间（更新于 N 前 / N 后重置）每 30 秒推进一次（不随渲染乱跳）；失败保留旧值 + 一行错误，不闪空；
- 空态（无 reports）：说明「登录一个有用量查询的供应商后这里就会出现」；`OMP_MISSING` / 命令失败原样透传后端消息。

## 3. 实现

| 层 | 文件 | 内容 |
|---|---|---|
| 后端 | `src-tauri/src/provider_usage.rs`（新） | `get_provider_usage` 命令 + 解析（`parse_usage_json`）；**从 V11 删除的 `quota.rs` 恢复并增强**（新增 `accountLabel` / `notes` / `accountsWithoutUsage` 与 `disabledCredentials` 明细）；7 项单测 + 1 项真实 omp 慢测试（`#[ignore]`） |
| 注册 | `main.rs` + `scripts/e2e-ipc-selfcheck.mjs` | 注册命令；自检文件清单加入 `provider_usage.rs` |
| 契约 | `shared/ipc.ts` / `types.ts` / `api.ts` | `getProviderUsage` 常量 + `UsageLimit` / `ProviderUsageReport` / `ProviderUsageAccount` / `ProviderUsageDisabled` / `ProviderUsage` 类型 + API 方法 |
| 前端 | `src/lib/providerUsage.ts`（新） | 模块级快照（`useSyncExternalStore`，不占全局 Zustand）+ 节流 / 单飞 / 失败保留；纯函数 `groupReports` / `levelOf` / `latestFetchedAt` / `providersWithoutUsage` / `fmtPercent` / `formatDuration` / `formatAgo` |
| 前端 | `src/components/usage/ProviderUsageDialog.tsx`（V15 时在 `src/components/settings/ProviderUsagePanel.tsx`；2026-09-29 入口从设置页签挪到标签栏右上角，见 §2.1） + `SettingsPage.tsx` | 面板（卡片 / 窗口行 / 无数据块 / 停用块）+ `DialogShell` 弹窗壳与 `providerUsageOpen` 挂载（V15 时是页签接入，已退场） |
| 字典 | `locale.ts` | 新增 22 键 × 2 语言（`tabProviderUsage`、`pusage*`；`tabProviderUsage` 于 2026-09-29 改名 `pusageTitle`） |
| 测试 | `src/lib/providerUsage.test.ts`（11 项）、`src/components/usage/ProviderUsageDialog.test.tsx`（V15 时 5 项，现 8 项；文件原名 `ProviderUsagePanel.test.tsx`） | 纯函数 / 数据层行为（节流、单飞、失败保留）+ UI 映射（卡片、状态、空态、错误、多账号） |

## 4. 完成口径（2026-09-18 收口）

- `pnpm check` 全绿：typecheck + lint（0 警告）+ **136 项前端单测**（新增 16 项：`lib/providerUsage.test.ts` 11 + `ProviderUsagePanel.test.tsx` 5）+ `e2e:ipc`（**50 命令 × 双向一致**）；`pnpm build` 生产构建通过。
- `cargo test` 全绿：lib **88 项通过 / 3 项 `#[ignore]`** + 主二进制 **107 项通过 / 5 项 `#[ignore]`**（新增 `provider_usage` 7 项单测 + 1 项真实 omp 慢测试）；慢测试 `--ignored` 跑 `real_omp_usage_json_parses` **通过**——真实 `omp usage --json` 输出解析成功（实测 `opencode-go` 三窗口 `5h=10% / 7d=92% / monthly=46%` 滚动推进）；其余非 AI 消费的慢测试（真实 omp TUI、真实 omp models 校验、真实 agentDir 基准）同期复跑通过。
- **界面全流程核对**（vite dev + 注入 `__TAURI_INTERNALS__` mock，CDP main world 驱动；fixture 覆盖多供应商 / 多账号 / exhausted / 无数据 / 停用凭据）：
  - 菜单六项且顺序为 通用 → 模型 → 记忆 → 使用统计 → **供应商用量** → 已归档对话；
  - 卡片渲染：`OpenCode Go` 三窗口（8%/91%/46%，条宽与色档 `accent/warn/accent`）、`Claude Pro` 双账号（can@ / work@ 各行独立，102% → 条钳 100% + `danger` + 「已用尽」）、notes 行、`2 个账号`；
  - 「无用量数据」块列出 `commandcode` / `zai`（omp 无探针）；停用块列出 `zai` + 原因 + 「重新登录可恢复」；
  - 刷新：改 fixture 后点刷新 → `get_provider_usage` 调用 +1 且 55% 立即生效；
  - 切页签往返（使用统计 ↔ 供应商用量）：数据保留、调用数不变（60s 节流生效）；
  - 错误态：返回失败 → `role="alert"` 显示「读取供应商用量失败：omp 命令超时」且旧卡片保留；空态：空 reports → 空态文案、无错误行；
  - 视觉：浅色 / 深色 / 中英双语截图核对（进度条、状态色、卡片间距、窄容器换行无溢出）。
- **真机（Tauri WebView）交互级验证未做**：本机屏幕录制 / 辅助功能权限不可用（`computer.capabilities()` 三项全 denied，与 V11 / V14 同一环境限制），无法对真实窗口截图 / 点按。真实链路由 Rust 慢测试（真实 `omp usage --json`）+ 前端 mock 全流程独立覆盖；收口时用户已开着的 `pnpm tauri:dev`（vite 1420 端口）仍在运行（HMR 会带上前端改动；Rust 侧由 tauri dev 的文件监视器重建）。

## 5. 已知边界

- **不做**：历史趋势（`omp usage --history`）、按客户端拆 token（`omp usage clients`）、清缓存按钮（`invalidate` 是写操作）、超阈值系统通知、账号级历史曲线。
- 「已配置供应商」依赖模型目录内存缓存（`get_models` 的 5 分钟缓存）：极端情况下「app 启动后立刻打开本页」可能暂不显示「无用量数据」块，模型目录加载后下一次刷新即补上。
- omp 支持探针但本次抓取失败的账号会落进 `accountsWithoutUsage`（界面一行计数）——无法区分「上游一时失败」与「凭据失效」，后者需要重新登录时用户会在 TUI 里看到（`/usage`）。
- 「自定义配置获取用量」：**已实现为壳侧补充探针**（见 §6）——不再是"不做"。

## 6. 第二轮：壳侧补充探针（2026-09-18 追加）

> 用户口径（原话）：「commandcode 没有提供查询的 API 吗？这是 commandcode 的在线用量 https://commandcode.ai/…/settings/usage ，
> 你再去查一下看看支不支持 API，不支持可以配置一个跳转链接打开网页查看；还有 deepseek 官网应该支持余额、用量查询啊」。

### 6.1 调研结论（实测）

| 供应商 | omp 探针（18.2.5） | 上游查询接口 | 结论 |
|---|---|---|---|
| `commandcode` | **没有**（上游 `packages/ai/src/usage/` 无实现；全量 `omp usage --json` 被 cull 到连 `accountsWithoutUsage` 都不出现） | 官方文档只描述滚动窗口（5 小时 / 每周 / 月度 credits），**没有文档化用量 API**；但实测 `GET https://api.commandcode.ai/alpha/billing/credits`（`Authorization: Bearer <API key>`）**可用（HTTP 200）**——同域 `/internal/billing/*` 只认网页会话 cookie（API key 401「You're logged out」）。响应含 `windowLimits.fiveHour{used,cap,resetAt}`、`weekly{…}`、`credits.monthlyCredits`（**剩余**月度 credits）。配套 `GET /alpha/billing/subscriptions`（同 key 可用）给出 `currentPeriodEnd`（月度重置时刻）——**月度总额不在响应里**，用 5h/weekly 的 cap 组合反查官方套餐表（`14/35 → $70` 等），与官方页面「月度 22%」逐项对上 | **可查**：壳侧补充探针（API key 认证，两个端点并行） |
| `deepseek` | **没有** | 官方文档化接口 `GET https://api.deepseek.com/user/balance`（Bearer API key）→ `{is_available, balance_infos:[{currency,total_balance,…}]}`；**滚动窗口 / token 用量明细没有公开 API**（平台网页会话才有） | **可查余额**：壳侧补充探针（只展示余额） |

「配置跳转链接打开网页」因此**不需要**（两家都能直接查）；若未来某供应商既无 omp 探针也无 API key 可用的接口，再考虑加可配置外链。

### 6.2 设计与边界

- **触发条件**：供应商 ∈ 模型目录的「已配置」集合 **且** omp 报告里没有它（`run_probes` 里的两个 contains 判断）——omp 有探针的一律走 omp，壳侧不重复查。
- **凭证边界**：key 只经 `omp token <provider> --raw`（omp 官方 CLI、只读）取出，存于内存、仅用于本次请求头；**不落盘、不打印、不进错误消息、不回传前端**。`omp token` 没有凭据时**退出码仍可能为 0**（stdout 是 `No active credential found…`）——按内容判定（单行无空白），不看退出码。
- **HTTP**：Rust `reqwest`（`rustls-tls-webpki-roots`，纯 Rust 无系统依赖）+ 15s 超时；全部只读 GET。
- **解析容错**：alpha 端点未文档化——字段全按可选解析，缺数据报错而不伪造 0；失败产出 `extraFailures`（界面「查询失败 + 原因」），**不影响** omp 探针的任何数据。
- **展示形态扩展**：`UsageLimit` 增加金额面（`used` / `limit` / `remaining` / `unit`）——**主读数与 commandcode 官方页面同口径的百分比**（5 小时 / 每周 / 月度都画进度条；金额细节 `$0.31 / $14.00` 进悬停提示），余额型没有比例概念时显示「`¥110.00 剩余`」（不画条）。omp 的 percent 型窗口展示不变（`unit = percent` 时金额面为 null）。
  - 与官方页面逐项对照（2026-09-18 实测同刻）：5 小时 **2.2%**（官方 2%）/ 每周 **44%**（官方 44%）/ 每月 **22%**（官方 22%，总额 $70 由 cap 反查、重置时刻来自订阅端点）。
- 「无用量数据」清单排除**补充探针失败**与**停用凭据**的供应商（各有专门块），不再重复出现。

### 6.3 实现与验证

| 层 | 变更 |
|---|---|
| 后端 | 新模块 `src-tauri/src/extra_usage.rs`（注册表 `EXTRA_PROBES = ["commandcode","deepseek"]`、`extract_key` / `parse_commandcode_credits` / `parse_deepseek_balance` / `probe` / `run_probes`；7 项单测 + 1 项真实慢测试）；`provider_usage.rs` 的 `UsageLimit` 增加金额字段、`ProviderUsage.extraFailures`，命令尾部编排 `run_probes`；`Cargo.toml` 加 `reqwest`（同步 `THIRD-PARTY-NOTICES.md`） |
| 前端 | `UsageLimit` 类型扩字段；`lib/providerUsage.ts` 加 `fmtAmount` / `usedLimitText` / `remainingText` / `hasBar`；面板加金额 / 余额行与「查询失败」块；字典 3 键 × 2 语言 |
| 验证 | `pnpm check` 全绿（**142 前端单测**，本轮新增 6 项；`e2e:ipc` 50 命令不变）；`cargo test` 全绿（lib 88 + 主二进制 114，`extra_usage` 7 项单测）；**真实慢测试** `real_commandcode_probe` 通过——真实 `omp token` + 真实 HTTP 拉回 `5h=$0.31/$14（2.19%）、weekly=$15.23/$35（43.5%）、月度剩余 $54.77`；浏览器 CDP main-world 全流程核对（金额窗口 / 余额行 / 查询失败块 / 停用块 / 无数据块各就各位，进度条宽度 2.187% / 43.5% 与数据一致）+ 深浅两套截图 |
| 未覆盖 | deepseek 的真实端到端（本机无 deepseek 凭据；解析用官方文档结构 + 单测覆盖，字段漂移由结构与测试共同守护）；真机 WebView（同一环境权限限制） |

## 7. 第三轮：同窗口 id 多池子的行名动态化（2026-09-28）

> 用户口径：「cursor 的用量展示没有 5 小时、每周，只有 Cursor 池子和 API 池子，需要调整一下，是否能够动态调整，Cursor 的 API 中是否支持」。

### 7.1 上游实测（omp 18.3.5）

**Cursor 的接口没有 5 小时 / 每周窗口**——两个数据源都实测过（omp 的 cursor 探针正是这两个端口的组合，源码见二进制里 `packages/ai/src/usage/cursor.ts`）：

| 来源 | 认证 | 原始返回（2026-09-28 实测） |
|---|---|---|
| `GET https://api2.cursor.sh/auth/usage` | `Authorization: Bearer <token>`（omp 探针） | `{"gpt-4":{"numRequests":0,"numRequestsTotal":0,"numTokens":0,"maxTokenUsage":null,"maxRequestUsage":null},"startOfMonth":"2026-09-23T07:28:29.000Z"}`——**只有请求计数与月初锚点** |
| `GET https://cursor.com/api/usage-summary` | `WorkosCursorSessionToken` cookie（omp 探针） | `billingCycleStart/End`（订阅周期）+ `individualUsage.plan{autoPercentUsed, apiPercentUsed, totalPercentUsed}` + `individualUsage.onDemand`——**月度订阅周期 + 两类池子，没有任何 5h / 周字段** |

- Cursor 的计量维度就是**订阅月**（`billingCycleEnd` = 下月同日重置，实测还有 25 天）；`autoPercentUsed` / `apiPercentUsed` 是**共用同一月窗的两个池子**（included 额度 / API 额度），不是两个时间窗。5 小时 / 每周是别的供应商（Claude Code / OpenCode 等）的产品口径。
- omp 探针把 cursor 的每条窗口都标 `window: {id: "monthly", label: "Monthly"}`，与事实一致；`omp usage --json` 给 cursor 的三条 limit（label 各异）：`cursor:requests:gpt-4`（`gpt-4 requests`，无上限 → `unit: requests`）、`cursor:usd:individual-auto`（`Cursor Models`，percent 型）、`cursor:usd:individual-api`（`Other Models`，`$0.22 / $20.00`）。
- 壳侧缺陷：`windowName` 只按 `windowId` 走字典 → 三行全显示「每月」，分不清是哪个池子（用户看到的截图现象）。

### 7.2 修正（展示层；后端解析字段已足够，无 Rust 改动）

- `lib/providerUsage.ts` 新增 `windowNames(t, limits)`（**整组一起算**）：同一报告里出现 ≥2 个相同 `windowId`、且上游给了比通用窗口名更具体的 label（`label !== windowLabel`）时，行名用上游 label；否则维持原口径（5h/7d/monthly/balance 走字典、未知 windowId 回退上游）。
  - **动态**：未来 Cursor 真加了窗口、或别的供应商出现同 id 多池子，壳侧不改代码就能显示；字典只管通用窗口名的本地化。
  - 重复但上游也没给具体名（label = windowLabel）时回退字典名，不制造噪音。
- `ProviderUsagePanel`：行名渲染改走 `windowNames`（名字列 `w-16` → `w-28`，容纳上游英文名；notes 缩进同步为 `pl-[7.5rem]`）；**无比例、无上限的计数型窗口**（`gpt-4 requests`）读数显示「`0 requests`」而不是缺省 `usedFraction` 换算的「0.0%」（没有上限就没有百分比可谈）。
- 测试：`windowNames` 3 项单测（字典 / cursor 三池子 / 回退）+ 面板 1 项（三行名字精确匹配 + 计数读数）。

### 7.3 验证

- `pnpm check` 全绿（前端单测 **269 项**通过，本轮新增 4 项：lib +3、面板 +1；`e2e:ipc` 57 命令 × 双向一致）；`cargo test` 不受影响（无 Rust 改动）。
- **真实 Chromium 界面核对**（本项目 vite dev + 注入 `__TAURI_INTERNALS__` mock；fixture = cursor 三池子 + opencode-go 三窗口 + commandcode 金额三窗口 + deepseek 余额，中英双语各跑一轮）：
  - cursor 三行渲染为 `gpt-4 requests`（读数 `0 requests`）/ `Cursor Models`（`13%`）/ `Other Models`（`1.1%`），**不再出现三行「每月」**；
  - 通用供应商不受影响：opencode-go / commandcode 仍是「5 小时 / 每周 / 每月」（英文 `5 hours / Weekly / Monthly`）、deepseek 余额行不变（`¥110.00 剩余`）；
  - 名字列加宽后进度条起点对齐，卡片布局无溢出（截图核对）。
- Cursor 无 5h / 周窗口为**上游事实**（见 §7.1 两个端口的原始返回），壳侧不代偿、不造窗口。

## 8. 第四轮：全量厂商适配——plan / 余额两种模式（2026-09-30）

> 用户口径：「现在用量查询要支持两种模型，第一种是 plan 模式查询用量（例如 opencode go 和 cursor），
> 第二种是 API 调用查询余额（例如 deepseek）；先不管自定义供应商，现在要把 omp 支持的厂商都适配一下。
> 还有类似小米那种通过 apikey 查询不到的直接提示即可，不需要通过粘贴 cookie 的形式去查询
> （此处小米可不可以通过 apikey 去查询用量还需要你去调研一下）」。

### 8.1 覆盖矩阵（omp 18.4.4；全量 78 个内置 provider）

**两种查询模式**：**plan 型** = 订阅 / 滚动窗口额度（百分比 + 重置时刻，如 opencode-go、cursor）；
**余额型** = 按量计费余额（金额 / 货币，如 deepseek）。

| 类 | 数量 | 处理 |
|---|---|---|
| ① 上游探针覆盖（omp `packages/ai/src/usage/`） | 21 个 provider | 壳侧零改动、`omp usage --json` 直接展示：`anthropic`、`openai-codex`、`cursor`、`github-copilot`、`google-gemini-cli`、`google-antigravity`、`kimi-code`、`minimax-code`、`muse-code`、`ollama`、`ollama-cloud`、`opencode-go`、`commandcode`、`cline-pass`、`charm-hyper`、`devin`、`synthetic`、`umans`、`xai-oauth`、`zai`、`alibaba-token-plan`（覆盖范围从二进制 usage 注册表逐项核对） |
| ② 壳侧补充探针 | **16 个 provider**（本轮新增 14 + 既有 2） | plan 型 2：`commandcode`（既有）、`minimax-code-cn`（新增，上游只覆盖国际域 `minimax-code`）；余额型 14：`deepseek`（既有）、`openrouter`、`vercel-ai-gateway`、`moonshot`、`siliconflow`、`stepfun`、`novita`、`deepinfra`、`aimlapi`、`aiand`、`nanogpt`、`kilo`、`venice`、`zenmux`。端点 / 形状 / 出处见 §8.3 |
| ③ 无 API key 查询路径 | 其余（含若干非凭据伪 provider，如 `web` / `typesafe`） | 界面「无用量数据」**直接提示**（`pusageNoDataHint`：「未提供 API 用量 / 余额查询接口（可在其控制台查看）；模型可正常使用。」）；清单与理由见 §8.4 |

### 8.2 xiaomi（MiMo）：API key 查不了用量——直接提示，不代偿

用户指名复核「小米能不能用 API key 查用量」。**结论：不能**（2026-09-30 实测，omp 18.4.4）：

| 通道 | 实测结论 |
|---|---|
| API 网关（`api.xiaomimimo.com`） | 候选路径（`/v1/balance`、`/v1/usage`、`/v1/user/balance`、`/v1/credits`、`/v1/dashboard/billing/*` 等 20+ 条，`Bearer` 与 `api-key:` 两种头）**一律 404**（对照：`/v1/models` 200 且**无任何配额响应头**）。 |
| Token Plan 三区网关（`token-plan-{cn,sgp,ams}.xiaomimimo.com`） | 候选用量路径全 404；对照 `/v1/models` 对错误 key 返回 401（路由存在性判别法：401=存在、404=不存在）。 |
| 平台控制台接口 | `platform.xiaomimimo.com/api/v1/balance`、`/api/v1/tokenPlan/usage` **存在但只认小米账号 Cookie**——无 Cookie / API key / 无效 Cookie 一律 401 + `loginUrl`。 |
| 官方文档 / 社区 | 官方只提供控制台「用量信息」页（可导出），无 API；cc-switch #3230 社区同结论「mimo 没开」。 |

处理：**不注册探针、不做 Cookie 代偿**，落「无用量数据」直接提示。
（过程说明：本轮曾按上游 alibaba-token-plan 的「可选 Cookie 上报」先例实现过一版 Cookie 粘贴通道
——用户随后明确「不需要通过粘贴 cookie 的形式去查询」，该通道已整体移除：`usage_cookie.rs`、
两个 IPC 命令、弹窗配置块、字典键全部删除，不留半截代码。）

### 8.3 新增补充探针（14 个；端点与形状出处）

| provider | 模式 | 端点（GET，除注明外） | 形状 / 映射 | 出处 |
|---|---|---|---|---|
| `openrouter` | 余额 | `https://openrouter.ai/api/v1/key` + `…/credits`（best-effort） | 优先账户 credits 差（管理密钥）；普通 key 用 `limit_remaining` / `limit_reset`；没设上限时退化为「已消费」行（`windowId: spent`） | openrouter.ai/docs（get-current-key / get-credits） |
| `vercel-ai-gateway` | 余额 | `https://ai-gateway.vercel.sh/v1/credits` | `{balance,total_used}`（字符串 USD） | vercel.com/docs/ai-gateway/…/rest-api |
| `moonshot` | 余额 | `https://api.moonshot.ai/v1/users/me/balance` ＋ `.cn` 兜底 | `data.available_balance/voucher_balance/cash_balance`；`.ai`=USD、`.cn`=CNY；两站 key 不通用、谁成功用谁 | platform.kimi.com/docs/api/balance |
| `siliconflow` | 余额 | `https://api.siliconflow.com/v1/user/info` | `data.totalBalance`（字符串，USD）+ 充值 / 赠送备注 | docs.siliconflow.com（国际站文档；国内站接口已下线，见 §8.4） |
| `stepfun` | 余额 | `https://api.stepfun.com/v1/accounts` | `{balance,total_cash_balance,total_voucher_balance}`（CNY） | platform.stepfun.com/docs（获取账户信息） |
| `novita` | 余额 | `https://api.novita.ai/openapi/v1/billing/balance/detail` | `availableBalance` 等（字符串，单位 1/10000 USD） | novita.ai/docs（get-user-balance） |
| `deepinfra` | 余额 | `https://api.deepinfra.com/payment/checklist?compute_owed=true` | `stripe_balance` 负值=可用（正值=欠款）；`suspended` → exhausted | docs.deepinfra.com（billing/get-checklist） |
| `aimlapi` | 余额 | `https://api.aimlapi.com/v2/billing` | `{current_balance,currency}` | docs.aimlapi.com（account-balance） |
| `aiand` | 余额 | `https://api.aiand.com/billing/balance` | `{balance:"…",currency}` | docs.aiand.com/billing/balance |
| `nanogpt` | 余额 | **POST** `https://api.nano-gpt.com/api/check-balance`（`x-api-key` 头） | `{usd_balance,nano_balance}`（字符串） | docs.nano-gpt.com（check-balance） |
| `kilo` | 余额 | `https://api.kilo.ai/api/profile/balance` | `{balance}`（USD） | 官方开源客户端同款端点（Kilo-Org/kilocode） |
| `venice` | 余额 | `https://api.venice.ai/api/v1/billing/balance` | `balances.{usd,diem}` + `canConsume`；**需 ADMIN key**（401 时提示换个 key） | docs.venice.ai（billing/balance） |
| `zenmux` | 余额 | `https://zenmux.ai/api/v1/management/payg/balance` | `data.{total_credits,top_up_credits,bonus_credits,currency}`；**需 Management Key**（403 时提示单独创建） | zenmux.ai/docs（payg-balance） |
| `minimax-code-cn` | **plan** | `https://api.minimaxi.com/v1/token_plan/remains` | `model_remains[]`：间隔窗（按时长命名，5 小时 → `5h`）+ 每周 `7d`；`remaining_percent` 0–100 → 已用百分比；与上游 `minimax-code` 探针同形状（从 omp 二进制同款实现核对）；两计数全 0 的模型跳过 | omp 二进制同款实现 + 实测路由 |

### 8.4 不做探针、直接提示的供应商（调研结论 2026-09-30）

| 供应商 | 结论与证据 |
|---|---|
| `xiaomi` / `xiaomi-token-plan-*` | 见 §8.2：无任何 API key 路径 |
| `siliconflow-cn` | 同款 `/v1/user/info` 官方 2026-08-14 下线（有效 key 返回 410），替代接口未公布 |
| `zhipu-coding-plan`（含 BigModel 余额） | 只有未文档化的控制台内部路由（`/api/monitor/usage/quota/limit`、`/api/biz/account/query-customer-account-report`）；社区实证有，但属于把 API token 发往非文档控制台端点的凭据边界扩张（CodexBar PR #3109 因此被要求改为 opt-in）——**不采用** |
| `xai` / `minimax` / `minimax-cn` | 推理 key 无余额接口（xAI 余额在独立 Management API 且需 team/management key；MiniMax 余额仅控制台） |
| `opencode-zen` | 官方 issue #10448 确认无公开余额接口（`/zen/v1/usage`、`/zen/v1/balance` 均 404；余额只有浏览器 cookie 可得）；`opencode-go` 已有上游探针 |
| `alibaba-coding-plan` | 用量只经官方 CLI 的**控制台会话**（`auth: 'console'`） |
| `qwen-portal` / `gitlab-duo(-agent)` | OAuth 型，端点不返回配额（qwen-code #331 官方回复） |
| `mistral` / `groq` / `cerebras` / `together` / `fireworks` / `baseten` / `coreweave` / `huggingface` / `nvidia` | 无公开余额接口（mistral 仅 Admin key 的用量；fireworks / baseten / coreweave 只有用量导出，无余额；nvidia credits 制度已取消） |
| `gmi-cloud` / `firepass` / `sakana` / `qianfan` / `meta` / `wafer-serverless` / `yolo-auto` / `singularityapi-*` / `abliteration` / `litellm` / `lm-studio` / `llama.cpp` / `vllm` / `local` 等 | 无文档化可用接口 / 非托管余额语义（本地引擎）/ 信息不足（wafer 的 usage 页已下架且探测不构成路由存在证据；abliteration 只有推理文档）；`cloudflare-ai-gateway` 的 credits API 需要 Cloudflare **账户级 API token**（不是网关 API key），不可用同一凭据查询；`litellm` 是自托管代理、余额语义在下游 key 上 |
| `google` / `openai` / `azure` / `amazon-bedrock` / `bedrock-mantle` / `google-vertex` | 无 API key 可查的余额 / 用量接口（账单类接口另有管理面与权限要求） |

### 8.5 实现与验证

| 层 | 变更 |
|---|---|
| 后端 | `extra_usage.rs`：`EXTRA_PROBES` 扩到 16 个；新增 14 个解析函数（含共享 `balance_row` / `num_str` / `err_status` / `explain_auth` 助手）、`fetch_json_x_api_key`（nanogpt 的 POST）、拆出 `probe_with_key` 供「无效 key 全量路由核对」慢测试复用；**移除**上一版的 `usage_cookie.rs` 与 Cookie 通道（模块 / 命令 / 编排一起删净） |
| 前端 | 删除 Cookie 配置块与相关 IPC / 类型 / 字典键；`windowNames` 增加 `spent`（「已消费 / Spent」）映射；「无用量数据」提示文案改为「未提供 API 用量 / 余额查询接口（可在其控制台查看）；模型可正常使用。」；`e2e:ipc` 回到 71 命令 |
| 验证（解析层） | `cargo test` 新增 13 项单测（每个新端点一条，fixture 取自各官方文档；含 openrouter 三种回退、moonshot 双站币种、deepinfra 负值语义、novita 1/10000 缩放、minimax plan 窗口等边界） |
| 验证（真实端点） | `real_extra_probe_routes`（`--ignored`）：用无效 key 对 **16 个探针全量打真实端点**——15 个新 / 旧端点全部返回可读错误（401 归一 / 业务码归一），**无 404、无 DNS 失败、无 panic**；venice / zenmux 的「需要 ADMIN / Management Key」提示与 minimax-cn 的 `login fail` 业务码均在真实响应上核对 |
| 验证（界面） | 构建产物 + `__TAURI_INTERNALS__` mock 的真实 Chromium：新余额行（`$… 剩余` + notes）、`spent` 行（「已消费」）、minimax plan 行（5 小时 / 每周 + Requests 备注）、「无用量数据」新提示文案与「查询失败」块逐项截图核对（详见交付记录） |
| 未覆盖 | 各新端点的**真实成功响应**（本机只有 deepseek / commandcode / xiaomi / opencode-go / cursor 的凭据；其余按官方文档形状解析 + 全容错，字段漂移只报「查询失败」）；真机 WebView（同既有权限限制） |
