import { isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from "yaml";

/**
 * 自定义模型接入（`<agentDir>/models.yml`）的数据层：**保真编辑** omp 的用户级
 * 自定义供应商 / 模型配置。
 *
 * omp 支持在 `models.yml` 里声明自定义供应商（`baseUrl` + `apiKey` + `api` + `models`），
 * 或对内置供应商做覆盖（`baseUrl` / `headers` / `modelOverrides`…）。上游**没有 CLI 写入口**
 * （`omp models` 只有 ls / find / refresh），写文件是唯一路径——本文件负责把用户的 YAML 文本
 * 变成可编辑的表单模型，再原子地改回去。
 *
 * **保真三原则**（npm `yaml` 包的 Document API，实测零修改往返逐字节一致）：
 * 1. 只改被编辑的节点：未触碰的键、注释、格式原样保留（`toString({ flowCollectionPadding: false,
 *    lineWidth: 0 })`——默认选项会把 `[text, image]` 重排成 `[ text, image ]`，必须关掉）；
 * 2. 界面不管理的键（provider 级 `headers` / `compat` / `discovery` / `modelOverrides`…，
 *    model 级 `cost` / `tokenizer`…）**原样保留**——它们只被展示为「其它字段」，绝不被编辑抹掉；
 * 3. 覆盖型供应商（没有 `models` 列表，只覆盖内置供应商）在界面上**只读**：界面无法完整表达
 *    那些覆盖语义，编辑它等于丢字段。
 *
 * 写入的最后一公里（预校验 / 备份 / 原子写 / 乐观锁）在后端 `src-tauri/src/models_config.rs`。
 */

/** 界面提供的接口类型（两档，覆盖绝大多数自建端点）：`openai-completions` = OpenAI 兼容
 *  （/chat/completions，网关与本地推理引擎的通用协议）、`anthropic-messages` = Claude 的
 *  Messages 协议。omp 的 schema 还认其它 wire API（`omp://models.md` 的允许值），但界面
 *  不再列出——既有文件里写了别的值也不受影响：`apiOptionsFor` 把当前值一并列出，保存原样写回。 */
export const API_OPTIONS = ["openai-completions", "anthropic-messages"] as const;

/** 接口类型下拉的候选：两档 + 当前值（属于界面之外的档时原样保留，保证不改动也能保存）。 */
export function apiOptionsFor(current: string): string[] {
 const v = current.trim();
 return v && !(API_OPTIONS as readonly string[]).includes(v) ? [...API_OPTIONS, v] : [...API_OPTIONS];
}

/** 界面管理的 provider 级键；其余键一律原样保留。 */
const MANAGED_PROVIDER_KEYS = new Set(["baseUrl", "api", "apiKey", "auth", "models"]);

/** 一个模型条目的表单值（数字用字符串承载，空串 = 不写该字段）。 */
export type CustomModelForm = {
 id: string;
 /** 编辑前的模型位置；删除、改名或交换 id 后仍复用各自原节点。 */
 originalIndex?: number;
 name: string;
 contextWindow: string;
 maxTokens: string;
 reasoning: boolean;
 /** 保留文件里的所有模态；界面只切换 text / image。 */
 input: string[];
};

/** 一个自定义供应商的表单值。 */
export type CustomProviderForm = {
 id: string;
 /** 编辑态 = 该块在 `providers` 里的**原键名**（新建时为 undefined）。用户改了 `id` 时，
  *  `upsertProvider` 依据它把 YAML 键就地改名；相等则只是普通更新。 */
 originalId?: string;
 baseUrl: string;
 api: string;
 /** 空串 = 无需鉴权（`auth: none`）；否则写 `apiKey`（环境变量名 / 字面量 / `!命令`，原样透传）。 */
 apiKey: string;
 models: CustomModelForm[];
};

/** 解析出的供应商条目（列表展示用）。 */
export type CustomProviderView = {
 id: string;
 /** `custom` = 有 models 列表（界面可编辑）；`override` = 覆盖型（界面只读，手工维护）。 */
 kind: "custom" | "override";
 baseUrl: string | null;
 api: string | null;
 /** `auth: none`（无需鉴权）。 */
 authNone: boolean;
 /** 是否写了 `apiKey`（值不回显——可能是密钥）。 */
 hasApiKey: boolean;
 modelCount: number;
 /** 界面不管理的键（编辑时保留；列出来让用户知道界面之外还有什么）。 */
 extraKeys: string[];
};

/** YAML 解析失败（库的英文消息原样透传——属于上游数据）。 */
export type ParseError = { kind: "yaml"; message: string } | { kind: "shape" };

export type ModelsConfigParse = {
 providers: CustomProviderView[];
 error: ParseError | null;
};

/** 编辑结果：成功给新文本，失败给原因（解析不了就拒绝编辑，绝不覆盖）。 */
export type EditResult = { ok: true; text: string } | { ok: false; error: string };

// ---------- 解析 ----------

function readDoc(text: string): { doc: Document } | { error: string } {
 try {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { error: doc.errors[0].message };
  return { doc };
 } catch (e) {
  return { error: e instanceof Error ? e.message : String(e) };
 }
}

function str(n: unknown): string {
 if (n == null) return "";
 if (typeof n === "object" && "value" in n) {
  const v = n.value;
  return v == null ? "" : String(v);
 }
 return String(n);
}

function boolOf(n: unknown): boolean {
 if (typeof n === "object" && n !== null && "value" in n) return n.value === true;
 return n === true;
}

/** `createNode({})` 的类型收窄（yaml 的 `NodeType<T>` 条件类型在调用处不精确）。 */
function newMap(doc: Document): YAMLMap {
 const node = doc.createNode({});
 if (!isMap(node)) throw new Error("yaml: createNode({}) 未返回 map");
 return node;
}

/** `createNode([])` 的类型收窄。 */
function newSeq(doc: Document): YAMLSeq {
 const node = doc.createNode([]);
 if (!isSeq(node)) throw new Error("yaml: createNode([]) 未返回 seq");
 return node;
}

function invalidShape(doc: Document): boolean {
 if (doc.contents == null) return false;
 if (!isMap(doc.contents)) return true;
 return doc.has("providers") && !isMap(doc.get("providers", true));
}

function editableModels(node: unknown): node is YAMLSeq<YAMLMap> {
 return isSeq(node) && node.items.length > 0 && node.items.every(isMap);
}

/** 解析当前文本里的全部供应商（含只读的覆盖型）。 */
export function parseModelsConfig(text: string): ModelsConfigParse {
 const parsed = readDoc(text);
 if ("error" in parsed) return { providers: [], error: { kind: "yaml", message: parsed.error } };
 if (invalidShape(parsed.doc)) return { providers: [], error: { kind: "shape" } };
 const providersNode = parsed.doc.get("providers", true);
 if (providersNode == null) return { providers: [], error: null };
 if (!isMap(providersNode)) return { providers: [], error: { kind: "shape" } };

 const providers: CustomProviderView[] = [];
 for (const item of providersNode.items) {
  const id = str(item.key);
  if (!id) continue;
  const value = item.value;
  const empty: CustomProviderView = {
   id,
   kind: "override",
   baseUrl: null,
   api: null,
   authNone: false,
   hasApiKey: false,
   modelCount: 0,
   extraKeys: [],
  };
  if (!isMap(value)) {
   providers.push(empty);
   continue;
  }
  const modelsNode = value.get("models", true);
  const modelCount = isSeq(modelsNode) ? modelsNode.items.length : 0;
  if (modelCount > 0 && !editableModels(modelsNode)) return { providers: [], error: { kind: "shape" } };
  const extraKeys = value.items
   .map((i) => str(i.key))
   .filter((k) => k && !MANAGED_PROVIDER_KEYS.has(k));
  providers.push({
   id,
   kind: modelCount > 0 ? "custom" : "override",
   baseUrl: str(value.get("baseUrl", true)) || null,
   api: str(value.get("api", true)) || null,
   authNone: str(value.get("auth", true)) === "none",
   hasApiKey: str(value.get("apiKey", true)) !== "",
   modelCount,
   extraKeys,
  });
 }
 return { providers, error: null };
}

// ---------- 表单初值 ----------

function emptyModel(): CustomModelForm {
 return { id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false, input: ["text"] };
}

/** 新供应商的空白表单。 */
export function emptyProviderForm(): CustomProviderForm {
 return { id: "", baseUrl: "", api: API_OPTIONS[0], apiKey: "", models: [emptyModel()] };
}

function modelFormOf(m: YAMLMap, originalIndex?: number): CustomModelForm {
 const inputNode = m.get("input", true);
 const input = isSeq(inputNode) ? inputNode.items.map((i) => str(i)) : ["text"];
 return {
  id: str(m.get("id", true)),
  originalIndex,
  name: str(m.get("name", true)),
  contextWindow: str(m.get("contextWindow", true)),
  maxTokens: str(m.get("maxTokens", true)),
  reasoning: boolOf(m.get("reasoning", true)),
  input,
 };
}

/** 读某个供应商的编辑表单；不存在（或块不是对象）时返回 null。 */
export function providerFormOf(text: string, id: string): CustomProviderForm | null {
 const parsed = readDoc(text);
 if ("error" in parsed || invalidShape(parsed.doc)) return null;
 const node = parsed.doc.getIn(["providers", id], true);
 if (!isMap(node)) return null;
 const modelsNode = node.get("models", true);
 if (!editableModels(modelsNode)) return null;
 return {
  id,
  originalId: id,
  baseUrl: str(node.get("baseUrl", true)),
  api: str(node.get("api", true)) || API_OPTIONS[0],
  apiKey: str(node.get("apiKey", true)),
  models: modelsNode.items.map((m, i) => modelFormOf(m, i)),
 };
}

// ---------- 校验 ----------

/** 供应商 id（= `providers` 下的键名，也是模型 selector 的前缀，omp 侧没有单独的显示名字段）。
 *  omp 本身没有字符集约束——实测中文键照常收录（`云渡中转/gpt-6-astra` 出现在 `omp models` 里、
 *  stderr 干净），所以这里只挡「写进 YAML 键名 / selector 会歧义」的字符：空白、`/` `:` `#` 引号等。
 *  Unicode 字母 / 数字（中文、日文…）与 `.` `_` `-` 都放行。 */
export function isValidProviderId(id: string): boolean {
 return /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id);
}

