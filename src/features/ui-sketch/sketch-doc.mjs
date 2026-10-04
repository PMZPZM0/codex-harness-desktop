/**
 * 界面草图（`ui-sketch` 域）· 纯函数层
 *
 * 这里只放**能在 node 里直接跑真值表**的判定（守卫【283】真跑它，不靠字符串比对）：
 * 文档摘要、把组件库条目追加进草图、以及给 Codex 的提示词合成。
 *
 * ⛔ 文档形状必须过得上上游的校验（m3e-canvas 的 `lib/project.ts` 的 isProject）：
 *   item 必需 `id / kind / label / icon / variant`，group 必需 `id / x / y / axis / items(≥1)`，
 *   frame 必需 `id / name / x / y`。校验不过 ⇒ 它整份文档拒绝并弹「项目无效」，
 *   用户看到的就不是"我的草图没了"而是"我的草图打不开"，所以这里宁可不写也不写错形状。
 *   `note` 是上游**明确给外部工具用的字段**（agent.md：「goes into the prompt verbatim」）
 *   ⇒ 组件库的引用锚在这里，不新造字段、不改它的 schema。
 */

export const SKETCH_ORIGIN = "sketch://app";
export const SKETCH_ENTRY_URL = `${SKETCH_ORIGIN}/index.html`;
export const SKETCH_BRIDGE_SOURCE = "codex-harness-sketch";

/** 上游文档里存放当前草图的 localStorage 键（读回时用它）。 */
export const SKETCH_DOC_KEY = "m3e:doc";

/** 组件库类目 → 上游 kind。表覆盖我们全部 11 个类目（UI_SKIN_CATS），落不中就 box。
 *  ⛔ 只在 kind 表里的才敢写：上游 isProject 认的是 KIND_ORDER 全集，写了不认识的 kind
 *     整份文档会被拒。chip/card/button/searchBar/box 都在表内。 */
