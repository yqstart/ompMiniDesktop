# Windows 支持（P0 / P1）

> 目标：让 Windows 从“能装能启动”走到“原生可用”，并把 WSL 的边界说清楚。
> 实施日期：2026-10-19。口径与 DSH（DeepSeek Harness）的 Windows 取舍对齐：
> **Windows 原生优先，WSL 只做终端桥接，不跨发行版驱动 omp**。

## 结论

| 场景 | 状态 | 说明 |
|---|---|---|
| Windows 原生（无 WSL） | **可用** | 壳、会话、终端、文件树、引用、git、更新都走 Windows 原生实现 |
| 项目在 WSL（`\\wsl$\...`） | **部分支持** | 右栏终端直接进入该发行版；文件树 / 引用可读；**聊天会话明确拒绝**（不半跑） |
| omp 只装在 WSL 里 | **明确提示** | Windows 侧识别不到 WSL 里的 omp；安装弹窗提示两套 omp 不共享会话 |

“明确拒绝”不是功能缺失的借口：Windows 壳启动的 `omp.exe` 看不到 WSL 的 Linux
工具链、路径与 `~/.omp`，硬跑只会得到 UNC 工作目录 + 两套环境（难排查）。要聊天，
就在 WSL 内运行 omp / DSH；或者把项目放到 Windows 盘。

## 一、平台分叉总表

| 能力 | Windows | macOS / Linux |
|---|---|---|
| 终端默认 shell | `pwsh.exe`（Program Files\PowerShell\7 → PATH）→ `powershell.exe` → `cmd.exe` | `$SHELL` → `/bin/zsh` |
| 终端启动参数 | PowerShell `-NoLogo`；cmd 无参数 | `-l`（登录 shell） |
| 登录 shell PATH 探测 | **不做**（Explorer 已继承注册表环境；Git Bash 的 MSYS PATH 反而有害） | `$SHELL -ilc 'printf %s "$PATH"'` |
| 进程树强杀 | `taskkill /PID <pid> /T /F`（隐藏控制台） | `kill(-pid, SIGKILL)` |
| omp 定位 | `where omp` → PATH 扫 `omp.exe/.cmd/.bat` → `%USERPROFILE%\.bun\bin\omp.exe` → `%LOCALAPPDATA%\omp\omp.exe` | 覆盖层 / 缓存 → `$SHELL -ilc 'command -v omp'` → Homebrew / `/usr/local` / `~/.local/bin` / `~/.bun/bin` |
| omp 安装 | 官方 `install.ps1`（PowerShell，共用 UpdateSlot） | 官方 `install.sh` |
| git 定位 | 先探 `git`（PATH）→ `%ProgramFiles%\Git\cmd\git.exe` | PATH → 登录 shell → `/usr/bin` / Homebrew |
| 会话目录回退 | `USERPROFILE` → `HOME` → 系统临时目录 | `HOME` → 系统临时目录 |
| 窗口 | **保留系统标题栏**；自绘顶栏不再留 macOS 红绿灯的 72px | `titleBarStyle: Overlay` + 红绿灯留白 |
| 打开文件 / 显示 | `tauri-plugin-opener`（Explorer 关联 / `/select`） | `open` / Finder |

## 二、无 WSL（Windows 原生）

### 启动 → 聊天

1. `get_health` → `discover_omp_path`：`where omp` / PATH / 官方落点；找不到时左栏显示“安装 omp”。
2. 新建会话：`omp.exe --mode rpc-ui --cwd <项目>`，stdin/stdout 走 JSON 行 RPC（不经过 shell）。
3. 终端：`terminal_spawn` 按上表选 shell；`cwd` 是项目目录，PowerShell 用 `-NoLogo`。
4. 文件树 / `@` 引用：`list_dir` / `search_paths` 返回绝对路径与 `/` 分隔的相对路径；
   `rel_to` / `suffix` 已把 `\` 归一成 `/`，短标签逻辑与 macOS 同口径。
5. 提交 / 推送：`git` 子进程；Windows 有 Git 即可。
6. 应用更新：Tauri updater + NSIS passive（`tauri.conf.json` 已配置）。

### 已知边界

- 进程树用 `taskkill /T /F`：被外部工具 `setsid` 逃逸的孙进程可能漏杀（Windows 没有
  Unix 进程组；要更强保证需要 Job Object，见 `docs/windows.md` 后续项）。
- 终端 shell 由后端默认选择；前端 `TerminalSpawnOpts.shell` 可显式指定（暂未在 UI 暴露）。
- 窗口保留系统标题栏：应用内顶栏仍在，但不再为红绿灯留白；没有自绘最小化/关闭按钮。

## 三、有 WSL

### 识别

`src-tauri/src/wsl.rs` 与 `src/lib/wsl.ts` 都识别：

- `\\wsl$\<distro>\...`
- `\\wsl.localhost\<distro>\...`
- 正斜杠写法 `//wsl$/...`

