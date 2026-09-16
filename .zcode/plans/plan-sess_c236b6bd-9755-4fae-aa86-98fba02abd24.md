## 在输入框上方上下文条加「用量限额」入口（V6）

你要的是 opencode 网站上那种 **5 小时 / 每周 / 每月限额**的进度条，不是本地 token 统计。调研后确认了一个关键事实：**omp 18.2.1 自带 `omp usage` 命令**，本机实测已能拿到 opencode-go 的三档配额——所以壳侧走「子进程 + JSON」薄映射即可，**不需要自己实现 HTTP 请求、也不碰任何 API key**（与设置 › 供应商页走 `omp auth-broker` 完全同款的做法）。

### 上游事实（本机实测，`omp usage --json`）

```json
{ "generatedAt": 1789551241099,
  "reports": [{ "provider": "opencode-go", "fetchedAt": 1789551241090,
    "limits": [
      { "id": "rolling-5h", "label": "5 Hour limit",
        "window": {"id":"5h","label":"5 Hour","resetsAt":1789554297142,"durationMs":18000000},
        "amount": {"used":26,"usedFraction":0.26,"remainingFraction":0.74,"unit":"percent"},
        "status": "ok" },
      { "id": "weekly",  ... "percent": 36% ... },
      { "id": "monthly", ... "percent": 19% ...（无 durationMs）} ],
    "metadata": {"planType":"OpenCode Go","endpoint":"https://opencode.ai/zen/go/v1/usage"} }],
  "accountsWithoutUsage": [], "disabledCredentials": [], "capacity": {...} }
```

- 时间戳全是 **epoch 毫秒整数**（不是 ISO）；`used` 是 0–100 刻度，`usedFraction` 是 0–1 小数；`window.durationMs` 只在 monthly 缺失。
- 冷启动调用 **~1.0s**，缓存命中 **~0.19s**（omp 自己有 ~74s+ 的报告缓存，`fetchedAt` 是真实抓取时刻）。
- **无数据 = `reports: []` + 退出码 0**（provider 写错 / 未认证 / 上游失败都长这样），不能靠退出码判错。
- `commandcode`、`deepseek`、`opencode-zen` **没有**配额模块（omp 内置 22 个 provider 适配器，其中就有 opencode-go / claude / codex / cursor / zai / kimi 等），所以入口只对「omp 能报配额的供应商」有数据。

### 交互设计

**收起态（红框处，进度条形式）**：`▤ [████░░░░] 26%` —— 图标 + 细进度条 + 百分比，与旁边项目 / 分支选择器同款样式（13px、`hover:bg-hover`、不截断、窄窗整行 `flex-wrap` 兜底）。显示的是**当前会话模型的 provider** 的主窗口（优先 `rolling-5h`，它最先撞墙）。当前 provider 没有配额数据但别的 provider 有时，退化为中性「用量」按钮；**一份数据都没有时整个入口不渲染**。

**展开态（向上弹的浮层）**：标题行「用量限额 · 更新于 2 分钟前」+ 刷新 → 按 provider 分段（`OpenCode Go · opencode-go`，当前会话的 provider 排首位）→ 每窗口一行：`5 小时 ████████░░░░ 26% · 1h1m 后重置`。配色走语义色：<80% `accent`、≥80% `warn`、100%/`exhausted` `danger`（80% 阈值对齐 omp 自己的 warning 线）；进度条纯 CSS，不引图表库。

**刷新策略**：启动静默拉一次；页面可见时每 5 分钟重拉；打开浮层总是重拉（保留上一份数据显示，只转 loader，不闪空）；浮层内另有手动刷新。窗口标签（5 小时 / 每周 / 每月）走本应用字典，`label` 兜底显示上游原文。

### 改动清单

**后端**（新 `src-tauri/src/quota.rs`，与本地统计的 `usage.rs` 分家）
- 1 个命令 `get_provider_usage()`：沿用 `providers.rs` 的 omp 路径解析 + `tokio::process` + 30s 超时调 `omp usage --json`，解析成强类型视图返回。
- 纯解析函数 `parse_usage_json(&str)` 单独成函数便于单测：容错解析（缺字段跳过、`durationMs` / `resetsAt` 可选、`status` 按开放枚举、`metadata` 任选），空 `reports` 不算错。
- 约 6 项单测：真实 fixture（本机实测 JSON）、monthly 缺 durationMs、空 reports、缺字段 / 坏 JSON、exhausted 状态、多 provider 排序。

**契约**：`src/shared/ipc.ts` 加 `getProviderUsage`；`types.ts` 加 `ProviderUsage` / `ProviderUsageReport` / `UsageLimit`；`api.ts` 加 `getProviderUsage()`；`main.rs` 注册；`scripts/e2e-ipc-selfcheck.mjs` 的 COMMANDS 加该命令并把 `quota.rs` 纳入实现位置扫描。

**前端**
- 新 `src/components/composer/UsageMeter.tsx`（触发按钮 + 浮层），挂进 `ContextBar` 第三位；复用 `composerMenu` 互斥槽（加 `"usage"` 值）与 `useDropdown`（点击外部 / Esc 关闭）。
- 新 `src/lib/providerUsage.ts`：拉取 / 缓存（存 Zustand `providerUsage`，切设置页回来不重拉）、当前 provider 的主窗口选择、相对时间与重置倒计时格式化 + 单测。
- 字典新增约 12 键 × 2 语言。

**文档**：新建 `docs/v6-schedule.md`（上游事实、口径、完成口径）；同步 `AGENTS.md`（文档索引 + 源码结构 + 核心数据流新条目）、`design-system/MASTER.md`（§4 上下文条、§8 组件速查加 `UsageMeter`、进度条配色规则）、`CHANGELOG.md`（Unreleased）。

### 验证

- `pnpm check` 全绿（typecheck + lint + test + e2e:ipc + e2e:rpc）、`cargo test` 全绿。
- 真机 `pnpm tauri:dev`：界面数字与 `omp usage --json` 输出**逐项交叉核对**（三窗口百分比、重置时间、provider 排序）；中英切换；窄窗换行；无数据 provider 的降级。

### 明确不做

不改 omp 缓存状态（不调 `omp usage invalidate`，那是写操作）、不做历史趋势（`--history`）、不做按客户端拆 token（`clients`）、不做超阈值通知、不在浮层里展示任何账号身份（上游 JSON 本来也不含）。