import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

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
