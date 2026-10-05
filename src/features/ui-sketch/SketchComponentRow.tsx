/**
 * 组件库挑选行（`ui-sketch` 域内，10-05）—— 一行一个 Uiverse 控件，**带真实外观预览**。
 *
 * 预览复用基座 `components/SkinHost`（Shadow DOM 隔离，⛔ 不在这里复制一份渲染逻辑）：
 * 社区组件的类名（.cta / .switch…）彼此撞车也和应用撞车，只有 shadow root 能让它原样渲染。
 *
 * ⛔ 预览**懒挂载**：一个类目最多 1200 多个控件，全部立刻 attachShadow + innerHTML 会把
 *   弹窗卡死（组件库设置页是靠分页只渲染一屏，这里是一整条长列表，只能按可见性挂）。
 * ⛔ 预览容器 `pointer-events:none`：行本身要能点（勾中/取消），不能让控件抢走点击。
 *   代价是 hover 态看不到 —— 要看效果去「设置 → 组件库」那一页，那里是可交互的。
 */
import { useEffect, useRef, useState } from "react";
import { SkinHost } from "../../components/SkinHost";
import type { SketchEntry } from "./sketch-doc.mjs";

export function SketchComponentRow({ entry, picked, onToggle }: { entry: SketchEntry; picked: boolean; onToggle: () => void }) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const row = rowRef.current;
    const list = row?.closest(".ui-sketch-list") ?? null;
    if (!row || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    }, { root: list, rootMargin: "240px" });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <button type="button" ref={rowRef} className={picked ? "picked" : ""} title={`${entry.name} · 作者 ${entry.author}`} onClick={onToggle}>
      <span className="ui-sketch-pick">{picked ? "✓" : "+"}</span>
      <span className="ui-sketch-id">
        <span className="ui-sketch-name">{entry.name}</span>
        <span className="ui-sketch-author">{entry.author}</span>
      </span>
      <span className="ui-sketch-preview">{seen ? <SkinHost elementId={`${entry.cat}/${entry.id}`} /> : <span className="ui-sketch-preview-wait">…</span>}</span>
    </button>
  );
}
