/**
 * archkit 渲染器：三型图 → 自包含可交互 HTML（内联 SVG + 内联样式 + 内联脚本）。
 *
 * ⛔ 确定性：函数体内禁用 Date.now / Math.random / 任何环境相关值——同输入必须逐字节同输出
 *   （deliver 回执的 sha256 才有意义；守卫【182】钉这条）。
 * ⛔ 自包含：不产生任何外链（字体/脚本/样式全内联，离线双击可开）；守卫【182】钉这条。
 * 交互手势：滚轮=光标锚点缩放；拖动=平移；Shift+滚轮=横向平移；悬停节点高亮关联边；
 *           点击节点弹出证据面板；主题切换；导出 PNG（canvas 重绘 svg）。
 *
 * 配色走 SVG 内嵌 <style>（而非页面 CSS）：导出 PNG 时序列化的是 svg 自身，样式必须随行。
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ESC[c]);

/** 标签截断：超长加省略号（完整文本进 <title> 悬停可见）。 */
function clip(s, max) {
  return String(s ?? "").length > max ? String(s).slice(0, max - 1) + "…" : String(s ?? "");
}

/* ══════════ 布局：分层（最长路径定列，同列按输入序排行） ══════════ */

function layeredLayout(nodes, edges) {
  const col = new Map(nodes.map((n) => [n.id, 0]));
  // 最长路径分层；环靠迭代上限兜底（架构图不该有环，有环也画得出来）
  for (let iter = 0; iter < nodes.length + 1; iter++) {
    let changed = false;
    for (const e of edges) {
      if (col.has(e.from) && col.has(e.to) && col.get(e.to) < col.get(e.from) + 1) {
        col.set(e.to, col.get(e.from) + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const cols = new Map();
  for (const n of nodes) {
    const c = col.get(n.id) ?? 0;
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c).push(n);
  }
  return { col, cols };
}

const CELL = { w: 216, h: 60, colGap: 316, rowGap: 98, margin: 52 };

function flowGeometry(diagram) {
  const { cols } = layeredLayout(diagram.nodes, diagram.edges);
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  const pos = new Map();
  let maxRows = 1;
  for (const [c, list] of cols) {
    const ci = colKeys.indexOf(c);
    list.forEach((n, row) => pos.set(n.id, { x: CELL.margin + ci * CELL.colGap, y: CELL.margin + row * CELL.rowGap }));
    if (list.length > maxRows) maxRows = list.length;
  }
  const w = CELL.margin * 2 + (colKeys.length - 1) * CELL.colGap + CELL.w;
  const h = CELL.margin * 2 + (maxRows - 1) * CELL.rowGap + CELL.h;
  return { pos, w: Math.max(w, 640), h: Math.max(h, 360) };
}

function edgePath(a, b, i) {
  const sx = a.x + CELL.w, sy = a.y + CELL.h / 2;
  const tx = b.x, ty = b.y + CELL.h / 2;
  if (tx >= sx + 36) {
    const mx = (sx + tx) / 2;
    return { d: `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`, lx: mx, ly: (sy + ty) / 2 - 8, forward: true };
  }
  // 回边/同列：从底下绕，按序号错开防重叠
  const drop = Math.max(a.y, b.y) + CELL.h + 30 + i * 14;
  const sxo = sx - 8, txo = tx + 8;
  return { d: `M ${sxo} ${sy} L ${sxo} ${drop} L ${txo} ${drop} L ${txo} ${ty}`, lx: (sxo + txo) / 2, ly: drop - 7, forward: false };
}

/* ══════════ SVG 生成 ══════════ */

const KIND_CLASS = {
  entry: "k-entry", module: "k-module", store: "k-store", infra: "k-infra", external: "k-external",
  start: "k-start", end: "k-end", step: "k-step", decision: "k-decision", actor: "k-actor",
  source: "k-source", process: "k-process", sink: "k-sink", state: "k-state",
};

function nodeSvg(n, p, kindLabels) {
  const label = clip(n.label, 22);
  const sub = kindLabels[n.kind] + (n.evidence.length ? ` · 证据×${n.evidence.length}` : "");
  const title = esc(n.label) + (n.evidence.length ? "\n证据：" + n.evidence.join("\n") : "");
  let shape;
  if (n.kind === "decision") {
    const cx = CELL.w / 2, cy = CELL.h / 2;
    shape = `<polygon class="card" points="${cx},4 ${CELL.w - 6},${cy} ${cx},${CELL.h - 4} 6,${cy}"/>`;
  } else if (n.kind === "start" || n.kind === "end") {
    shape = `<rect class="card" x="18" y="8" width="${CELL.w - 36}" height="${CELL.h - 16}" rx="${(CELL.h - 16) / 2}"/>`;
  } else {
    shape = `<rect class="card" x="0" y="0" width="${CELL.w}" height="${CELL.h}" rx="11"/>`;
  }
  return `<g class="node ${KIND_CLASS[n.kind]}" data-id="${esc(n.id)}" transform="translate(${p.x},${p.y})">
    <title>${title}</title>${shape}
    <text class="lbl" x="${CELL.w / 2}" y="${CELL.h / 2 - 3}" text-anchor="middle">${esc(label)}</text>
    <text class="sub" x="${CELL.w / 2}" y="${CELL.h / 2 + 16}" text-anchor="middle">${esc(sub)}</text>
  </g>`;
}

function flowSvg(diagram, kindLabels) {
  const { pos, w, h } = flowGeometry(diagram);
  const idx = new Map(diagram.edges.map((e, i) => [e, i]));
  const edgeSvgs = diagram.edges.map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return "";
    const g = edgePath(a, b, idx.get(e) % 6);
    const lbl = e.label ? `<text x="${g.lx}" y="${g.ly}" text-anchor="middle"><title>${esc(e.label)}</title>${esc(clip(e.label, 16))}</text>` : "";
    return `<g class="edge${e.style === "dashed" ? " dashed" : ""}" data-from="${esc(e.from)}" data-to="${esc(e.to)}">
      <path class="wire" marker-end="url(#arw)" d="${g.d}"/>${lbl}</g>`;
  }).join("\n");
  const nodeSvgs = diagram.nodes.map((n) => nodeSvg(n, pos.get(n.id), kindLabels)).join("\n");
  return { svg: `<svg data-archkit="1" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--edge)"/></marker></defs>
${edgeSvgs}
${nodeSvgs}
</svg>`, w, h };
}

function sequenceSvg(diagram, kindLabels) {
  const actors = diagram.nodes;
  const actGap = 216, boxW = 152, boxH = 46, margin = 56, msgGap = 58;
  const cx = new Map(actors.map((a, i) => [a.id, margin + boxW / 2 + i * actGap]));
  const w = margin * 2 + boxW + (actors.length - 1) * actGap;
  const bodyTop = margin + boxH + 18;
  const h = bodyTop + diagram.messages.length * msgGap + 56;
  const headers = actors.map((a, i) => {
    const x = margin + i * actGap;
    return `<g class="node ${KIND_CLASS[a.kind]}" data-id="${esc(a.id)}" transform="translate(${x},${margin})">
      <title>${esc(a.label)}${a.evidence.length ? "\n证据：" + a.evidence.join("\n") : ""}</title>
      <rect class="card" width="${boxW}" height="${boxH}" rx="9"/>
      <text class="lbl" x="${boxW / 2}" y="${boxH / 2 + 4}" text-anchor="middle">${esc(clip(a.label, 12))}</text>
      <text class="sub" x="${boxW / 2}" y="${boxH + 15}" text-anchor="middle">${esc(kindLabels[a.kind] + (a.evidence.length ? ` · 证据×${a.evidence.length}` : ""))}</text>
    </g>
    <line class="lifeline" x1="${x + boxW / 2}" y1="${margin + boxH}" x2="${x + boxW / 2}" y2="${h - 34}"/>`;
  }).join("\n");
  const msgs = diagram.messages.map((m, i) => {
    const y = bodyTop + 24 + i * msgGap;
    const x1 = cx.get(m.from), x2 = cx.get(m.to);
    const dashed = m.style === "dashed";
    if (x1 === x2) {
      return `<g class="edge${dashed ? " dashed" : ""}" data-from="${esc(m.from)}" data-to="${esc(m.to)}">
        <path class="wire" marker-end="url(#arw)" d="M ${x1} ${y} C ${x1 + 52} ${y - 30}, ${x1 + 52} ${y + 18}, ${x1 + 7} ${y + 7}"/>
        <text x="${x1 + 58}" y="${y + 2}">${esc(clip(m.text, 26))}</text></g>`;
    }
    const dir = x2 > x1 ? 1 : -1;
    return `<g class="edge${dashed ? " dashed" : ""}" data-from="${esc(m.from)}" data-to="${esc(m.to)}">
      <line class="wire" x1="${x1 + dir * 5}" y1="${y}" x2="${x2 - dir * 5}" y2="${y}" marker-end="url(#arw)"/>
      <text x="${(x1 + x2) / 2}" y="${y - 7}" text-anchor="middle">${esc(clip(m.text, 44))}</text></g>`;
  }).join("\n");
  return { svg: `<svg data-archkit="1" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--edge)"/></marker></defs>
${headers}
${msgs}
</svg>`, w, h };
}

/* ══════════ lifecycle：状态机圆环布局（确定性：按输入序均匀上圆） ══════════ */

function lifecycleSvg(diagram, kindLabels) {
  const states = diagram.nodes;
  const NW = 156, NH = 50;
  const radius = Math.max(150, Math.min(300, 110 + states.length * 26));
  const margin = 150;
  const w = (radius + margin) * 2, h = (radius + margin) * 2;
  const cx = w / 2, cy = h / 2;
  const pos = new Map(states.map((s, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(states.length, 1);
    return [s.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }];
  }));
  const headers = states.map((s) => {
    const p = pos.get(s.id);
    return `<g class="node ${KIND_CLASS[s.kind] || "k-state"}" data-id="${esc(s.id)}" transform="translate(${p.x - NW / 2},${p.y - NH / 2})">
      <title>${esc(s.label)}${s.evidence.length ? "\n证据：" + s.evidence.join("\n") : ""}</title>
      <rect class="card" width="${NW}" height="${NH}" rx="${NH / 2}"/>
      <text class="lbl" x="${NW / 2}" y="${NH / 2 + 4}" text-anchor="middle">${esc(clip(s.label, 14))}</text>
      <text class="sub" x="${NW / 2}" y="${NH + 16}" text-anchor="middle">${esc(kindLabels[s.kind] + (s.evidence.length ? ` · 证据×${s.evidence.length}` : ""))}</text>
    </g>`;
  }).join("\n");
  const transitions = diagram.edges.map((e, i) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return "";
    const dashed = e.style === "dashed";
    if (e.from === e.to) {
      const top = a.y - NH / 2 - 4;
      const d = `M ${a.x - 30} ${top} C ${a.x - 48} ${top - 46}, ${a.x + 48} ${top - 46}, ${a.x + 30} ${top}`;
      const label = e.label ? `<text x="${a.x}" y="${top - 50}" text-anchor="middle">${esc(clip(e.label, 20))}</text>` : "";
      return `<g class="edge${dashed ? " dashed" : ""}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><path class="wire" marker-end="url(#arw)" d="${d}"/>${label}</g>`;
    }
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = mx - cx, dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    const side = i % 2 === 0 ? 1 : -1; // 来回两条转移错开，别叠在一条弧上
    const ctrl = { x: mx + (dx / len) * 44 + (-dy / len) * 20 * side, y: my + (dy / len) * 44 + (dx / len) * 20 * side };
    const lx = 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x;
    const ly = 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y;
    const label = e.label ? `<text x="${lx}" y="${ly}" text-anchor="middle">${esc(clip(e.label, 20))}</text>` : "";
    return `<g class="edge${dashed ? " dashed" : ""}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><path class="wire" marker-end="url(#arw)" d="M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}"/>${label}</g>`;
  }).join("\n");
  return { svg: `<svg data-archkit="1" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--edge)"/></marker></defs>
${headers}
${transitions}
</svg>`, w, h };
}



