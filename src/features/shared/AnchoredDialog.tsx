/**
 * 归属气泡（11-11 用户令：「改名 / 删除这些小窗口就近弹，哪里点击就在哪里，带归属箭头」）。
 *
 * 位置 = 触发按钮旁边（右优先，右边放不下翻到左边），垂直居中并夹进视口；
 * 小三角（::before）指回触发按钮。⛔ 不动全局模态那套：没有锚点时仍走居中弹窗。
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type DialogAnchor = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** 气泡壳：按调用方给的锚点定位（右优先，放不下翻左），画卡片 + 指回小三角。 */
export function AnchoredDialogCard({ anchor, ariaLabel, width = 320, onClose, children }: {
  anchor: DialogAnchor | null;
  ariaLabel: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; side: "left" | "right"; arrowTop: number } | null>(null);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!anchor || !el) return;
    const margin = 8;
    const gap = 10;
    const height = el.offsetHeight;
    const canRight = anchor.right + gap + width <= window.innerWidth - margin;
    const side: "left" | "right" = canRight ? "right" : "left";
    const left = side === "right" ? anchor.right + gap : Math.max(margin, anchor.left - width - gap);
    const top = Math.max(margin, Math.min(anchor.top + anchor.height / 2 - height / 2, window.innerHeight - height - margin));
    const arrowTop = Math.max(16, Math.min(anchor.top + anchor.height / 2 - top, height - 16));
    setBox({ left, top, side, arrowTop });
  }, [anchor, width]);

  if (!anchor) return null;
  return createPortal(
    <>
      <button type="button" className="dialog-anchor-backdrop" aria-label="关闭" onClick={onClose} />
      <div
        ref={cardRef}
        className={`dialog-anchor-card side-${box?.side ?? "right"}`}
        role="dialog"
        aria-label={ariaLabel}
        style={{ left: box?.left ?? 8, top: box?.top ?? 8, width, visibility: box ? "visible" : "hidden", "--arrow-top": `${box?.arrowTop ?? 24}px` } as CSSProperties}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
