# ompMiniDesktop 九期（V9）功能排期：模型页的失败转移链与角色思考档

> **历史存档（V11 起）**：本文档描述 V1–V10 的「聊天界面」形态；现行形态是终端工作区
> （见 `docs/v11-schedule.md`）。文中涉及聊天渲染 / RPC 驱动的部分已不再对应当前代码，
> 其余（设置页各页签、语言/皮肤、发版等）仍然有效。


> 基线：V1–V8 已交付（见 `CHANGELOG.md`）；本文只排九期，不重开已冻结的口径。
> 目标：把 omp 的 **`retry.fallbackChains`**（模型请求失败时由备用模型接手）映射进设置 ›「模型」，
> 并补上**角色值的思考档**（`provider/model:档位`）——此前 pick 模型时会丢掉档位后缀。
> 约束不变：真相在 omp/jsonl；覆盖层只有 `overlay.json`；前端不自算、不复制 omp 的匹配规则。

## 0. 范围与口径

用户口径：「模型 tab 中的模型角色还缺少一个功能，omp 失败链路配置，一个模型如果异常会由配置的转移模型继续接手」
+「模型角色中选择模型后不能选择思考等级，也需要完善」。

| 区块 | 映射的上游物 | 写入什么 |
|---|---|---|
| 模型角色（既有，本次补档位） | `omp config get/set modelRoles` | omp 全局配置 `~/.omp/agent/config.yml` |
| **失败转移**（新增） | `retry.fallbackChains` + `retry.modelFallback` + `retry.fallbackRevertPolicy` | 同上（全局层） |
| 可用模型（既有，只读） | `omp models --json` | 只读 |

写入口径与 V8「通用设置」的分工：V8 明确**不做 array / record 型的键**，`retry.fallbackChains` 与
`retry.modelFallback` 在那份排期里被显式划归本页（`src/lib/ompSettings.ts` 的注释同此）；
`retry.maxRetries` 属数字型、归 V8 通用页。

范围外（本批不做）：`retry.usageAwareFallback` / `usageReservePct` / `usageReservePolicy`（配额感知预切换）、
`retry.baseDelayMs` / `maxDelayMs` / `waitForUsageReset`（重试预算的其余键）、
id 前缀通配（`openrouter/google/*`）的候选（omp 认，界面不做候选但原样显示手写值）、
「当前生效的转移」实时指示（会话内已有分隔线）。

## 1. 上游事实（本机 omp 18.2.1 实测）

**① `retry.fallbackChains` 的形状（`omp config list --json` 的 description + 写入实测）**

```yaml
retry:
  fallbackChains:
    default:                      # 键 = 角色名
      - openai/gpt-4o-mini
    opencode-go/muse-spark-*:     # 键 = 模型 selector（该模型活跃时生效，与角色无关）
      - opencode-go/deepseek-v4.1-flash
    google-antigravity/*:         # 键 = 供应商通配（保留失败模型 id、只换供应商）
      - google/*
    openrouter/google/*:          # 也认 id 前缀通配（把失败模型的裸 id 重新加前缀）
      - google-vertex/*
```

- 值是**有序**备用 selector 数组，**顺序即 omp 的尝试顺序**（排序会改变语义）。
- 条目可带思考档后缀（`:low` / `:high` / `:max` / `:off`）：显式档覆盖；
  **不带后缀的继承失败轮次的档位**；`provider/*` 类通配条目**总是**继承。
- 键三种形态的匹配规则全在 omp 里（`turn-recovery.ts`）——壳侧**不复制**，只做整表读写与形态校验。

**② 两个配套开关**

- `retry.modelFallback`（boolean，默认 `true`）：**为 false 时链完全不生效**。
  实测传 `yes` 会被静默归一成 `true`，所以壳侧只发 `"true"` / `"false"` 字面量。
- `retry.fallbackRevertPolicy`（enum，默认 `cooldown-expiry`）：`cooldown-expiry` = 冷却结束后回主模型、
  `never` = 不自动回。实测传别的值直接报错：`Invalid value: bogus. Valid values: cooldown-expiry, never`。

