/**
 * Mermaid 图表渲染器 —— 用官方 mermaid 引擎渲染 ```mermaid 代码块。
 * 支持全部图表类型：flowchart / sequenceDiagram / gantt / classDiagram /
 * stateDiagram / pie / timeline / mindmap / erDiagram 等。
 * 样式：跟随应用深浅主题；初始化主题 dark/neutral。
 * 懒加载：mermaid 引擎按需动态 import，仅当真有 mermaid 代码块时才加载。
 *
 * 10-17 用户令（对话内可视化流程图组件）：在既有渲染之上补三件事 ——
 *   ① **交互**：滚轮/按钮缩放（0.25–4x）+ 按住拖拽平移；
 *   ② **导出**：一键下载 SVG（序列化）与 PNG（2x 栅格化，带页面底色）；
 *   ③ 工具条浮在图右上角（渲染成功才出现，不挡 loading/error）。
 * ⛔ 导出用的是**渲染后的 svg 节点**序列化 —— mermaid 会把样式内联进 svg，离线可开。
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon, Minus, Plus, RotateCcw } from "lucide-react";

let mermaidPromise: Promise<any> | null = null;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then((m: any) => {
    const mm = m.default ?? m;
    mm.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
      fontFamily: "inherit",
    });
    return mm;
  });
  return mermaidPromise;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

export const MermaidDiagram = memo(function MermaidDiagram({ code }: { code: string }) {
  const boxRef = useRef<HTMLDivElement>(null);   // 滚动/拖拽容器
  const ref = useRef<HTMLDivElement>(null);      // svg 注入点（transform 作用其上）
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  /* ⛔ 10-17：流式中间态不报错（与流程图同口径）——半截代码渲染失败不代表最终代码有问题。 */
  const [settledError, setSettledError] = useState("");
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setZoom(1); zoomRef.current = 1;
    loadMermaid()
      .then(async (mm: any) => {
        if (cancelled) return;
        const el = ref.current;
        if (!el) return;
        // 生成唯一 id，避免 mermaid 全局 id 冲突（同一页多个图）
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        try {
          const { svg } = await mm.render(id, code);
          if (cancelled) return;
          el.innerHTML = svg;
          el.style.transform = "scale(1)";
          setState("ok");
        } catch (e: any) {
          if (cancelled) return;
          setError(e?.message ?? String(e));
          setState("error");
        }
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError("加载 mermaid 引擎失败: " + (e?.message ?? e));
        setState("error");
      });
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (!error) { setSettledError(""); return; }
    const timer = window.setTimeout(() => setSettledError(error), 900);
    return () => window.clearTimeout(timer);
  }, [code, error]);

  const applyZoom = useCallback((next: number) => {
    const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next.toFixed(2))));
    zoomRef.current = v;
    setZoom(v);
    if (ref.current) ref.current.style.transform = `scale(${v})`;
  }, []);

  /* 拖拽平移：按住图拖动 = 移动滚动位置（缩放后大图浏览的基本操作） */
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box || e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sl: box.scrollLeft, st: box.scrollTop };
    try { box.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const box = boxRef.current;
    if (!d || !box) return;
    box.scrollLeft = d.sl - (e.clientX - d.x);
    box.scrollTop = d.st - (e.clientY - d.y);
  };
  const endDrag = () => { dragRef.current = null; };

  /* 导出：取**渲染后的 svg** 序列化（mermaid 已内联样式 ⇒ 导出文件离线可开） */
  const serializeSvg = useCallback(() => {
    const svg = ref.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      clone.setAttribute("width", String(Math.round(vb[2])));
      clone.setAttribute("height", String(Math.round(vb[3])));
    }
    clone.style.maxWidth = "none";
    clone.style.transform = "";
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }, []);

  const download = useCallback((blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, []);

  const exportSvg = useCallback(() => {
    const s = serializeSvg();
    if (s) download(new Blob([s], { type: "image/svg+xml;charset=utf-8" }), `flowchart-${Date.now()}.svg`);
  }, [download, serializeSvg]);

  const exportPng = useCallback(() => {
    const s = serializeSvg();
    if (!s) return;
    const img = new Image();
    img.onload = () => {
      const scale = 2; // 2x 栅格化：投影/缩放不糊
      const w = Math.max(1, Math.round((img.width || 800) * scale));
      const h = Math.max(1, Math.round((img.height || 600) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => { if (blob) download(blob, `flowchart-${Date.now()}.png`); }, "image/png");
    };
    img.onerror = () => { setError("PNG 导出失败：SVG 位图化出错"); setState((s) => (s === "ok" ? "error" : s)); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
  }, [download, serializeSvg]);

  return (
    <div className="mermaid-diagram" data-state={state}>
      {state === "ok" && (
        <div className="mermaid-toolbar">
          <button type="button" title="缩小" onClick={() => applyZoom(zoomRef.current / 1.2)}><Minus size={13} /></button>
          <button type="button" title="重置缩放" onClick={() => applyZoom(1)}><RotateCcw size={13} /></button>
          <button type="button" title="放大" onClick={() => applyZoom(zoomRef.current * 1.2)}><Plus size={13} /></button>
          <i className="mermaid-toolbar-sep" aria-hidden />
          <button type="button" title="导出 SVG 文件" onClick={exportSvg}><Download size={13} />SVG</button>
          <button type="button" title="导出 PNG 图片（2x）" onClick={exportPng}><ImageIcon size={13} />PNG</button>
        </div>
      )}
      {state === "loading" && <div className="mermaid-loading">⏳ 渲染流程图…</div>}
      {state === "error" && (
        (settledError ? (
          <div className="mermaid-error">
            <div>⚠️ Mermaid 渲染失败：{settledError}</div>
            <pre className="mermaid-source">{code}</pre>
          </div>
        ) : <div className="mermaid-loading">⏳ 渲染流程图…</div>)
      )}
      <div
        ref={boxRef}
        className="mermaid-scroll"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); applyZoom(zoomRef.current * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); } }}
        style={{ display: state === "ok" ? "block" : "none" }}
      >
        <div ref={ref} style={{ transformOrigin: "0 0" }} />
      </div>
    </div>
  );
});
