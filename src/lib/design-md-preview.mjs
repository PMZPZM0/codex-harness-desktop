/**
 * design-md-preview —— DESIGN.md 预览的纯函数（设计参考页用）。
 *
 * 上游文件有两种形态：
 *   · Stitch 格式：`---` YAML tokens（颜色/字体/圆角/组件）`---` + Markdown 正文；
 *   · 少数「# Design System Inspired by X」正文式，没有 YAML 头。
 * 预览要分开显示：tokens 进折叠块 + 色板，正文走 Markdown 渲染（⛔ 不把 YAML 当正文摊出来）。
 * ⛔ 本文件是 .mjs：只用 JS（JSDoc 注释类型），守卫会直接 import 跑真值表。
 */

const HEX = /#[0-9a-fA-F]{3,8}/;

/**
 * 拆出 YAML tokens 与正文，并提取色板。
 * @param {string} text DESIGN.md 原文
 * @returns {{ tokens: string; body: string; colors: Array<{ name: string; hex: string }> }}
 */
export function splitDesignMd(text) {
  const src = String(text ?? "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(src);
  const tokens = match ? match[1] : "";
  const body = (match ? src.slice(match[0].length) : src).trim();
  /** @type {Array<{ name: string; hex: string }>} */
  const colors = [];
  if (tokens) {
    const seen = new Set();
    for (const line of tokens.split(/\r?\n/)) {
      const hit = /^\s*([a-zA-Z0-9_-]+):\s*["']?(#[0-9a-fA-F]{3,8})["']?\s*$/.exec(line);
      if (!hit) continue;
      const hex = hit[2].toLowerCase();
      if (seen.has(hex)) continue;
      seen.add(hex);
      colors.push({ name: hit[1], hex });
      if (colors.length >= 24) break;
    }
  }
  return { tokens, body, colors };
}

/**
 * 色板里是否有可显示的十六进制值（渲染层用来决定要不要画色板）。
 * @param {{ colors: Array<{ name: string; hex: string }> } | null} parts
 * @returns {boolean}
 */
export function hasSwatches(parts) {
  return Boolean(parts && parts.colors.length > 0);
}

/**
 * 是否是十六进制色值。
 * @param {string} value
 * @returns {boolean}
 */
export function isHexColor(value) {
  return HEX.test(value);
}

/** 常见 token 名的中文说法（展示用；不在表里的保留英文原名）。 */
const TOKEN_LABEL_ZH = {
  primary: "主色",
  "on-primary": "主色上的文字",
  "primary-hover": "主色悬停",
  "primary-focus": "主色聚焦",
  "primary-pressed": "主色按下",
  accent: "强调色",
  brand: "品牌色",
  canvas: "页面底色",
  "inverse-canvas": "反转底色",
  ink: "正文文字",
  "ink-muted": "次要文字",
  "ink-subtle": "弱化文字",
  "ink-tertiary": "三级文字",
  "inverse-ink": "反转文字",
  body: "正文",
  mute: "弱文字",
  muted: "弱文字",
  hairline: "细描边",
  "hairline-strong": "强描边",
  "hairline-tertiary": "三级描边",
  "semantic-success": "成功",
  "semantic-error": "错误",
  "semantic-warning": "警告",
  "semantic-danger": "危险",
  "semantic-overlay": "遮罩",
  "surface-1": "卡片面 1",
  "surface-2": "卡片面 2",
  "surface-3": "卡片面 3",
  "surface-4": "卡片面 4",
  "surface-card": "卡片面",
  "surface-soft": "柔和面",
  "surface-dark": "深色面",
  "inverse-surface-1": "反转卡片面 1",
  "inverse-surface-2": "反转卡片面 2",
  "on-dark": "深色上的文字",
  "on-dark-mute": "深色上的弱文字",
  "focus-ring": "聚焦环",
};

/**
 * token 名的中文说法（没有映射就原样返回英文）。
 * @param {string} name
 * @returns {string}
 */
export function tokenLabelZh(name) {
  return TOKEN_LABEL_ZH[String(name ?? "").toLowerCase()] ?? String(name ?? "");
}

/** 色板分组顺序与中文组名（按 token 名的前缀归组）。 */
const GROUPS = [
  { key: "accent", label: "主色 / 强调色" },
  { key: "bg", label: "背景与表面" },
  { key: "text", label: "文字" },
  { key: "line", label: "描边与分隔" },
  { key: "state", label: "状态色" },
  { key: "other", label: "其他" },
];

/**
 * 把色板按用途分组（展示用中文组名；同组保持原文顺序）。
 * @param {Array<{ name: string; hex: string }>} colors
 * @returns {Array<{ key: string; label: string; items: Array<{ name: string; label: string; hex: string }> }>}
 */
export function groupColors(colors) {
  const buckets = new Map(GROUPS.map((group) => [group.key, []]));
  for (const color of colors ?? []) {
    const name = String(color.name ?? "").toLowerCase();
    let key = "other";
    if (/^(primary|accent|brand|focus)/.test(name)) key = "accent";
    else if (/^(canvas|surface|bg|background|inverse-canvas|inverse-surface)/.test(name)) key = "bg";
    else if (/^(ink|text|body|mute|on-dark)/.test(name)) key = "text";
    else if (/^(hairline|border|line|outline|divider)/.test(name)) key = "line";
    else if (/^(semantic|success|error|warning|danger)/.test(name)) key = "state";
    buckets.get(key).push({ ...color, label: tokenLabelZh(color.name) });
  }
  return GROUPS.map((group) => ({ key: group.key, label: group.label, items: buckets.get(group.key) }))
    .filter((group) => group.items.length > 0);
}

/** 字体层级名 → 中文（渲染用；不在表里的保留英文原名）。 */
const TYPE_LABEL_ZH = {
  "display-xl": "超大展示标题",
  "display-lg": "展示标题",
  "display-md": "中展示标题",
  "display-sm": "小展示标题",
  display: "展示标题",
  headline: "大标题",
  heading: "标题",
  title: "标题",
  "card-title": "卡片标题",
  subhead: "副标题",
  "body-lg": "大正文",
  body: "正文",
  "body-sm": "小正文",
  caption: "说明文字",
  button: "按钮文字",
  eyebrow: "眉题",
  mono: "等宽文字",
  label: "标签文字",
  overline: "顶线文字",
  quote: "引用文字",
};

/** 圆角名 → 中文。 */
const ROUNDED_LABEL_ZH = {
  none: "无",
  xs: "超小",
  sm: "小",
  md: "中",
  lg: "大",
  xl: "超大",
  xxl: "特大",
  pill: "胶囊",
  full: "全圆",
};

/** 组件名前缀 → 中文组名（渲染用；未知前缀归「其他组件」）。 */
const COMPONENT_GROUP_ZH = {
  button: "按钮",
  card: "卡片",
  input: "输入框",
  form: "表单",
  nav: "导航",
  navigation: "导航",
  header: "页头",
  footer: "页脚",
  tab: "标签页",
  tabs: "标签页",
  badge: "徽章",
  chip: "胶囊标签",
  tag: "标签",
  tooltip: "提示条",
  modal: "弹窗",
  dialog: "弹窗",
  table: "表格",
  list: "列表",
  link: "链接",
  hero: "首屏",
  pricing: "定价卡",
  testimonial: "评价卡",
  banner: "横幅",
  avatar: "头像",
  chart: "图表",
  panel: "面板",
  sidebar: "侧栏",
  dropdown: "下拉菜单",
  select: "选择器",
  checkbox: "复选框",
  radio: "单选框",
  switch: "开关",
  toggle: "开关",
  accordion: "折叠面板",
  toast: "通知",
  alert: "提醒",
  status: "状态",
  product: "产品块",
  feature: "功能块",
  section: "区块",
  image: "图片块",
  icon: "图标",
  divider: "分隔线",
  search: "搜索框",
  menu: "菜单",
  progress: "进度条",
  skeleton: "骨架屏",
  slider: "滑块",
};

/**
 * 解析 YAML tokens 的顶层段（colors / typography / rounded / spacing / components）。
 * @param {string} tokens
 * @returns {{ colors: Record<string,string>; typography: Array<{name:string; props:Record<string,string>}>; rounded: Array<{name:string; value:string}>; spacing: Array<{name:string; value:string}>; components: Array<{name:string; props:Record<string,string>}> }}
 */
function parseTokenSections(tokens) {
  const sections = { colors: {}, typography: [], rounded: [], spacing: [], components: [] };
  let section = "";
  let typeEntry = null;
  let compEntry = null;
  for (const line of String(tokens ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = (/^\s*/.exec(line)?.[0] ?? "").length;
    const match = /^\s*([^:#]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (indent === 0) {
      section = value === "" ? key : "";
      typeEntry = null;
      compEntry = null;
      continue;
    }
    if (section === "colors") {
      if (indent >= 2 && value) sections.colors[key] = value.replace(/^["']|["']$/g, "").trim();
      continue;
    }
    if (section === "rounded" || section === "spacing") {
      if (indent >= 2 && value) sections[section].push({ name: key, value: value.replace(/^["']|["']$/g, "").trim() });
      continue;
    }
    if (section === "typography") {
      if (indent === 2) { typeEntry = { name: key, props: {} }; sections.typography.push(typeEntry); }
      else if (typeEntry && value) typeEntry.props[key] = value;
      continue;
    }
    if (section === "components") {
      if (indent === 2) { compEntry = { name: key, props: {} }; sections.components.push(compEntry); }
      else if (compEntry && value) compEntry.props[key] = value;
    }
  }
  return {
    colors: sections.colors,
    typography: sections.typography,
    rounded: Array.isArray(sections.rounded) ? sections.rounded : [],
    spacing: Array.isArray(sections.spacing) ? sections.spacing : [],
    components: sections.components,
  };
}

/**
 * 把 tokens 汇总成中文导读（字体 / 字号层级 / 圆角 / 间距 / 组件样式）。
 * ⛔ 只是**展示层**：复制 / 导出 / 交给 Codex 用的仍是英文原文。
 * @param {string} tokens YAML 头
 * @param {{ maxComponents?: number }} [options]
 * @returns {{ fonts: string[]; typeScale: Array<{ name: string; label: string; family: string; size: string; weight: string; lineHeight: string }>; rounded: Array<{ name: string; label: string; value: string }>; spacing: Array<{ name: string; value: string }>; components: Array<{ group: string; label: string; items: Array<{ name: string; label: string; background: string; text: string; rounded: string; padding: string }> }>; hiddenComponents: number }}
 */
export function summarizeTokens(tokens, options = {}) {
  const maxComponents = Math.max(1, Number(options.maxComponents) || 32);
  const parsed = parseTokenSections(tokens);
  const clean = (value) => String(value ?? "").replace(/^["']|["']$/g, "").trim();
  const colorOf = (ref) => {
    const hit = /^\{colors\.([\w-]+)\}$/.exec(clean(ref));
    if (!hit) return clean(ref);
    const hex = parsed.colors[hit[1]];
    return hex ? `${tokenLabelZh(hit[1])} ${hex}` : hit[1];
  };
  const roundedOf = (ref) => {
    const hit = /^\{rounded\.([\w-]+)\}$/.exec(clean(ref));
    if (!hit) return clean(ref);
    const value = parsed.rounded.find((row) => row.name === hit[1])?.value ?? "";
    const label = ROUNDED_LABEL_ZH[hit[1]] ?? hit[1];
    return value ? `${label} ${value}` : label;
  };

  const fonts = [...new Set(parsed.typography.map((row) => row.props.fontFamily).filter(Boolean))];
  const typeScale = parsed.typography.slice(0, 16).map((row) => ({
    name: row.name,
    label: TYPE_LABEL_ZH[row.name] ?? row.name,
    family: row.props.fontFamily ?? "",
    size: row.props.fontSize ?? "",
    weight: row.props.fontWeight ?? "",
    lineHeight: row.props.lineHeight ?? "",
  }));
  const rounded = parsed.rounded.slice(0, 12).map((row) => ({ name: row.name, label: ROUNDED_LABEL_ZH[row.name] ?? row.name, value: row.value }));
  const spacing = parsed.spacing.slice(0, 16).map((row) => ({ name: row.name, value: row.value }));

  const groups = new Map();
  let used = 0;
  let hidden = 0;
  const VARIANT_ZH = {
    primary: "主要",
    secondary: "次要",
    tertiary: "第三级",
    hover: "悬停",
    pressed: "按下",
    focus: "聚焦",
    disabled: "禁用",
    inverse: "反转",
    featured: "推荐",
    active: "选中",
    selected: "选中",
    large: "大号",
    small: "小号",
    icon: "图标",
  };
  for (const comp of parsed.components) {
    if (used >= maxComponents) { hidden += 1; continue; }
    const head = comp.name.split(/[-_]/)[0];
    const known = Boolean(COMPONENT_GROUP_ZH[head]);
    const groupKey = known ? head : "other";
    const label = known ? COMPONENT_GROUP_ZH[head] : "其他组件";
    if (!groups.has(groupKey)) groups.set(groupKey, { group: groupKey, label, items: [] });
    const background = colorOf(comp.props.backgroundColor);
    const text = colorOf(comp.props.textColor);
    const compRounded = roundedOf(comp.props.rounded);
    const nameParts = comp.name.split(/[-_]/).slice(1).map((part) => VARIANT_ZH[part] ?? COMPONENT_GROUP_ZH[part] ?? part);
    const nameLabel = [label, ...nameParts].join(" · ");
    groups.get(groupKey).items.push({ name: comp.name, label: nameLabel, background, text, rounded: compRounded, padding: comp.props.padding ?? "" });
    used += 1;
  }

  return {
    fonts,
    typeScale,
    rounded,
    spacing,
    components: [...groups.values()],
    hiddenComponents: hidden,
  };
}
