# ompMiniDesktop 十二期（V12）：自定义模型接入（`models.yml` 可视化）

> 基线：V11 已交付（终端工作区壳，见 `docs/v11-schedule.md` 与 `CHANGELOG.md`）；本文只排十二期。
> 目标：把 omp 的**用户级自定义模型配置**（`<agentDir>/models.yml`）搬进设置界面——自建端点、
> OpenAI 兼容网关、本地推理服务可视化接入；此前只能手改文件。
> 约束：真相在 omp 的文件里；壳侧不存副本、不造第二份状态；写文件是上游没有 CLI 通道时的唯一路径，
> 因此写入必须**保真、可校验、可回滚**。

## 0. 范围与口径

用户口径：「omp 是否支持自定义模型的接入，如果支持我需要添加一个自定义模型的可视化配置。」

**支持**（见 §1）——omp 的官方用户级入口就是 `models.yml`：

```yaml
providers:
  my-gateway:
    baseUrl: https://gw.example.com/v1
    apiKey: MY_GW_KEY          # 环境变量名 / 字面量 / !命令
    api: openai-completions
    models:
      - id: some-model-id
        name: Some Model
        contextWindow: 128000
        maxTokens: 16384
```

| 位置 | 区块 | 映射的上游物 | 写入什么 |
|---|---|---|---|
| 设置 › 供应商（登录区块下方） | 「自定义模型」 | `<agentDir>/models.yml`（或回退的 `models.yaml`） | 该文件本身（omp 全局） |

**范围外**（本批不做）：

- **覆盖型块的编辑**（只有 `modelOverrides` / `headers` / `compat` / `discovery` 之类、没有 `models`
  列表的块）：界面表达不了那些覆盖语义，编辑等于丢字段——列表里只读展示（「覆盖内置 · 手工维护」徽章）。
- **`discovery` 表单**（`openai-models-list` / `proxy` / `ollama` / `litellm`…）：自动发现模型列表，
  比手写模型条目省事，但需要「有 discovery 时模型列表可空」的另一套校验面，后续候选（§5）。
- `auth: oauth`（对 `models.yml` 自定义 provider，上游 schema 收下但不豁免 `apiKey` 要求）、
  `transport: pi-native`、`remoteCompaction`、`headers` / `cost` 的表单编辑（这些键**原样保留**，不被界面动）。
- 项目级 `.omp/models.yml`（上游只有 agentDir 一处发现路径）。
- **不做「当前会话热读」断言**：写完后新起的 omp 进程一定读到新值（实测），长驻会话是否热读未验证（§4）。

## 1. 上游事实（omp 18.2.2 本机实测）

**① 文件发现规则**：`<agentDir>/models.yml` 优先；它不存在时才用 `<agentDir>/models.yaml`。
实测**两文件并存时 `models.yaml` 被整体忽略**（只有 yaml 时它生效、加进 yml 后 yaml 的内容消失），
所以界面读写的是「当前生效的那个文件」，不是新建固定名字的文件。

**② 上游没有任何 CLI 写入口。** `omp models` 只有 `ls` / `find` / `refresh`；`omp config` 只管
`config.yml`（501 个键里没有 models 相关的写入通道）。**写文件是自定义模型的唯一路径**——这是壳侧
第一次直接写 omp 的配置文件（此前口径是「不解析、不改写 omp 配置文件」，见 V8 §6），本条为此开了先例，
并以保真编辑 + 预校验 + 备份 + 乐观锁四道闸控制风险。

**③ 坏配置的失败模式**（`omp models --json` 实测）：

```text
Warning: models.yml validation failed — custom providers disabled
Failed to load config file models, Validate(models) error: Provider bad-probe: "baseUrl" is required when defining custom models.
```

**退出码仍是 0**，且**整个文件的自定义 provider 全部失效**（回退内置目录）。所以：
- 预校验必须读 **stderr** 而不是退出码（§2 的 `parse_models_config_error`）；
- 坏配置**不落盘**（保存前拿候选文本在临时 agentDir 里问一次 omp）。

**④ 空文件 / 只有注释同样非法**：

```text
Failed to load config file models, Schema error: root: must be an object (was null)
```

