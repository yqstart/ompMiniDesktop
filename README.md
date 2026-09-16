# ompMiniDesktop

oh-my-pi（`omp`）的极简桌面端 —— 把终端里的 agent 会话装进一个安静的两栏界面：
选项目 → 开会话 → 提问 → 审批 → 切模型再问。

**许可证：[MIT](LICENSE)** · 纯开源免费

> ompMiniDesktop is a minimal desktop shell for [oh-my-pi](https://github.com/ldx/oh-my-pi)
> (`omp`): projects + sessions over a long-lived `omp --mode rpc` child process,
> with streaming output, inline approvals, and model / thinking-level switching.
> UI in Chinese; English summary below.

---

## 功能概览

- 项目：添加本地目录、移除（仅解绑）、目录缺失标记与重定位
- 会话：新建、打开（`--resume` 恢复）、归档/取消归档（只读横幅）、删除（二次确认，不可恢复）
- 输出渲染：用户气泡 / 流式 Markdown / 思考折叠 / 工具调用卡（四态：输入中·运行中·成功·失败）/ 系统分隔线
- 权限：全局三档（每次询问 `always-ask` / 写入询问 `write` / 自动通过 `yolo`）+ 会话级覆盖；工具执行前内联审批卡（允许一次 / 总是允许本会话 / 拒绝）
- 切换：模型选择器（搜索 + provider 分组 + context/thinking/images 角标）/ 思考档选择器（按模型可用档过滤）
- 供应商（设置 ›「供应商」）：OAuth 供应商登录 / 登出（走 `omp auth-broker`，凭证写进 omp）
- 模型（设置 ›「模型」）：模型角色分配（omp 内置 9 个角色 + 自定义角色 → 模型，写 `modelRoles`）、可用模型目录（只读，按供应商分组）
- 记忆（设置 ›「记忆」）：omp 项目记忆（`<agentDir>/memories/` 下按项目一份）的清单、Markdown 预览与删除（单文件 / 整目录；只删文件，不写 omp）
- 界面语言（跟随系统 / 中 / EN）与皮肤（跟随系统 / 深色 / 浅色）：左栏底部「设置」行右侧的两个分段控件，纯展示层偏好，两处都不重复放；语言跟随系统时按系统语言自动选中英（`zh*` → 中文）
- 设置页：omp 诊断（路径/版本/agentDir + 手动指定路径）、应用更新、供应商、模型、记忆、已归档对话——**除「供应商」与「模型」外一律不写 omp 状态**（路径只写应用覆盖层；记忆页只删文件；语言与皮肤只切本应用展示）

**明确不做（V1）**：自动化/定时任务、插件/Skill/MCP/Hook 管理、主题市场、云同步、多窗口协作、终端 PTY 仿真、diff 合并编辑器、用量统计。

---

## 环境要求

| 工具 | 建议版本 |
|---|---|
| `omp`（oh-my-pi） | 18.x（已验证 18.1.22） |
| Node.js | 22+ |
| pnpm | 11+ |
| Rust | stable（已验证 1.97）+ `cargo-tauri` |
| `git`（可选） | 任意版本；仅用于输入框上方展示当前分支，缺失时那里显示「非 Git 目录」，不影响任何功能 |
| 系统 | 首发 macOS arm64；Windows / Linux 打包延后 |

> GUI 启动的 PATH 常不含 `/opt/homebrew/bin`：app 会先问登录 shell（`command -v omp`），
> 再试已知前缀，仍找不到可在设置页手动指定路径（存 overlay）。

---

## 快速开始

```bash
git clone https://github.com/yqstart/ompMiniDesktop.git
cd ompMiniDesktop
pnpm install
pnpm tauri:dev
```

仅前端开发 / 检查：

```bash
pnpm dev            # 纯前端
pnpm build          # tsc + vite 构建
pnpm check          # 全套：typecheck + lint + test + e2e:ipc + e2e:rpc
pnpm lint           # eslint（flat config）
pnpm e2e:rpc        # fake-omp 驱动的行为级端到端（握手/审批双分支/多工具/中断）
```

仅 Rust 侧检查：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

本机发布构建（仅当前系统）：

```bash
pnpm tauri:build    # 产物见 src-tauri/target/release/bundle/
```

未签名（`signingIdentity: "-"`）：首次打开若被 Gatekeeper 拦截，右键 → 打开，
或 `xattr -dr com.apple.quarantine <App>.app`。

## 应用内更新

- 更新源：GitHub Release 的 `latest.json`（Tauri updater 标准链路，需签名校验）。
- 触发：启动后静默检查一次（有更新只点亮顶栏入口，不打断）；设置页「应用更新」可手动检查。
- 行为：有更新弹「立即更新 / 稍后更新」；下载完成后可「立即重启 / 稍后重启」（稍后则下次启动生效）；稍后过的版本本轮不再弹窗，顶栏入口常驻。
- 发版流程：打 `v*` tag 推送 → GitHub Actions Release 工作流多平台打包并生成 `latest.json`。

> 首次正式发版前必须先配签名，否则 updater 会拒绝安装：
> `pnpm tauri signer generate -w ~/.tauri/omp-mini.key`，把公钥填入
> `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，
> 私钥全文写入仓库 Settings → Secrets → `TAURI_SIGNING_PRIVATE_KEY`
>（生成时没设密码则 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 置空）。
>
> Release 工作流带守卫 job：`pubkey` 里还留着 `TODO` 占位、或 tag 与
> `package.json` 版本号不一致时，发版会直接失败（见 `.github/workflows/release.yml`）。

---

## 架构速览

```
omp 子进程（per 会话长驻，--mode rpc）
  stdout JSONL → Rust 行解析 / rpc_chunk 重组 → omp-event://<sessionId>
                                       └→ 状态机 → omp-status://<sessionId>
前端：事件 → lib/viewmsg.ts + lib/mergeEvents.ts 归一合并 ViewMsg → Zustand eventsBySession → 首屏 200 条增量渲染（Markdown + 代码高亮）
会话真相：~/.omp/agent/sessions/<slug>/*.jsonl（PI_CODING_AGENT_DIR 可覆盖）
app 覆盖层：$APPDATA/omp-mini/overlay.json（项目列表/归档/备注/会话级权限）
```

- 完成信号以 `agent_end(isTerminal !== false)` 为准；`prompt` 的即时 ack 只代表接受。
- 流式中 composer 只允许停止（`abort`），不排队。
- 审批线序：`toolcall_end` → `tool_execution_start` → `extension_ui_request{select}`；
  通过回 `value:"Approve"`，拒绝回 `cancelled:true`（turn 正常结束，不是中断）。
- 切模型发 `set_model{provider, modelId}`（两个字段，非 selector 字符串）；
  切思考档发 `set_thinking_level{level}`。
- 供应商页（唯一改 omp 状态的地方）：登录 / 登出走 `omp auth-broker` 子进程（RPC 模式在「一个供应商都没登录」时起不来），
  输出经 `omp-provider://login` 推全量快照；角色分配走 `omp config get/set modelRoles`（record 只能整表写，读-改-写 + 回读）。
- 记忆页（只列 / 读 / 删，不写 omp）：omp 的项目记忆在 `<agentDir>/memories/` 下按 cwd 编码成目录名（与 sessions 的编码不是一套），
  目录内是 omp 后台整理写出的 Markdown（`MEMORY.md` / 摘要 / `raw_memories.md` / `rollout_summaries/` / `skills/`）；
  壳侧没有写入路径——上游没有 `omp memory` 这类 CLI，写记忆是 omp 自己的事。

详见 [`docs/v1-design.md`](docs/v1-design.md)（产品冻结稿）、
[`docs/rpc-memo.md`](docs/rpc-memo.md)（RPC 实测协议备忘）、
[`design-system/MASTER.md`](design-system/MASTER.md)（设计 token）。

---

## 排障

| 现象 | 修复 |
|---|---|
| 启动横幅「未找到可用的 omp」 | 安装 oh-my-pi，或把 `omp` 放到 PATH/`/opt/homebrew/bin`，或设置页指定路径 |
| 「模型目录加载失败」 | 点模型选择器刷新按钮；检查网络 |
| 项目「目录缺失」 | 重定位到新路径，或移除项目（会话历史仍可回放） |
| 会话「已损坏，可删除」 | jsonl 头部解析失败，不阻塞列表，直接删除 |
| 协议漂移（omp 大版本升级后事件对不上） | app 记录 `omp --version`；未知事件只告警不崩，先降级用历史回放 |

---

## English summary

Minimal Tauri v2 + React desktop shell for `omp`: manage projects/sessions,
stream agent output (text / thinking / tool cards), approve tool calls inline,
and switch models / thinking levels mid-session. Sessions stay in
`~/.omp/agent/sessions/`; the app only keeps a light overlay
(projects, archive flags, notes, per-session approval).
Settings page is a placeholder (read-only). See docs above for protocol details.
Contributions welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first,
and report vulnerabilities privately per [SECURITY.md](SECURITY.md).

---

## 相关项目

- [oh-my-pi](https://github.com/ldx/oh-my-pi) —— 本 app 驱动的上游 agent CLI
- [PrismCode](https://github.com/yqstart/PrismCode) —— 轻量桌面代码编辑器（同作者，Tauri；明确不做 AI 面板，与本项目互补）
