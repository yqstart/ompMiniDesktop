import { useEffect, useRef, useState } from "react";

/**
 * 单开下拉容器：点击外部 / Esc 关闭，打开时聚焦首个可聚焦元素。
 * 解决截图问题 1：模型列表与思考等级弹窗同时开、点外部关不掉。
 */
export function useDropdown(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 打开即聚焦首个可聚焦元素（模型下拉是搜索框、其余是首个选项）：
    // 键盘用户不用先 Tab 一圈，Esc 关闭后焦点回到触发按钮由浏览器接管。
    const first = ref.current?.querySelector<HTMLElement>(
      'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // pointerdown 先于 button onClick：只有外部点击才关，触发按钮自身不受影响
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return ref;
}

/** 同一工具行内同时只允许一个下拉打开。 */
export function useSingleOpen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const bind = (id: string) => ({
    open: openId === id,
    setOpen: (v: boolean) => setOpenId(v ? id : null),
    close: () => setOpenId((cur) => (cur === id ? null : cur)),
  });
  return { openId, bind };
}
