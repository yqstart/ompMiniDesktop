import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  API_OPTIONS,
  apiOptionsFor,
  emptyProviderForm,
  isDuplicateProviderId,
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

  it("中文供应商名：键原样写出、可被解析回来（omp 实测收录该键）", () => {
    const r = upsertProvider("", form({ id: "云渡中转" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("云渡中转:");
    const back = parseModelsConfig(r.text);
    expect(back.error).toBeNull();
    expect(back.providers.map((p) => p.id)).toEqual(["云渡中转"]);
  });

  it("解析不了的文本拒绝编辑（不覆盖）", () => {
    const r = upsertProvider("providers: [", form());
    expect(r.ok).toBe(false);
  });

  it("结构损坏时拒绝编辑，不把 providers 标量或根数组覆盖为空对象", () => {
    for (const text of ["providers: 42\n", "providers: null\n", "- item\n", "42\n"]) {
      expect(parseModelsConfig(text).error?.kind).toBe("shape");
      expect(providerFormOf(text, "my-gw")).toBeNull();
      expect(upsertProvider(text, form()).ok).toBe(false);
      expect(removeProvider(text, "my-gw").ok).toBe(false);
    }
  });

  it("模型改 id 后保留自身 cost，删除后新建同名模型不会继承旧字段", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.models[0].id = "renamed-model";
    const result = upsertProvider(SAMPLE, f);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const model = parse(result.text).providers["my-gw"].models[0];
    expect(model.id).toBe("renamed-model");
    expect(model.cost).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });

    f.models = [{ ...form().models[0], id: "gpt-x" }];
    const replacement = upsertProvider(SAMPLE, f);
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(parse(replacement.text).providers["my-gw"].models[0].cost).toBeUndefined();
  });

  it("删除前一行后剩余模型改名仍保留自己的隐藏字段", () => {
    const text = `providers:
  gw:
    baseUrl: https://example.com
    api: openai-completions
    auth: none
    models:
      - id: first
        tokenizer: first-tokenizer
      - id: second
        tokenizer: second-tokenizer
`;
    const f = providerFormOf(text, "gw")!;
    f.models = [f.models[1]];
    f.models[0].id = "first";
    const result = upsertProvider(text, f);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parse(result.text).providers.gw.models).toEqual([{ id: "first", tokenizer: "second-tokenizer" }]);
  });

  it("编辑其它字段时保留显式 auth、false、未知模态及模型列表注释", () => {
    const text = `providers:
  gw:
    baseUrl: https://example.com
    api: google-vertex
    apiKey: KEY
    auth: oauth
    models: # keep list comment
      - id: old
        reasoning: false # keep explicit false
        input: [text, audio] # keep input comment
`;
    const f = providerFormOf(text, "gw")!;
    f.models[0].id = "new";
    const result = upsertProvider(text, f);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parse(result.text).providers.gw).toEqual({
      baseUrl: "https://example.com", api: "google-vertex", apiKey: "KEY", auth: "oauth",
      models: [{ id: "new", reasoning: false, input: ["text", "audio"] }],
    });
    expect(result.text).toContain("# keep list comment");
    expect(result.text).toContain("# keep explicit false");
    expect(result.text).toContain("# keep input comment");

    f.models[0].input.push("image");
    const withImage = upsertProvider(text, f);
    expect(withImage.ok).toBe(true);
    if (!withImage.ok) return;
    expect(parse(withImage.text).providers.gw.models[0].input).toEqual(["text", "audio", "image"]);
  });

  it("模型 id 重复（含前后空白）时拒绝保存，不复用同一个节点两次", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.models.push({ ...form().models[0], id: " gpt-x " });
    expect(providerFormComplete(f)).toBe(false);
    expect(upsertProvider(SAMPLE, f).ok).toBe(false);
  });

  it("保留已有模型的隐藏字段，并允许追加新模型", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.models = [{ ...f.models[0], maxTokens: "2048" }, { id: "m2", name: "M2", contextWindow: "", maxTokens: "", reasoning: false, input: ["text"] }];
    const out = (upsertProvider(SAMPLE, f) as { ok: true; text: string }).text;
    expect(out).toContain("cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0}");
    expect(out).toContain("maxTokens: 2048");
    expect(out).toContain("id: m2");
  });

  it("改名：YAML 键就地替换（块的位置与键上的注释保留）", () => {
    const text = [
      "providers:",
      "  first:",
      "    baseUrl: http://a/v1",
      "  # 待改名的块",
      "  mid:",
      "    baseUrl: http://b/v1",
      "    api: anthropic-messages",
      "    apiKey: K2",
      "    models:",
      "      - id: n",
      "  last:",
      "    baseUrl: http://c/v1",
      "",
    ].join("\n");
    const f = providerFormOf(text, "mid")!;
    f.id = "renamed";
    const r = upsertProvider(text, f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toContain("mid:");
    expect(r.text.indexOf("renamed:")).toBeGreaterThan(r.text.indexOf("first:"));
    expect(r.text.indexOf("renamed:")).toBeLessThan(r.text.indexOf("last:"));
    expect(r.text).toContain("  # 待改名的块");
    expect(r.text).toContain("api: anthropic-messages");
  });

  it("改名：其余块、界面之外的键与模型级字段全部原样保留", () => {
    const f = providerFormOf(SAMPLE, "my-gw")!;
    f.id = "renamed-gw";
    const out = (upsertProvider(SAMPLE, f) as { ok: true; text: string }).text;
    expect(out).toContain("  renamed-gw:\n");
    expect(out).not.toContain("my-gw");
    expect(out).toContain("# 顶部注释：保留说明");
    expect(out).toContain("X-Team: platform");
    expect(out).toContain("GW_KEY");
    expect(out).toContain("cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0}");
  });

  it("新建撞名、改名撞名与失效编辑目标均拒绝保存", () => {
    const clash = providerFormOf(SAMPLE, "my-gw")!;
    clash.id = "deepseek";
    expect(upsertProvider(SAMPLE, clash).ok).toBe(false);
    expect(upsertProvider(SAMPLE, form({ id: "my-gw" })).ok).toBe(false);
    expect(upsertProvider(SAMPLE, { ...clash, originalId: "missing", id: "new" }).ok).toBe(false);
    expect(upsertProvider(SAMPLE, { ...clash, originalId: "deepseek" }).ok).toBe(false);
  });
});

