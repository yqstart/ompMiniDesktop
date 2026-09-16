import type { ModelInfo } from "@shared/types";

/**
 * 常用模型（本应用偏好，omp 无此概念）：localStorage 里的 selector 数组，按挑选顺序。
 * selector = `ModelInfo.selector`（`provider/id`，与输入框 currentModel、omp 角色值同格式），
 * 整串存取不拆分——模型的 id 里可能出现 `/`（如 `commandcode/meta/muse-spark-…`）。
 */
const KEY = "omp.favoriteModels.v1";

/** 坏数据一律丢弃：非数组 → []；非字符串 / 空白项跳过；去重保首现顺序；字符串去首尾空白。 */
export function normalizeFavorites(raw: unknown): string[] {
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

export function loadFavorites(): string[] {
 try {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(KEY);
  return raw ? normalizeFavorites(JSON.parse(raw)) : [];
 } catch {
  return []; // 坏 JSON / 无痕模式一律当没配过
 }
}

export function saveFavorites(list: string[]): void {
 try {
  localStorage.setItem(KEY, JSON.stringify(list));
 } catch {
  // 写失败不阻断本次操作（与 setSidebarWidth 同口径）
 }
}

/** 星标开关：已存在则移除（其余项顺序不变），否则追加到末尾。 */
export function toggleFavorite(list: string[], selector: string): string[] {
 return list.includes(selector) ? list.filter((s) => s !== selector) : [...list, selector];
}

/** 按存储顺序解析成 `{selector, model}`；目录里没有的模型 `model: null`（设置页要照样列出来给人清理）。 */
export function favoriteEntries(
 list: string[],
 catalog: ModelInfo[],
): { selector: string; model: ModelInfo | null }[] {
 return list.map((selector) => ({
  selector,
  model: catalog.find((m) => m.selector === selector) ?? null,
 }));
}
