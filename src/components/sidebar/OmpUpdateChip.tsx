import { Loader } from "reicon-react";
import { useApp } from "../../stores/app";
import { openOmpUpdateDialog } from "../../lib/ompUpdate";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";

/**
 * omp 运行时版本 chip（左栏字标行右端，V24）：显示当前 omp 版本 + 上次检查的结论，
 * 点击打开 `OmpUpdateDialog`。
 *
 * - 状态色与终端 π 同一套语义：有新版本 `accent`、已是最新 `ok`、检查失败 `warn`、
 *   还没查过 `faint`——**颜色不是唯一信号**，完整结论（版本 / 渠道 / 失败原因）在
 *   `title` 与弹窗里，`aria-label` 是同一条文案；
 * - omp 未找到时**整个不渲染**：那种情况由 `HealthBanner` 说明，这里是版本信息不是报错位；
 * - 它是拖拽区（字标行）里的按钮：`<button>` 本身会挡住 Tauri 的拖拽（drag-region 只对
 *   直接落点生效、可点元素拦下），所以点 chip 不会误拖窗口。
 */
export function OmpUpdateChip() {
 const ompUpdate = useApp((s) => s.ompUpdate);
 const run = useApp((s) => s.ompUpdateRun);
 const health = useApp((s) => s.health);
 const t = useText();
 if (!health?.omp.ompPath) return null;
 // 更新进行中优先：chip 转起来，点开就是进度（弹窗里有关不掉的日志区）
 const updating = run?.phase === "running";
 const checking = ompUpdate.status === "checking";
 const available = ompUpdate.status === "available";
 const error = ompUpdate.status === "error";
 // 版本优先取检查结果（它来自本次真正跑起来的那份 omp），其次健康检查的探测值
 const version = ompUpdate.current ?? health.omp.ompVersion ?? t.unknown;
 const label = updating
  ? t.ompUpdateChipRunningTip
  : checking
   ? t.ompUpdateChecking
   : error
    ? t.ompUpdateErrorTip
    : available
     ? fmt(t.ompUpdateAvailableTip, version, ompUpdate.latest ?? "")
     : ompUpdate.checkedAt === null
      ? t.ompUpdateEntryAria
      : fmt(t.ompUpdateLatestTip, version, ompUpdate.channel ?? t.unknown);
 const tone = updating || checking || ompUpdate.checkedAt === null
  ? "bg-faint"
  : available
   ? "bg-accent"
   : error
    ? "bg-warn"
    : "bg-ok";

 return (
  <button
   type="button"
   onClick={openOmpUpdateDialog}
   aria-label={label}
   title={label}
   className="ml-auto flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-1.5 font-mono text-[11px] leading-none text-muted transition-colors duration-100 hover:border-accent/30 hover:bg-hover hover:text-foreground"
  >
   {updating || checking ? (
    <Loader size={12} aria-hidden className="shrink-0 animate-spin" />
   ) : (
    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone}`} />
   )}
   <span className="max-w-[86px] truncate">{available && ompUpdate.latest ? ompUpdate.latest : version}</span>
  </button>
 );
}