/* ══════════ 内嵌进 SVG 的样式（导出 PNG 必须随行，所以不放页面 CSS） ══════════ */

const SVG_STYLE = `
svg { --edge:#8fa0b3; --bg:#f6f8fb; --text:#16202e; }
svg.dark { --edge:#5b6b80; --bg:#0c1118; --text:#dce4ee; }
text { fill:var(--text); font:12.5px ui-sans-serif,system-ui,"Microsoft YaHei","PingFang SC",sans-serif; }
text.lbl { font-weight:600; font-size:13px; }
text.sub { font-size:10.5px; opacity:.72; }
.edge text, text.msg { font-size:11.5px; paint-order:stroke; stroke:var(--bg); stroke-width:4px; }
.card { stroke-width:1.5; }
.k-entry   .card { fill:#dbeafe; stroke:#2563eb; }  svg.dark .k-entry   .card { fill:#172b4d; stroke:#60a5fa; }
.k-module  .card { fill:#e7edf4; stroke:#64748b; }  svg.dark .k-module  .card { fill:#1b2531; stroke:#8ba0b6; }
.k-store   .card { fill:#fef3c7; stroke:#d97706; }  svg.dark .k-store   .card { fill:#3d2f0d; stroke:#eab308; }
.k-infra   .card { fill:#ede9fe; stroke:#7c3aed; }  svg.dark .k-infra   .card { fill:#291d47; stroke:#a78bfa; }
.k-external .card { fill:#fee2e2; stroke:#dc2626; }  svg.dark .k-external .card { fill:#3f1717; stroke:#f87171; }
.k-start   .card { fill:#dcfce7; stroke:#16a34a; }  svg.dark .k-start   .card { fill:#123524; stroke:#4ade80; }
.k-end     .card { fill:#fee2e2; stroke:#dc2626; }  svg.dark .k-end     .card { fill:#3f1717; stroke:#f87171; }
.k-step    .card { fill:#e7edf4; stroke:#64748b; }  svg.dark .k-step    .card { fill:#1b2531; stroke:#8ba0b6; }
.k-decision.card { fill:#fef9c3; stroke:#ca8a04; }  svg.dark .k-decision.card { fill:#3a3210; stroke:#eab308; }
.k-actor   .card { fill:#e7edf4; stroke:#64748b; }  svg.dark .k-actor   .card { fill:#1b2531; stroke:#8ba0b6; }
.k-source  .card { fill:#dbeafe; stroke:#2563eb; }  svg.dark .k-source  .card { fill:#172b4d; stroke:#60a5fa; }
.k-process .card { fill:#e0f2fe; stroke:#0284c7; }  svg.dark .k-process .card { fill:#0c2a3f; stroke:#38bdf8; }
.k-sink    .card { fill:#ffe4e6; stroke:#e11d48; }  svg.dark .k-sink    .card { fill:#3f1220; stroke:#fb7185; }
.k-state   .card { fill:#d1fae5; stroke:#059669; }  svg.dark .k-state   .card { fill:#0c2f26; stroke:#34d399; }
g.node { cursor:pointer; }
g.node:hover .card { stroke-width:2.6; }
.edge path.wire, .edge line.wire { fill:none; stroke:var(--edge); stroke-width:1.6; }
.edge.dashed path.wire, .edge.dashed line.wire { stroke-dasharray:6 4; }
g.edge.hl path.wire, g.edge.hl line.wire { stroke:#2563eb; stroke-width:2.4; }
g.edge.hl text { fill:#2563eb; }
.lifeline { stroke:var(--edge); stroke-width:1.2; stroke-dasharray:4 5; opacity:.65; }
`;

