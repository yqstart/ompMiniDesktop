/**
 * 开关（`role="switch"`）：颜色之外还有 `aria-checked`（颜色不作唯一信号）。
 * 设置页内共享——「omp 常用设置」的行内开关与「自定义模型」表单里的模型开关用同一份。
 */
export function Switch({
 on,
 disabled,
 label,
 onToggle,
}: {
 on: boolean;
 disabled: boolean;
 label: string;
 onToggle: () => void;
}) {
 return (
  <button
   role="switch"
   aria-checked={on}
   aria-label={label}
   disabled={disabled}
   onClick={onToggle}
   className={`relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full transition-colors duration-100 disabled:opacity-40 ${on ? "bg-accent" : "bg-border"
    }`}
  >
   <span
    className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface transition-transform duration-100 ${on ? "translate-x-[16px]" : "translate-x-[2px]"
     }`}
   />
  </button>
 );
}
