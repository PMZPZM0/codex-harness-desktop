/** useNearViewport（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { useState, useEffect } from "react";
import { getHighlightObserver, highlightObserveCallbacks } from "../../lib/highlight-observer";

export function useNearViewport(ref: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(!enabled);
  useEffect(() => {
    if (!enabled || near) return;
    const el = ref.current;
    if (!el) return;
    const observer = getHighlightObserver();
    if (!observer) { setNear(true); return; }   // 环境不支持（老浏览器/测试）：直接高亮
    highlightObserveCallbacks.set(el, () => setNear(true));
    observer.observe(el);
    return () => {
      highlightObserveCallbacks.delete(el);
      try { observer.unobserve(el); } catch { /* ignore */ }
    };
  }, [enabled, near]);
  return near || !enabled;
}
