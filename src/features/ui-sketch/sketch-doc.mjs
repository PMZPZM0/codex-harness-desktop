/**
 * 界面草图（`ui-sketch` 域）· 纯函数层
 *
 * 只放**能在 node 里直接跑真值表**的判定（守卫【283】真跑它，不靠字符串比对）：
 * 文档形状判定、写回前置校验、摘要、桥的诊断翻译、以及给 Codex 的任务正文合成。
 *
 * ⛔ 写回**只有一条通道**：走上游自己的导入（分享哈希 `#docz=` → hashchange → arrive()）。
 *   宿主**从不直接写 `m3e:doc`**（那是画布的私产，绕过它 = 绕过它的校验与撤销）——
 *   桥把文档编码成分享哈希挂到 location.hash 上，剩下的交给上游自己。
 *   ⛔ 别在这里再长出第二条写路径（导入走它的入口就够）。
 *   （10-05 曾接过一版"组件库送进草图"，用户看完实测判了「跟左边那些不适配，加进来没啥用」⇒ 删。）
 *
 * 文档形状由上游定义（m3e-canvas 的 lib/tokens.ts + lib/project.ts 的 isProject）：
 * frame 必需 `id / name / x / y`，group 必需 `id / x / y / axis / items(≥1)`，
 * item 必需 `id / kind / label / icon / variant`，`note` 会**原样进它导出的提示词**。
 */

export const SKETCH_ORIGIN = "sketch://app";
export const SKETCH_ENTRY_URL = `${SKETCH_ORIGIN}/index.html`;
export const SKETCH_BRIDGE_SOURCE = "codex-harness-sketch";

/** 上游存放当前画布的 localStorage 键（桥在草图那一侧用它；两边必须同值，守卫【283】对账）。 */
export const SKETCH_DOC_KEY = "m3e:doc";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** 上游的最低要求：有 groups/frames 两个数组就能开。其余一律当"没有草图"。 */
export function isSketchDoc(value) {
  return isObject(value) && Array.isArray(value.groups) && Array.isArray(value.frames);
}

/* ── 写回前置校验 ────────────────────────────────────────────────────────────
 * 这套枚举与判定**逐项抄自上游的导入校验**（bundle 里 `fL`/`fz`/`fE`/`fT` 四个判别式 +
 * `lp`/`sZ` 两张表），守卫【283】拿 bundle 原文对账，漂移即红。
 * 为什么要抄：写回走的是「分享哈希 → 上游 arrive()」这条路，文档不合规时上游**静默拒收**
 * （哈希改了、画布没动）—— 模型拿不到任何可读反馈。这里先判一遍，把"哪里不合规"用
 * 中文错误原文回给模型，它才能自己改对再试。
 * ⛔ 判定口径与上游**逐字对齐**（松了 = 坏文档到桥上才炸；严了 = 拦上游本来收的文档）。 */

/** 36 种 item kind（= 上游 `lp`）。 */
export const SKETCH_ITEM_KINDS = ["button", "iconButton", "fab", "extendedFab", "splitButton", "fabMenu", "chip", "topAppBar", "bottomNav", "navRail", "toolbar", "tabs", "searchBar", "card", "listItem", "box", "bottomSheet", "dialog", "snackbar", "textField", "select", "switch", "checkbox", "radio", "slider", "datePicker", "timePicker", "text", "image", "carousel", "camera", "map", "divider", "loadingIndicator", "linearProgress", "circularProgress"];

/** 5 种 variant（= 上游 `sZ`）——item.variant 是**必填**且必须在表内。 */
export const SKETCH_ITEM_VARIANTS = ["filled", "tonal", "elevated", "outlined", "text"];

const SKETCH_KIND_SET = new Set(SKETCH_ITEM_KINDS);
const SKETCH_VARIANT_SET = new Set(SKETCH_ITEM_VARIANTS);

