/**
 * scripts/check-bag-types.mjs —— 【93】`parts/bag-types.ts` 防漂移守卫
 *
 * 背景：`useHarnessApp` 按序切成 9 个 part / 30 个子 hook 后，跨段引用一律走 `bag.X`。
 * `bag-types.ts`（1,348 项）是**自动生成**的跨 part **类型真相源**，由 TypeChecker 在
 * **切分前的原文件**上推断而来。切分完成后原文件已不存在 ⇒ 一旦某个 part 的声明改了类型、
 * 或有人手改了 bag-types，两边就会**静默分叉**：读 `bag.X` 的一方拿到过期类型，而
 * 全部 1,348 处镜像赋值都带 `as typeof bag.X` 断言 ⇒ **tsc 依然全绿**。
 *
 * 本守卫用「**当前 parts** 重新推断」替代「原文件」这个已消失的参照物：
 *   ① 从 30 个子 hook 的函数体逐个取顶层声明的类型（与生成器同一套口径）；
 *   ② 与现有 `bag-types.ts` 的 Bag 属性逐项比对（名字集合 + 类型串）。
 *
 * 比对前对**两边同施**归一化：剥掉 `import("…").` 限定符并折叠空白。
 * 为什么需要：原文件里 `RateLimitCtx` / `BotEntry` 是**体内局部类型**，typeToString 给裸名；
 * 切分后它们移到 `./types` 并被导入，同一个类型会显示成 `import("./types.ts").RateLimitCtx`。
 * 两种写法指同一类型，不归一化会产出 6 条假差异（实测）。
 *
 * 用法：`npm run check`（已接进链）或直接 `node scripts/check-bag-types.mjs`
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, posix, relative, dirname, basename } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const PARTS = join(ROOT, "src", "features", "app-state", "parts");
const BAG = join(PARTS, "bag-types.ts");

/* 未切分 / 非本仓（例如公开仓库）⇒ 跳过，不算失败 */
if (!existsSync(BAG)) {
  console.log("【93】bag-types.ts 不存在（本仓未做 hook 按序切分）⇒ 跳过");
  process.exit(0);
}
if (!existsSync(join(ROOT, "node_modules", "typescript"))) {
  console.log("【93】找不到 node_modules/typescript ⇒ 跳过");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const ts = require(join(ROOT, "node_modules", "typescript"));

let hardFails = 0;
const ok = (m) => console.log("✓ 【93】" + m);
const fail = (m) => { hardFails++; console.log("✗ 【93】" + m); };

/* ---------- 工程构建 ---------- */
const t0 = Date.now();
const cfgFile = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.app.json");
if (!cfgFile) { fail("找不到 tsconfig.app.json"); process.exit(1); }
const cfg = ts.readConfigFile(cfgFile, ts.sys.readFile);
if (cfg.error) { fail("tsconfig.app.json 读取失败"); process.exit(1); }
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

/* ---------- 归一化 ---------- */
/* ① 剥 `import("…").` 限定符 ② 折叠空白 ③ **联合类型成员排序** ——
   同一联合类型的 typeToString 成员顺序会随 program 构造顺序变化（实测 5 条假差异：
   `"user" | "project" | "background"` vs `"user" | "background" | "project"`）。
   按 `|` 切段排序是幂等的规范形，两边同施 ⇒ 顺序差异消失、真实差异保留。 */
const norm = (s) => String(s)
  .replace(/import\("[^"]+"\)\./g, "")
  .replace(/\s+/g, " ")
  .trim()
  .split("|").map((x) => x.trim()).sort().join("|");

/* ---------- 现有 Bag ---------- */
const bs = program.getSourceFile(BAG);
if (!bs) { fail("bag-types.ts 不在 tsconfig.app.json 的 program 里"); process.exit(1); }
const bagSrc = readFileSync(BAG, "utf8");
if (!/自动生成，请勿手改/.test(bagSrc)) fail("bag-types.ts 头部的「自动生成，请勿手改」标记丢了（它不该被当成手写文件）");

let bagIface = null;
const existing = new Map();
for (const st of bs.statements) {
  if (ts.isInterfaceDeclaration(st) && st.name.text === "Bag") bagIface = st;
}
if (!bagIface) {
  fail("bag-types.ts 里找不到 `export interface Bag`");
} else {
  for (const m of bagIface.members) {
    if (ts.isPropertySignature(m) && m.name) {
      const nm = ts.isStringLiteral(m.name) ? m.name.text : m.name.getText(bs);
      existing.set(nm, m.type ? m.type.getText(bs) : "");
    }
  }
}

/* ---------- 防空转：数量下限 ---------- */
const MIN_PROPS = 1000, MIN_HOOKS = 20;
if (existing.size < MIN_PROPS) fail(`Bag 属性只有 ${existing.size} 个（下限 ${MIN_PROPS}）—— 守卫可能扫空了，别放过`);
else ok(`Bag 属性 ${existing.size} 个`);

/* ---------- 从当前 parts 重新推断 ---------- */
const EXTS = ["", ".ts", ".tsx", ".mjs", ".mts", ".js", ".d.ts", "/index.ts", "/index.tsx"];
const probe = (abs) => { for (const e of EXTS) { try { if (existsSync(abs + e) && statSync(abs + e).isFile()) return e; } catch { /* 忽略 */ } } return null; };
const FLAG = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType;
function collectNames(n, out) {
  if (ts.isIdentifier(n)) { out.push(n); return; }
  if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))
    for (const el of n.elements) if (ts.isBindingElement(el)) collectNames(el.name, out);
}

/* ⛔ 必须**递归**扫：09-22 把若干子 hook 又切了一层（`parts/partNN/NN-name/*.tsx`），
   只扫一层会让 419 个名字被判成「已无人声明」而集体假红（实测）。 */
