import { useState } from "react";
import { Menu } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { refreshSessionView } from "../../lib/sessionOpen";
import { ContextMeter } from "./ContextMeter";

export function TopBar() {
 const { activeSessionId, sessions, set } = useApp();
 const t = useText();
 const cur = sessions.find((s) => s.id === activeSessionId);
 /** 备注编辑草稿：`original` = 打开时的回显值——**原样回车 = 没改名**，不写覆盖层
  *  （写一条与标题同文本的备注会把 omp 后续的自动标题更新挡住）。 */
 const [draft, setDraft] = useState<{ text: string; original: string } | null>(null);
 const title = cur?.title?.trim() || t.unnamedChat;

 /** 打开改名输入框：回显当前显示名——备注非空优先，否则 omp 原标题（与后端 `display_title` 同口径）。 */
 const startEdit = () => {
  if (!cur) return;
  const text = cur.note?.trim() ? cur.note : cur.title;
  setDraft({ text, original: text });
 };

 return (
  // Overlay 标题栏：左侧留 72px 给 macOS 红绿灯，标题缺省取当前任务标题
  <header
   data-tauri-drag-region
   className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-background pr-2 pl-[72px]"
  >
   {/* 窄窗（<768px）左栏收起为抽屉：这里必须有打开入口，否则项目列表与设置不可达 */}
   <button
    onClick={() => set({ sidebarOpen: true })}
    className="mr-0.5 flex cursor-pointer items-center justify-center rounded-md p-1.5 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground md:hidden"
    aria-label={t.openSidebar}
    title={t.openSidebar}
   >
    <Menu size={16} aria-hidden />
   </button>
   {draft && cur ? (
    <input
     autoFocus
     value={draft.text}
     onChange={(e) => setDraft((d) => (d ? { ...d, text: e.target.value } : d))}
     onBlur={() => setDraft(null)}
     onKeyDown={(e) => {
      // IME 组字的回车只提交候选，不算改名确认（与终端标签改名的守卫同口径）
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter") {
       // 改过才写：原样回车不产生备注（同文本备注会把 omp 的后续自动标题挡住）
       if (draft.text.trim() !== draft.original.trim()) {
        void api
         .renameSessionNote(cur.id, draft.text)
         .then(() => refreshSessionView(cur.id))
         .catch(() => undefined);
       }
       setDraft(null);
      }
      if (e.key === "Escape") setDraft(null);
     }}
     aria-label={t.renameNoteAria}
     className="w-44 rounded-md border border-border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent/70"
    />
   ) : (
    <button
     onClick={startEdit}
     disabled={!cur}
     className="max-w-44 cursor-pointer truncate rounded-md px-1.5 py-0.5 text-[13px] font-semibold transition-colors duration-100 hover:bg-hover disabled:cursor-default"
     aria-label={cur ? fmt(t.chatTitleAria, title) : t.unnamedChat}
     title={cur ? t.chatTitleTitle : ""}
    >
     {title}
    </button>
   )}
   <div className="ml-auto flex items-center">
    {/* 顶栏右端 = 上下文用量环（2026-10-10 与「复制 Markdown」按钮换位、从输入框工具行搬来）：
        环 + 百分比取自 `omp-state` 真值，点开是分项面板 */}
    <ContextMeter />
   </div>
  </header>
 );
}
