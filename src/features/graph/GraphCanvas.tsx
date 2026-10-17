/**
 * GraphCanvas —— 对话内**交互式流程图**（真实图形对象，非预绘制图片）。
 *
 * 渲染栈：React Flow（@xyflow/react，MIT —— 项目 AI 画布已在用）+ 自实现分层布局。
 *   · 节点 = 真实 DOM 元素（可拖拽、可选中、可 hover），不是一张位图；
 *   · 布局 = 每次 spec 变化**实时计算**（flowchart-spec.layoutFlowchart），支持 TD / LR 切换；
 *   · 连线 = 带箭头 + 语义配色（tone），条件分支可虚线；
 *   · 缩放/平移 = 画布变换（滚轮缩放、拖空白平移、一键适应）。
 * ⛔ 数据来自 ```flowchart 围栏的 JSON（模型只产结构不产坐标）。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid, ArrowDownUp, ArrowRight, Camera, Download } from "lucide-react";
import { layoutFlowchart, parseFlowchartSpec } from "./flowchart-spec.mjs";
import { buildFlowHtml, buildFlowJson, buildFlowSvg, FLOW_EXPORT_FORMATS } from "./export-flow.mjs";

const TONE: Record<string, { bg: string; bd: string; tx: string }> = {
  blue: { bg: "#E6F1FB", bd: "#185FA5", tx: "#0C447C" },
  amber: { bg: "#FAEEDA", bd: "#BA7517", tx: "#854F0B" },
  green: { bg: "#EAF3DE", bd: "#3B6D11", tx: "#27500A" },
  red: { bg: "#FCEBEB", bd: "#A32D2D", tx: "#791F1F" },
  gray: { bg: "#F1EFE8", bd: "#5F5E5A", tx: "#444441" },
  teal: { bg: "#E1F5EE", bd: "#0F6E56", tx: "#085041" },
  purple: { bg: "#EEEDFE", bd: "#534AB7", tx: "#3C3489" },
};

type FlowNodeData = { label: string; note: string; tone: string; shape: string; toneBd: string; toneTx: string; w: number; h: number };

const FlowNode = memo(function FlowNode({ data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const t = TONE[d.tone] ?? TONE.blue;
  return (
    <div
      className="flow-node"
      style={{
        width: d.w,
        height: d.h,
        background: t.bg,
        borderColor: t.bd,
        borderRadius: d.shape === "pill" ? 999 : 12,
      }}
      title={d.note || d.label}
    >
      <Handle type="target" position={Position.Top} className="flow-handle" />
      <Handle type="source" position={Position.Bottom} className="flow-handle" />
      <div className="flow-node-label" style={{ color: t.tx }}>{d.label}</div>
      {d.note ? <div className="flow-node-note" style={{ color: t.bd }}>{d.note}</div> : null}
    </div>
  );
});

const nodeTypes = { flow: FlowNode };

export const GraphCanvas = memo(function GraphCanvas({ code }: { code: string }) {
  const spec = useMemo(() => parseFlowchartSpec(code), [code]);
  /* ⛔ 流式中间态（10-17 用户截图）：模型还在写围栏时 JSON 是半截，解析必失败。
     这里把「失败」延后 900ms 确认：期间继续变化 = 还在生成 ⇒ 只显示「正在生成」；
     停止变化后仍失败才是真的坏。 */
  const [settledError, setSettledError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"TD" | "LR">(() => (("error" in spec ? "TD" : spec.direction) === "LR" ? "LR" : "TD"));
  const instRef = useRef<ReactFlowInstance | null>(null);

  const built = useMemo(() => {
    if ("error" in spec) return null;
    const laid = layoutFlowchart({ ...spec, direction });
    const pos = new Map(laid.nodes.map((n) => [n.id, n]));
    const nodes: Node[] = spec.nodes.map((n) => {
      const p = pos.get(n.id)!;
      return {
        id: n.id,
        type: "flow",
        position: { x: p.x, y: p.y },
        data: { label: n.label, note: n.note, tone: n.tone, shape: n.shape, toneBd: TONE[n.tone].bd, toneTx: TONE[n.tone].tx, w: p.w, h: p.h },
        draggable: true,
        style: { width: p.w, height: p.h, padding: 0, background: "transparent", border: "none" },
      };
    });
    const edges: Edge[] = spec.edges.map((e, i) => {
      const color = e.tone ? TONE[e.tone].bd : "#5F5E5A";
      return {
        id: `e-${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        label: e.label || undefined,
        labelStyle: { fontSize: 11, fill: "#5F5E5A" },
        labelBgStyle: { fill: "var(--bg, #fff)", fillOpacity: 0.9 },
        style: { stroke: color, strokeWidth: 1.5, strokeDasharray: e.dashed ? "5 4" : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      };
    });
    return { nodes, edges, width: laid.width, height: laid.height };
  }, [spec, direction]);

  useEffect(() => {
    if (!("error" in spec)) { setSettledError(null); return; }
    const timer = window.setTimeout(() => setSettledError(spec.error), 900);
    return () => window.clearTimeout(timer);
  }, [code, spec]);

  /* ── 截图 / 导出（10-17 用户令：右上角两项）──────────────────────────
     截图 = 一键 PNG（当前节点位置整体出图，不受缩放视口裁剪）；
     导出 = 菜单选格式（PNG / SVG / HTML / JSON，各带适用场景提示）。 */
  const [exportOpen, setExportOpen] = useState(false);
  /** 取当前画布上的真实节点位置（用户拖过就用拖过的），拼成布局结果供导出复用。 */
  const currentLayout = useCallback(() => {
    const rfNodes = (instRef.current?.getNodes?.() ?? []) as Array<{ id: string; position: { x: number; y: number }; width?: number; height?: number }>;
    if (!rfNodes.length) return { nodes: [], width: 640, height: 320 };
    const nodes = rfNodes.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), w: Math.round(n.width ?? 160), h: Math.round(n.height ?? 46) }));
    const width = Math.max(...nodes.map((n) => n.x + n.w)) + 40;
    const height = Math.max(...nodes.map((n) => n.y + n.h)) + 40;
    return { nodes, width, height };
  }, []);
  const flowSlug = useCallback(() => {
    const base = ("error" in spec ? "" : spec.title) || "flowchart";
    return String(base).replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "flowchart";
  }, [spec]);
  const download = useCallback((blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, []);
  const svgToPng = useCallback((svg: string, name: string) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const w = Math.max(1, Math.round((img.width || 800) * scale));
      const h = Math.max(1, Math.round((img.height || 600) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => { if (blob) download(blob, name); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }, [download]);
  const exportAs = useCallback((format: string) => {
    if ("error" in spec) return;
    const layout = currentLayout();
    const svg = buildFlowSvg(spec, layout);
    const slug = flowSlug();
    if (format === "png") return svgToPng(svg, `${slug}.png`);
    if (format === "svg") return download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${slug}.svg`);
    if (format === "html") return download(new Blob([buildFlowHtml(spec, svg)], { type: "text/html;charset=utf-8" }), `${slug}.html`);
    return download(new Blob([buildFlowJson(spec)], { type: "application/json;charset=utf-8" }), `${slug}.json`);
  }, [currentLayout, download, flowSlug, spec, svgToPng]);

  const fit = useCallback(() => { void instRef.current?.fitView({ padding: 0.15, duration: 240 }); }, []);
  useEffect(() => { const t = window.setTimeout(fit, 60); return () => window.clearTimeout(t); }, [built, fit]);

  if ("error" in spec) {
    /* 还在生成（错误尚未确认）⇒ 中性占位，⛔ 不亮红框 —— 半截 JSON 报错会让人以为坏了 */
    if (!settledError) return <div className="flow-loading">正在生成流程图…</div>;
    return (
      <div className="flow-error">
        <div>⚠️ 流程图规格无效：{settledError}</div>
        <pre>{code}</pre>
      </div>
    );
  }
  if (!built) return null;

  return (
    <div className="flow-canvas" data-direction={direction}>
      <div className="flow-toolbar">
        <button type="button" title={direction === "TD" ? "切换为横向布局" : "切换为纵向布局"} onClick={() => setDirection((d) => (d === "TD" ? "LR" : "TD"))}>
          {direction === "TD" ? <ArrowDownUp size={13} /> : <ArrowRight size={13} />}
          {direction === "TD" ? "纵向" : "横向"}
        </button>
        <button type="button" title="适应画布" onClick={fit}><LayoutGrid size={13} />适应</button>
        <span className="flow-toolbar-spacer" />
        {/* 右上角两项：截图（一键 PNG）/ 导出（多格式菜单） */}
        <button type="button" title="截图：把整张流程图存成 PNG（当前节点位置，2x 清晰）" onClick={() => exportAs("png")}><Camera size={13} />截图</button>
        <div className="flow-export-wrap">
          <button type="button" className={exportOpen ? "active-tool" : ""} title="导出：PNG / SVG / HTML / JSON" onClick={() => setExportOpen((v) => !v)}><Download size={13} />导出</button>
          {exportOpen && (
            <>
              <div className="flow-export-backdrop" onClick={() => setExportOpen(false)} />
              <div className="flow-export-menu" role="menu">
                {FLOW_EXPORT_FORMATS.map((f) => (
                  <button key={f.id} role="menuitem" title={f.hint} onClick={() => { setExportOpen(false); exportAs(f.id); }}>
                    <b>{f.label}</b><small>{f.hint}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {spec.title ? <span className="flow-title">{spec.title}</span> : null}
      </div>
      <div className="flow-stage" style={{ height: Math.min(520, Math.max(240, built.height + 24)) }}>
        <ReactFlow
          nodes={built.nodes}
          edges={built.edges}
          nodeTypes={nodeTypes}
          onInit={(inst) => { instRef.current = inst; }}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={3}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnDoubleClick={false}
        >
          <Background gap={18} size={1} color="#D3D1C7" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
});

export default GraphCanvas;
