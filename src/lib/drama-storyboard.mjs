/**
 * 短剧分镜表的**纯数据层**（无 React、无 DOM、无 IPC）。
 *
 * 分镜表是这条链路的**唯一真源**：镜头卡读它、生成按它跑、引擎会话也读同一份。
 * 所以这里的判定必须能被守卫直接跑真值表 —— 放 `.mjs` 而不是 `.tsx`。
 *
 * ⛔ 许可说明：字段设计参考了 CatCatUncle/openworkbuddy 的 `skills/short-drama/references/分镜表.schema.json`
 *    （该仓库为 PolyForm 非商业许可）。这里**只借鉴「字段该覆盖哪些信息」这件事**，
 *    结构、命名与说明文字均为本项目自写，未复制其文件。
 */

export const STORYBOARD_VERSION = 1;
export const STORYBOARD_ASPECTS = ["9:16", "16:9", "1:1"];
export const STORYBOARD_SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写"];

/** 分镜表在工作区里的落点。放隐藏目录，不跟用户的素材文件混在一起。 */
export function storyboardPathFor(name) {
  const safe = String(name || "main").replace(/[\\/:*?"<>|]/g, "_").replace(/\.json$/i, "") || "main";
  return `.drama-canvas/storyboards/${safe}.json`;
}

export function storyboardDefault(title = "未命名短剧") {
  return { version: STORYBOARD_VERSION, title, logline: "", aspect: "9:16", fps: 24, style: "", characters: [], scenes: [], output: {} };
}

function asString(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
function asStringArray(v) { return Array.isArray(v) ? v.map(asString).map((s) => s.trim()).filter(Boolean) : []; }

/**
 * 校验并归一化一份分镜表。**永不抛**：坏字段降级为空 + 记一条问题，
 * 让画布至少能开出来（"打不开"比"少一个字段"严重得多）。
 *
 * `problems` 里的文案是给用户看的，要说清**哪一场哪一镜**。
 */
export function storyboardNormalize(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") {
    return { data: storyboardDefault(), problems: ["分镜表不是合法对象，已按空表处理"], ok: false };
  }
  const data = storyboardDefault(asString(raw.title) || "未命名短剧");
  data.logline = asString(raw.logline);
  data.style = asString(raw.style);
  data.aspect = STORYBOARD_ASPECTS.includes(asString(raw.aspect)) ? asString(raw.aspect) : "9:16";
  const fps = Number(raw.fps);
  data.fps = Number.isFinite(fps) && fps >= 12 && fps <= 60 ? Math.round(fps) : 24;

  const charIds = new Set();
  for (const [i, c] of (Array.isArray(raw.characters) ? raw.characters : []).entries()) {
    if (!c || typeof c !== "object") { problems.push(`第 ${i + 1} 个角色不是对象，已跳过`); continue; }
    const id = asString(c.id).trim();
    if (!id) { problems.push(`第 ${i + 1} 个角色缺 id（镜头靠 id 引用角色），已跳过`); continue; }
    if (charIds.has(id)) { problems.push(`角色 id「${id}」重复，后一个已跳过`); continue; }
    charIds.add(id);
    data.characters.push({ id, name: asString(c.name) || id, look: asString(c.look), ref: asString(c.ref), voice: asString(c.voice) });
    if (!asString(c.look)) problems.push(`角色「${id}」没写外貌（look）—— 每镜现编会让脸一镜一个样`);
  }

  const sceneIds = new Set();
  for (const [si, s] of (Array.isArray(raw.scenes) ? raw.scenes : []).entries()) {
    if (!s || typeof s !== "object") { problems.push(`第 ${si + 1} 场不是对象，已跳过`); continue; }
    const id = asString(s.id).trim();
    if (!id) { problems.push(`第 ${si + 1} 场缺场次号（id），已跳过`); continue; }
    if (sceneIds.has(id)) { problems.push(`场次号「${id}」重复，后一个已跳过`); continue; }
    sceneIds.add(id);
    const shots = [];
    const shotIds = new Set();
    for (const [ji, sh] of (Array.isArray(s.shots) ? s.shots : []).entries()) {
      if (!sh || typeof sh !== "object") { problems.push(`${id} 的第 ${ji + 1} 镜不是对象，已跳过`); continue; }
      const shotId = asString(sh.id).trim();
      if (!shotId) { problems.push(`${id} 的第 ${ji + 1} 镜缺镜头号，已跳过`); continue; }
      if (shotIds.has(shotId)) { problems.push(`镜头号「${shotId}」在同一场内重复，后一个已跳过`); continue; }
      shotIds.add(shotId);
      const cast = asStringArray(sh.cast);
      const unknown = cast.filter((cid) => !charIds.has(cid));
      if (unknown.length) problems.push(`${shotId} 的出场角色 ${unknown.join("、")} 在 characters 里查无此人`);
      shots.push({
        id: shotId,
        cast,
        shot_size: STORYBOARD_SHOT_SIZES.includes(asString(sh.shot_size)) ? asString(sh.shot_size) : asString(sh.shot_size) || "中景",
        prompt: asString(sh.prompt),
        motion: asString(sh.motion),
        line: asString(sh.line),
        speaker: asString(sh.speaker),
        first_frame: asString(sh.first_frame),
        last_frame: asString(sh.last_frame),
        video: asString(sh.video),
        audio: asString(sh.audio),
        duration: Number.isFinite(Number(sh.duration)) ? Number(sh.duration) : undefined,
        note: asString(sh.note),
      });
    }
    if (!shots.length) problems.push(`场次「${id}」一个镜头都没有`);
    data.scenes.push({ id, place: asString(s.place), time: asString(s.time), shots });
  }
  if (Array.isArray(raw.output) || (raw.output && typeof raw.output === "object")) {
    const o = raw.output || {};
    data.output = { video: asString(o.video), cover: asString(o.cover), subtitle: asString(o.subtitle), duration: Number.isFinite(Number(o.duration)) ? Number(o.duration) : undefined, ...(typeof o !== "object" ? {} : {}) };
  }
  if (!data.characters.length) problems.push("表里没有任何角色 —— 镜头卡的「角色」连线会没有落点");
  if (!data.scenes.length) problems.push("表里没有任何场次 —— 展开后画布上会是空的");
  return { data, problems, ok: problems.length === 0 };
}

/** 表里的角色 id → 角色对象（展开时查定妆照与音色用）。 */
export function storyboardCharacterIndex(storyboard) {
  const map = new Map();
  for (const c of storyboard?.characters || []) map.set(c.id, c);
  return map;
}

/**
 * 「展开场次与镜头」：把一张分镜表铺成画布节点计划（**纯函数，不碰画布**）。
 *
 * 每个角色一张角色卡、每场一张场次卡、每镜一张镜头卡；连线表达"这份输入喂给下一步"：
 *   storyboard →(拆分) scene →(输入) shot，角色 →(角色) shot。
 * ⛔ 场次卡的「N 镜」数的是**连出去的镜头卡**，不是负载里抄的一份 —— 所以这里必须真的连线。
 */
export function storyboardBoardPlan(storyboard, boardName, options = {}) {
  const originX = Number.isFinite(Number(options.x)) ? Number(options.x) : 120;
  const originY = Number.isFinite(Number(options.y)) ? Number(options.y) : 100;
  const colGap = Number.isFinite(Number(options.colGap)) ? Number(options.colGap) : 440;
  const rowGap = Number.isFinite(Number(options.rowGap)) ? Number(options.rowGap) : 330;
  const boardId = String(options.boardNodeId || "n-storyboard");
  const chars = storyboardCharacterIndex(storyboard);
  const nodes = [], edges = [];
  const missing = [];
  const usedChars = new Set();

  // 角色卡：竖着排在第二列，场次/镜头从第三列开始
  let charRow = 0;
  for (const c of storyboard?.characters || []) {
    nodes.push({
      id: `n-char-${boardName}-${c.id}`,
      kind: "character",
      payload: { name: c.name || c.id, role: "角色", description: c.look || "", look: c.look || "", ref: c.ref || "", board: boardName, board_character: c.id, voice: c.voice || "" },
      position: { x: originX + colGap, y: originY + charRow * rowGap },
      size: { width: 340, height: 300 },
    });
    charRow++;
  }

  let sceneRow = 0;
  for (const scene of storyboard?.scenes || []) {
    const sceneNodeId = `n-scene-${boardName}-${scene.id}`;
    let shotRow = sceneRow;
    nodes.push({
      id: sceneNodeId,
      kind: "scene",
      payload: { id: scene.id, place: scene.place || "", time: scene.time || "", board: boardName },
      position: { x: originX + colGap * 2, y: originY + sceneRow * rowGap },
      size: { width: 380, height: 250 },
    });
    edges.push({ source: { id: boardId }, target: { id: sceneNodeId }, relation: "split" });
    for (const shot of scene.shots || []) {
      const shotNodeId = `n-shot-${boardName}-${shot.id}`;
      nodes.push({
        id: shotNodeId,
        kind: "shot",
        payload: {
          id: shot.id,
          board: boardName,
          board_scene: scene.id,
          shot_size: shot.shot_size || "中景",
          prompt: shot.prompt || "",
          motion: shot.motion || "",
          line: shot.line || "",
          speaker: shot.speaker || "",
          duration: shot.duration ?? 4,
          first_frame: shot.first_frame || "",
          last_frame: shot.last_frame || "",
          video: shot.video || "",
          audio: shot.audio || "",
          board_character: (shot.cast || []).join(","),
        },
        position: { x: originX + colGap * 3, y: originY + shotRow * rowGap },
        size: { width: 360, height: 265 },
      });
      edges.push({ source: { id: sceneNodeId }, target: { id: shotNodeId }, relation: "input" });
      for (const cid of shot.cast || []) {
        if (!chars.has(cid)) { if (!missing.includes(cid)) missing.push(cid); continue; }
        usedChars.add(cid);
        edges.push({ source: { id: `n-char-${boardName}-${cid}` }, target: { id: shotNodeId }, relation: "character" });
      }
      shotRow++;
    }
    sceneRow = Math.max(shotRow, sceneRow + 1);
  }
  return { nodes, edges, stats: { characters: (storyboard?.characters || []).length, usedCharacters: usedChars.size, scenes: (storyboard?.scenes || []).length, shots: nodes.filter((n) => n.kind === "shot").length, missing } };
}

/* --------------------------------------------------------- 节点 → 分镜表 */

/** 能从画布节点回写进分镜表的字段（白名单：**画布上有的、表里也有的**）。 */
const SHOT_WRITEBACK = ["shot_size", "prompt", "motion", "line", "speaker", "duration", "first_frame", "last_frame", "video", "audio"];

/**
 * 一个镜头节点 → 分镜表的补丁。
 *
 * 三条规矩（都踩过或想清了才敢写）：
 *  ① 镜头号对不上表里的任何一镜 ⇒ 不回（多半是手搓的新镜头，还没进表）；
 *  ② 节点**没有这条字段**就不碰它 —— 实测踩过：只按"取不到当空串"处理时，
 *    一个没带 `speaker` 的镜头卡会把表里的音色抹成空（卡的形状会随版本变，
 *     缺字段是常态，不是"用户清空了"）；
 *  ③ 值是**空的**一律不回写。产物路径是花钱买来的，清空等于抹掉证据；
 *    提示词/景别空了会让这一镜没法重跑。要清空请直接改分镜表 ——
 *    画布上的"空"和"用户想清空"在数据上分不开，宁可少写也不误删。
 */
export function storyboardShotPatch(nodePayload, storyboard) {
  const p = nodePayload || {};
  const shotId = asString(p.id).trim();
  const board = asString(p.board).trim();
  if (!shotId) return { ok: false, reason: "这个镜头没有镜头号，没写回分镜表", patch: null };
  let hit = null;
  for (const scene of storyboard?.scenes || []) {
    for (const shot of scene.shots || []) if (shot.id === shotId) hit = { scene, shot };
  }
  if (!hit) return { ok: false, reason: `分镜表里没有镜头 ${shotId}（先展开或先把它加进表），未写回`, patch: null };
  const changes = {};
  const skipped = [];
  for (const key of SHOT_WRITEBACK) {
    if (!Object.prototype.hasOwnProperty.call(p, key)) continue;   // ② 节点没这条字段
    const raw = p[key];
    if (raw === undefined || raw === null) continue;
    const next = key === "duration" ? Number(raw) : asString(raw);
    if (key === "duration" && !Number.isFinite(next)) continue;
    if (String(next) === String(hit.shot[key] ?? "")) continue;
    if (next === "" || next === 0) { skipped.push(key); continue; }  // ③ 空值不回写
    changes[key] = next;
  }
  if (!Object.keys(changes).length) return { ok: true, reason: "", patch: null, skipped, board };
  return { ok: true, reason: "", patch: { shotId, changes }, skipped, board };
}

/** 把一批补丁写回分镜表，返回**新对象**（不改原对象；调用方负责落盘）。 */
export function storyboardApplyPatches(storyboard, patches) {
  if (!patches || !patches.length) return { data: storyboard, applied: 0 };
  const clone = JSON.parse(JSON.stringify(storyboard || storyboardDefault()));
  let applied = 0;
  for (const { shotId, changes } of patches) {
    for (const scene of clone.scenes || []) {
      for (const shot of scene.shots || []) {
        if (shot.id !== shotId) continue;
        Object.assign(shot, changes);
        applied++;
      }
    }
  }
  return { data: clone, applied };
}

/** 角色节点的定妆照回写：角色卡的图就是表的 `ref`（每一镜的参考图都指它）。 */
export function storyboardCharacterPatch(nodePayload, storyboard) {
  const p = nodePayload || {};
  const cid = asString(p.board_character).trim();
  if (!cid) return { ok: false, reason: "这个角色卡没有关联分镜表里的角色 id，未写回", patch: null };
  const hit = (storyboard?.characters || []).find((c) => c.id === cid);
  if (!hit) return { ok: false, reason: `分镜表里没有角色 ${cid}，未写回`, patch: null };
  const changes = {};
  const ref = asString(p.ref);
  if (ref && ref !== hit.ref) changes.ref = ref;
  const look = asString(p.look);
  if (look && look !== hit.look) changes.look = look;
  if (!Object.keys(changes).length) return { ok: true, reason: "", patch: null };
  return { ok: true, reason: "", patch: { characterId: cid, changes }, id: cid };
}

export function storyboardApplyCharacterPatch(storyboard, patch) {
  if (!patch) return { data: storyboard, applied: 0 };
  const clone = JSON.parse(JSON.stringify(storyboard || storyboardDefault()));
  let applied = 0;
  for (const c of clone.characters || []) if (c.id === patch.characterId) { Object.assign(c, patch.changes); applied++; }
  return { data: clone, applied };
}

/**
 * 估算总时长（秒）。配音时长回来之前用每镜 duration 兜底 —— 界面上要有个数看。
 */
export function storyboardDuration(storyboard) {
  let total = 0;
  for (const scene of storyboard?.scenes || []) for (const shot of scene.shots || []) total += Number(shot.duration) || 0;
  return Math.round(total * 10) / 10;
}
