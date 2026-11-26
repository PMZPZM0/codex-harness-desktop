/**
 * 画布右键菜单（域内私有）：根菜单 + 「新建卡片」二级列表。
 *
 * 为什么单开一个文件：`DramaCanvas.tsx` 已过千行（守卫【265】只许缩不许长），
 * 而这块是**纯展示**（位置钳制 + 二级切换 + 卡片类型表），搬出来既降行数也让画布本体只剩动作表。
 * ⛔ 不在这里读 board / story —— 落卡由画布通过 `onAddCard(kind, label)` 完成。
 * ⛔ 空白处右键多一项「新建卡片 ▸」（11-26 用户：「画布没有新建卡片功能」「配套齐全一点」）。
 */
import { useState } from "react";

export type CanvasMenuItem = { key: string; label: string; danger?: boolean; run: () => void };

/** 可新建的卡片类型（顺序即菜单顺序：最常用的三类在前）。 */
export const NEW_CARD_KINDS: Array<[kind: string, label: string]> = [
  ["note", "笔记"], ["imagegen", "生图"], ["image", "参考图"], ["script", "剧本"],
  ["character", "角色"], ["location", "场景"], ["storyboard", "分镜表"], ["shot", "镜头"],
  ["audio", "配音"], ["video", "视频"],
];

/** 画布右键菜单：根动作 + 「新建卡片」二级列表，坐标换算到画布容器内并钳进容器。
 *  `onAddCard` 不给就只出根动作（节点右键）；给了才出「新建卡片 ▸」。
 *  ⛔⛔ 坐标必须用**容器相对值**：画布根 `.drama-canvas-backdrop` 有 backdrop-filter
 *  （DESIGN.md 明写它会创建 containing block）⇒ 里面的 `position: fixed` 其实是相对画布，
 *  直接塞 clientX/clientY 会被画布在窗口里的偏移**再平移一次**，菜单整块飞出屏幕（实测 x=1892）。 */
export function DramaCanvasMenu({ at, container, items, onAddCard, onClose }: {
  at: { x: number; y: number };
  /** 画布根元素（算相对坐标与钳制边界）；拿不到就退回视口 */
  container?: HTMLElement | null;
  items: CanvasMenuItem[];
  /** 给了才出「新建卡片」二级（节点上的右键不传 —— 那里没有「新建」语义） */
  onAddCard?: (kind: string, label: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"root" | "add">("root");
  const rect = container?.getBoundingClientRect();
  const baseX = rect?.left ?? 0;
  const baseY = rect?.top ?? 0;
  const maxW = rect?.width ?? window.innerWidth;
  const maxH = rect?.height ?? window.innerHeight;
  /* ⛔ 钳进容器（10-06 用户令「弹窗类都要自适应，不能被裁剪」）：贴边右键会把菜单顶出去。
     高度按**最长那一屏**算，否则切到「新建卡片」时下级会被裁掉（另有 max-height 兜底滚动）。 */
  const span = Math.max(items.length + (onAddCard ? 1 : 0), onAddCard ? NEW_CARD_KINDS.length + 1 : 0);
  const left = Math.max(8, Math.min(at.x - baseX, maxW - 176));
  const top = Math.max(8, Math.min(at.y - baseY, maxH - (span * 30 + 16)));
  return (
    <div className="drama-canvas-context" style={{ left, top }} role="menu">
      {mode === "add" ? <button className="is-back" onClick={() => setMode("root")}>← 返回</button> : null}
      {mode === "add"
        ? NEW_CARD_KINDS.map(([kind, label]) => (
            <button key={kind} onClick={() => { onClose(); onAddCard?.(kind, label); }}>{label}</button>
          ))
        : items.map((item) => (
            <button key={item.key} className={item.danger ? "is-danger" : ""} onClick={() => { onClose(); item.run(); }}>{item.label}</button>
          ))}
      {mode === "root" && onAddCard ? <button className="is-more" onClick={() => setMode("add")}>新建卡片 ▸</button> : null}
    </div>
  );
}