/* ══════════ 页面外壳（chrome 样式放页面；交互脚本内联） ══════════ */

const PAGE_STYLE = `
:root { --bar:#ffffff; --fg:#16202e; --line:#dfe6ee; --panel:#ffffff; --dim:#5b6b80; }
html.dark { --bar:#10161f; --fg:#dce4ee; --line:#223041; --panel:#141c27; --dim:#8ba0b6; }
* { box-sizing:border-box; } html,body { height:100%; }
body { margin:0; font:13px ui-sans-serif,system-ui,"Microsoft YaHei","PingFang SC",sans-serif; background:var(--bar); color:var(--fg); }
.bar { position:fixed; inset:0 0 auto 0; height:46px; display:flex; align-items:center; gap:10px; padding:0 14px;
  background:var(--bar); border-bottom:1px solid var(--line); z-index:10; }
.bar strong { font-size:14px; } .bar .meta { color:var(--dim); font-size:12px; }
.bar .btns { margin-left:auto; display:flex; gap:8px; }
.bar button { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:7px; padding:4px 10px; cursor:pointer; font-size:12px; }
.bar button:hover { border-color:#2563eb; }
.viewport { position:absolute; inset:46px 0 0 0; overflow:hidden; cursor:grab; background:
  radial-gradient(circle, color-mix(in srgb, var(--dim) 26%, transparent) 1px, transparent 1px) 0 0/22px 22px; }
.viewport:active { cursor:grabbing; }
.world { position:absolute; top:0; left:0; transform-origin:0 0; }
.world > svg { background:transparent; display:block; }
.evidence { position:fixed; left:14px; bottom:44px; max-width:440px; background:var(--panel); border:1px solid var(--line);
  border-radius:10px; padding:10px 12px; box-shadow:0 8px 28px rgba(0,0,0,.16); z-index:11; font-size:12px; }
.evidence h4 { margin:0 0 6px; font-size:12.5px; } .evidence .ev { color:var(--dim); font-family:ui-monospace,Consolas,monospace; font-size:11.5px; margin-top:3px; word-break:break-all; }
.evidence .x { float:right; cursor:pointer; border:none; background:none; color:var(--dim); font-size:14px; }
.hint { position:fixed; right:14px; bottom:12px; color:var(--dim); font-size:11.5px; z-index:10; }
`;

