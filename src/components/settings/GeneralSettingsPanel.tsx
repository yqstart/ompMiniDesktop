import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader, Refresh, Settings2, Undo } from "reicon-react";
import { api } from "@shared/api";
import type { OmpCatalogItem, OmpSetting, OmpSettingsCatalog } from "@shared/types";
import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { OMP_SETTING_NAMES } from "../../lib/ompSettingNames";
import { fmt } from "../../lib/locale";
import { EnumSelect } from "./EnumSelect";
import { Switch } from "./Switch";
import {
 SECTION_LABEL_KEYS,
 SETTING_KIND_KEYS,
 choiceOptions,
 filterCatalog,
 groupCatalog,
 jsonDraftFrom,
 jsonPreview,
 parseJsonDraft,
 type JsonDraftError,
 parseNumberDraft,
} from "../../lib/allSettings";
import { SETTINGS_LIST_SET, SETTING_NOTES, SETTING_SECTION_OVERRIDES } from "../../lib/settingsList";

/**
 * 设置 ›「常用设置」：omp 全局配置（`config.yml`）的**唯一设置面**——分组、搜索与六种类型的
 * 编辑器（开关 / 枚举 / 数字 / 文本 / 数组 / 记录）。数据来自后端 `get_omp_settings_catalog`
 * （`omp config list` 文本 + JSON 两路合并，见 `src-tauri/src/settings.rs`），再按
 * `lib/settingsList.ts` 的展示清单（117 项：原常用 42 项 + 精选剩余 75 项）过滤——
 * **不铺上游全量**（519 项里内部 / 细调占大头，要浏览完整清单在终端里 `omp config list`）。
 * 写入走 `set_omp_setting` / `reset_omp_setting`（omp 全局配置、写完回读，与旧「常用设置」
 * 面板同一套命令）。
 *
 * 界面上守住的几条：
 * - **不摆假值**：拿不到读数就显示错误条，不画一个默认态；
 * - **说明文字是上游英文**（`description`，omp 对这条设置的定义）——挂在行的 `title` 上；
 * - 写完**回读**（后端返回的就是真相）；
 * - **未设置**（上游没有显式值）与**脱敏**（令牌类键被上游隐藏）分开表达：后者不提供编辑器
 *   （值读不到，改就等于盲写覆盖），只留「恢复默认」；提示去终端里 `omp config set`
 *   （当前清单里已无脱敏键，此路径为防御性保留）；
 * - **行内标注**（`SETTING_NOTES`）：`仅 TUI 生效`（plan / goal 功能总闸）/ 值为 `-1` 时的
 *   「-1 = 默认」（temperature / compaction.thresholdPercent）；
 * - 分组默认展开（可见性优先，折叠是用户的选择）；搜索时忽略折叠态、按匹配度重排分组；
 * - 枚举下拉的选项 label 走 `OPTION_LABELS`（普通词翻界面语言、专有名词与档位名原样；多个键共享公共取值键）；
 *   **string 但取值有限的键**（`theme.dark` / `theme.light` / `composer.shape`，上游 `ui.options: "runtime"`）
 *   同样渲染下拉——主题列表来自后端 `list_omp_themes`（内置 102 个 ∪ `<agentDir>/themes` 自定义），
 *   形态表是壳侧内置八项；当前值不在表里时原样补一条，空表退化成文本输入框；
 * - array / record 走 JSON 文本编辑（**本地先解析校验**，不合法根本不发请求）——当前清单没有
 *   此类键，此路径是渲染器按上游 schema 类型分派的通用能力。
 */
