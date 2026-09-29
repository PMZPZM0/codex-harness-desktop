/**
 * 无限画布的**纯数据层**（无 React、无 DOM、无 IPC）。
 *
 * 职责：节点目录 / 默认负载 / 连线关系 / 快照校验与迁移 / 起手工作流 / 自动排版。
 * 为什么单独成模块：这些判定必须能被守卫**直接 import 跑真值表**
 * （`scripts/guards/*.mjs` 只能真跑 `.mjs`，`.ts` 只能读文本 ⇒ 断言会退化成"关键字在不在"）。
 *
 * 参考实现：CatCatUncle/openworkbuddy 的 `public/js/app-07-canvas-*.js`（MPL-2.0 底座 + PolyForm 业务层）。
 * ⛔ 只借鉴**做法与数据结构**，不抄它的代码与文案（该仓库整体非商业许可）。
 */

/** 节点分组（画布左上角「添加节点」菜单按这个顺序分组）。 */
export const DRAMA_GROUPS = ["策划", "世界设定", "分镜制作", "素材与生成", "交付"];

/**
 * 节点目录。width/height 是**卡片的固定尺寸**（不是最小尺寸）——
 * 画布上排版、命中测试、自动排版都读它；改这里等于改所有既有画布的观感。
 */
export const DRAMA_NODE_DEFS = {
  note: { label: "笔记", icon: "notebook-pen", width: 320, height: 200, subtitle: "随手记想法与待办", group: "策划" },
  script: { label: "剧本", icon: "file-text", width: 360, height: 250, subtitle: "概念、人物关系与对白", group: "策划" },
  agent: { label: "Agent 任务", icon: "bot", width: 360, height: 210, subtitle: "交给本项目 Agent 执行", group: "策划" },
  character: { label: "角色", icon: "user", width: 340, height: 300, subtitle: "设定与定妆照", group: "世界设定" },
  location: { label: "场景", icon: "map-pin", width: 340, height: 285, subtitle: "地点、时间与氛围", group: "世界设定" },
  storyboard: { label: "分镜表", icon: "clapperboard", width: 350, height: 235, subtitle: "短剧的唯一真源", group: "分镜制作" },
  scene: { label: "场次", icon: "film", width: 380, height: 250, subtitle: "一场戏下的镜头集合", group: "分镜制作" },
  shot: { label: "镜头", icon: "video", width: 360, height: 265, subtitle: "可生成、可重跑的最小单元", group: "分镜制作" },
  image: { label: "参考图", icon: "image", width: 340, height: 330, subtitle: "定妆照 / 首帧 / 场景图", group: "素材与生成" },
  video: { label: "视频片段", icon: "clapperboard", width: 380, height: 390, subtitle: "生成结果或本地素材", group: "素材与生成" },
  audio: { label: "声音", icon: "music", width: 320, height: 215, subtitle: "对白、配音或配乐", group: "素材与生成" },
  timeline: { label: "剪辑时间线", icon: "film", width: 380, height: 240, subtitle: "按分镜顺序拼成成片", group: "交付" },
};

/** 认不出的类型（新版本建的 / 别的分支建的）—— 照原样显示、只读，别当空白笔记覆盖人家的数据。 */
export const DRAMA_UNKNOWN_KIND = "unknown";

export function dramaNodeDef(kind) {
  return DRAMA_NODE_DEFS[kind] || { label: String(kind || "节点"), icon: "square", width: 320, height: 200, subtitle: "当前版本不认识这个类型", group: "策划" };
}

export function dramaIsKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(DRAMA_NODE_DEFS, String(kind || ""));
}

/* ------------------------------------------------------------------ 连线 */

