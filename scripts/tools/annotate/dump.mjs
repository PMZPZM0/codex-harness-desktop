/* 批量补注释的第 ② 步：把一批缺口函数的「名字 + 签名 + 函数体前 6 行」打出来给人（或模型）读。
   ⛔ 只读不写 —— 读实现是写注释的前提，⛔ 不许跳过它按名字套模板（见 ARCHITECTURE-RULES §12.6）。

   用法：
     node scripts/tools/annotate/dump.mjs src/lib 0 40      # 目录 / 起始序号 / 条数
   输出每条两行：`文件|函数|签名` + 缩进的函数体前几行（截断 260 字符）。
*/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const scope = process.argv[2] || "src/lib";
const from = Number(process.argv[3] || 0);
const count = Number(process.argv[4] || 40);

/* ⛔ 末尾的 `[=(<]` 三个都要：`export function f<T>(` 这种泛型声明在 `(` 之前是 `<`，
   只写 `=|\\(` 会把它整类漏掉（11-08 收尾复核发现 4 个泛型导出被漏：slotOf / Slot /
   withNuphusMasks / defineFeature）。 */
const EXPORT_FN = /^\s*export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)\s*(?:[=(<])/;
const CJK = /[\u4e00-\u9fa5]/;

/** 判断声明行是不是函数形态。 */
function isFunctionDecl(line) {
  return /^\s*export\s+(?:async\s+)?function\b/.test(line)
    || /=\s*(?:async\s*)?(?:function\b|\()/.test(line)
    || /=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/.test(line);
}

/** 往上收集紧贴声明的注释文本（最多跨 3 行、遇空行即停）。 */
function docAbove(lines, index) {
  let j = index - 1;
  let doc = "";
  while (j >= 0) {
    const t = lines[j].trim();
    if (!t) { j -= 1; if (index - j > 3) break; continue; }
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.endsWith("*/")) { doc = t + doc; j -= 1; continue; }
    break;
  }
  return doc;
}

/** 递归收集 .ts/.tsx/.mts（跳过产物目录与 .d.ts）。 */
function collectFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|dist$|dist-electron/.test(p)) continue;
      out.push(...collectFiles(p));
    } else if (/\.(ts|tsx|mts)$/.test(e.name) && !/\.d\.(mts|ts)$/.test(e.name) && statSync(p).isFile()) {
      out.push(p);
    }
  }
  return out;
}

const rows = [];
for (const f of collectFiles(join(ROOT, scope))) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const m = EXPORT_FN.exec(lines[i]);
    if (!m || !isFunctionDecl(lines[i]) || CJK.test(docAbove(lines, i))) continue;
    /* 抓函数体前几行：按花括号配平，最多 7 行或 40 行范围，够读懂形态即可。 */
    const body = [];
    let depth = 0;
    let started = false;
    for (let k = i; k < Math.min(lines.length, i + 40); k += 1) {
      body.push(lines[k].trim());
      depth += lines[k].split("{").length - lines[k].split("}").length;
      if (lines[k].includes("{")) started = true;
      if (started && depth <= 0) break;
      if (!started && lines[k].trim().endsWith(";")) break;
      if (body.length > 7) break;
    }
    rows.push({
      file: relative(ROOT, f).replace(/\\/g, "/"),
      name: m[1],
      sig: lines[i].trim().replace(/^export\s+/, ""),
      body: body.slice(1, 7).join(" ").slice(0, 260),
    });
  }
}

for (const r of rows.slice(from, from + count)) {
  console.log(`${r.file}|${r.name}|${r.sig.slice(0, 110)}\n   ${r.body}`);
}
console.log(`\n--- ${from}..${Math.min(from + count, rows.length)} / 共 ${rows.length}`);
