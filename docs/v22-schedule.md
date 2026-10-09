# ompMiniDesktop 二十二期（V22）：工作区跨项目文件引用（⌘⇧P 引用浮层）

> 基线：V21 已交付（工作区 = 多项目容器 + 全自动协作根 `--add-dir` / `--append-system-prompt`）。
> 用户口径：「如果工作区内一个项目的会话不能引用另一个项目的文件，工作区概念毫无意义；绝对路径手打等于跳过工作区」。
> 结论：**壳侧引用浮层**——⌘⇧P 搜索工作区成员项目的文件，Enter 把 `@<绝对路径>` 注入终端输入框。
> 本稿记录上游实测、设计与完成口径；改动这块前先读它。
>
> **V32 二次口径（2026-10-09）起两种形态共用这只浮层**：聊天形态下同一个 ⌘⇧P（以及 Composer 工具行的 `Files` 键，原 `AtSign`——2026-10-09 晚换，见 `docs/v32-schedule.md` §7.9）
> 把 `@<绝对路径>` 追加进 Composer 草稿（`store.refPickerTarget.kind === "chat"`），并已实测 `omp --mode rpc-ui`
> 的 prompt 会把 cwd 之外的绝对路径提及展开成 `fileMention` 进上下文。详见 `docs/v32-schedule.md` §7.5。

## 0. 结论先行

| 项 | 之前（V21） | 现在（V22） |
|---|---|---|
| 跨项目引用文件 | 只能手打 `@../backend/...` 或 `@/abs/backend/...`（要知道目录布局） | **⌘⇧P 浮层**：按项目分组、以**目录树**搜索工作区**其他**成员项目的文件，Enter 注入 `@<绝对路径> `（不发送） |
| `@` 补全范围 | 只索引会话 cwd（上游行为，见 §1）；`--add-dir` 的成员根只对工具可见 | 不变（上游不支持多根补全）；补的是「挑选」环节，载荷仍是真实路径 |
| 范围 | — | **仅「其他」成员项目主目录**（与自动协作根一致；**当前项目不列**——本项目文件在输入框里用 omp 原生 `@` 直接可补全）。未分组 / 单成员工作区 → 提示行，不发请求 |
| 展示 | — | 按项目分组 + **目录树缩进**（目录行 `text-faint` 小字、文件行紧凑单行只显示末段名、悬停给绝对路径） |
| 数据 | — | 新命令 `list_project_files`（`git ls-files -c -o --exclude-standard`，60s 缓存、5 万/项目上限、逐项降级） |

## 1. 上游实测（omp 18.3.5 / 18.3.0，2026-09-28）

### 1.1 `@` 补全的根 = 会话 cwd（单根，不含 `--add-dir`）

二进制内嵌源码 `packages/tui/src/autocomplete.ts`：补全 provider 的搜索根默认 `Ye()` = `process.cwd()`；
无路径前缀的查询走 `fuzzyFind({ path: <cwd>, gitignore: true })`（单根模糊搜索，`maxResults: 100`）；
带 `/` 前缀时把前缀 `ql.join(cwd, prefix)` 解析成目录再列举 / 模糊；
`@` 提及的**展开**（`packages/coding-agent/src/utils/file-mentions.ts` 的 `generateFileMentionMessages`）以
`sessionManager.getCwd()` 单根解析（`Js(e, cwd)` → 绝对路径直用、相对路径 resolve 到 cwd）。
`--add-dir` 的承诺只有「The agent is told these roots exist and can **read/grep/glob** them」——**不承诺补全**。

真实 PTY 实测（`omp --cwd front --add-dir back`）：

| 输入 | 补全候选 | 备注 |
|---|---|---|
| `@` | 只有 front 的一层目录（`front.txt`） | **没有 back 的任何东西**——用户的观察属实 |
| `@../back/ba` | `back.txt` | 带路径前缀就能跨目录列举 |
| `@/tmp/…/back/` | `src/`、`back.txt` | 绝对路径前缀逐层列举 |
| 发送 `@../back/back.txt` | TUI 显示 `Read ../back/back.txt (1 lines)`，回答文件内容 | `@` 的语义 = 发送时**预读进上下文** |
| `omp -p "@../back/back.txt" "…"` / `"@/abs/back/back.txt"` | 两者都读入成功 | CLI 与 TUI 共用同一解析器（相对基准 = 会话 cwd） |

结论：`@` 本身可用，缺的是「**不知道其他项目的路径时怎么挑**」——这正是壳侧要补的。

### 1.2 注入通道：bracketed paste 被 omp editor 原生识别