所以界面删光所有自定义项后必须留下 `providers: {}`（前端 `removeProvider` 保证）。

**⑤ schema 细节**（表单校验的依据）：
- 完整自定义 provider（`models` 非空）必填 `baseUrl` + `apiKey`（除非 `auth: none`）+ `api`；
- `cost` 块要么省略、要么**四字段齐全**（`input` / `output` / `cacheRead` / `cacheWrite` 缺一即
  `must be a number (was missing)`）——界面不写 cost，省掉这个坑；
- `api` 允许值：`openai-completions` / `openai-responses` / `openai-codex-responses` /
  `azure-openai-responses` / `anthropic-messages` / `bedrock-converse-stream` /
  `google-generative-ai` / `google-gemini-cli` / `google-vertex`（界面原样列出、不翻译）；
- `auth` 允许值：`apiKey`（默认）/ `none` / `oauth`。

**⑥ 凭证解析（真机实测）**：`apiKey` 先当环境变量名、不存在则用字面量；`!` 前缀走命令 stdout。
对 `openai-completions`，**实测请求自带 `Authorization: Bearer <key>`**（未配置 `authHeader`）：
本地假端点收到的头是 `Authorization: Bearer TEST_KEY_LITERAL`。`auth: none` 则不注入（`auth: null`）。

**⑦ 端到端链路（真机实测）**：写好 models.yml → `omp models --json` 收录该 provider（含
`contextWindow` / `maxTokens` 元数据，stderr 干净）→ `omp -p --model <provider>/<model>` 对本地假端点
真实对话返回。**自定义模型真正可用**。

**⑧ 目录可见性**：「已生效」= 该 provider 的模型出现在 `omp models` 里（有凭证或免钥）。
`apiKey` 解析得出（字面量也算）或 `auth: none` 都立即出现；被 `disabledProviders` 排除时不出现。

## 2. 实现

**后端（`src-tauri/src/models_config.rs`，新模块，2 个命令）**

| 命令 | 干什么 |
|---|---|
| `read_models_config` | 读当前生效的文件（`models.yml` 优先、`models.yaml` 兜底）→ `{path, exists, text, hash}` |
| `write_models_config(text, expectHash)` | hash 校验 → **预校验** → 备份 → 原子写 → 回读 |

- `hash_text`：FNV-1a 64 位（16 位十六进制）。不是密码学哈希——只需「改一字节就变」与「同内容稳定」，不落盘比对。
- `validate_text`：候选文本写进 `std::env::temp_dir()` 下的临时 agentDir，跑
  `omp models --json`（`PI_CODING_AGENT_DIR` 指向临时目录、stdout 丢弃、只读 stderr），60s 超时，
  用后删目录。错误提取是纯函数 `parse_models_config_error`（`Failed to load config file models` 行 +
  其后连续缩进行），单测锁两种实测形态。
- `backup_file`：写到 `$APPDATA/omp-mini/backups/`（`overlay.json` 同级的 `backups/`），文件名
  `models-<yyyyMMdd-HHmmssSss>.yml`，按字典序保留最近 10 份；失败不阻断写入（只损失一次 undo 机会）。
- `write_atomic`：同目录 `models.yml.tmp` + rename。
- `AppState` 新增 `models_edit: Mutex<()>`（写入是多步操作，与 `roles_edit` / `retry_edit` 同款串行化）。
- 11 项单测：路径选择（yml 优先 / yaml 兜底 / 都不存在默认 yml）、hash 稳定性与敏感性（含 FNV 空串基准
  向量）、乐观锁判定、stderr 解析两形态 + 无关 stderr、备份复制与裁剪到 10 份、缺失文件不备份、原子写无残留。
  **`#[ignore]` 真实 omp 集成测试**：好配置放行 / 缺 `baseUrl` 被拒 / 空文件被拒（`cargo test -- --ignored`）。

**前端数据层（`src/lib/customModels.ts` + 18 项单测）**

- 保真编辑三原则：只改被编辑节点；界面之外的键（provider 级 `headers` / `compat` / `modelOverrides`…，
  model 级 `cost` / `compat` / `tokenizer`…）原样保留；覆盖型块只读。
