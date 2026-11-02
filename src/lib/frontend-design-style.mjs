/**
 * 前端设计风格库（11-03 用户：「设置-个性化里面加个，前端设计风格的设置&自定义内容」
 * → 「可以内置几套设计风格提示词，比如科技风格，苹果风格等等，跟那种组件库，陪同工具更新」
 * → 「每个风格对应一套设计文档和参考素材和地址，这样才能做到专业化设计前端」）。
 *
 * 每套风格 = 短方向 prompt + 设计规范 spec + 参考文档 refs + 参考素材 materials。
 * 主进程写入 AGENTS.md（引擎每请求读取），渲染层画设置页与文档/链接 —— 两侧必须同一份预设，
 * 否则界面选中的 id 主进程不认识 ⇒ 静默回落成「跟随项目」（改了没生效）。
 *
 * ⛔ 这是**方向与规范**，不是具体 token：项目里有 DESIGN.md / CSS 变量时，风格要靠那些 token 表达，
 *    不允许另起一套写死色值。具体值永远以项目为准。
 * ⛔ 新增风格只改这一份表：主进程、设置页、提示词预览、守卫全部从它派生（随应用更新一起发）。
 */

const MATERIALS = {
  antResources: { name: "Ant Design 设计资源", url: "https://ant.design/docs/resources-cn" },
  tdesignResources: { name: "TDesign 设计资源", url: "https://tdesign.tencent.com/design/design-resources" },
  arcoMaterial: { name: "Arco Design 物料", url: "https://arco.design/material" },
  elementResources: { name: "Element Plus 资源", url: "https://element-plus.org/zh-CN/resource/index.html" },
  vantDesign: { name: "Vant 设计资源", url: "https://vant-ui.github.io/vant/#/zh-CN/design" },
  zcool: { name: "站酷（国内设计灵感）", url: "https://www.zcool.com.cn/" },
  uiChina: { name: "UI 中国", url: "https://www.ui.cn/" },
  huaban: { name: "花瓣（采集与灵感）", url: "https://huaban.com/" },
  mobbin: { name: "Mobbin（真实产品截图）", url: "https://mobbin.com/" },
  glassmorphism: { name: "Glassmorphism 参考", url: "https://glassmorphism.com/" },
  appleResources: { name: "Apple Design Resources", url: "https://developer.apple.com/design/resources/" },
  materialResources: { name: "Material 3 资源", url: "https://m3.material.io/resources" },
};

const COMPONENT_LIBRARY_HINT =
  "Before hand-writing controls, search the built-in Uiverse component library (`ui_component_search` / `ui_component_get`) for suitable buttons, cards, inputs, forms, navigation, toggles, notifications and loaders; adapt the fetched HTML/CSS to the project's tokens and this visual direction. Do not paste a component unchanged if it fights the direction, and do not create a second style system.";

