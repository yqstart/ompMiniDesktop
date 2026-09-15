import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader, Refresh, Sliders, Star } from "reicon-react";
import { api } from "@shared/api";
import type { FallbackChainsInfo, ModelInfo, ModelRolesInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { myModelEntries, orderModelsByStars, toggleMyModel } from "../../lib/myModels";
import { fmt } from "../../lib/locale";
import { splitSelector, withLevel } from "../../lib/modelSelector";
import { roleLabel } from "../../lib/roleNames";
import { thinkingLevelsOf, THINKING_ORDER } from "../../lib/thinking";
import { useText } from "../../lib/useText";
import { useDropdown } from "../../lib/useDropdown";
import { FallbackChainsSection } from "./FallbackChains";
import { ModelPickerDialog } from "./ModelPickList";
import { ProvidersSection } from "./ProvidersSection";
import { StarToggle } from "./StarToggle";

/**
 * 设置 › 模型：omp 模型相关的**唯一管理面**（V12b 把原「供应商」页签整体并了进来）。
 * 区块顺序 = 使用动线：**供应商 → 我的模型 → 模型角色 → 失败转移**（先添加供应商，再在弹窗里
 * 挑选模型——挑进的进「我的模型」，在各选单里置顶）。
 *
 * 口径：
 * - **我的模型**（本应用偏好，localStorage；`src/lib/myModels.ts`）是**置顶排序**：
 *   候选始终是全量可用模型，星标项（`orderModelsByStars`）在角色 / 转移弹窗里置顶；
 *   挑没挑过都不缩小可选范围。**不写 omp 的 `enabledModels`**——omp 终端里
 *   `/model` 的可选范围不受影响。挑选入口 = 供应商行的「挑选模型」弹窗（V12c 起不再有
 *   平铺的「可用模型」目录——目录在弹窗里按供应商列出，带搜索过滤）。
 * - 模型角色写 omp 全局配置（`omp config set modelRoles`，record 整表读写 + 回读），未配置的
 *   角色按 omp 自己的回退规则解析，本页不复制那套规则；角色值可带 `:思考档` 后缀，
 *   档位候选按该模型声明的档裁剪。
 * - **omp 侧改完切回来就该看到**：角色与转移链在挂载时拉一次、**每次设置标签重新激活时重读**
 *   （终端标签里的 omp 改过 `modelRoles` 后，点回设置标签即刷新）；模型目录不额外重拉——
 *   `get_models` 后端有 5 分钟缓存，页头的「刷新」按钮才走 `refresh_models` 强制重拉。
 * - **Ctrl+P 快速切换环**（`cycleOrder`）没有手动编辑面（用户口径 2026-10-10）：环 = 模型
 *   角色的派生投影——后端 `sync_cycle_order` 按角色展示顺序取已配置模型、按模型基名保序
 *   去重（`:思考档` 后缀不算另一个模型；重复模型保留第一个出现的角色），已是目标值就不写。
 *   本页在**加载后**与
 *   **角色写入后**各同步一次；角色行的顺序即轮换顺序，页面上没有环开关 / 位次 / 排序按钮。
 * - 失败转移链（`retry.fallbackChains`）与角色同层，口径见 `FallbackChains.tsx`。
 * - 供应商（登录型 + 自定义）合并成一个「添加供应商」弹窗：登录型走 `omp auth-broker`
 *   （凭证进 omp 凭证库），自定义写 `<agentDir>/models.yml`——见 `ProvidersSection.tsx`。
 */

export function ModelsPanel() {
 const t = useText();
 const { models, set, myModels, setMyModels, settingsTabActive } = useApp();
 const [roles, setRoles] = useState<ModelRolesInfo | null>(null);
 const [chains, setChains] = useState<FallbackChainsInfo | null>(null);
 const [err, setErr] = useState<string | null>(null);
 const [rolesError, setRolesError] = useState<string | null>(null);
 const [chainsError, setChainsError] = useState<string | null>(null);
 const [cycleError, setCycleError] = useState<string | null>(null);
 const [catalogError, setCatalogError] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const requestSeq = useRef(0);
 const rolesRevision = useRef(0);
 const chainsRevision = useRef(0);
 const roleWriting = useRef(false);
 const [savingRole, setSavingRole] = useState(false);

 /** 同步 Ctrl+P 轮换序：环 = 模型角色的派生投影，后端幂等（已是目标值不写）。
  *  页面加载与角色写入后各跑一次；失败只在角色区提示，不挡其它读取与操作。 */
 const syncCycle = useCallback(async () => {
  try {
   await api.syncCycleOrder();
   setCycleError(null);
  } catch (e) {
   setCycleError(e instanceof Error ? e.message : String(e || t.cycleSyncFailed));
  }
 }, [t.cycleSyncFailed]);

 /** 重读只接纳最新请求；写入后的真值不能被更早发出的读请求覆盖。 */
 const load = useCallback(async (force: boolean) => {
  const seq = ++requestSeq.current;
  const roleVersion = rolesRevision.current;
  const chainVersion = chainsRevision.current;
  /** 每个读取**各自到达即渲染**——目录（`omp models --json`，实测 2–10s；后端已收敛成
   *  单飞 + 缓存）不该拖着角色 / 转移链一起白等，那是「设置页要等好几秒」的主因。 */
  const each = <T,>(req: Promise<T>, apply: (v: T) => void, onError: (msg: string) => void) =>
   req.then(
    (v) => {
     if (seq === requestSeq.current) apply(v);
    },
    (e: unknown) => {
     if (seq === requestSeq.current) onError(e instanceof Error ? e.message : String(e || t.modelsLoadFailed));
    },
   );
  return Promise.all([
   each(
    api.getModelRoles(),
    (v) => {
     if (roleVersion !== rolesRevision.current || roleWriting.current) return;
     setRoles(v);
     setRolesError(null);
    },
    (msg) => {
     if (roleVersion !== rolesRevision.current || roleWriting.current) return;
     setRolesError(msg);
    },
   ),
   each(
    api.getFallbackChains(),
    (v) => {
     if (chainVersion !== chainsRevision.current) return;
     setChains(v);
     setChainsError(null);
    },
    (msg) => {
     if (chainVersion !== chainsRevision.current) return;
     setChainsError(msg);
    },
   ),
   // 环 = 角色表的派生投影：每次加载都同步一次（同时兜掉 omp 侧手改 / 历史遗留的环）
   syncCycle(),
   each(
    force ? api.refreshModels() : api.getModels(),
    (v) => {
     set({ models: v });
     setCatalogError(v.error ?? null);
    },
    (msg) => setCatalogError(msg),
   ),
  ]);
 }, [set, syncCycle, t.modelsLoadFailed]);

 // 挂载时拉一次；**每次设置标签重新激活**（从终端标签切回来）都重读——omp 侧（TUI / CLI）
 // 改过的模型角色与转移链，切回设置页就该看到，不该要求用户先点「刷新」或重开设置标签。
 // 模型目录走 `get_models` 的 5 分钟缓存（`models` 已在 store 里时不强制重拉），这轮重读很轻。
 useEffect(() => {
  if (!settingsTabActive) return;
  const timer = window.setTimeout(() => {
   void load(!models);
  }, 0);
  return () => {
   window.clearTimeout(timer);
   requestSeq.current += 1;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载与激活态翻转时重读
 }, [settingsTabActive]);

 /** 角色编辑：后端写整表并回读，返回的就是写入后的真相；写完顺手同步 Ctrl+P 轮换序
  *  （环是角色的派生投影——同步失败在角色区单独提示，不影响「角色已保存」这件事）。 */
 const saveRole = async (role: string, selector: string | null) => {
  if (roleWriting.current) return;
  roleWriting.current = true;
  rolesRevision.current += 1;
  setSavingRole(true);
  setErr(null);
  try {
   setRoles(await api.setModelRole(role, selector));
   await syncCycle();
  } catch (e) {
   setErr(e instanceof Error ? e.message : String(e || t.roleSetFailed));
  } finally {
   rolesRevision.current += 1;
   roleWriting.current = false;
   setSavingRole(false);
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

 /** 目录数组：每次渲染新数组会让下面 useMemo 的依赖失效——按 `models` 记忆。 */
 const catalog = useMemo(() => models?.models ?? [], [models]);
 /** 模型选择器的候选（**星标置顶的唯一实现点**）：星标按挑选顺序在前、其余按目录顺序，不收窄范围。 */
 const candidates = useMemo(() => orderModelsByStars(catalog, myModels), [catalog, myModels]);
 /** 我的模型（按挑选顺序解析，含已不可用项——设置页要列出来给人清理）。 */
 const entries = useMemo(() => myModelEntries(myModels, catalog), [myModels, catalog]);

 return (
  <>
   <div className="shrink-0">
    <div className="flex flex-wrap items-center gap-2">
     <h2 className="text-[20px] font-semibold tracking-tight">{t.tabModels}</h2>
     {/* 页级唯一刷新：角色 / 环 / 转移 / 目录 / 供应商（经 modelsRefreshed 广播）都靠它 */}
     <button
      onClick={() => void refreshAll()}
      disabled={busy}
      className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={t.modelsRefresh}
      title={t.modelsRefresh}
     >
      {busy ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
      {t.refresh}
     </button>
    </div>
    <p className="mt-1 text-[13px] text-muted">{t.tabModelsHint}</p>
   </div>
   {err && (
    <p role="alert" className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
     {err}
    </p>
   )}

   {/* 供应商：添加（登录型 API key / OAuth + 自定义 models.yml）+ 按供应商挑选模型 */}
   <ProvidersSection />

   {/* 我的模型：本应用偏好；挑过之后下面角色 / 转移的候选只列这些 */}
   <section aria-label={t.myModelsSection} className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
    <div className="flex flex-wrap items-center gap-2">
     <Star size={16} aria-hidden className="text-muted" />
     <h2 className="text-sm font-semibold">{t.myModelsSection}</h2>
     {entries.length > 0 && (
      <span className="text-[13px] text-muted">{fmt(t.myModelsCount, String(entries.length))}</span>
     )}
     {entries.length > 0 && (
      <button
       onClick={() => setMyModels([])}
       className="ml-auto min-h-8 cursor-pointer rounded-md bg-background px-3 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       {t.myModelsClear}
      </button>
     )}
    </div>
    {catalogError && (
     <p role="alert" className="mt-1.5 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
      {catalogError}
     </p>
    )}
    <div className="mt-4">
     {entries.length === 0 ? (
      <p className="py-2 text-[13px] text-muted">{t.myModelsEmpty}</p>
     ) : (
      entries.map(({ selector, model }) => (
       <div key={selector} className="flex flex-wrap items-center gap-2 border-t border-border-soft py-3 first:border-t-0">
        <StarToggle on name={model?.name ?? selector} onClick={() => setMyModels(toggleMyModel(myModels, selector))} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{model?.name ?? selector}</span>
        {model && <span className="min-w-0 basis-full pl-9 font-mono text-[11px] break-all text-faint @min-[600px]/panel:ml-auto @min-[600px]/panel:basis-auto @min-[600px]/panel:pl-0">{selector}</span>}
        {!model && (
         <span className="shrink-0 rounded border border-warn/40 bg-warn/5 px-1.5 py-0.5 text-xs text-warn">
          {t.myModelsUnavailable}
         </span>
        )}
       </div>
      ))
     )}
    </div>
   </section>

   {/* 模型角色：角色行 = 选模型 / 档位；Ctrl+P 轮换序自动取这里的已配置模型（行序即轮换序） */}
   <section aria-label={t.rolesSection} className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
    <div className="flex flex-wrap items-center gap-2">
     <Sliders size={16} aria-hidden className="text-muted" />
     <h2 className="text-sm font-semibold">{t.rolesSection}</h2>
     <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">Ctrl+P</kbd>
    </div>
    {roles?.storage === "project" && (
     <p className="mt-1.5 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
      {t.roleStorageProject}
     </p>
    )}
    {rolesError && roles !== null && (
     <p role="alert" className="mt-1.5 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
      {t.ompSettingsStale}：{rolesError}
     </p>
    )}
    {cycleError && (
     <p role="alert" className="mt-1.5 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
      {cycleError}
     </p>
    )}
    <div className="mt-4">
     {roles === null ? (
      rolesError ? (
       <div className="flex flex-col items-start gap-2 py-2">
        <p role="alert" className="text-[13px] text-danger">{rolesError}</p>
        <button
         onClick={() => void refreshAll()}
         disabled={busy}
         className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
        >
         {t.retry}
        </button>
       </div>
      ) : (
       <div className="py-2 text-[13px] text-muted">{t.archivedLoading}</div>
      )
     ) : (
      <>
       {roleKeys.map((role) => (
        <RoleRow
         key={role}
         role={role}
         label={roleLabel(role, t)}
         current={roles.roles[role] ?? null}
         models={candidates}
         catalog={catalog}
         myModels={myModels}
         onToggleStar={(s) => setMyModels(toggleMyModel(myModels, s))}
         disabled={savingRole}
         onSave={saveRole}
        />
       ))}
      </>
     )}
    </div>
   </section>

   {/* 失败转移：omp retry.fallbackChains（模型请求失败时由备用模型接管）+ 两个配套开关 */}
   <FallbackChainsSection
    info={chains}
    models={candidates}
    catalog={catalog}
    roles={roleKeys}
    myModels={myModels}
    onToggleMyModel={(s) => setMyModels(toggleMyModel(myModels, s))}
    busy={busy}
    loadError={chainsError}
    onSaved={(info) => { chainsRevision.current += 1; setChains(info); }}
    onRefresh={() => void refreshAll()}
   />
  </>
 );
}

/** 一行角色：角色名 + 当前 selector（模型 + 档位）+ 档位按钮 + 「选择」按钮（开模型选择弹窗）。
 *  模型列表走 `ModelPickerDialog`——行内展开会把下方角色整体推下去（点开 / 关上时页面跳动）。 */
function RoleRow({
 role,
 label,
 current,
 models,
 catalog,
 myModels,
 onToggleStar,
 disabled,
 onSave,
}: {
 role: string;
 label: string;
 current: string | null;
 models: ModelInfo[];
 catalog: ModelInfo[];
 myModels: string[];
 onToggleStar: (selector: string) => void;
 disabled: boolean;
 onSave: (role: string, selector: string | null) => Promise<void>;
}) {
 const t = useText();
 const [pickerOpen, setPickerOpen] = useState(false);
 const [levelOpen, setLevelOpen] = useState(false);
 const [saving, setSaving] = useState(false);
 const lvRef = useDropdown(levelOpen, () => setLevelOpen(false));

 // 角色值 = 模型 selector + 可选的 `:思考档` 后缀；两截分开显示、分开改
 const { base, level } = splitSelector(current ?? "");
 // 档位候选按该模型声明的档裁剪；目录里查不到（自定义 / 角色别名）退回全集——不挡用户，
 // 非法档 omp 自己会忽略，但界面不给一个必然无效的窄集合
 const model = catalog.find((m) => m.selector === base);
 const levels = model ? thinkingLevelsOf(model.thinking) : [...THINKING_ORDER];
 // 明确不支持思考的模型（可用档只有 off）不显示档位按钮，免得点开只有「默认 / off」两项
 const canLevel = current !== null && levels.length > 1;

 const pick = async (m: ModelInfo) => {
  setPickerOpen(false);
  setSaving(true);
  await onSave(role, m.selector);
  setSaving(false);
 };

 const setLevel = async (lv: string | null) => {
  setLevelOpen(false);
  setSaving(true);
  await onSave(role, withLevel(base, lv));
  setSaving(false);
 };

 const clear = async () => {
  setSaving(true);
  await onSave(role, null);
  setSaving(false);
 };

 return (
  <div className="border-t border-border-soft py-4 first:border-t-0">
   <div className="flex flex-wrap items-center gap-2">
    <div className="min-w-0 basis-full @min-[600px]/panel:w-32 @min-[600px]/panel:basis-auto">
     <div className="truncate text-sm">{label}</div>
     {label !== role && <div className="font-mono text-xs text-muted">{role}</div>}
    </div>
    <div className="min-w-0 basis-full font-mono text-xs break-all @min-[600px]/panel:flex-1 @min-[600px]/panel:basis-0">
     {current ? (
      <span>
       {base}
       {level && <span className="ml-1 rounded border border-border px-1 text-[10px]">{level}</span>}
      </span>
     ) : (
      <span className="text-muted">{t.roleUnset}</span>
     )}
    </div>
    {canLevel && (
     <button
      onClick={() => { setPickerOpen(false); setLevelOpen((v) => !v); }}
      disabled={saving || disabled}
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={fmt(t.roleLevelAria, label)}
      aria-expanded={levelOpen}
      title={t.roleLevelDefaultHint}
     >
      {level ?? t.roleLevelDefault}
     </button>
    )}
    <button
     onClick={() => { setLevelOpen(false); setPickerOpen(true); }}
     disabled={saving || disabled}
     className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     aria-label={fmt(t.rolePick + " {0}", label)}
     aria-haspopup="dialog"
    >
     {t.rolePick}
    </button>
    {current && (
     <button
      onClick={() => void clear()}
      disabled={saving || disabled}
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-50"
      aria-label={fmt(t.roleClear + " {0}", label)}
     >
      {t.roleClear}
     </button>
    )}
    {saving && <Loader size={12} className="shrink-0 animate-spin text-muted" aria-hidden />}
   </div>

   {/* 思考档：行内芯片排（设置页是可滚动容器，浮层会被裁掉）；
       「默认」= 不写后缀，交给 omp 自己的 defaultThinkingLevel */}
   {levelOpen && (
    <div ref={lvRef} className="mt-2 flex flex-wrap gap-1 rounded-md border border-border bg-background p-2">
     <button
      onClick={() => void setLevel(null)}
      aria-pressed={level === null}
      title={t.roleLevelDefaultHint}
      className={`cursor-pointer rounded-md border px-2 py-0.5 text-[12px] transition-colors duration-100 ${level === null
       ? "border-accent/50 bg-active text-foreground"
       : "border-border text-muted hover:bg-hover hover:text-foreground"
       }`}
     >
      {t.roleLevelDefault}
     </button>
     {levels.map((lv) => (
      <button
       key={lv}
       onClick={() => void setLevel(lv)}
       aria-pressed={level === lv}
       className={`cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[12px] transition-colors duration-100 ${level === lv
        ? "border-accent/50 bg-active text-foreground"
        : "border-border text-muted hover:bg-hover hover:text-foreground"
        }`}
      >
       {lv}
      </button>
     ))}
    </div>
   )}

   {pickerOpen && (
    <ModelPickerDialog
     title={fmt(t.pickModelTitle + " · {0}", label)}
     models={models}
     selected={base}
     onPick={(m) => void pick(m)}
     onClose={() => setPickerOpen(false)}
     myModels={myModels}
     onToggleStar={onToggleStar}
    />
   )}
  </div>
 );
}
