import type { ModelInfo } from "@shared/types";

/**
 * **我的模型**（本应用偏好，omp 无此概念）：localStorage 里的 selector 数组，按挑选顺序。
 * selector = `ModelInfo.selector`（`provider/id`，与 omp 角色值同格式），整串存取不拆分——
 * 模型的 id 里可能出现 `/`（如 `commandcode/meta/muse-spark-…`）。
 *
 * 作用域（V12b 的「小范围」口径）：**只在壳侧**——挑过之后，本应用所有模型选择器
 * （模型角色 / 失败转移目标）的候选只列这些；一个都没挑时退回全部可用模型（不挡新人）。
 * **不写 omp 的 `enabledModels`**：omp 终端里 `/model` 的可选范围不受影响。
 *
 * 存储键沿用旧版「常用模型」的 `omp.favoriteModels.v1`——升级不丢已挑的模型。
 */
const KEY = "omp.favoriteModels.v1";

/** 坏数据一律丢弃：非数组 → []；非字符串 / 空白项跳过；去重保首现顺序；字符串去首尾空白。 */
export function normalizeMyModels(raw: unknown): string[] {
 if (!Array.isArray(raw)) return [];
 const out: string[] = [];
 for (const x of raw) {
  if (typeof x !== "string") continue;
  const s = x.trim();
  if (!s || out.includes(s)) continue;
  out.push(s);
 }
 return out;
}

export function loadMyModels(): string[] {
 try {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(KEY);
  return raw ? normalizeMyModels(JSON.parse(raw)) : [];
 } catch {
  return []; // 坏 JSON / 无痕模式一律当没配过
 }
}

export function saveMyModels(list: string[]): void {
 try {
  localStorage.setItem(KEY, JSON.stringify(list));
 } catch {
  // 写失败不阻断本次操作（与 setSidebarWidth 同口径）
 }
}

/** 勾选开关：已存在则移除（其余项顺序不变），否则追加到末尾。 */
export function toggleMyModel(list: string[], selector: string): string[] {
 return list.includes(selector) ? list.filter((s) => s !== selector) : [...list, selector];
}

/** 批量加入（保序、去重；已存在的保持原位）。供应商「全选」用。 */
export function addManyMyModels(list: string[], selectors: string[]): string[] {
 const set = new Set(list);
 const out = [...list];
 for (const s of selectors) {
  if (!set.has(s)) {
   set.add(s);
   out.push(s);
  }
 }
 return out;
}

/** 批量移除。供应商「清空」用。 */
export function removeManyMyModels(list: string[], selectors: string[]): string[] {
 const drop = new Set(selectors);
 return list.filter((s) => !drop.has(s));
}

/** 某个供应商当前在目录里的全部 selector（挑选面板的全选 / 清空 / 计数用）。 */
export function providerSelectors(catalog: ModelInfo[], provider: string): string[] {
 return catalog.filter((m) => m.provider === provider).map((m) => m.selector);
}

/** 按存储顺序解析成 `{selector, model}`；目录里没有的模型 `model: null`（设置页要照样列出来给人清理）。 */
export function myModelEntries(
 list: string[],
 catalog: ModelInfo[],
): { selector: string; model: ModelInfo | null }[] {
 const bySelector = new Map(catalog.map((m) => [m.selector, m]));
 return list.map((selector) => ({ selector, model: bySelector.get(selector) ?? null }));
}

/**
 * 模型选择器的候选集（**「小范围」的唯一实现点**）：
 * 我的模型非空 → 只留挑过的（按目录顺序，目录里没有的自动缺席）；
 * 空 → 全部可用模型（没挑过就不设限，避免新人打不开选择器）。
 */
export function candidateModels(catalog: ModelInfo[], myModels: string[]): ModelInfo[] {
 if (myModels.length === 0) return catalog;
 const wanted = new Set(myModels);
 return catalog.filter((m) => wanted.has(m.selector));
}
