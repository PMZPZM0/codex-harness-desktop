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
  /* ⛔ 独立生图节点（09-29 用户：「设计生图节点时，请将其独立出来，不要与视频节点共用同一套结构」）。
     它与 image（参考图）是两回事：image 是**素材槽**（喂进去的图），imagegen 是**产出槽**
     （按电商图类型出图，带类型 / 尺寸 / 张数 / 图块清单）。也**永不出现视频通道**。 */
  imagegen: { label: "生图", icon: "imagegen", width: 360, height: 380, subtitle: "主图 / SKU / 详情 / 场景 / 白底 / 买家秀", group: "素材与生成" },
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
    /* 独立生图节点：imageType 决定这一张是什么图；subject 是**锁定的主体描述**（整套图共用，
       保证六类图是同一件商品不跳戏）；panels 只对详情图有意义（图块清单）。 */
    case "imagegen": return {
      title: "生图", imageType: "main", size: "1024x1024", count: 1,
      prompt: "", negative: "", subject: "", ref: "", panels: "",
      path: "", url: "", text: "",
    };
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
  const col = 430;
  const node = (id, kind, payload, x, y) => ({ id, kind, payload: { ...dramaDefaultPayload(kind), ...payload }, position: { x, y }, size: { width: dramaNodeDef(kind).width, height: dramaNodeDef(kind).height } });
  /* ⛔⛔ 09-29 用户：「生图工作流请设计得更简单一些，节点数量要精简，减少不必要的复杂连接，
     方便新手快速理解使用」—— 原版是 5 卡 4 线（需求说明 → 主提示词 → 出图 A/B → 选图结论）。
     砍成 **3 卡 2 线一条直线**，每一步只做一件事：
       ① 写提示词（image 卡：既写提示词、也是点「生图」的地方）
       ② 出图（image 卡：产物落这里；想多要几张就再点一次「重出」）
       ③ 备注（note 卡：记下用了哪张、为什么 —— 可留空）
     砍掉的东西与理由：
       · 「需求说明」笔记卡 —— 新手要写两遍文本（需求 + 提示词），重复；需求直接写进提示词。
       · 「出图 A / 出图 B」双产物 —— 对比变体是进阶玩法，默认路径不该先教这个；
         想对比就**复制卡片**或再拖一张出图卡（自由编排仍在，只是不默认摆出来）。
       · 「选图结论」与备注合并为一张卡。
     ⛔ payload 里**不预填引导文本**（09-28 教训：引导词会被当真实提示词发给模型 ⇒ 污染）；
     引导语由卡片空态文案承担。守卫【214】钉住「≤3 节点 / ≤2 连线」防复杂度回潮。 */
  const nodes = [
    node("n-prompt", "image", { title: "写提示词", step: 1, act: "prompt" }, baseX, baseY),
    /* hint: "output" = 模板里的**产物位**（渲染层据此把空态写成「点左边卡的生图，图出在这里」，
       而不是普通的「在这里写提示词」——两张卡都教写提示词会让新手分不清哪张出图）。 */
    node("n-out", "image", { title: "出图", step: 2, hint: "output", act: "output" }, baseX + col, baseY),
    node("n-note", "note", { title: "备注（可选）", step: 3 }, baseX + col * 2, baseY),
  ];
  const edges = [
    ["n-prompt", "n-out", "generate"],
    ["n-out", "n-note", "input"],
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
    node("n-brief", "note", { title: "需求说明", flow: "whitebox", step: 1, text: "要拍什么、给谁看、时长与画幅（9:16 竖屏 / 16:9 横屏）。白模管构图与运镜，AI 管渲染。" }, baseX, baseY),
    node("n-blockout", "note", { title: "白模预演（在 Blender 里做）", flow: "whitebox", step: 2, text: [
      "① 用简单几何体搭场景：方块=建筑，圆柱=柱子，人只用简单人偶 —— 官方建议主体仅保留躯体，别带四肢细节（否则渲染会四肢僵化）；",
      "② 相机路径打 keyframe 锁死运镜：推拉摇移、一镜到底都靠这一步控制；",
      "③ 低质量快速渲染导出参考片/关键帧 —— 小尺寸低帧率就够，细节由 AI 补。",
    ].join("\n") }, baseX + col, baseY),
    node("n-ref", "image", { title: "白模关键帧", flow: "whitebox", step: 3, act: "upload" }, baseX + col * 2, baseY),
    node("n-shot", "shot", { title: "AI 渲染镜头", flow: "whitebox", step: 4, act: "generate" }, baseX + col * 3, baseY),
    node("n-final", "note", { title: "成片结论", flow: "whitebox", step: 5 }, baseX + col * 4, baseY),
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
    node("n-brief", "note", { title: "建模需求", flow: "model3d", step: 1, text: "要什么资产、用途（电商展示/场景组装/游戏道具）、精度要求：重点资产走 Standard（质量优先），批量筛选走 Turbo（极速）。" }, baseX, baseY),
    node("n-ref", "image", { title: "参考图 / 商品图", flow: "model3d", step: 2, act: "upload" }, baseX + col, baseY),
    node("n-gen3d", "note", { title: "3D 资产生成（Aholo Lux3D）", flow: "model3d", step: 3, text: [
      "① 拿参考图（或一句话描述）到 Aholo Lux3D 生成 3D 模型；",
      "② 先出高斯预览确认外观，再生成 PBR 材质网格；",
      "③ 导出 GLB，放到当前工作目录，把文件路径记在下面的卡片上。",
    ].join("\n") }, baseX + col * 2, baseY),
    node("n-model", "note", { title: "3D 资产清单（GLB 路径）", flow: "model3d", step: 4 }, baseX + col * 3, baseY),
    node("n-render", "note", { title: "Blender 组装 / 渲染", flow: "model3d", step: 5, text: "把生成的资产按布局组装进场景（可逐件调整位置、加道具），打光渲染出效果图 / 白模预演视频。" }, baseX + col * 4, baseY),
  ];
  const edges = [
    ["n-brief", "n-ref", "input"],
    ["n-ref", "n-gen3d", "input"],
    ["n-gen3d", "n-model", "input"],
    ["n-model", "n-render", "input"],
  ].map(([source, target, relation]) => ({ source: { id: source }, target: { id: target }, relation }));
  return { version: DRAMA_SNAPSHOT_VERSION, nodes, edges, updatedAt: 0 };
}

