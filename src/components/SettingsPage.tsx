import { Loader2, RefreshCw, FolderSearch, Copy, Check, Languages } from "lucide-react";
import { useApp } from "../stores/app";
import { checkForUpdate, getAppVersion, openUpdateDialog } from "../lib/appUpdate";
import { pickOmpExecutable, refreshOmpHealth } from "../lib/ompDiag";
import { LOCALES, fmt, type Locale } from "../lib/locale";
import { useText } from "../lib/useText";
import { useEffect, useState } from "react";
import { ArchivedSessions } from "./ArchivedSessions";

/** 设置页分页签；顺序即界面顺序。 */
const TABS = ["general", "archived"] as const;

export function SettingsPage() {
  const { health, set, update, locale, setLocale } = useApp();
  const t = useText();
  const [version, setVersion] = useState("…");
  const [diagError, setDiagError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>("general");

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

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-hidden px-4 pt-8 pb-6">
      <h1 className="shrink-0 text-xl font-semibold">{t.title}</h1>
      <p className="shrink-0 text-sm text-muted">{t.subtitle}</p>
      {/* 分页签：设置页从此有两块——通用（本应用的诊断 / 更新 / 语言）与已归档对话（归档管理面）。
          归档对话不再出现在左栏项目列表里，这块就是它们唯一的入口。 */}
      <div role="tablist" aria-label={t.title} className="flex shrink-0 gap-1 border-b border-border">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-sm transition-colors duration-150 ${tab === k ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
          >
            {k === "general" ? t.tabGeneral : t.tabArchived}
          </button>
        ))}
      </div>
      {/* tab 内容区是唯一的滚动容器：外层只定高（底边距 24px），滚动条不出设置页外框。 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-1">
        {tab === "archived" ? (
          <ArchivedSessions />
        ) : (
          <>
            <section aria-label={t.languageSection} className="rounded border border-border bg-surface p-3">
              <div className="flex items-center gap-2">
                <Languages size={14} aria-hidden className="text-muted" />
                <h2 className="text-sm font-medium">{t.languageSection}</h2>
              </div>
              <div className="mt-2 flex gap-2" role="radiogroup" aria-label={t.languageSection}>
                {LOCALES.map((l: Locale) => {
                  const selected = locale === l;
                  return (
                    <button
                      key={l}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setLocale(l)}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors duration-150 ${selected
                        ? "border-accent/60 bg-accent/10 text-foreground"
                        : "border-border text-muted hover:bg-background hover:text-foreground"
                        }`}
                    >
                      {l === "zh-CN" ? "简体中文" : "English"}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted/70">{t.languageHint}</p>
            </section>
            <section aria-label={t.diagSection} className="rounded border border-border bg-surface p-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">{t.diagSection}</h2>
                <span className={`font-mono text-xs ${health?.ok ? "text-ok" : "text-warn"}`}>
                  {health?.ok ? t.diagOk : t.diagBad}
                </span>
                <button
                  onClick={() => void runDiag(refreshOmpHealth)}
                  className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-background"
                  aria-label={t.recheck}
                >
                  <RefreshCw size={12} aria-hidden />
                  {t.recheck}
                </button>
                <button
                  onClick={() => void runDiag(pickOmpExecutable)}
                  className="flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-background"
                  aria-label={t.pickPath}
                  title={t.pickPathTitle}
                >
                  <FolderSearch size={12} aria-hidden />
                  {t.pickPath}
                </button>
              </div>
              <dl className="mt-2 space-y-1 text-xs">
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
                      className="shrink-0 cursor-pointer rounded border border-border p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground"
                      aria-label={t.copyAgentDir}
                      title={t.copyPath}
                    >
                      {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
                    </button>
                  </dd>
                </div>
              </dl>
              {(health?.omp.errors.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-warn">
                  {health?.omp.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {health?.modelsError && <p className="mt-1 text-xs text-warn">{health.modelsError}</p>}
              {diagError && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {diagError}
                </p>
              )}
              <p className="mt-1.5 text-xs text-muted/70">{t.diagFoot}</p>
            </section>

            <section aria-label={t.updateSection} className="rounded border border-border bg-surface p-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">{t.updateSection}</h2>
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
                  className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background disabled:opacity-50"
                  aria-label={t.checkUpdate}
                >
                  {checking ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
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
              <p className="mt-1 text-xs text-muted">{t.updateFoot}</p>
            </section>
          </>
        )}
      </div>

      <div className="shrink-0">
        <button
          onClick={() => set({ settingsOpen: false })}
          className="cursor-pointer rounded border border-border px-4 py-2 text-sm transition-colors duration-200 hover:bg-background"
        >
          {t.back}
        </button>
      </div>
    </div>
  );
}
