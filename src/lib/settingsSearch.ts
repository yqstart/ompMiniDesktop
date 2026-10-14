import { api } from "@shared/api";
import type { MemoryProjectView, ModelCatalog, OmpSettingsCatalog, PluginsView, SessionView, SkillsView } from "@shared/types";
import { filterCatalog, SETTING_KIND_KEYS } from "./allSettings";
import type { Locale, Text } from "./locale";
import { OMP_SETTING_NAMES } from "./ompSettingNames";
import { SETTINGS_LIST_SET } from "./settingsList";
import type { SettingsTab } from "./settingsTabs";

/**
 * 设置视图顶部搜索（v3）的数据层：**跨条目的纯前端过滤**——不引入后端全文索引，
 * 只过滤「本应用已加载的数据」（常用设置 117 项展示清单 / 模型目录 / 插件 / 技能 /
 * 记忆 / 归档会话）。目录数据与各面板各自的加载互不影响（这里另走一份**设置视图级缓存**，
 * 关闭设置视图时整体作废，见 `clearSettingsSearchCache`）。
 *
 * - 常用设置沿用四档打分（键前缀 > 键子串 > 名称 > 描述，`filterCatalog`）；
 * - 其余条目按主文本 + 副文本大小写不敏感子串匹配，截断到有限条数（搜索是定位入口，不是清单）；
 * - 纯函数 + 独立缓存，可单测（见 `settingsSearch.test.ts`）。
 */

export type SettingsSearchSources = {
 catalog: OmpSettingsCatalog | null;
 models: ModelCatalog | null;
 plugins: PluginsView | null;
 skills: SkillsView | null;
 memories: MemoryProjectView[] | null;
 archived: SessionView[] | null;
};

/** 源键 → 该源的加载函数（组件按需并行触发；模型目录优先走 store，兜底才用它）。 */
export const SETTINGS_SEARCH_SOURCE_KEYS = ["catalog", "models", "plugins", "skills", "memories", "archived"] as const;
export type SettingsSearchSourceKey = (typeof SETTINGS_SEARCH_SOURCE_KEYS)[number];

/** 一条搜索命中：`tab` = 目标条目，`focusKey` 非空时跳转后定位到该行（仅常用设置项）。 */
export type SettingsSearchHit = {
 id: string;
 tab: SettingsTab;
 focusKey: string | null;
 title: string;
 sub: string;
};

export type SettingsSearchGroup = { tab: SettingsTab; hits: SettingsSearchHit[] };

/** 每源最多展示的命中数（列表长就失去定位意义）。 */
const GENERAL_LIMIT = 25;
const OTHER_LIMIT = 15;
const DESCRIPTION_MAX = 96;

