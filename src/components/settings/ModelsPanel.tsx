import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader, Refresh, Sliders, Star } from "reicon-react";
import { api } from "@shared/api";
import type { FallbackChainsInfo, ModelInfo, ModelRolesInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { candidateModels, myModelEntries, toggleMyModel } from "../../lib/myModels";
import { fmt } from "../../lib/locale";
import { splitSelector, withLevel } from "../../lib/modelSelector";
import { roleLabel } from "../../lib/roleNames";
import { thinkingLevelsOf, THINKING_ORDER } from "../../lib/thinking";
import { useText } from "../../lib/useText";
import { useDropdown } from "../../lib/useDropdown";
import { CycleOrderSection } from "./CycleOrderSection";
import { FallbackChainsSection } from "./FallbackChains";
import { ModelPickList } from "./ModelPickList";
import { ProvidersSection } from "./ProvidersSection";
import { StarToggle } from "./StarToggle";

/**
 * 设置 › 模型：omp 模型相关的**唯一管理面**（V12b 把原「供应商」页签整体并了进来）。
 * 区块顺序 = 使用动线：**供应商 → 我的模型 → 模型角色 → 失败转移**（先添加供应商，再在弹窗里
 * 挑选模型——挑进的进「我的模型」，角色与转移的候选随之收窄）。
 *
 * 口径：
 * - **我的模型**（本应用偏好，localStorage；`src/lib/myModels.ts`）是「小范围」的唯一开关：
 *   挑过之后，本页**模型角色**与**失败转移目标**的候选只列这些（`candidateModels`）；
 *   一个都没挑时列全部可用模型（不挡新人）。**不写 omp 的 `enabledModels`**——omp 终端里
 *   `/model` 的可选范围不受影响。挑选入口 = 供应商行的「挑选模型」弹窗（V12c 起不再有
 *   平铺的「可用模型」目录——目录在弹窗里按供应商列出，带搜索过滤）。
 * - 模型角色写 omp 全局配置（`omp config set modelRoles`，record 整表读写 + 回读），未配置的
 *   角色按 omp 自己的回退规则解析，本页不复制那套规则；角色值可带 `:思考档` 后缀，
 *   档位候选按该模型声明的档裁剪。
 * - **omp 侧改完切回来就该看到**：角色与转移链在挂载时拉一次、**每次设置标签重新激活时重读**
 *   （终端标签里的 omp 改过 `modelRoles` 后，点回设置标签即刷新）；模型目录不额外重拉——
 *   `get_models` 后端有 5 分钟缓存，页内的「刷新」按钮才走 `refresh_models` 强制重拉。
 * - 失败转移链（`retry.fallbackChains`）与角色同层，口径见 `FallbackChains.tsx`。
 * - **快速切换环**（`cycleOrder`）决定 omp 终端里 Ctrl+P / Shift+Ctrl+P 的轮换序，
 *   条目是角色；与角色行同款「每次操作立即写回 + 回读」，口径见 `CycleOrderSection.tsx`。
 * - 供应商（登录型 + 自定义）合并成一个「添加供应商」弹窗：登录型走 `omp auth-broker`
 *   （凭证进 omp 凭证库），自定义写 `<agentDir>/models.yml`——见 `ProvidersSection.tsx`。
 */
export function ModelsPanel() {
 const t = useText();
 const { models, set, myModels, setMyModels, settingsTabActive } = useApp();
 const [roles, setRoles] = useState<ModelRolesInfo | null>(null);
 const [chains, setChains] = useState<FallbackChainsInfo | null>(null);
 const [cycleOrder, setCycleOrder] = useState<string[] | null>(null);
 const [err, setErr] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const requestSeq = useRef(0);
 const rolesRevision = useRef(0);
 const chainsRevision = useRef(0);
 const cycleRevision = useRef(0);
 const roleWriting = useRef(false);
 const cycleWriting = useRef(false);
 const [savingRole, setSavingRole] = useState(false);
 const [savingCycle, setSavingCycle] = useState(false);

 /** 重读只接纳最新请求；写入后的真值不能被更早发出的读请求覆盖。 */
 const load = useCallback(async (force: boolean) => {
  const seq = ++requestSeq.current;
  const roleVersion = rolesRevision.current;
  const chainVersion = chainsRevision.current;
  const cycleVersion = cycleRevision.current;
  const res = await Promise.allSettled([
   api.getModelRoles(),
   api.getFallbackChains(),
   api.getCycleOrder(),
   force ? api.refreshModels() : api.getModels(),
  ]);
  if (seq !== requestSeq.current) return;
  if (res[0].status === "fulfilled" && roleVersion === rolesRevision.current && !roleWriting.current) setRoles(res[0].value);
  if (res[1].status === "fulfilled" && chainVersion === chainsRevision.current) setChains(res[1].value);
  if (res[2].status === "fulfilled" && cycleVersion === cycleRevision.current && !cycleWriting.current) setCycleOrder(res[2].value);
  if (res[3].status === "fulfilled") set({ models: res[3].value });
  const bad = res.find((r) => r.status === "rejected");
  setErr(bad?.status === "rejected"
   ? bad.reason instanceof Error ? bad.reason.message : String(bad.reason || t.modelsLoadFailed)
   : res[3].status === "fulfilled" ? res[3].value.error ?? null : null);
 }, [set, t.modelsLoadFailed]);

 // 挂载时拉一次；**每次设置标签重新激活**（从终端标签切回来）都重读——omp 侧（TUI / CLI）
 // 改过的模型角色与转移链，切回设置页就该看到，不该要求用户先点「刷新」或重开设置标签。
 // 模型目录走 `get_models` 的 5 分钟缓存（`models` 已在 store 里时不强制重拉），这轮重读很轻。
 useEffect(() => {
  if (!settingsTabActive) return;
  void load(!models);
  return () => { requestSeq.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载与激活态翻转时重读
 }, [settingsTabActive]);

 /** 角色编辑：后端写整表并回读，返回的就是写入后的真相。 */
 const saveRole = async (role: string, selector: string | null) => {
  if (roleWriting.current) return;
  roleWriting.current = true;
  rolesRevision.current += 1;
  setSavingRole(true);
  setErr(null);
  try {
   setRoles(await api.setModelRole(role, selector));
  } catch (e) {
   setErr(e instanceof Error ? e.message : String(e || t.roleSetFailed));
  } finally {
   rolesRevision.current += 1;
   roleWriting.current = false;
   setSavingRole(false);
  }
 };

 /** 快速切换环编辑：整组写回并回读（与角色同款——写入后的真值不能被更早发出的读覆盖）。 */
 const saveCycleOrder = async (order: string[]) => {
  if (cycleWriting.current) return;
  cycleWriting.current = true;
  cycleRevision.current += 1;
  setSavingCycle(true);
  setErr(null);
  try {
   setCycleOrder(await api.setCycleOrder(order));
  } catch (e) {
   setErr(e instanceof Error ? e.message : String(e || t.cycleWriteFailed));
  } finally {
   cycleRevision.current += 1;
   cycleWriting.current = false;
   setSavingCycle(false);
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
 /** 模型选择器的候选（「小范围」的唯一实现点）：我的模型非空 → 只列挑过的；空 → 全部。 */
 const candidates = useMemo(() => candidateModels(catalog, myModels), [catalog, myModels]);
 /** 我的模型（按挑选顺序解析，含已不可用项——设置页要列出来给人清理）。 */
 const entries = useMemo(() => myModelEntries(myModels, catalog), [myModels, catalog]);

 return (
  <>
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
    <p className="mt-2 text-[13px] leading-relaxed text-faint">{t.myModelsHint}</p>
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

   {/* 模型角色：把 omp 的 modelRoles 读写给用户（候选 = 我的模型 或 全部） */}
   <section aria-label={t.rolesSection} className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
    <div className="flex flex-wrap items-center gap-2">
     <Sliders size={16} aria-hidden className="text-muted" />
     <h2 className="text-sm font-semibold">{t.rolesSection}</h2>
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
    <p className="mt-2 text-[13px] leading-relaxed text-faint">{t.rolesHint}</p>
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
        models={candidates}
        catalog={catalog}
        disabled={savingRole}
        onSave={saveRole}
       />
      ))
     )}
    </div>
   </section>

   {/* 快速切换环：omp cycleOrder——Ctrl+P / Shift+Ctrl+P 的轮换序（条目是角色） */}
   <CycleOrderSection
    order={cycleOrder}
    roles={roleKeys}
    selectors={roles?.roles ?? {}}
    busy={busy}
    saving={savingCycle}
    onSave={saveCycleOrder}
    onRefresh={() => void refreshAll()}
   />

   {/* 失败转移：omp retry.fallbackChains（模型请求失败时由备用模型接手）+ 两个配套开关 */}
   <FallbackChainsSection
    info={chains}
    models={candidates}
    catalog={catalog}
    roles={roleKeys}
    busy={busy}
    onSaved={(info) => { chainsRevision.current += 1; setChains(info); }}
    onRefresh={() => void refreshAll()}
   />
  </>
 );
}

