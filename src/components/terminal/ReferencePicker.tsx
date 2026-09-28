import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CodeFile, File, FileText, FileZip, Folder, FolderOpen, Image as ImageIcon } from "reicon-react";
import type { IconComponent } from "reicon-react";
import { api } from "@shared/api";
import type { ProjectFiles } from "@shared/types";
import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";
import { canInjectReference, insertFileReference } from "../../lib/termRef";
import {
 buildRefItems,
 buildRefTree,
 flattenRefTree,
 highlightName,
 isFileRow,
 rankRefItems,
 refQueryTerms,
 referenceScope,
 type RefItem,
 type RefRow,
} from "../../lib/workspaceFiles";
import { DialogShell } from "../settings/DialogShell";

/** 每个项目的结果上限（文件基数可能上万，只渲染前这么多条；后端另有 5万/项目的硬上限）。 */
const MAX_RESULTS = 200;
/** 目录树每层缩进（像素）。 */
const INDENT = 14;

/** 扩展名 → 文件图标（少而清晰：代码 / 文档 / 图片 / 压缩包 / 默认）。 */
const CODE_EXT: Record<string, true> = {
 ts: true, tsx: true, js: true, jsx: true, mjs: true, cjs: true, vue: true, svelte: true,
 rs: true, py: true, go: true, rb: true, java: true, kt: true, swift: true, c: true, h: true,
 cpp: true, hpp: true, cs: true, php: true, sh: true, bash: true, zsh: true, lua: true,
 sql: true, html: true, css: true, scss: true, less: true,
};
const DOC_EXT: Record<string, true> = { md: true, markdown: true, txt: true, rst: true, adoc: true };
const IMAGE_EXT: Record<string, true> = {
 png: true, jpg: true, jpeg: true, gif: true, webp: true, ico: true, bmp: true, svg: true,
};
const ARCHIVE_EXT: Record<string, true> = {
 zip: true, gz: true, tar: true, tgz: true, bz2: true, xz: true, "7z": true, rar: true,
};

function fileIconFor(name: string): IconComponent {
 const dot = name.lastIndexOf(".");
 const ext = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
 if (CODE_EXT[ext]) return CodeFile;
 if (DOC_EXT[ext]) return FileText;
 if (IMAGE_EXT[ext]) return ImageIcon;
 if (ARCHIVE_EXT[ext]) return FileZip;
 return File;
}

/** 折叠 key（跨项目同名 `rel` 不能相撞）。 */
function collapseKey(projectPath: string, rel: string): string {
 return `${projectPath}\u0000${rel}`;
}

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set<string>();

type LoadState =
 | { state: "loading" }
 | { state: "ready"; groups: ProjectFiles[] }
 | { state: "failed"; message: string };

type Section = { key: string; name: string; count: number; rows: RefRow[] };

/**
 * 引用工作区文件（V22）：⌘⇧P 打开；搜索**其他**成员项目的文件（当前项目不列——本项目文件在
 * 输入框里用 omp 原生 `@` 直接可补全）；Enter 把 `@<绝对路径> ` 注入目标终端输入框
 * （bracketed paste、**不回车、不发送**）。结果按项目分组、以资源管理器式目录树展示
 * （chevron 折叠 / 目录与文件类型图标 / 只走文件行的键盘导航）。
 *
 * 数据只在打开时拉一次（后端 60s 缓存）——输入不触发 IPC。目标终端必须
 * 「运行中且 π = 等待输入」，否则给忙碌提示（与改名同一口径）。
 */
