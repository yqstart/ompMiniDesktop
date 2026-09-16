import { describe, expect, it } from "vitest";
import { LOCALES, SETTINGS_TEXT } from "./locale";

describe("设置页中英字典", () => {
  it("两套字典键完全一致（增删文案必须中英同键）", () => {
    const zh = Object.keys(SETTINGS_TEXT["zh-CN"]).sort();
    const en = Object.keys(SETTINGS_TEXT["en"]).sort();
    expect(en).toEqual(zh);
    expect(zh.length).toBeGreaterThan(0);
  });
  it("LOCALES 只含已落字典的语言", () => {
    expect([...LOCALES].sort()).toEqual(["en", "zh-CN"]);
  });
  it("无空文案（避免切英文后出现空白按钮）", () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(SETTINGS_TEXT[locale])) {
        expect(text.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
