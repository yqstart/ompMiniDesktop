import { useState } from "react";
import { Add, ArrowDown, ArrowUp, Loader, Refresh, Repeat, X } from "reicon-react";
import { fmt } from "../../lib/locale";
import { roleLabel } from "../../lib/roleNames";
import { useDropdown } from "../../lib/useDropdown";
import { useText } from "../../lib/useText";

/** 行内图标按钮：与角色行的按钮同一套边框 / 悬浮语言，只是内容缩成图标。 */
const iconButton =
 "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-50";

/**
 * 设置 ›「模型」的**快速切换环**区块：omp `cycleOrder` 的读写。
 *
 * omp 终端里 Ctrl+P / Shift+Ctrl+P 在环内角色之间循环（`app.model.cycleForward`）。
 * 条目是**角色 id**（不是模型 selector）——环里的角色按 `modelRoles` 解析模型，
 * 未配置模型或没有可用凭证的角色 omp 会直接跳过（与 TUI `/model` 面板里按 `c`
 * 加入的「press c on a role to add it」是同一个键）。
 *
 * 交互口径：每次增删 / 移动立即写回 omp（与角色行同款——写是单值覆盖，写后回读，
 * 界面拿真值，没有失败的草稿态要保留）；写入的整数组由本组件构造，干净的条目
 * 只会是候选列表里的角色，孤儿条目（config.yml 手写的未知名字）原样列着、可单独移除。
 */
export function CycleOrderSection({
 order,
 roles,
 selectors,
 busy,
 saving,
 loadError,
 onSave,
 onRefresh,
}: {
 /** 当前环（null = 读取中）；顺序即轮换顺序。 */
 order: string[] | null;
 /** 候选角色（内置 + 自定义，与「模型角色」区块同一份）。 */
 roles: string[];
 /** 角色 → 当前 selector（环内行的只读展示；缺 = 未配置）。 */
 selectors: Record<string, string>;
 /** 页级刷新进行中（禁点，避免刷新与写入交叉）。 */
 busy: boolean;
 /** 写入进行中（父级串行化；禁点防止连发）。 */
 saving: boolean;
 /** 读取失败（保留旧数据时显示过期提示，空快照时显示重试）。 */
 loadError: string | null;
 onSave: (order: string[]) => Promise<void>;
 onRefresh: () => void;
}) {
 const t = useText();
 const [addOpen, setAddOpen] = useState(false);
 const addRef = useDropdown(addOpen, () => setAddOpen(false));
 const inCycle = new Set(order ?? []);
 const candidates = roles.filter((r) => !inCycle.has(r));
 const disabled = saving || busy;
 const move = (i: number, delta: number) => {
  if (!order) return;
  const next = [...order];
  [next[i], next[i + delta]] = [next[i + delta], next[i]];
  void onSave(next);
 };

 return (
  <section id="settings-models-cycle" aria-label={t.cycleSection} className="scroll-mt-2 shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
   <div className="flex flex-wrap items-center gap-2">
    <Repeat size={16} aria-hidden className="text-muted" />
    <h2 tabIndex={-1} className="text-sm font-semibold outline-none">{t.cycleSection}</h2>
    <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted">Ctrl+P</kbd>
    <button
     onClick={onRefresh}
     disabled={busy || saving}
     className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     aria-label={t.modelsRefresh}
     title={t.modelsRefresh}
    >
     {busy ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
     {t.refresh}
    </button>
   </div>
   <p className="mt-2 text-[13px] leading-relaxed text-faint">{t.cycleHint}</p>
   {loadError && order !== null && (
    <p role="alert" className="mt-1.5 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
     {t.ompSettingsStale}：{loadError}
    </p>
   )}

   {order === null ? (
    loadError ? (
     <div className="flex flex-col items-start gap-2 py-2">
      <p role="alert" className="text-[13px] text-danger">{loadError}</p>
      <button
       onClick={onRefresh}
       disabled={busy || saving}
       className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {t.retry}
      </button>
     </div>
    ) : (
     <div className="py-2 text-[13px] text-muted">{t.archivedLoading}</div>
    )
   ) : (
    <>
     <div className="mt-2">
      {order.length === 0 ? (
       <p className="py-2 text-[13px] text-muted">{t.cycleEmpty}</p>
      ) : (
       order.map((role, i) => {
        const label = roleLabel(role, t);
        const selector = selectors[role];
        return (
         <div key={role} className="flex flex-wrap items-center gap-2 border-t border-border-soft py-3 first:border-t-0">
          <span className="w-4 shrink-0 text-right font-mono text-xs text-faint">{i + 1}</span>
          <div className="min-w-0 basis-full @min-[600px]/panel:w-32 @min-[600px]/panel:basis-auto">
           <div className="truncate text-sm">{label}</div>
           {label !== role && <div className="font-mono text-xs text-muted">{role}</div>}
          </div>
          <span className="min-w-0 basis-full font-mono text-xs break-all @min-[600px]/panel:flex-1 @min-[600px]/panel:basis-0">
           {selector ?? <span className="text-muted">{t.roleUnset}</span>}
          </span>
          <button
           onClick={() => move(i, -1)}
           disabled={disabled || i === 0}
           className={iconButton}
           aria-label={fmt(t.cycleRowUp, label)}
           title={fmt(t.cycleRowUp, label)}
          >
           <ArrowUp size={12} aria-hidden />
          </button>
          <button
           onClick={() => move(i, 1)}
           disabled={disabled || i === order.length - 1}
           className={iconButton}
           aria-label={fmt(t.cycleRowDown, label)}
           title={fmt(t.cycleRowDown, label)}
          >
           <ArrowDown size={12} aria-hidden />
          </button>
          <button
           onClick={() => void onSave(order.filter((r) => r !== role))}
           disabled={disabled}
           className={iconButton}
           aria-label={fmt(t.cycleRowRemove, label)}
           title={fmt(t.cycleRowRemove, label)}
          >
           <X size={12} aria-hidden />
          </button>
         </div>
        );
       })
      )}
     </div>

     <div className="mt-3">
      <button
       onClick={() => setAddOpen((v) => !v)}
       disabled={disabled || candidates.length === 0}
       aria-expanded={addOpen}
       title={candidates.length === 0 ? t.cycleAddAll : t.cycleAdd}
       className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       <Add size={12} aria-hidden />
       {t.cycleAdd}
      </button>
      {addOpen && (
       <div ref={addRef} className="mt-2 flex flex-wrap gap-1 rounded-md border border-border bg-background p-2">
        {candidates.map((role) => (
         <button
          key={role}
          onClick={() => {
           setAddOpen(false);
           void onSave([...(order ?? []), role]);
          }}
          className="cursor-pointer rounded-md border border-border px-2 py-0.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
         >
          {roleLabel(role, t)}
         </button>
        ))}
       </div>
      )}
     </div>
    </>
   )}
  </section>
 );
}
