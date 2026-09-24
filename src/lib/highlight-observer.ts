/** 高亮观察器单例（从 src/App.tsx 原样搬来）。单例 + 惰性创建，App 与其它模块共用同一份。 */

// ── 懒高亮的视口邻近检测（09-18）──────────────────────────────────────────────
// 共享**一个** IntersectionObserver（渲染层可能有几百个代码块，一人一个 observer 是灾难），
// 返回后即 unobserve（一次性）。rootMargin 给足预载距离：切换/滚动到位的瞬间它早就高亮好了，
// 用户看不到"从灰变彩"的过程。
export const highlightObserveCallbacks = new WeakMap<Element, () => void>();
let sharedHighlightObserver: IntersectionObserver | null = null;
export function getHighlightObserver(): IntersectionObserver | null {
  if (sharedHighlightObserver) return sharedHighlightObserver;
  if (typeof IntersectionObserver !== "function") return null;
  sharedHighlightObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = highlightObserveCallbacks.get(entry.target);
      highlightObserveCallbacks.delete(entry.target);
      try { sharedHighlightObserver?.unobserve(entry.target); } catch { /* ignore */ }
      callback?.();
    }
  }, { rootMargin: "1200px 0px" });   // 上下各预载 1200px
  return sharedHighlightObserver;
}