**③ 触发时机（`omp read omp://non-compaction-retry-policy.md`）**

限流 / 过载 / 5xx / 网络类错误走这条重试路径；**上下文溢出不走**（溢出交给压缩）。
界面说明行照此写死口径，不夸大覆盖范围。

**④ 写入方式与层级**

- `omp config set retry.fallbackChains '<JSON>'` 整表覆盖（与 `modelRoles` 同款；点路径不可用）——
  所以后端是「读 → 改一个键 → 写回」，用互斥锁串行化。
- **`config set` 任何 cwd 下都只写全局 agentDir 的 config.yml**（实测：在含 `.omp/config.yml` 的项目目录里
  执行 set，项目层文件不被创建/修改）。
- **但 `config get` 会合并项目层覆盖**（同键在项目目录里读到项目值、在别处读到全局值）——
  所以**读必须钉住 agentDir**，否则从项目目录启动 app 时界面显示的是项目覆盖值，而界面改的是全局层。
  壳侧因此新增 `config_get_global`（走 `run_omp_in(Some(agentDir), …)`），本页的 `retry.*` 读取都走它。

**⑤ 会话内已有展示链路**

`retry_fallback_applied` / `retry_fallback_succeeded` 事件早已被 `runtime.rs` 白名单透传、
前端渲染成一行分隔线（「已切换备用模型重试」/「备用模型重试成功」）——配置生效后用户立刻看得到，本批不改。

**⑥ 角色值的思考档后缀（`omp read omp://models.md`）**

`modelRoles` 的值是 `provider/modelId`，可追加 `:档位`（如 `opencode-go/deepseek-v4.1-flash:max`）；
可用档来自模型目录的 `thinking` 数组（实测 `["low","medium","high","xhigh","max"]` 这类），
`off` 恒定合法但不在数组里。不带后缀时用 omp 自己的 `defaultThinkingLevel` 决定。

## 2. 实现

**后端（`src-tauri/src/providers.rs`，+3 命令 → 该模块 11 个命令）**

| 命令 | 干什么 |
|---|---|
| `get_fallback_chains` | 读三个键 → `FallbackChainsInfo{chains, modelFallback, revertPolicy}` |
| `set_fallback_chain` | `key` + `fallbacks: Option<Vec<String>>`；`None` / 空数组 = 删该键；读 → 改 → 整表写回 → **回读**；`retry_edit` 锁串行化 |
| `set_retry_options` | 写两个开关（bool 只发字面量、enum 先校验合法值），回读 |

- 纯函数（`parse_chains` / `validate_chain_key` / `apply_chain_edit`）各带单测：坏 JSON、非数组值、
  非字符串条目、空键、空链一律丢弃且不 panic；键的三种形态放行、脏值拒绝；**顺序原样保留**。
- 读 `chains` 失败**冒泡**（不兜底成空表——界面拿空表编辑后写回会把用户的链清空）。
- `AppState` 新增 `retry_edit: Mutex<()>`；`main.rs` 注册 3 个命令。

**前端**

- `src/lib/modelSelector.ts`（新，纯函数 + 6 项单测）：`splitSelector` 拆出 `:档位` 后缀
  （**只在后缀是 `THINKING_ORDER` 里的已知档时才拆**，模型 id 里的其它冒号不误伤）、
  `joinSelector` / `withLevel` 拼回。
- `src/components/settings/FallbackChains.tsx`（新）：失败转移区块——标题行 + 口径说明 +
  总开关（`role="switch"`，关闭时给一行 warn 色提示「所有转移链都不生效」）+ 回归策略两档 +
  链列表（类型徽章 + 有序目标芯片排）+ 「添加转移链」。
  **编辑是草稿 + 显式保存**（增量写会留下中间态、也会打出很多次 omp 子进程）：
  新建时先挑生效对象（角色 / 模型 / 供应商通配三档，候选里已在用的键置灰），
  再维护有序目标列表（上移 / 下移 / 移除 / 行内选档位）。
  删除走**行内二次确认**（不弹浮层：设置页是可滚动容器，浮层会被裁掉）。
