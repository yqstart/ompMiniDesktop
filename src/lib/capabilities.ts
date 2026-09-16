/**
 * omp 会话级「能力」开关（输入框工具行 `CapabilityMenu` 的数据层，纯函数便于单测）。
 *
 * 上游实测（omp 18.2.1，2026-09-16）——这一层的取舍全由 RPC 的可达性决定：
 *
 * - `computer` / `advisor` 是 omp 内建斜杠命令里**同时实现了 `handle`（ACP/RPC）与 `handleTui`** 的那一类，
 *   所以壳侧可以按普通 `prompt` 直接下发（`agentInvoked:false`，没有 agent turn、不计 token）：
 *   `{type:"prompt", message:"/computer on"}`。**状态也只从命令自己的输出里读**（`get_state` 没有这两个开关的字段）：
 *   - `/computer status` → `Computer use: enabled · prelude: active · configured: display=all, …`
 *   - `/advisor status`  → `Advisor is enabled (provider/model). Context: … Spend: …` / `Advisor is disabled.`
 *   注意 `/computer on|off` 自己的回执（`… enabled/disabled for this session.`）**不带状态行**，
 *   所以「开关之后」要再发一次 `status` 才能把状态确认下来（本模块的 `PROBE_AFTER_MS` 就是为它定的）。
 *
 * - `plan` / `goal` 在 omp 18.2.1 里**只有 `handleTui`**：RPC 侧没有分发它们（实测把 `/plan` 当普通 prompt 发出去，
 *   会真的开一个 agent turn 把这段文字喂给模型——比不做还糟），`get_state` 里也没有对应字段；
 *   `goal` 连配置项都没有（`omp config list --json` 里没有 `goal.*`）。所以这两项**不能做成交互控件**，
 *   界面上如实标为「omp 只在终端 TUI 里处理」，不假装能切。
 */

/** 壳侧能驱动的两个开关。 */
export type CapabilityId = "advisor" | "computer";

/** 一个开关的已知状态（value 只有 on/off；拿不到状态就是 undefined，不猜）。 */
export type CapabilityState = {
 /** omp 自己报的状态。 */
 value: "on" | "off";
 /** 状态行的补充细节（advisor 是接手的模型，computer 是 prelude / 显示配置）。 */
 detail?: string;
 /** 这次状态是什么时候读到的（毫秒时间戳；用来判断要不要重新探一次）。 */
 at: number;
};

export type SessionCapabilities = Partial<Record<CapabilityId, CapabilityState>>;

/** 状态探针的最小间隔：低于这个年龄就不重复发 `status`。 */
export const PROBE_TTL_MS = 60_000;

/**
 * 开关动作之后再过多久探状态。
 *
 * `/computer on|off` 与 `/advisor on|off` 都是本地命令（无 agent turn），回执与状态行几乎同时到；
 * 给一拍再发 `status`，避开「探针的输出早于开关生效」的竞态。这个值是**行为性兜底**，
 * 不是精确同步——状态永远以 omp 的 `status` 输出为准（探不到就显示「未查询」）。
 */
export const PROBE_AFTER_MS = 700;

/** 该能力的开关命令；`on` 为 null 时表示「读状态」。 */
export function capabilityCommand(id: CapabilityId, on?: boolean): string {
 return `/${id} ${on === undefined ? "status" : on ? "on" : "off"}`;
}

/**
 * 从 `command_output` 的正文里认出能力状态（前缀匹配，形状照抄实测输出）。
 * 认不出返回 null —— 普通命令输出（`/usage`、用户自己的命令）一律不进这个面。
 */
export function parseCapabilityProbe(text: string): { id: CapabilityId; value: "on" | "off"; detail?: string } | null {
 const line = text.trim();
 // Advisor is enabled (commandcode/gpt-5.6-sol). Context: 0 / 1,050,000 tokens (0%). Spend: …
 const advisor = /^Advisor is (enabled|disabled)\b\.?/.exec(line);
 if (advisor) {
  const detail = /^Advisor is enabled \(([^)]+)\)/.exec(line)?.[1];
  return { id: "advisor", value: advisor[1] === "enabled" ? "on" : "off", detail };
 }
 // Computer use: enabled · prelude: active · configured: display=all, maxWidth=3840, …
 const computer = /^Computer use: (enabled|disabled)\b/.exec(line);
 if (computer) {
  // 细节取第一个 · 之后到第二个 · 之前的那段（`prelude: active`）——显示配置那截太长，不上行
  const rest = line.slice(computer[0].length);
  const detail = rest.split("·").map((s) => s.trim()).filter((s) => s && !s.startsWith("configured:"))[0];
  return { id: "computer", value: computer[1] === "enabled" ? "on" : "off", detail };
 }
 return null;
}

/** 缓存还新鲜吗（新鲜就不重复探）。 */
export function isFresh(state: CapabilityState | undefined, now: number): boolean {
 return !!state && now - state.at < PROBE_TTL_MS;
}

/**
 * 面板里的四行。前两个是壳侧能切的真开关；
 * `plan` / `goal` 是**只读说明行**（omp 18.2.1 只把它们实现在 TUI 里），行上只解释为什么不能切。
 */
export const CAPABILITY_ROWS: {
 id: CapabilityId | "plan" | "goal";
 /** 能不能切（false = 只显示说明，控件禁用）。 */
 toggleable: boolean;
}[] = [
 { id: "advisor", toggleable: true },
 { id: "computer", toggleable: true },
 { id: "plan", toggleable: false },
 { id: "goal", toggleable: false },
];