- `parseModelsConfig`（列表视图：custom / override 分类、字段摘要、界面之外的键）、`providerFormOf`
  （表单初值）、`upsertProvider` / `removeProvider`（返回新文本或错误，**解析不了就拒绝编辑**）。
- 模型数组按 id 复用原节点（保住 `cost` 等字段）；`apiKey` ↔ `auth: none` 互斥；数字字段空串删键；
  推理关 = 删键（不写 `false`）；`input` 只收文本时不写键、含图片写 flow 风格数组。
- 序列化 `toString({ flowCollectionPadding: false, lineWidth: 0 })`——默认选项会把 `[text, image]`
  重排成 `[ text, image ]`（实测），关掉后**零修改往返逐字节一致**、编辑 diff 只含新增行。

**界面（`src/components/settings/CustomProviders.tsx` + 共享 `Switch.tsx`）**

- 区块挂在设置 › 供应商（登录区块下方）：标题 + 口径说明 + 生效文件路径 + 供应商行（自定义：模型数 /
  生效数 / 编辑 / 删除；覆盖型：只读徽章 + 界面之外的键名）+「添加自定义供应商」。
- 表单（行内展开、撑开布局，与设置页其它区块同套交互）：名称（新建可改、编辑锁定）、接口地址、
  接口类型（行内展开列表）、认证（API Key / 无需鉴权分段控件 + key 输入框）、模型列表
  （id / 显示名 / 上下文窗口 / 最大输出 / 推理开关 / 输入模态 chips / 移除）+ 添加模型 + 保存 / 取消。
- 保存 = 表单校验 → 保真编辑 → 后端写（**失败原文件不动**）→ 刷新模型目录（写入的内容立刻反映到
  「已生效」与「模型」页签的可用模型目录）。删除走行内二次确认（设置页是可滚动容器，浮层会被裁掉）。
- `Switch` 从 `GeneralSettingsPanel` 抽到 `src/components/settings/Switch.tsx`（两处共用一份）。
- 字典新增 41 键 × 2 语言（`custom*` 前缀）。

## 3. 完成口径（已达成）

- `pnpm check` 全绿：typecheck / lint / **63 项**单测（新增 `customModels.test.ts` 18 项）/ `e2e:ipc`
  **43 命令** × 双向一致（`ipc.ts` ↔ `main.rs` ↔ 实现，`rsFiles` 清单加入 `models_config.rs`）。
- `cargo test` 全绿：lib 75 + bin 86（含新模块 11 项；另 1 项 `#[ignore]` 真实 omp 预校验集成测试，
  已单独跑过：好配置放行 / 坏配置与空文件被拒）。
- 界面核对（静态构建 `dist/` + vite preview + 注入 IPC mock，中文与英文两遍）：
  - 列表：`deepseek`（覆盖内置 · 另有 modelOverrides · 手工维护只读）与 `my-gw`（自定义 · 已生效 1 个模型 ·
    另有 headers）逐项正确；覆盖型行**无**编辑 / 删除按钮；
  - **添加**：填 `local-vllm`（勾「图片」输入模态）→ 保存 → 写入文本 = 原注释 + deepseek 块 + my-gw 块
    原样，新块追加末尾，`auth: none`（key 空）、`input: [text, image]`（flow 风格）；
  - **编辑**：`my-gw` 改显示名 → 写入文本仅该行变化（`headers` / `apiKey` / 其它块原样）；
  - **删除**：行内确认「删除 my-gw？」→ 确认后写入文本不含该块、注释与其余块保留；
  - 英文界面：全部新增文案为英文、无漏译（`undefined` 检查通过）。
- **真机端到端**（隔离 agentDir `/tmp/omp-e2e-agent`，用户真实配置零改动）：把界面产出的文本落盘后，
  `omp models --json` 收录 `e2e-gw/probe-model`（ctx/max 元数据一致、stderr 无 validation 告警），
  `omp -p --max-time 60s --model e2e-gw/probe-model "say pong"` 对本地假端点真实对话返回 `pong`；
  端点侧确认 `model: "probe-model"`、`Authorization` 未注入（`auth: none`）。

## 4. 风险与未实测项

