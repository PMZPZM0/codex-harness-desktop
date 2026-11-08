/* 找出「导出函数上方没有中文文档注释」的缺口，并给出按目录的分组统计。
   ⛔ 只读不写。守卫【295】的口径与这里逐字一致（导出函数 + 上方 3 行内无中文注释即算缺口）。

   用法：
     node scripts/tools/annotate/gap.mjs              # 全仓（src + electron）
     node scripts/tools/annotate/gap.mjs src/lib       # 只看某个目录
     node scripts/tools/annotate/gap.mjs --groups      # 只看按目录分组的条数（批量排期用）
*/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const groupsOnly = args.includes("--groups");
const dirs = args.filter((a) => !a.startsWith("--"));
const scopes = dirs.length ? dirs : ["src", "electron"];

/* 导出函数：`export function` / `export async function` / `export const x = (...) =>`
   ⛔ `export const X = <对象/字面量>` 不算函数（那是常量表，注释落在表头上而不是逐项）。 */
/* ⛔ 末尾的 `[=(<]` 三个都要：`export function f<T>(` 这种泛型声明在 `(` 之前是 `<`，
   只写 `=|\\(` 会把它整类漏掉（11-08 收尾复核发现 4 个泛型导出被漏：slotOf / Slot /
   withNuphusMasks / defineFeature）。 */
const EXPORT_FN = /^\s*export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)\s*(?:[=(<])/;
const CJK = /[\u4e00-\u9fa5]/;

/** 判断声明行是不是函数形态（函数声明 / 箭头函数 / 函数表达式）。 */
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

/** 递归收集 .ts/.tsx/.mts；⛔ 跳过 node_modules 与产物目录，跳过 .d.ts（类型声明无运行时实体）。 */
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
let total = 0;
for (const scope of scopes) {
  const abs = join(ROOT, scope);
  const files = statSync(abs).isDirectory() ? collectFiles(abs) : [abs];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const m = EXPORT_FN.exec(lines[i]);
      if (!m || !isFunctionDecl(lines[i])) continue;
      total += 1;
      if (CJK.test(docAbove(lines, i))) continue;
      rows.push({ file: relative(ROOT, f).replace(/\\/g, "/"), line: i + 1, name: m[1] });
    }
  }
}

if (groupsOnly) {
  const byFile = {};
  for (const r of rows) byFile[r.file] = (byFile[r.file] || 0) + 1;
  const byGroup = {};
  for (const [f, n] of Object.entries(byFile)) {
    const key = f.split("/").slice(0, 2).join("/");
    byGroup[key] = (byGroup[key] || 0) + n;
  }
  for (const [k, n] of Object.entries(byGroup).sort((a, b) => b[1] - a[1])) {
    const files = Object.keys(byFile).filter((f) => f.startsWith(k)).length;
    console.log(`${n}\t${k}\t(${files} 文件)`);
  }
} else {
  for (const r of rows) console.log(`${r.file}:${r.line}\t${r.name}`);
}

console.log(`\n导出函数 ${total} 个 / 缺中文注释 ${rows.length} 个（守卫【295】要求 0）`);
if (rows.length) process.exitCode = 1;