/** 连线关系：[key, 中文标签]。顺序即检查器下拉里的顺序。 */
export const DRAMA_EDGE_RELATIONS = [
  ["input", "输入"],
  ["split", "拆分"],
  ["generate", "生成"],
  ["character", "角色"],
  ["background", "背景"],
  ["reference", "参考"],
  ["first_frame", "首帧"],
  ["last_frame", "尾帧"],
  ["motion", "运动"],
  ["audio", "配音"],
  ["composition", "构图"],
  ["style", "风格"],
  ["prop", "道具"],
  ["continuity", "连贯性"],
];

export function dramaRelationLabel(key) {
  const hit = DRAMA_EDGE_RELATIONS.find(([k]) => k === key);
  return hit ? hit[1] : "输入";
}

/**
 * 默认关系：**按「源类型 → 目标类型」推**，不是按连线方向猜。
 * 推不出来的落 input —— 让用户在下拉里自己改，比默认成某个具体关系再被误读要好。
 */
export function dramaDefaultRelation(sourceKind, targetKind) {
  const s = String(sourceKind || ""), t = String(targetKind || "");
  if (["image", "video", "audio"].includes(t)) return "generate";
  if (s === "script" && t === "storyboard") return "split";
  if (s === "character") return "character";
  if (s === "location") return "background";
  if (s === "video") return "motion";
  if (s === "audio") return "audio";
  if (s === "image") return "reference";
  return "input";
}

/** 检查器里可选的关系：常用三种恒在，另加「这条线默认推出来的」与「参考」。 */
export function dramaRelationOptions(selected, sourceKind, targetKind) {
  const must = new Set(["input", "split", "generate", "reference", dramaDefaultRelation(sourceKind, targetKind)]);
  const list = DRAMA_EDGE_RELATIONS.filter(([key]) => must.has(key) || key === selected);
  const keys = new Set(list.map(([key]) => key));
  for (const [key] of DRAMA_EDGE_RELATIONS) if (must.has(key) && !keys.has(key)) list.push([key, dramaRelationLabel(key)]);
  return list;
}

/* ------------------------------------------------------------------ 负载 */

/** 各类型的默认负载。新卡落地时的初始值 —— 卡片渲染读的就是这份。 */
export function dramaDefaultPayload(kind) {
  switch (kind) {
    case "note": return { title: "画布笔记", text: "" };
    case "script": return { title: "短剧剧本", text: "", aspect: "9:16", shotDuration: 4, style: "" };
    case "agent": return { title: "Agent 任务", task: "", status: "待执行", role: "本项目 Agent" };
    case "character": return { name: "新角色", role: "主角", description: "", look: "", ref: "" };
    case "location": return { name: "新场景", description: "", time: "" };
    case "storyboard": return { board: "", style: "" };
    case "scene": return { id: "", place: "", time: "" };
    case "shot": return { id: "", shot_size: "中景", prompt: "", motion: "", line: "", speaker: "", duration: 4, first_frame: "", video: "", audio: "" };
    case "image": return { title: "参考图", role: "定妆照", url: "", path: "", text: "" };
    case "video": return { title: "视频片段", prompt: "", model: "", aspect: "9:16", duration: 5, video: "", first_frame: "" };
    case "audio": return { title: "配音", text: "", path: "", url: "" };
    case "timeline": return { title: "最终剪辑", description: "按分镜顺序逐镜合轨、拼接，全在本机跑。", video: "" };
    default: return {};
  }
}

/**
 * 取节点标题（列表、toast、分镜表回写都用它）。
 * note 这类没有 title 的用 label 兜底 —— 不允许返回空串，否则界面上会出现无名卡。
 */
export function dramaNodeLabel(kind, payload) {
  const p = payload || {};
  const def = dramaNodeDef(kind);
  const raw = p.title || p.name || p.id || "";
  return String(raw).trim() || def.label || "节点";
}

/* --------------------------------------------------------------- 镜号分配 */

/**
 * 下一个空镜号。带场次时出 `S1-03`，不带时出 `镜头-03`。
 * ⛔ 只看 payload.id，**不看 title** —— 用户把镜号写进标题里是他的自由，
 *   拿标题去判空号会让「S1-01 特写」这种标题把 01 判成已占用。
 */
