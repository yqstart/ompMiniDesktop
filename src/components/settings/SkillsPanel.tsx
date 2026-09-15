import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, ChevronRight, Copy, FolderOpen, Loader, Puzzle, Refresh } from "reicon-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "@shared/api";
import { MarkdownLink } from "../MarkdownLink";
import type { SkillFileContent, SkillItem, SkillWarning, SkillsView } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { scopeChoices, scopeValue } from "../../lib/panelScope";
import { groupSkills, skillSourceLabel, sortDisabled } from "../../lib/skills";
import { EnumSelect } from "./EnumSelect";
import { Switch } from "./Switch";

/** 行内预览状态：`key` = 技能的 `SKILL.md` 路径，一次只展开一个。 */
type Preview =
 | { key: string; state: "loading" }
 | { key: string; state: "ok"; content: SkillFileContent }
 | { key: string; state: "error"; message: string };

/**
 * 设置 ›「技能」：omp 技能（`omp skill list`）的发现结果 + 逐项启停。
 *
 * 口径（上游实测见 `docs/v23-schedule.md`）：
 * - **发现范围 = cwd**：项目级技能由 omp 从该目录向上走到仓库根逐级发现（`.omp/skills`、
 *   `.agents/skills`、`.claude/skills`…），所以页首有「全局 / 某个项目」的范围选择。
 * - **启停写的是全局配置的 `disabledExtensions`（`skill:<名字>`），按名字对所有项目生效**——
 *   上游在发现阶段就按名字过滤，**被停用的技能不再出现在 `omp skill list` 里**，所以「已停用」
 *   行只能从这份配置读（拿不到描述与路径，这是上游行为，界面照实说）。
 * - 预览只读 `SKILL.md`（后端只放行这个名字，超上限截断），正文按不可信输入渲染
 *   （react-markdown 默认不渲染原始 HTML）。
 */
