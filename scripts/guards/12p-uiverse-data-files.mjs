/**
 * 12p-uiverse-data-files.mjs —— 【组件库数据可达性】判据（10-15 立）
 *
 * 起因：用户问「加个工具让 Codex 能调 3000 多个内置组件」，核实工具**早在 10-01 就有了**
 * （dispatch-core 的 ui_component_search / ui_component_get + developer-instructions 第 12 条，
 * 守卫【235】钉着）—— 但顺着数据端查出一处**打包版才暴露**的缺口：
 *
 *   · 引擎那两个工具的数据端 `electron/features/uiverse-library.ts` 只认**文件**
 *     （`dist/assets/<Cat>.html-*.gz` 前缀匹配，dev 才回落 `src/lib/ui-skin/data/`）；
 *   · 而 `src/lib/ui-skin/load.ts` 的 `?url` 导入受 `assetsInlineLimit: 65536` 支配 ——
 *     小于 64KB 的类目被内联成 data URI：实测 Notifications(24K) / Patterns(13K) / Tooltips(61K)
 *     三项内联 ⇒ dist 里只有 8 个 .gz；
 *   · 打包版 `files` 只带 `dist/**`（src 不随包）⇒ 回落路径不存在 ⇒ 这三类在装机后 **0 条**，
 *     模型少看 188 个组件（合计本该 3802）。
 *
 * 修法 = 11 条导入一律加 `?no-inline`（渲染层照旧，主进程读得到）。本守卫钉住：
 *   ① 源码侧 11 条导入都带 no-inline（少了就又会有类目被内联）；
 *   ② **真产物**：dist/assets 下 11 类都有 .gz 文件 + 构建产物里不含内联的 gzip base64；
 *   ③ 类目清单在 load.ts（渲染层）与 uiverse-library.ts（主进程）两处**逐字一致**（同源义务）。
 * ⛔ dist 缺失 ⇒ 硬失败并提示先 build（check 链里 build 在守卫之前；独立跑也要显式 build）。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【uiverse-data】${message}`);
  if (!condition) fails++;
};

const loadSrc = read("src/lib/ui-skin/load.ts");
const libSrc = read("electron/features/uiverse-library.ts");

/* ── ① 源码侧：11 条导入都带 ?url&no-inline ── */
const imports = [...loadSrc.matchAll(/from "\.\/data\/[^"]+\.html\.gz\?([^"]*)"/g)].map((m) => m[1]);
ok(imports.length === 11 && imports.every((q) => /(^|&)no-inline(&|$)/.test(q)),
  `11 条类目导入都带 \`?url&no-inline\`（实测 ${imports.length} 条，裸 ?url 的 ${imports.filter((q) => !/(^|&)no-inline(&|$)/.test(q)).length} 条）—— 少了 no-inline，<64KB 的类目会被内联、主进程读不到`);

/* ── ② 真产物：11 类 .gz 文件 + 无内联 gzip ── */
const assetsDir = join(ROOT, "dist", "assets");
if (!existsSync(assetsDir)) {
  ok(false, "dist/assets 不存在 —— 先 `npm run build`（本守卫跑在 check 链的 build 之后）");
} else {
  const files = readdirSync(assetsDir);
  const gzByCat = new Map();
  for (const f of files) {
    const m = /^(.+)\.html-[^/]*\.gz$/.exec(f);
    if (m) gzByCat.set(m[1], f);
  }
  const cats = [...libSrc.matchAll(/^\s{2}(?:"([^"]+)"|([A-Za-z-]+)):\s*"/gm)].map((m) => m[1] ?? m[2]);
  ok(cats.length === 11, `主进程 CAT_LABEL 解析出 11 个类目（实测 ${cats.length}）`);
  const missing = cats.filter((c) => !gzByCat.has(c));
  ok(missing.length === 0,
    `dist/assets 里 11 类都有 .gz 文件（缺：${missing.join("、") || "无"}）—— 缺的类目在打包版里模型一条都取不到`);
  let inline = 0;
  for (const f of files.filter((x) => x.endsWith(".js"))) {
    inline += (readFileSync(join(assetsDir, f), "utf8").match(/data:application\/gzip;base64/g) ?? []).length;
  }
  ok(inline === 0, `构建产物里没有内联的 gzip base64（实测 ${inline} 处）—— 出现即说明又有类目被内联走了`);
}

/* ── ③ 类目清单两处同源（渲染层 urlOf 键 == 主进程 CAT_LABEL 键） ── */
const renderCats = [...loadSrc.matchAll(/^\s{2}(?:"([^"]+)"|([A-Za-z-]+)):\s*[a-zA-Z]+Url,/gm)].map((m) => m[1] ?? m[2]);
const mainCats = [...libSrc.matchAll(/^\s{2}(?:"([^"]+)"|([A-Za-z-]+)):\s*"[^"]*",\s*$/gm)].map((m) => m[1] ?? m[2]);
ok(renderCats.length === 11 && mainCats.length === 11 && renderCats.every((c, i) => c === mainCats[i]),
  `渲染层 urlOf 与主进程 CAT_LABEL 的类目清单逐字同序（渲染 ${renderCats.length} / 主进程 ${mainCats.length}）`);

console.log(fails ? `\n【uiverse-data】${checks} 条断言 / ${fails} 条失败` : `\n【uiverse-data】${checks} 条断言全部通过`);
process.exit(fails ? 1 : 0);
