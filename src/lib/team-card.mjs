/**
 * 团队模式 · 卡片解析（纯函数，11-06）
 *
 * 飞书逆向 §2.2：机器人消息的内容是 `cardContent`（一段 JSON），客户端有 schema 渲染器，
 * 节点类型含 `div / table / chart / markdown / img / button / hr / note / code_block …`。
 * 我们这版把「伙伴回复的 Markdown」解析成**同类节点**再渲染：
 *   - 表格 → 真 `<table>`（⛔ 不要拿等宽文本对齐，中文一混就散）
 *   - 代码块 → `<pre>`；标题 → 加粗行；列表 → 缩进项；引用 → 左侧竖线
 * ⇒ 群里的回复才有"卡片感"，而不是一坨原文。
 *
 * ⛔ 只解析、不执行：输出是数据（block/spans），渲染由 React 组装，
 *    **⛔ 绝不把 HTML 字符串塞进 dangerouslySetInnerHTML**（回复内容来自模型，属不可信文本）。
 */

/** 解析上限：超长回复只渲染前 N 个块（防止一条 2 万字的回复把 DOM 撑爆）。 */
export const MAX_CARD_BLOCKS = 120;

/**
 * 行内标记 → spans。
 * 支持 `**粗体**`、`` `代码` ``、`[文字](https://…)`。
 * ⛔ 只认 http/https 链接（`javascript:` 之类一律当文本，避免把不可信协议交给浏览器）。
 */
export function parseInline(text) {
  const src = String(text ?? "");
  const out = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/)[^\s)]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ type: "text", text: src.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push({ type: "strong", text: tok.slice(2, -2) });
    } else if (tok.startsWith("`")) {
      out.push({ type: "code", text: tok.slice(1, -1) });
    } else {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      out.push(mm ? { type: "link", text: mm[1], href: mm[2] } : { type: "text", text: tok });
    }
    last = m.index + tok.length;
  }
  if (last < src.length) out.push({ type: "text", text: src.slice(last) });
  return out.length ? out : [{ type: "text", text: src }];
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line) => /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
const splitRow = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/**
 * Markdown → 块数组。
 * @returns [{ type: "heading"|"paragraph"|"list"|"table"|"code"|"quote"|"hr", ... }]
 */
export function parseCard(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  const pushBlock = (b) => {
    if (blocks.length < MAX_CARD_BLOCKS) blocks.push(b);
  };

  while (i < lines.length) {
    const line = lines[i];

    /* 空行 */
    if (!line.trim()) { i += 1; continue; }

    /* 围栏代码块（```lang）—— 必须最先判，里面任何符号都不解析 */
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || "";
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1; // 跳过结束围栏（没有闭合也照样收尾，⛔ 不吞掉后面全文）
      pushBlock({ type: "code", lang, text: body.join("\n") });
      continue;
    }

    /* 分隔线 */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { pushBlock({ type: "hr" }); i += 1; continue; }

    /* 标题 */
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (h) { pushBlock({ type: "heading", level: h[1].length, text: h[2].trim() }); i += 1; continue; }

    /* 表格：当前行是 |…| 且下一行是分隔行 */
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) { rows.push(splitRow(lines[i])); i += 1; }
      pushBlock({ type: "table", header, rows });
      continue;
    }

    /* 引用（连续 > 行合并） */
    if (/^\s*>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
      pushBlock({ type: "quote", text: body.join("\n") });
      continue;
    }

    /* 列表（有序 / 无序，连续同类合并成一个块） */
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = Boolean(ol);
      const items = [];
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]) : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      pushBlock({ type: "list", ordered, items });
      continue;
    }

    /* 段落：吃到空行 / 下一个块起点为止（软换行保留成空格） */
    const para = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const nxt = lines[i];
      if (!nxt.trim()) break;
      if (/^\s*```/.test(nxt) || /^\s*(#{1,6})\s+/.test(nxt) || /^\s*>\s?/.test(nxt)) break;
      if (/^\s*[-*+]\s+/.test(nxt) || /^\s*\d+[.)]\s+/.test(nxt)) break;
      if (isTableRow(nxt)) break;
      para.push(nxt.trim());
      i += 1;
    }
    pushBlock({ type: "paragraph", text: para.join(" ") });
  }

  return blocks;
}

/** 给纯文本预览用（表格摊成一行、代码块压成一行）—— 列表/搜索/标题摘要共用。 */
export function cardToPlain(text, max = 160) {
  const blocks = parseCard(text);
  const parts = [];
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "paragraph" || b.type === "quote") parts.push(b.text);
    else if (b.type === "list") parts.push(b.items.join("；"));
    else if (b.type === "table") parts.push([b.header, ...b.rows].map((r) => r.join(" ")).join("；"));
    else if (b.type === "code") parts.push(b.text);
    if (parts.join(" ").length >= max) break;
  }
  const out = parts.join(" ").replace(/\s+/g, " ").trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}
