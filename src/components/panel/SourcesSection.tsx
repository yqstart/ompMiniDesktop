import { useMemo } from "react";
import { FileText, Link } from "reicon-react";
import type { ViewMsg } from "@shared/types";
import { useApp } from "../../stores/app";
import { resolveContext } from "../../lib/context";
import { useOpenPath } from "../../lib/openPath";
import { recentSourceFiles, splitSourcePath } from "../../lib/panelSources";
import { useText } from "../../lib/useText";
import { PanelSection } from "./PanelSection";

/** 空消息流的稳定引用（选择器返回同引用，避免无谓重渲）。 */
const EMPTY: ViewMsg[] = [];

/**
 * 右栏「来源」区块（v2）：本轮（最后一次用户消息之后）agent 读过 / 引用过的文件清单。
 *
 * 派生自消息流（`recentSourceFiles` 纯函数，不改数据层）：行点击 = 系统默认应用打开，
 * 行尾「引用」= 把 `@路径` 注入输入框草稿（焦点交还输入框，与 ⌘⇧P 引用浮层同一落点）。
 * 没有来源时不渲染该块。
 */
export function SourcesSection() {
 const t = useText();
 const activeSessionId = useApp((s) => s.activeSessionId);
 const events = useApp((s) => (s.activeSessionId ? (s.eventsBySession[s.activeSessionId] ?? EMPTY) : EMPTY));
 const projects = useApp((s) => s.projects);
 const sessions = useApp((s) => s.sessions);
 const { cwd } = resolveContext(projects, sessions, activeSessionId);
 const { notice, open } = useOpenPath(cwd);
 const files = useMemo(() => recentSourceFiles(events), [events]);
 if (files.length === 0) return null;
 /** 注入一条 `@路径` 到草稿（光标后续输入落点由 composerFocusSeq 交还）。 */
 const quote = (path: string) => {
  if (!activeSessionId) return;
  const st = useApp.getState();
  const cur = st.draftOf(activeSessionId);
  st.setDraft(activeSessionId, cur.trim() ? `${cur.trimEnd()} @${path} ` : `@${path} `);
  st.set({ composerFocusSeq: st.composerFocusSeq + 1 });
 };
 return (
  <PanelSection
   title={t.panelSources}
   anchor="panel-sources"
   action={
    <span className="shrink-0 font-mono text-[11px] text-faint">{files.length}</span>
   }
  >
   <ul className="space-y-px">
    {files.map((f) => {
     const { base, prefix } = splitSourcePath(f.path, cwd);
     return (
      <li key={f.path} className="group/src flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-100 hover:bg-hover">
       <FileText size={12} className="shrink-0 text-muted" aria-hidden />
       <button
        onClick={() => void open(f.path)}
        className="min-w-0 flex-1 cursor-pointer text-left"
        title={f.path}
        aria-label={t.panelSourceOpenAria}
       >
        <span className="block truncate text-[12px] text-foreground">{base}</span>
        {prefix && <span className="block truncate font-mono text-[10px] text-faint">{prefix}</span>}
       </button>
       {f.reads > 1 && <span className="shrink-0 font-mono text-[10px] text-faint">×{f.reads}</span>}
       <button
        onClick={() => quote(f.path)}
        className="shrink-0 cursor-pointer rounded-sm p-0.5 text-faint opacity-0 transition-opacity duration-100 group-hover/src:opacity-100 focus:opacity-100 hover:bg-active hover:text-foreground"
        aria-label={t.panelSourceQuoteAria}
        title={t.panelSourceQuoteAria}
       >
        <Link size={11} aria-hidden />
       </button>
      </li>
     );
    })}
   </ul>
   {notice && <div className="mt-1.5 text-[11px] text-warn">{notice}</div>}
  </PanelSection>
 );
}
