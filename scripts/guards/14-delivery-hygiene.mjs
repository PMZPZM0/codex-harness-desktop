/**
 * 守卫组 14 —— 交付卫生（【291】前端死代码 / 【292】后端死路由 / 【293】字体与许可）。
 * 11-08 用户令：「检查有没有前端无效代码、字体是否完全免费可商用、后端有没有没清理掉的路由接口，
 * 这三条要写进规范」。规范落在 `docs/ARCHITECTURE-RULES.md` §12；这里把三条做成**机械判据**，
 * 免得下次又靠人记得。
 *
 * 为什么需要守卫（11-08 实测）：
 *   · 渲染层有 5 个**零引用**文件（WorkBuddy 复刻 demo ×2、被 11-team-cards 取代的旧卡片渲染器、
 *     一个「多处共用」但根本没人的状态文案模块、一个只有注释说要用它的流程图组件）+
 *     一个**没人走的板块出口**（`event-broadcast/index.ts`，AppView 绕过它直接进子文件）；
 *   · 后端 645 条通道里有 61 条**渲染层一次都没调过**（含一条 `favorites:clear`：
 *     不带 id 一把清空，与【129】「删除只认显式 id 列表」直接冲突 —— 后门级）；
 *   · `font-family` 里写着 `Inter`，但本项目**一个字体文件都不打包**、也没有 @font-face
 *     ⇒ 那条永远落空，只留"我们好像用了 Inter"的错觉（还容易被误当成授权风险）。
 *
 * 三条判据的口径（⛔ 别放宽，放宽等于取消）：
 *   ① 孤儿模块：从 `src/main.tsx` 沿 import / 动态 import / require / CSS @import 走一遍，
 *      `src/` 下任何 `.ts/.tsx/.mts/.css` 都必须可达。`.d.mts` / `.d.ts` 是类型声明（同名运行时
 *      模块的伴生文件），**不算孤儿**。新加文件除非从入口接上，否则预检直接红。
 *   ② 死路由：manifest 每条通道必须有**真实消费者** —— 渲染层调用（`codex.xxx(` 或
 *      `["xxx"]` 计算属性）或主进程推送（`sendToWindow("同通道")`）。都没有的，必须登记在
 *      `UNWIRED` 名单里；名单是**棘轮**：新出现的死路由 → 红；已接线却没从名单删 → 也红。
 *   ③ 字体：`font-family` 只许系统字体族 + 通用族（不下载、不分发 ⇒ 零授权风险）；
 *      且不许出现指向远程 URL 的 `@font-face`（离线应用 + CSP `font-src 'self'` 双重要求）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { ROOT, ok, fail } from "./_ctx.mjs";

/* ══ ② 已确认「接线未做」的通道（棘轮：只许缩，不许长）══════════════════════
   11-08 首次实测 61 条。它们都是「主进程 + 渲染层桥都齐了、但界面还没接」的功能口，
   ⛔ 不是"可以随便留"：每加一条新通道，要么当场接上消费者，要么进来登记 —— 进名单本身
      就该是一次有意识的决定（并在提交信息里说明为什么先不接线）。
   ⛔ 修好一条就从这里删一条（后半段断言会抓「已接线却没删」）。 */
/* ⛔⛔ 名单是**每仓独立的数据文件**（`scripts/guards/data/unwired-ipc.json`）：
   三仓的通道数本来就不同（主仓 645 / PP 648 / 云仓 647），名单如果写死在守卫里，
   同步守卫就会把别的仓的名单覆盖过来 —— 11-08 实测过一次（PP 的 3 条独有死路由被抹掉）。 */
const UNWIRED_FILE = join(ROOT, "scripts", "guards", "data", "unwired-ipc.json");
const UNWIRED = (() => {
  try { return JSON.parse(readFileSync(UNWIRED_FILE, "utf8")).channels ?? []; } catch { return []; }
})();

/* ══ ③ 允许出现在 font-family 里的族名 ══════════════════════════════════════
   ⛔ 只收「系统自带」与「通用族」：本项目不分发任何字体文件（见下方断言）。
   ⛔ 想用品牌字体 = 先随包带 OFL/Apache 授权的 woff2 + 在此登记 + 在 THIRD_PARTY_NOTICES 注明。 */
