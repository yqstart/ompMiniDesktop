/**
 * omp 的 π 字标（品牌件，几何与应用图标同源：`design-system/icon/omp-mini-icon.svg`）。
 *
 * 三层同形描边画「横杠 + 两腿 + 四个内圆角」——外两层低透明充当辉光（与图标同一手法），
 * 主线是不透明字形。颜色一律 `currentColor`：调用处给 `text-accent` 就随深浅两套皮肤走，
 * 组件不写死色值。
 *
 * 动画（`index.css` 的 `.pi-mark` 族）：横杠先描画、两腿跟进、内圆角落定，之后辉光缓慢
 * 呼吸；`prefers-reduced-motion` 下由全局规则收敛为静态（描画立即完成、不呼吸）。
 */

// 三层同形描边：width = 笔画宽（与应用图标同一组数），halo 层参与辉光呼吸
const LAYERS = [
 { width: 130, opacity: 0.14, halo: true },
 { width: 112, opacity: 0.2, halo: true },
 { width: 96, opacity: 1, halo: false },
] as const;

// 三道笔画（与应用图标的几何一致）：横杠先描画，两腿稍后跟上（时序在 index.css）
const STROKES = [
 { d: "M 260 328 H 764", cls: "pi-bar" },
 { d: "M 391.04 328 V 696", cls: "pi-leg" },
 { d: "M 632.96 328 V 696", cls: "pi-leg" },
] as const;

// T 型交汇处的四个 R46 内圆角（曲边三角；填整圆会在笔画外冒出珠子）
const FILLETS = [
 "M 343.04 376 L 343.04 422 A 46 46 0 0 0 297.04 376 Z",
 "M 439.04 376 L 439.04 422 A 46 46 0 0 1 485.04 376 Z",
 "M 584.96 376 L 584.96 422 A 46 46 0 0 0 538.96 376 Z",
 "M 680.96 376 L 680.96 422 A 46 46 0 0 1 726.96 376 Z",
] as const;

export function OmpPiMark({ className }: { className?: string }) {
 return (
  <svg
   viewBox="193 261 638 502"
   className={className ? `pi-mark ${className}` : "pi-mark"}
   aria-hidden
   focusable="false"
   fill="none"
   stroke="currentColor"
   strokeLinecap="round"
   strokeLinejoin="round"
  >
   {LAYERS.map((layer) => (
    <g
     key={layer.width}
     className={layer.halo ? "pi-halo" : undefined}
     strokeWidth={layer.width}
    >
     {STROKES.map((stroke) => (
      <path
       key={stroke.d}
       className={`pi-stroke ${stroke.cls}`}
       d={stroke.d}
       pathLength={1}
       opacity={layer.opacity}
      />
     ))}
    </g>
   ))}
   <g className="pi-fillet" fill="currentColor" stroke="none">
    {FILLETS.map((d) => (
     <path key={d} d={d} />
    ))}
   </g>
  </svg>
 );
}
