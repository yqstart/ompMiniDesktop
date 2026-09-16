import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Loader, Refresh, Sliders, Star } from "reicon-react";
import { api } from "@shared/api";
import type { ModelInfo, ModelRolesInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { favoriteEntries, toggleFavorite } from "../../lib/favoriteModels";
import { fmt, type Text } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { useDropdown } from "../../lib/useDropdown";

/**
 * 设置 › 模型：omp 的 **model roles**（角色 → 模型分配）与**可用模型目录**（只读）。
 *
 * 口径（实现依据见 `src-tauri/src/providers.rs` 头注释）：
 * - 角色写的是 **omp 全局配置**（`omp config set modelRoles`，record 只能整表写，
 *   后端是「读 → 改一键 → 写回」并回读），未配置的角色按 omp 自己的回退规则解析，本页不复制那套规则；
 * - 「可用模型」= omp 当前可用的模型（有凭证或免钥的供应商），也是角色选择器的候选来源；
 *   这份目录与输入框 `ModelPicker` **共用同一份 store**（同一次刷新，两处同步）。
 *
 * 登录 / 登出在「供应商」页签（本页不碰凭证）。
 */

/** 内置角色的可读名（上游 role id → 本应用文案）；自定义角色原样显示 id。 */
function roleLabel(role: string, t: Text): string {
 const map: Record<string, string | undefined> = {
  default: t.roleDefault,
  smol: t.roleSmol,
  slow: t.roleSlow,
  vision: t.roleVision,
  plan: t.rolePlan,
  commit: t.roleCommit,
  tiny: t.roleTiny,
  task: t.roleTask,
  advisor: t.roleAdvisor,
 };
 return map[role] ?? role;
}

function shortName(m: ModelInfo): string {
 return m.name.replace(/^Claude\s+/i, "").replace(/\s+\d\.\d+$/, "");
}

function fmtCtx(n: number | null): string {
 if (!n) return "";
 if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
 return `${Math.round(n / 1000)}K`;
}

export function ModelsPanel() {
 const t = useText();
 const { models, set, favoriteModels, setFavoriteModels } = useApp();
 const [roles, setRoles] = useState<ModelRolesInfo | null>(null);
 const [err, setErr] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);

 /** 拉角色表 + 模型目录；`force` 时强制刷新目录。
  *  写成 promise 链（而不是在 effect 里同步调用）——state 只在回调里更新，
  *  符合 react-hooks 对「effect 内同步 setState 会级联渲染」的约束。 */
 const load = useCallback(
  (force: boolean) =>
   Promise.allSettled([
    api.getModelRoles().then((r) => setRoles(r)),
    (force ? api.refreshModels() : api.getModels()).then((c) => set({ models: c })),
   ]).then((res) => {
    const bad = res.find((r) => r.status === "rejected");
    setErr(
     bad && bad.status === "rejected"
      ? bad.reason instanceof Error
       ? bad.reason.message
       : t.modelsLoadFailed
      : null,
    );
   }),
  [set, t.modelsLoadFailed],
 );

 useEffect(() => {
  void load(!models);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉一次
 }, []);

 /** 角色编辑：后端写整表并回读，返回的就是写入后的真相。 */
 const saveRole = async (role: string, selector: string | null) => {
  setErr(null);
  try {
   setRoles(await api.setModelRole(role, selector));
  } catch (e) {
   setErr(e instanceof Error ? e.message : t.roleSetFailed);
  }
 };

 const refreshAll = async () => {
  setBusy(true);
  setErr(null);
  try {
   await load(true);
  } finally {
   setBusy(false);
  }
 };

 const roleKeys = useMemo(() => {
  const builtin = roles?.builtin ?? [];
  const rest = Object.keys(roles?.roles ?? {}).filter((k) => !builtin.includes(k));
  return [...builtin, ...rest];
 }, [roles]);

 /** 常用模型（按挑选顺序解析，含已不可用项——设置页要列出来给人清理）。 */
 const entries = useMemo(
  () => favoriteEntries(favoriteModels, models?.models ?? []),
  [favoriteModels, models],
 );
 const toggleFavoriteModel = (selector: string) =>
  setFavoriteModels(toggleFavorite(favoriteModels, selector));

 return (
  <>
   {err && (
    <p role="alert" className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
     {err}
    </p>
   )}

   {/* 模型角色：把 omp 的 modelRoles 读写给用户 */}
   <section aria-label={t.rolesSection} className="rounded-md border border-border bg-surface p-3.5">
    <div className="flex items-center gap-2">
     <Sliders size={14} aria-hidden className="text-muted" />
     <h2 className="text-sm font-medium">{t.rolesSection}</h2>
     <button
      onClick={() => void refreshAll()}
      disabled={busy}
      className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={t.modelsRefresh}
      title={t.modelsRefresh}
     >
      {busy ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
      {t.refresh}
     </button>
    </div>
    <p className="mt-1.5 text-[13px] text-faint">{t.rolesHint}</p>
    {roles?.storage === "project" && (
     <p className="mt-1.5 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
      {t.roleStorageProject}
     </p>
    )}
    <div className="mt-2">
     {roles === null ? (
      <div className="py-2 text-[13px] text-muted">{t.archivedLoading}</div>
     ) : (
      roleKeys.map((role) => (
       <RoleRow
        key={role}
        role={role}
        label={roleLabel(role, t)}
        current={roles.roles[role] ?? null}
        models={models?.models ?? []}
        onSave={saveRole}
       />
      ))
     )}
    </div>
   </section>

   {/* 常用模型：本应用偏好（localStorage），挑中的模型才出现在输入框的模型选择器里 */}
   <section aria-label={t.favoritesSection} className="rounded-md border border-border bg-surface p-3.5">
    <div className="flex items-center gap-2">
     <Star size={14} aria-hidden className="text-muted" />
     <h2 className="text-sm font-medium">{t.favoritesSection}</h2>
    </div>
    <p className="mt-1.5 text-[13px] text-faint">{t.favoritesHint}</p>
    <div className="mt-2">
     {entries.length === 0 ? (
      <p className="py-2 text-[13px] text-muted">{t.favoritesEmpty}</p>
     ) : (
      entries.map(({ selector, model }) => (
       <div key={selector} className="flex items-center gap-2 border-t border-border-soft py-2 first:border-t-0">
        <StarToggle on name={model?.name ?? selector} onClick={() => toggleFavoriteModel(selector)} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{model?.name ?? selector}</span>
        {model && <span className="shrink-0 font-mono text-xs text-muted">{selector}</span>}
        {!model && (
         <span className="shrink-0 rounded border border-warn/40 bg-warn/5 px-1.5 py-0.5 text-xs text-warn">
          {t.favoriteUnavailable}
         </span>
        )}
       </div>
      ))
     )}
    </div>
   </section>

   {/* 可用模型：只读目录（这些就是能分配给角色的候选） */}
   <section aria-label={t.modelsSection} className="rounded-md border border-border bg-surface p-3.5">
    <div className="flex items-center gap-2">
     <Layers size={14} aria-hidden className="text-muted" />
     <h2 className="text-sm font-medium">{t.modelsSection}</h2>
    </div>
    <CatalogSection
     models={models?.models ?? []}
     favorites={favoriteModels}
     onToggleFavorite={toggleFavoriteModel}
     onRefresh={() => void refreshAll()}
    />
   </section>
  </>
 );
}

/** 一行角色：角色名 + 当前模型 + 内联展开的模型选择器（撑开布局，不做浮层——设置页是可滚动容器，浮层会被裁掉）。 */
function RoleRow({
 role,
 label,
 current,
 models,
 onSave,
}: {
 role: string;
 label: string;
 current: string | null;
 models: ModelInfo[];
 onSave: (role: string, selector: string | null) => Promise<void>;
}) {
 const t = useText();
 const [open, setOpen] = useState(false);
 const [q, setQ] = useState("");
 const [saving, setSaving] = useState(false);
 const ref = useDropdown(open, () => setOpen(false));

 const pick = async (m: ModelInfo) => {
  setOpen(false);
  setSaving(true);
  await onSave(role, m.selector);
  setSaving(false);
 };

 const clear = async () => {
  setSaving(true);
  await onSave(role, null);
  setSaving(false);
 };

 const list = models.filter((m) =>
  q.trim() ? `${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(q.toLowerCase()) : true,
 );
 const groups = new Map<string, ModelInfo[]>();
 for (const m of list) {
  const g = groups.get(m.provider) ?? [];
  g.push(m);
  groups.set(m.provider, g);
 }

 return (
  <div className="border-t border-border-soft py-2 first:border-t-0">
   <div className="flex items-center gap-2">
    <div className="min-w-0 w-32 shrink-0">
     <div className="truncate text-sm">{label}</div>
     {label !== role && <div className="font-mono text-xs text-muted">{role}</div>}
    </div>
    <div className="min-w-0 flex-1 font-mono text-xs break-all">
     {current ? <span>{current}</span> : <span className="text-muted">{t.roleUnset}</span>}
    </div>
    <button
     onClick={() => setOpen((v) => !v)}
     disabled={saving}
     className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     aria-label={fmt(t.rolePick + " {0}", label)}
     aria-expanded={open}
    >
     {t.rolePick}
    </button>
    {current && (
     <button
      onClick={() => void clear()}
      disabled={saving}
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-50"
      aria-label={fmt(t.roleClear + " {0}", label)}
     >
      {t.roleClear}
     </button>
    )}
    {saving && <Loader size={12} className="shrink-0 animate-spin text-muted" aria-hidden />}
   </div>

   {open && (
    <div ref={ref} className="mt-2 rounded-md border border-border bg-background p-2">
     <div className="flex items-center gap-2">
      <input
       value={q}
       onChange={(e) => setQ(e.target.value)}
       placeholder={t.roleSearchPlaceholder}
       aria-label={t.roleSearchPlaceholder}
       className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none"
      />
     </div>
     <div className="mt-1 max-h-56 overflow-y-auto">
      {[...groups].map(([provider, ms]) => (
       <div key={provider}>
        <div className="px-1 pt-1.5 pb-0.5 font-mono text-xs text-muted">{provider}</div>
        {ms.map((m) => (
         <button
          key={m.selector}
          onClick={() => void pick(m)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors duration-100 hover:bg-hover"
          aria-label={fmt(t.useModelAria, m.name)}
         >
          <span className="truncate">{shortName(m)}</span>
          <span className="ml-auto flex shrink-0 gap-1 font-mono text-xs text-muted">
           {m.contextWindow ? <span>{fmtCtx(m.contextWindow)}</span> : null}
           {m.thinking?.length ? <span>{m.thinking.length}</span> : null}
          </span>
         </button>
        ))}
       </div>
      ))}
      {list.length === 0 && <div className="p-2 text-[13px] text-muted">{t.noModelMatch}</div>}
     </div>
    </div>
   )}
  </div>
 );
}

/** 只读模型目录：按供应商分组折叠（这些就是能分配给角色的候选）；行尾星标挑选常用模型。顶部过滤框按名 / selector 收窄，命中组一律展开。 */
function CatalogSection({
 models,
 favorites,
 onToggleFavorite,
 onRefresh,
}: {
 models: ModelInfo[];
 favorites: string[];
 onToggleFavorite: (selector: string) => void;
 onRefresh: () => void;
}) {
 const t = useText();
 const [openProvider, setOpenProvider] = useState<string | null>(null);
 const [q, setQ] = useState("");
 const query = q.trim().toLowerCase();
 const list = useMemo(
  () => (query ? models.filter((m) => `${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(query)) : models),
  [models, query],
 );
 const groups = useMemo(() => {
  const m = new Map<string, ModelInfo[]>();
  for (const x of list) {
   const g = m.get(x.provider) ?? [];
   g.push(x);
   m.set(x.provider, g);
  }
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
 }, [list]);

 return (
  <>
   <div className="mt-1.5 flex items-center gap-2">
    <span className="text-[13px] text-faint">
     {models.length === 0
      ? t.modelsEmpty
      : query
       ? fmt(t.modelsFilteredHint, list.length, groups.length)
       : fmt(t.modelsHint, models.length, groups.length)}
    </span>
    <button
     onClick={onRefresh}
     className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
     aria-label={t.refreshModels}
    >
     <Refresh size={12} aria-hidden />
     {t.refresh}
    </button>
   </div>
   <input
    value={q}
    onChange={(e) => setQ(e.target.value)}
    placeholder={t.searchModelPlaceholder}
    aria-label={t.searchModelLabel}
    className="mt-1.5 w-full rounded-md border border-border bg-background px-2 py-1 text-[13px] outline-none"
   />
   <div className="mt-1">
    {groups.map(([provider, ms]) => {
     const open = query !== "" || openProvider === provider;
     const head = (
      <>
       {open ? (
        <ChevronDown size={12} aria-hidden className="shrink-0 text-muted" />
       ) : (
        <ChevronRight size={12} aria-hidden className="shrink-0 text-muted" />
       )}
       <span className="font-mono text-xs">{provider}</span>
       <span className="ml-auto font-mono text-xs text-muted">{ms.length}</span>
      </>
     );
     return (
      <div key={provider} className="border-t border-border-soft first:border-t-0">
       {query !== "" ? (
        /* 过滤态：命中组一律展开，组头退化为静态行（此时折叠没有意义，也不该点了没反应） */
        <div className="flex w-full items-center gap-1.5 py-1.5 text-left text-[13px]">{head}</div>
       ) : (
        <button
         onClick={() => setOpenProvider(open ? null : provider)}
         className="flex w-full cursor-pointer items-center gap-1.5 py-1.5 text-left text-[13px] transition-colors duration-100 hover:text-foreground"
         aria-expanded={open}
         aria-label={open ? t.catalogCollapse : t.catalogExpand}
        >
         {head}
        </button>
       )}
       {open && (
        <div className="pb-1.5">
         {ms.map((m) => (
          <div key={m.selector} className="flex items-center gap-2 py-0.5 pl-4 text-[13px]">
           <span className="truncate">{m.name}</span>
           <span className="ml-auto flex shrink-0 gap-1.5 font-mono text-muted">
            {m.contextWindow ? <span>{fmtCtx(m.contextWindow)}</span> : null}
            {m.input?.includes("image") ? <span>{t.imageCap}</span> : null}
           </span>
           <StarToggle
            on={favorites.includes(m.selector)}
            name={m.name}
            onClick={() => onToggleFavorite(m.selector)}
           />
          </div>
         ))}
        </div>
       )}
      </div>
     );
    })}
   </div>
   {query !== "" && groups.length === 0 && (
    <div className="p-2 text-[13px] text-muted">{t.noModelMatch}</div>
   )}
  </>
 );
}

/** 常用模型星标：目录行与常用列表共用（on = 已在常用里；再点一次即移出）。 */
function StarToggle({ on, name, onClick }: { on: boolean; name: string; onClick: () => void }) {
 const t = useText();
 return (
  <button
   onClick={onClick}
   aria-pressed={on}
   aria-label={fmt(on ? t.favoriteRemoveAria : t.favoriteAddAria, name)}
   className="shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-100 hover:bg-hover"
  >
   <Star size={13} weight={on ? "Filled" : "Outline"} aria-hidden className={on ? "text-accent" : "text-muted"} />
  </button>
 );
}
