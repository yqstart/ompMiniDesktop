# ompMiniDesktop 三期（V3）功能排期：供应商页

> 基线：V1、V2 已交付（见 `CHANGELOG.md`）；本文只排三期，不重开已冻结的口径。
> 目标：把 omp 的 **login / logout / model roles** 映射进界面——设置页新增「供应商」页签。
> 约束不变：真相在 omp/jsonl；覆盖层只有 `overlay.json`；不用轮询文件做伪实时；前端不自算 token。

## 0. 范围与口径

用户口径：「在设置里加一个供应商 Tab，把 omp 的 login、logout、model、roles 等映射过来。」

拆成两块页签（用户口径后续追加：模型相关从供应商页迁到「模型」页）：

| 页签 | 区块 | 映射的上游能力 | 写入什么 |
|---|---|---|---|
| 供应商 | 登录 / 登出 | `omp auth-broker list` / `login <id>` / `logout <id>` | omp 的**凭证库**（agent.db 里的 auth 表） |
| 模型 | 模型角色 | `omp config get/set modelRoles` | omp 的**全局配置** `~/.omp/agent/config.yml` |
| 模型 | 可用模型 | `omp models --json` | 只读 |

**这两个页签是全 app 唯一改 omp 状态的地方**——既有的「设置页不改 omp 配置」规则在此处显式让位：登录 / 登出的本质就是写 omp 的凭证，角色分配的本质就是写 omp 的配置；不给写就没法"映射过来"。其余页面（含设置页的另外两个页签）保持只读口径不变。

范围外（本批不做）：API key 型供应商的新增 / 编辑（`models.yml` 的 provider 块）、OAuth 账号级的登出（`omp token --list` 能列出账号，但一次登出账号粒度要 N 次 spawn）、模型目录的禁用 / 启用（`enabledModels`）、用量面板。

## 1. 上游事实（本机 omp 18.2.1 实测）

**① RPC 有 `login`，但它在"零凭证"状态下用不了——这是决定走 CLI 的原因**

- RPC 协议确有 `get_login_providers` / `login{providerId}`（`docs/rpc.md`），宿主侧收 `extension_ui_request{method:"open_url"}` 打开浏览器、必要时用 `input` 收授权码。
- 但实测：**在没有可用凭证的 agentDir 下 `omp --mode rpc` 直接退出**——
  `Still starting after 10s — phase: createAgentSession > resolveModelDiscoveryFallback` +
  `No models available. Use /login or set an API key environment variable.`
  RPC 启动要先解析出一个可用模型，而"一个供应商都没登录"正是供应商页最主要的首次使用场景。
- 对照：`omp auth-broker login|logout` 直接操作 `SqliteAuthCredentialStore`（`AuthStorage.login`），不建会话、不需要模型，任何状态都能跑。**所以壳侧走 CLI。**

**② `auth-broker login` 的输出契约（解析依据：`packages/coding-agent/src/cli/auth-broker-cli.ts` 的 `runLocalLogin`）**

```
\nOpen this URL in your browser:\n
<完整授权 URL>\n                      ← headless 抓取读的就是这一行（上游注释明说）
Local shortcut (this machine only): <launchUrl>\n   （与本机不同端口时才有）
<instructions>\n
\n
<进度行 / 提问行…>
Credentials saved to <agent.db 路径>\n  ← 成功
```

- 提问行来自 `onPrompt`（如 Alibaba Coding Plan 的「选端点 1/2/3」「粘贴 API key」）与 `onManualCodeInput`（paste-code 类供应商），走 readline，**答案要从 stdin 回一行**。
- 退出码 0 = 成功；非 0 = 失败（stderr 是原因）。
- `omp auth-broker login <id>` 需要 provider id；无参数会走交互式选择（壳侧永远带 id）。

**③ `logout` 的语义（`auth-broker-cli.ts` 的 `runLogout`）**

`store.deleteAuthCredentialsForProvider(provider, "logged out by user")` —— 删除该供应商在本地凭证库里的**全部**凭证（含多个 OAuth 账号）。对没有凭证的供应商调用是无害的（打印 `Logged out of X`，实测确认）。

**④ 模型角色（`config/model-roles.ts` + `config-cli.ts`）**

- 内置 9 个角色：`default`(Default) / `smol`(Fast) / `slow`(Thinking) / `vision`(Vision) / `plan`(Architect) / `commit`(Commit) / `tiny`(Tiny) / `task`(Subtask) / `advisor`(Advisor)；配置里还能出现自定义角色（`getKnownRoleIds` 会把 `cycleOrder` / `modelRoles` / `modelTags` 里出现的名字并进去）。
- 角色值是模型 selector（`provider/modelId`，可带 `:思考档` 后缀，如 `commandcode/meta/muse-spark-1.3-contributor:xhigh`）。
- 未配置的角色由 omp 自己按回退规则解析（`smol` / `slow` 优先继承 default、`advisor` 兜 `slow`、`tiny` 兜 `smol`，其余有各自的内置优先级表）——**壳侧不复制这套规则**，只标「未配置」。
- 写入：`omp config set modelRoles '<JSON>'`。schema 里 `modelRoles` 是 `record`，CLI 只接受**整表 JSON**；点路径 `modelRoles.smol` 实测报 `Unknown setting`（`findSettingDef` 只在 `SETTINGS_SCHEMA` 的顶层键里找）。`omp config get modelRoles --json` 返回 `{key, value, type}`。
- `modelRoleStorage`（`global` | `project`）决定角色存哪里；壳侧读写的是全局（`config.yml`），为 `project` 时界面给 warn 提示。

