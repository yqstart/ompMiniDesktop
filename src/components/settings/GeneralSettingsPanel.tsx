import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader, Refresh, Sliders, Undo } from "reicon-react";
import { api } from "@shared/api";
import type { OmpSetting } from "@shared/types";
import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { Switch } from "./Switch";
import {
 SETTING_GROUPS,
 SETTING_KEYS,
 groupLabelKey,
 optionsFor,
 settingLabelKey,
 specsOfGroup,
 type SettingGroup,
 type SettingSpec,
} from "../../lib/ompSettings";

/**
 * 设置 › 通用 ›「omp 常用设置」：把 omp 全局配置（`config.yml`）里最常改的那些键
 * 映射成开关 / 下拉 / 数字框。白名单与分组见 `src/lib/ompSettings.ts`，读写口径
 * （一次 `config list --json` 批量读、`config set/… -- …` 写、写完回读、负数要 `--`）
 * 见 `src-tauri/src/settings.rs` 头注释。
 *
 * 界面上守住的几条：
 * - **不摆假值**：拿不到 `omp config` 的读数就显示错误条，不画一个默认态的开关；
 * - **上游没有这个键**（omp 版本差异）时把那一行标成「当前 omp 版本没有这个设置」并禁用控件，
 *   而不是补一个壳侧编的默认值；
 * - **说明文字是上游英文**（`description`，omp 对这条设置的定义）——挂在行的 `title` 上，
 *   不翻译（翻译会引入壳侧自己的解释，也会随上游改语义而漂移）；
 * - 写完**回读**（后端返回的就是真相）：omp 静默丢弃写入时界面不会停在乐观值上。
 */

/** 分组 → 该组的设置项，模块级常量（白名单是静态的，不需要每次渲染重算）。 */
const GROUPS = SETTING_GROUPS.map((group) => ({ group, specs: specsOfGroup(group) }));