export function SkillsPanel() {
 const { projects } = useApp();
 const t = useText();
 /** 发现范围：null = 全局（家目录 = 只看用户级技能）。 */
 const [scopePath, setScopePath] = useState<string | null>(null);
 const [data, setData] = useState<SkillsView | null>(null);
 const [loadError, setLoadError] = useState<string | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const [refreshing, setRefreshing] = useState(false);
 const [reloadKey, setReloadKey] = useState(0);
 const [openKey, setOpenKey] = useState<string | null>(null);
 const [preview, setPreview] = useState<Preview | null>(null);
 const [copied, setCopied] = useState<string | null>(null);
 const busyRef = useRef(false);
 const loadVersion = useRef(0);
 /** 展开中的技能（预览响应的落地校验 / 收起都看它）。 */
 const openKeyRef = useRef<string | null>(null);

 /** 写控件的统一互斥：启停在途、或清单正在重新发现时锁住（读取在途时放行写会互相覆盖）。 */
 const lock = busy || refreshing;

 const options = useMemo(() => scopeChoices(t.skillsScopeGlobal, projects), [t.skillsScopeGlobal, projects]);
 /** 有效范围：项目被移除 / 改名后按全局处理（与选项显示保持一致）。 */
 const activeScope = options.some((o) => o.path === scopePath) ? scopePath : null;
 const disabled = useMemo(() => sortDisabled(data?.disabled ?? []), [data]);
 const groups = useMemo(() => groupSkills(data?.skills ?? []), [data]);

 useEffect(() => {
  const version = ++loadVersion.current;
  api
   .listSkills(activeScope)
   .then((v) => {
    if (version !== loadVersion.current) return;
    setData(v);
    setLoadError(null);
   })
   .catch((e: unknown) => {
    if (version !== loadVersion.current) return;
    setData(null);
    setLoadError(e instanceof Error && e.message ? e.message : "");
   })
   .finally(() => {
    if (version === loadVersion.current) setRefreshing(false);
   });
 }, [activeScope, reloadKey]);

 /** 停用时要收起的预览 key（停用行没有路径，只有「已发现」的行会展开）。 */
 const prevKeyOf = (name: string) => data?.skills.find((s) => s.name === name)?.filePath ?? name;

 /** 启停：写 `disabledExtensions` → 用回读的停用名单 + 重拉清单（停用后上游不再列出它）。 */
 const toggleSkill = async (name: string, enabled: boolean) => {
  if (busyRef.current) return;
  busyRef.current = true;
  const version = ++loadVersion.current;
  setBusy(true);
  setError(null);
  try {
   const next = await api.setSkillEnabled(name, enabled);
   if (version !== loadVersion.current) return;
   setData((prev) =>
    prev
     ? {
      ...prev,
      disabled: next,
      // 停用后这一行要从「已发现」里消失（上游不再列出它）；启用后靠重拉补回描述与路径
      skills: enabled ? prev.skills : prev.skills.filter((s) => s.name !== name),
     }
     : prev,
   );
   if (enabled) {
    // 启用后 omp 会重新发现它：等重拉把描述与路径补回来（期间写控件锁住，别让新的启停把这次重拉顶掉）
    setRefreshing(true);
    setReloadKey((k) => k + 1);
   } else if (openKey === prevKeyOf(name)) {
    openKeyRef.current = null;
    setOpenKey(null);
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : t.opFailed);
  } finally {
   busyRef.current = false;
   setBusy(false);
  }
 };

 /** 点技能名：展开 / 收起 `SKILL.md` 预览（懒加载），一次只开一个。 */
 const togglePreview = async (item: SkillItem) => {
  const key = item.filePath;
  if (openKey === key) {
   openKeyRef.current = null;
   setOpenKey(null);
   return;
  }
  openKeyRef.current = key;
  setOpenKey(key);
  if (preview?.key === key && preview.state === "ok") return;
  setPreview({ key, state: "loading" });
  try {
   const content = await api.readSkillFile(item.filePath);
   // 乱序响应：用户已经翻到别的技能了就丢弃这次结果（否则会把当前展开区顶成空白）
   if (openKeyRef.current === key) setPreview({ key, state: "ok", content });
  } catch (e) {
   if (openKeyRef.current === key) {
    setPreview({ key, state: "error", message: e instanceof Error ? e.message : t.opFailed });
   }
  }
 };

 const copyPath = async (path: string) => {
  try {
   await navigator.clipboard.writeText(path);
   setCopied(path);
   window.setTimeout(() => setCopied((cur) => (cur === path ? null : cur)), 1500);
  } catch {
   setError(t.copyFailed);
  }
 };

 const renderSkill = (item: SkillItem) => {
  const open = openKey === item.filePath;
  return (
   <div key={item.filePath} className="border-b border-border-soft py-2.5 last:border-b-0">
    <div className="flex flex-wrap items-start gap-2">
     <button
      onClick={() => void togglePreview(item)}
      aria-expanded={open}
      aria-label={fmt(open ? t.skillsHide : t.skillsView, item.name)}
      className="flex min-w-0 basis-full cursor-pointer flex-col items-start gap-1 text-left @min-[600px]/panel:flex-1 @min-[600px]/panel:basis-0"
     >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
       <ChevronRight
        size={11}
        aria-hidden
        className={`shrink-0 text-muted transition-transform duration-100 ${open ? "rotate-90" : ""}`}
       />
       <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
       <span className="shrink-0 rounded-sm bg-background px-1.5 py-0.5 text-[11px] text-muted">{skillSourceLabel(item.source, t)}</span>
       {item.hide && (
        <span className="shrink-0 rounded-sm bg-background px-1.5 py-0.5 text-[11px] text-faint">{t.skillsHideBadge}</span>
       )}
      </span>
      {item.description && (
       <span className="line-clamp-2 min-w-0 text-[12px] leading-relaxed text-muted">{item.description}</span>
      )}
      <span className="min-w-0 break-all font-mono text-[11px] text-faint">{item.filePath}</span>
     </button>
     <div className="flex shrink-0 items-center gap-2">
      <button
       onClick={() => void copyPath(item.baseDir)}
       aria-label={copied === item.baseDir ? t.copied : fmt(t.skillsCopyPath, item.name)}
       title={copied === item.baseDir ? t.copied : t.skillsCopyPath}
       className="cursor-pointer rounded-md border border-border p-1 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       {copied === item.baseDir ? <Check size={11} aria-hidden className="text-ok" /> : <Copy size={11} aria-hidden />}
      </button>
      <button
       onClick={() => void revealItemInDir(item.baseDir).catch(() => setError(t.skillsRevealFailed))}
       aria-label={fmt(t.skillsReveal, item.name)}
       className="cursor-pointer rounded-md border border-border p-1 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       <FolderOpen size={11} aria-hidden />
      </button>
      <Switch
       on
       disabled={lock}
       label={fmt(t.skillsToggleAria, item.name, t.skillsDisable)}
       onToggle={() => void toggleSkill(item.name, false)}
      />
     </div>
    </div>
    {open && (
     <div className="mt-2 rounded-lg border border-border-soft bg-background p-3">
      {preview && preview.key === item.filePath && preview.state === "loading" && (
       <p className="text-[13px] text-muted">{t.skillsLoading}</p>
      )}
      {preview && preview.key === item.filePath && preview.state === "error" && (
       <p role="alert" className="text-[13px] text-danger">
        {fmt(t.skillsPreviewFailed, preview.message)}
       </p>
      )}
      {preview && preview.key === item.filePath && preview.state === "ok" && (
       <>
        {preview.content.truncated && (
         <p className="mb-2 text-[12px] text-warn">{fmt(t.skillsTruncated, preview.content.bytes)}</p>
        )}
        {/* 正文按不可信输入处理：react-markdown 默认不渲染原始 HTML */}
        <div className="md-body min-w-0 max-h-96 overflow-auto">
         <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
          components={{ a: MarkdownLink }}
         >
          {preview.content.text}
         </ReactMarkdown>
        </div>
       </>
      )}
     </div>
    )}
   </div>
  );
 };

 const total = data?.skills.length ?? 0;
 /** 读取失败文案：后端 / 异常消息为空时用本地化兜底（切语言后重渲染即跟着换）。 */
 const loadErrorText = loadError === null ? null : loadError || t.skillsLoadFailed;

 return (
  <section
   aria-label={t.tabSkills}
   className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5"
  >
   <div className="flex flex-wrap items-center gap-2">
    <Puzzle size={16} aria-hidden className="text-muted" />
    <h2 className="text-sm font-semibold">{t.tabSkills}</h2>
    {data !== null && <span className="font-mono text-xs text-muted">{fmt(t.skillsCount, total)}</span>}
    <div className="ml-auto flex flex-wrap items-center gap-2">
     <EnumSelect
      label={t.skillsScope}
      value={scopeValue(options, activeScope)}
      choices={options.map((o) => ({ value: o.value, label: o.label }))}
      busy={refreshing}
      disabled={lock}
      onPick={(value) => {
       setRefreshing(true);
       setScopePath(options.find((o) => o.value === value)?.path ?? null);
      }}
     />
     <button
      onClick={() => {
       setRefreshing(true);
       setReloadKey((k) => k + 1);
      }}
      disabled={busy || refreshing}
      className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={t.refresh}
      title={t.refresh}
     >
      {refreshing ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
      {t.refresh}
     </button>
    </div>
   </div>
   <p className="mt-2 text-[13px] leading-relaxed text-faint">{t.tabSkillsHint}</p>
   <p className="mt-1 text-[12px] leading-relaxed text-faint">
    {t.skillsScopeHint}
    {data && <span className="ml-1 font-mono">{data.cwd}</span>}
   </p>
   <p className="mt-1 text-[12px] leading-relaxed text-faint">{t.skillsToggleHint}</p>

   {error && (
    <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
     {error}
    </p>
   )}

   {data === null ? (
    loadErrorText !== null ? (
     <div className="mt-3 flex flex-col items-start gap-2">
      <p role="alert" className="text-[13px] text-danger">
       {loadErrorText}
      </p>
      <button
       onClick={() => setReloadKey((k) => k + 1)}
       disabled={busy}
       className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {t.retry}
      </button>
     </div>
    ) : (
     <p role="status" className="mt-3 text-[13px] text-muted">
      {t.skillsLoading}
     </p>
    )
   ) : total === 0 && disabled.length === 0 ? (
    <p className="mt-4 rounded-lg bg-background px-4 py-8 text-center text-[13px] leading-relaxed text-muted">
     {t.skillsEmpty}
    </p>
   ) : (
    <div className="mt-4 space-y-5">
     {groups.map((g) => (
      <div key={g.id}>
       <h3 className="border-b border-border-soft pb-2 text-[13px] font-semibold text-muted">
        {g.id === "project" ? t.skillsGroupProject : g.id === "user" ? t.skillsGroupUser : t.skillsGroupOther}
       </h3>
       <div>{g.items.map((s) => renderSkill(s))}</div>
      </div>
     ))}

     {disabled.length > 0 && (
      <div>
       <h3 className="border-b border-border-soft pb-2 text-[13px] font-semibold text-muted">
        {fmt(t.skillsGroupDisabled, disabled.length)}
       </h3>
       <p className="mt-1.5 text-[12px] leading-relaxed text-faint">{t.skillsDisabledHint}</p>
       <div>
        {disabled.map((name) => (
         <div key={name} className="flex flex-wrap items-center gap-2 border-b border-border-soft py-2.5 last:border-b-0">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{name}</span>
          <span className="shrink-0 rounded-sm bg-warn/10 px-1.5 py-0.5 text-[11px] text-warn">{t.skillsDisabledTag}</span>
          <Switch
           on={false}
           disabled={lock}
           label={fmt(t.skillsToggleAria, name, t.skillsEnable)}
           onToggle={() => void toggleSkill(name, true)}
          />
         </div>
        ))}
       </div>
      </div>
     )}

     {data.warnings.length > 0 && (
      <div>
       <h3 className="border-b border-border-soft pb-2 text-[13px] font-semibold text-muted">
        {fmt(t.skillsWarnings, data.warnings.length)}
       </h3>
       <ul className="mt-1.5 space-y-1">
        {data.warnings.map((w: SkillWarning, i) => (
         <li key={`${w.skillPath}-${i}`} className="text-[12px] leading-relaxed text-faint">
          <span className="font-mono">{w.skillPath}</span>
          <span className="ml-1 break-all">{w.message}</span>
         </li>
        ))}
       </ul>
      </div>
     )}
    </div>
   )}
  </section>
 );
}
