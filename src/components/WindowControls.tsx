import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";

/** 无边框窗（win32 大圆角）的自定义窗口按钮：最小化 / 最大化-还原 / 关闭。
 *  ⛔ 原生 titleBarOverlay 已随透明无边框窗移除（它会浮在圆角外的透明区）；
 *     按钮只操作**当前窗口**（IPC 端用 event.sender 反查，不接受任意句柄）。
 *  ⛔ 拖动区按 no-drag 处理，否则点不到按钮。 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (document.documentElement.dataset.os !== "win32") return;
    const apply = (next: boolean) => {
      setMaximized(next);
      document.documentElement.dataset.maximized = next ? "1" : "";
    };
    const off = window.codex.onHarnessEvent?.((event: any) => {
      if (event?.type === "shell:maximized") apply(Boolean(event.maximized));
    });
    void window.codex.windowState?.().then((state: any) => apply(Boolean(state?.maximized))).catch(() => undefined);
    // 双击拖拽区/系统手势最大化时不会有按钮回执 ⇒ 窗口尺寸变化后主动对一次状态
    const onResize = () => { void window.codex.windowState?.().then((state: any) => apply(Boolean(state?.maximized))).catch(() => undefined); };
    window.addEventListener("resize", onResize);
    return () => { off?.(); window.removeEventListener("resize", onResize); };
  }, []);
  if (document.documentElement.dataset.os !== "win32") return null;
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button type="button" title="最小化" aria-label="最小化" onClick={() => void window.codex.windowMinimize?.()}>
        <Minus size={15} />
      </button>
      <button type="button" title={maximized ? "还原" : "最大化"} aria-label={maximized ? "还原" : "最大化"} onClick={async () => { const state: any = await window.codex.windowToggleMaximize?.().catch(() => null); if (state) { setMaximized(Boolean(state.maximized)); document.documentElement.dataset.maximized = state.maximized ? "1" : ""; } }}>
        {maximized ? <Copy size={13} style={{ transform: "scaleX(-1)" }} /> : <Square size={13} />}
      </button>
      <button type="button" className="window-close" title="关闭" aria-label="关闭" onClick={() => void window.codex.windowClose?.()}>
        <X size={15} />
      </button>
    </div>
  );
}