上游 `pasteToEditor` 的实现就是把文本包在 `\x1b[200~…\x1b[201~` 里交给 editor。真实 PTY 实测：
注入 `\x1b[200~@/tmp/omp-ref-test/back/back.txt \x1b[201~` 后——

- 输入框原样出现 `@/tmp/omp-ref-test/back/back.txt`（屏幕**没有**字面 `[200~` / `[201~`）；
- 不弹 `@` 补全浮层（路径完整、尾部空格结束查询）；
- 手动回车发送后，omp 显示 `Read /tmp/omp-ref-test/back/back.txt (1 lines)` 并回答文件内容。

因此壳侧注入**不采用**「逐字符键入」，也不需要在注入后处理补全浮层。

### 1.3 检索面：`git ls-files` 的相对基准

`git -C <项目目录> ls-files -c -o --exclude-standard -z` 输出**相对该项目目录**的路径
（仓库子目录下运行时也只输出相对自身的路径）——拼绝对路径（`项目路径 + "/" + rel`）即注入文本。
`-c` = 已跟踪、`-o` = 未跟踪、`--exclude-standard` = 排除 .gitignore 命中项；
非 git 目录 / git 缺失 / 超时 → 该项 `error` 字段（不拖垮整张列表）。

## 2. 设计与实现

### 2.1 交互

- **⌘⇧P**（非 mac：Ctrl+Shift+P；避让 omp TUI 自己的 Ctrl+P 模型轮换）在**终端标签**上打开
  「引用工作区文件」浮层；设置标签激活 / 无激活终端时不触发；已有浮层时被 `hasOpenDialog()` 挡住。
- 浮层：搜索框（自动聚焦）+ 按项目分组、**目录树**展示的结果（见 §2.3）；↑↓ 环绕（只走文件行）、
  Enter 确认、Esc 关闭（DialogShell / `useDialogFocus`）。
- Enter：先复核目标终端（可能已被关掉）→ 要求 **`running` 且 π = 等待输入**（与改名同一口径：
  工作态注入会被排进会话当用户输入；等待确认时会答到审批提示上）→ 注入后关闭浮层并聚焦终端。
  忙碌时给提示、**不注入、不关浮层**。
- 注入内容 = `@<绝对路径>` + 尾部空格（含空白 → `@"..."`），**不回车**——用户接着写需求，发送时才预读。

### 2.2 数据与范围

- 范围（`lib/workspaceFiles.ts` 的 `referenceScope` → `{ primary, others }`）：`cwd → 项目 → 工作区`；
  **只列「其他」成员项目**（当前项目 `primary` 排除——本项目文件在输入框里用 omp 原生 `@` 直接可补全）。
  - `primary` 找不到 / 目录丢失 → 提示「找不到所属项目」；
  - `others` 为空（未分组 / 单成员工作区 / 其他成员目录都丢失）→ 提示「没有可引用的其他项目」，**不发请求**；
  - 其他成员保持注册顺序，**不含 worktree**（与 `--add-dir` 协作根口径一致）。
- 文件列表：新 Rust 命令 `list_project_files(paths)`——逐项目并发（JoinSet）、结果顺序 = 入参顺序、
  逐项降级（目录不存在 / 未找到 git / 非仓库 / 超时都落该项 `error`）；
  60s 缓存（`LazyLock<Mutex<HashMap<…>>>`，超过 64 项清表）；上限 5 万/项目（超出截断并标记）。
- 查询：**按空白分词、全部命中（AND）、分数相加**（`src api` 这类输入才有结果）；
  单词语义（`scoreTerm`，越高越强）：末段精确 1000 / 末段前缀 900 / **词边界处包含 860**
  （`x-api-client.ts` 的 `api`）/ 路径段首或整串前缀 800（`src/api/…`、`api/x.ts`）/
  末段任意位置包含 700（`capitalize.ts` 的 `api`）/ **末段内紧凑子序列**（跨度 ≤ `词长 × 2 + 2`，
  起点在文件名开头或词边界给加成：`mts` → `main.ts` 优先于 `format.ts`；跨目录散布的
  `main` → `approval-menu/approval-mine-selected.svg` 这类假匹配直接丢弃）。
- 排序（`rankRefItems`）：总分降序 → rel 短者先 → 字典序；**每个项目**取前 200 条（达到上限给提示）。
- 高亮（`highlightName`）：目录行与文件行都把命中片段标成 accent 色（连续命中整段、子序列逐字符）——
  「`api` 命中 `src/api/` 目录、`capitalize.ts` 命中中间的 api」都能一眼看出为什么入选。

### 2.3 展示（资源管理器式目录树）

- 命中的文件按 `rel` 的 `/` 分段构建目录树（`buildRefTree`：同名目录合并、目录在前、同级按名字），
  再前序遍历成渲染行（`flattenRefTree`）——文件行的光标序号就是渲染序号（跨项目连续，导航不会跳）。
