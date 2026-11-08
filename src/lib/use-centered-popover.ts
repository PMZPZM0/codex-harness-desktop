import { useLayoutEffect, useState, type RefObject } from "react";

/** 贴按钮的浮层（11-08 用户令：「弹窗放到 + 号和 @ 图标上面自适应展示」）。
 *  返回**视口坐标**（配 `position: fixed` + portal 用），规则：
 *   · 水平：以按钮中心居中，左右越界向内收 margin（视觉锚点不丢）；
 *   · 垂直：默认在按钮**上方**弹出；上方放不下就翻到下方，两端都不够就贴底并内收；
 *   · 内容尺寸变化（搜索过滤条目增减）或窗口 resize 时重新量。
 *  ⛔ 不用 transform 定位（进场动画也用 transform，会互相覆盖）。 */
export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  options: { gap?: number; margin?: number } = {},
): { left: number; top: number } | undefined {
  const { gap = 6, margin = 8 } = options;
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open) { setPos(undefined); return; }
    const update = () => {
      const anchor = anchorRef.current;
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const r = anchor.getBoundingClientRect();
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      if (!width || !height) return;
      const left = Math.max(margin, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - margin));
      const above = r.top - height - gap;
      const top = above >= margin ? above : Math.min(r.bottom + gap, window.innerHeight - height - margin);
      setPos({ left, top });
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer && popRef.current) observer.observe(popRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, gap, margin]);
  return pos;
}

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
