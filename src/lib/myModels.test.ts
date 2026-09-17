import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@shared/types";
import {
  addManyMyModels,
  candidateModels,
  myModelEntries,
  normalizeMyModels,
  providerSelectors,
  removeManyMyModels,
  toggleMyModel,
} from "./myModels";

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

const CATALOG = [m("opencode-go", "deepseek-v4.1-flash"), m("commandcode", "claude-fable-5"), m("opencode-go", "muse-spark")];

describe("我的模型", () => {
  it("normalizeMyModels 丢弃坏数据并去重保序", () => {
    expect(normalizeMyModels("nope")).toEqual([]);
    expect(normalizeMyModels([1, null, "", "   ", "a/b", "a/b", " c/d "])).toEqual(["a/b", "c/d"]);
  });

  it("toggleMyModel 追加到末尾 / 移除后其余顺序不变", () => {
    expect(toggleMyModel([], "a/b")).toEqual(["a/b"]);
    expect(toggleMyModel(["a/b", "c/d"], "e/f")).toEqual(["a/b", "c/d", "e/f"]);
    expect(toggleMyModel(["a/b", "c/d"], "a/b")).toEqual(["c/d"]);
  });

  it("addMany / removeMany 批量增删（去重、保序、不动无关项）", () => {
    expect(addManyMyModels(["a/b"], ["c/d", "a/b", "e/f"])).toEqual(["a/b", "c/d", "e/f"]);
    expect(removeManyMyModels(["a/b", "c/d", "e/f"], ["c/d", "x/y"])).toEqual(["a/b", "e/f"]);
    expect(removeManyMyModels(["a/b"], [])).toEqual(["a/b"]);
  });

  it("providerSelectors 只取该供应商在目录里的模型", () => {
    expect(providerSelectors(CATALOG, "opencode-go")).toEqual(["opencode-go/deepseek-v4.1-flash", "opencode-go/muse-spark"]);
    expect(providerSelectors(CATALOG, "nope")).toEqual([]);
  });

  it("myModelEntries 按存储顺序解析，目录里没有的模型为 null", () => {
    expect(myModelEntries(["commandcode/claude-fable-5", "x/y"], CATALOG)).toEqual([
      { selector: "commandcode/claude-fable-5", model: CATALOG[1] },
      { selector: "x/y", model: null },
    ]);
  });

  it("candidateModels：挑过 → 只留挑过的（按目录顺序）；空 → 全部不设限", () => {
    expect(candidateModels(CATALOG, []).map((x) => x.selector)).toEqual(CATALOG.map((x) => x.selector));
    // 存储顺序与目录顺序无关：结果跟目录顺序
    expect(candidateModels(CATALOG, ["opencode-go/muse-spark", "commandcode/claude-fable-5"]).map((x) => x.selector)).toEqual([
      "commandcode/claude-fable-5",
      "opencode-go/muse-spark",
    ]);
    // 目录里不存在的 selector 不会凭空造出候选
    expect(candidateModels(CATALOG, ["x/y"])).toEqual([]);
  });
});
