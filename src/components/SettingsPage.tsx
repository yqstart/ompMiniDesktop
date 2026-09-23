import { Archive, ChartBar, Check, Copy, FolderError, Gauge, InfoCircle, Key, Loader, Notebook, Refresh, Sliders } from "reicon-react";
import { useApp } from "../stores/app";
import { checkForUpdate, getAppVersion, openUpdateDialog } from "../lib/appUpdate";
import { pickOmpExecutable, refreshOmpHealth } from "../lib/ompDiag";
import { fmt } from "../lib/locale";
import { useText } from "../lib/useText";
import { useEffect, useRef, useState } from "react";
import { ArchivedSessions } from "./ArchivedSessions";
import { GeneralSettingsPanel } from "./settings/GeneralSettingsPanel";
import { MemoryPanel } from "./settings/MemoryPanel";
import { ModelsPanel } from "./settings/ModelsPanel";
import { ProviderUsagePanel } from "./settings/ProviderUsagePanel";
import { UsagePanel } from "./settings/UsagePanel";

/** 设置页分页签；顺序即界面顺序。 */
type SettingsTab = "general" | "models" | "memories" | "providerUsage" | "about" | "usage" | "archived";
const TAB_ICONS = {
 general: Sliders,
 models: Key,
 memories: Notebook,
 providerUsage: Gauge,
 about: InfoCircle,
 usage: ChartBar,
 archived: Archive,
};
/**
 * 左栏两组（组标题 + 组间分隔线）：上组读写的是 **omp** 的配置与数据，
 * 下组是本应用自己的信息与设置（更新 / 诊断、会话统计、归档管理）。
 * 页内的快捷定位 chips 已删——区块不多，左栏切页就是唯一导航。
 */
const TAB_GROUPS: { label: "settingsGroupOmp" | "settingsGroupApp"; tabs: SettingsTab[] }[] = [
 { label: "settingsGroupOmp", tabs: ["general", "models", "memories", "providerUsage"] },
 { label: "settingsGroupApp", tabs: ["about", "usage", "archived"] },
];