- `src/components/settings/ModelPickList.tsx`（新）：模型选择列表（搜索 + 按供应商分组 + 点选），
  角色行与转移目标共用同一份实现（两处各写一遍会漂）。
- `src/components/settings/ModelsPanel.tsx`：区块顺序变为 **模型角色 → 失败转移 → 常用模型 → 可用模型**；
  角色行新增**档位按钮**（仅当该模型支持思考时出现，目录里查不到该 selector 时退化为全集候选），
  点开是行内芯片排：`默认 | off | low | … | max`（按模型声明的档裁剪）——「默认」= 不写后缀。
- `src/lib/roleNames.ts` / `src/lib/modelNames.ts`（新）：角色名映射与模型短名 / 上下文窗口格式化，
  从 `ModelsPanel` 抽出来给新区块复用。
- 字典新增 39 键 × 2 语言。

## 3. 完成口径

- `cargo test` 全绿（providers 从 10 项扩到 15 项：`chains_parsed_from_record_value` /
  `chains_parse_drops_bad_shapes_without_panic` / `chain_edit_sets_overrides_and_deletes` /
  `chain_edit_rejects_bad_keys_and_entries` / `chain_edit_serializes_to_record_json`）。
- 前端 `pnpm test` 全绿（新增 `src/lib/modelSelector.test.ts` 6 项）、`pnpm e2e:ipc` 契约扩到 **60** 个命令。
- 界面核对（vite 静态预览 + 注入 IPC mock，验证展示层与交互；**用静态构建避免 dev server 的 HMR 反复重置**）：
  - 链列表按真值渲染（类型徽章「角色 / 模型 / 供应商通配」与 `→ a → b` 有序目标）；
  - 总开关关闭 → 写 `opts:false/<原回归策略>` + 界面出 warn 提示、回归策略收起；再打开 → `opts:true/…`；
  - 回归策略切「不自动回主模型」→ `opts:true/never`；
  - 编辑既有链：目标上移改序 → 保存写入 `chain:default=["google/*","google/gemini-3.5-flash:high"]`
    （**顺序保留**、档位后缀正确、**其它链原样不丢**）；
  - 新建链：切「供应商通配」列出目录里的 provider（`anthropic/*` … `opencode-go/*`）、已在用的键置灰、
    加目标 → 创建 → `chain:deepseek/*=["deepseek/deepseek-v4-pro"]`；
  - 删除链：行内确认态 → 取消不写、确认写 `chain:<key>=null` 且仅该键消失；
  - 角色档位：展开列该模型支持的档（`claude-fable-5` → off/low/medium/high/xhigh/max，无 minimal）→
    选 xhigh → 行显示 `commandcode/claude-fable-5:xhigh`；
  - 英文界面下全部新增文案为英文、无漏译。
- **未做真机端到端**（界面点击 → 真 config.yml）：交互核对走的是注入 IPC 的展示层，后端以 Rust 单测 +
  `omp config set/get` 的真实 CLI 实测（临时 agentDir）为依据；本机 `~/.omp/agent/config.yml` 未被本批改动
  （改动前后已备份比对，验证只碰临时 agentDir 与 mock）。

## 4. 后续候选（需用户确认再开工）

- **配额感知预切换**（`retry.usageAwareFallback` + `usageReservePct` / `usageReservePolicy`）：
  与「用量限额」同源（coding-plan 配额报告），做完可与配额入口联动。
- **重试预算的其余键**（`retry.baseDelayMs` / `maxDelayMs` / `waitForUsageReset`）：同一配置组，
  纯数字 / 开关输入，价值密度低于转移链，需要先定「暴露到什么粒度」（`retry.maxRetries` 已在 V8 通用页）。
- **id 前缀通配的候选**（`openrouter/google/*`）：要按 provider 的模型 id 前缀分组，UI 成本不低。
