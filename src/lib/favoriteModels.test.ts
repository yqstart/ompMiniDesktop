import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@shared/types";
import { favoriteEntries, normalizeFavorites, toggleFavorite } from "./favoriteModels";

const m = (provider: string, id: string): ModelInfo => ({
  provider,
  id,
  selector: `${provider}/${id}`,
  name: id,
  contextWindow: null,
  maxTokens: null,
  reasoning: null,
  thinking: null,
  input: null,
});

describe("常用模型", () => {
  it("normalizeFavorites 丢弃坏数据并去重保序", () => {
    expect(normalizeFavorites("nope")).toEqual([]);
    expect(normalizeFavorites([1, null, "", "   ", "a/b", "a/b", " c/d "])).toEqual(["a/b", "c/d"]);
  });
  it("toggleFavorite 追加到末尾 / 移除后其余顺序不变", () => {
    expect(toggleFavorite([], "a/b")).toEqual(["a/b"]);
    expect(toggleFavorite(["a/b", "c/d"], "e/f")).toEqual(["a/b", "c/d", "e/f"]);
    expect(toggleFavorite(["a/b", "c/d"], "a/b")).toEqual(["c/d"]);
  });
  it("favoriteEntries 按存储顺序解析，目录里没有的模型为 null", () => {
    const catalog = [m("c", "d"), m("a", "b")];
    expect(favoriteEntries(["a/b", "x/y"], catalog)).toEqual([
      { selector: "a/b", model: catalog[1] },
      { selector: "x/y", model: null },
    ]);
  });
});
