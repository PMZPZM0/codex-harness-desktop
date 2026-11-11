/**
 * 归属气泡（11-11 用户令：「改名 / 删除这些小窗口就近弹，哪里点击就在哪里，带归属箭头」）。
 *
 * 位置 = 触发按钮旁边（右优先，右边放不下翻到左边），垂直居中并夹进视口；
 * 小三角（::before）指回触发按钮。⛔ 不动全局模态那套：没有锚点时仍走居中弹窗。
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type DialogAnchor = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Side = "top" | "bottom" | "left" | "right";

/** 气泡壳：按调用方给的锚点就近定位（优先上方 → 下方 → 右侧 → 左侧），画卡片 + 指回触发处的小三角。 */
export function AnchoredDialogCard({ anchor, ariaLabel, width = 280, onClose, children }: {
  anchor: DialogAnchor | null;
  ariaLabel: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; side: Side; arrowX: number; arrowY: number } | null>(null);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!anchor || !el) return;
    const margin = 8;
    const gap = 12;
    const height = el.offsetHeight;
    const centerX = anchor.left + anchor.width / 2;
    const centerY = anchor.top + anchor.height / 2;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
    /* 11-11 用户纠正：「要跟会话/项目这一行对上」——侧栏里的锚点优先**贴右侧**（和菜单同一列，
       箭头左侧指回「⋯」）；主内容区里的按钮才优先上下弹。 */
    const inSidebar = anchor.right <= 360;
    /* 贴右侧时锚到**侧栏右缘**（不是按钮右缘）：按钮在侧栏里，直接用按钮右缘会让卡片压进侧栏。 */
    const sidebar = inSidebar ? document.querySelector(".sidebar")?.getBoundingClientRect() ?? null : null;
    const rightBase = sidebar ? Math.max(anchor.right, sidebar.right) : anchor.right;
    let side: Side = "top";
    if (inSidebar && rightBase + gap + width <= window.innerWidth - margin) side = "right";
    else if (anchor.top - gap - height >= margin) side = "top";
    else if (anchor.bottom + gap + height <= window.innerHeight - margin) side = "bottom";
    else if (anchor.right + gap + width <= window.innerWidth - margin) side = "right";
    else side = "left";
    let left: number;
    let top: number;
    let arrowX = 0;
    let arrowY = 0;
    if (side === "top" || side === "bottom") {
      left = clamp(centerX - width / 2, margin, window.innerWidth - width - margin);
      top = side === "top" ? anchor.top - gap - height : anchor.bottom + gap;
      arrowX = clamp(centerX - left, 16, width - 16);
    } else {
      left = side === "right" ? rightBase + gap : Math.max(margin, anchor.left - width - gap);
      top = clamp(centerY - height / 2, margin, window.innerHeight - height - margin);
      arrowY = clamp(centerY - top, 16, height - 16);
    }
    setBox({ left, top, side, arrowX, arrowY });
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
        style={{ left: box?.left ?? 8, top: box?.top ?? 8, width, visibility: box ? "visible" : "hidden", "--arrow-x": `${box?.arrowX ?? 24}px`, "--arrow-y": `${box?.arrowY ?? 24}px` } as CSSProperties}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
