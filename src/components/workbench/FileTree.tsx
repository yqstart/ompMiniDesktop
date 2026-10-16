import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronRight, File, FolderOpen, Folder as FolderIcon, Link, Refresh } from "reicon-react";
import { api } from "@shared/api";
import type { ChangeFile, DirEntry } from "@shared/types";
import { useApp } from "../../stores/app";
import { revealPath, useOpenPath } from "../../lib/openPath";
import { useText } from "../../lib/useText";
import { appendReference, joinAbs } from "../../lib/workspaceFiles";

/** 每个目录一次渲染的条数：`node_modules` 那种大目录不做分片会把整棵树卡住。 */
const PAGE = 200;

/** 变更状态 → 徽标文案与色调（`index` / `worktree` 的 XY 两位；`??` 未跟踪）。 */
function changeBadge(file: ChangeFile): { text: string; tone: string } {
 if (file.untracked) return { text: "?", tone: "text-faint" };
 const code = (file.index !== " " ? file.index : file.worktree).trim() || "M";
 switch (code) {
  case "A":
   return { text: code, tone: "text-ok" };
  case "D":
   return { text: code, tone: "text-danger" };
  case "R":
  case "C":
   return { text: code, tone: "text-accent" };
  default:
   return { text: code, tone: "text-warn" };
 }
}

/**
 * 右栏「文件」页签：当前会话工作目录的**只读**目录树。
 *
 * - 懒加载：只有展开的目录才向 `list_dir` 取内容（大仓库不做全量递归）；
 * - 变更标色：`get_change_set` 一次拿到未提交改动，按「仓库根 + 相对路径」换算成绝对路径给文件加徽标；
 * - 点击文件 → 系统默认程序打开（失败退到「在访达中显示」）；行尾两键 = 引用到输入框 / 在访达中显示。
 *
 * 状态全在组件内（面板常驻挂载，右栏收起再展开不会丢展开位置）；高频数据（目录内容）不进 store。
 */