export function GeneralSettingsPanel() {
 const t = useText();
 const locale = useApp((s) => s.locale);
 const health = useApp((s) => s.health);
 const [catalog, setCatalog] = useState<OmpSettingsCatalog | null>(null);
 /** 主题下拉的运行时列表（后端 `list_omp_themes`：内置 ∪ `<agentDir>/themes`）；失败 = 空表。 */
 const [themeNames, setThemeNames] = useState<readonly string[]>([]);
 /** 首次读取失败（保持 null，不显示伪设置行）。 */
 const [loadError, setLoadError] = useState<string | null>(null);
 /** 刷新失败但有旧数据（保留快照，只提示结果可能过期）。 */
 const [staleError, setStaleError] = useState<string | null>(null);
 /** 写入 / 恢复默认的失败（乐观值已回滚）。 */
 const [err, setErr] = useState<string | null>(null);
 const [refreshing, setRefreshing] = useState(false);
 /** 正在写入 / 恢复默认的键：那一行的控件在落地前不接第二次点击（同键连点会竞态）。 */
 const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
 /** 搜索（键 / 上游说明；不扩张配置范围）。 */
 const [query, setQuery] = useState("");
 /** 折叠的分组（**默认全部展开**——与常用设置同款：可见性优先，折叠是用户的选择）。 */
 const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(new Set());
 /** 行内输入框的编辑草稿（数字 / 文本；提交前不写 omp）。 */
 const [drafts, setDrafts] = useState<Record<string, string>>({});
 /** 打开中的 JSON 编辑器：key → 草稿文本（只对 array / record）。 */
 const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
 /** JSON 编辑器的本地校验错误：key → 文案（不发请求）。 */
 const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

 const load = useCallback(() => {
  // 主题下拉的运行时列表与目录并行拉；失败静默（那一行退化成「只有当前值」的下拉）
  void api
   .listOmpThemes()
   .then(setThemeNames)
   .catch(() => setThemeNames([]));
  return api
   .getOmpSettingsCatalog()
   .then((c) => {
    setCatalog(c);
    setLoadError(null);
    setStaleError(null);
    setErr(null);
    // 目录换了（刷新 / omp 升级）：打开中的编辑器与旧草稿一起作废，不给陈旧值续命
    setJsonDrafts({});
    setJsonErrors({});
    setDrafts({});
   })
   .catch((e: unknown) => {
    const message = e instanceof Error ? e.message : t.ompSettingsLoadFailed;
    setCatalog((prev) => {
     if (!prev) setLoadError(message);
     else setStaleError(message);
     return prev;
    });
   });
 }, [t.ompSettingsLoadFailed]);

 useEffect(() => {
  void load();
 }, [load]);

 /** 手动刷新（按钮点击 = 事件处理函数）。 */
 const refresh = () => {
  setRefreshing(true);
  void load().finally(() => setRefreshing(false));
 };

 const jsonErrorMessage = (error: JsonDraftError) =>
  error.reason === "array"
   ? t.allSettingsJsonNeedArray
   : error.reason === "record"
    ? t.allSettingsJsonNeedRecord
    : fmt(t.allSettingsJsonInvalid, error.message ?? "");

 /** 写入 / 恢复默认的公共段：置忙 → 执行 → 回读合并（失败回滚 + 错误条）。 */
 const withBusy = async (
  key: string,
  fn: () => Promise<OmpSetting>,
  rollback?: OmpCatalogItem,
 ): Promise<boolean> => {
  setBusyKeys((prev) => new Set(prev).add(key));
  try {
   const saved = await fn();
   setCatalog((prev) =>
    prev
     ? {
      ...prev,
      items: prev.items.map((i) =>
       i.key === saved.key
        ? {
         ...i,
         value: saved.value,
         kind: saved.kind || i.kind,
         description: saved.description || i.description,
         // 回读走的是 `config get`（不脱敏）——这一行刚被本界面写过，显示的是真相
         redacted: false,
        }
        : i,
      ),
     }
     : prev,
   );
   setErr(null);
   return true;
  } catch (e) {
   if (rollback) {
    setCatalog((prev) =>
     prev ? { ...prev, items: prev.items.map((i) => (i.key === rollback.key ? rollback : i)) } : prev,
    );
   }
   setErr(e instanceof Error ? e.message : t.ompSettingsSaveFailed);
   return false;
  } finally {
   setBusyKeys((prev) => {
    const next = new Set(prev);
    next.delete(key);
    return next;
   });
  }
 };

 /** 写一个键（先乐观改，开关 / 下拉要立刻有反馈；失败由 `withBusy` 复原）。 */
 const save = (key: string, value: unknown): Promise<boolean> => {
  const prev = catalog?.items.find((i) => i.key === key);
  if (!prev) return Promise.resolve(false);
  setCatalog((p) =>
   p ? { ...p, items: p.items.map((i) => (i.key === key ? { ...i, value } : i)) } : p,
  );
  return withBusy(key, () => api.setOmpSetting(key, value), prev);
 };

 const reset = (key: string) => {
  void withBusy(key, () => api.resetOmpSetting(key));
 };

 const forgetDraft = (key: string) => {
  setDrafts((prev) => {
   const next = { ...prev };
   delete next[key];
   return next;
  });
 };

 /** 行内输入框提交（数字 / 文本）：与当前值一致就不打扰 omp。 */
 const commitDraft = (item: OmpCatalogItem) => {
  const raw = drafts[item.key];
  if (raw === undefined) return;
  forgetDraft(item.key);
  if (item.kind === "number") {
   const n = parseNumberDraft(raw);
   if (n === null || item.value === n) return;
   save(item.key, n);
   return;
  }
  const current = typeof item.value === "string" ? item.value : "";
  if (raw === current || (item.value === null && raw === "")) return;
  save(item.key, raw);
 };

 const openJson = (item: OmpCatalogItem) => {
  setJsonDrafts((prev) => ({ ...prev, [item.key]: jsonDraftFrom(item) }));
  setJsonErrors((prev) => {
   const next = { ...prev };
   delete next[item.key];
   return next;
  });
 };

 const closeJson = (key: string) => {
  setJsonDrafts((prev) => {
   const next = { ...prev };
   delete next[key];
   return next;
  });
 };

 /** JSON 编辑器保存：本地先解析 + 形状校验，过了才发请求；失败留在编辑器里给原因。 */
 const saveJson = (item: OmpCatalogItem) => {
  const text = jsonDrafts[item.key];
  if (text === undefined) return;
  const parsed = parseJsonDraft(text, item.kind);
  if (!parsed.ok) {
   setJsonErrors((prev) => ({ ...prev, [item.key]: jsonErrorMessage(parsed.error) }));
   return;
  }
  void save(item.key, parsed.value).then((ok) => {
   if (ok) closeJson(item.key);
  });
 };

 /** 展示清单过滤 + 分组归位：只保留 `settingsList.ts` 的键；两项按 `SETTING_SECTION_OVERRIDES` 归位。 */
 const picked = useMemo(
  () =>
   catalog
    ? {
     sections: catalog.sections,
     items: catalog.items
      .filter((i) => SETTINGS_LIST_SET.has(i.key))
      .map((i) => (SETTING_SECTION_OVERRIDES[i.key] ? { ...i, section: SETTING_SECTION_OVERRIDES[i.key] } : i)),
    }
    : null,
  [catalog],
 );
 const groups = useMemo(() => (picked ? groupCatalog(picked) : []), [picked]);
 const cleanedQuery = query.trim();
 const searching = cleanedQuery.length > 0;

 /** 搜索态：按匹配度全局排序，再按分组切开（组的先后 = 最佳匹配的先后）。 */
 const searchGroups = useMemo(() => {
  if (!picked || !searching) return null;
  const ranked = filterCatalog(picked.items, cleanedQuery, (key) => {
   const pair = OMP_SETTING_NAMES[key];
   return pair ? pair[locale === "zh-CN" ? 0 : 1] : null;
  });
  const bySection = new Map<string, OmpCatalogItem[]>();
  for (const item of ranked) {
   const list = bySection.get(item.section);
   if (list) list.push(item);
   else bySection.set(item.section, [item]);
  }
  return [...bySection.entries()].map(([section, items]) => ({ section, items }));
 }, [picked, searching, cleanedQuery, locale]);

 const shown = searchGroups ?? groups;
 const total = picked?.items.length ?? 0;

 const toggleSection = (section: string) =>
  setClosedSections((prev) => {
   const next = new Set(prev);
   if (next.has(section)) next.delete(section);
   else next.add(section);
   return next;
  });

 const missingOmp = health?.ok === false;

 return (
  <section
   aria-label={t.tabGeneral}
   className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5"
  >
   <div className="flex flex-wrap items-center gap-2">
    <Settings2 size={16} aria-hidden className="text-muted" />
    <h2 className="text-sm font-semibold">{t.tabGeneral}</h2>
    {catalog && (
     <span className="font-mono text-[11px] text-faint">{fmt(t.allSettingsCount, total)}</span>
    )}
    <div className="ml-auto flex items-center gap-1.5">
     <button
      onClick={() => setClosedSections(new Set())}
      disabled={closedSections.size === 0}
      className="flex min-h-8 cursor-pointer items-center rounded-md bg-background px-2.5 py-1.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      title={t.allSettingsExpandAll}
     >
      {t.allSettingsExpandAll}
     </button>
     <button
      onClick={() => setClosedSections(new Set(groups.map((g) => g.section)))}
      disabled={groups.length > 0 && closedSections.size >= groups.length}
      className="flex min-h-8 cursor-pointer items-center rounded-md bg-background px-2.5 py-1.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      title={t.allSettingsCollapseAll}
     >
      {t.allSettingsCollapseAll}
     </button>
     <button
      onClick={refresh}
      disabled={refreshing || catalog === null}
      className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={t.ompSettingsRefresh}
      title={t.ompSettingsRefresh}
     >
      {refreshing ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
      {t.refresh}
     </button>
    </div>
   </div>
   <p className="mt-2 text-[13px] leading-relaxed text-faint">{t.allSettingsHint}</p>
   <input
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    placeholder={t.allSettingsSearch}
    aria-label={t.allSettingsSearch}
    className="mt-3 h-9 w-full rounded-md border border-border bg-background px-2.5 text-[13px] outline-none focus:border-accent"
   />
   {missingOmp && <p className="mt-2 text-[13px] text-warn">{t.ompSettingsMissing}</p>}
   {err && (
    <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
     {err}
    </p>
   )}
   {catalog === null ? (
    loadError ? (
     <div className="mt-5 flex flex-col items-start gap-2">
      <p role="alert" className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
       {loadError}
      </p>
      <button
       onClick={refresh}
       disabled={refreshing}
       className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {t.retry}
      </button>
     </div>
    ) : (
     <p role="status" className="mt-5 text-[13px] text-muted">{t.archivedLoading}</p>
    )
   ) : total === 0 ? (
    <p role="status" className="mt-5 text-[13px] text-muted">{t.allSettingsEmpty}</p>
   ) : (
    <>
     {staleError && (
      <p role="alert" className="mt-2 rounded border border-warn/40 bg-warn/5 px-3 py-2 text-[13px] text-warn">
       {t.ompSettingsStale}：{staleError}
      </p>
     )}
     {searching && shown.length === 0 ? (
      <div className="mt-5 flex flex-col items-start gap-2">
       <p className="text-[13px] text-muted">{t.ompSettingsNoMatch}</p>
       <button
        onClick={() => setQuery("")}
        className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
       >
        {t.quickSwitcherClear}
       </button>
      </div>
     ) : (
      <div className="mt-5 space-y-4">
       {shown.map(({ section, items }) => {
        const labelKey = SECTION_LABEL_KEYS[section];
        const label = section === "" ? t.allSettingsUngrouped : labelKey ? t[labelKey] : section;
        const isOpen = searching || !closedSections.has(section);
        return (
         <div key={section || "__ungrouped"}>
          <button
           onClick={() => toggleSection(section)}
           aria-expanded={isOpen}
           className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md bg-background px-3 py-2 text-left transition-colors duration-100 hover:bg-hover"
          >
           {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
           <span className="text-[13px] font-medium">{label}</span>
           <span className="font-mono text-[11px] text-faint">{items.length}</span>
          </button>
          {isOpen && (
           <div className="mt-1 divide-y divide-border-soft">
            {items.map((item) => (
             <SettingRow
              key={item.key}
              item={item}
              busy={busyKeys.has(item.key)}
              themeNames={themeNames}
              draft={drafts[item.key]}
              jsonText={jsonDrafts[item.key]}
              jsonError={jsonErrors[item.key]}
              onDraft={(v) => setDrafts((prev) => ({ ...prev, [item.key]: v }))}
              onCommit={() => commitDraft(item)}
              onSave={(key, value) => void save(key, value)}
              onReset={reset}
              onOpenJson={openJson}
              onJsonChange={(text) =>
               setJsonDrafts((prev) => ({ ...prev, [item.key]: text }))
              }
              onJsonSave={saveJson}
              onJsonClose={closeJson}
             />
            ))}
           </div>
          )}
         </div>
        );
       })}
      </div>
     )}
    </>
   )}
  </section>
 );
}

/** 一行设置：键名 + 类型 / 状态标记 + 控件（开关 / 下拉 / 数字 / 文本 / JSON）+ 恢复默认。 */
function SettingRow({
 item,
 busy,
 themeNames,
 draft,
 jsonText,
 jsonError,
 onDraft,
 onCommit,
 onSave,
 onReset,
 onOpenJson,
 onJsonChange,
 onJsonSave,
 onJsonClose,
}: {
 item: OmpCatalogItem;
 busy: boolean;
 /** 主题下拉的运行时列表（`theme.dark` / `theme.light` 用；其余行无关）。 */
 themeNames: readonly string[];
 draft: string | undefined;
 jsonText: string | undefined;
 jsonError: string | undefined;
 onDraft: (value: string) => void;
 onCommit: () => void;
 onSave: (key: string, value: unknown) => void;
 onReset: (key: string) => void;
 onOpenJson: (item: OmpCatalogItem) => void;
 onJsonChange: (text: string) => void;
 onJsonSave: (item: OmpCatalogItem) => void;
 onJsonClose: (key: string) => void;
}) {
 const t = useText();
 const locale = useApp((s) => s.locale);
 const hint = item.description || undefined;
 const value = item.value;
 /** 行内标注（`SETTING_NOTES`）：仅 TUI 生效 / -1 = 默认。 */
 const note = SETTING_NOTES[item.key];
 const isJson = item.kind === "array" || item.kind === "record";
 const editingJson = jsonText !== undefined;
 const enumValues = choiceOptions(item, t, themeNames);
 /** schema 类型名走字典；未知类型（上游将来加的）原样显示上游值。 */
 const kindKey = SETTING_KIND_KEYS[item.kind];
 const kindLabel = kindKey ? t[kindKey] : item.kind;
 /** 名称表（`ompSettingNames.ts`，519 项全覆盖）：有名字时名字当主标题、键名退到副行（与常用设置同构）。 */
 const pair = OMP_SETTING_NAMES[item.key];
 const name = pair ? pair[locale === "zh-CN" ? 0 : 1] : null;
 /** 控件的无障碍名：有翻译名用翻译名（与常用设置页同口径），没有条目时回退键名。 */
 const ariaName = name ?? item.key;

 /** 未被上游隐藏、且不是「未设置」时显示值的第二行标记；两种情况都不显示。 */
 const status = item.redacted
  ? t.allSettingsRedacted
  : value === null
   ? t.allSettingsNotSet
   : null;

 return (
  <div className="px-1 py-3">
   <div className="flex flex-wrap items-center gap-2">
    <div className="min-w-0 basis-full @min-[480px]/panel:flex-1 @min-[480px]/panel:basis-0" title={hint}>
     <div className={name ? "text-[13px] leading-5" : "font-mono text-[12px] leading-5 break-all"}>
      {name ?? item.key}
     </div>
     <div className="mt-0.5 font-mono text-[11px] break-all text-faint">
      {name ? `${item.key} · ` : ""}
      {kindLabel}
      {status && ` · ${status}`}
      {note?.tuiOnly && ` · ${t.ompSettingsTuiOnly}`}
      {note?.minusOneIsDefault && value === -1 && ` · -1 = ${t.ompSettingsDefault}`}
     </div>
    </div>
    <button
     onClick={() => onReset(item.key)}
     disabled={busy}
     className="shrink-0 cursor-pointer rounded-md p-2 text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-30"
     aria-label={`${t.ompSettingsReset}: ${ariaName}`}
     title={t.ompSettingsReset}
    >
     <Undo size={12} aria-hidden />
    </button>
    {item.redacted ? (
     <span className="shrink-0 text-[12px] text-faint" title={t.allSettingsRedactedHint}>
      {t.allSettingsRedacted}
     </span>
    ) : item.kind === "boolean" ? (
     <Switch
      on={value === true}
      disabled={busy}
      label={ariaName}
      onToggle={() => onSave(item.key, value !== true)}
     />
    ) : enumValues.length > 0 ? (
     <EnumSelect
      label={ariaName}
      value={typeof value === "string" ? value : undefined}
      choices={enumValues}
      busy={busy}
      onPick={(v) => onSave(item.key, v)}
     />
    ) : item.kind === "number" ? (
     <input
      type="number"
      value={draft ?? (typeof value === "number" ? String(value) : "")}
      disabled={busy}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
       if (e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label={ariaName}
      title={hint}
      className="w-28 shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-right font-mono text-[12px] transition-colors duration-100 focus:border-accent disabled:opacity-40"
     />
    ) : isJson ? (
     <div className="flex min-w-0 shrink-0 items-center gap-1.5">
      <code
       title={jsonPreview(value)}
       className="max-w-[14rem] truncate rounded-sm bg-background px-2 py-1 font-mono text-[11px] text-muted"
      >
       {jsonPreview(value) || t.allSettingsNotSet}
      </code>
      <button
       onClick={() => onOpenJson(item)}
       disabled={busy || editingJson}
       className="cursor-pointer rounded-md border border-border px-2.5 py-1.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
      >
       {t.allSettingsEditJson}
      </button>
     </div>
    ) : (
     <input
      type="text"
      value={draft ?? (typeof value === "string" ? value : "")}
      disabled={busy}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
       if (e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label={ariaName}
      title={hint}
      placeholder={value === null ? t.allSettingsNotSet : undefined}
      className="min-w-0 shrink-0 basis-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[12px] transition-colors duration-100 focus:border-accent disabled:opacity-40 @min-[480px]/panel:basis-56"
     />
    )}
   </div>
   {editingJson && (
    <div className="mt-2">
     <textarea
      value={jsonText}
      onChange={(e) => onJsonChange(e.target.value)}
      rows={4}
      spellCheck={false}
      aria-label={fmt(t.allSettingsJsonAria, ariaName)}
      className="w-full rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-5 outline-none focus:border-accent"
     />
     <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <button
       onClick={() => onJsonSave(item)}
       disabled={busy}
       className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[12px] text-accent-foreground transition-opacity duration-100 hover:opacity-90 disabled:opacity-50"
      >
       {busy ? <Loader size={12} className="animate-spin" aria-hidden /> : t.allSettingsSave}
      </button>
      <button
       onClick={() => onJsonClose(item.key)}
       disabled={busy}
       className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {t.cancel}
      </button>
      {jsonError && (
       <span role="alert" className="text-[12px] text-danger">
        {jsonError}
       </span>
      )}
     </div>
    </div>
   )}
  </div>
 );
}
