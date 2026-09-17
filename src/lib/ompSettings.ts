/**
 * omp 常用设置的白名单（设置 › 通用 ›「omp 常用设置」）。
 *
 * 定位：omp 的 `omp config` 有 **500+ 个键**（`omp config list` 实测 18.2.1 共 501 项，
 * 11 个分组），绝大多数是 TUI 渲染细节（`theme.*` / `statusLine.*` / `tui.*`），对桌面端
 * 没有意义。这里只收**影响 agent 行为、且用户真的会改**的那一类，并且**避开已经有专门入口
 * 的键**——`modelRoles` / `modelRoleStorage` 在设置 › 模型、`retry.fallbackChains` 与
 * `retry.modelFallback` 也在设置 › 模型（同义入口不许重复）。`tools.approvalMode` 在 V11
 * 之前挂在输入框的 `PermissionBadge` 上；终端工作区改版后那个入口退场（审批在 omp TUI
 * 里进行），这个键**回归本页**，是它现在唯一的图形入口。
 *
 * 口径（上游事实见 `src-tauri/src/settings.rs` 头注释）：
 * - 写的是 **omp 全局层**（`~/.omp/agent/config.yml`），不写 `<cwd>/.omp/config.yml`；
 * - 白名单只收 `boolean` / `enum` / `number` 三种标量——`array` / `record` 要整表读写，
 *   语义与单个开关不同（这类键各有专门入口或干脆不做）；
 * - enum 的合法取值**不在 `config list --json` 里**（上游只给 `type: "enum"`），所以选项表
 *   是壳侧自带的；当前值不在表里时（上游加了新枚举）界面把它原样补进下拉，不吞信息；
 * - label 走字典（键名规则见 `settingLabelKey`，漏键由单测守着），说明文字用上游英文
 *   原样透传（`SettingItem.description`，它是 omp 对这条设置的定义，不做翻译）。
 */

import type { Text } from "./locale";