export const FRONTEND_DESIGN_STYLES = [
  {
    id: "auto",
    label: "跟随项目",
    desc: "不额外指定视觉方向，只按项目 DESIGN.md 与现有组件落地",
    prompt: "",
    spec:
      "设计规范（跟随项目）\n"
      + "- 先读项目 DESIGN.md / CSS 变量 / 相邻页面，按已有 token、组件和交互习惯落地。\n"
      + "- 项目没有规范时，按内置「前端设计方法」的十条硬规则执行。\n"
      + "- 不引入第二套主色、字体或组件体系；新增值必须回到项目 token。",
    swatches: ["#f5f5f2", "#d9d9d4", "#2f6bdd"],
    refs: [],
    materials: [],
  },
  {
    id: "minimal",
    label: "极简",
    desc: "中性表面、细边框、单一主色、留白充足",
    prompt:
      "Visual direction — minimal: content first. Neutral surfaces, hairline 1px borders, one accent color, generous whitespace, few shadows. No decorative gradients or oversized cards; density compact but never cramped.",
    spec:
      "设计规范（极简）\n"
      + "- 色彩：中性底分 surface / background 两级；文字只用 text / muted / faint；主色只用于主操作与选中；语义色只表意。\n"
      + "- 字体：系统无衬线；正文 13–14px，说明 11–12px，标题 15–18px；字重 400/500/600，不用细体。\n"
      + "- 布局：4/8 间距节奏；内容单列为主；卡片间距 12–16px；避免满屏边框。\n"
      + "- 表面：1px 细边框 + 白/浅灰底；圆角 8–10px；阴影只给浮层。\n"
      + "- 组件：按钮主次分明；输入框 36–40px 高；表格行高 36px；列表行 hover 用 panel-2。\n"
      + "- 动效：120–180ms ease-out；只做透明度、颜色、轻微位移。\n"
      + "- 禁止：装饰渐变、彩色大底、重阴影、过多分割线。",
    swatches: ["#ffffff", "#e7e7e4", "#23231f", "#2f6bdd"],
    refs: [
      { name: "Ant Design 设计规范", url: "https://ant.design/docs/spec/introduce-cn" },
      { name: "Semi Design", url: "https://semi.design/zh-CN/" },
    ],
    materials: [MATERIALS.antResources, MATERIALS.tdesignResources, MATERIALS.zcool],
  },
  {
    id: "apple",
    label: "苹果风",
    desc: "清晰、克制、层次；大留白、半透明材质、轻阴影",
    prompt:
      "Visual direction — Apple HIG-inspired: clarity, deference and depth. Use an 8pt spacing grid, SF-like humanist typography, generous whitespace, 10–14px radii, translucent bars/materials with backdrop blur, one restrained system-blue accent, subtle shadows, and spring-like 200–300ms motion. Let content lead; chrome recedes.",
    spec:
      "设计规范（苹果风）\n"
      + "- 色彩：系统蓝作唯一强调色；背景白/浅灰分层；文字黑/次级灰；半透明材质用于导航与浮层。\n"
      + "- 字体：SF 风格人文无衬线；大标题 22–28px，正文 14–15px，说明 12px；字距略紧。\n"
      + "- 布局：8pt 网格；大留白；内容分组用间距而不是框线；触控区 44px。\n"
      + "- 表面：10–14px 圆角；毛玻璃 backdrop blur；1px 高光边；阴影轻而柔。\n"
      + "- 组件：胶囊按钮、分段控件、开关、列表行（尾部 chevron）；导航栏半透明。\n"
      + "- 动效：200–300ms spring/ease；页面转场与按压反馈；尊重减动效。\n"
      + "- 禁止：厚重阴影、密集边框、过多品牌色、桌面端照搬移动端导航。",
    swatches: ["#f5f5f7", "#ffffff", "#007aff", "#1d1d1f"],
    refs: [
      { name: "Apple Human Interface Guidelines", url: "https://developer.apple.com/design/human-interface-guidelines/" },
    ],
    materials: [MATERIALS.appleResources, MATERIALS.mobbin, MATERIALS.uiChina],
  },
  {
    id: "tech",
    label: "科技风",
    desc: "深色高科技感；青色光效、网格与 HUD、等宽数据",
    prompt:
      "Visual direction — tech: dark-first deep navy/graphite surfaces, cyan/electric-blue accents, fine grid lines and HUD-like status, monospace for numbers and IDs, 2–4px radii, controlled glow gradients. High contrast data, clear hierarchy; do not stack glow everywhere.",
    spec:
      "设计规范（科技风）\n"
      + "- 色彩：深海军蓝/石墨黑分层；青色/电光蓝作强调；成功/警告/错误高对比但克制。\n"
      + "- 字体：无衬线正文 + 等宽数字/ID/日志；标题可略宽字距；11–12px 只用于标签。\n"
      + "- 布局：12 列网格；数据密集区行高 32–36px；面板之间用 1px 网格线。\n"
      + "- 表面：2–4px 小圆角；深色面板 + 细亮边；网格/扫描线/HUD 只做背景装饰。\n"
      + "- 组件：数据卡、状态灯、进度条、命令面板；hover 用青色描边或微光。\n"
      + "- 动效：150–250ms；扫描/脉冲只用于运行中；禁止整屏霓虹闪烁。\n"
      + "- 禁止：满屏发光、彩虹渐变、过度科幻装饰影响可读性。",
    swatches: ["#0b1020", "#111a2e", "#22d3ee", "#6366f1"],
    refs: [
      { name: "Arco Design", url: "https://arco.design/react/docs/start" },
      { name: "TDesign 设计价值观", url: "https://tdesign.tencent.com/design/values" },
    ],
    materials: [MATERIALS.arcoMaterial, MATERIALS.tdesignResources, MATERIALS.mobbin],
  },
  {
    id: "premium",
    label: "高级",
    desc: "分层深色、香槟金/玉色点缀、玻璃与柔和景深",
    prompt:
      "Visual direction — premium: refined and calm. Layered surfaces, restrained metallic/teal accents, subtle glass and soft depth, precise 1px edges, high-quality type hierarchy. Avoid loud colors, thick shadows and gimmicks.",
    spec:
      "设计规范（高级）\n"
      + "- 色彩：近黑/深灰分层；香槟金或玉青作点缀，只用于选中/强调；正文高对比。\n"
      + "- 字体：高品质无衬线；标题 20–28px，正文 14px，说明 12px；字重对比明确。\n"
      + "- 布局：宽松留白；卡片内部分区清晰；重要信息靠位置与字号，不靠颜色。\n"
      + "- 表面：12–16px 圆角；1px 细边；玻璃/柔光景深；阴影少而深。\n"
      + "- 组件：精选卡片、分段控件、细线表格、克制徽标；图标线性统一。\n"
      + "- 动效：200–300ms 缓动；只做淡入/轻微上浮；禁止弹跳。\n"
      + "- 禁止：大面积金色、重渐变、过多装饰线。",
    swatches: ["#0b0d10", "#12151a", "#c9a86a", "#57b98a"],
    refs: [
      { name: "TDesign 设计价值观", url: "https://tdesign.tencent.com/design/values" },
      { name: "Semi Design", url: "https://semi.design/zh-CN/" },
    ],
    materials: [MATERIALS.tdesignResources, MATERIALS.zcool, MATERIALS.mobbin],
  },
  {
    id: "warm",
    label: "温暖",
    desc: "暖中性色、较大圆角、亲和文案与舒适间距",
    prompt:
      "Visual direction — warm: approachable and human. Warm neutral palette, soft 10–14px radii, friendly concise copy, comfortable spacing, gentle accent. Avoid cold grays and sharp corners.",
    spec:
      "设计规范（温暖）\n"
      + "- 色彩：暖白/米色底；暖灰文字；橙/珊瑚作强调；语义色柔和。\n"
      + "- 字体：圆润友好无衬线；正文 14px，说明 12px，标题 16–22px；行高 1.6–1.7。\n"
      + "- 布局：舒适间距；卡片 12–16px 圆角；移动端单列，桌面 2–3 列。\n"
      + "- 表面：浅色卡片 + 柔和阴影或细边框；避免纯黑与冷灰。\n"
      + "- 组件：大触控区、圆角按钮、亲和空态插画（可选）、柔和底色标签。\n"
      + "- 动效：160–240ms；淡入与轻微缩放；禁止快速闪动。\n"
      + "- 禁止：高饱和撞色、尖锐直角、冷冰冰的纯灰界面。",
    swatches: ["#fdf8f3", "#f3e7da", "#e8830c", "#8a5a44"],
    refs: [
      { name: "NutUI", url: "https://nutui.jd.com/" },
      { name: "Vant", url: "https://vant-ui.github.io/vant/" },
    ],
    materials: [MATERIALS.vantDesign, MATERIALS.uiChina, MATERIALS.huaban],
  },
  {
    id: "swiss",
    label: "瑞士网格",
    desc: "严格网格、高对比、左对齐、单一红点；无装饰",
    prompt:
      "Visual direction — Swiss/International: strict grid, left-aligned Helvetica-like type with tight tracking, high contrast black/white, one red accent, generous asymmetric whitespace, zero gradients/shadows. Data and typography carry the design.",
    spec:
      "设计规范（瑞士网格）\n"
      + "- 色彩：黑白为主，单一红色强调；灰阶用于层级；不使用渐变。\n"
      + "- 字体：Helvetica 风格无衬线，紧字距；大标题 28–40px，正文 14–15px；左对齐。\n"
      + "- 布局：严格 12 列网格；非对称留白；信息按基线对齐；表格与数据优先。\n"
      + "- 表面：无圆角或 0–4px；无阴影；1px 黑/灰线分隔。\n"
      + "- 组件：极简按钮（文字/细框）、表格、编号、标签；图标线性。\n"
      + "- 动效：100–180ms；只做淡入/滑入；禁止装饰动画。\n"
      + "- 禁止：卡片堆叠、圆润气泡、彩色渐变、居中排版。",
    swatches: ["#ffffff", "#111111", "#e30613", "#9b9b95"],
    refs: [
      { name: "IBM Carbon", url: "https://carbondesignsystem.com/" },
      { name: "Ant Design 栅格", url: "https://ant.design/components/grid-cn" },
    ],
    materials: [MATERIALS.antResources, MATERIALS.uiChina],
  },
  {
    id: "glass",
    label: "玻璃拟态",
    desc: "半透明玻璃层、背景模糊、细亮边、柔和渐变",
    prompt:
      "Visual direction — glassmorphism: layered translucent surfaces with backdrop blur, 1px light borders, soft gradients behind, 14–18px radii. Keep text contrast readable with a solid fallback; limit the number of blurred layers for performance.",
    spec:
      "设计规范（玻璃拟态）\n"
      + "- 色彩：半透明白/浅色层叠；背景用柔和渐变或模糊；主色作强调；文字必须高对比。\n"
      + "- 字体：清晰无衬线；正文 14px，说明 12px；避免细体。\n"
      + "- 布局：层叠卡片与浮层；14–18px 圆角；层与层之间 1px 亮边。\n"
      + "- 表面：backdrop blur + 半透明底 + 内高光；必须有不透明回退底。\n"
      + "- 组件：浮层导航、玻璃卡片、胶囊按钮；限制模糊层数量。\n"
      + "- 动效：200–300ms；淡入/轻微位移；禁止大面积动态模糊。\n"
      + "- 禁止：文字压在复杂背景上不可读、过多模糊导致性能下降。",
    swatches: ["#e8f0ff", "#ffffff", "#7cabf8", "#b79cff"],
    refs: [
      { name: "Apple HIG Materials", url: "https://developer.apple.com/design/human-interface-guidelines/materials" },
      { name: "Material 3 Color System", url: "https://m3.material.io/styles/color/system/overview" },
    ],
    materials: [MATERIALS.glassmorphism, MATERIALS.appleResources, MATERIALS.zcool],
  },
  {
    id: "material",
    label: "Material 3",
    desc: "色调表面、动态主色、较大圆角与状态层",
    prompt:
      "Visual direction — Material 3: tonal surfaces derived from one seed color, 12–28px radii, elevation expressed by surface tint rather than heavy shadows, clear state layers (hover/focus/pressed), expressive type scale, 200–300ms standard easing.",
    spec:
      "设计规范（Material 3）\n"
      + "- 色彩：单一 seed 生成 tonal palette；surface/container 分层；primary/secondary/tertiary 角色明确。\n"
      + "- 字体：M3 type scale；display/headline/title/body/label；正文 14–16px。\n"
      + "- 布局：4/8dp 网格；12–28px 圆角；触控 48dp。\n"
      + "- 表面：elevation 用表面 tint 而非重阴影；state layer（hover/focus/pressed）必须可见。\n"
      + "- 组件：Filled/Outlined 按钮、FAB、NavigationBar、Cards、Chips、Dialogs。\n"
      + "- 动效：200–300ms standard easing；页面转场与共享轴。\n"
      + "- 禁止：随意改 seed 语义、无状态层、重投影。",
    swatches: ["#fef7ff", "#eaddff", "#6750a4", "#386a20"],
    refs: [
      { name: "Material Design 3", url: "https://m3.material.io/" },
      { name: "Arco Design Theme", url: "https://arco.design/react/docs/theme" },
    ],
    materials: [MATERIALS.materialResources, MATERIALS.elementResources, MATERIALS.mobbin],
  },
];

