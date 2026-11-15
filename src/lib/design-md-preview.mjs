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
