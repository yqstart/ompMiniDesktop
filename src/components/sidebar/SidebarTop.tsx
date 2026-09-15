import { AppModeToggle } from "../AppModeToggle";
import { AppUpdateChip } from "./AppUpdateChip";
import { OmpUpdateChip } from "./OmpUpdateChip";

/**
 * 左栏顶栏（V32 二次口径）：两种形态共用——红绿灯占位 + 形态切换 + 两枚版本 chip。
 *
 * - 形态切换（`AppModeToggle`）落在**原来的字标位**：字标「ompMiniDesktop」退场，
 *   切换键从底部区上移到这里（用户口径：红框位置）；右端两枚 chip（V30 应用更新 /
 *   V24 omp 更新）不动；
 * - 整行是窗口拖拽区（`data-tauri-drag-region`）——按钮等交互件的点击不触发拖窗；
 * - 两形态各挂一份（隐藏那份 `display:none`，见 `WorkspaceSidebar` / `ChatSidebar`），
 *   几何尺寸两栏一致：40px 红绿灯占位 + 36px 顶栏行。
 */
export function SidebarTop() {
 return (
  <>
   <div data-tauri-drag-region className="h-10 shrink-0" aria-hidden />
   <div className="shrink-0 px-3">
    <div data-tauri-drag-region className="flex h-9 items-center gap-2 px-1 pb-2">
     <AppModeToggle />
     <div className="ml-auto flex min-w-0 items-center gap-1.5">
      <AppUpdateChip />
      <OmpUpdateChip />
     </div>
    </div>
   </div>
  </>
 );
}
