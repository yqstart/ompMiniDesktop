import { useCallback, useEffect, useRef, useState } from "react";
import { Command, Folder, X } from "reicon-react";
import { WORKBENCH_MAX, WORKBENCH_MIN, useApp } from "../../stores/app";
import { resolveContext } from "../../lib/context";
import { useText } from "../../lib/useText";
import { FileTree } from "./FileTree";
import { TerminalPane } from "./TerminalPane";

/** 右栏宽度上限还要给中列留出可用宽度：窗口扣除左栏后至少留这么多（消息列 + 输入卡）。 */
const CENTER_MIN = 420;
/** 手柄聚焦时 ←→ 微调步长。 */
const STEP = 8;

/**
 * 右栏工作台（V42，替代 v2 的「上下文」面板）：**文件**与**终端**两个页签。
 *
 * - 始终停靠为第三栏（打开 = 主区变三栏，会话列让位、不遮盖）；开关 `workbenchOpen` 只决定这一栏在不在。
 * - 面板**常驻挂载**（收起 / 切页签只改显隐）：终端进程与 xterm 回看缓冲不因为收起右栏而丢。
 * - **左缘可拖调宽**（260–640，持久化；口径与左栏 `SidebarShell` 同一套：3px 隐身热区、
 *   悬停 / 拖拽高亮、焦点下 ←→ 微调）。拖拽按「指针到右栏右缘的距离」算宽度——主区有外边距
 *   也不影响手感；另有窗口约束（给中列留 `CENTER_MIN`）。
 * - 目标目录 = 当前会话的工作目录（`resolveContext`），会话切换即跟着切；
 *   终端按 cwd 保留（`store.terminalCwds`，上限见 store），收起面板不杀进程，应用退出统一收尾（`pty.rs`）。
 */
