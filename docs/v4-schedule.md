# ompMiniDesktop 四期（V4）功能排期：记忆页

> 基线：V1 / V2 / V3 已交付（见 `CHANGELOG.md`）；本文只排四期，不重开已冻结的口径。
> 目标：把 omp 的**项目记忆**映射进设置页——新增「记忆」页签，可查看、可删除。
> 约束不变：真相在 omp/jsonl；覆盖层只有 `overlay.json`；不用轮询文件做伪实时；前端不自算 token。

## 0. 范围与口径

用户口径：「在设置中新增一个『记忆』tab，映射 omp 的项目记忆文件，可以查看删除记忆。」

| 页签 | 区块 | 映射的上游物 | 写入什么 |
|---|---|---|---|
| 记忆 | 项目记忆清单 | `<agentDir>/memories/`（按 cwd 一目录一份） | **不写**（只读 + 删除） |
| 记忆 | 查看 | 目录内的 Markdown 文件正文 | — |
| 记忆 | 删除 | 删单个文件 / 删整个记忆目录 | omp 的记忆文件（`rm`） |

**这一页只做「列 / 看 / 删」，没有写入路径**——omp 侧记忆由 agent 工具（`learn`）与启动时的后台整理流水线写出，壳侧没有可映射的写入口（没有 `omp memory` 这类 CLI）。因此 V3「设置页是全 app 唯一改 omp 状态的地方」的口径不变：记忆页**不是**写入面，只是删除面（删除本质是文件系统操作，不经过 omp 的任何配置/凭证）。

范围外（本批不做，见 §4）：编辑 / 新增记忆、触发 omp 重新整理（`/memory enqueue` 等价物）、记忆内容的语义化检索、打开记忆所在目录。

## 1. 上游事实（本机 omp 18.2.1 实测）

**① 记忆不是项目里的文件，而是 agentDir 下按 cwd 编码的独立目录**

- 根目录：`<agentDir>/memories/`。agentDir 解析顺序与既有实现一致（`PI_CODING_AGENT_DIR` > `omp config path` > `~/.omp/agent`）。
- 目录名编码：`--` + `path.resolve(cwd)` 去掉首斜杠、把 `/` `\` `:` 替换为 `-` + `--`。
  实测落盘佐证：`/Users/yanqi/Desktop/WorkSpace/mino` → `--Users-yanqi-Desktop-WorkSpace-mino--`、`/tmp` → `--tmp--`。
- 编码来源：二进制内嵌源码里的 `agentSubdir(agentDir, "memories", "state")` 与目录名函数
  `--${resolve(cwd).replace(/^[/\\]/,"").replace(/[/\\:]/g,"-")}--`（`strings` 提取，两处相同实现）。
- **与 `sessions/` 的目录名不是同一套编码**：sessions 用的是相对 home/tmp 的短名（形如 `-Desktop-WorkSpace-ompMiniDesktop`，超长时有 hash 回退），memories 用的是完整绝对路径编码。两边不能互推。
- 作用域是 **cwd 本身**（不是 git root）：同一仓库的不同 worktree 是两份记忆。

**② 目录内的文件（全部是 Markdown，没有 frontmatter 框架）**

| 文件 | 内容 | 由谁写 |
|---|---|---|
| `MEMORY.md` | 长期记忆正文（`# <项目名> Long-Term Memory` + 分节条目） | Phase 2 汇总 |
| `memory_summary.md` | 会话启动时注入 system prompt 的摘要（上限 `memories.summaryInjectionTokenLimit`，默认 5000 token） | Phase 2 汇总 |
| `raw_memories.md` | Phase 1 逐会话抽取的原始记忆（`## <thread-uuid>` + `updated_at:` 分条） | Phase 1 抽取 |
| `rollout_summaries/<uuid>-<slug>.md` | 每个会话一段短 synopsis | Phase 1 抽取 |
| `skills/<name>/SKILL.md`（+ `scripts/` 等） | 自动整理出的可复用技能包 | Phase 2 汇总 |
| `learned.md` | `learn` 工具写入的教训（`autolearn.enabled: true` 时才有） | agent 工具 |

生成时机：**启动时的后台流水线**（两阶段：逐会话抽取 → 汇总），跳过 12 小时内活动 / 超过 30 天 / 当前活跃的会话。所以「项目里有会话」≠「有记忆」——本项目自己就还没有记忆目录，直到某次整理跑过。

**③ 记忆后端是可切换的**：`memory.backend` 取 `off | local | hindsight | mnemopi | sharpshooter`（`omp config list` 可见）。只有 `local` 写上面这批文件；其余后端写 SQLite / 远程服务 / 别的目录。**本页映射的是 `local` 后端的产物**——换了后端这一页就是空的（不是坏了）。

**④ 没有 `omp memory` CLI**：bash/zsh/fish 补全里都没有 `memory` 子命令；`omp gc` 只管 sessions/blobs。管理入口只有 TUI 的 `/memory <view|stats|diagnose|clear|reset|enqueue|rebuild|queue|sync|mm>` 与 agent 工具（local 后端下 `recall`/`retain`/`reflect`/`memory_edit` 不可用，只有 `learn`）。**删除的唯一方式就是删文件 / 删目录**（TUI 的 `clear` 也是 `rm MEMORY.md` + `rm memory_summary.md` + `rm -r skills/`）。

**⑤ 目录名不可逆**：路径里的 `-` 与分隔符编码后同形（`a-b/c` 与 `a/b-c` 都编码成 `a-b-c`）。壳侧要把目录名解回 cwd，只能拿真实文件系统当字典逐级匹配（见 §2），解不出的（项目已删/改名）退回显示编码名。

## 2. 实现

**后端（`src-tauri/src/memories.rs`，4 个命令）**