export const SKETCH_KIND_BY_CAT = {
  Buttons: "button",
  Cards: "card",
  Checkboxes: "chip",
  "Radio-buttons": "chip",
  "Toggle-switches": "chip",
  Inputs: "searchBar",
  Forms: "card",
  Notifications: "card",
  Tooltips: "box",
  Patterns: "box",
  loaders: "box",
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** 上游的最低要求：有 groups/frames 两个数组就能开。其余一律当"没有草图"。 */
export function isSketchDoc(value) {
  return isObject(value) && Array.isArray(value.groups) && Array.isArray(value.frames);
}

export function summarizeDoc(doc) {
  if (!isSketchDoc(doc)) return { valid: false, title: "", frames: 0, groups: 0, items: 0 };
  return {
    valid: true,
    title: typeof doc.title === "string" ? doc.title : "",
    frames: doc.frames.length,
    groups: doc.groups.length,
    items: doc.groups.reduce((sum, group) => sum + (Array.isArray(group.items) ? group.items.length : 0), 0),
  };
}

/** `#doc=` 通道：与上游 lib/share.ts 的明文形态逐字一致。
 *  ⛔ 必须 encodeURIComponent：JSON 里的 `&` 会被 URLSearchParams 当分隔符、`+` 会变成空格
 *     （颜色值 `#6750A4` 里的 `#` 反倒无害）。漏一步就是"推上去的是半份文档"。 */
export function encodeShareHash(doc) {
  return `#doc=${encodeURIComponent(JSON.stringify(doc))}`;
}

/** 组件锚点：写在 item.note 里，上游会原样带进它自己导出的提示词。
 *  带 id 就够引擎用 `ui_component_get` 取回真实 HTML/CSS —— ⛔ 不在这里复制组件源码，
 *  组件库数据全仓只有一份（src/lib/ui-skin，守卫【235】钉着）。 */
export function componentNote(entry) {
  return `内置组件库 #${entry.id}（${entry.cat} / ${entry.name}，作者 ${entry.author}）：用 MCP 工具 ui_component_get("${entry.id}") 取回 HTML+CSS 原样实现这个控件，不要另造样式。`;
}

const itemIdOf = (entry) => `nh-${entry.id}`;

/** 已经有的组件条目 id 集合（用于幂等：连点两次「送进草图」不该堆两份）。 */
function existingItemIds(doc) {
  const ids = new Set();
  for (const group of doc.groups ?? []) for (const item of group.items ?? []) if (item && typeof item.id === "string") ids.add(item.id);
  return ids;
}

/** 新块落在所有内容右边再往下错开一层：不覆盖用户已经摆好的东西，也不会跑到看不见的地方。 */
export function pickSpot(doc) {
  let x = 0;
  let y = 0;
  for (const group of doc.groups ?? []) {
    if (Number.isFinite(group.x)) x = Math.max(x, group.x + 340);
    if (Number.isFinite(group.y)) y = Math.max(y, group.y + 76);
  }
  for (const frame of doc.frames ?? []) {
    if (Number.isFinite(frame.x)) x = Math.max(x, frame.x + 412);
    if (Number.isFinite(frame.y)) y = Math.max(y, frame.y + 892);
  }
  return { x, y };
}

/**
 * 把选中的组件库条目追加成**一个新 group**（axis:"y" ⇒ 一列，视觉上就是"这批是同一组素材"）。
 * 返回 `{ doc, added, skipped }`：added 是本次真正新增的条目，skipped 是文档里已经有的。
 * ⛔ 不改用户已有的 group；空输入原样返回。
 */
export function appendComponents(doc, entries) {
  if (!isSketchDoc(doc)) return { doc: null, added: [], skipped: [] };
  if (!entries?.length) return { doc, added: [], skipped: [] };
  const had = existingItemIds(doc);
  const fresh = entries.filter((entry) => entry && typeof entry.id === "string" && !had.has(itemIdOf(entry)));
  const skipped = entries.filter((entry) => entry && typeof entry.id === "string" && had.has(itemIdOf(entry)));
  if (!fresh.length) return { doc, added: [], skipped };
  const spot = pickSpot(doc);
  const group = {
    id: `nh-g${Date.now().toString(36)}`,
    x: spot.x,
    y: spot.y,
    axis: "y",
    items: fresh.map((entry) => ({
      id: itemIdOf(entry),
      kind: SKETCH_KIND_BY_CAT[entry.cat] ?? "box",
      label: entry.name,
      icon: null,
      variant: "filled",
      note: componentNote(entry),
    })),
  };
  return { doc: { ...doc, groups: [...doc.groups, group] }, added: fresh, skipped };
}

/** 屏与其中部件的骨架清单。坐标挂在 **group** 上（上游把 items 排成组），
 *  所以"这个组属哪个屏"按组的 x 落进哪一屏的 x 区间判定（屏宽缺省按手机 412）。 */
function outlineFrames(doc) {
  const lines = [];
  for (const frame of doc.frames ?? []) {
    const left = frame.x ?? 0;
    const right = left + (frame.w ?? 412);
    const parts = [];
    for (const group of doc.groups ?? []) {
      if (!Number.isFinite(group.x) || group.x < left || group.x >= right) continue;
      for (const item of group.items ?? []) {
        parts.push(`    · ${item.kind}「${item.label || item.icon || ""}」${item.note ? ` —— ${item.note}` : ""}`);
      }
    }
    lines.push(`- 屏「${frame.name}」${frame.note ? `：${frame.note}` : ""}`, ...parts);
  }
  return lines.join("\n");
}

/** 把桥带出来的诊断翻译成一句人话（跨源 iframe 里发生的事，宿主只能靠这几个布尔值判断）。 */
export function describeDiag(diag) {
  if (!diag) return "无诊断（桥没有回传状态）";
  if (diag.unavailable) return `诊断不可用：${diag.unavailable}`;
  const bits = [];
  if (diag.errors && diag.errors.length) bits.push(`脚本报错：${diag.errors[0]}`);
  if (!diag.root) bits.push(diag.boot ? "编辑器还没挂载（停在骨架屏）" : "编辑器没挂载");
  if (!diag.locks) bits.push("环境没有 Web Locks（草图会失去单写者保护）");
  if (diag.root && !diag.keys) bits.push("编辑器在跑但一次都没写存储");
  return bits.length ? bits.join("；") : "状态正常，稍等或点「取回画布」";
}

export const PROMPT_HTML_BUDGET = 12000;

/**
 * 合成给 Codex 的任务正文：草图结构 + 选中的组件真实 HTML/CSS（超预算则改成让引擎自己取）。
 * 返回 `{ text, inlined, referenced }` —— inlined 是带源码的条目数，referenced 是只给 id 的条目数。
 */
export function buildComponentPrompt(doc, entries) {
  const summary = summarizeDoc(doc);
  const picked = (entries ?? []).filter((entry) => entry && typeof entry.id === "string");
  const head = [
    `请按「界面草图」实现前端（${summary.valid ? `草图「${summary.title}」：${summary.frames} 个屏 / ${summary.groups} 组 / ${summary.items} 个部件` : "没有有效草图，只用下面的组件"}）。`,
  ];
  const outline = summary.valid ? outlineFrames(doc) : "";
  if (outline) head.push("", "画布上的结构（坐标即布局，注意屏与屏之间的导航）：", outline);

  let used = 0;
  const inlined = [];
  const referenced = [];
  for (const entry of picked) {
    const block = `### 组件 #${entry.id} · ${entry.name}（${entry.cat}，作者 ${entry.author}）\n\`\`\`html\n${entry.html ?? ""}\n\`\`\``;
    if (used + block.length <= PROMPT_HTML_BUDGET && inlined.length < 8) {
      used += block.length;
      inlined.push(block);
    } else {
      referenced.push(entry);
    }
  }
  if (inlined.length) head.push("", `以下 ${inlined.length} 个控件请**原样使用**它们的 HTML 与 CSS（这是内置组件库里的成品，别再手写一遍样式）：`, inlined.join("\n\n"));
  if (referenced.length) {
    head.push("", `另外 ${referenced.length} 个控件源码太长没inline，请用 MCP 工具 ui_component_get("<id>") 逐个取回后原样使用：`);
    head.push(referenced.map((entry) => `- #${entry.id} ${entry.name}（${entry.cat}）`).join("\n"));
  }
  head.push("", "实现要求：布局按草图坐标，控件样式按组件库原文；缺的间距/颜色用现网令牌，不要引入新的样式体系。");
  return { text: head.filter(Boolean).join("\n"), inlined: inlined.length, referenced: referenced.length };
}
