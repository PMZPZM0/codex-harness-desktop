/**
 * 控件皮肤 · 宿主（Shadow DOM 渲染器）
 *
 * ⛔ 为什么必须 Shadow DOM：3800 个社区元素的 CSS 类名（.cta / .switch…）互相撞车、
 *   也和应用样式撞车——只有 shadow root 能让「元素原样渲染、互不污染」。
 *   点击/变更事件是 composed 的，穿 shadow 边界照常工作。
 *
 * label 替换：把元素里**最深的有字节点**换成应用传入的 label（Uiverse 元素结构千奇百怪，
 * 这是最稳的通用替换点；找不到有字节点就保留原文）。
 * 交互：元素里若有 input[type=checkbox]（Uiverse 开关的标准形态），原生交互即开 关，
 *   我们只同步 checked + 监听 change；没有 input 的元素退化为「整块点击」。
 */
import { useEffect, useRef } from "react";
import { loadCategory } from "../lib/ui-skin/load";

export type SkinHostProps = {
  /** "<cat>/<id>"，来自绑定存储 */
  elementId: string;
  /** 替换进元素的可见文本（按钮文字等） */
  label?: string;
  /** 开关语义（元素含 checkbox 时同步它） */
  checked?: boolean;
  disabled?: boolean;
  onToggle?: (next: boolean) => void;
  /** 预览模式：禁用交互（工坊网格里防误触） */
  preview?: boolean;
  className?: string;
  /**
   * 占位归一（全局统一的关键）：宿主锁定到该宽高（px），社区元素超出时等比缩小
   * （只缩不放）。同屏控件因此等高，不再出现「一颗大圆球混在胶囊里」。
   */
  fit?: { w: number; h: number };
};

/** 取元素里「最深的有字节点」的宿主元素（document 序里最后一个带直接文本的最深元素）。 */
function labelTarget(root: ShadowRoot): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDepth = -1;
  for (const el of Array.from(root.querySelectorAll("*")) as HTMLElement[]) {
    const hasText = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
    );
    if (!hasText) continue;
    let d = 0;
    let cur: HTMLElement | null = el;
    while (cur) {
      d += 1;
      cur = cur.parentElement;
    }
    if (d >= bestDepth) {
      bestDepth = d;
      best = el;
    }
  }
  return best;
}

export function SkinHost({ elementId, label, checked, disabled, onToggle, preview, className, fit }: SkinHostProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const stateRef = useRef({ checked: Boolean(checked), disabled: Boolean(disabled), preview: Boolean(preview) });
  stateRef.current = { checked: Boolean(checked), disabled: Boolean(disabled), preview: Boolean(preview) };

  const [cat, id] = elementId.includes("/") ? [elementId.slice(0, elementId.indexOf("/")), elementId.slice(elementId.indexOf("/") + 1)] : ["", elementId];
  // fit 以稳定字符串进依赖（调用点常写内联字面量，对象引用每次渲染都变 ⇒ 不稳定）
  const fitKey = fit ? `${fit.w}x${fit.h}` : "";
  const fitRef = useRef(fit);
  fitRef.current = fit;

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
      // ⓪ 占位归一：宿主锁 fit 尺寸，内容超了等比缩小（只缩不放；transform 不影响布局）
      const fit = fitRef.current;
      if (fit) {
        host.style.width = `${fit.w}px`;
        host.style.height = `${fit.h}px`;
        host.style.display = "inline-flex";
        host.style.alignItems = "center";
        host.style.justifyContent = "center";
        host.style.overflow = "visible";
        const inner = mount.firstElementChild as HTMLElement | null;
        const w = inner?.offsetWidth ?? 0;
        const h = inner?.offsetHeight ?? 0;
        const s = Math.min(1, w > 0 ? fit.w / w : 1, h > 0 ? fit.h / h : 1);
        mount.style.transform = s < 1 ? `scale(${s})` : "";
        mount.style.transformOrigin = "center center";
      }
      // ① label 替换
      if (label != null && label !== "") {
        const target = labelTarget(root);
        if (target) target.textContent = label;
      }
      // ② 交互：优先元素自带的 checkbox；没有则整块点击
      const wire = () => {
        const input = root.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (input) {
          input.checked = stateRef.current.checked;
          input.disabled = stateRef.current.disabled || stateRef.current.preview;
          input.addEventListener("change", () => {
            if (!stateRef.current.preview && !stateRef.current.disabled) toggleRef.current?.(input.checked);
          });
        } else if (!preview) {
          host.addEventListener("click", (ev) => {
            if (stateRef.current.disabled || stateRef.current.preview) return;
            ev.stopPropagation();
            toggleRef.current?.(!stateRef.current.checked);
          });
        }
      };
      wire();
      // ③ checked 外部变化 ⇒ 同步进元素（不重注入）
      (host as HTMLSpanElement & { __sync?: () => void }).__sync = () => {
        const input = root.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (input) input.checked = stateRef.current.checked;
      };
    });
    return () => {
      disposed = true;
    };
  }, [cat, id, label, fitKey]);

  // checked / disabled 变化 → 同步已有实例
  useEffect(() => {
    const host = hostRef.current as (HTMLSpanElement & { __sync?: () => void }) | null;
    host?.__sync?.();
  }, [checked, disabled]);

  return <span ref={hostRef} className={`skin-host ${className ?? ""}`} data-skin={elementId} />;
}
