/**
 * 顶栏浮层的定位 hook（2026-10-04）。
 *
 * ⛔⛔ 为什么需要它：`.topbar` 上有 `overflow: hidden`（修「顶栏图标压到原生窗口钮底下」，
 *   见守卫【250】）。CSS 规定 `overflow: hidden` 会裁掉**整棵子树**的后代，
 *   与 z-index 无关 ⇒ 凡是 `.topbar` 里的 `position: absolute` 弹层都会被裁掉、点了没反应。
 *   顶栏搜索面板早就是 `portal 到 body + position: fixed`（见 `19-misc-hints.css`），
 *   所以它不受影响 —— 这就是本 hook 存在的意义：让其余弹层用同一手法。
 *
 * ✅ 为什么 fixed 不会被裁：fixed 的包含块是**视口**，只有当祖先链上出现
 *   `transform` / `filter` / `contain` / `will-change` 时才会被改锚到那个祖先。
 *   已核实本仓这几个属性只出现在侧栏（`.sidebar` 的 translate）与设置弹窗上，
 *   **不在 `.topbar` 的祖先链上**。
 *
 * ⚠️ 用法约束：
 *   1. 弹层本体必须 `portal` 到 `document.body`（只改 position 不够，仍在子树里）；
 *   2. 原 relative 定位的 `top/right/bottom` 必须清掉（见 `.dispatch-pop-fixed`），
 *      否则会与 JS 坐标叠加；
 *   3. `width` 要与 CSS 里的实际宽度一致，否则右对齐会算偏。
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

export type AnchorPlacement = "bottom-right" | "bottom-left";

export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  width: number,
  placement: AnchorPlacement = "bottom-right",
): CSSProperties {
  // 初始值放到视口外：未量到坐标前不闪一下再跳位
  const [style, setStyle] = useState<CSSProperties>({ top: -9999, left: -9999 });

  const place = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 8;
    const margin = 8;
    const left =
      placement === "bottom-right"
        ? Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width))
        : Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left));
    setStyle({ top: Math.round(rect.bottom + gap), left: Math.round(left) });
  }, [anchorRef, width, placement]);

  useEffect(() => {
    if (!open) return;
    place();
    // 顶栏本身不滚动，但右侧面板开合/窗口缩放会改按钮位置 ⇒ resize 必须重算
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return style;
}

/** 顶栏浮层统一 z-index：必须高于 `.topbar`（z-index:30）与设置内遮罩（80~97）。 */
export const TOPBAR_POPOVER_Z = 10100;