export function GeneralSettingsPanel() {
 const t = useText();
 const health = useApp((s) => s.health);
 const [items, setItems] = useState<Record<string, OmpSetting>>({});
 const [err, setErr] = useState<string | null>(null);
 /** 正在写入 / 恢复默认的键：那一行的控件在落地前不接第二次点击（同键连点会竞态）。 */
 const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
 /** 正在手动刷新（首次挂载的自动加载不点亮按钮——那一下太快，闪一下反而更吵）。 */
 const [refreshing, setRefreshing] = useState(false);
 /** 折叠的组（默认全展开：这是「常用设置」，可见性优先）。 */
 const [closed, setClosed] = useState<ReadonlySet<SettingGroup>>(new Set());
 /** 行内展开的枚举选择器（同屏只开一个）。 */
 const [openEnum, setOpenEnum] = useState<string | null>(null);
 /** 数字框的编辑草稿（提交前不写 omp）。 */
 const [drafts, setDrafts] = useState<Record<string, string>>({});

 /** 重新拉一次读数。写成 promise 链（不在 effect 里同步 setState）：state 只在回调里更新，
  *  符合 react-hooks 对「effect 内同步 setState 会级联渲染」的约束（与 ModelsPanel 同款）。 */
 const load = useCallback(
  () =>
   api
    .getOmpSettings([...SETTING_KEYS])
    .then((list) => {
     setItems(Object.fromEntries(list.map((s) => [s.key, s])));
     setErr(null);
    })
    .catch((e: unknown) => {
     setErr(e instanceof Error ? e.message : t.ompSettingsLoadFailed);
    }),
  [t.ompSettingsLoadFailed],
 );

 useEffect(() => {
  void load();
 }, [load]);

 /** 手动刷新（按钮点击 = 事件处理函数，这里同步置 busy 是允许的）。 */
 const refresh = () => {
  setRefreshing(true);
  void load().finally(() => setRefreshing(false));
 };

 const withBusy = async (key: string, fn: () => Promise<OmpSetting>, rollback?: OmpSetting) => {
  setBusyKeys((prev) => new Set(prev).add(key));
  try {
   const saved = await fn();
   setItems((prev) => ({ ...prev, [saved.key]: saved }));
   setErr(null);
  } catch (e) {
   // 乐观值撤回去：界面不许停在没生效的状态上
   if (rollback) setItems((prev) => ({ ...prev, [rollback.key]: rollback }));
   setErr(e instanceof Error ? e.message : t.ompSettingsSaveFailed);
  } finally {
   setBusyKeys((prev) => {
    const next = new Set(prev);
    next.delete(key);
    return next;
   });
  }
 };

 /** 写一个键并回读：先乐观改（开关要立刻有反馈），失败由 `withBusy` 复原。 */
 const save = (key: string, value: unknown) => {
  const prev = items[key];
  setItems((p) => (prev ? { ...p, [key]: { ...prev, value } } : p));
  void withBusy(key, () => api.setOmpSetting(key, value), prev);
 };

 const reset = (key: string) => {
  setOpenEnum(null);
  void withBusy(key, () => api.resetOmpSetting(key));
 };

 const toggleGroup = (g: SettingGroup) =>
  setClosed((prev) => {
   const next = new Set(prev);
   if (next.has(g)) next.delete(g);
   else next.add(g);
   return next;
  });

 /** 数字框提交：与当前值相同就不打扰 omp；解析不出数字就丢掉草稿。 */
 const commitNumber = (spec: SettingSpec) => {
  const raw = drafts[spec.key];
  if (raw === undefined) return;
  setDrafts((prev) => {
   const next = { ...prev };
   delete next[spec.key];
   return next;
  });
  const n = Number(raw.trim());
  if (raw.trim() === "" || Number.isNaN(n)) return;
  if (items[spec.key]?.value === n) return;
  save(spec.key, n);
 };

 const missingOmp = health?.ok === false;

 return (
  <section aria-label={t.ompSettingsSection} className="rounded-md border border-border bg-surface p-3.5">
   <div className="flex items-center gap-2">
    <Sliders size={14} aria-hidden className="text-muted" />
    <h2 className="text-sm font-medium">{t.ompSettingsSection}</h2>
    <button
     onClick={refresh}
     disabled={refreshing}
     className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     aria-label={t.ompSettingsRefresh}
     title={t.ompSettingsRefresh}
    >
     {refreshing ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
     {t.refresh}
    </button>
   </div>
   <p className="mt-1.5 text-[13px] text-faint">{t.ompSettingsHint}</p>
   {missingOmp && <p className="mt-2 text-[13px] text-warn">{t.ompSettingsMissing}</p>}
   {err && (
    <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
     {err}
    </p>
   )}

   <div className="mt-3 space-y-3">
    {GROUPS.map(({ group, specs }) => {
     const isClosed = closed.has(group);
     return (
      <div key={group}>
       <button
        onClick={() => toggleGroup(group)}
        aria-expanded={!isClosed}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors duration-100 hover:bg-hover/60"
       >
        {isClosed ? <ChevronRight size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
        <span className="text-[13px] font-medium">{t[groupLabelKey(group)]}</span>
        <span className="font-mono text-[11px] text-faint">{specs.length}</span>
       </button>
       {!isClosed && (
        <div className="mt-0.5 space-y-0.5">
         {specs.map((spec) => {
          const item = items[spec.key];
          const busy = busyKeys.has(spec.key);
          return (
           <SettingRow
            key={spec.key}
            spec={spec}
            item={item}
            busy={busy}
            open={openEnum === spec.key}
            draft={drafts[spec.key]}
            onToggleEnum={() => setOpenEnum(openEnum === spec.key ? null : spec.key)}
            onSave={save}
            onReset={reset}
            onDraft={(v) => setDrafts((prev) => ({ ...prev, [spec.key]: v }))}
            onCommitNumber={() => commitNumber(spec)}
           />
          );
         })}
        </div>
       )}
      </div>
     );
    })}
   </div>
  </section>
 );
}

/** 一行设置：label + omp 的键名 + 控件（开关 / 下拉 / 数字）+ 恢复默认。 */
function SettingRow({
 spec,
 item,
 busy,
 open,
 draft,
 onToggleEnum,
 onSave,
 onReset,
 onDraft,
 onCommitNumber,
}: {
 spec: SettingSpec;
 item: OmpSetting | undefined;
 busy: boolean;
 open: boolean;
 draft: string | undefined;
 onToggleEnum: () => void;
 onSave: (key: string, value: unknown) => void;
 onReset: (key: string) => void;
 onDraft: (v: string) => void;
 onCommitNumber: () => void;
}) {
 const t = useText();
 const label = t[settingLabelKey(spec.key)];
 // 上游没有这个键（omp 版本差异）：说清楚、禁掉控件，不补一个壳侧编的默认值
 const unavailable = !item;
 const value = item?.value;
 const hint = item?.description || undefined;

 return (
  <div className="rounded-lg px-2 py-1.5 transition-colors duration-100 hover:bg-hover/60">
   <div className="flex items-center gap-2">
    <div className="min-w-0 flex-1" title={hint}>
     <div className="truncate text-[13px]">{label}</div>
     <div className="truncate font-mono text-[10px] text-faint">
      {spec.key}
      {unavailable && ` · ${t.ompSettingsUnavailable}`}
      {spec.tuiOnly && ` · ${t.ompSettingsTuiOnly}`}
      {spec.minusOneIsDefault && value === -1 && ` · -1 = ${t.ompSettingsDefault}`}
     </div>
    </div>
    <button
     onClick={() => onReset(spec.key)}
     disabled={busy || unavailable}
     className="shrink-0 cursor-pointer rounded p-1 text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-30"
     aria-label={`${t.ompSettingsReset}: ${label}`}
     title={t.ompSettingsReset}
    >
     <Undo size={12} aria-hidden />
    </button>
    {spec.type === "boolean" ? (
     <Switch
      on={value === true}
      disabled={busy || unavailable}
      label={label}
      onToggle={() => onSave(spec.key, value !== true)}
     />
    ) : spec.type === "enum" ? (
     <button
      onClick={onToggleEnum}
      disabled={busy || unavailable}
      aria-expanded={open}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
     >
      {busy ? <Loader size={11} className="animate-spin" aria-hidden /> : null}
      {typeof value === "string" ? value : "—"}
      <ChevronDown size={11} aria-hidden />
     </button>
    ) : (
     <input
      type="number"
      value={draft ?? (typeof value === "number" ? String(value) : "")}
      disabled={busy || unavailable}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={onCommitNumber}
      onKeyDown={(e) => {
       if (e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label={label}
      title={hint}
      className="no-focus-ring w-20 shrink-0 rounded-md border border-border bg-background px-1.5 py-1 text-right font-mono text-[12px] transition-colors duration-100 focus:border-accent/70 disabled:opacity-40"
     />
    )}
   </div>
   {open && spec.type === "enum" && (
    <div className="mt-1.5 mb-0.5 space-y-0.5 rounded-md border border-border bg-background p-1">
     {optionsFor(spec, value).map((opt) => (
      <button
       key={opt.value}
       onClick={() => {
        onToggleEnum();
        if (opt.value !== value) onSave(spec.key, opt.value);
       }}
       aria-current={opt.value === value}
       className={`block w-full cursor-pointer truncate rounded px-2 py-1 text-left text-[13px] transition-colors duration-100 hover:bg-hover ${opt.value === value ? "text-accent" : ""
        }`}
      >
       {opt.label ? t[opt.label] : opt.value}
      </button>
     ))}
    </div>
   )}
  </div>
 );
}
