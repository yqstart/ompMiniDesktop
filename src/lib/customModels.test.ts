import { describe, expect, it } from "vitest";
import {
  API_OPTIONS,
  emptyProviderForm,
  isValidProviderId,
  modelFormComplete,
  parseModelsConfig,
  providerFormComplete,
  providerFormOf,
  removeProvider,
  upsertProvider,
  type CustomProviderForm,
} from "./customModels";

// 样例＝用户真实 models.yml 的形态：顶部注释 + 覆盖型块（deepseek）+ 自定义块（含界面之外的键）
const SAMPLE = `# 顶部注释：保留说明
providers:
  deepseek:
    modelOverrides:
      deepseek-flash:
        input: [text, image]
        compat:
          stripImageInput: false
  my-gw:
    baseUrl: https://gw.example.com/v1
    apiKey: GW_KEY
    api: openai-completions
    headers:
      X-Team: platform
    models:
      - id: gpt-x
        name: GPT X
        contextWindow: 128000
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }
`;

function form(over: Partial<CustomProviderForm> = {}): CustomProviderForm {
  return {
    ...emptyProviderForm(),
    id: "new-gw",
    baseUrl: "http://127.0.0.1:8000/v1",
    models: [{ id: "m1", name: "M1", contextWindow: "", maxTokens: "", reasoning: false, input: ["text"] }],
    ...over,
  };
}

describe("parseModelsConfig", () => {
  it("区分自定义块与覆盖型块，读出字段与界面之外的键", () => {
    const { providers, error } = parseModelsConfig(SAMPLE);
    expect(error).toBeNull();
    expect(providers.map((p) => p.id)).toEqual(["deepseek", "my-gw"]);

    const [deepseek, gw] = providers;
    expect(deepseek.kind).toBe("override");
    expect(deepseek.extraKeys).toEqual(["modelOverrides"]);
    expect(deepseek.modelCount).toBe(0);

    expect(gw.kind).toBe("custom");
    expect(gw.baseUrl).toBe("https://gw.example.com/v1");
    expect(gw.api).toBe("openai-completions");
    expect(gw.hasApiKey).toBe(true);
    expect(gw.authNone).toBe(false);
    expect(gw.modelCount).toBe(1);
    expect(gw.extraKeys).toEqual(["headers"]);
  });

  it("空文本 / 无 providers 都是空清单而非错误", () => {
    expect(parseModelsConfig("")).toEqual({ providers: [], error: null });
    expect(parseModelsConfig("# 只有注释\n")).toEqual({ providers: [], error: null });
    expect(parseModelsConfig("theme:\n  dark: x\n")).toEqual({ providers: [], error: null });
  });

  it("坏 YAML 报 yaml 错误；providers 不是对象报 shape 错误", () => {
    const bad = parseModelsConfig("providers: [");
    expect(bad.providers).toEqual([]);
    expect(bad.error?.kind).toBe("yaml");
    const shape = parseModelsConfig("providers: 42\n");
    expect(shape.error?.kind).toBe("shape");
  });
});

describe("providerFormOf", () => {
  it("读出表单初值（未声明 input 时按只收文本）", () => {
    const f = providerFormOf(SAMPLE, "my-gw");
    expect(f).not.toBeNull();
    expect(f!.baseUrl).toBe("https://gw.example.com/v1");
    expect(f!.api).toBe("openai-completions");
    expect(f!.apiKey).toBe("GW_KEY");
    expect(f!.models).toHaveLength(1);
    expect(f!.models[0]).toEqual({
      id: "gpt-x",
      name: "GPT X",
      contextWindow: "128000",
      maxTokens: "",
      reasoning: false,
      input: ["text"],
    });
  });

  it("不存在的 id / 解析失败都返回 null", () => {
    expect(providerFormOf(SAMPLE, "nope")).toBeNull();
    expect(providerFormOf("providers: [", "x")).toBeNull();
  });
});