/** 一行角色：角色名 + 当前 selector（模型 + 档位）+ 档位按钮 + 内联展开的模型选择器。
 *  撑开布局、不做浮层——设置页是可滚动容器，浮层会被裁掉。 */
function RoleRow({
 role,
 label,
 current,
 models,
 catalog,
 disabled,
 onSave,
}: {
 role: string;
 label: string;
 current: string | null;
 models: ModelInfo[];
 catalog: ModelInfo[];
 disabled: boolean;
 onSave: (role: string, selector: string | null) => Promise<void>;
}) {
 const t = useText();
 const [open, setOpen] = useState(false);
 const [levelOpen, setLevelOpen] = useState(false);
 const [saving, setSaving] = useState(false);
 const ref = useDropdown(open, () => setOpen(false));
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
  setOpen(false);
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
      onClick={() => { setOpen(false); setLevelOpen((v) => !v); }}
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
     onClick={() => { setLevelOpen(false); setOpen((v) => !v); }}
     disabled={saving || disabled}
     className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     aria-label={fmt(t.rolePick + " {0}", label)}
     aria-expanded={open}
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

   {open && (
    <div ref={ref} className="mt-2 rounded-md border border-border bg-background p-2">
     <ModelPickList models={models} selected={base} onPick={(m) => void pick(m)} />
    </div>
   )}
  </div>
 );
}