const FONT_ALLOW = new Set([
  "system-ui", "-webkit-system-ui", "ui-sans-serif", "ui-monospace", "ui-serif",
  "sans-serif", "serif", "monospace", "cursive", "fantasy",
  "inherit", "initial", "unset", "revert", "revert-layer",
  "segoe ui", "microsoft yahei", "microsoft yahei ui", "simsun", "simhei", "dengxian",
  "consolas", "cascadia code", "cascadia mono", "courier new",
  "sf mono", "sfmono-regular", "menlo", "monaco", "liberation mono", "dejavu sans mono",
  "pingfang sc", "hiragino sans gb", "helvetica neue", "arial",
  "-apple-system", "blinkmacsystemfont", "segoe ui variable", "segoe ui variable text",
]);

/** 走一遍 import / 动态 import / require / CSS @import，返回「从入口可达」的绝对路径集合。 */
function reachableModules() {
  const SRC = join(ROOT, "src");
  const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", ".css"];
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|js|jsx|css)$/.test(e.name)) files.push(p);
    }
  };
  walk(SRC);
  /* ⛔ `export ... from "x"` 也算边：helpers.tsx 这种桶文件就是这样把子模块带起来的
     （09-22 拆域后 18 个符号全走这条，漏了会把整片 helpers 误判成孤儿）。 */
  const RE = [
    /(?:^|\n)\s*(?:import|export)[\s\S]{0,900}?from\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /@import\s+(?:url\()?["']([^"']+)["']/g,
  ];
  const edges = new Map();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const out = new Set();
    for (const re of RE) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const spec = m[1];
        if (!spec.startsWith(".")) continue;
        const base = resolve(dirname(f), spec);
        for (const ext of EXTS) {
          const p = base + ext;
          if (existsSync(p) && statSync(p).isFile()) { out.add(p); break; }
          const idx = join(base, "index" + ext);
          if (existsSync(idx) && statSync(idx).isFile()) { out.add(idx); break; }
        }
      }
    }
    edges.set(f, out);
  }
  const seen = new Set();
  const stack = [];
  const entry = join(ROOT, "src", "main.tsx");
  if (existsSync(entry)) stack.push(entry);
  const html = existsSync(join(ROOT, "index.html")) ? readFileSync(join(ROOT, "index.html"), "utf8") : "";
  for (const m of html.matchAll(/src="\/([^"]+)"/g)) {
    const p = join(ROOT, m[1]);
    if (existsSync(p)) stack.push(p);
  }
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nxt of edges.get(cur) ?? []) if (!seen.has(nxt)) stack.push(nxt);
  }
  return { files, seen };
}

