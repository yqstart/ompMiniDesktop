# ompMiniDesktop 十七期（V17）：会话标题与改名 + 批量归档 + git 快照刷新 + 内存实测

> 基线：V16 已交付（终端 nerd 图标字体）。本文记录这一期的四项用户反馈——**上游实测 → 实现口径 → 完成核验**。
> 用户口径（四条）：① 左栏会话的 git 状态更新不及时；② 终端标题 / 会话标题不该是项目标题，应该是会话标题并且可以支持修改；③ 项目里的会话支持批量归档、删除；④ 开 3 个 omp 终端占用内存高达 7G——查清是 omp 本身还是 app。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| ① git 徽章为什么「不及时」？ | 刷新时机缺了「终端里的 git 活动」这一类：agent 或用户手敲 git **不改变 omp 的 π 状态**，等不到「干完活」那个时机（只覆盖 agent 整轮结束的场景）。补两个时机：**窗口重新获得焦点**、**可见时 30s 兜底轮询**（上一轮没回来就跳过这一轮；单轮 = 每个工作区一条 `git status --porcelain -b`，与「点开一次左栏」同量级）。 |
| ② 终端标签为什么显示项目名？ | omp 的 OSC 标题在会话**还没有标题**时，名字位发的是 **cwd 末段目录名**（实测：`π > omp-pty-probe`）——那是「项目名」。会话标题一生成（或 `/rename` 后）就换成会话标题（实测：resume 旧会话首发 `π > Filter terminals by active workspace`）。壳侧现在把回退值认出来、不当作标题显示（退回工作区名「项目 · 分支」）。 |
| ② 会话标题怎么改？ | omp TUI 原生命令 `/rename <title>`（实测 18.2.10：改完立刻更新 jsonl 的 `title_change` 事件、并**立即用 OSC 标题广播**）。壳侧经 PTY 注入实现：`Ctrl+U`（清掉输入行草稿）→ `/rename <name>` → `\r`；omp 自己写回会话、自己广播——壳侧**不留本地覆盖**（真相单一）。只在 `π = 等待输入` 时允许注入。 |
| ③ 批量归档 / 删除 | 会话弹窗行首勾选 + 底部操作条（归档 / 恢复 / 删除 / 清除选择）；归档与恢复各按选中集的适用项过滤（没有适用项时禁用），删除走同一个二次确认；「全选」作用在当前过滤结果上。复用 `lib/sessionBatch.ts`（与设置 ›「已归档对话」同一份分批与失败聚合）。**口径已被 §4 增补取代**：去掉勾选，改成常驻的「全部归档 / 全部删除」。 |
| ④ 7G 内存是谁的？ | **主要在 omp 侧**。每个 omp 终端是一个 Bun 单文件二进制：空闲 footprint ≈ 500MB（RSS ≈ 770MB），另有 `__omp_worker_daemon_broker`（多实例共享一个，RSS 135–195MB）；agent 干活时单个实例实测涨到 1.05GB RSS。app 侧 = 主进程 ≈ 176MB + WKWebView（WebContent footprint ≈ 380MB、RSS ≈ 900MB，其中大半是共享库映射）+ GPU / Networking ≈ 80MB。**三终端空闲合计 ≈ 2.5–3GB**；三终端各跑 agent 时逼近 5–7GB 是 omp 的运行时开销，不是壳泄漏。 |

## 1. 上游实测（omp 18.2.10）

### 1.1 OSC 标题的两种形态

用真实 PTY 抓 omp 的 OSC 0/2 序列（`python3 pty.fork` + 抓 `\x1b]0;…\x07`）：

| 场景 | OSC 标题 | 含义 |
|---|---|---|
| 新会话（未生成标题），cwd = `/tmp/omp-pty-probe` | `π > omp-pty-probe` | **回退名 = cwd 末段目录名** |
| 新会话首帧（标题未定） | `π >` | 名字位为空（壳侧保留上一次的名字） |
| `omp --resume 01a0cbe2`（该会话 jsonl 标题 = "Filter terminals by active workspace"） | `π > Filter terminals by active workspace` | **会话标题** |
| `/rename CtrlU-Probe` 之后 | `π > CtrlU-Probe` | 改名后立即广播 |

- 会话标题的持久化形态 = jsonl 的 `title` / `title_change` 事件（壳侧 `session_scan.rs` 早就在读）；
- 分隔符 = 运行状态（`>` 等你输入、`!` 等你确认、转轮字形 = 工作中），与 V11 既有口径一致。

### 1.2 `/rename` 的注入实测

在 PTY 里按「打字 → Ctrl+U → 输入 `/rename CtrlU-Probe` → 回车」的次序写字节，实测：

