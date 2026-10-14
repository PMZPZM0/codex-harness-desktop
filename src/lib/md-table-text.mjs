/**
 * 表格 → TSV（10-14，配合正文表格右上角的「复制表格」）。
 *
 * ⛔ 为什么是 TSV 而不是 markdown 原文：贴进 Excel / 飞书表格 / Word 就是一张表；
 *   而 markdown 原文要拿到 react-markdown 的**源码**，渲染层离它很远（只能从 DOM 反推）。
 * ⛔ 入参按**鸭子类型**取（`rows[].cells[].textContent`）：渲染层传真 DOM 的 `table.rows`，
 *   预检守卫传普通对象 —— 同一份实现在两边都能跑真值表（不许在守卫里抄一份）。
 * ⛔ 单元格里的换行/多空格一律压成单空格：TSV 的语义是「一行一条记录」，内嵌换行会把表撕开。
 */

/** @param rows 行集合（每行有 cells，每个 cell 有 textContent） @returns TSV 文本；无内容时返回空串 */
export function tableToTsv(rows) {
  const list = rows == null ? [] : Array.from(rows);
  const lines = [];
  for (const row of list) {
    // ⛔ 必须 `Array.from`：真 DOM 的 `row.cells` 是 **HTMLCollection（类数组）**，
    //   用 `Array.isArray` 判会把整张表拼成空串（10-14 实测：按钮点了没反应，诊断标记 empty-text）。
    const cells = row && row.cells != null ? Array.from(row.cells) : [];
    lines.push(cells.map((cell) => String(cell?.textContent ?? "").replace(/\s+/g, " ").trim()).join("\t"));
  }
  // ⛔ 只丢**尾部空行**，绝不对整串 trim()：首列是空单元格时那一行以 Tab 开头 ——
  //   trim() 会把前导 Tab 吃掉，整张表的列从此串位（预检真值表抓到的真 bug）。
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}
