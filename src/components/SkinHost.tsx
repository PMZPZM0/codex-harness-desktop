/**
 * 组件库 · 预览宿主（Shadow DOM 渲染器）
 *
 * ⛔ 为什么必须 Shadow DOM：社区组件的 CSS 类名（.cta / .switch…）互相撞车、
 *   也和应用样式撞车——只有 shadow root 能让「元素原样渲染、互不污染」。
 *   用途仅剩组件库的预览网格/详情浮层。**保持元素原生可交互**（用户 10-01：
 *   「开关点不动看不到效果」）——checkbox 点击后 :checked 样式自动跟随，
 *   按钮/加载器的 hover 与动画天然可见；⛔ 不要再往 input 上加 disabled。
 */
import { useEffect, useRef } from "react";
import { loadCategory } from "../lib/ui-skin/load";

export type SkinHostProps = {
  /** "<cat>/<id>"，来自组件库目录 */
  elementId: string;
  className?: string;
};

export function SkinHost({ elementId, className }: SkinHostProps) {
  const hostRef = useRef<HTMLSpanElement>(null);

  const [cat, id] = elementId.includes("/") ? [elementId.slice(0, elementId.indexOf("/")), elementId.slice(elementId.indexOf("/") + 1)] : ["", elementId];

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !cat || !id) return;
    let disposed = false;
    void loadCategory(cat).then(({ items }) => {
      if (disposed || !host.isConnected) return;
      const item = items.find((x) => x.id === id);
      if (!item) {
        host.textContent = "";
        return;
      }
      // 每次重绑都重建 shadow root（innerHTML 换内容会残留旧 <style>）
      const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      root.innerHTML = "";
      const mount = document.createElement("div");
      mount.innerHTML = item.html;
      root.appendChild(mount);
    });
    return () => {
      disposed = true;
    };
  }, [cat, id]);

  return <span ref={hostRef} className={`skin-host ${className ?? ""}`} data-skin={elementId} />;
}
