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