**⑤ 模型目录**

`omp models --json` → `{models: [{provider, id, selector, name, contextWindow, maxTokens, reasoning, thinking, input, cost}]}`。它只列 omp **当前可用**的模型（有凭证或免钥的供应商）——因此「某供应商是否出现在目录里」可以当作「已配置」的判定依据，不必去读 omp 的凭证库。

## 2. 实现

**后端（`src-tauri/src/providers.rs`，8 个命令）**

| 命令 | 干什么 |
|---|---|
| `list_providers` | `auth-broker list --json` 的供应商 + 「已配置」标记（顺带跑一次 `models --json` 拿真值并刷新目录缓存） |
| `start_provider_login` | spawn `auth-broker login <id>`，stdout 行 → 登录状态快照 → `omp-provider://login` |
| `provider_login_input` | 一行文本写进登录子进程 stdin（回答上游提问） |
| `cancel_provider_login` | 杀掉登录子进程（取消） |
| `get_provider_login` | 拉最近一次登录的快照（切走再回来补齐中间输出） |
| `logout_provider` | `auth-broker logout <id>`，成功后作废模型目录缓存 |
| `get_model_roles` | `config get modelRoles` + `modelRoleStorage` |
| `set_model_role` | 读 → 改一个键 → `config set modelRoles <JSON>` → **回读确认** |

- 纯函数（供应商清单解析、已配置集合、登录输出解析器、角色合并 / 校验 / 输出窗口）都有单测；进程调用只负责喂字符串。
- 登录状态是 `LoginStatus{running, url, lines[], done}` 全量快照，事件名 `omp-provider://login`（`e2e:ipc` 守它与 `ipc.ts` 一致）。
- 同一时刻只允许一个登录；并发编辑角色由 `roles_edit` 互斥锁串行化。

**前端（`src/components/settings/`）**

- 设置页四个页签：`通用` / `供应商` / `模型` / `已归档对话`。
- `ProvidersPanel`（供应商）：omp OAuth 供应商清单（名称 + id + 「已配置 / 未配置」+ 登录 / 登出）+ 登录卡。
- 登录卡内容：状态行（等待授权 / 成功 / 失败 / 已取消）+ 授权 URL（「打开浏览器」/「复制链接」）+ 上游输出窗口 + 输入行（回填 stdin）+ 取消；固定在供应商列表**上方**并自动滚入视野。
- `ModelsPanel`（模型）：模型角色（角色行内展开模型选择器——设置页是可滚动容器，浮层会被裁掉）+ 可用模型目录（按供应商分组折叠）。候选模型与输入框 `ModelPicker` 共用同一份 `models` store。
- 登出走 `ConfirmDialog`（danger）。

**顺带修复**：`get_models` / `refresh_models` 此前读诊断状态 `state.omp_path`（只有 `locate_omp` 成功后才非空）——诊断没跑完或探测失败会让模型目录一起失败。现在统一走 `discover_omp_path`。

## 3. 完成口径

- `pnpm check`（typecheck + lint + test + e2e:ipc + e2e:rpc）全绿 + `cargo test` 全绿（53 项，其中 providers 10 项）。
- `e2e:ipc` 覆盖到 **50** 个命令，并额外守两件契约：登录事件通道名前后端一致、登录 / 登出必须按 `auth-broker` 子命令调用。
- 真机实测（本机 omp 18.2.1，`pnpm tauri:dev`）：
  - 四页签渲染与切换（通用 / 供应商 / 模型 / 已归档对话）；
  - 供应商清单渲染（OAuth 供应商全量 + 已配置标记：`commandcode` / `deepseek` / `opencode-go` 显示「已配置」并出现「登出」）；
  - 登录：点「登录 anthropic」→ 授权 URL 正确解析、`Local shortcut …` 与 `Paste the authorization code …` 等上游行原样出现在输出窗口 → 点「取消」→ 显示「已取消登录」、子进程结束（`ps` 确认）；**未完成真实授权**（不写凭证）；
  - 登出确认框：点「登出 commandcode」→ 弹出 `ConfirmDialog`（标题带供应商名、详情写明删全部凭证、**焦点默认在「取消」**）→ 回车取消 → 弹框关闭、凭证未动（`omp models --json` 的供应商集合不变）；
  - 模型页角色：给「深思 slow」选 `commandcode/deepseek/deepseek-v4-flash` → `~/.omp/agent/config.yml` 出现该键、界面同步 → 点「清除」→ 键移除、配置恢复原状（与备份逐键比对）；
  - 模型目录：`共 111 个模型 · 3 个供应商`，按供应商分组折叠展开正常。

## 4. 后续候选（需用户确认再开工）

- **登出到账号粒度**：现在登出删该供应商的全部凭证；`omp token <provider> --list` 能列出 OAuth 账号（索引 + 身份），要做"只登出某一个账号"得再解析它的输出。
- **API key 型供应商的接入**：`models.yml` 的 provider 块（`baseUrl` / `apiKey` / `discovery`）目前只能手写；要可视化得先定"写用户 YAML"的边界。
- **`enabledModels` / `cycleOrder`**：模型目录的启用面与 Ctrl+P 轮换序，属于 `config` 的另外两个键，同一套读写模式可复用。
