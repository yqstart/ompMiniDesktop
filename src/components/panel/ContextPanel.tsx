import { useRef, useState } from "react";
import { CheckListSquare, File, FileText, Layout, Sparkles, X } from "reicon-react";
import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { useDropdown } from "../../lib/useDropdown";
import { ChangesSection } from "./ChangesSection";
import { ProgressSection } from "./ProgressSection";
import { SubagentsSection } from "./SubagentsSection";
import { SourcesSection } from "./SourcesSection";

/** 区块锚点（`PanelSection` 的 `anchor`）与导航浮层的条目一一对应。 */
const SECTION_ANCHORS = {
 changes: "panel-changes",
 progress: "panel-progress",
 subagents: "panel-subagents",
 sources: "panel-sources",
} as const;

/**
 * 右栏上下文面板（v2 三栏的第三栏，对齐 Codex 的任务侧栏）：变更 / 进度 / 子代理 / 来源。
 *
 * - **始终停靠**（MASTER §3）：打开 = 主区布局变三栏（左栏 / 中列 / 右栏），会话列让位
 *   而不是被遮盖；开关（`contextPanelOpen`，localStorage 持久化、**默认收起**）只控制
 *   这一栏在不在。
 * - 区块内容以分隔线与行分组组织、不做嵌套卡片；没有数据的区块整块不渲染。
 * - 挂载在 `ChatView` 之外（`App` 主区的兄弟列）：设置视图打开时它仍属于聊天主区，
 *   随 `main` 的显隐一起切换。
 */
export function ContextPanel() {
 const t = useText();
 const open = useApp((s) => s.contextPanelOpen);
 const setOpen = useApp((s) => s.setContextPanelOpen);
 const activeSessionId = useApp((s) => s.activeSessionId);
 const navRef = useRef<HTMLDivElement | null>(null);
 /** 右栏自己的滚动容器（区块导航的唯一滚动目标）。 */
 const bodyRef = useRef<HTMLDivElement | null>(null);
 const [navOpen, setNavOpen] = useState(false);
 useDropdown(navOpen, () => setNavOpen(false));
 const close = () => setOpen(false);
 /**
  * 区块导航定位：**只滚右栏自己的滚动容器**。
  *
  * 这里不能用 `scrollIntoView`——它会连带滚动祖先链上每一个可程序化滚动的容器
  * （`main` 是 `overflow: hidden`、`document` 也是），点一下导航就可能把整个工作区
  * 推偏（`index.css` 里 `#root` 用 `overflow: clip` 挡的就是这一类现象）；
  * 手动算偏移只动右栏，越界部分由滚动容器自己收敛。
  */
 const scrollToSection = (anchor: string) => {
  const body = bodyRef.current;
  const target = document.getElementById(anchor);
  if (!body || !target) return;
  // `scroll-mt-*`（PanelSection 的 `scroll-mt-2`）在手动滚动里要自己兑现
  const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const delta = target.getBoundingClientRect().top - body.getBoundingClientRect().top - margin;
  body.scrollTo({ top: Math.max(0, body.scrollTop + delta) });
 };
 const SECTION_NAV = [
  { anchor: SECTION_ANCHORS.changes, icon: File, label: t.panelChanges },
  { anchor: SECTION_ANCHORS.progress, icon: CheckListSquare, label: t.panelProgress },
  { anchor: SECTION_ANCHORS.subagents, icon: Sparkles, label: t.panelSubagents },
  { anchor: SECTION_ANCHORS.sources, icon: FileText, label: t.panelSources },
 ];
 if (!open) return null;

 const header = (
  <header className="flex h-(--h-chrome) shrink-0 items-center gap-1 border-b border-border px-3">
   <span className="min-w-0 flex-1 truncate text-[12px] font-medium tracking-wide text-muted">{t.panelTitle}</span>
   {/* 区块导航浮层（v2 §1.3，对齐 Codex 的工具切换浮层）：图标 + 名称的行钮列表，
       点击滚动定位到该区块；某区块当前没渲染时点它静默无动作（不造空跳） */}
   <div className="relative" ref={navRef}>
    <button
     onClick={() => setNavOpen((v) => !v)}
     className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-100 ${navOpen ? "bg-active text-foreground" : "text-muted hover:bg-hover hover:text-foreground"}`}
     aria-label={t.panelSectionsAria}
     aria-expanded={navOpen}
     title={t.panelSectionsAria}
    >
     <Layout size={13} aria-hidden />
    </button>
    {navOpen && (
     <div className="absolute top-full right-0 z-10 mt-1 w-44 rounded-lg border border-border bg-elevated p-1 shadow-pop">
      {SECTION_NAV.map((s) => (
       <button
        key={s.anchor}
        onClick={() => {
         setNavOpen(false);
         scrollToSection(s.anchor);
        }}
        className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
       >
        <s.icon size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{s.label}</span>
       </button>
      ))}
     </div>
    )}
   </div>
   <button
    onClick={close}
    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    aria-label={t.panelCloseAria}
    title={t.panelCloseAria}
   >
    <X size={13} aria-hidden />
   </button>
  </header>
 );

 const body = (
  <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
   {activeSessionId ? (
    <>
     <ChangesSection />
     <ProgressSection />
     <SubagentsSection />
     <SourcesSection />
    </>
   ) : (
    <p className="px-3.5 py-4 text-[12px] text-faint">{t.panelEmpty}</p>
   )}
  </div>
 );

 return (
  <aside
   className="flex w-(--w-panel) shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar"
   aria-label={t.panelTitle}
  >
   {header}
   {body}
  </aside>
 );
}