export function SettingsPage({ visible = true }: { visible?: boolean }) {
 const { health, update } = useApp();
 const t = useText();
 const [version, setVersion] = useState("…");
 const [diagError, setDiagError] = useState<string | null>(null);
 const [copied, setCopied] = useState(false);
 const [tab, setTab] = useState<SettingsTab>("general");
 const pageRef = useRef<HTMLDivElement>(null);
 const panelRef = useRef<HTMLDivElement>(null);
 const lastFocusRef = useRef<HTMLElement | null>(null);

 useEffect(() => {
  panelRef.current?.scrollTo({ top: 0 });
 }, [tab]);

 useEffect(() => {
  const page = pageRef.current;
  if (!page) return;
  const active = document.activeElement;
  if (!visible) {
   if (active instanceof HTMLElement && page.contains(active)) active.blur();
   return;
  }
  if (page.contains(active) || active?.closest('[role="dialog"][aria-modal="true"]')) return;
  const previous = lastFocusRef.current;
  const target = previous?.isConnected && !previous.matches(":disabled")
   ? previous
   : page.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
   ?? page.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  target?.focus({ preventScroll: true });
 }, [visible]);

 useEffect(() => {
  void getAppVersion().then(setVersion);
 }, []);

 const runDiag = async (fn: () => Promise<{ ok: boolean; message?: string } | null>) => {
  const res = await fn();
  setDiagError(res && !res.ok ? (res.message ?? t.opFailed) : null);
 };

 const copyAgentDir = async () => {
  const p = health?.omp.agentDir;
  if (!p) return;
  try {
   await navigator.clipboard.writeText(p);
   setCopied(true);
   window.setTimeout(() => setCopied(false), 1500);
  } catch {
   setDiagError(t.copyFailed);
  }
 };

 const checking = update.status === "checking";
 const updateHint =
  update.status === "latest"
   ? fmt(t.updateLatest, update.current)
   : update.status === "available"
    ? fmt(t.updateAvailable, update.version)
    : update.status === "downloading"
     ? t.updateDownloading
     : update.status === "ready"
      ? fmt(t.updateReady, update.version)
      : update.status === "error"
       ? fmt(t.updateError, update.message)
       : null;

 // 设置标签面板：切到终端标签只隐藏（页签选择、滚动位置都保留），关闭标签才卸载
 return (
  <div
   ref={pageRef}
   inert={!visible}
   aria-hidden={!visible}
   onFocusCapture={(event) => {
    if (event.target instanceof HTMLElement) lastFocusRef.current = event.target;
   }}
   className={
    visible
     ? "@container/settings mx-auto flex min-h-0 min-w-0 w-full max-w-6xl flex-1 gap-3 overflow-hidden p-3 sm:gap-5 sm:p-5"
     : "hidden"
   }
  >
   {/* 左栏：竖向菜单（无标题行，菜单从顶端开始），分「omp」与「本应用」两组——组标题在窄导航
          （44px）下收进 sr-only，组间分隔线保留。设置是标签栏里的标签——关闭走标签栏的 × / ⌘W
          （`closeSettingsTab`，回到上次的终端标签），页内不放第二个关闭入口。
          omp 组：常用设置（`omp config` 白名单 41 项）、模型（**omp 模型相关唯一管理面**：
          供应商 / 我的模型 / 模型角色 / 快速切换环 / 失败转移）、记忆（omp 项目记忆的
          查看 / 删除）、供应商用量（omp usage 的滚动窗口，只读）。
          本应用组：关于（本应用更新与 omp 运行环境诊断；
          界面语言与皮肤是纯展示层偏好，入口在左栏底部「设置」行，这里不重复放）、
          使用统计（会话 jsonl 的用量聚合，只读）、已归档对话（归档管理面，归档会话不在左栏出现）。 */}
   <nav aria-label={t.title} className="flex w-11 shrink-0 flex-col border-r border-border-soft pr-2 @min-[640px]/settings:w-40 @min-[640px]/settings:pr-3">
    <div
     role="tablist"
     aria-orientation="vertical"
     aria-label={t.title}
     className="flex flex-col gap-1"
     onKeyDown={(event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      const next = event.key === "Home" ? 0
       : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowDown" ? (index + 1) % tabs.length
         : event.key === "ArrowUp" ? (index - 1 + tabs.length) % tabs.length
          : null;
      if (next === null) return;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
     }}
    >
     {TAB_GROUPS.map(({ label: groupKey, tabs }, gi) => (
      <div key={groupKey} className={`flex flex-col gap-1 ${gi > 0 ? "mt-3 border-t border-border-soft pt-3" : ""}`}>
       {/* 组标题：窄导航（44px）放不下文字，收进 sr-only（分组语义仍由 aria 保留） */}
       <p className="sr-only text-[11px] font-medium text-faint @min-[640px]/settings:not-sr-only @min-[640px]/settings:px-3 @min-[640px]/settings:pb-1">
        {t[groupKey]}
       </p>
       {tabs.map((k) => {
        const Icon = TAB_ICONS[k];
        const label = k === "general" ? t.tabGeneral : k === "models" ? t.tabModels : k === "memories" ? t.tabMemories : k === "providerUsage" ? t.tabProviderUsage : k === "about" ? t.tabAbout : k === "usage" ? t.tabUsage : t.tabArchived;
        return (
         <button
          key={k}
          id={`settings-tab-${k}`}
          role="tab"
          tabIndex={tab === k ? 0 : -1}
          aria-selected={tab === k}
          aria-controls="settings-panel"
          title={label}
          onClick={() => setTab(k)}
          className={`flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-md text-left text-[13px] transition-colors duration-100 @min-[640px]/settings:justify-start @min-[640px]/settings:px-3 ${tab === k
           ? "bg-active font-semibold text-accent"
           : "text-muted hover:bg-hover hover:text-foreground"
           }`}
         >
          <Icon size={16} className="shrink-0" aria-hidden />
          <span className="sr-only @min-[640px]/settings:not-sr-only">{label}</span>
         </button>
        );
       })}
      </div>
     ))}
    </div>
   </nav>
   {/* tab 内容区是唯一的滚动容器：外层只定高（底边距 24px），滚动条不出设置页外框。 */}
   <div
    ref={panelRef}
    id="settings-panel"
    role="tabpanel"
    tabIndex={0}
    aria-labelledby={`settings-tab-${tab}`}
    className="@container/panel flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto pb-1 [overflow-wrap:anywhere] [scrollbar-gutter:stable]"
   >
    {tab === "archived" ? (
     <ArchivedSessions />
    ) : tab === "models" ? (
     <ModelsPanel />
    ) : tab === "memories" ? (
     <MemoryPanel />
    ) : tab === "usage" ? (
     <UsagePanel />
    ) : tab === "providerUsage" ? (
     <ProviderUsagePanel />
    ) : tab === "general" ? (
     <>
      <div className="shrink-0">
       <h2 className="text-[20px] font-semibold tracking-tight">{t.tabGeneral}</h2>
       <p className="mt-1 text-[13px] text-muted">{t.tabGeneralHint}</p>
      </div>
      <GeneralSettingsPanel />
     </>
    ) : (
     <>
      <div className="shrink-0">
       <h2 className="text-[20px] font-semibold tracking-tight">{t.tabAbout}</h2>
       <p className="mt-1 text-[13px] text-muted">{t.tabAboutHint}</p>
      </div>

      <section aria-label={t.updateSection} className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
       <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{t.updateSection}</h2>
        <span className="font-mono text-xs text-muted">
         {t.current} v{version}
        </span>
        <button
         onClick={() =>
          void checkForUpdate("manual").then((r) => {
           if (r === "available") openUpdateDialog();
          })
         }
         disabled={checking}
         className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
         aria-label={t.checkUpdate}
        >
         {checking ? <Loader size={14} className="animate-spin" aria-hidden /> : <Refresh size={14} aria-hidden />}
         {t.checkUpdate}
        </button>
       </div>
       {updateHint && (
        <div className="mt-2 text-sm text-muted">
         {updateHint}
         {(update.status === "available" || update.status === "ready") && (
          <button onClick={openUpdateDialog} className="ml-2 cursor-pointer text-accent">
           {t.viewDetail}
          </button>
         )}
        </div>
       )}
       <p className="mt-3 text-[13px] leading-relaxed text-muted">{t.updateFoot}</p>
      </section>

      <section aria-label={t.diagSection} className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
       <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{t.diagSection}</h2>
        <span className={`rounded-sm px-2 py-0.5 font-mono text-[11px] ${health?.ok ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"}`}>
         {health?.ok ? t.diagOk : t.diagBad}
        </span>
        <button
         onClick={() => void runDiag(refreshOmpHealth)}
         className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
         aria-label={t.recheck}
        >
         <Refresh size={12} aria-hidden />
         {t.recheck}
        </button>
        <button
         onClick={() => void runDiag(pickOmpExecutable)}
         className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
         aria-label={t.pickPath}
         title={t.pickPathTitle}
        >
         <FolderError size={12} aria-hidden />
         {t.pickPath}
        </button>
       </div>
       <dl className="mt-4 space-y-3 rounded-md bg-background p-3 text-[13px]">
        <div className="flex gap-2">
         <dt className="w-20 shrink-0 text-muted">{t.ompPath}</dt>
         <dd className="min-w-0 flex-1 font-mono break-all">{health?.omp.ompPath ?? t.notFound}</dd>
        </div>
        <div className="flex gap-2">
         <dt className="w-20 shrink-0 text-muted">{t.version}</dt>
         <dd className="min-w-0 flex-1 font-mono break-all">{health?.omp.ompVersion ?? t.unknown}</dd>
        </div>
        <div className="flex gap-2">
         <dt className="w-20 shrink-0 text-muted">agentDir</dt>
         <dd className="flex min-w-0 flex-1 items-start gap-1.5">
          <span className="min-w-0 flex-1 font-mono break-all">{health?.omp.agentDir ?? t.unknown}</span>
          <button
           onClick={() => void copyAgentDir()}
           className="shrink-0 cursor-pointer rounded-md border border-border p-1 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
           aria-label={t.copyAgentDir}
           title={t.copyPath}
          >
           {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
          </button>
         </dd>
        </div>
       </dl>
       {(health?.omp.errors.length ?? 0) > 0 && (
        <ul className="mt-2 space-y-0.5 text-[13px] text-warn">
         {health?.omp.errors.map((e) => (
          <li key={e}>{e}</li>
         ))}
        </ul>
       )}
       {health?.modelsError && <p className="mt-1 text-[13px] text-warn">{health.modelsError}</p>}
       {diagError && (
        <p role="alert" className="mt-1 text-[13px] text-danger">
         {diagError}
        </p>
       )}
       <p className="mt-3 text-[13px] leading-relaxed text-faint">{t.diagFoot}</p>
      </section>
     </>
    )}
   </div>
  </div>
 );
}