/** 前置校验：通过 = `{ ok: true }`；不通过 = `{ ok: false, reason }`（reason 直接可回给模型）。 */
export function validateSketchDoc(doc) {
  if (!isSketchDoc(doc)) return { ok: false, reason: "不是一个草图文档：需要 frames / groups 两个数组" };
  if (!doc.frames.length) return { ok: false, reason: "文档里一个屏（frames）都没有" };
  if (!doc.groups.length) return { ok: false, reason: "文档里一个部件组（groups）都没有" };
  if (doc.platform !== undefined && doc.platform !== "android" && doc.platform !== "web") {
    return { ok: false, reason: `platform 只认 "android" 或 "web"（收到「${String(doc.platform)}」）` };
  }
  for (const [index, frame] of doc.frames.entries()) {
    if (!isObject(frame) || typeof frame.id !== "string" || typeof frame.name !== "string" || !Number.isFinite(frame.x) || !Number.isFinite(frame.y)) {
      return { ok: false, reason: `第 ${index + 1} 个屏（frames[${index}]）缺 id / name / x / y —— 这四样是上游的硬要求，x、y 必须是数字` };
    }
  }
  for (const [index, group] of doc.groups.entries()) {
    if (!isObject(group) || typeof group.id !== "string" || !Number.isFinite(group.x) || !Number.isFinite(group.y) || (group.axis !== "x" && group.axis !== "y")) {
      return { ok: false, reason: `第 ${index + 1} 个部件组缺 id / x / y / axis（axis 只认 "x" 或 "y"）` };
    }
    if (!Array.isArray(group.items) || !group.items.length) {
      return { ok: false, reason: `部件组「${group.id}」的 items 是空的 —— 上游要求每组至少一个部件（空组直接删掉）` };
    }
    for (const [slot, item] of group.items.entries()) {
      const at = `部件组「${group.id}」第 ${slot + 1} 个部件`;
      if (!isObject(item) || typeof item.id !== "string" || typeof item.label !== "string" || !(typeof item.icon === "string" || item.icon === null)) {
        return { ok: false, reason: `${at}缺 id / label / icon —— label 允许空串，icon 允许 null，但四样（含 id）都必须真的写出来` };
      }
      if (!SKETCH_KIND_SET.has(item.kind)) {
        return { ok: false, reason: `${at}的 kind「${String(item.kind)}」不在上游可识别的 ${SKETCH_ITEM_KINDS.length} 种内（常用：topAppBar / bottomNav / card / listItem / button / fab）` };
      }
      if (!SKETCH_VARIANT_SET.has(item.variant)) {
        return { ok: false, reason: `${at}的 variant「${String(item.variant)}」不合法 —— 只认 ${SKETCH_ITEM_VARIANTS.join(" / ")}（别省略）` };
      }
    }
  }
  return { ok: true };
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

/** 把桥带出来的诊断翻译成一句人话（跨源 iframe 里发生的事，宿主只能靠这几个布尔值判断）。 */
export function describeDiag(diag) {
  if (!diag) return "无诊断（桥没有回传状态）";
  if (diag.unavailable) return `诊断不可用：${diag.unavailable}`;
  const bits = [];
  if (diag.errors && diag.errors.length) bits.push(`脚本报错：${diag.errors[0]}`);
  if (!diag.root) bits.push(diag.boot ? "编辑器还没挂载（停在骨架屏）" : "编辑器没挂载");
  if (!diag.locks) bits.push("环境没有 Web Locks（草图会失去单写者保护）");
  if (diag.root && !diag.keys) bits.push("编辑器在跑但一次都没写存储");
  return bits.length ? bits.join("；") : "状态正常，点「取回画布」刷新一下";
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
        const label = item.label || item.icon || "";
        const jump = item.action && item.action.to ? ` → 跳到「${item.action.to}」` : "";
        parts.push(`    · ${item.kind}「${label}」${jump}${item.note ? ` —— ${item.note}` : ""}`);
      }
    }
    lines.push(`- 屏「${frame.name}」${frame.note ? `：${frame.note}` : ""}`, ...parts);
  }
  return lines.join("\n");
}

/**
 * 合成给 Codex 的任务正文：把画布上的屏、部件与导航关系写成一份可实现的规格。
 * 返回 `{ text, frames, items }`；`text` 为空表示没什么可发的（调用方据此拦住空任务）。
 */
export function buildSketchPrompt(doc) {
  const summary = summarizeDoc(doc);
  if (!summary.valid || summary.items === 0) return { text: "", frames: 0, items: 0 };
  const outline = outlineFrames(doc);
  const head = [
    `请按「界面草图」实现前端（草图「${summary.title || "未命名"}」：${summary.frames} 个屏 / ${summary.groups} 组 / ${summary.items} 个部件）。`,
    "",
    "画布上的结构与导航（坐标即布局，屏宽 412、桌面屏 1280×800）：",
    outline,
    "",
    "实现要求：布局与导航按草图，屏与屏之间用草图标的跳转；样式用现网令牌，不要引入新的样式体系；",
    "草图只是占位，具体文案与间距按内容合理收口，空状态与失败态要补上。",
  ];
  return { text: head.filter((line) => line !== undefined).join("\n"), frames: summary.frames, items: summary.items };
}
