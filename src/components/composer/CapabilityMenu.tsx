import { useCallback, useEffect, useState } from "react";
import { Cpu, Loader as Spinner } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { CAPABILITY_ROWS, capabilityCommand, isFresh, PROBE_AFTER_MS, type CapabilityId } from "../../lib/capabilities";
import { fmt, type Text } from "../../lib/locale";
import { useDropdown } from "../../lib/useDropdown";
import { useText } from "../../lib/useText";

/** 行标签 / 不可用原因：显式映射（比动态键名安全，加行时编译器会提醒） */
const LABELS: Record<"advisor" | "computer" | "plan" | "goal", (t: Text) => string> = {
 advisor: (t) => t.caps_advisor,
 computer: (t) => t.caps_computer,
 plan: (t) => t.caps_plan,
 goal: (t) => t.caps_goal,
};

const WHYS: Record<"plan" | "goal", (t: Text) => string> = {
 plan: (t) => t.caps_planWhy,
 goal: (t) => t.caps_goalWhy,
};

/**
 * 输入框工具行的「能力」面板：omp 会话级开关的交互面（挂 `ModelPicker` 左侧之外的自有槽位）。
 *
 * 为什么是面板而不是一排芯片：工具行已经有十来个控件，再摆四个会把行撑爆；
 * 而且这些开关需要显示**状态与说明**（顾问接手的是哪个模型、为什么另两项切不了），芯片放不下。
 *
 * 状态来源见 `src/lib/capabilities.ts`：只有 omp 自己 `<cmd> status` 的输出算数——
 * 打开面板时探一次（60s 内不重复），切完再探一次确认，**拿不到就显示「未查询」，不猜**。
 * 开关动作走 `run_slash`（本地命令，无 agent turn），omp 的回执会作为一行命令输出落在会话里。
 */
