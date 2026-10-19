# 排期 6：设置 ›「omp 约束」

> 状态：**已实施**（2026-10-19）。锚点 = 用户口径「在设置中添加一个模块『omp 约束』，可视化编辑 omp 的全局约束文件、规则文件」。
> 性质：设置视图新增第八个条目 + 一条新的文件读写链路（全局 `AGENTS.md` / `RULES.md` / `rules/*.md`）；聊天运行时、消息流、左栏 / 右栏、其它设置条目都不动。
> 前置阅读：`../AGENTS.md`（工程导航）、`roadmap.md`、`design-system/MASTER.md` §4.6。

## 1. 范围

### 1.1 新增

| 模块 | 说明 |
|---|---|
| `src-tauri/src/constraints.rs` | 全局约束 / 规则文件的清单、读、写、新建、删除；路径白名单 / 大小上限 / frontmatter 结构校验 / 乐观锁 / 备份 / 原子写 |
| 命令 | `get_omp_constraints` / `write_omp_constraint` / `create_omp_rule` / `delete_omp_rule`（注册在 `main.rs`） |
| `src/lib/constraints.ts` | frontmatter 拆分与表单字段解析 / 写回（`yaml` 的 `Document` API）、规则类型摘要、名称与内容校验、搜索用描述 |
| `src/components/settings/ConstraintsPanel.tsx` | 文件列表 + 编辑器：表单（描述 / 启用 / 总是生效 / 触发条件 / 作用范围 / 注入方式）、Markdown 正文、预览、源码模式、新建 / 删除、保存 / 重新加载 / 冲突处理 |
| 导航与搜索 | `SettingsTab` 加 `constraints`；通用组 = 常用设置 + omp 约束；`settingsSearch` 加约束数据源与文件命中；`focusRequest` 选中文件 |

### 1.2 上游事实（omp 18.11.1）

- 全局上下文文件 = `<agentDir>/AGENTS.md`（native provider 的用户级文件，会话启动时注入 `<repo-rules>`）；
- sticky 规则 = `<agentDir>/RULES.md`（始终 always-apply、每轮重挂，frontmatter 不能把它改成按需规则）；
- 独立规则 = `<agentDir>/rules/*.{md,mdc}`，文件名即规则名；`enabled: false` 在发现阶段就被排除；
- 规则 frontmatter：`description` / `globs` / `alwaysApply` / `condition` / `astCondition` / `question` / `scope` / `agents` / `interruptMode` / `enabled`；
- 项目级 `.omp/AGENTS.md` / `.omp/RULES.md` / `.omp/rules/*` 只从最近的 non-empty `.omp/` 目录读取；本页不碰；
- `omp ttsr list --json` **只列有 TTSR 条件**（condition / astCondition / question）的规则，规则手册规则根本不出现——不能拿它当保存门槛；
- omp 在会话启动 / `/clear` / `/new` 时重新发现文件；已打开会话是否热读未实测。

## 2. 口径（不许违背）

1. **只写全局层三处**：`<agentDir>/AGENTS.md`、`<agentDir>/RULES.md`、`<agentDir>/rules/` 下单层规则文件。项目级 `.omp/` 由 omp 自己发现，本页不碰。
2. **文件名白名单**：`AGENTS.md` / `RULES.md` 固定；规则文件只允许 `.md` / `.mdc` 结尾、不以 `.` 开头、不含路径分隔符 / 控制字符 / Windows 非法字符（`: * ? " < > |`）、长度 ≤ 96。规则名就是文件名（去扩展名）。
3. **保存流程**：`expectHash` 乐观锁 → 备份到 `<appData>/omp-mini/backups/constraints/`（按文件名保留最近 10 份）→ 同目录临时文件 + rename 原子写 → 回读比对。内容没变不写、不备份。
4. **乐观锁语义**：`expectHash = ""` 表示「打开时文件不存在」——外部创建了也算冲突；`null` = 冲突对话框里的显式「强制覆盖」。冲突不静默覆盖，界面给「重新加载 / 强制覆盖」两条路。
5. **保真**：规则表单以打开时的 frontmatter 文档为底，只改用户编辑的字段；**值没变的字段不重写**（尽量保住注释与写法），不认识的顶层字段原样保留。需要完全控制文件时切「源码」模式。
6. **校验**：文件 ≤ 2 MiB、拒绝 NUL、规则 frontmatter 必须有结束行且 YAML 可解析；前端保存前校验（不合法不发请求），后端再校验结构（防绕过）。
7. **删除**：只对独立规则；`ConfirmDialog` 二次确认；先备份再删，备份失败拒绝删除。
8. **生效文案**：只说「新建的会话一定读到」；不宣称已打开会话会热读。
9. **搜索**：`constraints` 是独立数据源（条目名 / 文件名 / 路径 / 规则描述）；命中跳转带 `focusKey = kind:name`，约束页据此选中文件。
10. **草稿**：模块级缓存，切设置页签 / 关设置视图再回来不丢未保存内容；「重新加载」才显式丢弃。

## 3. 验收清单

1. `pnpm check`（typecheck / lint / test / e2e:ipc）与 `cargo test --manifest-path src-tauri/Cargo.toml` 全过。
2. 前端单测覆盖：frontmatter 拆分 / 字段解析 / 表单写回（未知字段与注释保留）/ 空文档 / 名称与内容校验；设置页导航与搜索源。
3. Rust 单测覆盖：文件名白名单、frontmatter 结构校验、乐观锁、列表过滤、写入备份与回读、新建 / 删除规则。
4. 功能冒烟（桌面壳）：
   - 设置 ›「omp 约束」：三组文件都在；`AGENTS.md` / `RULES.md` 显示真实路径，规则目录为空时给空态；
   - 编辑 `AGENTS.md` → 保存 → 重新打开设置页内容还在；
   - 新建规则 `no-any` → 填描述 / 正文 / condition → 保存 → `omp ttsr list --json` 里出现 `no-any`；
   - 表单切「源码」再切回，字段不丢；未知 frontmatter 字段保存后仍在；
   - 外部手改文件后保存：出现冲突提示，可重新加载或强制覆盖；
   - 删除规则：ConfirmDialog 确认 → 文件消失，备份目录留一份；
   - 设置搜索「omp 约束」/ 规则名 → 跳转并选中对应文件；
   - 深浅两套皮肤、窄窗（文件列表与编辑器上下堆叠）下不破版。

## 4. 不做

- **项目级规则编辑器**：项目 `.omp/` 由 omp 自己发现；要改去项目目录（本页只做全局层）。
- **子代理定义**（`<agentDir>/agents/*.md`）：不属于「约束 / 规则」，不在本页。
- **内置规则编辑**：内置规则在 omp 二进制里，只读不可改。
- **备份恢复界面**：备份是写入兜底，不提供界面回滚（需要时去应用数据目录取文件或手改）。
- **更细的规则排序**：规则顺序由 omp 发现规则决定，本页不做排序。
