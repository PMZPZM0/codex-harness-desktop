/* 三仓同步注释的第 ① 步：把本仓「文件@函数=已有中文注释」导出成清单，交给另外两仓 apply-notes 复用。
   ⛔ 只读源码、只写清单；⛔ 不整份拷文件（三仓实现已分叉，整份拷会覆盖对方独有代码）。

   用法：
     node scripts/tools/annotate/export-notes.mjs [输出路径]
   默认输出到 `.workbuddy/tmp/all-notes.txt`（临时产物，不进仓）。
*/
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const ROOT = process.cwd();
const outPath = process.argv[2] || join(".workbuddy", "tmp", "all-notes.txt");

const EXPORT_FN = /^\s*export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/;
/* 只认**紧贴上方一行**的 `/** 一句中文 *​/` —— 多行注释块是文件头/段落说明，不是这条函数的注释。 */
const ONE_LINE_DOC = /^\/\*\* (.+) \*\/$/;
const CJK = /[\u4e00-\u9fa5]/;

/** 判断声明行是不是函数形态。⛔ 必须与 gap.mjs / apply-notes.mjs 同口径：
    只导函数注释（常量表如 `EFFORT_BANDS` 也算导出，但 apply 侧只认函数，混进来只会变成假「未命中」）。 */
function isFunctionDecl(line) {
  return /^\s*export\s+(?:async\s+)?function\b/.test(line)
    || /=\s*(?:async\s*)?(?:function\b|\()/.test(line)
    || /=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/.test(line);
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
for (const dir of ["src", "electron"]) {
  for (const f of collectFiles(join(ROOT, dir))) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const m = EXPORT_FN.exec(lines[i]);
      if (!m || !isFunctionDecl(lines[i])) continue;
      const hit = ONE_LINE_DOC.exec((lines[i - 1] || "").trim());
      if (!hit || !CJK.test(hit[1])) continue;
      rows.push(`${relative(ROOT, f).replace(/\\/g, "/")}@${m[1]}=${hit[1]}`);
    }
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, rows.join("\n") + "\n");
console.log(`导出注释 ${rows.length} 条 → ${outPath}`);
