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

/** 取预览台元素（网格卡片 / 详情浮层各一处） */
function stageOf(host: HTMLElement): HTMLElement | null {
  return host.closest(".ui-skin-preview, .comp-lib-preview-row");
}

/** 组件自身是「透明底 + 浅色文字」时（GLITCH 这类），浅色预览台上几乎看不见 ⇒ 该格换成深色台。
 *  判据只看组件根元素自己的计算样式：有实底色的组件颜色由它自己决定，台子是浅是深都一样。 */
function stageContrast(host: HTMLElement, mount: HTMLElement) {
  const stage = stageOf(host);
  if (!stage) return;
  const probe = (mount.firstElementChild as HTMLElement | null) ?? mount;
  let dark = false;
  try {
    const style = getComputedStyle(probe);
    const rgba = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    const alpha = rgba.length >= 4 ? rgba[3] : rgba.length === 3 ? 1 : 0;
    const text = style.color.match(/[\d.]+/g)?.map(Number) ?? [];
    const light = text.length >= 3 && (0.2126 * text[0] + 0.7152 * text[1] + 0.0722 * text[2]) > 190;
    dark = alpha < 0.2 && light;
  } catch { /* 取不到样式就按浅色台 */ }
  if (dark) stage.style.setProperty("--skin-stage", "#232327");
  else stage.style.removeProperty("--skin-stage");
}

/** 社区组件尺寸不一：有的比预览台还大（卡片组 / 大开关），直接 overflow:hidden 会把内容裁掉一半。
 *  这里按可用框等比缩小（只缩不放），缩完仍然居中 —— 用户 10-30 截图里那几个被切掉的就是这类。 */
function fitToBox(host: HTMLElement, mount: HTMLElement) {
  const apply = () => {
    if (!host.isConnected || !mount.isConnected) return;
    mount.style.transform = "";
    /* 用 scroll 尺寸而不是 offset：社区组件常把圆点/阴影挂成绝对定位的子元素，
       子元素溢出时 offsetWidth 仍是"外框宽"，缩放会算成 1（实测「Contact Us」开关右侧被裁）。 */
    const width = Math.max(mount.offsetWidth, mount.scrollWidth);
    const height = Math.max(mount.offsetHeight, mount.scrollHeight);
    const availW = host.clientWidth;
    const availH = host.clientHeight;
    if (!width || !height || !availW || !availH) return;
    const scale = Math.min(1, availW / width, availH / height);
    if (scale < 0.995) {
      mount.style.transformOrigin = "center center";
      mount.style.transform = `scale(${scale})`;
    }
    stageContrast(host, mount);
  };
  /* 字体/图片加载完成后尺寸会变一次 ⇒ 下一帧重测；之后尺寸再变（动画、字体回流）交给 ResizeObserver。 */
  requestAnimationFrame(() => requestAnimationFrame(apply));
  try {
    const observer = new ResizeObserver(apply);
    observer.observe(mount);
    observer.observe(host);
    host.addEventListener("skin-host-dispose", () => observer.disconnect(), { once: true });
  } catch { /* 老内核没有 ResizeObserver：只做首帧适配 */ }
}

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
      mount.className = "skin-mount";
      mount.innerHTML = item.html;
      root.appendChild(mount);
      fitToBox(host, mount);
    });
    return () => {
      disposed = true;
      host?.dispatchEvent(new Event("skin-host-dispose"));
    };
  }, [cat, id]);

  return <span ref={hostRef} className={`skin-host ${className ?? ""}`} data-skin={elementId} />;
}