- `\x15`（Ctrl+U）**确实清空输入行草稿**（草稿 `draftABC` 没有混进命令）；
- 命令被当作 TUI 命令处理，回显 `Session renamed to "CtrlU-Probe".`，**不触发任何模型调用**；
- 紧随其后发出 `π > CtrlU-Probe`（OSC 广播）——tab 上的名字由此自动更新；
- 会话首次落盘时 `title_change` 写入 jsonl（懒写：无对话的会话要等首次落盘）。

**为什么只在 `π = 等待输入` 时允许改名**：工作态（转轮）注入的文本会被排进会话当**用户输入**；等待确认（`!`）时注入会答到审批提示上。两种都会造成真实副作用，壳侧直接拒绝并说明原因。

### 1.3 内存基线（本机实测，Apple M1 / macOS 26.6）

| 进程 | RSS | footprint | 说明 |
|---|---|---|---|
| omp 主进程（空闲，独立起 3 个） | 764 / 775 / 765MB | 499 / 499 / 514MB | Bun 单文件二进制：JS VM Gigacage + MALLOC_SMALL 为主 |
| omp 主进程（app 内，跑 agent ~15min） | 1.05GB | — | 上下文 / 工具输出累积后的量级 |
| `__omp_worker_daemon_broker` | 135–195MB | — | omp 自己的后台 broker，多实例共享一个 |
| ompMiniDesktop 主进程 | 176MB | — | Tauri 壳（含 PTY 读线程） |
| WebKit WebContent（前端世界） | 900MB | 381MB（peak 793MB） | 其中 ~540MB 是与其它 WebKit 进程共享的库映射 |
| WebKit GPU / Networking | 67 / 10MB | — | WebKit 固定开销 |

结论：**看内存要看 footprint，不是活动监视器的「RSS」**——WebKit 与 omp 的 RSS 都含大量共享库映射，直接相加会明显高估；而 omp 的 footprint 与上下文规模强相关，属于上游运行时开销，壳侧不代偿。

## 2. 实现

### 2.1 会话标题（`TerminalView.title`）

- `src/lib/termTitle.ts` 新增两个纯函数：
  - `isWorkspaceNameFallback(label, cwd)`：`label === cwd 末段目录名` = omp 的「会话还没有标题」回退值；
  - `terminalDisplayName(term)`：`title ?? label`（会话标题优先，未就绪回退工作区显示名）。
- `stores/app.ts` 的 `setTerminalTitle`：回退值落 `null`（清掉旧标题，避免「项目名冒充会话标题」）；标题帧没带名字（`π ⠋`）时保留上一次；重启终端清空标题（新进程未必是同一个会话）。
- 展示口径（标签栏 / 快速切换）统一走 `terminalDisplayName`。

### 2.2 双击改名（`src/lib/termRename.ts` + 标签栏）

- `sanitizeSessionTitle`：去掉全部控制字符（`\p{Cc}`，含换行——注入文本必须是一行，否则后半截会被当第二次输入）、trim、长度上限 80；清洗后为空 = 非法。
- `canRenameSession`：`status === "running" && state === "ready"`（见 §1.2 的理由）。
- `renameTerminalSession`：`api.ptyWrite(id, "\u0015/rename <name>\r")`，不落任何本地状态。
- 标签栏：双击标签进入内联编辑（draft 初值 = 当前会话标题），回车提交 / Esc 取消 / 失焦取消；提交失败（非法 / 忙）保持在编辑态，第二行显示原因、输入框描边转 danger、`aria-invalid` 置位；悬停提示写明「双击重命名会话」。

### 2.3 会话弹窗批量操作

> **该小节已被 §4 增补取代**（去掉勾选，改成常驻的「全部归档 / 全部删除」）；下面保留交付当时的记录。

- 行首勾选框（原生 checkbox + `accent-color`）；顶部元信息行右侧「全选（N）」（作用于当前过滤结果）；
- 底部操作条（有选中才出现）：已选 N 项 · 归档（适用未归档）· 恢复（适用已归档）· 删除（二次确认，标题带数量）· 清除选择；
- 写操作统一收口（防重入 / 忙态 / 失败明细 / 完成后刷新列表），单条行内按钮语义不变。

### 2.4 git 快照刷新时机

`App.tsx` 的 `useWorkspaceGitRefresh` 增加 `window` 的 `focus` 监听（与 `visibilitychange` 同一处理），`lib/commitTasks.ts` 增加 `startWorkspaceGitPolling(30s)`（`document.hidden` 跳过、`pollBusy` 防重入，返回清理函数）。既有的「π 转就绪防抖 2s / 任务结束单点刷新 / 工作区清单变化」不变；点按钮时的后端预检仍是最终裁决。

