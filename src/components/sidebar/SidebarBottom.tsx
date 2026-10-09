import { Settings } from "reicon-react";
import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { LanguageToggle } from "../LanguageToggle";
import { ThemeToggle } from "../ThemeToggle";

/**
 * 左栏底栏（V32 二次口径）：两种形态共用——设置入口 + 语言 + 皮肤。
 *
 * - 形态切换（`AppModeToggle`）已上移到顶栏的字标位，这一行回到「设置 / 语言 / 皮肤」三件
 *   （`SIDEBAR_MIN` 的 288px 临界宽度就是按这三件算的，见 `stores/app.ts`）；
 * - 「设置」是标签栏单例：终端形态 = 打开 / 聚焦设置标签；聊天形态没有标签栏，
 *   再点一次 = 返回聊天（`closeSettingsTab`）。
 */
export function SidebarBottom() {
 const t = useText();
 return (
  <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-3">
   <button
    onClick={() => {
     const st = useApp.getState();
     // 聊天形态：设置不是标签，再点一次「设置」= 返回聊天（终端形态保持「聚焦设置」不变）
     if (st.appMode === "chat" && st.settingsTabActive) st.closeSettingsTab();
     else st.openSettingsTab();
     st.set({ sidebarOpen: false });
    }}
    className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    aria-label={t.settingsOpenAria}
    title={t.settingsOpenAria}
   >
    <Settings size={15} aria-hidden className="shrink-0" />
    <span className="whitespace-nowrap">{t.settingsOpenAria}</span>
   </button>
   <LanguageToggle />
   <ThemeToggle />
  </div>
 );
}