describe("removeProvider", () => {
  it("只删目标块，注释与其它块保留", () => {
    const r = removeProvider(SAMPLE, "my-gw");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).not.toContain("my-gw");
    expect(r.text).toContain("# 顶部注释：保留说明");
    expect(r.text).toContain("deepseek:");
    expect(r.text).toContain("stripImageInput: false");
  });

  it("删掉最后一个块后仍留下合法空结构（空文件会让 omp 报 root 错误）", () => {
    const one = "providers:\n  a:\n    baseUrl: http://x/v1\n    api: openai-completions\n    auth: none\n    models:\n      - id: m\n";
    const r = removeProvider(one, "a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.trim()).toBe("providers: {}");
  });

  it("覆盖型块只读，不提供编辑表单也不允许删除", () => {
    expect(providerFormOf(SAMPLE, "deepseek")).toBeNull();
    expect(removeProvider(SAMPLE, "deepseek").ok).toBe(false);
  });
  it("没有 providers 块时原样返回（不制造副作用），坏 YAML 拒绝编辑", () => {
    const r = removeProvider("# x\n", "a");
    expect(r.ok && r.text).toBe("# x\n");
    expect(removeProvider("providers: [", "a").ok).toBe(false);
  });
});

describe("表单校验", () => {
  it("provider id 字符集（Unicode 字母——中文 / 日文——放行，omp 侧无约束）", () => {
    for (const ok of ["a", "my-gw", "llama.cpp", "a_b-1.2", "云渡中转", "模型-2", "プロバイダ"])
      expect(isValidProviderId(ok), ok).toBe(true);
    for (const bad of ["", "-gw", ".gw", "a b", "a/b", "云渡 中转", ":x", "a:b", "a#b"])
      expect(isValidProviderId(bad), bad).toBe(false);
  });

  it("模型字段完整性与整体可保存性", () => {
    expect(modelFormComplete({ id: "m", name: "", contextWindow: "", maxTokens: "", reasoning: false, input: [] })).toBe(true);
    expect(modelFormComplete({ id: "m", name: "", contextWindow: "abc", maxTokens: "", reasoning: false, input: [] })).toBe(false);
    expect(modelFormComplete({ id: "m", name: "", contextWindow: "0", maxTokens: "", reasoning: false, input: [] })).toBe(false);
    expect(modelFormComplete({ id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false, input: [] })).toBe(false);

    expect(providerFormComplete(form())).toBe(true);
    expect(providerFormComplete(form({ id: "云渡中转" }))).toBe(true);
    expect(providerFormComplete(form({ baseUrl: "gw.example.com" }))).toBe(false);
    expect(providerFormComplete(form({ baseUrl: "https://" }))).toBe(false);
    expect(providerFormComplete(form({ baseUrl: "https:example.com" }))).toBe(false);
    expect(providerFormComplete(form({ baseUrl: "HTTPS://example.com/v1" }))).toBe(true);
    expect(providerFormComplete(form({ api: "" }))).toBe(false);
    expect(providerFormComplete(form({ models: [] }))).toBe(false);
  });

});

describe("接口类型候选（apiOptionsFor）", () => {
  it("界面只提供两档；既有文件里写的其它值原样追加（不改动也能保存）", () => {
    expect(API_OPTIONS).toEqual(["openai-completions", "anthropic-messages"]);
    for (const cur of ["", " openai-completions "]) {
      expect(apiOptionsFor(cur)).toEqual(["openai-completions", "anthropic-messages"]);
    }
    expect(apiOptionsFor("anthropic-messages")).toEqual(["openai-completions", "anthropic-messages"]);
    expect(apiOptionsFor("google-vertex")).toEqual(["openai-completions", "anthropic-messages", "google-vertex"]);
  });
});

describe("isDuplicateProviderId", () => {
  const ids = ["a", "b"];
  it("新建撞已有 / 编辑改名撞别人算冲突；保留原名或改回原名不算", () => {
    expect(isDuplicateProviderId(form({ id: "a" }), ids)).toBe(true);
    expect(isDuplicateProviderId(form({ id: "c" }), ids)).toBe(false);
    expect(isDuplicateProviderId(form({ id: "" }), ids)).toBe(false);
    expect(isDuplicateProviderId({ ...form({ id: "b" }), originalId: "a" }, ids)).toBe(true);
    expect(isDuplicateProviderId({ ...form({ id: "a" }), originalId: "a" }, ids)).toBe(false);
  });
});
