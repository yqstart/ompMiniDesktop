# V33 输入框的「输入提示」全关：omp 编辑器拼写辅助 + 系统输入辅助

> 目标：用户实测「输入英文字母总是提示我大写、横杠」——app 内所有输入框不要再弹任何输入提示。
> 两层来源都要关：**壳内终端里 omp 编辑器的拼写辅助**（omp 18.8 新增，macOS 词典 ghost 补全 /
> 拼错词标记 / 自动纠正）与**壳自身输入框的系统输入辅助**（WKWebView 的拼写建议 / 自动大写 /
> 智能标点 / 自动填充）。定稿 2026-10-09。

## 1. 上游事实（omp 18.8.6 本机实测 + 上游源码 / `docs/settings.md` 核对）

- omp 18.8+ 在 macOS 上默认开着一套**编辑器拼写辅助**（`packages/tui/src/prompt/`）：

| 键 | 默认 | 效果（上游原文） |
|---|---|---|
| `spelling.autocomplete` | `auto` | 「Show predicted word completions as inline hints」——打字途中在光标后画 ghost 补全；`auto` 档 = macOS 词典（上游提交：「Redefined `auto` completion mode to use Apple's native dictionary on macOS」）；档位 off / ngram / smollm / apple / auto |
| `spelling.typoDetection` | `true` | 「Mark misspelled prompt words with the active macOS dictionaries」——拼错词打波浪线 |
| `spelling.autocorrect` | `false` | 「Apply confident macOS spelling corrections after completed words」——自动纠正 |

- 「行内补全」与「typo / autocorrect」是两条实现：`macos-spelling.ts` 只管后两者，
  行内补全走 cross-platform `WordCompletionProvider`（该文件头注释原文：
  "Word completion is the cross-platform `WordCompletionProvider` (`word-completion.ts`)"）。
- ghost 补全本机实测（词内、未打空格时读屏）：`iph` → `iphoto`、`hel` → `help`、`teh` → `tehran`、
  `i` → `in`——**候选里常是大写 / 连字符变体**，正是用户看到的「提示我大写、横杠」。
- `--config <file>` **覆盖层**是上游一等公民（`docs/settings.md`）：优先级
  内置默认 ← 全局 ← 项目 ← **CLI 覆盖层** ← 运行时覆盖 ← 设置环境变量；「for that one process」、
  「Never persisted」；`PI_CONFIG_FILES` 是其环境变量形态（平台分隔符路径列表）。
- **覆盖层文件缺失 / 非法 YAML / 顶层非映射 = 硬错误**（"it does not silently fall back"）——
  注入前必须先确认文件写成功。
- **未知键 / 非法值被容忍**（实测：塞不存在的键、枚举给非法值都能正常启动）；**未知 flag 也被忽略**
  （实测 `omp --definitely-bogus-xyz --version` → 正常输出 `18.8.6`）。老版本 omp 不认识
  `spelling.*` / `--config` 时按上游宽容处理——无需版本探测（注入面与 V21 已用的
  `--add-dir` / `--append-system-prompt` 完全一致）。

## 2. 决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 终端侧关闭机制 | **per-spawn `--config` 覆盖层**，不写全局 `config.yml` | 与 `--add-dir` 同一条口径（V21）：只影响壳内终端，用户在别处自己跑的 omp 行为不变；「常用设置」里的 `spelling.*` 仍显示全局配置真相。 |
| 覆盖层落点 | `<appData>/omp-mini/omp-spawn-overlay.yml`（`overlay.json` 同级） | 应用数据目录是壳的地盘；内容写进文件自愈（与目标内容不一致就重写）。 |
| 写不出来怎么办 | 不注入 `--config`，终端照常起 | 上游对覆盖层缺失是**硬错误**——宁可终端退回 omp 默认行为，也不能起不来。 |
| 三个键都显式关 | `autocomplete: off` / `typoDetection: false` / `autocorrect: false` | 防上游再改默认值回潮（这次就是 upstream 新默认值带来的）；`autocorrect` 虽然当前默认 false 也写明。 |
| 壳输入框 | **全局装饰**（`lib/inputAssist.ts` + `main.tsx` 启动挂载），并删除散装属性 | 组件太多、xterm 的隐藏 textarea 不是 React 管的；已有 5 处散装 `spellCheck={false}` / `autoComplete="off"` 是这套口径出现前的历史做法，一并删除（单一约定）。 |
| `aria-autocomplete` | 不碰 | 无障碍属性（读屏提示），与系统输入辅助无关。 |
| `emojiAutocomplete`（默认 true） | 不动 | `:name:` 短代码触发，与「输入英文字母」无关；要关在常用设置里 `omp config set emojiAutocomplete false`。 |
| ctrl+. 的「拼写替换」弹窗（`tui.editor.spellingSuggestions`） | 保留 | 显式按键动作，不是打字时的自动提示。 |