/* --------------------------------------------------- 旧模板自动升级（09-29）

   问题：工作流模板只在**新建**时生效，而存量画布存在 localStorage；切 tab 时优先读回旧板
   ⇒ 模板改了也永远看到旧卡片（用户：「我这怎么又是旧的了」）。
   做法：结构级识别「空壳旧模板」并原地重建为最新模板。
   ⛔ 判据必须**同时**满足：① 节点 id 集合与某份历史模板逐字相同 ② 每个 payload 都没有内容
      （文字 / 图 / 视频 / 参考图 / 提示词）—— 有内容的画布绝不自动改（不替用户做决定）。
   ⛔ 别用「快照版本号」当判据：dramaNormalizeSnapshot 会重写版本号，且用户只要拖动过卡片
      位置就会变 —— 结构性探测更稳。 */

/** payload 里哪些字段算「用户内容」：任一非空就不算空壳。 */
const STARTER_CONTENT_KEYS = ["text", "path", "url", "ref", "image", "video", "audio", "prompt", "note", "content"];

/** 历史 starter 模板指纹（按 id 集合识别）。新增简化时必须**追加**一条，别改旧的。 */
const LEGACY_STARTER_SIGNATURES = [
  // 旧「生图工作流」：5 卡（需求说明 / 主提示词 / 出图 A / 出图 B / 选图结论）
  { kind: "image", ids: ["n-brief", "n-prompt", "n-out-a", "n-out-b", "n-pick"], build: () => imageStarterWorkflow() },
];

function payloadHasContent(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  return STARTER_CONTENT_KEYS.some((key) => {
    const value = p[key];
    if (typeof value === "string") return value.trim().length > 0;
    return value !== undefined && value !== null;
  });
}

/**
 * 识别这张快照是不是某份历史 starter 模板（**不看内容**，只看结构）。
 * @returns {{ kind: string; ids: string[] } | null}
 */