export async function run() {
  console.log("\n【291】交付卫生：前端死代码 / 后端死路由 / 字体与许可");

  /* ── ① 孤儿模块 ──────────────────────────────────────────────────────── */
  {
    const { files, seen } = reachableModules();
    /* ⛔ `.d.mts` / `.d.ts` 是类型声明：类型擦除后没有运行时实体，只能被 `import "./x.mjs"`
       的类型解析命中，按"可达"算没意义 —— 排除在判据外（它们由 tsc 校验，不靠图）。 */
    const orphans = files
      .filter((f) => !seen.has(f))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .filter((f) => !/\.d\.(mts|ts)$/.test(f));
    (orphans.length === 0 ? ok : fail)(
      `【291】渲染层零孤儿模块（从 src/main.tsx 可达；实测孤儿 ${orphans.length} 个：${orphans.slice(0, 6).join("/") || "无"}）`
    );
    /* 负向：不许再出现「复刻 demo」这类没有入口的示例组件目录内容 */
    const demo = files
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .filter((f) => /(^|\/)(demo|playground|examples?)\//i.test(f));
    (demo.length === 0 ? ok : fail)(`【291】渲染层不留 demo / playground 目录（实测 ${demo.length} 个）`);
  }

  /* ── ② 后端死路由（四方对账：manifest / preload / 渲染层 / 推送）────────── */
  {
    const manifest = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8"));
    const preload = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
    const bridge = new Map();
    for (const m of preload.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*__ipc\(\s*"([^"]+)"/g)) {
      const [, method, channel] = m;
      if (!bridge.has(channel)) bridge.set(channel, []);
      bridge.get(channel).push(method);
    }
    const srcFiles = [];
    const walkSrc = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walkSrc(p);
        else if (/\.(ts|tsx|mts)$/.test(e.name)) srcFiles.push(p);
      }
    };
    walkSrc(join(ROOT, "src"));
    const srcAll = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");
    /* 推送类通道：主进程主动发给渲染层，没有"调用方"是正常的 */
    const pushes = new Set();
    const walkEl = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walkEl(p);
        else if (/\.ts$/.test(e.name)) for (const m of readFileSync(p, "utf8").matchAll(/sendToWindow\(\s*"([^"]+)"/g)) pushes.add(m[1]);
      }
    };
    walkEl(join(ROOT, "electron"));

    const dead = [];
    for (const entry of manifest.channels) {
      const ch = entry.channel;
      const methods = bridge.get(ch) ?? [];
      const used = methods.some((m) => new RegExp("\\." + m + "\\b").test(srcAll)
        || srcAll.includes('"' + m + '"') || srcAll.includes("'" + m + "'"));
      if (!used && !pushes.has(ch)) dead.push(ch);
    }
    const declared = new Set(UNWIRED);
    const grew = dead.filter((c) => !declared.has(c));
    const stale = UNWIRED.filter((c) => !dead.includes(c));
    (grew.length === 0 && stale.length === 0 ? ok : fail)(
      `【292】没有新增死路由（名单 ${UNWIRED.length} 条只许缩；实测 ${dead.length} 条`
        + `；新出现的死路由：${grew.slice(0, 6).join("/") || "无"}`
        + `；已接线却没从名单删：${stale.slice(0, 6).join("/") || "无"}）`
    );
    /* 每条死路由都必须真的存在于 manifest（防止名单腐烂成写错名字的永久豁免） */
    const ghost = UNWIRED.filter((c) => !manifest.channels.some((e) => e.channel === c));
    (ghost.length === 0 ? ok : fail)(`【292】未接线名单里的通道都真实存在（幽灵项：${ghost.join("/") || "无"}）`);
  }

  /* ── ③ 字体：只许系统族；不许远程 @font-face；不许打包字体文件 ─────────── */
  {
    const stylesDir = join(ROOT, "src", "styles");
    const cssFiles = [join(ROOT, "src", "styles.css")]
      .concat(readdirSync(stylesDir).filter((f) => f.endsWith(".css")).map((f) => join(stylesDir, f)));
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const allCss = cssFiles.filter((f) => existsSync(f)).map((f) => readFileSync(f, "utf8")).join("\n") + "\n" + html;

    const bad = new Set();
    for (const m of allCss.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
      for (const raw of m[1].split(",")) {
        /* ⛔ 值里可能带 `var(--mono, ui-monospace, monospace)` —— 按逗号切完会留下 `monospace)`
           这种尾巴，不清掉就会把合法栈判成越界（11-08 首次实测踩到）。 */
        const token = raw.trim().replace(/^["']|["']$/g, "").replace(/!important/gi, "").replace(/[),;]+$/, "").replace(/^\(+/, "").trim();
        if (!token) continue;
        if (/var\(/i.test(token)) continue;          // 走变量（变量值本身在下面按同一张表校验）
        if (FONT_ALLOW.has(token.toLowerCase())) continue;
        bad.add(token);
      }
    }
    /* 变量里的字体栈（--mono 等）同样要过白名单 */
    for (const m of allCss.matchAll(/--[\w-]*font[\w-]*\s*:\s*([^;]+);/gi)) {
      for (const raw of m[1].split(",")) {
        const token = raw.trim().replace(/^["']|["']$/g, "").trim();
        if (!token || /var\(/i.test(token)) continue;
        if (FONT_ALLOW.has(token.toLowerCase())) continue;
        bad.add(token);
      }
    }
    (bad.size === 0 ? ok : fail)(
      `【293】font-family 只用系统字体族（不下载/不分发 ⇒ 零授权风险；实测越界：${[...bad].join("/") || "无"}）`
    );
    (!/@font-face[\s\S]{0,200}?url\(\s*["']?https?:/i.test(allCss) ? ok : fail)(
      "【293】没有指向远程 URL 的 @font-face（离线应用 + CSP font-src 'self'，外链字体根本不会被加载）"
    );
    /* 负向：本仓不分发字体文件 —— 一旦有人偷偷塞进来，配套的授权说明必须先到位 */
    const fontFiles = [];
    const walkFont = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (!/node_modules|tools|\.git|dist/.test(p)) walkFont(p); }
        else if (/\.(woff2?|ttf|otf|eot)$/i.test(e.name)) fontFiles.push(relative(ROOT, p).replace(/\\/g, "/"));
      }
    };
    walkFont(join(ROOT, "src"));
    (fontFiles.length === 0 ? ok : fail)(
      `【293】src/ 下不分发字体文件（实测 ${fontFiles.length} 个：${fontFiles.slice(0, 3).join("/") || "无"}）—— 要带字体先补 THIRD_PARTY_NOTICES 授权说明`
    );
  }

  /* ── ⑤ 导出函数的中文文档注释（棘轮：只许缩）──────────────────────────────
     11-08 用户令：「给所有函数补好中文注释，方便后续维护，AI 很容易漏掉这些」。
     口径：**导出**函数（`export function` / `export const x = (...) =>`）上方必须有一段含中文的
     注释 —— 导出面是别人（和模型）读代码的第一入口，内部函数不强求（很多就是三行 if）。
     ⛔ 不是要求写长：一句「干什么 / 边界在哪 / 什么情况下别用」就够；⛔ 也不许写和代码不符的废话。
     棘轮：BASELINE 是 11-08 实测缺口，**只许往下减**；补了一批就把数字改小（改大 = 回退，直接红）。 */
  {
    const EXPORT_FN = /^\s*export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)\s*(?:=|\()/;
    const CJK = /[\u4e00-\u9fa5]/;
    let total = 0;
    const gaps = [];
    const walkTs = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (/node_modules|dist|dist-electron/.test(p)) continue; walkTs(p); continue; }
        if (!/\.(ts|tsx|mts)$/.test(e.name) || /\.d\.(mts|ts)$/.test(e.name)) continue;
        const lines = readFileSync(p, "utf8").split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const m = EXPORT_FN.exec(lines[i]);
          if (!m) continue;
          /* 只算函数：`export const X = <非函数表达式>` 跳过 */
          const isFn = /^\s*export\s+(?:async\s+)?function\b/.test(lines[i])
            || /=\s*(?:async\s*)?(?:function\b|\()/.test(lines[i])
            || /=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/.test(lines[i]);
          if (!isFn) continue;
          total += 1;
          let j = i - 1, doc = "";
          while (j >= 0) {
            const t = lines[j].trim();
            if (!t) { j -= 1; if (i - j > 3) break; continue; }
            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.endsWith("*/")) { doc = t + doc; j -= 1; continue; }
            break;
          }
          if (!CJK.test(doc)) gaps.push(relative(ROOT, p).replace(/\\/g, "/") + ":" + (i + 1) + " " + m[1]);
        }
      }
    };
    walkTs(join(ROOT, "src"));
    walkTs(join(ROOT, "electron"));
    /* 11-08 首次实测：2096 个导出函数 / 950 个缺注释；本轮已补 function-menu/store.ts 的 26 条。 */
    const BASELINE = 924;
    (gaps.length <= BASELINE ? ok : fail)(
      `【295】导出函数的中文文档注释只许补不许缺（上限 ${BASELINE}，实测缺 ${gaps.length} / 共 ${total}`
        + `；新增的：${gaps.filter((g) => !g.includes("function-menu/store.ts")).slice(0, 4).join("、") || "无"}）`
    );
  }

  /* ── ④ 依赖许可：直接依赖不许出现 copyleft / 非商用 ───────────────────── */
  {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
    const RISKY = /GPL|AGPL|SSPL|CC-BY-NC|CPAL|OSL|EUPL|Commons Clause/i;
    const risky = [];
    const unknown = [];
    for (const name of deps) {
      const pj = join(ROOT, "node_modules", name, "package.json");
      if (!existsSync(pj)) { unknown.push(name); continue; }
      const sub = JSON.parse(readFileSync(pj, "utf8"));
      const lic = typeof sub.license === "string" ? sub.license
        : sub.license?.type ?? (Array.isArray(sub.licenses) ? sub.licenses.map((l) => l.type).join("/") : "");
      if (!lic) { unknown.push(name); continue; }
      if (RISKY.test(lic)) risky.push(`${name}(${lic})`);
    }
    (risky.length === 0 ? ok : fail)(
      `【294】直接依赖没有 copyleft / 非商用许可（实测 ${deps.length} 个；越界：${risky.join("/") || "无"}）`
    );
    (unknown.length === 0 ? ok : fail)(
      `【294】每个直接依赖都能读到 license 字段（读不到：${unknown.join("/") || "无"}）—— 无字段不等于免费`
    );
  }
}
