import { useCallback, useEffect, useMemo, useState } from "react";
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
import { FallbackChainsSection } from "./FallbackChains";
import { ModelPickList } from "./ModelPickList";
import { ProvidersSection } from "./ProvidersSection";
import { StarToggle } from "./StarToggle";

/**
 * 设置 › 模型：omp 模型相关的**唯一管理面**（V12b 把原「供应商」页签整体并了进来）。
 * 区块顺序 = 使用动线：**我的模型 → 供应商 → 模型角色 → 失败转移**。
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
 * - 失败转移链（`retry.fallbackChains`）与角色同层，口径见 `FallbackChains.tsx`。
 * - 供应商（登录型 + 自定义）合并成一个「添加供应商」弹窗：登录型走 `omp auth-broker`
 *   （凭证进 omp 凭证库），自定义写 `<agentDir>/models.yml`——见 `ProvidersSection.tsx`。
 */
export function ModelsPanel() {
 const t = useText();
 const { models, set, myModels, setMyModels } = useApp();
 const [roles, setRoles] = useState<ModelRolesInfo | null>(null);
 const [chains, setChains] = useState<FallbackChainsInfo | null>(null);
 const [err, setErr] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);

 /** 拉角色表 + 失败转移链 + 模型目录；`force` 时强制刷新目录。
  *  写成 promise 链（而不是在 effect 里同步调用）——state 只在回调里更新，
  *  符合 react-hooks 对「effect 内同步 setState 会级联渲染」的约束。 */
 const load = useCallback(
  (force: boolean) =>
   Promise.allSettled([
    api.getModelRoles().then((r) => setRoles(r)),
    api.getFallbackChains().then((c) => setChains(c)),
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

   {/* 我的模型：本应用偏好；挑过之后下面角色 / 转移的候选只列这些 */}
   <section aria-label={t.myModelsSection} className="rounded-md border border-border bg-surface p-3.5">
    <div className="flex items-center gap-2">
     <Star size={14} aria-hidden className="text-muted" />
     <h2 className="text-sm font-medium">{t.myModelsSection}</h2>
     {entries.length > 0 && (
      <span className="text-[13px] text-muted">{fmt(t.myModelsCount, String(entries.length))}</span>
     )}
     {entries.length > 0 && (
      <button
       onClick={() => setMyModels([])}
       className="ml-auto cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       {t.myModelsClear}
      </button>
     )}
    </div>
    <p className="mt-1.5 text-[13px] text-faint">{t.myModelsHint}</p>
    <div className="mt-2">
     {entries.length === 0 ? (
      <p className="py-2 text-[13px] text-muted">{t.myModelsEmpty}</p>
     ) : (
      entries.map(({ selector, model }) => (
       <div key={selector} className="flex items-center gap-2 border-t border-border-soft py-2 first:border-t-0">
        <StarToggle on name={model?.name ?? selector} onClick={() => setMyModels(toggleMyModel(myModels, selector))} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{model?.name ?? selector}</span>
        {model && <span className="shrink-0 font-mono text-xs text-muted">{selector}</span>}
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

   {/* 供应商：添加（登录型 API key / OAuth + 自定义 models.yml）+ 按供应商挑选模型 */}
   <ProvidersSection />

   {/* 模型角色：把 omp 的 modelRoles 读写给用户（候选 = 我的模型 或 全部） */}
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
        models={candidates}
        onSave={saveRole}
       />
      ))
     )}
    </div>
   </section>

   {/* 失败转移：omp retry.fallbackChains（模型请求失败时由备用模型接手）+ 两个配套开关 */}
   <FallbackChainsSection
    info={chains}
    models={candidates}
    roles={roleKeys}
    busy={busy}
    onSaved={setChains}
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
 const [levelOpen, setLevelOpen] = useState(false);
 const [saving, setSaving] = useState(false);
 const ref = useDropdown(open, () => setOpen(false));
 const lvRef = useDropdown(levelOpen, () => setLevelOpen(false));

 // 角色值 = 模型 selector + 可选的 `:思考档` 后缀；两截分开显示、分开改
 const { base, level } = splitSelector(current ?? "");
 // 档位候选按该模型声明的档裁剪；目录里查不到（自定义 / 角色别名）退回全集——不挡用户，
 // 非法档 omp 自己会忽略，但界面不给一个必然无效的窄集合
 const model = models.find((m) => m.selector === base);
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
  <div className="border-t border-border-soft py-2 first:border-t-0">
   <div className="flex items-center gap-2">
    <div className="min-w-0 w-32 shrink-0">
     <div className="truncate text-sm">{label}</div>
     {label !== role && <div className="font-mono text-xs text-muted">{role}</div>}
    </div>
    <div className="min-w-0 flex-1 font-mono text-xs break-all">
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
      onClick={() => setLevelOpen((v) => !v)}
      disabled={saving}
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={fmt(t.roleLevelAria, label)}
      aria-expanded={levelOpen}
      title={t.roleLevelDefaultHint}
     >
      {level ?? t.roleLevelDefault}
     </button>
    )}
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
     <ModelPickList models={models} onPick={(m) => void pick(m)} />
    </div>
   )}
  </div>
 );
}
