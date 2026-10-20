// diff 文本 → 渲染行的纯函数解析（汇总卡悬停的 diff 预览专用；预检可直接 import 跑断言）。
//
// 两类输入都要吃：
//   · 统一 diff（引擎 fileChange 的 `change.diff`）：`diff --git` / `index` / `---` / `+++` /
//     `@@ -a,b +c,d @@` / 上下文行；
//   · 宿主追踪的伪 diff（electron/turn-file-watch.ts 的 lineDelta）：`@@ -a,b +c,d @@` +
//     先整块 `-` 再整块 `+`（**没有上下文行**）。
//
// 行号从 hunk 头解析（旧侧 / 新侧各自计数）——这是「像 Qoder 那样带行号槽」的数据源；
// ⛔ 没有 hunk 头（极端残缺输入）时从 1 起，宁可编号不对也不能不渲染。
//
// ⛔ `--- `/`+++ ` 只在**未进 hunk 之前**算文件头（meta）；进了 hunk 之后 `---x` 就是
//    「删掉一行内容为 `--x`」——按头处理会把内容行吞成灰色 meta（预览缺行）。

/**
 * @param {string} text diff 原文（统一 diff 或伪 diff）
 * @returns {{ kind: "meta"|"hunk"|"add"|"del"|"ctx"; text: string; oldNo: number|null; newNo: number|null }[]}
 */
export function parseDiffLines(text) {
  const lines = String(text ?? "").split("\n");
  // 末尾换行 split 出的空串是伪行（不是上下文），去掉
  if (lines.length && lines[lines.length - 1] === "" && String(text).endsWith("\n")) lines.pop();
  const rows = [];
  let oldNo = 1;
  let newNo = 1;
  let inHunk = false;
  for (const line of lines) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      rows.push({ kind: "meta", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk && (/^(diff --git |index |new file mode |deleted file mode |similarity index |rename (from|to) |old mode |new mode |--- )/.test(line) || line.startsWith("+++ "))) {
      rows.push({ kind: "meta", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), oldNo: null, newNo });
      newNo++;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), oldNo, newNo: null });
      oldNo++;
      continue;
    }
    rows.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line, oldNo, newNo });
    oldNo++;
    newNo++;
  }
  return rows;
}

/** 逐字符去掉空白：用来识别「只改了缩进/空格」的增删对。 */
function withoutWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, "");
}

/**
 * 隐藏「仅空白变更」（Qoder 的 reviewIgnoreWhitespaceOnly 同款）：
 * 逐 hunk 把相邻的 `-`/`+` 配对，归一化后完全相同 ⇒ 两边一起丢掉；
 * 整块 hunk 没有剩余增删 ⇒ 连 hunk 头与上下文一起丢掉（否则会留下一个空块）。
 * ⛔ 只做展示层过滤，不改原文、不改统计数字。
 */
export function filterWhitespaceOnlyRows(rows) {
  const out = [];
  let block = [];
  let blockIsHunk = false;
  let blockHasChange = false;
  const flush = () => {
    if (block.length && (!blockIsHunk || blockHasChange)) out.push(...block);
    block = [];
    blockIsHunk = false;
    blockHasChange = false;
  };
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.kind === "hunk") {
      flush();
      block = [row];
      blockIsHunk = true;
      continue;
    }
    if (row.kind === "add" || row.kind === "del") {
      const run = [];
      while (index < rows.length && (rows[index].kind === "add" || rows[index].kind === "del")) {
        run.push(rows[index]);
        index++;
      }
      index--;
      const dels = run.filter((entry) => entry.kind === "del");
      const adds = run.filter((entry) => entry.kind === "add");
      const max = Math.max(dels.length, adds.length);
      for (let pair = 0; pair < max; pair++) {
        const del = dels[pair];
        const add = adds[pair];
        if (del && add && withoutWhitespace(del.text) === withoutWhitespace(add.text)) continue;
        // 单边的纯空白行也算「仅空白变更」（新增/删除空行、只剩缩进的行）。
        if (del && !add && !withoutWhitespace(del.text)) continue;
        if (add && !del && !withoutWhitespace(add.text)) continue;
        if (del) { block.push(del); blockHasChange = true; }
        if (add) { block.push(add); blockHasChange = true; }
      }
      continue;
    }
    if (!block.length) out.push(row);
    else block.push(row);
  }
  flush();
  return out;
}

/**
 * 统一 diff 行 → 左右两栏（Qoder 的「拆分」视图）。
 * 返回 `{ kind: "meta"|"hunk", text }` 或 `{ kind: "pair", left, right }`；
 * 连续增删按序配对，单边多出来的行另一侧留空。
 */
export function buildSplitDiffRows(rows) {
  const out = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.kind === "meta" || row.kind === "hunk") {
      out.push({ kind: row.kind, text: row.text });
      continue;
    }
    if (row.kind === "ctx") {
      out.push({ kind: "pair", left: row, right: row });
      continue;
    }
    const dels = [];
    const adds = [];
    while (index < rows.length && (rows[index].kind === "add" || rows[index].kind === "del")) {
      if (rows[index].kind === "del") dels.push(rows[index]);
      else adds.push(rows[index]);
      index++;
    }
    index--;
    const max = Math.max(dels.length, adds.length);
    for (let pair = 0; pair < max; pair++) {
      out.push({ kind: "pair", left: dels[pair] ?? null, right: adds[pair] ?? null });
    }
  }
  return out;
}

/** 只有单边增或单边删（新增文件 / 删除文件）⇒ 拆分视图退回统一视图（Qoder 同款）。 */
export function isSingleSidedDiff(rows) {
  let hasAdd = false;
  let hasDel = false;
  for (const row of rows) {
    if (row.kind === "add") hasAdd = true;
    else if (row.kind === "del") hasDel = true;
  }
  return (hasAdd || hasDel) && !(hasAdd && hasDel);
}
