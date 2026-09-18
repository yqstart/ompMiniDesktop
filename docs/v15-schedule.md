# ompMiniDesktop 十五期（V15）：设置 ›「供应商用量」——设计稿

> 基线：V14 已交付（工作区提交并推送）。本文只排 V15；实现落地后同步 `AGENTS.md`、`CHANGELOG.md`、`MASTER.md`。
> 用户口径：「设置中新增一个功能：供应商用量，展现方式是一个菜单，在使用统计下面。此功能可以自定义各个
> 供应商的滚动用量。是否可以支持通过读取 omp 供应商直接拿到滚动用量？如果不能读取到 omp 配置，
> 是否可以支持自定义配置去获取用量？」

## 0. 结论先行（对用户两个问题的实测答复）

| 问题 | 结论 |
|---|---|
| 能否**通过读取 omp** 直接拿到滚动用量？ | **能**。`omp usage --json` 是 omp 自带的一等命令（"Show provider usage limits for every authenticated account"），直接给出每个已登录账户、每个供应商的滚动窗口（5 小时 / 每周 / 每月…）：已用比例、重置时刻、套餐名、状态。本版就照它实现——壳侧不直连任何供应商接口、不读凭证库。 |
| 如果不能，是否支持**自定义配置**去获取用量？ | **已升级为「壳侧补充探针」**（2026-09-18 第二轮，见 §6）：对 omp 没有探针、但上游提供「API key 可用」查询接口的供应商，壳侧直接补查——`commandcode` 走 `api.commandcode.ai/alpha/billing/credits`（实测 API key 可用：返 5 小时 / 每周额度与重置时刻 + 月度剩余 credits），`deepseek` 走官方 `GET /user/balance` 余额接口（文档化）；凭据只经 `omp token` 在内存中传递、不落盘、不回传前端。仍无查询路径的供应商显式列「无用量数据」并写明原因；查询失败的单独列「查询失败」。 |

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

设置页左栏菜单第 5 项（**使用统计之下、已归档对话之上**），图标 `Gauge`，字典键 `tabProviderUsage`
（「供应商用量」/ "Provider usage"）。设置页从五个页签变六个。

### 2.2 数据流

```
ProviderUsagePanel（设置页页签）
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
| 前端 | `src/components/settings/ProviderUsagePanel.tsx`（新） + `SettingsPage.tsx` | 页签接入（TABS / TAB_ICONS / label 映射 / 渲染分支）+ 面板（卡片 / 窗口行 / 无数据块 / 停用块） |
| 字典 | `locale.ts` | 新增 22 键 × 2 语言（`tabProviderUsage`、`pusage*`） |
| 测试 | `src/lib/providerUsage.test.ts`（11 项）、`src/components/settings/ProviderUsagePanel.test.tsx`（5 项） | 纯函数 / 数据层行为（节流、单飞、失败保留）+ UI 映射（卡片、状态、空态、错误、多账号） |

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
