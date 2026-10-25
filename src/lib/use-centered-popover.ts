import { useLayoutEffect, useState, type RefObject } from "react";

/** 输入框底栏浮层统一规则（10-25）：贴着触发按钮水平居中，左右越界时向内收 margin。
 *  返回相对浮层 offsetParent 的 left（px）；未打开/未测量时 undefined。
 *  ⛔ 不用 translateX：浮层进场动画也改 transform，会被覆盖；直接给 left 最稳。 */
export function useCenteredPopoverLeft(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  margin = 8,
): number | undefined {
  const [left, setLeft] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open) { setLeft(undefined); return; }
    const update = () => {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const t = trigger.getBoundingClientRect();
      const width = pop.getBoundingClientRect().width;
      if (!width) return;
      const desired = t.left + t.width / 2 - width / 2;
      const clamped = Math.max(margin, Math.min(desired, window.innerWidth - width - margin));
      const parent = pop.offsetParent as HTMLElement | null;
      setLeft(clamped - (parent?.getBoundingClientRect().left ?? 0));
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer && popRef.current) observer.observe(popRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, triggerRef, popRef, margin]);
  return left;
}