const PAGE_SCRIPT = `
(function () {
  var vp = document.getElementById("vp"), world = document.getElementById("world"), svg = document.getElementById("root-svg");
  var vx = 0, vy = 0, vs = 1;
  function apply() { world.style.transform = "translate(" + vx + "px," + vy + "px) scale(" + vs + ")"; }
  function fit() {
    vs = Math.min((vp.clientWidth - 40) / svg.clientWidth, (vp.clientHeight - 40) / svg.clientHeight, 1.4);
    vs = Math.max(vs, 0.15);
    vx = (vp.clientWidth - svg.clientWidth * vs) / 2; vy = (vp.clientHeight - svg.clientHeight * vs) / 2; apply();
  }
  vp.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = vp.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    if (e.shiftKey && !e.ctrlKey) { vx -= (e.deltaY || e.deltaX); apply(); return; }
    var k = Math.exp(-e.deltaY * 0.0016), ns = Math.min(4, Math.max(0.15, vs * k));
    vx = cx - (cx - vx) * (ns / vs); vy = cy - (cy - vy) * (ns / vs); vs = ns; apply();
  }, { passive: false });
  var drag = null;
  vp.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, vx: vx, vy: vy, moved: false }; vp.setPointerCapture(e.pointerId); });
  vp.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    vx = drag.vx + dx; vy = drag.vy + dy; apply();
  });
  vp.addEventListener("pointerup", function () { setTimeout(function () { if (drag) { lastDrag = drag; } drag = null; }, 0); });
  var lastDrag = null;
  window.addEventListener("keydown", function (e) {
    if (e.key === "0") fit();
    if (e.key === "+" || e.key === "=") { vs = Math.min(4, vs * 1.2); apply(); }
    if (e.key === "-") { vs = Math.max(0.15, vs / 1.2); apply(); }
    if (e.key === "Escape") hideEv();
  });
  function showEv(id) {
    var g = document.querySelector('g.node[data-id="' + id.replace(/"/g, "") + '"]');
    if (!g) return;
    var title = (g.querySelector("title") || {}).textContent || id;
    var box = document.getElementById("evidence");
    var files = (title.split("\\n").slice(1) || []).join("\\n");
    box.innerHTML = '<button class="x" onclick="this.parentElement.hidden=true">✕</button><h4>' +
      g.querySelector(".lbl").textContent + '</h4><div class="ev">' +
      (files ? files.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\\n/g, "<br>") : "（无证据条目）") + "</div>";
    box.hidden = false;
  }
  function hideEv() { document.getElementById("evidence").hidden = true; }
  document.querySelectorAll("g.node").forEach(function (g) {
    g.addEventListener("mouseenter", function () {
      var id = g.dataset.id;
      document.querySelectorAll("g.edge").forEach(function (ed) {
        if (ed.dataset.from === id || ed.dataset.to === id) ed.classList.add("hl");
      });
    });
    g.addEventListener("mouseleave", function () {
      document.querySelectorAll("g.edge.hl").forEach(function (ed) { ed.classList.remove("hl"); });
    });
    g.addEventListener("click", function () { if (lastDrag && lastDrag.moved) return; showEv(g.dataset.id); });
  });
  document.getElementById("theme").addEventListener("click", function () {
    svg.classList.toggle("dark"); document.documentElement.classList.toggle("dark");
  });
  document.getElementById("fit").addEventListener("click", fit);
  document.getElementById("png").addEventListener("click", function () {
    var s = new XMLSerializer().serializeToString(svg);
    var blob = new Blob([s], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(blob), img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = svg.clientWidth * 2; c.height = svg.clientHeight * 2;
      var ctx = c.getContext("2d"); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      var a = document.createElement("a"); a.download = (svg.dataset.title || "archkit") + ".png";
      a.href = c.toDataURL("image/png"); a.click();
    };
    img.src = url;
  });
  fit();
})();
`;