- 渲染（对齐代码编辑器的资源管理器）：项目组头（`项目名（命中数）`）→ 目录行（`Chevron` 展开箭头 +
  文件夹图标（accent 色，展开=`FolderOpen` / 折叠=`Folder`）+ 名字，整行可点击折叠）→ 文件行
  （chevron 位置留空、按扩展名给图标：代码 `CodeFile` / 文档 `FileText` / 图片 `Image` / 压缩包 `FileZip` /
  默认 `File`，只显示末段文件名、悬停 `title` 给绝对路径）；缩进 = `6 + 深度 × 14px`，行高约 21px。
- **折叠**：目录行点击切换；折叠 = 整棵子树跳过（`flattenRefTree` 的 `isCollapsed` 回调），目录行本身保留；
  折叠状态按「项目路径 + rel」记（跨项目同名目录不互相影响），**查询一变自动清空**（命中链路必须可见）。
  键盘 ↑↓ 仍只走文件行（目录不进光标序列）——引用场景下「找到文件」优先。
- 树内排序：**搜索态**（query 非空）按名次排——目录的 rank = 其子树最佳名次，最佳匹配所在的分支浮到同级最前
  （`main` 时 `main.ts` 排在 `src/api/…` 前）；**浏览态**（空 query）目录在前、同级按名字（资源管理器的默认观感）。

### 2.4 注入

- `lib/termRef.ts` 的 `insertFileReference`：`api.ptyWrite(id, "\u001b[200~" + "@<path> " + "\u001b[201~")`，
  失败静默（与键盘输入 / 改名同一口径的既有通道）。

## 3. 源码结构变化

- 新增 `src-tauri/src/project_files.rs`（命令 + 缓存 + 纯函数 + 单测；`main.rs` 注册）。
- 新增 `src/components/terminal/ReferencePicker.tsx`（浮层）+ `ReferencePicker.test.tsx`。
- 新增 `src/lib/workspaceFiles.ts`（范围 `referenceScope` / 候选 `buildRefItems` / 排序 `rankRefItems` /
  目录树 `buildRefTree` + `flattenRefTree` / 注入文本 `referenceInsertText`）+ 单测；
  `src/lib/termRef.ts`（可注入判定 + bracketed paste 注入）+ 单测。
- `src/shared/{ipc,api,types}.ts`：`listProjectFiles` / `ProjectFiles`；
  `src/stores/app.ts`：`refPickerTerminalId`；`src/app/App.tsx`：⌘⇧P 分支 + 挂载；
  `scripts/e2e-ipc-selfcheck.mjs`：模块清单加 `project_files.rs`。

## 4. 完成口径（已达成）

- ⌘⇧P → 浮层（**只列其他项目**、资源管理器式目录树：chevron 折叠 + 目录/文件类型图标）→ 输入过滤 →
  Enter → 终端输入框出现 `@<绝对路径> `（bracketed paste、不发送、不关终端）。
- 忙碌 / 目标消失 / 无其他项目 / 非 git 项目 / 加载失败（含重试）都有明确反馈，不静默失败。
- `pnpm check`（typecheck + lint 0 警告 + vitest 265 项 + e2e:ipc 57 命令双向一致）与
  `cargo test --locked`（141 项通过，7 ignored）全绿。

## 5. 实测记录（2026-09-28）

1. **上游**：§1 的 PTY / CLI 探测（临时目录自建自清；`--no-session`，无会话残留）。
2. **注入**：§1.2 的 bracketed paste 探测（真实 omp 18.3.5 TUI，输入框回显 + `Read` + 内容正确）。
3. **后端**：`project_files` 单测含真实临时 git 仓库（已跟踪 / 未跟踪未忽略 / ignore 排除 / 子目录相对基准 /
   非仓库降级）与命令层（并发顺序 + 逐项 error）。
4. **前端**：`workspaceFiles.test.ts`（15）/ `termRef.test.ts`（3）/ `ReferencePicker.test.tsx`（4：只列其他项目 +
   目录树 + 注入参数、无其他项目提示且不发请求、忙碌拒绝、失败重试）/ `App.test.tsx` 新增 ⌘⇧P 四例
   （打开、设置标签不触发、⌘P 不触发、对话框守卫）。
5. **缺口**：真机 GUI 手测（`pnpm tauri:dev` 里真实点击）**未执行**——本机 screen recording / accessibility
   权限均为 denied（computer 与 osascript 都被系统拒绝），不做系统权限变更。已用 PTY 实测（注入 → omp 行为）
   + 组件 / App 测试（UI → 注入调用）+ 真实仓库单测（后端）三段闭环替代；有 GUI 权限的环境可按 §4 复跑。

