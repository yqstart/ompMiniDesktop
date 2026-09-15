import { describe, expect, it } from "vitest";
import { TEXT } from "./locale";
import {
 COMPOSER_SHAPES,
 OPTION_LABELS,
 runtimeChoiceValues,
 SETTINGS_LIST,
 SETTING_NOTES,
 SETTING_SECTION_OVERRIDES,
} from "./settingsList";
import { OMP_SETTING_NAMES } from "./ompSettingNames";

const zh = TEXT["zh-CN"];
const en = TEXT.en;

/**
 * 「常用设置」页展示清单的维护契约（docs/v28-schedule.md 三稿）：
 * ① 无重复；② 每项有中英短名（行标题不退化）；③ 规模 100–140；④ 三稿删掉的 33 项不得回流；
 * ⑤ 翻译 / 标注 / 归位表的键都在清单里、字典键中英非空；⑥ 字典里的每个 `sv*` 键都被翻译表
 * 引用（无孤儿——删键时要同步清翻译）。
 *
 * 与上游真实目录的核对在测试外做：清单 ⊆ 名称表（第 ② 条），名称表 ⊆ 519 快照且无幽灵键
 * （`ompSettingNames.test.ts`）——传递保证清单里的键都是本机上游真实存在的。
 */

/** 三稿明确删掉的 33 项（用户口径）：不得回流到清单里。 */
const REMOVED = [
 "colorBlindMode",
 "tui.imeSafeCursor",
 "workspace.additionalDirectories",
 "branchSummary.enabled",
 "providers.maxInFlightRequests",
 "providers.openai-codex.codeMode",
 "speech.enabled",
 "speech.voice",
 "providers.fetch",
 "exa.enabled",
 "searxng.endpoint",
 "secrets.enabled",
 "bash.autoBackground.enabled",
 "bash.direnv",
 "shellMinimizer.enabled",
 "python.interpreter",
 "worktree.base",
 "commands.enableClaudeUser",
 "commands.enableClaudeProject",
 "commands.enableOpencodeUser",
 "commands.enableOpencodeProject",
 "todo.eager",
 "grep.contextBefore",
 "grep.contextAfter",
 "astGrep.enabled",
 "astEdit.enabled",
 "find.enabled",
 "debug.enabled",
 "generate_image.enabled",
 "vault.enabled",
 "security.enabled",
 "ask.enabled",
 "browser.headless",
];

describe("常用设置展示清单", () => {
 it("117 项、无重复", () => {
  expect(SETTINGS_LIST).toHaveLength(117);
  expect(new Set(SETTINGS_LIST).size).toBe(SETTINGS_LIST.length);
 });

 it("每一项都有中英短名（名称表全覆盖；行标题不退化）", () => {
  const missing = SETTINGS_LIST.filter((k) => {
   const pair = OMP_SETTING_NAMES[k];
   return !pair || !pair[0] || !pair[1];
  });
  expect(missing, `缺名称：${missing.join(", ")}`).toEqual([]);
 });

 it("规模保持在精选量级（100–140 项，防止扩回全量）", () => {
  expect(SETTINGS_LIST.length).toBeGreaterThanOrEqual(100);
  expect(SETTINGS_LIST.length).toBeLessThanOrEqual(140);
 });

 it("三稿删掉的 33 项不在清单里（不得回流）", () => {
  expect(REMOVED).toHaveLength(33);
  const back = REMOVED.filter((k) => SETTINGS_LIST.includes(k));
  expect(back, `回流：${back.join(", ")}`).toEqual([]);
 });

 it("翻译表：键都在清单里、每个字典键中英非空", () => {
  const known = new Set(SETTINGS_LIST);
  const unknown = Object.keys(OPTION_LABELS).filter((k) => !known.has(k));
  expect(unknown, `不在清单里的键：${unknown.join(", ")}`).toEqual([]);
  for (const [key, map] of Object.entries(OPTION_LABELS)) {
   for (const [value, labelKey] of Object.entries(map)) {
    expect(zh[labelKey], `${key} = ${value}（zh 缺 ${labelKey}）`).toBeTruthy();
    expect(en[labelKey], `${key} = ${value}（en 缺 ${labelKey}）`).toBeTruthy();
   }
  }
 });

 it("字典里的每个 sv* 键都被翻译表引用（无孤儿）", () => {
  const used = new Set<string>(Object.values(OPTION_LABELS).flatMap((m) => Object.values(m)));
  const orphans = Object.keys(zh).filter((k) => k.startsWith("sv") && !used.has(k));
  expect(orphans, `孤儿字典键：${orphans.join(", ")}`).toEqual([]);
 });

 it("标注与归位表：键都在清单里", () => {
  const known = new Set(SETTINGS_LIST);
  for (const k of [...Object.keys(SETTING_NOTES), ...Object.keys(SETTING_SECTION_OVERRIDES)]) {
   expect(known.has(k), `${k} 不在清单里`).toBe(true);
  }
 });

 it("runtimeChoiceValues：theme.* 用运行时列表、composer.shape 用内置八形态、其余 null", () => {
  const themes = ["dark", "light", "dark-catppuccin"];
  expect(runtimeChoiceValues("theme.dark", themes)).toEqual(themes);
  expect(runtimeChoiceValues("theme.light", themes)).toEqual(themes);
  expect(runtimeChoiceValues("composer.shape", [])).toEqual([...COMPOSER_SHAPES]);
  expect(COMPOSER_SHAPES).toHaveLength(8);
  // 普通 string 键（路径 / URL）没有运行时表
  expect(runtimeChoiceValues("searxng.endpoint", themes)).toBeNull();
  expect(runtimeChoiceValues("python.interpreter", themes)).toBeNull();
 });
});
