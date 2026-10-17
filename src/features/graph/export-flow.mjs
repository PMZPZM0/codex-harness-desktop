/**
 * export-flow.mjs —— 交互式流程图的**导出内核**（纯函数，唯一口径）。
 *
 * 支持的格式与适用场景（工具栏 tooltip 与这里同源，别在组件里另写一份）：
 *   · PNG   —— 分享 / 贴聊天 / 放进文档：2x 栅格化，**按当前节点位置**（拖过就用拖过的）
 *   · SVG   —— 矢量图，放大不失真、可在 Figma/Illustrator 再编辑
 *   · HTML  —— 单文件（内联样式），可直接打开、**浏览器打印成 PDF**
 *   · JSON  —— 规格本身，可再喂回流程图 / 交给模型改
 *
 * ⛔ 为什么自己拼 SVG：React Flow 的图是「HTML 节点 + SVG 连线」的混合 DOM，
 *    直接序列化拿不到一份可移植的矢量图 ⇒ 用**同一份布局结果**重建一份独立 SVG。
 */
const TONE = {
  blue: { bg: "#E6F1FB", bd: "#185FA5", tx: "#0C447C" },
  amber: { bg: "#FAEEDA", bd: "#BA7517", tx: "#854F0B" },
  green: { bg: "#EAF3DE", bd: "#3B6D11", tx: "#27500A" },
  red: { bg: "#FCEBEB", bd: "#A32D2D", tx: "#791F1F" },
  gray: { bg: "#F1EFE8", bd: "#5F5E5A", tx: "#444441" },
  teal: { bg: "#E1F5EE", bd: "#0F6E56", tx: "#085041" },
  purple: { bg: "#EEEDFE", bd: "#534AB7", tx: "#3C3489" },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 估算单行文本宽度（与 layoutFlowchart 同口径：中文 13px / 英文 7.4px）。 */
function textWidth(text) {
  let w = 0;
  for (const ch of String(text ?? "")) w += ch.charCodeAt(0) > 0x2e80 ? 13 : 7.4;
  return w;
}

/**
 * 生成独立 SVG（节点矩形 + 文本 + 带箭头连线）。
 * @param spec parseFlowchartSpec 的结果（含 nodes/edges/title）
 * @param layout layoutFlowchart 的结果，或 { nodes: [{id,x,y,w,h}] }
 */
export function buildFlowSvg(spec, layout) {
  const pos = new Map((layout?.nodes ?? []).map((n) => [n.id, n]));
  const width = Math.max(240, Math.round(layout?.width ?? 640));
  const height = Math.max(160, Math.round(layout?.height ?? 320));

  const defs = [
    '<defs><marker id="fa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '<path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>',
  ].join("");

  const edgeEls = [];
  for (const e of spec?.edges ?? []) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const t = e.tone ? (TONE[e.tone] ?? TONE.gray) : TONE.gray;
    // 简单肘形：出底 → 进顶（节点上下排布时最短）；左右排布时同样可用（斜线也接受）
    const x1 = a.x + a.w / 2, y1 = a.y + a.h;
    const x2 = b.x + b.w / 2, y2 = b.y;
    const midY = (y1 + y2) / 2;
    const d = Math.abs(x1 - x2) < 1
      ? `M${x1} ${y1} L${x2} ${y2}`
      : `M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2}`;
    const dash = e.dashed ? ' stroke-dasharray="5 4"' : "";
    edgeEls.push(`<path d="${d}" fill="none" stroke="${t.bd}" stroke-width="1.5"${dash} marker-end="url(#fa)"/>`);
    if (e.label) {
      const lx = Math.abs(x1 - x2) < 1 ? x1 + 8 : (x1 + x2) / 2;
      const ly = Math.abs(x1 - x2) < 1 ? midY : midY - 6;
      const lw = textWidth(e.label) + 10;
      edgeEls.push(
        `<rect x="${Math.round(lx - lw / 2)}" y="${Math.round(ly - 9)}" width="${Math.round(lw)}" height="16" rx="4" fill="#ffffff" fill-opacity="0.9"/>`,
        `<text x="${Math.round(lx)}" y="${Math.round(ly + 4)}" text-anchor="middle" font-family="'Microsoft YaHei','PingFang SC',sans-serif" font-size="11" fill="#5F5E5A">${esc(e.label)}</text>`,
      );
    }
  }

  const nodeEls = [];
  for (const n of spec?.nodes ?? []) {
    const p = pos.get(n.id);
    if (!p) continue;
    const t = TONE[n.tone] ?? TONE.blue;
    const rx = n.shape === "pill" ? Math.round(p.h / 2) : 12;
    const cx = p.x + p.w / 2;
    nodeEls.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${rx}" fill="${t.bg}" stroke="${t.bd}" stroke-width="1"/>`);
    if (n.note) {
      nodeEls.push(`<text x="${Math.round(cx)}" y="${p.y + p.h / 2 - 6}" text-anchor="middle" dominant-baseline="central" font-family="'Microsoft YaHei','PingFang SC',sans-serif" font-size="13" font-weight="600" fill="${t.tx}">${esc(n.label)}</text>`);
      nodeEls.push(`<text x="${Math.round(cx)}" y="${p.y + p.h / 2 + 12}" text-anchor="middle" dominant-baseline="central" font-family="'Microsoft YaHei','PingFang SC',sans-serif" font-size="11" fill="${t.bd}">${esc(n.note)}</text>`);
    } else {
      nodeEls.push(`<text x="${Math.round(cx)}" y="${p.y + p.h / 2}" text-anchor="middle" dominant-baseline="central" font-family="'Microsoft YaHei','PingFang SC',sans-serif" font-size="13" font-weight="600" fill="${t.tx}">${esc(n.label)}</text>`);
    }
  }

  const title = spec?.title
    ? `<text x="20" y="28" font-family="'Microsoft YaHei','PingFang SC',sans-serif" font-size="14" font-weight="600" fill="#444441">${esc(spec.title)}</text>`
    : "";

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    defs,
    title,
    ...edgeEls,
    ...nodeEls,
    `</svg>`,
    "",
  ].join("\n");
}

