/**
 * 悬浮球的轻互动：眼球跟着鼠标 + 打字时弹一块迷你键盘。
 *
 * ⛔ 性能：眼球位移**直接写 CSS 变量**（requestAnimationFrame 合并），不进 React state ——
 *    鼠标每动一次就重渲整个通话组件是不可接受的（同 --voice-level 的处理）。
 * ⛔ 只在悬浮球可见时挂监听；隐藏 / 其他窗口通话中立即摘掉并复位。
 * ⛔ 减动效：不跟随鼠标（位移归零），小键盘仍出现但动画由 CSS 关掉。
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { gazeOffsets, isTypingKey, isTypingTarget } from "../../lib/ball-reactions.mjs";

const TYPING_HOLD_MS = 1100;

export function useBallReactions({
  enabled,
  ballRef,
}: {
  enabled: boolean;
  ballRef: RefObject<HTMLElement | null>;
}) {
  const [typing, setTyping] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const frameRef = useRef(0);
  const pointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTyping(false);
      window.clearTimeout(timerRef.current);
      const el = ballRef.current;
      el?.style.removeProperty("--bot-gaze-x");
      el?.style.removeProperty("--bot-gaze-y");
      return;
    }

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      document.documentElement.dataset.motion !== "force";

    const paint = () => {
      frameRef.current = 0;
      const el = ballRef.current;
      const point = pointRef.current;
      if (!el || !point) return;
      const gaze = gazeOffsets(point.x, point.y, el.getBoundingClientRect(), reduced ? { x: 0, y: 0 } : undefined);
      el.style.setProperty("--bot-gaze-x", `${gaze.x}px`);
      el.style.setProperty("--bot-gaze-y", `${gaze.y}px`);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointRef.current = { x: event.clientX, y: event.clientY };
      if (!frameRef.current) frameRef.current = window.requestAnimationFrame(paint);
    };

    const resetGaze = () => {
      pointRef.current = null;
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      const el = ballRef.current;
      el?.style.removeProperty("--bot-gaze-x");
      el?.style.removeProperty("--bot-gaze-y");
    };

    const showTyping = () => {
      setTyping(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setTyping(false), TYPING_HOLD_MS);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!isTypingTarget(target?.tagName, Boolean(target?.isContentEditable))) return;
      if (!isTypingKey(event.key, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey })) return;
      showTyping();
    };

    const onComposition = () => showTyping();
    const onBlur = () => {
      resetGaze();
      setTyping(false);
      window.clearTimeout(timerRef.current);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("compositionstart", onComposition);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("compositionstart", onComposition);
      window.removeEventListener("blur", onBlur);
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(timerRef.current);
      resetGaze();
    };
  }, [enabled, ballRef]);

  return typing;
}