## 3. 完成核验

> 下表「批量归档 / 批量删除 / 适用项过滤」三行是 V17 交付当时的勾选口径记录；会话弹窗的现行口径与核验见 §4。

| 项 | 证据 |
|---|---|
| 标题回退值不显示 | mock OSC `π > mockproj`（cwd 名）→ 标签显示「mockproj · main」（工作区显示名） |
| 会话标题优先 | mock OSC `π > 修登录 bug` → 标签显示「修登录 bug」 |
| 改名注入 | 双击 → 输入 → 回车：`pty_write` 收到 `\u0015/rename <name>\r`；omp 回播新标题后标签更新 |
| 改名拒绝 | 空标题 → 「标题不能为空…」且零注入；`π ⠋`（工作态）→ 「会话正忙…」且零注入；回到 `π >` 后同一次提交成功 |
| 批量归档 | 勾 2 行 → 归档：`archive_sessions ["s1","s2"]`，选择清空、列表刷新 |
| 批量删除 | 全选 → 删除：确认框标题「删除选中的 3 个会话？」→ `delete_sessions ["s1","s2","s3"]` |
| 适用项过滤 | 只勾已归档项 → 「归档」禁用、「恢复」可用 |
| 单条行内操作回归 | 行内归档 = `archive_sessions ["s1"]`；行内删除确认框标题 = 会话标题；取消无删除 |
| focus 刷新 | 派发 `window` 的 `focus` → `get_workspace_git_state` 调用数 +1 |
| 30s 轮询 | 33 秒窗口内 `get_workspace_git_state` 调用数 +1（可见时） |
| 门禁 | `pnpm check`（typecheck + lint + 194 单测 + e2e:ipc 50 命令双向）· `cargo test` 116 通过 |

## 4. 增补（2026-09-23）：会话弹窗去掉勾选——改成「全部归档 / 全部删除」

用户口径：**会话不需要复选框，直接「全部归档」「全部删除」即可**。

### 4.1 实现

- 行首勾选框、顶部元信息行右侧「全选（N）」、底部「已选 N 项 / 清除选择」整组退场；`selected` 状态与「按选中集过滤适用项」的派生逻辑一并删除（少一个状态就少一类竞态）。
- 底部操作条改为**常驻**（列出非空即出现），只留两个动作：
  - `全部归档（N）`：N = 当前过滤结果里**未归档**的行数，为 0 时禁用；
  - `全部删除（N）`：N = 当前过滤结果的**全部**行数（含已归档），仍走 `ConfirmDialog`（标题「删除全部 N 个会话？」）。
- 作用域 = **当前过滤结果**：搜索框有词就是搜出来的那批，没词就是列出的全部；按钮上的数量即作用域，不会「搜完删全库」。
- 写入路径不变：`lib/sessionBatch.ts` 分批（单批 200）+ 失败聚合；行内单条归档 / 恢复 / 删除的语义与二次确认不变。
- 字典键：新增 `sessArchiveAll` / `sessDeleteAll` / `sessDeleteAllConfirm` / `sessDeleteAllDetail`；删除 `sessSelectAll` / `sessClearSelection` / `sessSelectedCount` / `sessSelectAria` / `sessDeleteSelected` / `sessDeleteSelectedDetail`。

### 4.2 核验

方式同 §3：`pnpm build` + `pnpm preview` + 浏览器（`evaluateOnNewDocument` 注入 IPC mock：3 行会话 = 2 未归档 + 1 已归档，`archive_sessions` / `delete_sessions` 在 mock 里真的改状态，刷新后可见）。

| 项 | 证据 |
|---|---|
| 无复选框 | 弹窗内 `input[type="checkbox"]` 计数 = 0 |
| 数量口径 | 3 行（2 未归档 / 1 已归档）→ `全部归档（2）` + `全部删除（3）` |
| 全部归档 | 点击 → `archive_sessions {"ids":["s1","s3"]}` → 刷新后按钮变 `全部归档（0）` 且禁用，3 行全带「已归档」角标 |
| 过滤态作用域 | 搜「未命名」→ 1 行 /「匹配 1 条」/ `全部归档（0）`（该行已归档）· `全部删除（1）` |
| 全部删除（取消） | 点击 → 确认框标题「删除全部 3 个会话？」+ 说明；点「取消」→ 零 `delete_sessions`、行数不变 |
| 全部删除（确认） | 再点 → 确认 → `delete_sessions {"ids":["s1","s2","s3"]}` → 列表转空态「这个项目还没有会话」、底部操作条消失 |
| 门禁 | `pnpm check`（typecheck + lint + 205 单测 + e2e:ipc）全过 |
