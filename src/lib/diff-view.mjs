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
