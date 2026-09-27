/**
 * archkit —— 架构/流程/时序图的输入规格与校验归一（纯函数，无副作用，可被守卫真跑）。
 *
 * 方法论逆向自对 archify（MIT）行为的观察：typed JSON-IR → 严格校验 → 确定性渲染。
 * ⛔ 净室重实现：不复制上游任何代码、文案或素材；schema 与消息文案均为本仓自写。
 *
 * 设计取舍（与上游一致的三条铁律）：
 *  ① 校验 fail-closed——连线端点不存在、id 重复这类错误**整份拒收**，不做静默修复
 *     （证据图错一根线就是错图，宁可让作者改输入）；
 *  ② 节点必须带 evidence（锚到真实文件/目录）——渲染层把证据画进卡片与点击面板，
 *     "图上的每个框都能回答：你凭什么存在"；
 *  ③ 渲染确定性——同输入必须逐字节同输出（deliver 回执里的 sha256 才有意义）。
 */

export const ARCHKIT_TYPES = ["architecture", "workflow", "sequence"];

const ARCH_KINDS = new Set(["entry", "module", "store", "infra", "external"]);
const FLOW_KINDS = new Set(["start", "end", "step", "decision"]);
const EDGE_STYLES = new Set(["solid", "dashed"]);

/** 各图型允许的节点 kind（渲染层按 kind 定形状/配色）。 */
export const ARCHKIT_KINDS = {
  architecture: ARCH_KINDS,
  workflow: FLOW_KINDS,
  sequence: new Set(["actor"]),
};

export const ARCHKIT_KIND_LABELS = {
  entry: "入口", module: "模块", store: "存储", infra: "基础设施", external: "外部",
  start: "开始", end: "结束", step: "步骤", decision: "判断", actor: "参与者",
};

function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 校验并归一一份图输入。
 * @returns {{ ok: boolean, problems: {level:"error"|"warn",message:string}[],
 *             diagram: null | { type:string, title:string, nodes:Array, edges:Array, messages:Array } }}
 */
export function archkitNormalizeDiagram(input) {
  const problems = [];
  const type = asString(input?.type);
  if (!ARCHKIT_TYPES.includes(type)) {
    return {
      ok: false,
      problems: [{ level: "error", message: `type 必须是 ${ARCHKIT_TYPES.join("/")} 之一，得到「${type || "(空)"}」` }],
      diagram: null,
    };
  }

  const validKinds = ARCHKIT_KINDS[type];
  const nodes = [];
  const seen = new Set();
  for (const raw of Array.isArray(input?.nodes) ? input.nodes : []) {
    const id = asString(raw?.id);
    if (!id) { problems.push({ level: "error", message: "有节点缺 id" }); continue; }
    if (seen.has(id)) { problems.push({ level: "error", message: `节点 id 重复：${id}` }); continue; }
    seen.add(id);
    const kind = asString(raw?.kind) || (type === "sequence" ? "actor" : type === "workflow" ? "step" : "module");
    if (!validKinds.has(kind)) {
      problems.push({ level: "error", message: `节点 ${id} 的 kind「${kind}」不属于 ${type}（允许：${[...validKinds].join("/")}）` });
      continue;
    }
    const evidence = (Array.isArray(raw?.evidence) ? raw.evidence : []).map(asString).filter(Boolean);
    nodes.push({ id, kind, label: asString(raw?.label) || id, note: asString(raw?.note), evidence });
  }

  const edges = [];
  const edgeSeen = new Set();
  for (const raw of Array.isArray(input?.edges) ? input.edges : []) {
    const from = asString(raw?.from);
    const to = asString(raw?.to);
    if (!from || !to) { problems.push({ level: "error", message: "有连线缺 from/to" }); continue; }
    if (!seen.has(from) || !seen.has(to)) {
      problems.push({ level: "error", message: `连线 ${from}→${to} 的端点不存在（⛔ 不做静默修复，请先补节点或删线）` });
      continue;
    }
    const key = from + "→" + to;
    if (edgeSeen.has(key)) { problems.push({ level: "warn", message: `重复连线 ${key}（第二条已忽略）` }); continue; }
    edgeSeen.add(key);
    edges.push({ from, to, label: asString(raw?.label), style: EDGE_STYLES.has(raw?.style) ? raw.style : "solid" });
  }

  const messages = [];
  if (type === "sequence") {
    for (const raw of Array.isArray(input?.messages) ? input.messages : []) {
      const from = asString(raw?.from);
      const to = asString(raw?.to);
      const text = asString(raw?.text);
      if (!from || !to || !text) { problems.push({ level: "error", message: "有消息缺 from/to/text" }); continue; }
      if (!seen.has(from) || !seen.has(to)) {
        problems.push({ level: "error", message: `消息 ${from}→${to} 的参与者不存在` });
        continue;
      }
      messages.push({ from, to, text, style: EDGE_STYLES.has(raw?.style) ? raw.style : "solid" });
    }
  } else if (Array.isArray(input?.messages) && input.messages.length) {
    problems.push({ level: "warn", message: `${type} 图不消费 messages 字段（已忽略 ${input.messages.length} 条）` });
  }

  const errors = problems.filter((p) => p.level === "error");
  return {
    ok: errors.length === 0,
    problems,
    diagram: errors.length ? null : { type, title: asString(input?.title) || "Untitled", nodes, edges, messages },
  };
}

/** 证据索引：nodeId → 文件清单（渲染面板与 CLI 回执共用一份口径）。 */
export function archkitEvidenceIndex(diagram) {
  const map = new Map();
  for (const n of diagram?.nodes || []) if (n.evidence.length) map.set(n.id, n.evidence);
  return map;
}

/** 缺证据的节点 id（上游理念：图上的框要能回答"你凭什么存在"；入口/外部节点允许豁免）。 */
export function archkitNodesWithoutEvidence(diagram) {
  return (diagram?.nodes || []).filter((n) => !n.evidence.length && n.kind !== "external").map((n) => n.id);
}