| # | 事项 | 状态 | 缓解 |
|---|---|---|---|
| 1 | 直接写 omp 的配置文件（壳侧首次） | **已收口** | 保真编辑（注释 / 未知字段不动）+ 预校验（坏配置不落盘）+ 备份 + 乐观锁（外部改动即拒绝） |
| 2 | 用户手改文件的并发 | 已规避 | hash 乐观锁：写前比对读时 hash，不符即报「配置文件在界面之外被修改过」 |
| 3 | 长驻会话是否热读 `models.yml` | **未实测** | 界面只声明事实：写入经 omp 预校验、刷新目录立即可见（新进程）；不宣称已开的会话会立刻换 |
| 4 | 上游 schema 演进（新增必填字段 / 新 api 枚举） | 持续风险 | 预校验把 omp 的原始诊断原样透传给用户；`api` 选项表按上游文档枚举，新增值走「原样手写 + 预校验」 |
| 5 | 备份目录堆积 | 已限制 | 按名保留最近 10 份，超出自动删最老 |

## 5. 后续候选（需用户确认再开工）

- **`discovery` 表单**（`openai-models-list` / `proxy` / `litellm` / `ollama` / `llama.cpp` / `lm-studio`）：
  网关与本地引擎自动发现模型列表；需要「有 discovery 时模型列表可空」的校验分支。
- **覆盖型块的可视化**：`modelOverrides`（改内置模型的元数据，本机 `~/.omp/agent/models.yml` 的真实用例
  就是给 deepseek-flash 开图片输入）与 provider 级 `baseUrl` 覆盖（公司代理）。
- **`headers` 编辑**（键值对列表）与 `cost` 编辑（四字段组校验）。
- **项目级 models 配置**：上游没有这个发现路径，先确认 omp 是否会在近期支持。

## 6. V12b（追加）：四模块合并为「模型」页签 + 「我的模型」

> 用户口径：「把自定义模型、供应商、常用模型、可用模型四个模块合并起来——像 opencode、commandcode 等计划包含很多模型，
> 但我常用的就几个；我想在添加 opencode 等计划时直接选择我需要的模型，然后配置模型权限时直接在我的小范围内选择即可。」

两个由用户拍板的决策：**合并进「模型」页签**（设置页 6 → 5）；**「小范围」只作壳侧偏好**，不写 omp 的 `enabledModels`。

### 6.1 上游事实补充：`enabledModels` 是 omp 侧的模型白名单（本批不用，事实存档）

PTY 起真实 TUI 抓 `/model` 面板实测（副本 agentDir）：

| `enabledModels` | TUI `/model` 面板 |
|---|---|
| `[]`（空数组） | **不限制**（commandcode / claude-fable-5 / gpt-5.3-codex 等全部出现） |
| `["deepseek/deepseek-flash","opencode-go/*"]` | **白名单**（commandcode 与 gpt-5.3-codex 消失；`opencode-go/*` 通配生效） |

补充事实：`omp models --json` **不应用**该过滤（两次都是全量 112 个）——壳侧若要用它做「小范围」，
必须自己按名单过滤；显式 `--model` 也不被它拦（请求照发）。写它是 `omp config set enabledModels '<JSON>'`
（array 型，支持 `{path, models}` 作用域条目，空数组 = 不限制）。

### 6.2 实现

**信息架构**：`设置` 五页签（通用 / **模型** / 记忆 / 使用统计 / 已归档对话），「模型」页 = 唯一模型管理面：

```
我的模型（挑选结果） → 供应商（登录 + 按计划挑选模型） → 自定义模型（models.yml）
→ 模型角色 → 失败转移 → 可用模型目录
```

- `src/lib/myModels.ts`（替代 `favoriteModels.ts`；localStorage 键 `omp.favoriteModels.v1` **不变**，
  升级不丢已挑的模型）：`toggleMyModel` / `addManyMyModels` / `removeManyMyModels` /
  `providerSelectors` / `myModelEntries` / **`candidateModels`**（「小范围」的唯一实现点：
  我的模型非空 → 只列挑过的（按目录顺序）；空 → 全部）。