export function CapabilityMenu() {
 const t = useText();
 const { activeSessionId, composerMenu, capabilitiesBySession, statusBySession } = useApp();
 const open = composerMenu === "caps";
 const setOpen = useCallback((v: boolean) => useApp.setState({ composerMenu: v ? "caps" : null }), []);
 const ref = useDropdown(open, () => setOpen(false));
 const [busy, setBusy] = useState<CapabilityId | null>(null);
 const caps = activeSessionId ? (capabilitiesBySession[activeSessionId] ?? {}) : {};
 const running = activeSessionId ? statusBySession[activeSessionId]?.state === "running" : false;

 /** 探一次状态（`<cmd> status`；只在空闲会话上发，避免与流式中的 prompt 抢道）。 */
 const probe = useCallback(
  (id: CapabilityId) => {
   if (!activeSessionId || running) return;
   void api.runSlash(activeSessionId, capabilityCommand(id)).catch(() => undefined);
  },
  [activeSessionId, running],
 );

 // 打开面板：探还新鲜的状态（拿不到就显示「未查询」，不摆假值）
 useEffect(() => {
  if (!open) return;
  const now = Date.now();
  for (const row of CAPABILITY_ROWS) {
   if (!row.toggleable) continue;
   const id = row.id as CapabilityId;
   if (!isFresh(caps[id], now)) probe(id);
  }
  // caps 只在打开那一刻取一次快照，之后由 toggle / 再次打开刷新
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [open]);

 const toggle = async (id: CapabilityId, next: boolean) => {
  if (!activeSessionId || running) return;
  setBusy(id);
  // 乐观：先按用户点的方向显示，随后由 omp 的 status 输出收敛（探不到就退回未知）
  useApp.setState((s) => ({
   capabilitiesBySession: {
    ...s.capabilitiesBySession,
    [activeSessionId]: {
     ...(s.capabilitiesBySession[activeSessionId] ?? {}),
     [id]: { value: next ? "on" : "off", detail: s.capabilitiesBySession[activeSessionId]?.[id]?.detail, at: Date.now() },
    },
   },
  }));
  try {
   await api.runSlash(activeSessionId, capabilityCommand(id, next));
  } catch {
   // 下发失败（进程退出等）：状态交给下面的 status 探针纠正，不弹错
  }
  // 开关自己的回执不带状态，隔一拍再问一次 omp 要真值
  window.setTimeout(() => {
   probe(id);
   setBusy(null);
  }, PROBE_AFTER_MS);
 };

 /** 已开启的能力数（收起态的角标；拿不到状态时显示 `?` 而不是 0——那是两回事）。 */
 const known = CAPABILITY_ROWS.filter((r) => r.toggleable).map((r) => caps[r.id as CapabilityId]);
 const onCount = known.filter((c) => c?.value === "on").length;
 const unknown = known.some((c) => !c);

 return (
  <div className="relative" ref={ref}>
   <button
    onClick={() => setOpen(!open)}
    className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[13px] whitespace-nowrap text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    aria-label={t.capsAria}
    aria-expanded={open}
    title={t.capsAria}
   >
    <Cpu size={14} aria-hidden className="shrink-0" />
    <span className="font-mono text-[11px]">{unknown && onCount === 0 ? "?" : `${onCount}/2`}</span>
   </button>
   {/* 触发按钮在工具行**左侧**（权限徽标右边）→ 浮层必须 left-0：右对齐会让 320px 的面板往左冲出窗口，
       行标签（顾问 / 电脑 / 计划 / 目标）整列被裁掉。右对齐只适用于工具行右半边的选择器。 */}
   {open && (
    <div className="absolute bottom-8 left-0 z-10 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-elevated p-2 shadow-pop">
     <div className="flex items-center justify-between px-1 pb-1.5">
      <span className="text-[13px] font-medium">{t.capsTitle}</span>
      <span className="font-mono text-[11px] text-faint">{running ? t.capsBusy : t.capsSessionOnly}</span>
     </div>
     {CAPABILITY_ROWS.map((row) => {
      const id = row.id as CapabilityId;
      const state = row.toggleable ? caps[id] : undefined;
      const on = state?.value === "on";
      return (
       <div key={row.id} className="flex items-start gap-2 rounded-md px-1.5 py-1.5">
        <div className="min-w-0 flex-1">
         <div className="flex items-center gap-1.5 text-[13px]">
          <span className={row.toggleable ? "text-foreground" : "text-muted"}>{LABELS[row.id](t)}</span>
          {!row.toggleable && (
           <span className="rounded-sm bg-warn/15 px-1 py-px text-[10px] text-warn">{t.capsTuiOnly}</span>
          )}
         </div>
         <div className="mt-0.5 text-[11px] leading-4 text-muted">
          {row.toggleable
           ? (state?.detail ?? (activeSessionId ? t.capsUnknown : t.capsNoSession))
           : row.id === "plan"
             ? WHYS.plan(t)
             : WHYS.goal(t)}
         </div>
        </div>
        {row.toggleable ? (
         <button
          role="switch"
          aria-checked={on}
          aria-label={LABELS[row.id](t)}
          disabled={!activeSessionId || running || busy !== null}
          onClick={() => void toggle(id, !on)}
          title={running ? t.capsBusy : fmt(t.capsToggleAria, LABELS[row.id](t))}
          className={`mt-0.5 flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border px-0.5 transition-colors duration-100 disabled:cursor-default disabled:opacity-40 ${
           on ? "border-accent bg-accent/80" : "border-border bg-surface"
          }`}
         >
          <span
           className={`flex h-4 w-4 items-center justify-center rounded-full transition-transform duration-100 ${
            on ? "translate-x-4 bg-white" : "translate-x-0 bg-muted"
           }`}
           aria-hidden
          >
           {busy === id && <Spinner size={10} className="animate-spin text-foreground" />}
          </span>
         </button>
        ) : (
         <span className="mt-1 shrink-0 text-[11px] text-faint">{t.capsUnavailable}</span>
        )}
       </div>
      );
     })}
     <div className="mt-1 border-t border-border-soft px-1.5 pt-1.5 text-[11px] leading-4 text-faint">
      {t.capsFootnote}
     </div>
    </div>
   )}
  </div>
 );
}
