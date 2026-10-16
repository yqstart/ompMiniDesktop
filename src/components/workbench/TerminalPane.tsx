import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ChevronDown } from "reicon-react";
import "@xterm/xterm/css/xterm.css";
import { api } from "@shared/api";
import type { TerminalEvent } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT, fmt } from "../../lib/locale";
import { readTermTheme } from "../../lib/termTheme";
import { useText } from "../../lib/useText";

/**
 * 右栏「终端」页签的渲染核心：一个 cwd 一个终端 = xterm 实例 + 到后端 PTY 的双向管道。
 *
 * 生命周期约定：
 * - xterm 实例随组件建立 / 销毁（多 cwd 保留 = 父组件把非当前终端 `hidden`，滚动缓冲区与服务进程都不丢）；
 * - PTY 随 `cwd + spawnSeq` spawn（「重新打开」= spawnSeq+1，不重建 xterm）；
 * - 卸载时 kill 进程；高频字节流只进 xterm，**不进 store**。
 *
 * 尺寸：隐藏态（`display:none`）测不到尺寸，fit 只在可见时做——可见性用 ref 追踪，
 * 避免 ResizeObserver 因 `visible` 变化被反复重建。
 */
export function TerminalPane({ id, cwd, visible }: { id: string; cwd: string; visible: boolean }) {
 const t = useText();
 const hostRef = useRef<HTMLDivElement | null>(null);
 const termRef = useRef<Terminal | null>(null);
 const fitRef = useRef<FitAddon | null>(null);
 const visibleRef = useRef(visible);
 /** shell 是否还活着（退出后浮出「重新打开」）。 */
 const [status, setStatus] = useState<"running" | "exited">("running");
 const [exitCode, setExitCode] = useState<number | null>(null);
 /** 重启计数：「重新打开」自增即重新 spawn（xterm 实例与回看缓冲不动）。 */
 const [spawnSeq, setSpawnSeq] = useState(0);
 /** 视口是否停在滚动缓冲底部——「回到最新输出」悬浮键的唯一显隐信号。 */
 const [atBottom, setAtBottom] = useState(true);

 // xterm 实例（仅随组件建立 / 销毁）
 useEffect(() => {
  const host = hostRef.current;
  if (!host) return;
  const cs = getComputedStyle(document.documentElement);
  const x = new Terminal({
   fontFamily: cs.getPropertyValue("--font-mono").trim() || "Menlo, monospace",
   // 右栏 320px 宽：12px 等宽字一屏约 44 列，够看常规命令输出
   fontSize: 12,
   lineHeight: 1.25,
   cursorBlink: true,
   cursorStyle: "bar",
   scrollback: 5000,
   // macOS 的 Option 当 Meta（shell 里的 Alt+B / Alt+F 才到得了 PTY）
   macOptionIsMeta: true,
   theme: readTermTheme(),
  });
  const fit = new FitAddon();
  x.loadAddon(fit);
  x.open(host);
  termRef.current = x;
  fitRef.current = fit;
  const dataSub = x.onData((d) => {
   void api.terminalWrite(id, d).catch(() => {});
  });
  // Cmd+C 复制选中：xterm 自带 canvas 渲染，选区不在 DOM 里，浏览器原生复制拿不到
  x.attachCustomKeyEventHandler((e) => {
   if (e.type === "keydown" && e.metaKey && e.key === "c" && x.hasSelection()) {
    void navigator.clipboard?.writeText(x.getSelection()).catch(() => {});
    return false;
   }
   return true;
  });
  // 贴底跟踪：滚动与每次写入解析后各判一次——只有布尔翻转才写 React state
  const syncAtBottom = () => {
   const buf = x.buffer.active;
   const bottom = buf.viewportY >= buf.baseY;
   setAtBottom((cur) => (cur === bottom ? cur : bottom));
  };
  const scrollSub = x.onScroll(syncAtBottom);
  const parsedSub = x.onWriteParsed(syncAtBottom);
  // 皮肤切换（<html class="dark">）→ 跟 token 换色
  const mo = new MutationObserver(() => {
   if (termRef.current) termRef.current.options.theme = readTermTheme();
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
   dataSub.dispose();
   scrollSub.dispose();
   parsedSub.dispose();
   mo.disconnect();
   x.dispose();
   termRef.current = null;
   fitRef.current = null;
  };
 }, [id]);

 // PTY 生命周期：挂载 + 每次「重新打开」
 useEffect(() => {
  const x = termRef.current;
  const fit = fitRef.current;
  if (!x || !fit) return;
  let alive = true;
  setStatus("running");
  setExitCode(null);
  // spawn 前先量一次尺寸；测不到就用 xterm 当前 cols/rows（可见后会补一次 resize）
  try {
   fit.fit();
  } catch {
   // 忽略：尺寸拿不到不阻断 spawn
  }
  const cols = Math.max(2, x.cols || 80);
  const rows = Math.max(2, x.rows || 24);
  void (async () => {
   // 重启路径：确保同 id 的旧进程先被收掉（已退出时 kill 是 no-op）
   await api.terminalKill(id).catch(() => {});
   if (!alive) return;
   const channel = new Channel<TerminalEvent>();
   channel.onmessage = (e) => {
    if (!alive) return;
    if (e.type === "data") termRef.current?.write(e.data);
    else {
     setStatus("exited");
     setExitCode(e.code);
    }
   };
   try {
    await api.terminalSpawn({ id, cwd, cols, rows }, channel);
   } catch (err) {
    if (!alive) return;
    const txt = TEXT[useApp.getState().locale];
    termRef.current?.write(`\r\n\x1b[31m${fmt(txt.termStartFailed, String(err))}\x1b[0m\r\n`);
    setStatus("exited");
    setExitCode(null);
   }
  })();
  return () => {
   alive = false;
  };
 }, [id, cwd, spawnSeq]);

 // 尺寸跟随（右栏宽度变化 / 窗口缩放）：隐藏态不量、不推
 useEffect(() => {
  const host = hostRef.current;
  if (!host) return;
  const ro = new ResizeObserver(() => {
   if (!visibleRef.current) return;
   const x = termRef.current;
   const fit = fitRef.current;
   if (!x || !fit) return;
   try {
    fit.fit();
   } catch {
    return;
   }
   void api.terminalResize(id, x.cols, x.rows).catch(() => {});
  });
  ro.observe(host);
  return () => ro.disconnect();
 }, [id]);

 // 切到本终端（页签激活 / 面板展开）：布局落定后再量一次、推尺寸、聚焦
 useEffect(() => {
  visibleRef.current = visible;
  if (!visible) return;
  const raf = requestAnimationFrame(() => {
   const x = termRef.current;
   const fit = fitRef.current;
   if (!x || !fit) return;
   try {
    fit.fit();
   } catch {
    // 忽略：尺寸拿不到就保持原样
   }
   void api.terminalResize(id, x.cols, x.rows).catch(() => {});
   x.focus();
  });
  return () => cancelAnimationFrame(raf);
 }, [visible, id]);

 // 卸载（终端被关掉 / 项目切走且超出保留数）= kill 进程
 useEffect(() => {
  const current = id;
  return () => {
   void api.terminalKill(current).catch(() => {});
  };
 }, [id]);

 const visibleClass = visible ? "" : "hidden";
 return (
  <div className={`relative h-full w-full ${visibleClass}`} aria-label={t.termPaneAria}>
   <div ref={hostRef} className="absolute inset-0 px-1.5 py-1" />
   {/* 回看中（视口离开底部）浮出「回到最新输出」键：一键回底再把键盘焦点交还终端 */}
   {!atBottom && status === "running" && (
    <button
     type="button"
     onClick={() => {
      const x = termRef.current;
      if (!x) return;
      x.scrollToBottom();
      x.focus();
     }}
     aria-label={t.termScrollToBottom}
     title={t.termScrollToBottom}
     className="absolute bottom-3 left-1/2 z-10 flex size-7 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-elevated text-muted shadow-pop transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
     <ChevronDown size={14} aria-hidden />
    </button>
   )}
   {status === "exited" && (
    <div className="absolute inset-0 flex items-center justify-center bg-background/75">
     <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-elevated px-5 py-4 shadow-pop">
      <p className="text-center text-[12px] text-muted">
       {exitCode == null || exitCode === 0 ? t.termExited : fmt(t.termExitedCode, exitCode)}
      </p>
      <button
       onClick={() => setSpawnSeq((n) => n + 1)}
       className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground transition-opacity duration-100 hover:opacity-90"
      >
       {t.termRestart}
      </button>
     </div>
    </div>
   )}
  </div>
 );
}