/** 设置项分组；数组顺序即界面顺序。 */
export const SETTING_GROUPS = ["context", "tools", "files", "memory", "tasks", "interaction"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * 枚举项的一个合法取值。
 * `label` 省略时界面显示 omp 的原始值——思考档（minimal/low/high…）不走字典，
 * 与输入框的 `ThinkingPicker` 保持同一口径（那一处也是原样显示档位名）。
 */
export type SettingOption = { value: string; label?: keyof Text };

export type SettingSpec = {
 key: string;
 type: "boolean" | "enum" | "number";
 group: SettingGroup;
 /** `type: "enum"` 的合法取值（顺序即界面顺序）。 */
 options?: readonly SettingOption[];
 /** 数字类：`-1` 在 omp 里表示「用默认」（如 `temperature`、`compaction.thresholdPercent`）。 */
 minusOneIsDefault?: boolean;
 /** 数字输入框的范围提示（仅在已知时给）。 */
 min?: number;
 max?: number;
 /**
  * 这个键只影响 omp 自己的终端 TUI，对壳侧（`omp --mode rpc`）的会话没有可观测效果。
  *
  * 实测依据（2026-09-16，omp 18.2.1）：`plan.enabled` / `goal.enabled` 都只是**功能总闸**——
  * `plan.defaultOnStartup` 只被 TUI 启动流程消费（RPC 不查），goal 的隐藏工具只在 goal 模式
  * 激活时挂载（`getGoalModeState()?.enabled === true`），而 RPC 进不去这两个模式（实测
  * `get_state.dumpTools` 里既没有 plan 相关变化、也没有 `goal`）。界面在这一行标「仅 TUI 生效」，
  * 免得用户拨了开关以为桌面端会变。
  */
 tuiOnly?: boolean;
};

/** 设置项 label 的字典键：`s_` + key 里的点换成下划线（如 `compaction.enabled` → `s_compaction_enabled`）。 */
export function settingLabelKey(key: string): keyof Text {
 return `s_${key.replace(/\./g, "_")}` as keyof Text;
}

/** 分组名 label 的字典键（如 `context` → `sg_context`）。 */
export function groupLabelKey(group: SettingGroup): keyof Text {
 return `sg_${group}` as keyof Text;
}

/** 白名单。分组顺序见 `SETTING_GROUPS`，组内顺序即界面顺序（常改的靠前）。 */
export const SETTING_SPECS: readonly SettingSpec[] = [
 // —— 会话与上下文：直接影响「一次会话能装多少、贵不贵、断了怎么办」
 { key: "extendedContext", type: "boolean", group: "context" },
 { key: "contextPromotion.enabled", type: "boolean", group: "context" },
 { key: "compaction.enabled", type: "boolean", group: "context" },
 {
  key: "compaction.thresholdPercent",
  type: "number",
  group: "context",
  minusOneIsDefault: true,
  min: -1,
  max: 100,
 },
 { key: "compaction.autoContinue", type: "boolean", group: "context" },
 {
  key: "defaultThinkingLevel",
  type: "enum",
  group: "context",
  options: ["minimal", "low", "medium", "high", "xhigh", "max", "auto"].map((value) => ({ value })),
 },
 { key: "temperature", type: "number", group: "context", minusOneIsDefault: true, min: -1, max: 2 },
 { key: "retry.maxRetries", type: "number", group: "context", min: 0, max: 100 },

 // —— 工具：整块的开关，关掉就不再出现在会话里；审批档是 V11 才回归本页的常用项
 {
  key: "tools.approvalMode",
  type: "enum",
  group: "tools",
  options: [
   { value: "always-ask", label: "svApprovalAsk" },
   { value: "write", label: "svApprovalWrite" },
   { value: "yolo", label: "svApprovalYolo" },
  ],
 },
 { key: "web_search.enabled", type: "boolean", group: "tools" },
 { key: "fetch.enabled", type: "boolean", group: "tools" },
 { key: "browser.enabled", type: "boolean", group: "tools" },
 { key: "computer.enabled", type: "boolean", group: "tools" },
 { key: "github.enabled", type: "boolean", group: "tools" },
 { key: "todo.enabled", type: "boolean", group: "tools" },
 { key: "checkpoint.enabled", type: "boolean", group: "tools" },
 { key: "eval.py", type: "boolean", group: "tools" },
 { key: "eval.js", type: "boolean", group: "tools" },
 { key: "dev.autoqa", type: "boolean", group: "tools" },

 // —— 终端与编辑：bash 策略、编辑工具形态、读文件默认量、LSP
 { key: "bash.enabled", type: "boolean", group: "files" },
 { key: "bashInterceptor.enabled", type: "boolean", group: "files" },
 { key: "bash.allowCompoundCommands", type: "boolean", group: "files" },
 {
  key: "edit.mode",
  type: "enum",
  group: "files",
  // 五个取值是 omp 的工具形态名（hashline / apply_patch …），像思考档一样**原样显示**：
  // 翻译成中文反而会让人以为语义变了，含义交给上游 description（行上 title 悬浮）。
  options: ["apply_patch", "hashline", "patch", "replace", "sloppy"].map((value) => ({ value })),
 },
 { key: "read.defaultLimit", type: "number", group: "files", min: 1, max: 100000 },
 { key: "lsp.enabled", type: "boolean", group: "files" },
 { key: "lsp.formatOnWrite", type: "boolean", group: "files" },
 { key: "lsp.diagnosticsOnWrite", type: "boolean", group: "files" },

 // —— 记忆与学习：与设置 › 记忆 是同一套东西的开关侧（那边只列 / 读 / 删，不写配置）
 {
  key: "memory.backend",
  type: "enum",
  group: "memory",
  options: [
   { value: "off", label: "svMemOff" },
   { value: "local", label: "svMemLocal" },
   { value: "hindsight", label: "svMemHindsight" },
   { value: "mnemopi", label: "svMemMnemopi" },
   { value: "sharpshooter", label: "svMemSharpshooter" },
  ],
 },
 { key: "autolearn.enabled", type: "boolean", group: "memory" },

 // —— 任务与子代理
 // 前两项是 omp 对自身 TUI 的 plan / goal 功能总闸，对壳侧会话没有可观测效果（见 `tuiOnly`）
 { key: "plan.enabled", type: "boolean", group: "tasks", tuiOnly: true },
 { key: "goal.enabled", type: "boolean", group: "tasks", tuiOnly: true },
 { key: "skills.enabled", type: "boolean", group: "tasks" },
 { key: "task.isolation.enabled", type: "boolean", group: "tasks" },
 {
  key: "task.isolation.merge",
  type: "enum",
  group: "tasks",
  options: [
   { value: "patch", label: "svMergePatch" },
   { value: "branch", label: "svMergeBranch" },
  ],
 },
 { key: "task.maxConcurrency", type: "number", group: "tasks", min: 1, max: 128 },

 // —— 交互与显示
 { key: "autoResume", type: "boolean", group: "interaction" },
 {
  key: "power.sleepPrevention",
  type: "enum",
  group: "interaction",
  options: [
   { value: "off", label: "svSleepOff" },
   { value: "idle", label: "svSleepIdle" },
   { value: "display", label: "svSleepDisplay" },
   { value: "system", label: "svSleepSystem" },
  ],
 },
 {
  key: "steeringMode",
  type: "enum",
  group: "interaction",
  options: [
   { value: "all", label: "svQueueAll" },
   { value: "one-at-a-time", label: "svQueueOne" },
  ],
 },
 {
  key: "followUpMode",
  type: "enum",
  group: "interaction",
  options: [
   { value: "all", label: "svQueueAll" },
   { value: "one-at-a-time", label: "svQueueOne" },
  ],
 },
 { key: "hideThinkingBlock", type: "boolean", group: "interaction" },
 { key: "includeWorkspaceTree", type: "boolean", group: "interaction" },
];

/** 白名单里的全部键（读取时一次性交给后端）。 */
export const SETTING_KEYS: readonly string[] = SETTING_SPECS.map((s) => s.key);

/** 分组 → 该组的设置项（保持白名单顺序）。 */
export function specsOfGroup(group: SettingGroup): readonly SettingSpec[] {
 return SETTING_SPECS.filter((s) => s.group === group);
}

/**
 * 下拉里要显示的选项：白名单给的 + （当前值不在表里时）原样补一条。
 *
 * 补这一条是为了**不吞信息**：omp 加了新的枚举值而壳侧还没跟上时，界面照样显示得出真值，
 * 用户也不会因为它不在列表里就被迫改成一个"合法但我们不认识"的值。
 */
export function optionsFor(spec: SettingSpec, current: unknown): SettingOption[] {
 const list = [...(spec.options ?? [])];
 if (typeof current === "string" && current !== "" && !list.some((o) => o.value === current)) {
  list.push({ value: current });
 }
 return list;
}
