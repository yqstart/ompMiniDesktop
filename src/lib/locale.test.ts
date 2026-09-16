import { describe, expect, it } from "vitest";
import { LOCALES, TEXT } from "./locale";

describe("界面语言字典", () => {
  it("两套字典键完全一致（增删文案必须中英同键）", () => {
    const zh = Object.keys(TEXT["zh-CN"]).sort();
    const en = Object.keys(TEXT.en).sort();
    expect(en).toEqual(zh);
    // 全界面文案（侧栏 / 消息流 / 输入区 / 设置页）都在这里，键数过少说明有整块漏迁
    expect(zh.length).toBeGreaterThan(150);
  });
  it("LOCALES 只含已落字典的语言", () => {
    expect([...LOCALES].sort()).toEqual(["en", "zh-CN"]);
  });
  it("无空文案（避免切英文后出现空白按钮）", () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(TEXT[locale])) {
        expect(text.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });
  it("英文词典不含中文（漏译立刻暴露）", () => {
    for (const [key, text] of Object.entries(TEXT.en)) {
      expect(/[\u4e00-\u9fff]/.test(text), `en.${key}`).toBe(false);
    }
  });
});
