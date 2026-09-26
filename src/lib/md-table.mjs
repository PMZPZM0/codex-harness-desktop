/**
 * md-table.mjs —— GFM 表格块的解析与回写（纯函数，check 有行为断言）。
 *
 * 设计硬约束（09-26「文件弹窗编辑」）：**只动表格块，其余原文逐字保留**。
 * 用户 md 里表格以外的标题/段落/代码块绝不能被序列化器碰掉（丢内容 = 事故）。
 * 因此按「行块」建模：识别连续的表格行 → 记录起止行号与单元格矩阵 →
 * 序列化时按行号替换、其余行原样拼回。
 *
 * GFM 表格判定（与 GitHub 渲染一致的最小子集）：
 *   - 块首行含 `|`（或含 ` - ` 分隔形态），第二行是分隔行（`---`、`:---:`、`---:` 组合）；
 *   - 块内每一行都以表格行处理（首尾 `|` 可省——GFM 允许，但序列化统一补齐首尾 `|`）；
 *   - 单元格内的 `\|` 是字面竖线，转义还原/回写时重新转义。
 */

/** 单元格文本 → 内部值：解掉 \| 转义 */
function cellToValue(raw) {
  return raw.replace(/\\\|/g, "|").trim();
}

/** 内部值 → 单元格文本：含管道符/换行则转义（换行替换为空格——GFM 单元格不支持换行） */
function valueToCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** 分隔行判定：`| --- | :---: |` 形态（允许省略首尾 |） */
function isSeparatorRow(line) {
  const core = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!core) return false;
  const cells = core.split("|");
  return cells.length > 0 && cells.every((c) => /^\s*:?-{1,}:?\s*$/.test(c));
}

/** 表格行 → 单元格数组（去掉首尾 | 再切分；\| 不拆列） */
function splitRow(line) {
  let core = line.trim();
  // 去掉首尾管道（成对才去，单独一个尾 | 也去——GFM 允许）
  if (core.startsWith("|")) core = core.slice(1);
  if (core.endsWith("|") && !core.endsWith("\\|")) core = core.slice(0, -1);
  // 先把 \| 保护起来再切分
  const protectedLine = core.replace(/\\\|/g, "\u0000");
  return protectedLine.split("|").map((c) => cellToValue(c.replace(/\u0000/g, "\\|")));
}

/**
 * 解析文本中的所有 GFM 表格块。
 * @returns {{ blocks: Array<{ start: number, end: number, rows: string[][], isSeparator: boolean[] }>, lines: string[] }}
 *   start/end 是**行下标**（0 基，含头不含尾 end=块后一行）；rows[0] 是表头；isSeparator 与 rows 对齐（重建时跳过分隔行，回写统一生成）。
 */
export function parseMarkdownTables(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  // ⛔ 围栏跟踪：``` / ~~~ 代码块内的「表格样子」的行是示例文本，不是数据表格——
  //    绝不能识别为可编辑块（否则保存时把用户的代码示例改写成对齐表格 = 破坏原文）。
  let fence = null; // 当前所在围栏标记（含缩进与字符，如 "```"）
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      i++;
      continue;
    }
    if (!fence) {
      const isTableLine = line.includes("|");
      const next = lines[i + 1] ?? "";
      if (isTableLine && !isSeparatorRow(line) && isSeparatorRow(next)) {
        // 块从这里开始：header + separator + 连续的表格行
        const rows = [splitRow(line)];
        let j = i + 2;
        while (j < lines.length && lines[j].includes("|") && !(lines[j].trim() === "")) {
          rows.push(splitRow(lines[j]));
          j++;
        }
        blocks.push({ start: i, end: j, rows });
        i = j;
        continue;
      }
    }
    i++;
  }
  return { blocks, lines };
}

/**
 * 用编辑后的矩阵重建文本：只替换表格块的行，其余行原样保留。
 * @param original 原文
 * @param edits 与 parseMarkdownTables(text).blocks 一一对应的替换矩阵（null = 该块未改动可跳过，但传了也会按矩阵重建）
 * @returns 新文本
 */
export function renderMarkdownTables(original, edits) {
  const { blocks, lines } = parseMarkdownTables(original);
  if (blocks.length !== edits.length) throw new Error(`表格块数量不匹配：原文 ${blocks.length}，编辑 ${edits.length}`);
  // 从后往前替换，行号不漂移
  const out = lines.slice();
  for (let b = blocks.length - 1; b >= 0; b--) {
    const block = blocks[b];
    const rows = edits[b];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const colCount = Math.max(...rows.map((r) => r.length));
    const matrix = rows.map((r) => { const row = r.slice(); while (row.length < colCount) row.push(""); return row; });
    // 列宽对齐（可读性；对不齐只影响观感不影响渲染）
    const widths = [];
    for (let c = 0; c < colCount; c++) widths[c] = Math.max(3, ...matrix.map((row) => valueToCell(row[c]).length));
    const pad = (value, width) => valueToCell(value).padEnd(width);
    const rendered = [];
    rendered.push(`| ${matrix[0].map((v, c) => pad(v, widths[c])).join(" | ")} |`);
    rendered.push(`| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`);
    for (let r = 1; r < matrix.length; r++) rendered.push(`| ${matrix[r].map((v, c) => pad(v, widths[c])).join(" | ")} |`);
    out.splice(block.start, block.end - block.start, ...rendered);
  }
  return out.join("\n");
}
