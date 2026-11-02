/**
 * CSV / TSV 表格预览（11-02）：右栏文件预览把分隔符文本渲染成表格，而不是一大段文本。
 * 纯函数（零依赖），守卫可直跑；只做常用子集（引号包裹、转义双引号、CRLF），不做类型推断。
 */

/** 解析分隔符文本；超出行/列上限时截断并标记。 */
export function parseDelimited(text, delimiter = ",", maxRows = 200, maxCols = 40) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  const src = String(text ?? "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) {
      if (row.length < maxCols) row.push(cell);
      else truncated = true;
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row.slice(0, maxCols));
      if (rows.length >= maxRows) { truncated = true; break; }
      row = [];
      continue;
    }
    cell += ch;
  }
  if (!truncated && (cell.length || row.length)) {
    row.push(cell);
    rows.push(row.slice(0, maxCols));
  }
  return { rows, truncated, cols: Math.max(0, ...rows.map((r) => r.length)) };
}

export function delimiterOf(ext) {
  return /^(tsv)$/i.test(String(ext ?? "")) ? "\t" : ",";
}