## 3. 实现

- **`src-tauri/src/pty.rs`**：`SPAWN_OVERLAY_YAML`（内容带注释的 YAML，三个键全关）、
  `SPAWN_OVERLAY_FILE`、`ensure_spawn_overlay(dir)`（写前比对；复用 `models_config::write_atomic`；
  失败返回 `None`）、`build_omp_args(opts, overlay)`（`--config` 紧随 `--cwd`，其余顺序不变）、
  `pty_spawn` 在组参数前 ensure 再注入。新增单测两条。
- **`src-tauri/src/lib.rs`**：补 `pub mod models_config;`（lib 子集此前缺它，而 `pty.rs` 编进 lib）。
- **`src/lib/inputAssist.ts`**：`installInputAssistOff()`——既有元素 sweep + MutationObserver
  （childList/subtree + 四个属性的 `attributeFilter` 自愈），给每个 `input` / `textarea` /
  `[contenteditable]` 挂 `spellcheck=false` / `autocorrect=off` / `autocapitalize=off` /
  `autocomplete=off`；`src/main.tsx` 启动即挂载。新增单测 4 条。
- **删散装属性**：`CommitTaskPanel` / `CustomProviderEditForm` / `GeneralSettingsPanel` /
  `PluginsPanel` / `ProvidersSection` 里的 `spellCheck={false}` / `autoComplete="off"`。

## 4. 完成口径

- `pnpm check` 全绿：typecheck + lint（0 警告）+ **513 项前端单测**（含新增
  `src/lib/inputAssist.test.ts` 4 项）+ `e2e:ipc`（95 命令 × 双向一致）。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`：**211 通过 / 0 失败 / 14 ignored**；
  新增 `pty::tests::build_omp_args_includes_workspace_flags_and_overlay` 与
  `pty::tests::ensure_spawn_overlay_writes_and_repairs`（lib 与 bin 两个目标各跑一次）。
- **真机 PTY 对照**（omp 18.8.6，`--no-session`，参数 = `--cwd <tmp>` +（带覆盖层时才加）
  `--config <壳生成的覆盖层>`；逐个词输入后直接读 TUI 输入行）：

| 输入 | 无覆盖层（现状） | 带覆盖层（壳内行为） |
|---|---|---|
| `iph` | ` iphoto`（ghost 提示） | ` iph`（原样） |
| `hel` | ` iph help`（ghost 提示） | ` iph hel`（原样） |
| `wrold` | ` iph hel wrold`（该词未触发补全） | 同左 |

  带覆盖层时 omp 正常启动（无任何硬错误输出）。
- **真实 Chromium 冒烟**（dev 服务器 `http://127.0.0.1:1420`）：向页面注入 `textarea`，
  MutationObserver 一拍内挂上四个属性（读回 `false|off|off|off`）。
- WKWebView 本体的系统提示在壳内做不了机器核验（本进程无屏幕录制 / 辅助功能权限）：
  属性用法是 WebKit 文档化口径（SO #31455617 智能引号、SO #63926407 建议 / 纠正），
  「装饰时机与对象」由 jsdom 单测 + 真实 Chromium 两层证明；系统提示的真实观感由用户在
  自己的会话里复核（属性生效后 macOS 不再对这些元素做事）。

## 5. 边界（明确不做）

- **不改用户全局 `config.yml`**：`spelling.*` 三个键照旧是用户自己的设置（常用设置里照常显示 /
  可改）；壳只在 spawn 时用覆盖层压一层。
- 不关 emoji 补全与 ctrl+. 的手动拼写替换弹窗（见决策表）。
- **不给聊天形态（`omp --mode rpc-ui`）注入覆盖层**：那条链路的输入框是壳自己的 Composer
  （已由 `inputAssist` 覆盖），omp 的 TUI 编辑器不参与输入。
- 不做开关项：用户口径是「去除」，一次到位；要恢复时删掉注入或改覆盖层内容即可。
- 不代偿老版本 omp：不认识 `--config` / `spelling.*` 的版本按上游宽容处理（忽略），无需探测版本。