export function isValidBaseUrl(value: string): boolean {
 const trimmed = value.trim();
 if (!/^https?:\/\//i.test(trimmed)) return false;
 try {
  const url = new URL(trimmed);
  return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
 } catch {
  return false;
 }
}

/** 正整数（空串 = 不填，返回 null；非法返回 undefined）。 */
function positiveInt(raw: string): number | null | undefined {
 const t = raw.trim();
 if (!t) return null;
 if (!/^\d+$/.test(t)) return undefined;
 const n = Number(t);
 return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function isValidModelLimit(value: string): boolean {
 return positiveInt(value) !== undefined;
}

/** 模型表单是否完整（id 必填；数字字段要么空、要么正整数）。 */
export function modelFormComplete(m: CustomModelForm): boolean {
 return (
  m.id.trim() !== "" &&
  isValidModelLimit(m.contextWindow) &&
  isValidModelLimit(m.maxTokens)
 );
}

/** 供应商表单是否可保存（id / baseUrl / api 必填；至少一个完整模型）。 */
export function providerFormComplete(f: CustomProviderForm): boolean {
 return (
  isValidProviderId(f.id.trim()) &&
  isValidBaseUrl(f.baseUrl) &&
  f.api.trim() !== "" &&
  f.models.length > 0 &&
  new Set(f.models.map((m) => m.id.trim())).size === f.models.length &&
  f.models.every(modelFormComplete)
 );
}

/** id 是否与**别的**块冲突（新建撞任何已有 id / 编辑改名撞别人 = 冲突；编辑保留原名不算）。 */
export function isDuplicateProviderId(f: CustomProviderForm, existingIds: string[]): boolean {
 const id = f.id.trim();
 if (!id || id === (f.originalId ?? "").trim()) return false;
 return existingIds.includes(id);
}

// ---------- 保真编辑 ----------

/** 序列化：关掉流式集合补白与行宽折行，保证「未触碰的字节零变化」。 */
function serialize(doc: Document): string {
 return doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
}

function ensureProviders(doc: Document): YAMLMap {
 // `get(key, true)` 的重载返回 `Scalar | undefined`——先按 unknown 收窄再判断
 const current: unknown = doc.get("providers", true);
 if (isMap(current)) return current;
 const fresh = newMap(doc);
 doc.set("providers", fresh);
 return fresh;
}

function setField(doc: Document, node: YAMLMap, key: string, value: string | number | boolean | string[] | null): void {
 if (value === null) {
  node.delete(key);
  return;
 }
 node.set(key, Array.isArray(value) ? doc.createNode(value, { flow: true }) : value);
}

function applyModelForm(doc: Document, node: YAMLMap, f: CustomModelForm): void {
 const previous = modelFormOf(node);
 if (f.id !== previous.id) setField(doc, node, "id", f.id.trim());
 if (f.name !== previous.name) setField(doc, node, "name", f.name.trim() || null);
 if (f.contextWindow !== previous.contextWindow) setField(doc, node, "contextWindow", positiveInt(f.contextWindow) ?? null);
 if (f.maxTokens !== previous.maxTokens) setField(doc, node, "maxTokens", positiveInt(f.maxTokens) ?? null);
 // 未改动的显式 false / 默认模态也原样保留；用户关闭推理时仍交给 omp 默认。
 if (f.reasoning !== previous.reasoning) setField(doc, node, "reasoning", f.reasoning ? true : null);
 if (f.input.length !== previous.input.length || f.input.some((v, i) => v !== previous.input[i])) {
  const isDefault = f.input.length === 0 || (f.input.length === 1 && f.input[0] === "text");
  setField(doc, node, "input", isDefault ? null : f.input);
 }
}

/** 按原位置复用模型节点；新条目不继承已删除同名模型的隐藏字段。 */
function buildModelsSeq(doc: Document, current: unknown, forms: CustomModelForm[]): YAMLSeq {
 const seq = isSeq(current) ? current : newSeq(doc);
 const originalItems = seq.items;
 seq.items = forms.map((f) => {
  const original = f.originalIndex !== undefined ? originalItems[f.originalIndex] : undefined;
  const node = isMap(original) ? original : newMap(doc);
  applyModelForm(doc, node, f);
  return node;
 });
 return seq;
}

/**
 * 新增 / 更新一个自定义供应商（返回新文本，原文本不动）。
 * 已有块里界面不管理的键与模型级字段原样保留；`apiKey` 与 `auth: none` 互斥。
 * 表单带 `originalId` 且与 `id` 不同 = **改名**：YAML 键就地替换（块的位置与键上的注释保留）。
 * 新建撞名、改名撞名或原节点已消失时拒绝编辑，绝不覆盖别的块。
 */
export function upsertProvider(text: string, form: CustomProviderForm): EditResult {
 const parsed = readDoc(text);
 if ("error" in parsed) return { ok: false, error: parsed.error };
 if (invalidShape(parsed.doc)) return { ok: false, error: "Invalid models config structure" };
 if (!providerFormComplete(form)) return { ok: false, error: "Incomplete or duplicate model fields" };
 const doc = parsed.doc;
 const providers = ensureProviders(doc);

 const id = form.id.trim();
 const from = (form.originalId ?? "").trim();
 if (id !== from && providers.has(id)) return { ok: false, error: "Provider name already exists" };
 const source: unknown = from ? providers.get(from, true) : undefined;
 if (from && (!isMap(source) || !editableModels(source.get("models", true)))) return { ok: false, error: "Provider is missing or read-only" };
 if (from && from !== id) {
  const pair = providers.items.find((p) => str(p.key) === from);
  if (pair && isScalar(pair.key)) pair.key.value = id;
 }
 const current: unknown = providers.get(id, true);
 let node: YAMLMap;
 if (isMap(current)) {
  node = current;
 } else {
  node = newMap(doc);
  providers.set(id, node);
 }

 if (form.baseUrl !== str(node.get("baseUrl", true))) setField(doc, node, "baseUrl", form.baseUrl.trim() || null);
 if (form.api !== (str(node.get("api", true)) || API_OPTIONS[0]) || !from) setField(doc, node, "api", form.api.trim() || null);
 if (form.apiKey !== str(node.get("apiKey", true)) || !from) {
  const apiKey = form.apiKey.trim();
  if (apiKey) {
   setField(doc, node, "apiKey", apiKey);
   if (str(node.get("auth", true)) === "none") node.delete("auth");
  } else {
   node.delete("apiKey");
   setField(doc, node, "auth", "none");
  }
 }
 node.set("models", buildModelsSeq(doc, node.get("models", true), form.models));
 return { ok: true, text: serialize(doc) };
}

/** 删除一个供应商块（其余内容与注释原样保留）。 */
export function removeProvider(text: string, id: string): EditResult {
 const parsed = readDoc(text);
 if ("error" in parsed) return { ok: false, error: parsed.error };
 if (invalidShape(parsed.doc)) return { ok: false, error: "Invalid models config structure" };
 const doc = parsed.doc;
 const providers = doc.get("providers", true);
 if (!isMap(providers)) return { ok: true, text };
 const current: unknown = providers.get(id, true);
 if (providers.has(id) && (!isMap(current) || !editableModels(current.get("models", true)))) return { ok: false, error: "Provider is read-only" };
 providers.delete(id);
 return { ok: true, text: serialize(doc) };
}