export function legacyStarterSignature(snapshot) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  if (!nodes.length) return null;
  /* 已知历史模板最多 5 个节点；数量差太远直接否掉，省得误判超大画布 */
  const ids = nodes.map((n) => String(n?.id || "")).sort();
  for (const sig of LEGACY_STARTER_SIGNATURES) {
    const want = [...sig.ids].sort();
    if (ids.length === want.length && ids.every((id, index) => id === want[index])) return { kind: sig.kind, ids: [...sig.ids] };
  }
  return null;
}

/**
 * 若是「空壳旧模板」⇒ 返回升级后的最新快照；否则返回 null（调用方保持原样）。
 * ⛔ 这是**唯一的自动改写入口**，内容判据写在这里；调用方只负责"非 null 就替换 + 写回"。
 */
export function upgradeLegacyStarterSnapshot(snapshot) {
  const hit = legacyStarterSignature(snapshot);
  if (!hit) return null;
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  if (nodes.some((node) => payloadHasContent(node?.payload))) return null;
  const sig = LEGACY_STARTER_SIGNATURES.find((item) => item.kind === hit.kind);
  return sig ? sig.build() : null;
}

/* ═══════════════════════════ 独立生图节点：六类图 ═══════════════════════════

   调研依据（09-29，见回复）：主流电商素材包 = 白底母版（平台硬门槛）→ 派生主图 / 场景 /
   详情 / 规格 / 买家秀；关键是**同一商品在整套图里不跳戏** ⇒ 两条机制落在本节点上：
     ① subject（锁定主体描述）：用视觉模型把商品图反推成一段固定描述，整套图共用；
     ② size 与构图约束按图类型给默认值（白底必须写死纯白背景，否则模型自己加渐变）。
   ⛔ 为什么不做成「参考图直传生图接口」：当前生图通道（builtin:generate-image）是**纯文生图**，
      没有图输入字段 —— 硬塞不存在的参数就是让模型调不存在的工具。图生图接入列为下一步。 */

/** 六类图：key 存进 payload.imageType；size 是该类型的**默认**尺寸（用户可改）。 */
export const IMAGE_KINDS = [
  {
    key: "main", label: "主图", size: "1024x1024", ratio: "1:1",
    purpose: "平台首图（搜索页 / 详情页头图），一眼看清是什么",
    skeleton: "主体描述 + 正面或 45° 机位 + 纯白/浅灰无缝背景 + 均匀柔光 + 商业产品摄影 + 商品占画面 85% 以上 + 无文字无水印",
    note: "同一商品多拍几个角度（正面 / 侧面 / 45° / 特写）凑成轮播；主图不写促销文字",
  },
  {
    key: "sku", label: "SKU 图", size: "1024x1024", ratio: "1:1",
    purpose: "规格切换缩略图：颜色 / 款式 / 容量 各一张",
    skeleton: "主体描述（只替换颜色或款式词）+ 与主图完全相同的机位与光线 + 纯白背景 + 商品居中",
    note: "⛔ 一次只改「颜色 / 款式」这一个变量，机位光线照抄主图 —— 否则规格缩略图看着像不同商品",
  },
  {
    key: "detail", label: "详情图", size: "1024x1365", ratio: "3:4",
    purpose: "详情页纵向长图，由若干图块（tile）拼成 —— 见下方「图块清单」",
    skeleton: "逐块生成：每块一个卖点，构图给文字留位置，风格与主图保持一致",
    note: "⛔ 详情图不是一张图：本卡按「图块清单」逐块出图，**长图拼接需在外部完成**（本工作台暂无拼接通道）",
  },
  {
    key: "scene", label: "场景图", size: "1024x1365", ratio: "3:4",
    purpose: "生活情境图（详情页第二张起），让买家代入使用场景",
    skeleton: "主体描述 + 具体环境（大理石台面 / 木质书桌 / 卧室床品）+ 光线方向 + 浅景深 + 生活化氛围",
    note: "环境写具体比写形容词有用：模型认「大理石台面、晨光从左侧」，不认「温馨」",
  },
  {
    key: "white", label: "白底图", size: "1024x1024", ratio: "1:1",
    purpose: "平台硬门槛：纯白底（RGB 255,255,255），也是整套图的**母版**",
    skeleton: "主体描述 + 纯白无缝背景（RGB 255,255,255）+ 顶光均匀照明 + 商品占画面 85–90% + 无阴影无反射无道具无文字",
    note: "⛔「纯白背景」必须写死 —— 不写模型会自己加渐变或纹理；浅灰底会被平台审核判不合格",
  },
  {
    key: "ugc", label: "买家秀", size: "1024x1365", ratio: "3:4",
    purpose: "买家实拍感 / 上身试穿，拉近可信度",
    skeleton: "主体描述 + 手持或上身 + 居家 / 街头随手拍感 + 手机直出质感 + 自然光 + 轻微噪点",
    note: "⛔ 别写成影棚级商业摄影（那就不是买家秀了）；服装走试穿、非服装走手持场景",
  },
];