export function ReferencePicker(): React.JSX.Element | null {
 const t = useText();
 const targetId = useApp((s) => s.refPickerTerminalId);
 const terminals = useApp((s) => s.terminals);
 const checkouts = useApp((s) => s.checkouts);
 const projects = useApp((s) => s.projects);
 const workspaceGroups = useApp((s) => s.workspaceGroups);
 const inputRef = useRef<HTMLInputElement>(null);
 const listId = useId();
 const [query, setQuery] = useState("");
 const terms = useMemo(() => refQueryTerms(query), [query]);
 const [cursor, setCursor] = useState(0);
 const [busy, setBusy] = useState(false);
 const [reloadSeq, setReloadSeq] = useState(0);
 const [loaded, setLoaded] = useState<{ key: string; groups: ProjectFiles[]; error: string | null } | null>(null);
 const [collapseState, setCollapseState] = useState<{ query: string; keys: ReadonlySet<string> }>({
  query: "",
  keys: EMPTY_COLLAPSED,
 });

 const term = terminals.find((x) => x.id === targetId);
 const scope = useMemo(
  () => (term
   ? referenceScope(term.cwd, workspaceGroups, checkouts, projects)
   : { primary: null, others: [] }),
  [term, workspaceGroups, checkouts, projects],
 );

 const paths = useMemo(() => scope.others.map((p) => p.path), [scope]);
 /** 请求标识：范围变化 / 手动重试 → 新 key；与 `loaded.key` 不一致 = 还在加载（渲染期派生，effect 不写同步 state）。 */
 const loadKey = `${paths.join("\n")}#${reloadSeq}`;

 // 打开（或重试）时拉一次文件列表；只有异步回调里才写 state。
 useEffect(() => {
  if (!term || paths.length === 0) return;
  let active = true;
  api
   .listProjectFiles(paths)
   .then((groups) => {
    if (active) setLoaded({ key: loadKey, groups, error: null });
   })
   .catch((error) => {
    if (active) {
     setLoaded({ key: loadKey, groups: [], error: error instanceof Error ? error.message : String(error) });
    }
   });
  return () => {
   active = false;
  };
 }, [term, paths, loadKey]);

 const load = useMemo<LoadState>(
  () => (paths.length === 0
   ? { state: "ready", groups: [] }
   : loaded && loaded.key === loadKey
    ? loaded.error !== null
     ? { state: "failed", message: loaded.error }
     : { state: "ready", groups: loaded.groups }
    : { state: "loading" }),
  [paths, loaded, loadKey],
 );

 // 目标终端被关掉（标签关闭等）：浮层没有目标了，直接收掉。
 useEffect(() => {
  if (!term) useApp.getState().set({ refPickerTerminalId: null });
 }, [term]);

 // 查询一变，之前的折叠状态自动失效（命中链路必须可见）——不需要 effect。
 const collapsedKeys = collapseState.query === query ? collapseState.keys : EMPTY_COLLAPSED;
 const toggleDir = (key: string) => {
  const current = collapseState.query === query ? collapseState.keys : EMPTY_COLLAPSED;
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setCollapseState({ query, keys: next });
 };

 /**
  * 每个项目一段：过滤 → 目录树（按折叠状态剪枝）→ 前序遍历成渲染行；
  * 文件行的光标序号在段间连续，与渲染顺序严格一致（不会跳）。
  */
 const sections = useMemo<Section[]>(() => {
  if (load.state !== "ready") return [];
  const searching = refQueryTerms(query).length > 0;
  let index = 0;
  const out: Section[] = [];
  for (const group of load.groups) {
   if (group.error !== null) continue;
   const matched = rankRefItems(query, buildRefItems([group], projects), MAX_RESULTS);
   const rows = flattenRefTree(
    buildRefTree(matched, searching),
    (rel) => collapsedKeys.has(collapseKey(group.path, rel)),
   ).map((row) => (isFileRow(row) ? { ...row, index: index++ } : row));
   const project = projects.find((p) => p.path === group.path);
   out.push({
    key: group.path,
    name: project?.name ?? group.path.split("/").filter(Boolean).pop() ?? group.path,
    count: matched.length,
    rows,
   });
  }
  return out;
 }, [load, projects, query, collapsedKeys]);
 const fileRows = useMemo(() => sections.flatMap((section) => section.rows.filter(isFileRow)), [sections]);
 const total = fileRows.length;
 const activeIndex = total > 0 ? Math.min(cursor, total - 1) : -1;
 const active = activeIndex >= 0 ? fileRows[activeIndex] ?? null : null;

 const close = () => useApp.getState().set({ refPickerTerminalId: null });
 const choose = (item: RefItem) => {
  const s = useApp.getState();
  const live = s.terminals.find((x) => x.id === targetId);
  if (!live) {
   close();
   return;
  }
  if (!canInjectReference(live)) {
   setBusy(true);
   return;
  }
  insertFileReference(live.id, item.abs);
  s.set({ refPickerTerminalId: null });
  s.focusTerminal(live.id);
 };

 if (!targetId) return null;

 const failed = load.state === "failed";
 const truncated = load.state === "ready" && load.groups.some((group) => group.truncated);
 const limited = sections.some((section) => section.count >= MAX_RESULTS);
 const projectErrors = load.state === "ready" ? load.groups.filter((group) => group.error !== null) : [];

 return (
  <DialogShell title={t.refPickTitle} width="max-w-2xl" onClose={close} initialFocusRef={inputRef}>
   <div className="flex flex-col gap-3">
    <input
     ref={inputRef}
     value={query}
     onChange={(e) => {
      setQuery(e.target.value);
      setCursor(0);
      setBusy(false);
     }}
     onKeyDown={(e) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
       if (total === 0) return;
       e.preventDefault();
       const delta = e.key === "ArrowDown" ? 1 : -1;
       setCursor(((activeIndex < 0 ? 0 : activeIndex) + delta + total) % total);
      } else if (e.key === "Enter") {
       if (active) {
        e.preventDefault();
        choose(active.item);
       }
      }
     }}
     role="combobox"
     aria-expanded
     aria-controls={listId}
     aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
     aria-autocomplete="list"
     placeholder={t.refPickSearchPlaceholder}
     aria-label={t.refPickSearchPlaceholder}
     className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent"
    />
    {busy && (
     <p role="alert" className="rounded-md border border-warn/20 bg-warn/10 px-3 py-2 text-[12px] text-warn">
      {t.refPickBusy}
     </p>
    )}
    {scope.primary === null && (
     <p className="py-6 text-center text-[13px] text-muted">{t.refPickNoProject}</p>
    )}
    {scope.primary !== null && scope.others.length === 0 && (
     <p className="rounded-md border border-border-soft bg-surface px-3 py-2 text-[12px] text-faint">
      {t.refPickScopeHint}
     </p>
    )}
    {truncated && <p className="text-[12px] text-faint">{t.refPickTruncated}</p>}
    {limited && <p className="text-[12px] text-faint">{fmt(t.refPickLimitHint, String(MAX_RESULTS))}</p>}
    {projectErrors.map((group) => {
     const name = projects.find((p) => p.path === group.path)?.name
      ?? group.path.split("/").filter(Boolean).pop()
      ?? group.path;
     return (
      <p key={group.path} className="rounded-md border border-border-soft bg-surface px-3 py-2 text-[12px] text-faint">
       {fmt(t.refPickProjectError, name, group.error ?? "")}
      </p>
     );
    })}
    {load.state === "loading" && <p className="py-6 text-center text-[13px] text-muted">{t.refPickLoading}</p>}
    {failed && (
     <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p role="alert" className="text-[13px] text-danger">{t.refPickLoadFailed}</p>
      <p className="font-mono text-[11px] break-words text-faint">{load.message}</p>
      <button
       type="button"
       onClick={() => setReloadSeq((n) => n + 1)}
       className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       {t.refPickRetry}
      </button>
     </div>
    )}
    {scope.others.length > 0 && total === 0 && load.state === "ready" && (
     <p className="py-6 text-center text-[13px] text-muted">{t.refPickEmpty}</p>
    )}
    {total > 0 && (
     <div role="listbox" id={listId} aria-label={t.refPickTitle} className="max-h-[28rem] overflow-y-auto">
      {sections.map((section) => (
       <div key={section.key}>
        <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint">
         {fmt(t.refPickGroupCount, section.name, String(section.count))}
        </p>
        {section.rows.map((row) => {
         if (row.kind === "dir") {
          const key = collapseKey(section.key, row.rel);
          const collapsed = collapsedKeys.has(key);
          const FolderIcon = collapsed ? Folder : FolderOpen;
          return (
           <button
            key={`d:${row.rel}`}
            type="button"
            onClick={() => toggleDir(key)}
            style={{ paddingLeft: 6 + row.depth * INDENT }}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-[12px] text-muted transition-colors duration-100 hover:bg-hover"
           >
            {collapsed
             ? <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />
             : <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />}
            <FolderIcon size={14} className="shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
             {highlightName(row.name, terms).map((part, partIndex) => (
              part.hit
               ? <span key={partIndex} className="font-medium text-accent">{part.text}</span>
               : <span key={partIndex}>{part.text}</span>
             ))}
            </span>
           </button>
          );
         }
         const FileIcon = fileIconFor(row.name);
         return (
          <button
           key={`f:${row.item.abs}`}
           id={`${listId}-${row.index}`}
           type="button"
           role="option"
           aria-selected={activeIndex === row.index}
           onClick={() => choose(row.item)}
           title={row.item.abs}
           style={{ paddingLeft: 6 + row.depth * INDENT }}
           className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md py-[3px] pr-2 text-left transition-colors duration-100 ${activeIndex === row.index ? "bg-active" : "hover:bg-hover"}`}
          >
           <span className="w-3 shrink-0" aria-hidden />
           <FileIcon size={14} className="shrink-0 text-muted" aria-hidden />
           <span className="min-w-0 flex-1 truncate text-[12px]">
            {highlightName(row.name, terms).map((part, partIndex) => (
             part.hit
              ? <span key={partIndex} className="font-medium text-accent">{part.text}</span>
              : <span key={partIndex}>{part.text}</span>
            ))}
           </span>
          </button>
         );
        })}
       </div>
      ))}
     </div>
    )}
    <p className="text-[11px] text-faint">{t.refPickInsertHint}</p>
   </div>
  </DialogShell>
 );
}