/**
 * 渲染为自包含 HTML。⛔ 确定性：不得引入时间/随机值。
 * @param diagram 已归一的图（archkitNormalizeDiagram().diagram）
 * @param options.delta 可选，archkitDelta() 的结果 —— 渲染一张「差异摘要」面板（新图 + 增删改清单）
 */
export function archkitRender(diagram, options = {}) {
  const kindLabels = {
    entry: "入口", module: "模块", store: "存储", infra: "基础设施", external: "外部",
    start: "开始", end: "结束", step: "步骤", decision: "判断", actor: "参与者",
    source: "数据源", process: "处理", sink: "出口", state: "状态",
  };
  const built = diagram.type === "sequence" ? sequenceSvg(diagram, kindLabels)
    : diagram.type === "lifecycle" ? lifecycleSvg(diagram, kindLabels)
    : flowSvg(diagram, kindLabels);
  const withStyle = built.svg.replace("<defs>", "<style>" + SVG_STYLE + "</style><defs>");
  const evCount = diagram.nodes.reduce((a, n) => a + n.evidence.length, 0);
  const delta = options.delta || null;
  const deltaMeta = delta ? ` · Δ +${delta.added.length}/−${delta.removed.length}/~${delta.changed.length}` : "";
  const deltaPanel = delta ? `
<aside class="delta-panel" id="delta-panel">
  <b>与上一版相比（Δ）</b>
  <div class="delta-row is-added">＋ 新增 ${delta.added.length}：${esc(clip(delta.added.join("、"), 80)) || "—"}</div>
  <div class="delta-row is-removed">－ 移除 ${delta.removed.length}：${esc(clip(delta.removed.join("、"), 80)) || "—"}</div>
  <div class="delta-row is-changed">～ 修改 ${delta.changed.length}：${esc(clip(delta.changed.join("、"), 80)) || "—"}</div>
  <div class="delta-row">连线：＋${delta.addedEdges.length} / −${delta.removedEdges.length}${diagram.type === "sequence" ? ` · 消息：＋${delta.addedMessages.length} / −${delta.removedMessages.length}` : ""}</div>
</aside>` : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(diagram.title)} · archkit</title>
<style>${PAGE_STYLE}${delta ? DELTA_STYLE : ""}</style></head>
<body>
<header class="bar"><strong>${esc(diagram.title)}</strong>
  <span class="meta">${esc(diagram.type)} · ${diagram.nodes.length} 卡 / ${diagram.type === "sequence" ? diagram.messages.length + " 消息" : diagram.edges.length + " 线"} · 证据 ${evCount} 条 · archkit${deltaMeta}</span>
  <span class="btns"><button id="theme">深浅主题</button><button id="fit">适配</button><button id="png">导出 PNG</button></span>
