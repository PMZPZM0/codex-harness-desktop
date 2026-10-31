import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CloseConfirmDialog } from "./components/CloseConfirmDialog";
import { WindowControls } from "./components/WindowControls";
import { startAnnounceEngineProbe } from "./voice/engine-ready";
import { PetFloat, PetActivity } from "./features/pet";
import { AppLockGate } from "./features/app-lock";
import "./styles.css";

/* 桌面宠物浮窗：`?pet=1` 渲染宠物本体，`?pet=activity` 渲染活动气泡（两个独立透明窗）。
   ⛔ 分流必须在这里做，不能塞进 App()：`useHarnessApp()` 是 hook，
      条件调用会破坏 hook 调用序（规则层面就不允许）。 */
const petSurface = (() => {
  try { return new URLSearchParams(window.location.search).get("pet") ?? ""; } catch { return ""; }
})();
const isPetWindow = petSurface === "1";
const isPetActivityWindow = petSurface === "activity";
/* 浮窗要**整窗透明**（否则透明窗口上会盖一块不透明底）；用 html 属性做开关，
   样式集中在 22-pet.css 里，别在这写内联 style。 */
if (isPetWindow || isPetActivityWindow) {
  try { document.documentElement.dataset.petWindow = isPetWindow ? "1" : "activity"; } catch { /* 忽略 */ }
}

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

/* 播报引擎就绪探针（10-31）：开机探一次 —— 主进程靠 `voice:models-status` 顺手刷新
   自己的缓存，从而在下发常驻指令时知道「播报到底能不能出声」。⛔ 宠物浮窗不探（它不出声）。 */
if (!isPetWindow && !isPetActivityWindow) startAnnounceEngineProbe();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* ⛔⛔ 自绘窗口钮必须在 ErrorBoundary **外面**：渲染层一旦抛错，边界会把整棵树换成
        「界面发生错误」卡片；钮若在树里就跟着消失，用户连关窗口都点不到（10-31 #310 实测）。
        原生窗框时代系统钮是独立的合成层，没有这个问题 —— 自绘就得自己把它放到同一层级。 */}
    <ErrorBoundary>
      {isPetActivityWindow ? <PetActivity /> : isPetWindow ? <PetFloat /> : <AppLockGate><App /></AppLockGate>}
    </ErrorBoundary>
    {/* 透明宠物浮窗不挂窗口钮（它本来就不该有窗框感） */}
    {!(isPetWindow || isPetActivityWindow) && <WindowControls />}
    {/* ⛔⛔ 10-31 用户：「登录界面右上角三个按键都是假的」——关窗被主进程 preventDefault 后
        经 `close-confirm:ask` 找渲染层要答案，而这张卡原来挂在 AppView 里 ⇒ **登录页根本没有
        AppView**，问出去没人接，窗口永远关不掉（最小化/最大化是直接生效的，所以只有它"假"）。
        ⇒ 与窗口钮同样挂到根上（错误边界之外）。 */}
    {!(isPetWindow || isPetActivityWindow) && <CloseConfirmDialog />}
  </StrictMode>,
);

// 启动耗时测量（09-17，为加载动画方案量化依据；与 electron/boot-timing.ts 配套）：
// performance.timeOrigin ≈ 页面导航开始，可与主进程的 page-start-loading 对齐。
(window as unknown as { __boot: Record<string, number> }).__boot = { mount: performance.now() };