| 命令 | 干什么 |
|---|---|
| `list_memories` | 扫 `<agentDir>/memories/`：每个目录给出编码名、解出的 cwd、显示名、文件清单（相对路径 / 大小 / 修改时间 / 分类） |
| `read_memory_file` | 读单文件正文（上限 1MB，超出按字符边界截断并标记 `truncated`） |
| `delete_memory_file` | 删单个文件（删后把变空的父目录链收掉，到记忆目录为止） |
| `delete_memory_project` | 清空一个项目的全部记忆（删整个记忆目录） |

- **目录名解码**（`decode_cwd`）：去掉 `--` 包裹、按 `-` 分段，从 `/` 起逐级拼真实目录名、**优先少合并**（先按单段试再试两段）。`ESV-tracsys-web` 这类含连字符的目录就是靠逐级合并解出来的；解不出返回 `null`（界面退回编码名并标 warn）。
- **显示名**：解出的 cwd 命中覆盖层项目（复用 `owner_project` 的前缀匹配）→ 项目名；否则路径末段；再否则编码名。
- **排序**：目录按最近修改倒序；目录内文件 `MEMORY.md` / `memory_summary.md` / `learned.md` / `raw_memories.md` 固定置顶，其余按相对路径字典序。
- **安全边界**（`safe_path`）：目录名与相对路径都按不可信输入处理——拒绝绝对路径、`..`、`.`、反斜杠与空串，目录 canonicalize 后必须在记忆根内，文件若存在再 canonicalize 复核一次（防目录内符号链接越界）；记忆根不存在时直接报错，不静默返回空。
- 跳过隐藏文件（`.DS_Store` 之类）与符号链接；枚举有文件数（2000）与深度（6 层）上限。
- 纯逻辑（解码往返、形状校验、排序、路径拒绝、UTF-8 截断）与真实文件行为（读 / 删 / 空目录回收 / 根目录不可误删）都有单测。

**前端（`src/components/settings/MemoryPanel.tsx`）**

- 设置页从四个页签扩到五个：`通用` / `供应商` / `模型` / **`记忆`** / `已归档对话`（记忆与归档同属数据管理面，放相邻）。
- 标题行：`Notebook` 图标 + 「记忆」+ 项目计数 + 「刷新」；一行口径说明（映射 `~/.omp/agent/memories`、omp 自动生成、本应用不写、删除不可撤销且下次整理可能重新生成）。
- 按项目分组（组头 = 折叠箭头 + 项目名 + mono 路径/「原项目路径已不存在」+ 文件数与总大小 + 「清空记忆」）+ 文件行（相对路径 + 分类标签 + 大小 + 日期 + 「删除」）。
- 点文件行**行内展开** Markdown 预览（设置页是可滚动容器，浮层会被裁掉）：懒加载、一次只展开一个、内容缓存、删除后清缓存；渲染复用 `react-markdown` + `remark-gfm` + `rehype-highlight`（不引新依赖、不用 `dangerouslySetInnerHTML`），截断时明写「已截断」。
- 删除（单文件 / 清空）都走 `ConfirmDialog`（danger），文案写明删什么、不可撤销、可能重新生成。

## 3. 完成口径

- `pnpm check`（typecheck + lint + test + e2e:ipc + e2e:rpc）全绿 + `cargo test` **62** 项全绿（其中记忆 9 项）。
- `e2e:ipc` 覆盖到 **54** 个命令（新增 4 个记忆命令，实现位置扫描扩到 `memories.rs`）。
- **顺带修复**：`parity.test.ts`（与 `omp render --plain` 的真实会话对拍）取「最近 3 个会话」时可能抽到刚建好、还没说话的空会话，硬断言「必须有用户文本」会因此失败——与代码无关却挡住 `pnpm check`（用改动前的代码跑基线复现过）。现在改为「最近 20 个会话里挑出切片内确有用户文本的最多 3 个」，断言强度不变。
- 真机实测（本机 omp 18.2.1，`pnpm tauri:dev`）：
  - 五页签渲染与切换（通用 / 供应商 / 模型 / 记忆 / 已归档对话）；
  - 记忆页列出 7 个项目（6 个真实 + 临时联调目录）并按最近修改倒序；`/tmp` 与含连字符的路径都正确解码成真实 cwd，未命中覆盖层项目时显示路径末段；
  - `MEMORY.md` 预览渲染出标题 / 列表 / 代码高亮 / GFM 表格，中文与 emoji 正常；按钮在「查看 / 收起」间正确切换；
  - 4.2MB 假文件显示「文件较大，只显示开头部分（全文 4.2 MB）」；
  - 删除单文件：确认框（焦点默认在「取消」）→ 列表即时刷新（8 → 7 个文件）→ 磁盘上文件消失；
  - 「清空记忆」：确认框 → 整个记忆目录从磁盘消失、界面回到 6 个项目；全程 6 个真实记忆目录**零改动**（联调只用临时造的数据）；
  - 中英切换后页签与页内文案同步（Memory / 6 projects / View / Delete / Clear memory）。

## 4. 后续候选（需用户确认再开工）

- **编辑 / 新增记忆**：本应用要写 `MEMORY.md` 就得自己维护格式与注入口径（omp 有脱敏与长度限制），且与「记忆由 omp 生成」的边界冲突——要做先定边界。
- **触发重新整理**：TUI 的 `/memory enqueue` 只是标记「下次启动整理」；壳侧若要做，等于用 `/` 命令透传进某个会话，语义与时机都需要再验证。
- **打开记忆所在目录**：用系统文件管理器打开 `memories/<编码目录>/`，现有 `opener` 插件可直接用，属于顺手的小功能。
- **按需清理**：例如「删除 30 天前的 rollout 摘要」这类基于时间的批量清理，先看真实使用是否有这个需求。
