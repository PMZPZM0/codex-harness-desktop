/**
 * 手机端 Markdown 渲染（纯函数：字符串 → 已转义的 HTML）。
 *
 * ⛔ 先转义再做行内格式：渲染结果直接进 innerHTML，任何原始 < > & 都必须先变成实体；
 *    链接只认 http(s)，`javascript:` 之类保持纯文本（不生成 <a>）。
 * ⛔ 页面里内联的是**同一份源码**（electron/remote/web-page.ts 读取本文件后注入），
 *    不要在页面里另写一套 —— 预检【139b】真跑的就是这里。
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

/** 行内格式：`code` / **粗** / *斜* / ~~删~~ / [文字](https://…) */
export function renderMarkdownInline(input) {
  let text = esc(input);
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_all, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_all, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
  return text.replace(/\u0000(\d+)\u0000/g, (_all, index) => `<code>${codes[Number(index)] ?? ""}</code>`);
}

/** 块级渲染：围栏代码 / 表格 / 标题 / 引用 / 列表 / 分隔线 / 段落 */
export function renderMarkdownHtml(input) {
  const lines = String(input ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let index = 0;

  const isBlank = (line) => !String(line).trim();
  const isFence = (line) => /^\s*```/.test(line);
  const isHeading = (line) => /^#{1,6}\s+/.test(line);
  const isRule = (line) => /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line);
  const isQuote = (line) => /^\s*>\s?/.test(line);
  const isList = (line) => /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
  const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  const startsBlock = (line) => isFence(line) || isHeading(line) || isRule(line) || isQuote(line) || isList(line);
  const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) { index += 1; continue; }

    const fence = line.match(/^\s*```\s*([^\s`]*)/);
    if (fence) {
      const lang = String(fence[1] ?? "");
      const body = [];
      index += 1;
      while (index < lines.length && !isFence(lines[index])) { body.push(lines[index]); index += 1; }
      index += 1;
      out.push(`<pre class="md-pre"${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (line.indexOf("|") >= 0 && index + 1 < lines.length && isTableSep(lines[index + 1])) {
      const head = cellsOf(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].indexOf("|") >= 0 && !isBlank(lines[index])) {
        rows.push(cellsOf(lines[index]));
        index += 1;
      }
      const headHtml = head.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join("");
      const bodyHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${renderMarkdownInline(cell)}</td>`).join("")}</tr>`).join("");
      out.push(`<div class="md-table"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
      continue;
    }

    if (isRule(line)) { out.push("<hr>"); index += 1; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push(`<div class="md-h md-h${heading[1].length}">${renderMarkdownInline(heading[2])}</div>`);
      index += 1;
      continue;
    }

    if (isQuote(line)) {
      const body = [];
      while (index < lines.length && isQuote(lines[index])) {
        body.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>${renderMarkdownHtml(body.join("\n"))}</blockquote>`);
      continue;
    }

    if (isList(line)) {
      const items = [];
      while (index < lines.length && (isList(lines[index]) || (/^\s{2,}\S/.test(lines[index]) && items.length))) {
        const match = lines[index].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (match) items.push({ indent: match[1].length, ordered: /\d/.test(match[2]), text: match[3] });
        else if (items.length) items[items.length - 1].text += " " + lines[index].trim();
        index += 1;
      }
      const ordered = items.length > 0 && items[0].ordered;
      const itemHtml = items
        .map((item) => `<li${item.indent >= 2 ? ' class="md-sub"' : ""}>${renderMarkdownInline(item.text)}</li>`)
        .join("");
      out.push(ordered ? `<ol>${itemHtml}</ol>` : `<ul>${itemHtml}</ul>`);
      continue;
    }

    const body = [line];
    index += 1;
    while (index < lines.length && !isBlank(lines[index]) && !startsBlock(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    out.push(`<p>${body.map((row) => renderMarkdownInline(row)).join("<br>")}</p>`);
  }

  return out.join("");
}
