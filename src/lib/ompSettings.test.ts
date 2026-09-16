import { describe, expect, it } from "vitest";
import { TEXT } from "./locale";
import { SETTING_GROUPS, SETTING_KEYS, SETTING_SPECS, groupLabelKey, optionsFor, settingLabelKey } from "./ompSettings";

/**
 * 白名单与字典的契约：`settingLabelKey` 是把 key 机械变形成字典键名的（`s_` + 点换下划线），
 * 拼错了编译期看不出来（只会在界面上显示成 undefined），所以由这里的测试守着。
 * 同时也是「白名单不许重复 / 枚举必须给全取值」的检查点。
 */

const zh = TEXT["zh-CN"];
const en = TEXT.en;

/** 与 `src-tauri/src/settings.rs` 的 `valid_key` 同规则：点分标识符、每段字母开头，
 *  段内可含 `_` / `-`（omp 的 schema 里 `web_search.enabled`、`providers.openai-codex.*` 都真实存在）。 */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/;

describe("omp 设置白名单", () => {
  it("key 都是合法的点分标识符（与后端 valid_key 同规则）", () => {
    for (const spec of SETTING_SPECS) {
      expect(spec.key, spec.key).toMatch(KEY_RE);
    }
  });

  it("key 不重复（重复会让两行改同一个键）", () => {
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length);
  });

  it("每个 key 都有中英 label（拼错就是界面上的 undefined）", () => {
    for (const spec of SETTING_SPECS) {
      const k = settingLabelKey(spec.key);
      expect(zh[k], `zh 缺 ${k}`).toBeTruthy();
      expect(en[k], `en 缺 ${k}`).toBeTruthy();
    }
  });

  it("每个分组都有中英组名", () => {
    for (const g of SETTING_GROUPS) {
      const k = groupLabelKey(g);
      expect(zh[k], `zh 缺 ${k}`).toBeTruthy();
      expect(en[k], `en 缺 ${k}`).toBeTruthy();
    }
  });

  it("每个 spec 都属于某个已声明的分组", () => {
    for (const spec of SETTING_SPECS) {
      expect(SETTING_GROUPS).toContain(spec.group);
    }
  });

  it("枚举项必须给出取值表，其它类型不许带取值表", () => {
    for (const spec of SETTING_SPECS) {
      if (spec.type === "enum") {
        expect(spec.options?.length, spec.key).toBeGreaterThan(0);
      } else {
        expect(spec.options, spec.key).toBeUndefined();
      }
    }
  });

  it("枚举取值不重复，且带 label 的都能在字典里查到", () => {
    for (const spec of SETTING_SPECS) {
      const values = (spec.options ?? []).map((o) => o.value);
      expect(new Set(values).size, spec.key).toBe(values.length);
      for (const opt of spec.options ?? []) {
        if (!opt.label) continue;
        expect(zh[opt.label], `zh 缺 ${opt.label}`).toBeTruthy();
        expect(en[opt.label], `en 缺 ${opt.label}`).toBeTruthy();
      }
    }
  });

  it("每个分组至少有一项（空组会在界面上留一个空壳）", () => {
    for (const g of SETTING_GROUPS) {
      expect(SETTING_SPECS.filter((s) => s.group === g).length, g).toBeGreaterThan(0);
    }
  });

  it("面板用到的界面文案都在字典里", () => {
    const keys = [
      "ompSettingsSection",
      "ompSettingsHint",
      "ompSettingsRefresh",
      "ompSettingsLoadFailed",
      "ompSettingsSaveFailed",
      "ompSettingsResetFailed",
      "ompSettingsReset",
      "ompSettingsUnavailable",
      "ompSettingsDefault",
      "ompSettingsMissing",
    ] as const;
    for (const k of keys) {
      expect(zh[k], `zh 缺 ${k}`).toBeTruthy();
      expect(en[k], `en 缺 ${k}`).toBeTruthy();
    }
  });
});

describe("optionsFor", () => {
  const spec = SETTING_SPECS.find((s) => s.key === "edit.mode")!;

  it("当前值在表里时按表的顺序给", () => {
    expect(optionsFor(spec, "hashline").map((o) => o.value)).toEqual([
      "apply_patch",
      "hashline",
      "patch",
      "replace",
      "sloppy",
    ]);
  });

  it("当前值不在表里（上游加了新枚举）时原样补一条，不吞信息", () => {
    const got = optionsFor(spec, "brand_new_mode").map((o) => o.value);
    expect(got).toContain("brand_new_mode");
    expect(got).toHaveLength(6);
  });

  it("空值 / 非字符串不补条目", () => {
    expect(optionsFor(spec, "")).toHaveLength(5);
    expect(optionsFor(spec, null)).toHaveLength(5);
    expect(optionsFor(spec, 42)).toHaveLength(5);
    expect(optionsFor(spec, undefined)).toHaveLength(5);
  });
});
