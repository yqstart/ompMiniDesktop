import type { TermTabState } from "@shared/types";

/**
 * 终端标签的 π 状态标：把 omp 的窗口标题（OSC 0/2）读成「omp 现在在干什么」。
 *
 * 上游口径（omp 18.2.x，`packages/coding-agent` 的标题模块；`tui.titleState` 默认开）：
 * 标题恒为 `π <分隔符> <会话名>`，**分隔符就是运行状态**——
 * - 工作态转轮：`tui.titleSpinner` 四套字形（braille / pulse / dots / line）每 80ms 换一帧；
 *   WSL（以及 win32 拿不到原生标题时）是静态 `:`；
 * - `!`：agent 在等你（审批 / `ask` 工具挂起）；
 * - `>`：轮到你了（本轮结束、空闲）。
 * 关掉 `tui.titleState` 的标题形如 `π: <会话名>`——没有状态，只能读出会话名。
 *
 * 为什么从标题拿状态：壳侧不解析终端字节流（V11 口径），标题是 omp 主动暴露状态的唯一通道；
 * 进程结局（正常 / 异常退出、启动失败）来自 PTY 事件。两边在 store 里合成 tab 上那一个 π。
 */

/** 标题里读得出的 omp 状态。 */
export type TitlePhase = Extract<TermTabState, "working" | "attention" | "ready" | "unknown">;

/**
 * 工作态分隔符的**并集**：四套转轮字形的全部帧 + WSL / win32 的静态 `:`。
 * 用户换 `tui.titleSpinner` 档位时帧字形整体不同，但都落在这份并集里——
 * 壳侧因此不必知道当前选的是哪套。
 */
const WORKING_SEPS: Record<string, true> = {
 "⠋": true, "⠙": true, "⠹": true, "⠸": true, "⠼": true, "⠴": true, "⠦": true, "⠧": true, "⠇": true, "⠏": true, // braille：经典扫描
 "○": true, "◔": true, "◑": true, "◕": true, "●": true, // pulse：月相填充
 "⠁": true, "⠂": true, "⠄": true, "⡀": true, "⠐": true, "⠈": true, // dots：单点轮转
 "-": true, "\\": true, "|": true, "/": true, // line：无盲文覆盖字体的 ASCII 兜底
 ":": true, // WSL / win32 的静态工作分隔符
};

/** `π <分隔符> <会话名>`（`tui.titleState` 开）；会话名可缺省（`π ⠋`）。 */
const TITLE_WITH_STATE = /^π (.)(?: (.*))?$/su;
/** `π: <会话名>`（`tui.titleState` 关）。 */
const TITLE_PLAIN = /^π: ?(.*)$/su;

/**
 * 解析 omp 的窗口标题：返回标题里的状态与**展示名**（去掉 `π <分隔符>` 前缀的会话名）。
 *
 * 读不出状态（`tui.titleState` 关掉、扩展改写过标题、还没收到过 OSC 标题）时
 * `phase = "unknown"`；`label` 尽量剥掉已知的 `π` 前缀，剥不掉就原样返回，
 * 由调用方决定回退（store 里回退到工作区名，见 `setTerminalTitle`）。
 */
export function parseTermTitle(raw: string): { phase: TitlePhase; label: string } {
 const withState = TITLE_WITH_STATE.exec(raw);
 if (withState) {
  const sep = withState[1];
  const phase: TitlePhase =
   sep === "!" ? "attention" : sep === ">" ? "ready" : WORKING_SEPS[sep] ? "working" : "unknown";
  return { phase, label: withState[2] ?? "" };
 }
 const plain = TITLE_PLAIN.exec(raw);
 if (plain) return { phase: "unknown", label: plain[1] ?? "" };
 if (raw === "π") return { phase: "unknown", label: "" };
 // 不是 omp 的标题格式（扩展覆盖等）：状态未知，展示名原样
 return { phase: "unknown", label: raw };
}

/**
 * 标题里的名字是不是 omp 的「会话还没有标题」回退值——实测（omp 18.2.x）：会话未生成标题时
 * 标题形如 `π > <cwd 末段目录名>`（= 项目 / worktree 目录名），生成或 `/rename` 之后才是会话标题。
 * 壳侧把这种回退值认出来：它不是会话标题，tab 该显示工作区显示名（`项目 · 分支`）而不是项目名。
 */
export function isWorkspaceNameFallback(label: string, cwd: string): boolean {
 const base = cwd.split("/").filter(Boolean).pop();
 return base != null && base.length > 0 && label === base;
}

/** tab 上显示的会话名：会话标题（OSC）优先，还没有就回退工作区显示名。 */
export function terminalDisplayName(term: { title: string | null; label: string }): string {
 return term.title ?? term.label;
}
