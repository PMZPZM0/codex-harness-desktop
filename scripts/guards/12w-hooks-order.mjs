/**
 * 【hooks-order】React 钩子不许写在「提前 return」之后（React #310 白屏的结构防线）。
 *
 * 为什么单独建这条：同一个坑在本项目已经**踩了三次**（09-26 `lensCtxRef`、10-31 又一处、
 * 11-01 放大镜滚轮的 `useEffect`）。已有守卫全是**点对点**断言（盯着某个具体变量名），
 * 换个文件/换个变量名就拦不住 ⇒ 需要按**结构**判断的通用检查。
 *
 * 判据（按函数作用域，不是整文件 —— 整文件判会把「A 组件的早返回 + B 组件的 hook」误报）：
 *   ① 用 `{` / `}` 的深度追踪切出每个函数体；
 *   ② 函数体内出现「2 空格缩进的 `if (…) return …`」= 提前返回；
 *   ③ 它**之后**同一函数体内还有 2 空格缩进的 `useXxx(` ⇒ 那次渲染 hook 数量会变 ⇒ #310。
 *
 * ⛔ 不算的：更深缩进的 return（if 块内部 / `.map()` 回调里）不是提前返回；
 *   `useEffect(() => { … return () => {} })` 里的 return 是清理函数（它是 4+ 空格缩进）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/* ⛔ 不能用 URL.pathname：它把空格编码成 %20 ⇒ readdirSync 直接 ENOENT（本仓路径含空格，必踩）。 */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const FUNC_START = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$]|^(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:memo\(|forwardRef\(|\([^)]*\)\s*=>|\([^)]*\)\s*:\s*[^=]+=>|function)/;
const EARLY_RETURN = /^ {2}if \(.+\) return (?:null|undefined|;|\(|<)/;
const TOP_HOOK = /^ {2}(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s*=?\s*use[A-Z][\w$]*\(|^ {2}use[A-Z][\w$]*\(/;

const failures = [];

function scan(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  let depth = 0;
  let inFn = false;
  let guardAt = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFn && FUNC_START.test(line)) { inFn = true; guardAt = -1; }

    if (inFn) {
      if (EARLY_RETURN.test(line)) guardAt = i;
      else if (guardAt >= 0 && TOP_HOOK.test(line)) {
        failures.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${i + 1} —— 钩子在提前 return（第 ${guardAt + 1} 行）之后`);
        return;
      }
    }

    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (inFn && depth <= 0) { inFn = false; guardAt = -1; depth = 0; }
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(tsx|ts)$/.test(entry.name)) continue;
    scan(full);
  }
}

walk(join(ROOT, "src"));

if (failures.length) {
  console.log(`  ✗ 【hooks-order】${failures.length} 处钩子写在提前 return 之后（React #310 白屏的成因）：`);
  for (const f of failures) console.log(`      ${f}`);
  process.exit(1);
}
console.log("  ✓ 【hooks-order】没有钩子写在提前 return 之后（组件 hook 数量恒定）");
