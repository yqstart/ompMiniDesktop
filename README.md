# ompMiniDesktop

oh-my-pi（`omp`）的极简桌面端 —— 左侧项目 / 分支树，右侧 omp 终端标签页：
选工作区或目录 → 开终端 → 在 omp 的 TUI 里干活，**每个终端就是一个会话**。

**许可证：[MIT](LICENSE)** · 纯开源免费

> ompMiniDesktop is a minimal desktop shell for [oh-my-pi](https://github.com/ldx/oh-my-pi)
> (`omp`): a left sidebar of projects and git worktrees, and a right pane of omp terminals —
> each one an interactive omp TUI session running in a real PTY. Sessions stay in
> `~/.omp/agent/sessions/`; the app only keeps a light overlay (projects, archive flags, notes).
> UI switchable between Chinese and English.

---

## 功能概览

- **工作区（多项目容器）**：把一个或多个项目组成「工作区」（左栏标题行的 `Layers` 按钮新建；组头 `PenLine` 编辑名字与成员、删除组——成员回归「未分组」，不删项目与文件）。工作区成员 ≥ 2 时，在其中任何目录开的终端会**自动把其余成员项目的主目录挂进这个 omp 会话**（可跨项目读写，各项目自己的 AGENTS.md 规则同样生效），并注入一段工作区拓扑说明——给一个需求，前端与后端可以同时改、各自验证。组头点击 = 切到该工作区的终端视图；组头 `＋` 在组内首个项目的主目录开终端。
- **项目 / 目录**：添加本地目录、移除（项目行 hover 的「移除项目」——仅解绑 + 该项目会话标记归档，走二次确认）、目录缺失标记与重定位；每个项目下列出主目录与全部 git worktree（分支名 + `worktree` 徽章，**只读展示**：要新建 / 删除 worktree 走 `omp worktree add` / `git worktree remove` 命令行）；项目头的文件夹图标会为「当前打开的项目」上强调色。没有自定义工作区时项目在左栏平铺（单项目用户无感）。
- **终端**：每个标签页 = 一个跑在 PTY 里的 `omp` 交互式会话；多标签、`⌘T` 新建 / `⌘W` 关闭 / `⌘1..9` 切换；关闭运行中的终端二次确认（防误杀进行中的 agent）；进程退出后显示退出码并可重启；omp 的会话名经 OSC 标题更新到标签页。右栏按左栏选中范围过滤——工作区视图列出组内全部目录的终端、目录视图只列该目录的终端（别的范围的照常跑，左栏目录行上的徽章显示数量，`⌘⇧K` 可全局跳过去；快速切换面板三分组：终端 / 工作区 / 工作区目录）。标签栏右上角常驻两枚键：`＋`（新建终端）与 `Gauge`（供应商用量，见下）。
- **会话弹窗**：项目行的「会话」入口列出该项目（含全部 worktree）的会话——点击在新终端 `omp --resume` 接着聊；行内归档 / 恢复 / 删除（删除二次确认）。
- **已归档对话**（设置 ›）：归档会话的统一管理面（不受列表扫描窗口限制，按项目分组），「打开」= 恢复并在终端里继续；删除真删 jsonl。
- **供应商用量**（标签栏右上角的 `Gauge` 键）：各供应商侧的滚动窗口——5 小时 / 每周 / 每月限额的进度、重置倒计时与停用凭据提示；数据来自 omp 自己的 `omp usage` 查询，omp 未覆盖的 commandcode / deepseek 由壳侧补充查询——commandcode 额度接口与 deepseek 官方余额接口，凭据只经 `omp token` 在内存中传递、只读。本应用只读取，不直连供应商接口、不碰凭证；只读弹窗，不占设置页签。
- **设置页（七个页签，左栏分 omp / 本应用两组）**：**omp 组**——**常用设置**（omp 配置在本应用的唯一设置面：519 项里的 117 项展示清单——含主题与外观、上下文与压缩、模型与重试、工具开关、LSP、记忆、任务并发等，按上游分组；完整清单在终端 `omp config list` 看）、**模型**（omp 模型相关的唯一管理面：我的模型 → 供应商 → 模型角色 → 失败转移；「添加供应商」弹窗先选提供商（可搜索、已配置置顶）——登录型走 `omp auth-broker`（API key / OAuth），首项「自定义」写 `models.yml`；「挑选模型」弹窗带搜索过滤，星标进「我的模型」）、**插件**（omp 插件的清单 / 启停 / 可选特性 / 安装 / 卸载 / 体检）、**技能**（技能发现 / `SKILL.md` 预览 / 逐项启停）、记忆（omp 项目记忆的查看与删除）；**本应用组**——使用统计（本机会话 jsonl 的 tokens / 缓存命中率 / 活跃天数与「Token 活动」热力图）、已归档对话（归档的统一管理面）。**应用更新**在左栏字标行的应用版本 chip 上；**omp 的运行环境诊断**（路径 / 版本 / agentDir、重新检测、手动指定可执行文件）在字标行 omp 版本 chip 的弹窗里（原「关于」页已随这两处搬迁退场）。
- **界面语言**（跟随系统 / 简体中文 / English）与**皮肤**（跟随系统 / 深色 / 浅色）：左栏底部「设置」行右侧的两个分段控件，纯展示层偏好；终端配色跟随皮肤。

**明确不做**：编辑器 / 文件树 / diff 审查 / 内置浏览器 / SSH / 移动端 / PR 集成 / 终端滚动缓冲持久化 / 分屏 / 多窗口。

---

## 环境要求

| 工具 | 建议版本 |
|---|---|
| `omp`（oh-my-pi） | 18.x（已验证 18.2.2） |
| Node.js | 22+ |
| pnpm | 11+ |
| Rust | stable（已验证 1.97）+ 本地 `@tauri-apps/cli`（`pnpm tauri:*`） |
| `git`（可选） | 任意版本；工作区树与分支展示用到，缺失时只显示项目主目录，不影响开终端 |
| 系统 | macOS arm64 为已验证平台；发布工作流同时构建 macOS x64 / Linux x64 / Windows x64 产物 |

> GUI 启动的 PATH 常不含 `/opt/homebrew/bin`：app 会先问登录 shell（`command -v omp`），
> 再试已知前缀，仍找不到可在设置页手动指定路径（存 overlay）。**终端进程也会用登录
> shell 的 PATH**——从 Dock 启动的 app 里开的终端，`git` / `node` 一样找得到。

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
pnpm check          # 全套：typecheck + lint + test + e2e:ipc
pnpm lint           # eslint（flat config）
```

仅 Rust 侧检查：

```bash
cargo test --manifest-path src-tauri/Cargo.toml                 # 单测（含真实 PTY 回环）
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored    # 慢测试：真实 omp TUI 冒烟等
```

本机发布构建（仅当前系统）：

```bash
pnpm tauri:build    # 产物见 src-tauri/target/release/bundle/
```

产物用**固定身份的签名证书**签名（CN `ompMiniDesktop Signing`，自签名、10 年有效）。
一次性设置（macOS）：

```bash
bash scripts/make-signing-cert.sh   # 生成证书 → 装入登录钥匙串 → 导出 CI 用的 p12（系统会弹密码框，按提示操作）
```

之后 `pnpm tauri:build` 自动用它签名（`scripts/tauri-build.mjs` 检测到证书就注入签名身份；没装证书的机器照常按 ad-hoc 构建，不受影响）。
这样做的原因：macOS 的 TCC 授权（桌面 / 文稿 / 下载文件夹）按签名身份记——ad-hoc 签名
每次构建身份都变，系统会当成新 app 反复弹授权；固定证书后授权跨构建与应用内更新保留。

未公证：首次打开若被 Gatekeeper 拦截，右键 → 打开，
或 `xattr -dr com.apple.quarantine <App>.app`。

> 说明：本地构建末尾可能出现「A public key has been found, but no private key」之类报错——那是
> **updater 产物（`*.tar.gz.sig`）的签名**在找发版私钥（`~/.tauri/omp-mini.key`，带密码，密码在
> CI secrets 里）；`.app` 与 `.dmg` 此时**已生成并签名完毕**，本地不需要那一步（发版由 CI 完成）。

## 应用内更新

- 更新源：GitHub Release 的 `latest.json`（Tauri updater 标准链路，需签名校验）。
- 触发：启动后静默检查一次（有更新在左栏字标行的应用版本 chip 上显示新版本号 + accent 圆点，不打断）；点这枚 chip（左栏字标行右端，omp 版本 chip 旁边）开弹窗，手动「检查更新」也在弹窗里。
- 行为：有更新弹「立即更新 / 稍后更新」，弹窗里按 Markdown 列出这个版本的更新内容（取自 `CHANGELOG.md` 的版本节，见下）；下载完成后可「立即重启 / 稍后重启」（稍后则下次启动生效）；稍后过的版本本轮不再弹窗，之后点字标行的应用版本 chip 就能重新打开弹窗（chip 上的新版号与圆点常驻）。
- 发版流程：打 `v*` tag 推送 → GitHub Actions Release 工作流多平台打包并生成 `latest.json`。
- **更新说明来自 CHANGELOG 的版本节**：`scripts/changelog-notes.mjs` 抽出当前版本那一节，工作流用它当 Release 说明，末尾的 fixup job 再用它回填 `latest.json` 的 `notes`（应用内更新弹窗显示的就是它）。版本节没写或为空会让发版失败；存量 release 也可用 `node scripts/fixup-latest-json.mjs <latest.json> vX.Y.Z` 回填。
- **`latest.json` 里的资产链接必须是公开直链**：tauri-action v1 默认写 `api.github.com/.../releases/assets/<id>` 形式的资产 API 链接，而 REST API 域对匿名请求限流 60 次/小时/**出口 IP**——应用内下载走系统代理（reqwest 默认启用 `system-proxy`），共享节点 IP 上配额耗尽就会报 `Download request failed with status: 403 Forbidden`；检查更新走 `github.com` 网页域不受限，所以表现为「能检查、不能下载」。发布工作流的 `fixup` job 会用 `scripts/fixup-latest-json.mjs` 统一改写为 `releases/download` 直链（幂等，也已用于修补存量 release）。
- **仓库必须保持 public**：updater 以匿名请求拉 `releases/latest/download/latest.json`，私有仓库会被 GitHub 以 404 拒绝（应用内报 `Could not fetch a valid release JSON from the remote`）——Release 工作流的守卫 job 会挡住私有状态下的发版。

> 首次正式发版前必须先配签名，否则 updater 会拒绝安装：
> `pnpm tauri signer generate -w ~/.tauri/omp-mini.key`，把公钥填入
> `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，
> 私钥全文写入仓库 Settings → Secrets → `TAURI_SIGNING_PRIVATE_KEY`
>（生成时没设密码则 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 置空）。
>
> **macOS 签名证书（TCC 授权持久化）**：本机跑一次 `bash scripts/make-signing-cert.sh`，
> 按脚本末尾提示把 `signing.p12.b64` 与 `p12.pass` 设为 Secrets
> `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`——macOS 矩阵用它签名
>（tauri CLI 自动导入临时钥匙串 + `APPLE_SIGNING_IDENTITY` 指定身份），其它平台忽略。
>
> Release 工作流带守卫 job：仓库不是 public、`pubkey` 里还留着 `TODO` 占位、
> tag 与 `package.json` 版本号不一致、或 `APPLE_CERTIFICATE` 缺失时，发版会直接失败
>（见 `.github/workflows/release.yml`）。

---

## 架构速览

```
左栏：list_workspaces（工作区容器：名字 + 成员项目）+ list_checkouts（项目 × `git worktree list --porcelain`，只读；创建 / 删除走命令行）
右侧：xterm.js ← Tauri Channel ← PTY 读线程（增量 UTF-8 解码）← `omp --cwd <dir>`（交互式 TUI）
      键盘 pty_write / 尺寸 pty_resize / 关闭 pty_kill →
会话：~/.omp/agent/sessions/<slug>/*.jsonl（TUI 自己写；壳侧弹窗读同一份真相）
覆盖层：$APPDATA/omp-mini/overlay.json（项目列表 / 归档标记 / 备注 / ompPath）
```

- 终端是**真 PTY**（Rust `portable-pty`）：壳侧不解析协议、不翻译输出，字节流原样进 xterm；
  审批、切模型、压缩、`/` 命令全部在 omp 自己的 TUI 里完成。
- 目录行 = 项目主目录 + 全部 git worktree（分支名展示）；worktree 里产生的会话、用量与
  记忆按项目归属（壳侧用 `git worktree list` 把两者的路径关联起来）。工作区（V21）= 一组
  项目的协作容器（覆盖层 `workspaces` + 项目上的 `workspaceId`，一个项目最多属于一个
  工作区）；协作靠给 omp 会话追加 `--add-dir`（其余成员主目录）与一段工作区说明实现。
- 会话「继续」= 新终端 `omp --resume <id>`；会话列表来自 `list_sessions`（jsonl 扫描，
  有扫描窗口；归档管理面不受窗口限制）。
- 供应商 / 设置 / 用量这类 omp 状态，壳侧一律走 omp 自己的 CLI（`omp auth-broker`、
  `omp config`、`omp usage`），不直读凭证库、不写配置文件。

详见 [`docs/v11-schedule.md`](docs/v11-schedule.md)（现行冻结设计）、
[`docs/v1-design.md`](docs/v1-design.md) 与 [`docs/rpc-memo.md`](docs/rpc-memo.md)（V1–V10 历史存档）、
[`design-system/MASTER.md`](design-system/MASTER.md)（设计 token）。

---

## 排障

| 现象 | 修复 |
|---|---|
| 启动横幅「未找到可用的 omp」 | 安装 oh-my-pi，或把 `omp` 放到 PATH/`/opt/homebrew/bin`，或设置页指定路径 |
| 终端里 `command not found` / 找不到 node | 终端进程的 PATH 取登录 shell 的探测结果；确认登录 shell 里能跑（`zsh -ilc 'command -v node'`） |
| 项目「目录缺失」 | 重定位到新路径，或移除项目（会话归档保留） |
| 会话「已损坏」 | jsonl 头部解析失败，不阻塞列表，可在弹窗或归档页删除 |
| 打开的终端没有响应 | 终端进程退出后浮层会给「重启」；或点 `×` 关闭后重开（运行中关闭会先确认） |
| 反复弹「“ompMiniDesktop”想访问“桌面”（/文稿/下载）文件夹」，明明已授过权 | macOS 按「签名身份」记授权。**已修**：产物改用固定身份的自签名证书（CN `ompMiniDesktop Signing`，`bash scripts/make-signing-cert.sh` 一次性生成并装入登录钥匙串——ad-hoc 签名的身份是每次构建都变的 cdhash，才会反复弹）。从 ad-hoc 切过来后**第一次**仍会弹一次（旧记录匹配不上），之后跨更新不再弹。`tauri:dev` 的开发二进制仍是每次重编的临时身份——嫌弹就把项目放 `~/Projects` 等非保护目录，或固定用打包产物。授权状态错乱时可 `tccutil reset SystemPolicyDesktopFolder com.omnidesktop.mini` 后重授 |

---

## English summary

Minimal Tauri v2 + React desktop shell for `omp`: a left sidebar of projects and git
worktrees, and a right pane of omp terminals — each tab is an interactive `omp` TUI
session running in a real PTY, so approvals, model switching and slash commands happen
where they always did: inside omp. A per-project session popup lists chats (click to
resume in a new terminal via `omp --resume`; archive / restore / delete inline), a tab-bar
provider-usage popup (per-provider rolling windows), and Settings ships eight tabs —
General (41 curated omp settings), Models (providers / models / roles + fallback chains),
Plugins, Skills, Memories, About, Usage stats, Archived chats. Only the General / Models /
Plugins / Skills tabs write omp state (global `config.yml`, credentials, `modelRoles`,
plugin & skill toggles); everything else is read-only, and the provider-usage popup only
reads `omp usage`.
Contributions welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first,
and report vulnerabilities privately per [SECURITY.md](SECURITY.md).

---

## 相关项目

- [oh-my-pi](https://github.com/ldx/oh-my-pi) —— 本 app 驱动的上游 agent CLI
- [PrismCode](https://github.com/yqstart/PrismCode) —— 轻量桌面代码编辑器（同作者，Tauri；明确不做 AI 面板，与本项目互补）