/** 单文件 HTML（内联 SVG，零外部依赖）—— 浏览器直接打开，Ctrl+P 可存 PDF。 */
export function buildFlowHtml(spec, svg) {
  const title = esc(spec?.title || "流程图");
  return [
    "<!DOCTYPE html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    "<style>html,body{margin:0;background:#fff;}main{padding:24px;}@media print{main{padding:0;}}</style>",
    "</head><body><main>",
    svg.replace(/^<\?xml[^>]*\?>\s*/, ""),
    "</main></body></html>",
    "",
  ].join("\n");
}

/** 规格 JSON（可再喂回流程图 / 交给模型改）：去掉渲染期字段，只留结构。 */
export function buildFlowJson(spec) {
  return JSON.stringify(
    {
      title: spec?.title || undefined,
      direction: spec?.direction || "TD",
      nodes: (spec?.nodes ?? []).map((n) => ({ id: n.id, label: n.label, ...(n.note ? { note: n.note } : {}), tone: n.tone, ...(n.shape !== "rect" ? { shape: n.shape } : {}) })),
      edges: (spec?.edges ?? []).map((e) => ({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}), ...(e.tone ? { tone: e.tone } : {}), ...(e.dashed ? { dashed: true } : {}) })),
    },
    null,
    2,
  );
}

/** 各格式的**适用场景**（工具栏菜单文案的唯一来源）。 */
export const FLOW_EXPORT_FORMATS = [
  { id: "png", label: "PNG 图片", hint: "分享 / 贴聊天 / 放进文档（2x，清晰不带锯齿）" },
  { id: "svg", label: "SVG 矢量图", hint: "放大不失真，可在 Figma / Illustrator 里再编辑" },
  { id: "html", label: "HTML 单文件", hint: "双击即看；浏览器 Ctrl+P 可存成 PDF（要打印/归档选这个）" },
  { id: "json", label: "JSON 规格", hint: "结构源文件：可再喂回流程图，或交给模型改图" },
];
