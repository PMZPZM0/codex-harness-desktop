/**
 * AnchorPopover（10-27 架构审查 P1-3）：**全仓唯一的浮层定位实现**。
 *
 * 为什么要它：审查时数出来 **37 个文件**自己调 `getBoundingClientRect` 做"贴边 / 翻转 / 夹进视口"，
 * 每个都各写一遍，出问题时症状一样（被切掉、跑到屏幕外、小窗口不出来），修的时候要改 N 处。
 *
 * 契约：
 *  · 锚点 = 元素（`anchor`）或**一个矩形**（鼠标右键菜单这种没有元素的场景传 clientX/Y 包成矩形）；
 *  · 轴 = `x`（左右展开，如输入框竖条）或 `y`（上下展开，如侧栏「更多」）；
 *  · `prefer` 可强制某侧；`auto` 时按空间选（轴 x：右边够就右，否则翻左；轴 y：上方够就上，否则下）；
 *  · 另一轴按 `align`（start 贴齐锚点 / center 居中）并**夹进视口**；
 *  · `maxHeight` 取所选侧可用空间 —— 内容超长时**面板内部滚动**，而不是被屏幕切掉；
 *  · portal 到 body + 点外关闭 + Esc 关闭 + resize/scroll 跟随（内容尺寸变化用 ResizeObserver 重算）。
 *
 * ⛔ 新浮层一律用它；别再往组件里手写 getBoundingClientRect + fixed。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type AnchorRect = { left: number; right: number; top: number; bottom: number };
export type PopoverAxis = "x" | "y";
export type PopoverSide = "right" | "left" | "above" | "below";

export type PlacePopoverOptions = {
  axis: PopoverAxis;
  prefer?: PopoverSide | "auto";
  align?: "start" | "center";
  gap?: number;
  pad?: number;
  viewport?: { w: number; h: number };
};

/** 纯函数：给定锚点矩形 / 面板尺寸 / 偏好，算出 fixed 定位（同时给出可用高度）。 */
export function placePopover(anchor: AnchorRect, size: { w: number; h: number }, options: PlacePopoverOptions) {
  const { axis, prefer = "auto", align = "start", gap = 8, pad = 8 } = options;
  const viewport = options.viewport ?? { w: window.innerWidth, h: window.innerHeight };
  const w = Math.min(size.w, viewport.w - pad * 2);
  const h = Math.min(size.h, viewport.h - pad * 2);
  const space = {
    right: viewport.w - anchor.right - gap - pad,
    left: anchor.left - gap - pad,
    above: anchor.top - gap - pad,
    below: viewport.h - anchor.bottom - gap - pad,
  };

  let side: PopoverSide;
  if (prefer !== "auto") side = prefer;
  else if (axis === "x") side = space.right >= w || space.right >= space.left ? "right" : "left";
  else side = space.above >= h ? "above" : "below";

  let left: number;
  let top: number;
  if (side === "right") left = anchor.right + gap;
  else if (side === "left") left = anchor.left - gap - w;
  else if (align === "center") left = anchor.left + (anchor.right - anchor.left) / 2 - w / 2;
  else left = anchor.left;

  if (side === "above") top = anchor.top - gap - h;
  else if (side === "below") top = anchor.bottom + gap;
  else if (align === "center") top = anchor.top + (anchor.bottom - anchor.top) / 2 - h / 2;
  else top = anchor.top;

  left = Math.max(pad, Math.min(left, viewport.w - w - pad));
  top = Math.max(pad, Math.min(top, viewport.h - h - pad));

  /* 所选侧的真实可用高度：面板内容超长时用它内部滚动，而不是被屏幕切掉 */
  const maxHeight = Math.max(120, side === "above" ? anchor.top - gap - pad : side === "below" ? viewport.h - anchor.bottom - gap - pad : viewport.h - top - pad);
  return { left, top, width: w, maxHeight, side };
}

export type AnchorPopoverProps = {
  open: boolean;
  /** 锚点：元素或矩形（右键菜单传 clientX/Y 包一个零尺寸矩形） */
  anchor: HTMLElement | AnchorRect | null;
  onClose: () => void;
  axis: PopoverAxis;
  prefer?: PopoverSide | "auto";
  align?: "start" | "center";
  /** 面板目标宽度；内容更宽时以它为准 */
  width: number;
  /** 期望高度（用于判断放不放得下）；实际高度由内容决定，上限见 maxHeight */
  height?: number;
  gap?: number;
  /** 点这些区域不算"点外面"（通常是触发按钮自己） */
  ignoreRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  role?: string;
  ariaLabel?: string;
  children: ReactNode;
};

export function AnchorPopover({
  open, anchor, onClose, axis, prefer = "auto", align = "start", width, height = 200, gap, ignoreRef, className, role = "dialog", ariaLabel, children,
}: AnchorPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  const reposition = useCallback(() => {
    const element = anchor && "getBoundingClientRect" in anchor ? anchor : null;
    const rect: AnchorRect | null = element ? element.getBoundingClientRect() : (anchor as AnchorRect | null);
    if (!rect) { setPlacement(null); return; }
    const measured = panelRef.current?.offsetHeight ?? height;
    const next = placePopover(rect, { w: width, h: Math.min(measured, height) || height }, { axis, prefer, align, gap });
    /* ⛔ 值没变就别 setState：滚动事件是高频的，面板里还挂着收藏夹/日记列表（节点多）
       —— 每滚一帧重渲染一次纯属浪费。 */
    setPlacement((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.maxHeight === next.maxHeight ? prev : next));
  }, [anchor, axis, prefer, align, width, height, gap]);

  useLayoutEffect(() => { if (open) reposition(); else setPlacement(null); }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => reposition();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    const panel = panelRef.current;
    const observer = panel ? new ResizeObserver(() => reposition()) : null;
    if (panel && observer) observer.observe(panel);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      observer?.disconnect();
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (ignoreRef?.current?.contains(target)) return;
      const element = anchor && "contains" in anchor ? (anchor as HTMLElement) : null;
      if (element?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, ignoreRef, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={className}
      role={role}
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        left: placement?.left ?? -9999,
        top: placement?.top ?? -9999,
        width: placement?.width ?? width,
        maxHeight: placement?.maxHeight,
        visibility: placement ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