export function WorkbenchPanel() {
 const t = useText();
 const open = useApp((s) => s.workbenchOpen);
 const setOpen = useApp((s) => s.setWorkbenchOpen);
 const tab = useApp((s) => s.workbenchTab);
 const setTab = useApp((s) => s.setWorkbenchTab);
 const settingsTabActive = useApp((s) => s.settingsTabActive);
 const projects = useApp((s) => s.projects);
 const sessions = useApp((s) => s.sessions);
 const activeSessionId = useApp((s) => s.activeSessionId);
 const termCwds = useApp((s) => s.terminalCwds);
 const rememberTerminalCwd = useApp((s) => s.rememberTerminalCwd);
 const sidebarWidth = useApp((s) => s.sidebarWidth);
 const width = useApp((s) => s.workbenchWidth);
 const setWorkbenchWidth = useApp((s) => s.setWorkbenchWidth);
 const { cwd } = resolveContext(projects, sessions, activeSessionId);
 const visible = open && !settingsTabActive;
 const asideRef = useRef<HTMLElement | null>(null);
 /** 拖拽中的快速判断（不进渲染）；热区 / 拖拽的视觉态用 state（render 里不许读 ref）。 */
 const dragging = useRef(false);
 const [hot, setHot] = useState(false);
 const [draggingUi, setDraggingUi] = useState(false);

 /** 当前允许的最大宽度：窗口扣掉左栏（窄窗下左栏是抽屉、不占位）与中列最小宽度后取小。 */
 const maxWidthNow = useCallback(() => {
  if (typeof window === "undefined") return WORKBENCH_MAX;
  const left = window.innerWidth < 768 ? 0 : sidebarWidth;
  return Math.max(WORKBENCH_MIN, Math.min(WORKBENCH_MAX, window.innerWidth - left - CENTER_MIN));
 }, [sidebarWidth]);

 const resizeTo = useCallback(
  (w: number) => setWorkbenchWidth(Math.min(w, maxWidthNow())),
  [setWorkbenchWidth, maxWidthNow],
 );

 // 拖拽：指针到右栏右缘的距离就是目标宽度（主区外边距有多少都不影响手感）
 useEffect(() => {
  const move = (e: PointerEvent) => {
   if (!dragging.current) return;
   const el = asideRef.current;
   if (!el) return;
   resizeTo(el.getBoundingClientRect().right - e.clientX);
  };
  const up = () => {
   if (!dragging.current) return;
   dragging.current = false;
   setDraggingUi(false);
   document.body.style.cursor = "";
   document.body.style.userSelect = "";
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  return () => {
   window.removeEventListener("pointermove", move);
   window.removeEventListener("pointerup", up);
  };
 }, [resizeTo]);

 // 窗口宽度对齐：挂载时先量一次（上次会话可能留下超出当前窗口的宽度），变窄时把超限宽度收回
 // ——否则右栏会把中列挤扁（值没变不写）。同步到 store 是 effect 的正当用途。
 useEffect(() => {
  const clampToWindow = () => {
   const max = maxWidthNow();
   if (useApp.getState().workbenchWidth > max) setWorkbenchWidth(max);
  };
  clampToWindow();
  window.addEventListener("resize", clampToWindow);
  return () => window.removeEventListener("resize", clampToWindow);
 }, [maxWidthNow, setWorkbenchWidth]);

 // 只有「终端页签真的显示过」才把 cwd 记进保留表：没打开过的目录不白起 shell。
 // 同步到 store（外部状态）是 effect 的正当用途——组件本地 state 的写法会引入级联渲染。
 useEffect(() => {
  if (!visible || tab !== "terminal" || !cwd) return;
  rememberTerminalCwd(cwd);
 }, [visible, tab, cwd, rememberTerminalCwd]);

 const tabButton = (key: "files" | "terminal", Icon: typeof Folder, label: string) => (
  <button
   onClick={() => setTab(key)}
   aria-pressed={tab === key}
   className={`flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-100 ${
    tab === key ? "bg-active text-foreground" : "text-muted hover:bg-hover hover:text-foreground"
   }`}
  >
   <Icon size={12} aria-hidden />
   <span>{label}</span>
  </button>
 );

 return (
  <aside
   ref={asideRef}
   style={{ width }}
   className={`${visible ? "flex" : "hidden"} relative shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar`}
   aria-label={t.workbenchTitle}
  >
   {/* 左缘拖拽热区（口径同左栏：平时 3px 隐身、悬停 / 拖拽 6px 高亮；← 向左扩、→ 向右收） */}
   <div
    role="separator"
    aria-orientation="vertical"
    aria-label={t.workbenchResizeAria}
    aria-valuemin={WORKBENCH_MIN}
    aria-valuemax={Math.round(maxWidthNow())}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    onKeyDown={(e) => {
     if (e.key === "ArrowLeft") resizeTo(width + STEP);
     if (e.key === "ArrowRight") resizeTo(width - STEP);
    }}
    onPointerDown={(e) => {
     dragging.current = true;
     setDraggingUi(true);
     document.body.style.cursor = "col-resize";
     document.body.style.userSelect = "none";
     (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }}
    onPointerEnter={() => setHot(true)}
    onPointerLeave={() => {
     if (!dragging.current) setHot(false);
    }}
    className={`absolute top-0 left-0 z-10 h-full cursor-col-resize touch-none transition-colors focus-visible:outline-none ${
     hot || draggingUi ? "w-1.5 bg-accent/45" : "w-[3px] bg-transparent"
    }`}
   />
   <header className="flex h-(--h-chrome) shrink-0 items-center gap-1 border-b border-border px-2">
    {tabButton("files", Folder, t.workbenchFiles)}
    {tabButton("terminal", Command, t.workbenchTerminal)}
    <button
     onClick={() => setOpen(false)}
     className="ml-auto flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
     aria-label={t.workbenchCloseAria}
     title={t.workbenchCloseAria}
    >
     <X size={13} aria-hidden />
    </button>
   </header>
   {/* 文件页签与终端页签都保持挂载：切页签不打断终端、也不丢树的展开位置 */}
   <div className={`min-h-0 flex-1 ${tab === "files" ? "" : "hidden"}`}>
    {cwd ? (
     <FileTree root={cwd} />
    ) : (
     <p className="px-3.5 py-4 text-[12px] text-faint">{t.workbenchNoSession}</p>
    )}
   </div>
   <div className={`relative min-h-0 flex-1 ${tab === "terminal" ? "" : "hidden"}`}>
    {cwd ? (
     // 终端 cwd 由上面的 effect 补进保留表；补进前这一帧什么都不画（不闪空态文案）
     termCwds.map((dir) => (
      <TerminalPane key={dir} id={`term:${dir}`} cwd={dir} visible={visible && tab === "terminal" && dir === cwd} />
     ))
    ) : (
     <p className="px-3.5 py-4 text-[12px] text-faint">{t.workbenchNoSession}</p>
    )}
   </div>
  </aside>
 );
}