### 5.1 二轮修订（同日，按用户截图反馈）

用户反馈两点：① 浮层里不该出现**当前项目**（本项目文件用 omp 原生 `@` 即可）；② 平铺路径列表的观感差，
希望按**目录结构**展示。修订：范围改为「仅其他成员项目」（§2.2）、结果改为按项目分组 + 目录树缩进（§2.3）。

视觉核对（补充证据，**真实 Chromium**：`pnpm build` + `pnpm preview` + headless Chromium，
`init_scripts` 注入 `__TAURI_INTERNALS__` mock —— 两个项目 + 一个工作区、`list_project_files` 返回
`tracsys_web` 的 10 个文件）：

- `⌘T` 在 `esv-comsys-web` 开终端 → `⌘⇧P`：浮层只列 `tracsys_web（10）` 一棵树，
  `src/ → api/ assets/ layout/ views/` 逐层缩进，**没有当前项目 esv-comsys-web 的任何文件**；
- 输入 `main`：结果收敛为 5 条，**祖先目录保留**（`src/assets/approval-menu/`、`src/views/document/edit/` 等），
  文件行只显示末段名、行高约 24px；
- 两种状态下 `Enter 插入 @路径（不发送）` 提示与组头计数均正确显示。

### 5.2 三轮修订：资源管理器式树（同日，按用户参考图反馈）

用户反馈「展示很简陋，期望像代码编辑器的资源管理树」。实现：目录行加 `Chevron`（展开/折叠）+
文件夹图标（accent 色，`FolderOpen`/`Folder`）+ 整行可点击折叠；文件行按扩展名给图标
（代码 / 文档 / 图片 / 压缩包 / 默认）、chevron 位留空保持图标列对齐；行高收到 ~21px；
列表高 `max-h-[28rem]`。折叠 = 子树跳过（目录行保留），查询变化自动清空折叠状态；键盘导航仍只走文件行。

视觉核对（同 §5.1 的 Chromium + mock 环境，20 个文件、多个嵌套目录）：

- 展开态：`public/ scripts/ src/ vendor/` 四个目录带蓝色文件夹图标与 `⌄`，文件按类型给图标（`.ts/.vue` 代码、
  `.svg/.ico` 图片、`.zip` 压缩包、`.md` 文档）、缩进层级清晰；
- 折叠 `src` 后：其下 15 个文件行全部消失、目录行保留且箭头转 `›`、图标转闭合 `Folder`，其余目录不受影响；
- 过滤 `main`：命中 5 条，`src/assets/approval-menu/`、`src/views/document/edit/` 祖先目录保留。

### 5.3 四轮修订：搜索准确性（同日，按用户「结果对应不上」反馈）

根因（Chromium 探针实测）：① 旧子序列匹配跨整个相对路径、无跨度上限——`main` 会把
`src/assets/approval-menu/approval-mine-selected.svg` 当命中（m→a→i→n 散布在多个目录里）；
② 树内固定按目录自然序重排，弱匹配与强匹配混在一起；
③ 查询不做分词，`src api` 这类输入整串匹配直接零结果；
④ 命中只作用于文件名，路径命中（`api` → `src/api/*`）在界面上没有任何标记。

修复：子序列**只认文件名内、且跨度 ≤ 词长 × 2 + 2**；引入**词边界**（分隔符 / 小驼峰）与
**起点加成**（`mts` 先命中 `main.ts`）；查询**按空白分词、AND、分数相加**；树内**搜索态按名次排**
（目录 rank = 子树最佳名次）；目录行与文件行都做**命中高亮**。

Chromium 探针复核（19 个文件、多目录）：

| 查询 | 修复前 | 修复后 |
|---|---|---|
| `main` | 混入 `approval-mine*.svg` 两条假匹配 | `main.ts / main.test.ts / mainLayout.vue / mainTipTap.vue`（全部真命中） |
| `api` | `capitalize.ts`（文件名中间含 api）排最前 | `src/api/` 下三条在前、`capitalize.ts` 居末；目录名 `api` 高亮 |
| `src api` | 零结果 | `src/api/` 下三条（+ `capitalize.ts`） |
| `mts` | `format.ts` 排第一 | `main.ts` 第一（起点加成） |

## 6. 边界

- 不做 omp 扩展原生 `@` 补全（上游扩展 API 无版本契约，长期维护成本高）。
- 不列 worktree 目录里的文件（范围 = 项目主目录，与 `--add-dir` 一致）；非 git 项目不列文件。
- 引用后不自动发送（用户接着写需求）；`@` 载荷只认文件系统路径（上游语法，不可改）。
