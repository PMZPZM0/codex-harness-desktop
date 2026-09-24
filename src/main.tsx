import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

/* chunk 加载失败自愈（09-23 崩溃修复）：产物重建后旧 hash 的 chunk 被清掉，
   运行中的实例点开 lazy 页面会报 "Failed to fetch dynamically imported module"。
   Vite 官方事件 ⇒ preventDefault 后自己处理：重载一次拿新产物（10s 内只做一次，防死循环）。 */
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const KEY = "__chunk_reload_at";
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// 启动耗时测量（09-17，为加载动画方案量化依据；与 electron/boot-timing.ts 配套）：
// performance.timeOrigin ≈ 页面导航开始，可与主进程的 page-start-loading 对齐。
(window as unknown as { __boot: Record<string, number> }).__boot = { mount: performance.now() };