/** 详情图的默认图块清单（纵向从上到下）。用户可在卡片上改。 */
export const DETAIL_PANELS_DEFAULT = [
  "1. 首屏主视觉：商品 + 一句核心主张",
  "2. 卖点拆解：3 个卖点，每点配局部特写",
  "3. 材质 / 工艺微距特写",
  "4. 尺寸与参数：尺规参照或参数表底图",
  "5. 使用场景：1–2 张生活情境",
  "6. 包装与配件全家福",
].join("\n");

export function imageKindMeta(key) {
  const found = IMAGE_KINDS.find((item) => item.key === String(key || ""));
  return found || IMAGE_KINDS[0];
}

/** 检查器下拉用：{ value, label } 形态（FieldSpec.options 两种都支持）。 */
export function imageKindOptions() {
  return IMAGE_KINDS.map((item) => ({ value: item.key, label: item.label }));
}

/** 详情图按图块清单切成数组（一行一块）；空则给默认清单。 */
export function detailPanelsOf(payload) {
  const raw = String(payload?.panels || "").trim() || DETAIL_PANELS_DEFAULT;
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/**
 * 电商出图工作流（09-29 新模板）。
 * 结构直接编码调研结论：**先出白底母版 → 再从母版派生**主图 / SKU / 场景 / 买家秀 / 详情图，
 * 每一步共用同一段「锁定主体描述」，保证一套图是同一件商品。
 * ⛔ 参考图卡（image，act=upload）只做素材槽：用户把商品图传/拖进来，再在生图卡点「锁定主体」。
 */
export function ecomImageStarterWorkflow(baseX = 120, baseY = 100) {
  const col = 430, row = 430;
  const node = (id, kind, payload, x, y) => ({ id, kind, payload: { ...dramaDefaultPayload(kind), ...payload }, position: { x, y }, size: { width: dramaNodeDef(kind).width, height: dramaNodeDef(kind).height } });
  const gen = (id, type, step, x, y) => {
    const meta = imageKindMeta(type);
    return node(id, "imagegen", {
      title: meta.label, imageType: meta.key, size: meta.size, count: 1,
      /* act="produce"：产出位 —— 给「生图」但不给「上传参考图」（参考图在上游的「商品参考图」卡），
         同时保留「AI 润色」（用户要求每张提示词卡都有）。 */
      flow: "ecom", step, act: "produce",
      panels: meta.key === "detail" ? DETAIL_PANELS_DEFAULT : "",
    }, x, y);
  };
  const nodes = [
    node("n-ref", "image", { title: "商品参考图", flow: "ecom", step: 1, act: "upload", hint: "ref" }, baseX, baseY),
    gen("n-white", "white", 2, baseX + col, baseY),
    gen("n-main", "main", 3, baseX + col * 2, baseY),
    gen("n-scene", "scene", 4, baseX + col * 2, baseY + row),
    gen("n-sku", "sku", 3, baseX + col * 3, baseY),
    gen("n-ugc", "ugc", 4, baseX + col * 3, baseY + row),
    gen("n-detail", "detail", 4, baseX + col * 4, baseY),
    node("n-pack", "note", { title: "素材包清单", flow: "ecom", step: 5, text: "" }, baseX + col * 4, baseY + row),
  ];
  const edges = [
    ["n-ref", "n-white", "input"],
    ["n-white", "n-main", "generate"],
    ["n-white", "n-sku", "generate"],
    ["n-white", "n-scene", "generate"],
    ["n-white", "n-ugc", "generate"],
    ["n-white", "n-detail", "generate"],
    ["n-ref", "n-pack", "input"],
  ].map(([source, target, relation]) => ({ source: { id: source }, target: { id: target }, relation }));
  return { version: DRAMA_SNAPSHOT_VERSION, nodes, edges, updatedAt: 0 };
}