- `src/components/settings/ProvidersSection.tsx`（替代 `ProvidersPanel.tsx`）：登录 / 登出不变；
  已配置的行新增「挑选模型」——展开该 provider 在目录里的全部模型，星标即增删「我的模型」，
  带「全选 / 清空」与计数（`providerSelectors`）。
- `src/components/settings/ModelsPanel.tsx`：六区块容器；`RoleRow` 与 `FallbackChainsSection` 的
  `models` 候选改为 `candidates`（其余逻辑不动）；目录区星标语义改为「我的模型」。
- `src/components/settings/StarToggle.tsx`：从 ModelsPanel 抽出的共享星标（目录 / 挑选面板 / 我的模型列表共用）。
- 字典：删 `tabProviders` + `favorites*`（6 键）、新增 `myModels*` / `providersPick*`（11 键）× 2 语言；
  设置页副标题改为「omp 的模型与供应商配置」。

### 6.3 完成口径（已达成）

- `pnpm check` 全绿：typecheck / lint / **66 项**单测（`myModels.test.ts` 6 项：批量增删、候选收窄与
  空语义、目录缺席项）/ `e2e:ipc` 43 命令不变（**后端零改动**）。
- 界面核对（静态构建 + IPC mock）：页签 `["通用","模型","记忆","使用统计","已归档对话"]`（无「供应商」）；
  区块顺序六项正确；「挑选模型」面板列出该计划 3 个模型 + 计数；「全选」→「我的模型」3 个、
  localStorage `["opencode-go/deepseek-v4.1-flash","opencode-go/muse-spark","opencode-go/qwen3-coder"]`；
  角色「选择」展开只剩该计划的 3 个；「清空」→ 候选回到两组 5 个；目录星标 `commandcode/claude-fable-5`
  →「我的模型」1 个、候选随之收窄到 1 个。

### 6.4 边界

- 「我的模型」**不影响 omp**：终端里 `/model` 可选范围照旧（要真限制用 `enabledModels`，见 §6.1，
  本批按用户决策不做）。
- 挑选粒度 = 单个模型（星标）；`enabledModels` 的通配 / 作用域条目在 omp 侧，壳侧不感知、不显示。
- 旧「常用模型」的 localStorage 数据原样沿用为「我的模型」初值，不做一次性迁移提示。

## 7. V12c（追加）：供应商与自定义模型合并为「添加供应商」弹窗（挑模型同弹窗，可用模型目录退场）

> 用户口径：「把『供应商』和『自定义模型』合并在一起叫『添加供应商』，点击『添加供应商』按钮出现添加面板，
> 先选择提供商（下拉列表就是现在的提供商列表，支持搜索），第一个选项叫『自定义』——选择自定义则可添加
> 自定义模型，选择提供商则添加 API key。添加 API key 后应该可以看到模型列表，我可以挑选几个模型进行添加，
> omp TUI 则不受影响。」

### 7.1 上游事实补充（omp 18.2.2 本机实测）

`omp auth-broker login <provider>` 对 **API key 型**供应商是「打印取 key 的说明 → 提问 → 粘贴 → 真实校验」：

```text
Open this URL in your browser:
https://platform.deepseek.com/api_keys
Create or copy your API key from the DeepSeek dashboard

Paste your DeepSeek API key (sk-...):
```

- 输入后打印 `Validating API key...`，key **会被真实校验**：假 key 直接
  `ProviderHttpError: deepseek API key validation failed (401)`、退出码 1，**凭证不落盘**；
- 各家形态不同：zai / together / nvidia 只打说明与 dashboard 链接（问句不写 stdout）；
  moonshot / huggingface 打 `Paste your ... key (sk-...)`；ollama / vllm 允许空 key（本地免鉴权）；
  **OAuth 型**（openrouter / anthropic / openai-codex…）不打问句、只给浏览器授权 URL。
- 所以壳侧**不解析、不匹配提问**：上游行原样透传，输入框把用户那一行写进登录子进程的 stdin
  （现成机制 `provider_login_input`）——API key 与 OAuth 两种流程共用同一张卡。

### 7.2 实现

区块顺序（设置 › 模型，六 → **四块**：平铺的「可用模型」目录删除，挑模型收进弹窗）：

