import { AppUpdateChip } from "./AppUpdateChip";
import { OmpUpdateChip } from "./OmpUpdateChip";

/**
 * 左栏顶栏（v1 起只剩聊天形态）：红绿灯占位 + 右端两枚 chip（V30 应用更新 / V24 omp 更新）。
 *
 * - 整行是窗口拖拽区（`data-tauri-drag-region`）——按钮等交互件的点击不触发拖窗；
 * - 几何尺寸与旧两栏口径一致：40px 红绿灯占位 + 36px 顶栏行。
 */
export function SidebarTop() {
 return (
  <>
   <div data-tauri-drag-region className="h-10 shrink-0" aria-hidden />
   <div className="shrink-0 px-3">
    <div data-tauri-drag-region className="flex h-9 items-center gap-2 px-1 pb-2">
     <div className="ml-auto flex min-w-0 items-center gap-1.5">
      <AppUpdateChip />
      <OmpUpdateChip />
     </div>
    </div>
   </div>
  </>
 );
}
