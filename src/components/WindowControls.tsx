import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Minus, Square, X } from "lucide-react";

/** 窗口控制钮（Windows 独占；mac 的红绿灯是系统画的，这里直接不渲染）。
 *
 *  ⛔⛔ 10-31 用户：「更小的按钮 + 更小的 hover 块」——原生 WCO 三钮的**尺寸与 hover 块都是系统的**
 *  （46×32），渲染层只能挪位置、改不了大小。⇒ 主窗口改 `frame: false`（见 electron/features/
 *  window-factory.ts），三个钮由本组件自绘：26×26 / 圆角 6 / hover 块就是那 26×26。
 *
 *  ⛔ 为什么 portal 到 body + `position: fixed` + 高 z-index：
 *     原生钮是**系统合成层**，永远盖在页面之上。自绘后若留在 `.topbar`（z 30）里，
 *     办公室浮层(400)/设置(80~97)/灯箱(900)/确认框(950) 一开就把它埋掉 —— 窗口关不掉了。
 *     portal 出来放到 1000 档 = 复刻"系统层永远可点"的语义（层级表见附录 D）。
 *  ⛔ 必须 no-drag：顶栏是 `-webkit-app-region: drag`，按钮落进去会被 OS 当成标题栏吞掉点击。
 *  ⛔ 只操作**当前窗口**：IPC 端用 event.sender 反查，不接受任意句柄。 */
export function WindowControls() {
  /* ⛔⛔ `data-os` 是**另一个 effect**（app-state/…/02-update-ui-settings.tsx）写进 <html> 的，
     晚于首帧 ⇒ 这里若直接读 dataset 渲染，首帧拿到空串就 return null，而之后**没有任何东西保证
     会再渲染一次**（实测：靠别的 setState 撞上才显示，删掉那些就永久不出现）。
     ⇒ 用 state + MutationObserver 盯属性写入（一次性，写完即断开）。 */
  const [os, setOs] = useState(() => (typeof document === "undefined" ? "" : document.documentElement.dataset.os || ""));
  useEffect(() => {
    if (os) return;
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      const next = el.dataset.os || "";
      if (next) { setOs(next); observer.disconnect(); }
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-os"] });
    return () => observer.disconnect();
  }, [os]);
  const isWin = os === "win32";
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isWin) return;
    const apply = (next: boolean) => {
      setMaximized(next);
      document.documentElement.dataset.maximized = next ? "1" : "";
    };
    const off = window.codex.onHarnessEvent?.((event: any) => {
      if (event?.type === "shell:maximized") apply(Boolean(event.maximized));
    });
    void window.codex.windowState?.().then((state: any) => apply(Boolean(state?.maximized))).catch(() => undefined);
    /* 双击拖拽区 / Win+↑ / 贴边吸附最大化都不会有按钮回执 ⇒ 尺寸一变就主动对一次状态
       （图标要从「□」翻成「还原」） */
    const onResize = () => { void window.codex.windowState?.().then((state: any) => apply(Boolean(state?.maximized))).catch(() => undefined); };
    window.addEventListener("resize", onResize);
    return () => { off?.(); window.removeEventListener("resize", onResize); };
  }, [isWin]);
  if (!isWin) return null;
  return createPortal(
    <div className="window-controls" role="group" aria-label="窗口控制">
      <button type="button" title="最小化" aria-label="最小化" onClick={() => void window.codex.windowMinimize?.()}>
        <Minus size={15} strokeWidth={2} />
      </button>
      <button
        type="button"
        title={maximized ? "还原" : "最大化"}
        aria-label={maximized ? "还原" : "最大化"}
        onClick={async () => {
          const state: any = await window.codex.windowToggleMaximize?.().catch(() => null);
          if (state) {
            setMaximized(Boolean(state.maximized));
            document.documentElement.dataset.maximized = state.maximized ? "1" : "";
          }
        }}
      >
        {maximized ? <Copy size={14} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
      </button>
      <button type="button" className="window-close" title="关闭" aria-label="关闭" onClick={() => void window.codex.windowClose?.()}>
        <X size={15} strokeWidth={2} />
      </button>
    </div>,
    document.body,
  );
}
