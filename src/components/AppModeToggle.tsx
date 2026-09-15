import { Chat, Command } from "reicon-react";
import { useApp, type AppMode } from "../stores/app";
import { useText } from "../lib/useText";

/**
 * 应用形态切换（V32）：终端工作区 / 聊天界面，两档分段控件，挂在**左栏顶栏**——
 * 字标「ompMiniDesktop」的位子上（V32 二次口径：字标退场、切换键从底部区上移，见
 * `sidebar/SidebarTop.tsx`；两形态共用同一份顶栏）。
 *
 * - 与 `LanguageToggle` 同款结构（`radiogroup` + 逐项 `aria-checked` + 左右方向键组内循环、
 *   同一套 `bg-active` 选中底、24 × 26px 档位按钮），保证顶栏一行不挤压；
 * - 切换只换主区 / 左栏与交互口径（`appMode`，localStorage `omp.appMode.v1`）：**两侧运行中的
 *   进程都不停**——终端面板、聊天会话与两侧左栏都常驻挂载，切回来原来还在（卸载终端树会
 *   kill PTY，所以形态切换一律走 CSS 显隐，见 App）。
 */
export function AppModeToggle() {
 const appMode = useApp((s) => s.appMode);
 const setAppMode = useApp((s) => s.setAppMode);
 const t = useText();

 const modes: AppMode[] = ["terminal", "chat"];
 const labelOf = (m: AppMode) => (m === "terminal" ? t.modeTerminal : t.modeChat);

 const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
  const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!dir) return;
  const next = modes[(modes.indexOf(appMode) + dir + modes.length) % modes.length];
  setAppMode(next);
 };

 return (
  <div
   role="radiogroup"
   aria-label={t.modeSection}
   title={t.modeHint}
   onKeyDown={onKeyDown}
   className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface/60 p-0.5"
  >
   {modes.map((m) => {
    const selected = appMode === m;
    const label = labelOf(m);
    return (
     <button
      key={m}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={() => setAppMode(m)}
      className={`flex h-[26px] w-6 cursor-pointer items-center justify-center rounded-sm transition-colors duration-100 ${selected ? "bg-active text-accent" : "text-muted hover:bg-hover hover:text-foreground"
       }`}
     >
      {m === "terminal" ? <Command size={14} aria-hidden /> : <Chat size={14} aria-hidden />}
     </button>
    );
   })}
  </div>
 );
}
