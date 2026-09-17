import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { api } from "@shared/api";
import type { PtyEvent, TerminalView } from "@shared/types";
import { useApp } from "../../stores/app";
import { readTermTheme } from "../../lib/termTheme";
import { TEXT } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";

/**
 * 一个终端 tab 的渲染核心：xterm.js 实例 + 到后端 PTY 的双向管道。
 *
 * 生命周期约定：
 * - xterm 实例随 `term.id` 建立/销毁（切 tab 只切显隐——滚动缓冲区不丢）；
 * - PTY 随 `term.id + term.spawnSeq` spawn（重启 = spawnSeq+1，不重建 xterm）；
 * - 组件卸载（关闭 tab）时 kill 进程；高频字节流只进 xterm，不进 store。
 *
 * 隐藏态（`display:none`）测不到尺寸，所有 fit 都只在可见时做；可见性用 ref 追踪，
 * 避免 ResizeObserver 因 `active` 变化被反复重建。
 */
export function TerminalPane({ term, active }: { term: TerminalView; active: boolean }) {
 const hostRef = useRef<HTMLDivElement | null>(null);
 const termRef = useRef<Terminal | null>(null);
 const fitRef = useRef<FitAddon | null>(null);
 const activeRef = useRef(active);
 const t = useText();

 useEffect(() => {
  activeRef.current = active;
 }, [active]);

 // xterm 实例（仅随 id 建立/销毁）
 useEffect(() => {
  const host = hostRef.current;
  if (!host) return;
  const cs = getComputedStyle(document.documentElement);
  const x = new Terminal({
   fontFamily: cs.getPropertyValue("--font-mono").trim() || "Menlo, monospace",
   fontSize: 13,
   lineHeight: 1.25,
   cursorBlink: true,
   cursorStyle: "bar",
   // omp TUI 的输出量大（工具输出 / 转录），回看窗口给足；上限控制内存
   scrollback: 5000,
   // macOS 的 Option 当 Meta（TUI 快捷键如 Alt+B 才到得了 omp）
   macOptionIsMeta: true,
   theme: readTermTheme(),
  });
  const fit = new FitAddon();
  x.loadAddon(fit);
  x.open(host);
  termRef.current = x;
  fitRef.current = fit;
  const dataSub = x.onData((d) => {
   void api.ptyWrite(term.id, d).catch(() => { });
  });
  // OSC 0/2 标题（omp TUI 会发「π > 会话名」）→ tab 标题
  const titleSub = x.onTitleChange((title) => useApp.getState().setTerminalTitle(term.id, title));
  // 皮肤切换（<html class="dark">）→ 跟 token 换色
  const mo = new MutationObserver(() => {
   if (termRef.current) termRef.current.options.theme = readTermTheme();
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
   dataSub.dispose();
   titleSub.dispose();
   mo.disconnect();
   x.dispose();
   termRef.current = null;
   fitRef.current = null;
  };
 }, [term.id]);

 // PTY 生命周期：挂载 + 每次重启
 useEffect(() => {
  const x = termRef.current;
  const fit = fitRef.current;
  if (!x || !fit) return;
  let alive = true;
  // spawn 前先量一次尺寸（新终端/重启时本终端都是激活态，可测）
  try {
   fit.fit();
  } catch {
   // 尺寸不可测时退回 xterm 当前 cols/rows
  }
  const cols = Math.max(2, x.cols || 80);
  const rows = Math.max(2, x.rows || 24);
  void (async () => {
   // 重启路径：确保同 id 的旧进程先被收掉（已退出时 kill 是 no-op）
   await api.ptyKill(term.id).catch(() => { });
   if (!alive) return;
   const channel = new Channel<PtyEvent>();
   channel.onmessage = (e) => {
    if (!alive) return;
    if (e.type === "data") {
     termRef.current?.write(e.data);
    } else {
     useApp.getState().setTerminalStatus(term.id, "exited", e.code);
    }
   };
   try {
    await api.ptySpawn({ id: term.id, cwd: term.cwd, cols, rows, resume: term.resume }, channel);
   } catch (err) {
    if (!alive) return;
    // 数据层展示文本取「当次调用」的语言（与既有口径一致），不进 effect 依赖
    const txt = TEXT[useApp.getState().locale];
    termRef.current?.write(`\r\n\x1b[31m${txt.termStartFailed}: ${String(err)}\x1b[0m\r\n`);
    useApp.getState().setTerminalStatus(term.id, "exited", null);
   }
  })();
  return () => {
   alive = false;
  };
 }, [term.id, term.spawnSeq, term.cwd, term.resume]);

 // 尺寸跟随（窗口缩放 / 侧栏拖拽）：隐藏态不量、不推
 useEffect(() => {
  const host = hostRef.current;
  if (!host) return;
  const ro = new ResizeObserver(() => {
   if (!activeRef.current) return;
   const x = termRef.current;
   const fit = fitRef.current;
   if (!x || !fit) return;
   try {
    fit.fit();
   } catch {
    return;
   }
   void api.ptyResize(term.id, x.cols, x.rows).catch(() => { });
  });
  ro.observe(host);
  return () => ro.disconnect();
 }, [term.id]);

 // 切到本 tab：布局落定后再量一次、推尺寸、聚焦
 useEffect(() => {
  if (!active) return;
  const raf = requestAnimationFrame(() => {
   const x = termRef.current;
   const fit = fitRef.current;
   if (!x || !fit) return;
   try {
    fit.fit();
   } catch {
    // 忽略：尺寸拿不到就保持原样
   }
   void api.ptyResize(term.id, x.cols, x.rows).catch(() => { });
   x.focus();
  });
  return () => cancelAnimationFrame(raf);
 }, [active, term.id]);

 // 卸载（关闭 tab）= kill 进程
 useEffect(() => {
  const id = term.id;
  return () => {
   void api.ptyKill(id).catch(() => { });
  };
 }, [term.id]);

 return (
  <div className="relative h-full w-full">
   <div ref={hostRef} className="h-full w-full" aria-label={t.termPaneAria} />
   {term.status === "exited" && (
    <div className="absolute inset-0 flex items-center justify-center bg-background/75">
     <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-elevated px-6 py-5 shadow-pop">
      <p className="text-sm text-muted">
       {term.exitCode == null || term.exitCode === 0
        ? t.termExited
        : fmt(t.termExitedCode, term.exitCode)}
      </p>
      <div className="flex gap-2">
       <button
        onClick={() => useApp.getState().restartTerminal(term.id)}
        className="cursor-pointer rounded-md bg-accent px-3.5 py-1.5 text-[13px] text-white transition-opacity duration-100 hover:opacity-90"
       >
        {t.termRestart}
       </button>
       <button
        onClick={() => useApp.getState().closeTerminal(term.id)}
        className="cursor-pointer rounded-md border border-border px-3.5 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
       >
        {t.close}
       </button>
      </div>
     </div>
    </div>
   )}
  </div>
 );
}
