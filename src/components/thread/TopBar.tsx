import { useState } from "react";
import { Archive, CheckListNotes, Export, Menu, More2, PenLine, SidebarRight } from "reicon-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { useDropdown } from "../../lib/useDropdown";
import { refreshSessionView } from "../../lib/sessionOpen";
import { runSessionBatch } from "../../lib/sessionBatch";
import { appendLocalNote } from "../../lib/localNote";

/**
 * 中列顶部标题栏（v2 §1.2 形态）：标题居中 + 左侧 `···` 菜单 + 右侧面板开关。
 * 高度走 `--h-chrome` 语义档。
 *
 * 右上角只剩「窗口 chrome」：上下文容量环与供应商用量 2026-10-14 搬进输入卡工具行
 * （它们是「要不要再开一轮」的决策读数，跟输入框待在一起才有用）。
 *
 * - 标题点击仍是就地改名（v1 口径保留：点标题改名的肌肉记忆不该被 v2 打断）；
 * - `···` 菜单收会话级动作：重命名 / 会话统计 / 导出会话 / 归档会话
 *   （删除会话仍只在左栏行操作里，不在这里再开一条危险入口）；
 * - 左端窄屏（<768px）保留抽屉入口，否则项目列表与设置不可达。
 */
export function TopBar() {
 const { activeSessionId, sessions, set, contextPanelOpen, setContextPanelOpen } = useApp();
 const t = useText();
 const cur = sessions.find((s) => s.id === activeSessionId);
 /** 备注编辑草稿：`original` = 打开时的回显值——**原样回车 = 没改名**，不写 omp。 */
 const [draft, setDraft] = useState<{ text: string; original: string } | null>(null);
 const [menuOpen, setMenuOpen] = useState(false);
 const menuRef = useDropdown(menuOpen, () => setMenuOpen(false));
 const title = cur?.title?.trim() || t.unnamedChat;

 /** 打开改名输入框：回显当前显示名——备注非空优先，否则 omp 原标题（与后端 `display_title` 同口径）。 */
 const startEdit = () => {
  if (!cur) return;
  const text = cur.note?.trim() ? cur.note : cur.title;
  setDraft({ text, original: text });
  setMenuOpen(false);
 };

 /** 导出会话 HTML（与 `/export` 同一条后端命令）：结果落一条本地 command 行，随后系统打开。 */
 const exportSession = async () => {
  if (!activeSessionId) return;
  setMenuOpen(false);
  try {
   const { path } = await api.exportSessionHtml(activeSessionId);
   if (path) {
    appendLocalNote(activeSessionId, fmt(t.exportDone, path));
    void openPath(path).catch(() => undefined);
   }
  } catch (e) {
   appendLocalNote(activeSessionId, e instanceof Error ? e.message : String(e));
  }
 };

 /** 归档当前会话（与左栏行操作同一条批量链路；归档可恢复，不设二次确认）。 */
 const archiveSession = async () => {
  if (!activeSessionId) return;
  setMenuOpen(false);
  const sid = activeSessionId;
  try {
   await runSessionBatch("archive", [sid]);
   await refreshSessionView(sid);
  } catch {
   // 批量链路的失败信息由左栏列表刷新后的状态表达，这里不弹错
  }
 };

 const menuButton = (icon: React.ReactNode, label: string, onClick: () => void) => (
  <button
   onClick={onClick}
   className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
  >
   {icon}
   {label}
  </button>
 );

 return (
  // Overlay 标题栏：左侧留 72px 给 macOS 红绿灯，标题在整栏居中（绝对定位，不受左右按钮宽度影响）
  <header
   data-tauri-drag-region
   className="relative flex h-(--h-chrome) shrink-0 items-center gap-1 border-b border-border bg-background pr-2 pl-[72px]"
  >
   {/* 窄窗（<768px）左栏收起为抽屉：这里必须有打开入口，否则项目列表与设置不可达 */}
   <button
    onClick={() => set({ sidebarOpen: true })}
    className="flex cursor-pointer items-center justify-center rounded-md p-1.5 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground md:hidden"
    aria-label={t.openSidebar}
    title={t.openSidebar}
   >
    <Menu size={16} aria-hidden />
   </button>
   {/* 左端 `···` 菜单：会话级动作（对齐 Codex 标题栏左侧的菜单入口） */}
   <div className="relative" ref={menuRef}>
    <button
     onClick={() => setMenuOpen((v) => !v)}
     disabled={!cur}
     className={`flex cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-100 disabled:cursor-default disabled:opacity-40 ${menuOpen ? "bg-active text-foreground" : "text-muted hover:bg-hover hover:text-foreground"}`}
     aria-label={t.sessionMenuAria}
     aria-expanded={menuOpen}
     title={t.sessionMenuAria}
    >
     <More2 size={16} aria-hidden />
    </button>
    {menuOpen && cur && (
     <div className="absolute top-full left-0 z-10 mt-1 w-52 rounded-lg border border-border bg-elevated p-1 shadow-pop">
      {menuButton(<PenLine size={13} aria-hidden />, t.sessionMenuRename, startEdit)}
      {menuButton(
       <CheckListNotes size={13} aria-hidden />,
       t.statsTitle,
       () => {
        setMenuOpen(false);
        set({ statsOpen: true });
       },
      )}
      {menuButton(<Export size={13} aria-hidden />, t.sessionMenuExport, () => void exportSession())}
      {menuButton(<Archive size={13} aria-hidden />, t.archiveChat, () => void archiveSession())}
     </div>
    )}
   </div>
   {/* 中：标题（居中；点击就地改名，编辑框在同一个位置上浮出） */}
   <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-center px-24">
    {draft && cur ? (
     <input
      autoFocus
      value={draft.text}
      onChange={(e) => setDraft((d) => (d ? { ...d, text: e.target.value } : d))}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
       // IME 组字的回车只提交候选，不算改名确认
       if (e.nativeEvent.isComposing) return;
       if (e.key === "Enter") {
        // 改过才写：原样回车什么都不做。V40 起改名 = 写 omp 真名（`set_session_name` 落
        // jsonl 的 title 行），覆盖层的旧备注由后端一并清掉。
        if (draft.text.trim() !== draft.original.trim()) {
         void api
          .renameSession(cur.id, draft.text)
          .then(() => refreshSessionView(cur.id))
          .catch(() => undefined);
        }
        setDraft(null);
       }
       if (e.key === "Escape") setDraft(null);
      }}
      aria-label={t.renameNoteAria}
      className="pointer-events-auto w-56 max-w-full rounded-md border border-border bg-background px-2 py-1 text-center text-[13px] outline-none focus:border-accent/70"
     />
    ) : (
     <button
      onClick={startEdit}
      disabled={!cur}
      className="pointer-events-auto max-w-full cursor-pointer truncate rounded-md px-2 py-0.5 text-[13px] font-semibold transition-colors duration-100 hover:bg-hover disabled:cursor-default"
      aria-label={cur ? fmt(t.chatTitleAria, title) : t.unnamedChat}
      title={cur ? t.chatTitleTitle : ""}
     >
      {title}
     </button>
    )}
   </div>
   {/* 右端图标组（v2）：右面板开关（上下文容量环 / 供应商用量在输入卡工具行） */}
   <div className="ml-auto flex items-center gap-0.5">
    <button
     onClick={() => setContextPanelOpen(!contextPanelOpen)}
     className={`flex cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-100 ${contextPanelOpen ? "bg-active text-foreground" : "text-muted hover:bg-hover hover:text-foreground"}`}
     aria-label={t.panelToggleAria}
     aria-pressed={contextPanelOpen}
     title={t.panelToggleAria}
    >
     <SidebarRight size={16} aria-hidden />
    </button>
   </div>
  </header>
 );
}
