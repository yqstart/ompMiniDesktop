import { describe, expect, it } from "vitest";
import { highlightParts } from "./search";

describe("highlightParts", () => {
  it("标出全部命中（不只第一个）", () => {
    const parts = highlightParts("缓存策略与缓存失效", "缓存");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["缓存", "缓存"]);
    expect(parts.map((p) => p.text).join("")).toBe("缓存策略与缓存失效");
  });

  it("大小写不敏感，且保留原文大小写", () => {
    const parts = highlightParts("Use RedisCache here", "rediscache");
    expect(parts.find((p) => p.hit)?.text).toBe("RedisCache");
  });

  it("空查询与无命中都返回整段", () => {
    expect(highlightParts("abc", "  ")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightParts("abc", "zzz")).toEqual([{ text: "abc", hit: false }]);
  });

  it("命中在开头/结尾时不留空段", () => {
    expect(highlightParts("缓存", "缓存")).toEqual([{ text: "缓存", hit: true }]);
    expect(highlightParts("看缓存", "缓存")).toEqual([
      { text: "看", hit: false },
      { text: "缓存", hit: true },
    ]);
  });
});