const cut = (text: string) => (text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX)}…` : text);

/** 大小写不敏感子串。 */
const has = (text: string, query: string) => text.toLowerCase().includes(query);

/** 模块级缓存（设置视图开启期间有效；`clearSettingsSearchCache` 在视图卸载时清）。 */
const cache = new Map<SettingsSearchSourceKey, Promise<unknown>>();

function cached<T>(key: SettingsSearchSourceKey, load: () => Promise<T>): Promise<T> {
 const hit = cache.get(key) as Promise<T> | undefined;
 if (hit) return hit;
 const promise = load().catch((error: unknown) => {
  // 失败不缓存失败态——下一次打开搜索允许重试
  cache.delete(key);
  throw error;
 });
 cache.set(key, promise);
 return promise;
}

/** 取某个源（缓存 + 单飞）。 */
export function loadSettingsSearchSource(key: "catalog"): Promise<OmpSettingsCatalog>;
export function loadSettingsSearchSource(key: "models"): Promise<ModelCatalog>;
export function loadSettingsSearchSource(key: "plugins"): Promise<PluginsView>;
export function loadSettingsSearchSource(key: "skills"): Promise<SkillsView>;
export function loadSettingsSearchSource(key: "memories"): Promise<MemoryProjectView[]>;
export function loadSettingsSearchSource(key: "archived"): Promise<SessionView[]>;
export function loadSettingsSearchSource(key: SettingsSearchSourceKey): Promise<unknown> {
 switch (key) {
  case "catalog":
   return cached(key, () => api.getOmpSettingsCatalog());
  case "models":
   return cached(key, () => api.getModels());
  case "plugins":
   return cached(key, () => api.listPlugins(null));
  case "skills":
   return cached(key, () => api.listSkills(null));
  case "memories":
   return cached(key, () => api.listMemories());
  case "archived":
   return cached(key, () => api.listArchivedSessions());
 }
}

/** 关闭设置视图时整体作废（下次进入设置重新取——搜索定位的清单不该跨次陈旧）。 */
export function clearSettingsSearchCache(): void {
 cache.clear();
}

/** 设置搜索的从数据到结果（纯函数；`nameOf` 等展示口径与常用设置页保持一致）。 */
export function searchSettings(
 sources: SettingsSearchSources,
 query: string,
 t: Text,
 locale: Locale,
): SettingsSearchGroup[] {
 const q = query.trim().toLowerCase();
 if (!q) return [];
 const nameOf = (key: string): string | null => {
  const pair = OMP_SETTING_NAMES[key];
  return pair ? pair[locale === "zh-CN" ? 0 : 1] : null;
 };
 const kindLabel = (kind: string): string => {
  const key = SETTING_KIND_KEYS[kind];
  return key ? t[key] : kind;
 };
 const groups: SettingsSearchGroup[] = [];

 // 常用设置：展示清单（117 项）内做四档打分
 if (sources.catalog) {
  const items = sources.catalog.items.filter((item) => SETTINGS_LIST_SET.has(item.key));
  const ranked = filterCatalog(items, q, nameOf).slice(0, GENERAL_LIMIT);
  if (ranked.length > 0) {
   groups.push({
    tab: "general",
    hits: ranked.map((item) => ({
     id: `general:${item.key}`,
     tab: "general",
     focusKey: item.key,
     title: nameOf(item.key) ?? item.key,
     sub: `${item.key} · ${kindLabel(item.kind)}`,
    })),
   });
  }
 }

 // 模型目录
 if (sources.models) {
  const hits = sources.models.models
   .filter((m) => has(m.name, q) || has(m.selector, q))
   .slice(0, OTHER_LIMIT)
   .map<SettingsSearchHit>((m) => ({
    id: `models:${m.selector}`,
    tab: "models",
    focusKey: null,
    title: m.name,
    sub: m.selector,
   }));
  if (hits.length > 0) groups.push({ tab: "models", hits });
 }

 // 插件（已装 + 市场条目）
 if (sources.plugins) {
  const installed = sources.plugins.npm
   .filter((p) => has(p.name, q) || has(p.description, q))
   .slice(0, OTHER_LIMIT)
   .map<SettingsSearchHit>((p) => ({
    id: `plugins:${p.name}`,
    tab: "plugins",
    focusKey: null,
    title: p.name,
    sub: cut(p.description),
   }));
  const market = sources.plugins.marketplace
   .filter((p) => has(p.id, q))
   .slice(0, OTHER_LIMIT)
   .map<SettingsSearchHit>((p) => ({
    id: `plugins:${p.id}`,
    tab: "plugins",
    focusKey: null,
    title: p.id,
    sub: `v${p.version}`,
   }));
  const hits = [...installed, ...market].slice(0, OTHER_LIMIT + 8);
  if (hits.length > 0) groups.push({ tab: "plugins", hits });
 }

 // 技能（已发现 + 已停用名单）
 if (sources.skills) {
  const active = sources.skills.skills
   .filter((s) => has(s.name, q) || has(s.description, q))
   .slice(0, OTHER_LIMIT)
   .map<SettingsSearchHit>((s) => ({
    id: `skills:${s.name}`,
    tab: "skills",
    focusKey: null,
    title: s.name,
    sub: cut(s.description),
   }));
  const disabled = sources.skills.disabled
   .filter((name) => has(name, q))
   .slice(0, 8)
   .map<SettingsSearchHit>((name) => ({
    id: `skills:off:${name}`,
    tab: "skills",
    focusKey: null,
    title: name,
    sub: "",
   }));
  const hits = [...active, ...disabled];
  if (hits.length > 0) groups.push({ tab: "skills", hits });
 }

 // 记忆文件（文件名或项目名命中）
 if (sources.memories) {
  const hits: SettingsSearchHit[] = [];
  for (const project of sources.memories) {
   if (hits.length >= OTHER_LIMIT) break;
   const projectHit = has(project.name, q);
   for (const file of project.files) {
    if (hits.length >= OTHER_LIMIT) break;
    const name = file.path.split("/").pop() ?? file.path;
    if (!projectHit && !has(name, q)) continue;
    hits.push({
     id: `memories:${project.dir}:${file.path}`,
     tab: "memories",
     focusKey: null,
     title: name,
     sub: project.name,
    });
   }
  }
  if (hits.length > 0) groups.push({ tab: "memories", hits });
 }

 // 归档会话
 if (sources.archived) {
  const hits = sources.archived
   .filter((s) => has(s.title, q))
   .slice(0, OTHER_LIMIT)
   .map<SettingsSearchHit>((s) => ({
    id: `archived:${s.id}`,
    tab: "archived",
    focusKey: null,
    title: s.title,
    sub: "",
   }));
  if (hits.length > 0) groups.push({ tab: "archived", hits });
 }

 return groups;
}