```text
我的模型 → 供应商（已添加列表 + 两个弹窗）→ 模型角色 → 失败转移
```

- **弹窗**（`DialogShell.tsx`）：fixed 全屏遮罩 + 居中卡片 + 内容区滚动，Esc / 点遮罩 / 右上角关闭。
  此前一律行内展开，是因为设置页 tab 内容区是 `overflow-y-auto` 容器、`absolute` 浮层会被裁掉；
  `fixed` 不受裁剪——73 家提供商、几十个模型配搜索框才用得起来；
- `ProviderPicker.tsx`：可搜索的提供商选择器（id / 名称子串匹配、大小写不敏感），**已配置的排前面**、
  右侧计数；「自定义」固定首项且不参与过滤（它的语义不是 provider，而是「不走 omp 目录、自己写 models.yml」）；
- `ProviderModelsDialog.tsx`：`ProviderModelsList`（搜索 + 计数「已挑 x / y」+ 全选 / 清空 +
  星标列表）与弹窗外壳；**全选 / 清空作用于当前过滤结果**。行上的「挑选模型」与「添加成功后就地挑」共用它；
- `CustomProviderEditForm.tsx`：从 `CustomProviders.tsx` 抽出的 models.yml 表单（§2 的全部口径保留；
  标题归弹窗，表单不再自带标题与外框）；
- `ProvidersSection.tsx`：列表 = 已配置的登录型（`configured`）+ models.yml 的块（覆盖型仍只读）；
  弹窗状态机 = 选择器 →（「自定义」→ 表单 ｜ 提供商 → 凭据卡）；凭据卡 = 上游输出 + URL（打开 / 复制）
  + 输入行 + 失败原文；`done.ok` 后刷新目录并**就地列出该供应商的模型**（星标 → 我的模型）；
- 弹窗关闭 = 放弃这次添加：还在跑的 login 子进程一并取消（`cancel_provider_login`）；
- 登录快照按 `provider` 过滤后使用——事件是全量快照、可能落后于弹窗当前选择，
  不过滤会把「刚选完」渲染成上一次登录的「登录失败 / 已添加」。

### 7.3 完成口径（已达成）

- `pnpm check` 全绿（66 单测 / `e2e:ipc` 43 命令双向一致）；**后端零改动、无新增 IPC 命令**；
- 界面核对（静态构建 + 注入 IPC mock）：区块只剩「我的模型 / 供应商 / 模型角色 / 失败转移」
  （无「可用模型」）；挑选弹窗（标题「挑选 X 的模型」、计数「已挑 1 / 3」、搜 `coder` → 1 行、
  **过滤态全选只加 `opencode-go/qwen3-coder`**、Esc 关）；添加弹窗（标题「选择提供商」、
  计数「20 个提供商」、已配置三家置顶、首项「自定义」）；自定义表单在同一弹窗内换标题、取消回选择器；
  凭据流程（标题「添加 DeepSeek」→ `start_provider_login` → URL / 上游输出 → 提交 key →
  `done.ok` 刷新目录 → 内联挑选「已挑 1 / 2」→ 「完成」关弹窗）；自定义保存的写出文本逐字节核对
  （原注释与既有块保留、新块 `auth: none` 追加）；失败态显示上游 401 原文；英文界面无中文残留
  （`Pick a provider` / `Pick models from X` / `1 of 3 picked`）；深浅两套截图。

### 7.4 边界

- 「添加 API key」= 走 omp 自己的 auth-broker 交互（key 由 omp 校验后写进**凭证库**），
  **不是** models.yml 的 `apiKey` 字段——那条路仍是「自定义」；
- 未配置的提供商不进列表（它们在添加弹窗的选择器里）；列表的「已配置」仍以模型目录为准（不直读凭证库）；
- 「可用模型」平铺目录按用户口径删除：模型一览只在「挑选模型」弹窗里（按供应商 + 搜索过滤），
  「不挑 = 全部」的候选来源仍是 omp 目录本身（`candidateModels`），不受影响；
- 星标只写本应用 localStorage：**omp TUI 不受影响**（`enabledModels` 不动，见 §6.1 / §6.4）。

## 7.5 V12c 修订：供应商置顶、自定义供应商可改名、接口类型收两档

