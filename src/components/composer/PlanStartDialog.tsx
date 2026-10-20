import { useState } from "react";
import { createChatIn } from "../../lib/sessionOpen";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { DialogShell } from "../settings/DialogShell";

/**
 * 计划模式入口弹窗（2026-10-20，方案 A 的可发现入口）：
 *
 * 计划模式是 **omp 的启动参数**（`--plan-yolo`）——rpc-ui 没有运行中切换的通道
 * （见 `docs/plan-mode.md`），所以已打开会话不能切。这里把「切不了」说清楚，
 * 并给唯一的落地动作：**用当前目录新建一个计划会话**（`createChatIn(dir, { plan: true })`）。
 *
 * 空态输入卡上的「计划」chip 是快捷开关（设置下一次新建）；有会话时同一个 chip
 * 打开这个弹窗。`+` 菜单的「计划」也走这里。
 */
export function PlanStartDialog({
 dir,
 active = false,
 onClose,
}: {
 dir: string;
 /** 当前会话已经是计划会话：弹窗改成「已启用、运行中无法关闭」并给「新建普通会话」。 */
 active?: boolean;
 onClose: () => void;
}) {
 const t = useText();
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const create = async () => {
  if (busy) return;
  if (!dir) {
   setError(t.newChatNoProject);
   return;
  }
  setBusy(true);
  setError(null);
  const res = active ? await createChatIn(dir) : await createChatIn(dir, { plan: true });
  if (!res.ok) {
   setError(res.message);
   setBusy(false);
   return;
  }
  onClose();
 };

 const primary =
  "cursor-pointer rounded-md border border-transparent bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-100 hover:opacity-90 disabled:cursor-default disabled:opacity-50";
 const secondary =
  "cursor-pointer rounded-md px-2.5 py-1.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40";

 return (
  <DialogShell title={active ? t.planDialogTitleActive : t.planDialogTitle} onClose={onClose} width="max-w-lg">
   <div className="flex flex-col gap-3">
    <p className="text-[13px] leading-6 text-muted">{active ? t.planDialogBodyActive : t.planDialogBody}</p>
    <p className="truncate font-mono text-[11px] text-faint" title={dir || undefined}>
     {fmt(t.planDialogDir, dir || "—")}
    </p>
    {error && (
     <p role="alert" className="text-[12px] leading-5 text-danger">
      {error}
     </p>
    )}
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border-soft pt-3">
     <button type="button" onClick={() => void create()} disabled={busy || !dir} className={primary}>
      {busy ? t.planDialogCreating : active ? t.planDialogCreateNormal : t.planDialogCreate}
     </button>
     <button type="button" onClick={onClose} disabled={busy} className={secondary}>
      {t.goalCancel}
     </button>
    </div>
   </div>
  </DialogShell>
 );
}