const hookFiles = [];
const walkHooks = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { walkHooks(p); continue; }
    if (/\.tsx$/.test(e.name)) hookFiles.push(p);
  }
};
for (const d of readdirSync(PARTS, { withFileTypes: true })) {
  if (d.isDirectory() && /^part\d+$/.test(d.name)) walkHooks(join(PARTS, d.name));
}
if (hookFiles.length < MIN_HOOKS) fail(`只扫到 ${hookFiles.length} 个子 hook（下限 ${MIN_HOOKS}）`);
else ok(`扫 ${hookFiles.length} 个子 hook（含二次切分层）`);

/* ⛔ 组合根不算「声明源」：它的 `const a = useXxx1(bag)` / `return { ...a, ...b }` 是
   装配套路，那些单字母局部名不该进 Bag（实测漏进 a/b 两条假 extra）。判据＝函数体每条语句
   要么是 `const <id> = <useXxx 调用>`，要么是 `return <对象字面量>`。 */
function isCombiner(fn) {
  const body = fn.body.statements;
  if (!body.length) return false;
  let rets = 0;
  for (const st of body) {
    if (ts.isReturnStatement(st)) {
      if (!st.expression || !ts.isObjectLiteralExpression(st.expression)) return false;
      if (st.expression.properties.some((p) => !ts.isSpreadAssignment(p))) return false;
      rets++;
      continue;
    }
    if (ts.isVariableStatement(st)) {
      const okDecl = st.declarationList.declarations.every((d) =>
        ts.isIdentifier(d.name) && d.initializer && ts.isCallExpression(d.initializer) &&
        ts.isIdentifier(d.initializer.expression) && /^use[A-Z]/.test(d.initializer.expression.text));
      if (okDecl) continue;
    }
    return false;
  }
  return rets === 1;
}

const inferred = new Map();
let combiners = 0, nonHook = 0;
for (const hf of hookFiles) {
  const sf = program.getSourceFile(hf);
  if (!sf) { fail(`子 hook 不在 program 里：${relative(ROOT, hf).replace(/\\/g, "/")}`); continue; }
  let fn = null;
  for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && st.name && st.body && /^use[A-Z]/.test(st.name.text)) fn = st;
  /* 二次切分 / 整函数外提会产生「非 hook 文件」（如 open-thread.tsx 只导出 openThread）
     ⇒ 没有 useXxx 就不是 hook 文件，跳过；它本来也不声明 Bag 里的名字。 */
  if (!fn) { nonHook++; continue; }
  if (isCombiner(fn)) { combiners++; continue; }
  for (const st of fn.body.statements) {
    const ids = [];
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) collectNames(d.name, ids);
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) ids.push(st.name);
    for (const id of ids) {
      const nm = id.getText(sf);
      if (inferred.has(nm)) continue;
      let s = null;
      try { const ty = checker.getTypeAtLocation(id); if (ty) s = checker.typeToString(ty, undefined, FLAG); } catch { s = null; }
      if (!s || s === "any" || s === "unknown") { inferred.set(nm, "any"); continue; }
      /* 与生成器同一套路径相对化，保证两边可比 */
      s = s.replace(/import\("([^"]+)"\)/g, (m, p) => {
        const raw = p.replace(/\\/g, "/");
        if (/\/useHarnessApp$/.test(raw)) return 'import("./types")';
        const ext = probe(raw);
        const target = ext ? raw + ext : raw;
        let rel = posix.relative(PARTS.replace(/\\/g, "/"), target);
        if (!rel.startsWith(".")) rel = "./" + rel;
        return 'import("' + rel + '")';
      });
      inferred.set(nm, s);
    }
  }
}
ok(`从当前 parts 推断出 ${inferred.size} 个名字（跳过 ${combiners} 个组合根 / ${nonHook} 个非 hook 文件）`);

/* ---------- 逐项比对 ---------- */
const missing = [], extra = [], mismatch = [];
for (const [nm, s] of inferred) {
  if (!existing.has(nm)) { missing.push(nm); continue; }
  if (norm(existing.get(nm)) !== norm(s)) mismatch.push({ nm, bag: norm(existing.get(nm)), now: norm(s) });
}
for (const nm of existing.keys()) if (!inferred.has(nm)) extra.push(nm);

const detail = (list) => list.slice(0, 8).map((x) => "\n      " + (typeof x === "string" ? x : x)).join("");

if (missing.length) fail(`推断有、Bag 没有（${missing.length}）：${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
else ok("名字覆盖：推断出的每个名字都在 Bag 里（0 missing）");

if (extra.length) fail(`Bag 有、当前 parts 里已无人声明（${extra.length}）：${extra.slice(0, 8).join(", ")}${extra.length > 8 ? " …" : ""}`);
else ok("反向覆盖：Bag 里每个名字都仍有人声明（0 extra）");

if (mismatch.length) {
  fail(`类型串不一致（${mismatch.length}）—— bag-types 已过期，请重新生成：`);
  for (const m of mismatch.slice(0, 8)) {
    console.log("      " + m.nm);
    console.log("        Bag（现用）: " + m.bag.slice(0, 150));
    console.log("        实现（今）  : " + m.now.slice(0, 150));
  }
  if (mismatch.length > 8) console.log("      …（其余 " + (mismatch.length - 8) + " 项略）");
} else {
  ok("类型串逐项一致（0 mismatch）");
}

console.log("");
console.log(hardFails === 0
  ? `【93】bag-types 防漂移守卫通过（Bag ${existing.size} 项 / 推断 ${inferred.size} 项 / ${((Date.now() - t0) / 1000).toFixed(1)}s）`
  : `【93】bag-types 防漂移守卫失败：${hardFails} 项`);
process.exit(hardFails === 0 ? 0 : 1);