> 用户口径：「模型 Tab 中，把供应商调整到最上方；自定义的供应商现在不支持修改名称；
> 自定义供应商接口类型只支持 openai 和 claude 协议即可，并且认证方式只有 apikey。」

- **区块顺序**：设置 › 模型的四块改为 **供应商 → 我的模型 → 模型角色 → 失败转移**（供应商置顶：
  「先添加供应商 → 在弹窗里挑模型 → 挑进的进我的模型」才是使用动线）；`providersHint` 的方位词
  随之改成「下面的『我的模型』」。
- **自定义供应商可改名**：表单的「名称」不再锁定。`CustomProviderForm` 增 `originalId`（`providerFormOf`
  读出原键名；新建时不带），`upsertProvider` 在 `originalId !== id` 时**就地替换 YAML 键**
  （`pair.key.value = id`）——块的位置与键上的注释保留，其余块 / 界面之外的键 / 模型级字段逐字节不动
  （§2 的「名称（新建可改、编辑锁定）」口径由本节取代）。改名撞已有 id：UI 拦（`isDuplicateProviderId`，
  编辑保留原名不算冲突）+ 保存按钮禁用 + 提示「名称已被别的供应商占用」；库层兜底（目标键已存在则
  不改名）保证**绝不写出重复键**（此前「新建撞名会覆盖已有块」的缺陷一并收口）。
- **接口类型两档**：`API_OPTIONS` 收窄为 `openai-completions`（OpenAI 兼容）/ `anthropic-messages`
  （Claude 协议）；既有文件里写了别的 wire API（如 `google-vertex`）时由 `apiOptionsFor` 把当前值
  追加进下拉——**不改动也能保存**，保真口径不破。
- **认证只有 API Key**：删掉「API Key / 无需鉴权」分段控件（`Switch` 的 auth 档位状态一并删除；
  字典删 `customFormAuth` / `customFormAuthNone` / `customFormApiKey`，新增 `customFormDupId`），
  Key 输入框常驻；**留空 = 该端点无需鉴权**（落盘 `auth: none`，hint 文案写明）——既有 `auth: none`
  的块仍可原样保存。
- 后端与 IPC 零改动；`pnpm check` 全绿（77 单测，`customModels.test.ts` 18 → 23 项：改名保真 /
  撞名兜底 / `apiOptionsFor` / `isDuplicateProviderId`）。
- 界面核对（静态构建 + 注入 IPC mock）：区块顺序 = 供应商 / 我的模型 / 模型角色 / 失败转移；
  编辑态名称输入可改（值可编辑）；接口类型下拉两项（`google-vertex` 的旧块下拉 = 三项）；
  无「无需鉴权」、有「API Key」标签；改名保存的写出文本 = 原位置变 `renamed-gw:`、顶部注释与
  `headers` 保留、其余块逐字节不变；新建 `claude-gw` 选 `anthropic-messages` + 字面量 key 追加末尾；
  改名撞已有 id → 保存禁用 + 「名称已被别的供应商占用」。
- **自定义块也能挑选模型**：`CustomRow` 补「挑选模型」按钮（与登录型行同款，`picking` 状态放宽为
  `{ id, name }`）——此前自定义块的模型虽在目录里却无处星标；覆盖型块保持只读（无按钮，其 provider id
  若在目录里，入口在登录型 / 自定义行上）。挑选弹窗的空态文案改「检查凭证 / 配置」（对自定义块也贴切）。
- **名称支持中文**：`isValidProviderId` 从 ASCII 白名单放宽为 `/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u`——
  实测 omp 对 provider 键**无字符集约束**（隔离 agentDir：`云渡中转/gpt-6-astra` 收录进
  `omp models --json`，stderr 干净），只挡空白与 `/` `:` `#` 等 YAML 键名 / selector 的歧义字符。
  格式错时给专门提示（`customFormIdInvalid`，不再只显示笼统的「还有必填项没填完」），输入框 tooltip
  说明它是键名 / selector 前缀（`customFormNameHint`）。改名会让引用旧 selector 的地方失配
  （「我的模型」标「已不可用」；omp 侧手写的角色 / 转移链要自行更新）。
