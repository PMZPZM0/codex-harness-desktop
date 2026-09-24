/**
 * scripts/check-dead-imports.mjs —— 【94】死导入防复发守卫
 *
 * 背景（09-22 实测）：把 App.tsx 的模块级内容 / useHarnessApp 搬进新文件时，**整块 import 区
 * 被一并复制**过去，于是 barrel / 类型文件 / 各 part 都留着一份「原文件的全量导入」，
 * 绑定的绝大多数在该文件里从未被引用。实测一次性清掉 **1,052 条**（24 文件 / 1,835 行）。
 *
 * 本守卫冻结的不变量（清理后为 0，且语义明确）：
 *
 *   **不存在「整条 import 声明里所有绑定都未使用」且「其模块还有别的引用者」的情况。**
 *
 * 为什么加后面那个限定：还有 56 条「整条全未使用」的声明**必须保留** —— 它们的目标模块
 * 只被本文件 import（删掉会让该模块失去可达路径，进而改变被打包模块集合）。所以
 * 「全未使用」本身不是违规，「全未使用**且可安全删除**」才是。
 *
 * 判定用的三条口径（与 clean-dead-imports.cjs 一致）：
 *  ① 绑定「未使用」= 该名字没出现在文件的**非 import** 语句里；带 `from` 的 re-export 子句
 *     引用的是源模块的导出、不是本地绑定，不计入使用；属性名 / JSX 属性名 / 限定名右半也不计。
 *  ② 副作用 import（无 importClause，如 `import "x.css"`）**不参与判定**（删了会改求值顺序）。
 *  ③ 模块「还有别的引用者」= 按**导入方所在目录解析成绝对路径**后，全仓另有文件 import 同一模块。
 *     解析不到的（第三方包）一律按"有引用者"处理 —— 只为避免误报为可删。
 *
 * 用法：`npm run check`（已接进链）或直接 `node scripts/check-dead-imports.mjs`
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative, basename } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
if (!existsSync(SRC)) { console.log("【94】找不到 src/ ⇒ 跳过"); process.exit(0); }

const require = createRequire(import.meta.url);
const ts = require(join(ROOT, "node_modules", "typescript"));

let hardFails = 0;
const ok = (m) => console.log("✓ 【94】" + m);
const fail = (m) => { hardFails++; console.log("✗ 【94】" + m); };

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dist-electron", "release"]);
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(SRC);

const MIN_FILES = 200;
if (files.length < MIN_FILES) { fail(`只扫到 ${files.length} 个源文件（下限 ${MIN_FILES}）—— 守卫可能扫空了，别放过`); }
else ok(`受检源文件 ${files.length} 个`);

const EXTS = ["", ".ts", ".tsx", ".mjs", ".mts", ".js", "/index.ts", "/index.tsx"];
const resolveSpec = (from, spec) => {
  if (!/^[.\/]/.test(spec)) return null;                 /* 第三方包：见口径③ */
  const abs = resolve(dirname(from), spec);
  for (const e of EXTS) { try { if (existsSync(abs + e) && statSync(abs + e).isFile()) return resolve(abs + e); } catch { /* 忽略 */ } }
  return null;
};
const parseOf = (f) => ts.createSourceFile(basename(f), readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/* 全仓：模块绝对路径 → 引用者集合；裸说明符（第三方包）→ 引用它的文件集合 */
const refBy = new Map();
const bareBy = new Map();
for (const f of files) {
  for (const st of parseOf(f).statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!/^[.\/]/.test(spec)) {
      if (!bareBy.has(spec)) bareBy.set(spec, new Set());
      bareBy.get(spec).add(f);
      continue;
    }
    const abs = resolveSpec(f, spec);
    if (!abs) continue;
    if (!refBy.has(abs)) refBy.set(abs, new Set());
    refBy.get(abs).add(f);
  }
}
const bareUsers = (spec) => [...(bareBy.get(spec) || [])];

/* 逐文件找「整条全未使用 且 可安全删除」 */
const offenders = [];
let sideEffectSkipped = 0, keptLoadBearing = 0, partialKept = 0, unresolvedKept = 0;
for (const f of files) {
  const sf = parseOf(f);
  const stmts = sf.statements;
  if (!stmts.some((s) => ts.isImportDeclaration(s))) continue;

  const used = new Set();
  for (const st of stmts) {
    if (ts.isImportDeclaration(st)) continue;
    if (ts.isExportDeclaration(st) && st.moduleSpecifier) continue;
    (function w(n) {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isProp = (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isQualifiedName(p) && p.right === n) ||
          (ts.isJsxAttribute(p) && p.name === n) ||
          (ts.isBindingElement(p) && p.propertyName === n);
        if (!isProp) used.add(n.text);
      }
      ts.forEachChild(n, w);
    })(st);
  }

  for (const st of stmts) {
    if (!ts.isImportDeclaration(st)) continue;
    if (!st.importClause) { sideEffectSkipped++; continue; }                 /* 口径② */
    const names = [];
    if (st.importClause.name) names.push(st.importClause.name.text);
    const nb = st.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) names.push(e.name.text);
    else if (nb && ts.isNamespaceImport(nb)) names.push(nb.name.text);
    if (!names.length) { sideEffectSkipped++; continue; }
    const unused = names.filter((n) => !used.has(n));
    if (!unused.length) continue;
    if (unused.length < names.length) { partialKept++; continue; }           /* 部分未使用：本轮不判 */
    /* 口径③：解析得到的相对模块按绝对路径找引用者；裸说明符（第三方包）按**同一个包**找引用者。
       ⛔ 解析不到的相对路径按"有引用者"处理（保守，宁可漏报不误报）。 */
    const spec = st.moduleSpecifier.text;
    let others;
    if (/^[.\/]/.test(spec)) {
      const abs = resolveSpec(f, spec);
      if (!abs) { unresolvedKept++; continue; }
      others = [...(refBy.get(abs) || [])].filter((x) => x !== f);
    } else {
      others = bareUsers(spec).filter((x) => x !== f);
    }
    if (!others.length) { keptLoadBearing++; continue; }                     /* 承重，保留 */
    offenders.push({ file: relative(ROOT, f).replace(/\\/g, "/"), spec, names });
  }
}

if (offenders.length) {
  fail(`存在 ${offenders.length} 条「整条死导入且可安全删除」—— 它们不承重，应当删掉：`);
  for (const o of offenders.slice(0, 12)) {
    console.log("      " + o.file + "  ← " + o.spec + "  （" + o.names.length + " 个绑定，例：" + o.names.slice(0, 4).join(",") + "）");
  }
  if (offenders.length > 12) console.log("      …（其余 " + (offenders.length - 12) + " 条略）");
  console.log("      修法：node .workbuddy/tmp/clean-dead-imports.cjs --apply（或手工删该 import）");
} else {
  ok("可安全删除的整条死导入 = 0（不变量成立）");
}

console.log("");
console.log("【94】明细：承重保留 " + keptLoadBearing + " 条（模块仅本文件引用）· 部分未使用保留 " + partialKept + " 条 · 副作用 import 跳过 " + sideEffectSkipped + " 条");
process.exit(hardFails === 0 ? 0 : 1);