export function dramaNextShotId(payloads, sceneId) {
  const prefix = String(sceneId || "").trim() || "";
  const re = prefix ? new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)$") : /^镜头-(\d+)$/;
  let max = 0;
  for (const p of payloads || []) {
    const m = re.exec(String((p && p.id) || "").trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  const next = String(max + 1).padStart(2, "0");
  return prefix ? `${prefix}-${next}` : `镜头-${next}`;
}

export function dramaNextNodeId(prefix = "n") {
  dramaSeq.counter = (dramaSeq.counter + 1) % 1e9;
  return `${prefix}-${Date.now().toString(36)}-${dramaSeq.counter.toString(36)}`;
}
const dramaSeq = { counter: 0 };

/* ------------------------------------------------------------------ 快照 */

export const DRAMA_SNAPSHOT_VERSION = 2;

function finite(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 校验并归一化一份快照。**永不抛**：坏数据降级为「丢掉那一条 + 记一笔修复」，
 * 整份画布打不开比丢一个节点严重得多。
 *
 * 返回 `{ version, nodes, edges, updatedAt, repaired, legacyEdges }`。
 * ⛔ `legacyEdges` 是给调用方看的**唯一重点**：版本 1 的快照压根没存过连线，
 *   空 edges 不能当成「用户把线都删了」，也不能拿本机那份顶上去（见 dramaMergeSnapshot）。
 */
export function dramaNormalizeSnapshot(raw) {
  const repaired = [];
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.nodes)) {
    return { version: DRAMA_SNAPSHOT_VERSION, nodes: [], edges: [], updatedAt: 0, repaired: ["整份快照不可用，已按空画布处理"], legacyEdges: false };
  }
  const seen = new Set();
  const nodes = [];
  for (const item of raw.nodes) {
    if (!item || typeof item !== "object") { repaired.push("丢掉一条非对象节点"); continue; }
    const id = String(item.id || "").trim();
    if (!id || seen.has(id)) { repaired.push(`丢掉重复或空 id 的节点（${id || "空"}）`); continue; }
    seen.add(id);
    const kind = String(item.kind || "note");
    if (!dramaIsKnownKind(kind)) repaired.push(`节点 ${id} 的类型「${kind}」当前版本不识别，照原样保留`);
    const size = item.size && typeof item.size === "object" ? item.size : {};
    const def = dramaNodeDef(kind);
    nodes.push({
      id,
      kind,
      payload: item.payload && typeof item.payload === "object" ? { ...item.payload } : {},
      position: { x: finite(item.position && item.position.x, 0), y: finite(item.position && item.position.y, 0) },
      size: { width: Math.max(80, finite(size.width, def.width)), height: Math.max(60, finite(size.height, def.height)) },
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [];
  const edgeSeen = new Set();
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    const source = dramaEndpointId(e && e.source);
    const target = dramaEndpointId(e && e.target);
    if (!source || !target) { repaired.push("丢掉一条端点缺失的连线"); continue; }
    if (source === target) { repaired.push(`丢掉自环连线（${source}）`); continue; }
    // 端点节点不在本份快照里 ⇒ 那条线是悬空的，留着会在界面上指向不存在的位置
    if (!ids.has(source) || !ids.has(target)) { repaired.push(`丢掉悬空连线（${source} → ${target}）`); continue; }
    const key = `${source}→${target}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push({ source: { id: source }, target: { id: target }, relation: String((e && e.relation) || "") || undefined });
  }
  const rawVersion = Number(raw.version);
  const version = Number.isFinite(rawVersion) && rawVersion > 0 ? Math.min(rawVersion, DRAMA_SNAPSHOT_VERSION) : 1;
  return {
    version: DRAMA_SNAPSHOT_VERSION,
    nodes,
    edges,
    updatedAt: finite(raw.updatedAt, 0),
    repaired,
    legacyEdges: version < 2 && edges.length === 0,
  };
}

/** 端点既可能是 `"n-1"` 也可能是 `{ id: "n-1" }`（两种都存在过），统一取 id。 */
export function dramaEndpointId(endpoint) {
  if (typeof endpoint === "string") return endpoint.trim();
  if (!endpoint || typeof endpoint !== "object") return "";
  return String(endpoint.id || endpoint.cell || "").trim();
}

/**
 * 合并「本机快照」与「远端/存档快照」。
 * 两条规矩（都是实测踩出来的）：
 *  · 存档是 v1（没存过连线）⇒ 连线取本机那份，别把用户刚删的线从存档里接回来；
 *  · 存档是 v2 的空连线 ⇒ 就是空，不许顶。
 * 节点一律以 `incoming` 为准（它才是"盘上那份"）。
 */
export function dramaMergeSnapshot(incoming, current) {
  const next = dramaNormalizeSnapshot(incoming);
  if (!next.legacyEdges) return next;
  const cur = dramaNormalizeSnapshot(current);
  return { ...next, edges: cur.edges, repaired: next.repaired };
}

/** 快照指纹：只认节点与连线（位置/负载），不认 updatedAt —— 后者每次都变，比不出"改了没有"。 */
export function dramaSnapshotKey(snapshot) {
  const s = snapshot || {};
  const nodes = (s.nodes || []).map((n) => [n.id, n.kind, JSON.stringify(n.payload || {}), Math.round(n.position?.x || 0), Math.round(n.position?.y || 0)]);
  const edges = (s.edges || []).map((e) => [dramaEndpointId(e.source), dramaEndpointId(e.target), e.relation || ""]);
  return JSON.stringify({ nodes: nodes.sort((a, b) => String(a[0]).localeCompare(String(b[0]))), edges: edges.sort((a, b) => String(a[0] + a[1]).localeCompare(String(b[0] + b[1]))) });
}

/* ------------------------------------------------------------ 起手工作流 */

/**
 * 「新建短剧工作流」的骨架：7 张卡、5 条线。
 * 纯函数 ⇒ 守卫可以真跑它，断言「卡数与连线数」以及「每条线的端点在卡里」。
 */
export function dramaStarterWorkflow(baseX = 120, baseY = 100) {
  const col = 430, row = 340;
  const node = (id, kind, payload, x, y) => ({ id, kind, payload: { ...dramaDefaultPayload(kind), ...payload }, position: { x, y }, size: { width: dramaNodeDef(kind).width, height: dramaNodeDef(kind).height } });
  const nodes = [
    /* ⛔ 同上：payload 不预填引导文本（生成时会污染提示词），引导由卡片空态承担。 */
    node("n-direction", "note", { title: "创作方向" }, baseX, baseY),
    node("n-script", "script", { title: "短剧剧本" }, baseX + col, baseY),
    node("n-character", "character", { name: "主角", role: "主角" }, baseX + col, baseY + row),
    node("n-location", "location", { name: "核心场景" }, baseX + col * 2, baseY + row),
    node("n-storyboard", "storyboard", { board: "" }, baseX + col * 2, baseY),
    node("n-timeline", "timeline", {}, baseX + col * 3, baseY),
  ];
  const edges = [
    ["n-direction", "n-script", "input"],
    ["n-script", "n-character", "character"],
    ["n-script", "n-location", "background"],
    ["n-script", "n-storyboard", "split"],
    ["n-storyboard", "n-timeline", "input"],
  ].map(([source, target, relation]) => ({ source: { id: source }, target: { id: target }, relation }));
  return { version: DRAMA_SNAPSHOT_VERSION, nodes, edges, updatedAt: 0 };
}

/**
 * 生图工作流起手（09-27）：不是短剧，是「需求 → 主提示词 → 出图 A/B → 选图」的图像生成链。
 * ⛔ 参考项目（openworkbuddy）**没有**独立的生图工作流模块——生图是它画布 13 种卡的一种用法；
 * 这里同样复用画布引擎与 image 卡（生成走 builtin:generate-image），只是起手摆法与文案不同，
 * 侧栏单独给一个入口。用户问过"参考项目是不是也有一个"——答案如上，别声称"照搬了它的生图工作流"。
 */
export function imageStarterWorkflow(baseX = 120, baseY = 100) {
  const col = 430, row = 340;
  const node = (id, kind, payload, x, y) => ({ id, kind, payload: { ...dramaDefaultPayload(kind), ...payload }, position: { x, y }, size: { width: dramaNodeDef(kind).width, height: dramaNodeDef(kind).height } });
  const nodes = [
    /* ⛔ 09-28 工作流打磨：payload 里**不预填引导文本** —— 此前「主体 + 环境 + 光线…」这类
       引导词会被生成逻辑当真实提示词发给模型（污染），出图卡的「按主提示词生成…」也会和
       上游拼接重复。引导语由卡片**空态文案**承担（DramaNodeCard 各分支），payload 留空 =
       生成时自动沿用连入的上游提示词（upstreamPrompts）。 */
    node("n-brief", "note", { title: "需求说明" }, baseX, baseY),
    node("n-prompt", "image", { title: "主提示词" }, baseX + col, baseY),
    node("n-out-a", "image", { title: "出图 A", variant: "更亮 / 更暖" }, baseX + col * 2, baseY),
    node("n-out-b", "image", { title: "出图 B", variant: "更冷 / 更暗" }, baseX + col * 2, baseY + row),
    node("n-pick", "note", { title: "选图结论" }, baseX + col * 3, baseY),
  ];
  const edges = [
    ["n-brief", "n-prompt", "input"],
    ["n-prompt", "n-out-a", "generate"],
    ["n-prompt", "n-out-b", "generate"],
    ["n-out-a", "n-pick", "input"],
  ].map(([source, target, relation]) => ({ source: { id: source }, target: { id: target }, relation }));
  return { version: DRAMA_SNAPSHOT_VERSION, nodes, edges, updatedAt: 0 };
}

/* ------------------------------------------------------------ 自动排版 */

/**
 * 按「生成关系」左到右排（自己实现的**分层**排版，不引 dagre）。
 * 为什么不用 dagre：我们的图很小（十几张卡），而 dagre 会带来 graphlib + lodash 两个传递依赖；
 * 分层布局 30 行就够，还省掉一个 npm 包。
 *
 * 做法：① 按有向边算层号（最长路径，Kahn 拓扑序）② 同层按原有 y 排成列 ③ 整列居中。
 * 环会被忽略（拓扑序取不完的节点放最后一层），不会死循环。
 */
export function dramaAutoLayout(nodes, edges, options = {}) {
  const gapX = finite(options.gapX, 90), gapY = finite(options.gapY, 46);
  const list = (nodes || []).filter(Boolean);
  if (!list.length) return new Map();
  const byId = new Map(list.map((n) => [n.id, n]));
  const outs = new Map(list.map((n) => [n.id, []]));
  const indeg = new Map(list.map((n) => [n.id, 0]));
  for (const e of edges || []) {
    const s = dramaEndpointId(e.source), t = dramaEndpointId(e.target);
    if (!byId.has(s) || !byId.has(t) || s === t) continue;
    outs.get(s).push(t);
    indeg.set(t, (indeg.get(t) || 0) + 1);
  }
  const rank = new Map(list.map((n) => [n.id, 0]));
  const queue = list.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  const deg = new Map(indeg);
  const settled = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (settled.has(id)) continue;
    settled.add(id);
    for (const next of outs.get(id) || []) {
      rank.set(next, Math.max(rank.get(next) || 0, (rank.get(id) || 0) + 1));
      deg.set(next, (deg.get(next) || 0) - 1);
      if ((deg.get(next) || 0) <= 0) queue.push(next);
    }
  }
  // 环里的节点进不了拓扑序 ⇒ 单独放到最后一层（宁可排歪，也不能漏排或死循环）
  const maxRank = Math.max(0, ...[...rank.values()]);
  for (const n of list) if (!settled.has(n.id)) rank.set(n.id, maxRank + 1);

  const columns = new Map();
  for (const n of list) {
    const r = rank.get(n.id) || 0;
    if (!columns.has(r)) columns.set(r, []);
    columns.get(r).push(n);
  }
  const out = new Map();
  const orderedRanks = [...columns.keys()].sort((a, b) => a - b);
  // 先算每列宽度与整体高度，再定位 —— 让整张图大致居中，而不是靠左上角堆
  let totalWidth = 0;
  const colWidth = new Map(), colHeight = new Map();
  for (const r of orderedRanks) {
    const items = columns.get(r);
    const w = Math.max(...items.map((n) => n.size?.width || dramaNodeDef(n.kind).width));
    const h = items.reduce((sum, n) => sum + (n.size?.height || dramaNodeDef(n.kind).height), 0) + gapY * (items.length - 1);
    colWidth.set(r, w); colHeight.set(r, h);
    totalWidth += w;
  }
  totalWidth += gapX * (orderedRanks.length - 1);
  const totalHeight = Math.max(...orderedRanks.map((r) => colHeight.get(r)));
  let cursorX = -totalWidth / 2;
  for (const r of orderedRanks) {
    const items = [...columns.get(r)].sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0) || String(a.id).localeCompare(String(b.id)));
    let cursorY = -totalHeight / 2;
    for (const n of items) {
      const h = n.size?.height || dramaNodeDef(n.kind).height;
      out.set(n.id, { x: Math.round(cursorX), y: Math.round(cursorY) });
      cursorY += h + gapY;
    }
    cursorX += colWidth.get(r) + gapX;
  }
  return out;
}

/* ------------------------------------------------------------ 白模视频 / 3D 建模工作流（09-29 用户立项） */

/**
 * 白模视频工作流（Blender 白模预演 → Seedance 2.5 渲染成片）。
 * 依据（09-29 查证）：Seedance 2.5 官方提示词指南有「白模参考/渲染」专节 —— 支持输入含
 * 运动/运镜/动线/光照的白模**视频**做渲染，还可叠加主体/场景/道具参考图；即梦已上线
 * Maya/Blender 插件。成熟管线 = greybox blockout → 相机路径 keyframe → 低质量渲染参考片
 * → 交给模型上材质/打光/渲染（"人决定构图运镜，AI 负责渲染"）。
 * payload.flow = "whitebox"：工作流身份标记（detectFlow 用它显示具体名）。
 */
export function whiteboxStarterWorkflow(baseX = 120, baseY = 100) {
  const col = 430, row = 340;
  const node = (id, kind, payload, x, y) => ({ id, kind, payload: { ...dramaDefaultPayload(kind), ...payload }, position: { x, y }, size: { width: dramaNodeDef(kind).width, height: dramaNodeDef(kind).height } });
  const nodes = [
    node("n-brief", "note", { title: "需求说明", flow: "whitebox", text: "要拍什么、给谁看、时长与画幅（9:16 竖屏 / 16:9 横屏）。白模管构图与运镜，AI 管渲染。" }, baseX, baseY),
    node("n-blockout", "note", { title: "白模预演（在 Blender 里做）", flow: "whitebox", text: [
      "① 用简单几何体搭场景：方块=建筑，圆柱=柱子，人只用简单人偶 —— 官方建议主体仅保留躯体，别带四肢细节（否则渲染会四肢僵化）；",
      "② 相机路径打 keyframe 锁死运镜：推拉摇移、一镜到底都靠这一步控制；",
      "③ 低质量快速渲染导出参考片/关键帧 —— 小尺寸低帧率就够，细节由 AI 补。",
    ].join("\n") }, baseX + col, baseY),
    node("n-ref", "image", { title: "白模关键帧", flow: "whitebox" }, baseX + col * 2, baseY),
    node("n-shot", "shot", { title: "AI 渲染镜头", flow: "whitebox" }, baseX + col * 3, baseY),
    node("n-final", "note", { title: "成片结论", flow: "whitebox" }, baseX + col * 4, baseY),
  ];
  const edges = [
    ["n-brief", "n-blockout", "input"],
    ["n-blockout", "n-ref", "input"],
    ["n-ref", "n-shot", "generate"],
    ["n-shot", "n-final", "input"],
  ].map(([source, target, relation]) => ({ source: { id: source }, target: { id: target }, relation }));
  return { version: DRAMA_SNAPSHOT_VERSION, nodes, edges, updatedAt: 0 };
}

/**
 * 3D 建模工作流（参考图 → Aholo Lux3D 生成 3D 资产 → Blender 组装渲染）。
 * 依据（09-29 查证）：Aholo Lux3D（群核科技）= 图/文 → 3D（高斯预览 → PBR 材质网格，导出 GLB）；
 * Standard 版质量优先（~5 分钟）/ Turbo 极速版（~20 秒，批量筛选）；官方工作流即
 * "模型生成资产 → Blender 组装场景渲染"。
 * ⛔ 3D 生成通道（API 提交/轮询/GLB 落盘）尚未接入 —— 本模板先落卡片链与操作指引，
 *    生成动作在 Lux3D 官网/插件完成后把 GLB 路径记到卡片上。通道接入列为下一步。
 */
export function model3dStarterWorkflow(baseX = 120, baseY = 100) {
  const col = 430, row = 340;
  const node = (id, kind, payload, x, y) => ({ id, kind, payload: { ...dramaDefaultPayload(kind), ...payload }, position: { x, y }, size: { width: dramaNodeDef(kind).width, height: dramaNodeDef(kind).height } });
  const nodes = [
    node("n-brief", "note", { title: "建模需求", flow: "model3d", text: "要什么资产、用途（电商展示/场景组装/游戏道具）、精度要求：重点资产走 Standard（质量优先），批量筛选走 Turbo（极速）。" }, baseX, baseY),
    node("n-ref", "image", { title: "参考图 / 商品图", flow: "model3d" }, baseX + col, baseY),
    node("n-gen3d", "note", { title: "3D 资产生成（Aholo Lux3D）", flow: "model3d", text: [
      "① 拿参考图（或一句话描述）到 Aholo Lux3D 生成 3D 模型；",
      "② 先出高斯预览确认外观，再生成 PBR 材质网格；",
      "③ 导出 GLB，放到当前工作目录，把文件路径记在下面的卡片上。",
    ].join("\n") }, baseX + col * 2, baseY),
    node("n-model", "note", { title: "3D 资产清单（GLB 路径）", flow: "model3d" }, baseX + col * 3, baseY),
    node("n-render", "note", { title: "Blender 组装 / 渲染", flow: "model3d", text: "把生成的资产按布局组装进场景（可逐件调整位置、加道具），打光渲染出效果图 / 白模预演视频。" }, baseX + col * 4, baseY),
  ];
  const edges = [
    ["n-brief", "n-ref", "input"],
    ["n-ref", "n-gen3d", "input"],
    ["n-gen3d", "n-model", "input"],
    ["n-model", "n-render", "input"],
  ].map(([source, target, relation]) => ({ source: { id: source }, target: { id: target }, relation }));
  return { version: DRAMA_SNAPSHOT_VERSION, nodes, edges, updatedAt: 0 };
}
