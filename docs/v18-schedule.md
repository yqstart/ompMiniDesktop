# ompMiniDesktop 十八期（V18）：终端标签单行 + 会话标题语言

> 基线：V17 已交付（会话标题与改名 / 批量归档 / git 快照刷新）。本文记录这一期的两项用户反馈——**上游实测 → 实现口径 → 完成核验**。
> 用户口径（两条）：① 终端标签不要展示路径，只展示会话标题；② 生成会话标题时要按界面语言（国际化）决定中文还是英文。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| ① 标签里的路径是什么、为什么去掉？ | 标签原本是**两行**（会话标题 + cwd 绝对路径），路径在 160–192px 宽的标签里必然截断成 `/Users/yanqi/Des…`，既读不出信息又挤掉标题。V18 起标签**只一行**：π 状态标 + 会话标题；完整 cwd 降级到悬停提示（`title` 属性）里，工作目录由左栏选中项与标签栏的工作区过滤表达。 |
| ② 标题语言怎么定？ | 上游**没有** CLI / 设置项能改标题 prompt（`omp --help` 只有 `--no-title`；`omp config list` 只有 `title.refreshOnReplan`）。唯一机制是 `TITLE_SYSTEM.md` 覆盖标题生成 prompt——**项目级 `<cwd>/.omp/TITLE_SYSTEM.md` 优先，其次用户级 `<agentDir>/TITLE_SYSTEM.md`**。壳侧按界面语言写用户级那一份（中文 / 英文两份固定文本），omp 在**会话启动**时读取。 |
| ② 之前配过的 `pi-session-title.json` / `title-prompt.txt` 为什么没用？ | 那是 **Pi 时代**（改名前的上游）的机制：omp 18.2.10 的二进制里 `pi-session-title` / `title-prompt` 字符串 **0 命中**，早已不读。现行唯一路径是 `TITLE_SYSTEM.md`。 |

## 1. 上游实测（omp 18.2.10）

### 1.1 机制（源码 + 官方文档）

| 事实 | 出处 |
|---|---|
| 标题 prompt 发现顺序：项目级 `<cwd>/.omp/TITLE_SYSTEM.md` → 用户级 `<agentDir>/TITLE_SYSTEM.md`（no-ancestor-walk，直接在 cwd 下的受支持 config base） | `packages/coding-agent/src/system-prompt.ts` 的 `discoverTitleSystemPromptFile`；`docs/system-prompt-customization.md`「Customize automatic session titles」 |
| 自定义文本是 **plain text**（不是 Handlebars），整份作为标题请求的 system prompt，上游随后自动追加 `<title>` 标记指令 | `utils/title-generator.ts`：`titleSystemPrompt ? [titleSystemPrompt, TITLE_MARKER_INSTRUCTION] : [TITLE_SYSTEM_PROMPT]` |
| 内置标题 prompt **不指定语言**（`Write a ~5 word title …`）——所以默认语言由模型自由发挥（实测英文） | `prompts/system/title-system.md` |
| 输出归一契约：只取首行、去引号与 `<title>` 标记、去句末标点；> 80 字符或 > 12 个词整体拒绝（会话留名给下一次尝试） | `tiny/text.ts` 的 `normalizeGeneratedTitle` |
| 生效时机：**会话启动**读一次；move / 重启会话时重读（`refreshTitleSystemPrompt`） | `modes/interactive-mode.ts` |
| 没有 CLI flag 能指定标题 prompt（`--no-title` 只关自动标题）；`omp config list` 里只有 `title.refreshOnReplan` | 本机 `omp --help` / `omp config list` |

### 1.2 三组 PTY 实测（真实 TUI，本机 omp 18.2.10）

方法：`python pty.fork()` 起 `omp --cwd <临时目录> --session-dir <临时目录>`，抓 OSC 0/2 标题序列 `\x1b]0;…\x07`，等 TUI 就绪后注入一条用户消息。

| 组 | 用户级 `TITLE_SYSTEM.md` | 用户消息 | 生成的会话标题（OSC） |
|---|---|---|---|
| A | 无（默认） | 英文 | `Meaning of HTTP Status 301`（**英文**） |
| B | 中文要求 | 英文 | `解释 HTTP 301 状态码含义`（**中文**） |
| C | 英文要求 | 中文 | `DNS Resolution Process One-Sentence Explanation`（**英文**） |

结论：**标题语言由 `TITLE_SYSTEM.md` 决定，与用户消息语言无关**；用户级路径（壳写的那份）确实被 omp 读取。三组都先出现 `π ⠙ <cwd 末段名>` 的回退标题（V17 已处理的形态），标题生成约在首条消息后 2–4 秒到位。

另外两条实测：

- **`omp -p`（print 模式）不生成标题**：首轮实验（非交互 `-p` + `--session-dir`）的 jsonl 里只有空的 `title` 记录、没有 `title_change`——标题生成只在 TUI 会话里跑。壳走的就是 TUI，不受影响。
- 用户级文件写在 `~/.omp/agent/TITLE_SYSTEM.md`（本机 `omp config path` 解析出的 agentDir）；实验后已删除、恢复原状。