### 终端

`terminal_spawn` 的 `cwd` 命中 WSL UNC 时，默认 shell 换成：

```text
wsl.exe -d <distro> -- bash -lc "cd -- '<linux 路径>' && export TERM=xterm-256color COLORTERM=truecolor && exec bash -l"
```

- 用 `bash -lc` 而不是 `wsl.exe --cd`：兼容所有 WSL 版本，并加载登录 shell 的 PATH
  （omp 装在 `~/.local/bin` / `~/.bun/bin` 时也能找到）。
- 单引号转义在 `wsl::shell_quote`，Linux 路径含空格 / 单引号也不会截断。
- 文件树 / `@` 引用直接读 `\\wsl$\...`（UNC），不需要路径转换。

### 聊天会话：明确拒绝

`create_session` 与 `spawn_session_runtime` 对 WSL UNC 项目返回 `WSL_PROJECT`：

> 项目在 WSL（<distro>）里：Windows 壳不会跨发行版启动 omp。请在 WSL 内运行 omp（或 DSH）
> 聊天，或把项目放到 Windows 盘；右栏终端可直接进入该发行版。

配套 UI：

- 输入卡顶行的项目选择器在项目路径是 WSL 时显示 `WSL` 徽标，悬停给完整说明；
- 「安装 omp」弹窗在 Windows 上多一行提示：这里装的是 Windows 原生版，与 WSL 里的
  omp 不共享会话文件。

### 为什么不做 WSL 会话后端

omp 的会话文件（jsonl）、上下文、用量、标题都落在**运行它的那个环境**的 `~/.omp/agent`。
Windows 壳的列表 / 历史 / 统计全部以 `state.agent_dir` 为唯一真相；把会话启动到 WSL 里
而不合并 WSL 的 agentDir，会出现“新建的会话刷新后从列表消失”。合并多 agentDir 是另一套
数据面改造（列表 / 历史 / live_stats / usage / 归档 / 删除都要按环境分组），不在本次 P1
范围内。当前选择是**不半跑**：终端能用，聊天请回 WSL 内。

## 四、与 DSH 的对照

| 维度 | ompMiniDesktop（本次） | DeepSeek Harness |
|---|---|---|
| Windows shell | pwsh → powershell → cmd | 默认 `pwsh-sandbox`（Windows）/ `bash-sandbox`（POSIX） |
| PowerShell 解析 | Program Files → PATH → System32 | 配置 → `C:\Program Files\PowerShell\7` → PATH → Windows PowerShell 5.1 |
| 沙箱 | 无（沿用 omp 自己的审批档） | Windows ACL 受限令牌，fail-closed |
| 进程树 | `taskkill /T /F` | Job Object（kill-on-close）+ Win32 进程表 |
| 打开文件 | `tauri-plugin-opener` | `explorer.exe`（编码 file URI，exit 1 视为转交） |
| WSL | 终端桥接 + 聊天明确拒绝 | 只在“打开路径”用 `wslpath -w`；不做 WSL 执行后端 |
| 窗口 | 保留系统标题栏 | `titleBarStyle: hidden` + `titleBarOverlay` + acrylic |

## 五、验证

已在本机（macOS）执行（**以下数字是 2026-10-19 当日快照**，只作当时基线）：

```bash
cargo test --manifest-path src-tauri/Cargo.toml   # 293 passed（含 WSL / Windows 路径单测）
pnpm typecheck
pnpm lint
pnpm test                                          # 856+ passed（含 paths / wsl 单测）
```

Windows 目标交叉检查：

```bash
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

本机（macOS）会在依赖 `ring` 的 C 源码处停下（缺 MSVC SDK 的 `assert.h`），**不是业务代码
错误**；Windows 分支的编译由 CI 的 Windows runner 负责。

**未在 Windows 实机验证**：GUI 启动、PowerShell 终端、`taskkill` 进程树、WSL 终端需要
在真实 Windows 上冒烟。CI 的 `release.yml` 有 `Windows x64` 打包矩阵，发版前应至少跑一次
安装包冒烟（安装 → 识别 omp → 新建会话 → 开终端 → 提交）。

## 六、后续项

- Windows Job Object 进程树（比 `taskkill` 更严的“关壳即清”保证）。
- WSL 会话列表合并（多 agentDir 数据面）。
- 终端 shell 选择器（把 `TerminalSpawnOpts.shell` 暴露到 UI）。
- Windows 实机冒烟与截图归档。