/** 国内设计系统参考（设置页可点开；风格提示词按上游文档沟通，⛔ 不复制品牌资源）。 */
export const FRONTEND_REFERENCE_SYSTEMS = [
  { name: "Ant Design", url: "https://ant.design/" },
  { name: "Arco Design", url: "https://arco.design/" },
  { name: "TDesign", url: "https://tdesign.tencent.com/" },
  { name: "Semi Design", url: "https://semi.design/zh-CN/" },
  { name: "Element Plus", url: "https://element-plus.org/zh-CN/" },
  { name: "Naive UI", url: "https://www.naiveui.com/zh-CN/" },
  { name: "Vant", url: "https://vant-ui.github.io/vant/" },
  { name: "NutUI", url: "https://nutui.jd.com/" },
  { name: "iView", url: "https://www.iviewui.com/" },
  { name: "Layui", url: "https://layui.dev/" },
  { name: "Ant Design Mobile", url: "https://mobile.ant.design/" },
];

export const DEFAULT_FRONTEND_DESIGN_STYLE = "auto";

export function normalizeFrontendDesignStyle(value) {
  const id = String(value ?? "").trim();
  return FRONTEND_DESIGN_STYLES.some((style) => style.id === id) ? id : DEFAULT_FRONTEND_DESIGN_STYLE;
}

/** 生成写进 AGENTS.md 的前端设计段；空字符串 = 不注入（关闭 / 跟随项目且没有自定义内容）。 */
export function frontendDesignPrompt(style, notes, enabled = true) {
  if (enabled === false) return "";
  const id = normalizeFrontendDesignStyle(style);
  const preset = FRONTEND_DESIGN_STYLES.find((item) => item.id === id);
  const custom = String(notes ?? "").trim();
  const parts = [];
  if (preset?.prompt) parts.push(preset.prompt);
  if (preset?.spec) parts.push(`Design specification:\n${preset.spec}`);
  if (preset?.refs?.length) {
    parts.push(
      "Reference design docs (read their specs for patterns and states; do not copy brand assets): "
      + preset.refs.map((ref) => `${ref.name} — ${ref.url}`).join("; "),
    );
  }
  if (preset?.materials?.length) {
    parts.push(
      "Reference materials (inspiration only, never copy a page or brand): "
      + preset.materials.map((item) => `${item.name} — ${item.url}`).join("; "),
    );
  }
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