describe("upsertProvider 保真编辑", () => {
  it("改一个模型字段：注释、其它块、界面之外的键全部原样保留", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.models[0].name = "新名字";
    const r = upsertProvider(SAMPLE, f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.text;
    expect(out).toContain("name: 新名字");
    // 顶部注释、覆盖型块、界面之外的键（headers / cost）一个不少
    expect(out).toContain("# 顶部注释：保留说明");
    expect(out).toContain("stripImageInput: false");
    expect(out).toContain("X-Team: platform");
    expect(out).toContain("cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0}");
    // 未触碰的 provider 块逐字节不变
    expect(out).toContain("  deepseek:\n    modelOverrides:\n      deepseek-flash:\n        input: [text, image]\n");
  });

  it("apiKey 与 auth: none 互斥", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.apiKey = "";
    const out = (upsertProvider(SAMPLE, f) as { ok: true; text: string }).text;
    expect(out).toContain("auth: none");
    expect(out).not.toContain("apiKey");
    // 再填回去：auth 消失、apiKey 回来
    const back = (upsertProvider(out, { ...f, apiKey: "NEW_KEY" }) as { ok: true; text: string }).text;
    expect(back).toContain("apiKey: NEW_KEY");
    expect(back).not.toContain("auth: none");
  });

  it("数字 / 推理 / 图片输入按 omp 的 schema 写；空值删键", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.models[0].contextWindow = "";
    f.models[0].maxTokens = "4096";
    f.models[0].reasoning = true;
    f.models[0].input = ["text", "image"];
    const out = (upsertProvider(SAMPLE, f) as { ok: true; text: string }).text;
    expect(out).not.toContain("contextWindow");
    expect(out).toContain("maxTokens: 4096");
    expect(out).toContain("reasoning: true");
    expect(out).toContain("input: [text, image]");
  });

  it("从空文本建新供应商：结构可直接被 omp 读取", () => {
    const r = upsertProvider("", form({ models: [{ id: "m1", name: "M1", contextWindow: "", maxTokens: "", reasoning: false, input: ["text"] }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("providers:");
    expect(r.text).toContain("new-gw:");
    expect(r.text).toContain("baseUrl: http://127.0.0.1:8000/v1");
    expect(r.text).toContain("auth: none");
    expect(r.text).toContain("api: openai-completions");
    const again = parseModelsConfig(r.text);
    expect(again.error).toBeNull();
    expect(again.providers.map((p) => p.id)).toEqual(["new-gw"]);
  });

  it("追加到已有文件末尾：原内容与注释不动", () => {
    const r = upsertProvider(SAMPLE, form());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.startsWith("# 顶部注释：保留说明\n")).toBe(true);
    expect(r.text).toContain("  deepseek:");
    expect(r.text.indexOf("new-gw:")).toBeGreaterThan(r.text.indexOf("my-gw:"));
  });

  it("解析不了的文本拒绝编辑（不覆盖）", () => {
    const r = upsertProvider("providers: [", form());
    expect(r.ok).toBe(false);
  });

  it("重复 id 的模型按 id 复用节点（界面之外的字段保住）", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.models = [{ ...f.models[0], maxTokens: "2048" }, { id: "m2", name: "M2", contextWindow: "", maxTokens: "", reasoning: false, input: ["text"] }];
    const out = (upsertProvider(SAMPLE, f) as { ok: true; text: string }).text;
    expect(out).toContain("cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0}");
    expect(out).toContain("maxTokens: 2048");
    expect(out).toContain("id: m2");
  });
});

describe("removeProvider", () => {
  it("只删目标块，注释与其它块保留", () => {
    const r = removeProvider(SAMPLE, "deepseek");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toContain("deepseek");
    expect(r.text).toContain("# 顶部注释：保留说明");
    expect(r.text).toContain("my-gw:");
    expect(r.text).toContain("X-Team: platform");
  });

  it("删掉最后一个块后仍留下合法空结构（空文件会让 omp 报 root 错误）", () => {
    const one = "providers:\n  a:\n    baseUrl: http://x/v1\n";
    const r = removeProvider(one, "a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.trim()).toBe("providers: {}");
  });

  it("没有 providers 块时原样返回（不制造副作用），坏 YAML 拒绝编辑", () => {
    const r = removeProvider("# x\n", "a");
    expect(r.ok && r.text).toBe("# x\n");
    expect(removeProvider("providers: [", "a").ok).toBe(false);
  });
});

describe("表单校验", () => {
  it("provider id 字符集", () => {
    for (const ok of ["a", "my-gw", "llama.cpp", "a_b-1.2"]) expect(isValidProviderId(ok)).toBe(true);
    for (const bad of ["", "-gw", ".gw", "a b", "a/b", "中文"]) expect(isValidProviderId(bad)).toBe(false);
  });

  it("模型字段完整性与整体可保存性", () => {
    expect(modelFormComplete({ id: "m", name: "", contextWindow: "", maxTokens: "", reasoning: false, input: [] })).toBe(true);
    expect(modelFormComplete({ id: "m", name: "", contextWindow: "abc", maxTokens: "", reasoning: false, input: [] })).toBe(false);
    expect(modelFormComplete({ id: "m", name: "", contextWindow: "0", maxTokens: "", reasoning: false, input: [] })).toBe(false);
    expect(modelFormComplete({ id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false, input: [] })).toBe(false);

    expect(providerFormComplete(form())).toBe(true);
    expect(providerFormComplete(form({ baseUrl: "gw.example.com" }))).toBe(false);
    expect(providerFormComplete(form({ api: "" }))).toBe(false);
    expect(providerFormComplete(form({ models: [] }))).toBe(false);
  });

  it("默认表单指向 openai-completions", () => {
    expect(emptyProviderForm().api).toBe(API_OPTIONS[0]);
  });
});
