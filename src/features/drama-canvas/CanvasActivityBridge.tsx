/**
 * 画布活动桥（11-26 用户令：「codex 调用画布工作流就绿灯自动展开，在这里同步展示」）。
 *
 * 为什么单独一层：模型调 `workflow_read / workflow_writeback` 时主进程只**广播事件**，
 * 而「开右栏 + 切到画布页」只有 AppView 做得到（它拿着 setRightTab / setRightOpen）；
 * 画布本身按需挂载，事件到达时它可能还没渲染 ⇒ 不能把这件事挂在画布组件里。
 *
 * 做三件事：
 *  ① 把「模型在动画布」记进活动事件箱 ⇒ 右栏标签条亮绿灯（`subscribeCanvasActivity`）；
 *  ② 自动开右栏并切到画布页（窄于 420px 顺手放宽 —— 308px 下三列卡片会挤成一列）；
 *  ③ 挂载前到达的回填排队（见 canvas-activity.mjs），画布起来时补上。
 * ⛔ 不在这里读画布数据、不改 board：数据仍只走 workflow_read / workflow_writeback 那条链。
 */
import { useEffect, useRef } from "react";
import { noteCanvasActivity } from "../../lib/canvas-activity.mjs";

/** 挂到 AppView 根：收到画布活动就开右栏切画布页。`openCanvas` 由 AppView 注入（它才拿得到导航方法）。 */
export function CanvasActivityBridge({ openCanvas }: { openCanvas: () => void }) {
  /** ⛔ 回调每次渲染都是新函数 ⇒ 用 ref 存最新那份，订阅只建立一次（否则中途会漏事件）。 */
  const openRef = useRef(openCanvas);
  openRef.current = openCanvas;

  useEffect(() => {
    const off = window.codex.onHarnessEvent?.((event: unknown) => {
      const e = (event ?? {}) as { type?: string; action?: string; name?: string; nodeId?: string; updates?: Record<string, string | number> };
      const type = String(e.type ?? "");
      if (type === "drama-canvas-writeback") {
        noteCanvasActivity({
          type: "writeback",
          canvas: String(e.name ?? ""),
          nodeId: String(e.nodeId ?? ""),
          updates: e.updates && typeof e.updates === "object" ? e.updates : {},
        });
        openRef.current?.();
        return;
      }
      if (type !== "drama-canvas-activity") return;
      noteCanvasActivity({
        type: "activity",
        action: String(e.action ?? ""),
        canvas: String(e.name ?? ""),
        nodeId: String(e.nodeId ?? ""),
      });
      openRef.current?.();
    });
    return () => { off?.(); };
  }, []);

  return null;
}
