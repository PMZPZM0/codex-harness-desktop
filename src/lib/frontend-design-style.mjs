/**
 * 前端设计风格库（11-03 用户：「设置-个性化里面加个，前端设计风格的设置&自定义内容」
 * → 「可以内置几套设计风格提示词，比如科技风格，苹果风格等等，跟那种组件库，陪同工具更新」）。
 *
 * 主进程写入 AGENTS.md（引擎每请求读取），渲染层画设置页与提示词预览 —— 两侧必须同一份预设，
 * 否则界面选中的 id 主进程不认识 ⇒ 静默回落成「跟随项目」（改了没生效）。
 *
 * ⛔ 这是**方向**，不是具体 token：项目里有 DESIGN.md / CSS 变量时，风格要靠那些 token 表达，
 *    不允许另起一套写死色值。具体值永远以项目为准。
 * ⛔ 新增风格只改这一份表：主进程、设置页、提示词预览、守卫全部从它派生（随应用更新一起发）。
 */

export const FRONTEND_DESIGN_STYLES = [
  {
    id: "auto",
    label: "跟随项目",
    desc: "不额外指定视觉方向，只按项目 DESIGN.md 与现有组件落地",
    prompt: "",
    swatches: ["#f5f5f2", "#d9d9d4", "#2f6bdd"],
  },
  {
    id: "minimal",
    label: "极简",
    desc: "中性表面、细边框、单一主色、留白充足",
    prompt:
      "Visual direction — minimal: content first. Neutral surfaces, hairline 1px borders, one accent color, generous whitespace, few shadows. No decorative gradients or oversized cards; density compact but never cramped.",
    swatches: ["#ffffff", "#e7e7e4", "#23231f", "#2f6bdd"],
  },
  {
    id: "apple",
    label: "苹果风",
    desc: "清晰、克制、层次；大留白、半透明材质、轻阴影",
    prompt:
      "Visual direction — Apple HIG-inspired: clarity, deference and depth. Use an 8pt spacing grid, SF-like humanist typography, generous whitespace, 10–14px radii, translucent bars/materials with backdrop blur, one restrained system-blue accent, subtle shadows, and spring-like 200–300ms motion. Let content lead; chrome recedes.",
    swatches: ["#f5f5f7", "#ffffff", "#007aff", "#1d1d1f"],
  },
  {
    id: "tech",
    label: "科技风",
    desc: "深色高科技感；青色光效、网格与 HUD、等宽数据",
    prompt:
      "Visual direction — tech: dark-first deep navy/graphite surfaces, cyan/electric-blue accents, fine grid lines and HUD-like status, monospace for numbers and IDs, 2–4px radii, controlled glow gradients. High contrast data, clear hierarchy; do not stack glow everywhere.",
    swatches: ["#0b1020", "#111a2e", "#22d3ee", "#6366f1"],
  },
  {
    id: "premium",
    label: "高级",
    desc: "分层深色、香槟金/玉色点缀、玻璃与柔和景深",
    prompt:
      "Visual direction — premium: refined and calm. Layered surfaces, restrained metallic/teal accents, subtle glass and soft depth, precise 1px edges, high-quality type hierarchy. Avoid loud colors, thick shadows and gimmicks.",
    swatches: ["#0b0d10", "#12151a", "#c9a86a", "#57b98a"],
  },
  {
    id: "warm",
    label: "温暖",
    desc: "暖中性色、较大圆角、亲和文案与舒适间距",
    prompt:
      "Visual direction — warm: approachable and human. Warm neutral palette, soft 10–14px radii, friendly concise copy, comfortable spacing, gentle accent. Avoid cold grays and sharp corners.",
    swatches: ["#fdf8f3", "#f3e7da", "#e8830c", "#8a5a44"],
  },
  {
    id: "swiss",
    label: "瑞士网格",
    desc: "严格网格、高对比、左对齐、单一红点；无装饰",
    prompt:
      "Visual direction — Swiss/International: strict grid, left-aligned Helvetica-like type with tight tracking, high contrast black/white, one red accent, generous asymmetric whitespace, zero gradients/shadows. Data and typography carry the design.",
    swatches: ["#ffffff", "#111111", "#e30613", "#9b9b95"],
  },
  {
    id: "glass",
    label: "玻璃拟态",
    desc: "半透明玻璃层、背景模糊、细亮边、柔和渐变",
    prompt:
      "Visual direction — glassmorphism: layered translucent surfaces with backdrop blur, 1px light borders, soft gradients behind, 14–18px radii. Keep text contrast readable with a solid fallback; limit the number of blurred layers for performance.",
    swatches: ["#e8f0ff", "#ffffff", "#7cabf8", "#b79cff"],
  },
  {
    id: "material",
    label: "Material 3",
    desc: "色调表面、动态主色、较大圆角与状态层",
    prompt:
      "Visual direction — Material 3: tonal surfaces derived from one seed color, 12–28px radii, elevation expressed by surface tint rather than heavy shadows, clear state layers (hover/focus/pressed), expressive type scale, 200–300ms standard easing.",
    swatches: ["#fef7ff", "#eaddff", "#6750a4", "#386a20"],
  },
];

export const DEFAULT_FRONTEND_DESIGN_STYLE = "auto";

export function normalizeFrontendDesignStyle(value) {
  const id = String(value ?? "").trim();
  return FRONTEND_DESIGN_STYLES.some((style) => style.id === id) ? id : DEFAULT_FRONTEND_DESIGN_STYLE;
}

const COMPONENT_LIBRARY_HINT =
  "Before hand-writing controls, search the built-in Uiverse component library (`ui_component_search` / `ui_component_get`) for suitable buttons, cards, inputs, forms, navigation, toggles, notifications and loaders; adapt the fetched HTML/CSS to the project's tokens and this visual direction. Do not paste a component unchanged if it fights the direction, and do not create a second style system.";

/** 生成写进 AGENTS.md 的前端设计段；空字符串 = 不注入（跟随项目且没有自定义内容）。 */
export function frontendDesignPrompt(style, notes) {
  const id = normalizeFrontendDesignStyle(style);
  const preset = FRONTEND_DESIGN_STYLES.find((item) => item.id === id);
  const custom = String(notes ?? "").trim();
  const parts = [];
  if (preset?.prompt) parts.push(preset.prompt);
  if (custom) {
    parts.push(
      "User frontend design notes (apply to every UI; when the project defines design tokens, express these through those tokens — do not hard-code a second palette):\n"
      + custom,
    );
  }
  if (!parts.length) return "";
  return (
    "When the project defines DESIGN.md / CSS tokens, express this direction through those tokens; do not replace the app's established brand unless the user asks.\n\n"
    + [COMPONENT_LIBRARY_HINT, ...parts].join("\n\n")
  );
}
