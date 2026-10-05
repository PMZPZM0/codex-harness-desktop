/**
 * 界面草图（`ui-sketch` 域）· 纯函数层
 *
 * 只放**能在 node 里直接跑真值表**的判定（守卫【283】真跑它，不靠字符串比对）：
 * 文档形状判定、摘要、桥的诊断翻译、以及给 Codex 的任务正文合成。
 *
 * ⛔ 这一层**只读**草图：宿主不往画布写文档。上游自己有完整的导入通道
 *   （`#doc=` / `#docz=` 分享哈希 → hashchange → arrive()，可一键撤销），
 *   要导入设计走它自己的入口就够，不另造第二条。
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