</header>
${deltaPanel}
<div class="viewport" id="vp"><div class="world" id="world">${withStyle.replace("<svg ", '<svg id="root-svg" data-title="' + esc(diagram.title) + '" ')}</div></div>
<aside id="evidence" class="evidence" hidden></aside>
<div class="hint">滚轮缩放 · 拖动平移 · Shift+滚轮横移 · 悬停高亮关联 · 点击卡片看证据 · 0 适配</div>
<script>${PAGE_SCRIPT}</script>
</body></html>`;
}

/** delta 摘要面板样式（只在 delta 渲染时拼接进页面，保持普通渲染的输出不变）。 */
const DELTA_STYLE = `
.delta-panel { position: fixed; left: 14px; top: 58px; z-index: 9; max-width: 340px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; font-size: 12px; display: grid; gap: 4px; }
.delta-panel b { font-size: 12.5px; margin-bottom: 2px; }
.delta-row { line-height: 1.55; word-break: break-all; }
.delta-row.is-added { color: #16a34a; } html.dark .delta-row.is-added { color: #4ade80; }
.delta-row.is-removed { color: #dc2626; } html.dark .delta-row.is-removed { color: #f87171; }
.delta-row.is-changed { color: #d97706; } html.dark .delta-row.is-changed { color: #fbbf24; }
`;
