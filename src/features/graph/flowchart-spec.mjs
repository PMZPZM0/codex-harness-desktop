/**
 * flowchart-spec.mjs —— 对话内交互流程图的**数据层 + 布局层**（纯函数，唯一口径）。
 *
 * 为什么不用 dagre/elk：流程图是 DAG，分层布局（最长路径分层 + 重心排序）自实现约 60 行，
 * 确定性好、零新依赖、和 React Flow 的坐标系直接对齐。复杂约束图再换 ELK（同一份 spec）。
 *
 * ⛔ 模型只产**结构**（nodes/edges），⛔ 不产坐标 —— 坐标由 layoutFlowchart 实时算，
 *    这样增删节点能立刻重排，而不是"预先画死的一张图"。
 */
export const FLOW_LIMIT = 200; // 超过这个节点数走 Canvas 引擎（Cytoscape），本渲染器不接

const TONES = ["blue", "amber", "green", "red", "gray", "teal", "purple"];

/** 去掉围栏/首尾空白后解析 JSON；失败返回 { error }。 */
export function parseFlowchartSpec(raw) {
  const text = String(raw ?? "")
    .replace(/^\s*```[a-zA-Z]*\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  if (!text) return { error: "空内容" };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: `JSON 解析失败：${e?.message ?? e}` };
  }
  const nodesIn = Array.isArray(data?.nodes) ? data.nodes : [];
  const edgesIn = Array.isArray(data?.edges) ? data.edges : [];
  if (!nodesIn.length) return { error: "nodes 为空" };
  if (nodesIn.length > FLOW_LIMIT) return { error: `节点过多（${nodesIn.length} > ${FLOW_LIMIT}）` };

  const seen = new Set();
  const nodes = [];
  for (const n of nodesIn) {
    const id = String(n?.id ?? "").trim();
    if (!id || seen.has(id)) continue; // ⛔ 重名节点会让连线错位，直接丢弃
    seen.add(id);
    nodes.push({
      id,
      label: String(n?.label ?? id),
      note: n?.note != null ? String(n.note) : "",
      tone: TONES.includes(String(n?.tone)) ? String(n.tone) : "blue",
      shape: n?.shape === "diamond" ? "diamond" : n?.shape === "pill" ? "pill" : "rect",
    });
  }
  const edges = [];
  for (const e of edgesIn) {
    const from = String(e?.from ?? "");
    const to = String(e?.to ?? "");
    if (!seen.has(from) || !seen.has(to) || from === to) continue; // 端点缺失/自环直接丢
    edges.push({
      from,
      to,
      label: e?.label != null ? String(e.label) : "",
      tone: TONES.includes(String(e?.tone)) ? String(e.tone) : "",
      dashed: Boolean(e?.dashed),
    });
  }
  const direction = data?.direction === "LR" ? "LR" : "TD";
  return { title: data?.title != null ? String(data.title) : "", direction, nodes, edges };
}

/** 节点尺寸：按最长行估宽（中文按 1 个全角 ≈ 13px，英文 ≈ 7.4px），有下限。 */
export function measureNode(node) {
  const lines = [node.label, node.note].filter(Boolean);
  const width = (line) => {
    let w = 0;
    for (const ch of String(line)) w += ch.charCodeAt(0) > 0x2e80 ? 13 : 7.4;
    return w;
  };
  const maxLine = Math.max(...lines.map(width), 40);
  const w = Math.max(132, Math.min(280, Math.round(maxLine + 36)));
  const h = lines.length > 1 ? 64 : 46;
  return { w, h };
}

/**
 * 分层布局（DAG）：
 *  1) 分层 = 从入度 0 出发的最长路径层号；有环时回边在分层阶段被忽略（渲染时照画 → 表现为回环线）；
 *  2) 层内顺序 = 相邻层重心（barycenter）排序各扫两遍，减少交叉；
 *  3) 坐标 = 主方向（TD 的 y / LR 的 x）按层累进；次方向按层内尺寸总和居中排布。
 * @returns {{ nodes: Array<{id,x,y,w,h}>, width: number, height: number }}
 */
export function layoutFlowchart(spec) {
  const { nodes, edges, direction } = spec;
  const sizes = new Map(nodes.map((n) => [n.id, measureNode(n)]));
  const isLR = direction === "LR";

  /* ① 最长路径分层 */
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const want = (layer.get(e.from) ?? 0) + 1;
      if (want > (layer.get(e.to) ?? 0) && want <= nodes.length) {
        layer.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  /* ② 分桶 + 层内重心排序 */
  const layers = [];
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    (layers[l] ||= []).push(n.id);
  }
  const order = new Map();
  const reseq = () => layers.forEach((ids) => ids && ids.forEach((id, i) => order.set(id, i)));
  reseq();
  for (let sweep = 0; sweep < 2; sweep++) {
    layers.forEach((ids) => {
      if (!ids || ids.length < 2) return;
      const score = (id) => {
        const ps = edges.filter((e) => e.to === id).map((e) => order.get(e.from) ?? 0);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : (order.get(id) ?? 0);
      };
      ids.sort((a, b) => score(a) - score(b));
    });
    reseq();
  }

  /* ③ 坐标：主方向累进，次方向居中 */
  const CROSS_GAP = 30;
  const MAIN_GAP = 72;
  const sizeMain = (id) => (isLR ? sizes.get(id).w : sizes.get(id).h);
  const sizeCross = (id) => (isLR ? sizes.get(id).h : sizes.get(id).w);

  const thickness = layers.map((ids) => {
    if (!ids || !ids.length) return 0;
    return ids.reduce((a, id, i) => a + sizeCross(id) + (i ? CROSS_GAP : 0), 0);
  });
  const maxCross = Math.max(0, ...thickness);

  const mainPos = [];
  let acc = 30;
  for (let l = 0; l < layers.length; l++) {
    const depth = layers[l]?.length ? Math.max(...layers[l].map(sizeMain)) : 0;
    mainPos[l] = acc;
    acc += depth + MAIN_GAP;
  }

  const out = [];
  layers.forEach((ids, l) => {
    if (!ids) return;
    let cursor = (maxCross - thickness[l]) / 2; // 居中
    for (const id of ids) {
      const s = sizes.get(id);
      out.push(isLR
        ? { id, x: mainPos[l], y: Math.round(cursor) }
        : { id, x: Math.round(cursor), y: mainPos[l] });
      cursor += sizeCross(id) + CROSS_GAP;
    }
  });

  const width = Math.max(...out.map((p) => p.x + sizes.get(p.id).w)) + 30;
  const height = Math.max(...out.map((p) => p.y + sizes.get(p.id).h)) + 30;
  return { nodes: out.map((p) => ({ ...p, w: sizes.get(p.id).w, h: sizes.get(p.id).h })), width, height };
}