export function FileTree({ root }: { root: string }) {
 const t = useText();
 const activeSessionId = useApp((s) => s.activeSessionId);
 const { notice, open } = useOpenPath(root);
 const [dirs, setDirs] = useState<Record<string, DirEntry[]>>({});
 const [expanded, setExpanded] = useState<Set<string>>(new Set());
 const [loading, setLoading] = useState<Set<string>>(new Set());
 const [errors, setErrors] = useState<Record<string, string>>({});
 const [truncated, setTruncated] = useState<Set<string>>(new Set());
 /** 目录 → 已显示条数（分片展开）。 */
 const [shown, setShown] = useState<Record<string, number>>({});
 /** 绝对路径 → 变更（标色查表）。 */
 const [changes, setChanges] = useState<Map<string, ChangeFile>>(new Map());
 const [refreshSeq, setRefreshSeq] = useState(0);

 /** 取一层目录（`isRoot` 为真时顺带拿仓库根，由调用方使用）。 */
 const loadDir = useCallback(async (path: string, isRoot: boolean) => {
  setLoading((s) => new Set(s).add(path));
  try {
   const listing = await api.listDir(path, isRoot);
   setDirs((d) => ({ ...d, [path]: listing.entries }));
   setTruncated((s) => {
    const n = new Set(s);
    if (listing.truncated) n.add(path);
    else n.delete(path);
    return n;
   });
   setErrors((e) => {
    if (!(path in e)) return e;
    const { [path]: _drop, ...rest } = e;
    return rest;
   });
   return listing;
  } catch (err) {
   setErrors((e) => ({ ...e, [path]: String(err) }));
   return null;
  } finally {
   setLoading((s) => {
    const n = new Set(s);
    n.delete(path);
    return n;
   });
  }
 }, []);

 /** 未提交改动（标色数据源）：`base` = 仓库根（拿不到就按会话 cwd 降级）。 */
 const loadChanges = useCallback(
  async (base: string | null) => {
   try {
    const set = await api.getChangeSet(root);
    if (!set.isRepo) {
     setChanges(new Map());
     return;
    }
    const anchor = base ?? root;
    const map = new Map<string, ChangeFile>();
    for (const f of set.files) map.set(joinAbs(anchor, f.path), f);
    setChanges(map);
   } catch {
    setChanges(new Map());
   }
  },
  [root],
 );

 // 树根（会话 cwd）变化 / 手动刷新：整棵树重来
 useEffect(() => {
  setDirs({});
  setExpanded(new Set());
  setErrors({});
  setTruncated(new Set());
  setShown({});
  setChanges(new Map());
  let alive = true;
  void (async () => {
   const listing = await loadDir(root, true);
   if (!alive || !listing) return;
   void loadChanges(listing.repoRoot);
  })();
  return () => {
   alive = false;
  };
 }, [root, refreshSeq, loadDir, loadChanges]);

 const toggle = (entry: DirEntry) => {
  if (!entry.isDir) {
   void open(entry.path);
   return;
  }
  if (expanded.has(entry.path)) {
   setExpanded((prev) => {
    const n = new Set(prev);
    n.delete(entry.path);
    return n;
   });
   return;
  }
  setExpanded((prev) => new Set(prev).add(entry.path));
  if (!dirs[entry.path] && !loading.has(entry.path)) void loadDir(entry.path, false);
 };

 /** 引用到输入框（与 ⌘⇧P 引用浮层同一注入口径：`appendReference` + 聚焦）。 */
 const insertRef = (entry: DirEntry) => {
  if (!activeSessionId) return;
  const s = useApp.getState();
  s.setDraft(activeSessionId, appendReference(s.draftOf(activeSessionId), entry.path));
  s.set({ composerFocusSeq: s.composerFocusSeq + 1 });
 };

 const renderLevel = (dir: string, depth: number): ReactNode => {
  const err = errors[dir];
  if (err) {
   return (
    <p className="px-3 py-1 text-[11px] text-danger" title={err}>
     {t.filesLoadFailed}
    </p>
   );
  }
  const entries = dirs[dir];
  if (!entries) {
   return loading.has(dir) ? <p className="px-3 py-1 text-[11px] text-faint">{t.filesLoading}</p> : null;
  }
  const limit = shown[dir] ?? PAGE;
  const visible = entries.slice(0, limit);
  return (
   <>
    {visible.map((e) => {
     const change = e.isDir ? undefined : changes.get(e.path);
     const badge = change ? changeBadge(change) : null;
     const isOpen = e.isDir && expanded.has(e.path);
     return (
      <div key={e.path}>
       <div
        className="group flex h-6 items-center gap-1 rounded-md pr-1 transition-colors duration-100 hover:bg-hover"
        style={{ paddingLeft: 6 + depth * 12 }}
       >
        <button
         onClick={() => toggle(e)}
         className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
         title={e.path}
         aria-expanded={e.isDir ? isOpen : undefined}
        >
         {e.isDir ? (
          <ChevronRight
           size={11}
           aria-hidden
           className={`shrink-0 text-faint transition-transform duration-100 ${isOpen ? "rotate-90" : ""}`}
          />
         ) : (
          <span className="w-[11px] shrink-0" aria-hidden />
         )}
         {e.isDir ? (
          <FolderIcon size={12} aria-hidden className="shrink-0 text-faint" />
         ) : (
          <File size={12} aria-hidden className="shrink-0 text-faint" />
         )}
         <span className="min-w-0 flex-1 truncate text-[12px]">{e.name}</span>
         {e.isSymlink && (
          <span className="shrink-0 text-[10px] text-faint" aria-hidden>
           ↗
          </span>
         )}
         {badge && (
          <span className={`shrink-0 font-mono text-[10px] ${badge.tone}`} title={t.filesChangedBadge}>
           {badge.text}
          </span>
         )}
        </button>
        {/* 行尾动作：hover 才露面（引用到输入框 / 在访达中显示） */}
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
         {activeSessionId && (
          <button
           onClick={() => insertRef(e)}
           className="flex size-5 cursor-pointer items-center justify-center rounded text-faint transition-colors duration-100 hover:bg-active hover:text-foreground"
           aria-label={t.filesInsertRef}
           title={t.filesInsertRef}
          >
           <Link size={11} aria-hidden />
          </button>
         )}
         <button
          onClick={() => void revealPath(e.path)}
          className="flex size-5 cursor-pointer items-center justify-center rounded text-faint transition-colors duration-100 hover:bg-active hover:text-foreground"
          aria-label={t.filesReveal}
          title={t.filesReveal}
         >
          <FolderOpen size={11} aria-hidden />
         </button>
        </span>
       </div>
       {isOpen && <div>{renderLevel(e.path, depth + 1)}</div>}
      </div>
     );
    })}
    {entries.length > limit && (
     <button
      onClick={() => setShown((s) => ({ ...s, [dir]: limit + PAGE }))}
      className="mt-0.5 cursor-pointer rounded-md px-2 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      style={{ marginLeft: 6 + depth * 12 }}
     >
      {t.filesShowMore}
     </button>
    )}
    {truncated.has(dir) && <p className="px-3 py-0.5 text-[10px] text-faint">{t.filesTruncated}</p>}
   </>
  );
 };

 const rootName = root.replace(/\/+$/, "").split("/").pop() || root;
 return (
  <div className="flex h-full min-h-0 flex-col">
   <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-soft px-2">
    <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={root}>
     {rootName}
    </span>
    <button
     onClick={() => setRefreshSeq((n) => n + 1)}
     className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground"
     aria-label={t.filesRefresh}
     title={t.filesRefresh}
    >
     <Refresh size={11} aria-hidden />
    </button>
   </div>
   <div className="min-h-0 flex-1 overflow-y-auto py-1 pr-1">{renderLevel(root, 0)}</div>
   {notice && <p className="shrink-0 border-t border-border-soft px-3 py-1 text-[11px] text-faint">{notice}</p>}
  </div>
 );
}