## 2. 实现口径

### 2.1 终端标签单行（`TerminalTabs.tsx`）

- 删掉名字行下方的 cwd 行；标签从 `h-11`（44px）改为 `min-h-9`（常态 36px，单行），标签栏列表容器 `items-stretch` → `items-center` 让单行标签垂直居中；设置标签同高。
- cwd 不丢：标签的 `title` 悬停提示仍是 `<cwd>\n<改名提示>`。
- 改名（V17）的**错误行保留**：只在编辑期出现（提交非法 / 忙时名字行下方显示 danger 文案 + 输入框描边转 danger），标签高度由内容决定，常态仍是 36px 单行。

### 2.2 会话标题语言（`title_prompt.rs` + `lib/titlePrompt.ts`）

- 后端 `src-tauri/src/title_prompt.rs`：把界面语言写成 `<agentDir>/TITLE_SYSTEM.md`，两份固定文本（`TITLE_PROMPT_ZH` / `TITLE_PROMPT_EN`）。
  - **谁的文件归谁**：只认「文件不存在」或「内容恰好是壳的两种文本之一」的文件；用户自写的（内容不同）一律跳过（`skipped`），永不覆盖。
  - 原子写（同目录临时文件 + rename，与 `models_config.rs` 共用 `write_atomic`）。
  - 命令 `sync_title_prompt(lang)`（`lang` ∈ `zh` / `en`，其它值拒绝）。
- 前端 `src/lib/titlePrompt.ts` + `App.tsx` 的 `useTitlePromptSync`：等健康检查解析出 `agentDir` 后再同步（非默认 profile / `PI_CONFIG_DIR` 下路径不同），语言每变一次同步一次；**失败静默**（omp 不可用 / 用户接管文件都不该打扰）。
- 生效范围：写入的是**用户级**文件 → 该 agentDir 下**所有新会话**（不止壳内）按新语言生成标题；项目级 `TITLE_SYSTEM.md` 存在时项目级优先（壳侧不碰用户仓库）。**已在跑的会话保持原语言**——omp 只在会话启动时读该文件（与 `cycleOrder` 同一口径，壳侧不代偿）。
- 壳没有写任何 `omp config` 键；这是继 `models.yml` 之后第二个「上游无 CLI 入口、只能写文件」的例外，且理由相同。

## 3. 完成核验

| 项 | 结果 |
|---|---|
| Rust 单测 | `title_prompt` 3 项通过：缺失即写 → 同语言幂等（`unchanged`）→ 换语言重写；用户自写文件跳过（`skipped`）且内容不变；未知语言档报错 |
| Rust 全量 | `cargo test` 119 passed / 6 ignored（`--ignored` 慢测试未在本期跑） |
| 前端单测 | `pnpm test` 201 通过（28 文件），新增 `App.test.tsx` 用例：健康落定后按 `zh` 同步、切语言后再同步 `en` |
| IPC 契约 | `pnpm e2e:ipc`：51 命令双向一致（ipc.ts ↔ main.rs ↔ 实现） |
| lint | `pnpm lint` 0 警告 |
| 真实 omp | §1.2 三组（默认英文 / 中文档 → 中文 / 英文档 → 英文） |
| 界面核对（vite dev + CDP main world 注入 IPC mock） | ① 点工作区行开终端 → 标签 `π 修复登录页样式`（单行、36px、宽 192px），页面可见文本**不含** `/Users/mock/proj-login`，悬停提示仍含 cwd；② 健康落定 → `sync_title_prompt {lang:"en"}`（当时界面为 EN），点「简体中文」→ `sync_title_prompt {lang:"zh"}`；③ 双击标签改名提交空标题 → 错误行「标题不能为空，也不能包含换行等控制字符」出现、标签仍 36px；④ 终端面板正常挂载 xterm（`.xterm` 存在，OSC 标题被解析成标签文本）。 |
| mock 协议要点（沿用 V16/V17 记录） | Tauri v2 的 `Channel` 回调参数是 `{index, message}`，**`index` 从 0 开始自增**（第一次必须发 0，否则消息进 pending 永不投递）；`message` 直接是对象（无需 `JSON.stringify`）；`transformCallback(fn, once)` 返回自增 id，`toJSON()` 得 `__CHANNEL__:<id>`。 |

## 4. 未覆盖 / 边界

- 已开会话不热读新语言（上游行为）；要让旧会话换语言只能重开终端。
- 壳不识别项目级 `TITLE_SYSTEM.md`（存在时静默优先，属用户自己的显式配置）。
- 用户手改用户级 `TITLE_SYSTEM.md` 后再切语言：内容已不等于壳的两种文本 → 壳判定「用户接管」，之后不再写。
- 标题归一契约（80 字符 / 12 词）内中文标题按 `[\p{L}\p{N}]+` 分词算**一个词**，不受 12 词上限影响；80 字符上限对「约 5 个词」的中文标题余量充足。
