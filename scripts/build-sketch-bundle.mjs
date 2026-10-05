/**
 * scripts/build-sketch-bundle.mjs —— 刷新「手机前端UI」内嵌产物（m3e-canvas 静态导出，展示名 10-05 夜从「界面草图」改来）
 *
 * 干什么：把上游 `next build`（output:"export"）的产物落进 `public/sketch/`，顺手做三件
 * 我们必须自己做的事 —— ① 删掉只服务于 GitHub Pages 的死文件；② **把两个 Google Fonts
 * 外链本地化**（桌面应用离线也要有图标：Material Symbols 是这套 UI 的**全部图标**，
 * 字体拿不到时它们会退化成 "home" / "add_circle" 这样的**单词**，看着就是坏了）；
 * ③ 把 `scripts/sketch-bridge.js` 原样内联进 index.html（宿主↔画布的双向通道）。
 *
 * ⛔ 这是**人工刷新工具**，不进 `npm run check`、不进 CI：它要联网、要上游源码 + Next 工具链。
 *    产物 `public/sketch/` 是**提交进仓库的**（Vite 每次 build 拷进 dist/sketch，
 *    `package.json` 的 `files: ["dist/**"]` 收进 asar；`clean-dist.mjs` 会整目录抹掉 dist，
 *    所以源只能是 public/，⛔ 手放 dist/ 必丢）。
 *
 * 用法（先在上游源码目录 `npm install && npm run build` 得到 out/）：
 *   node scripts/build-sketch-bundle.mjs --from .workbuddy/tmp/m3e-src/m3e-canvas-main/out
 *   node scripts/build-sketch-bundle.mjs --from <out> --no-fonts     # 离线时跳过字体本地化
 */

import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT_DIR = join(ROOT, "public", "sketch");
const BRIDGE = join(ROOT, "scripts", "sketch-bridge.js");
const bridgeSource = readFileSync(BRIDGE, "utf8");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Pages 才用得到的死文件：社交预览图与 404 页（应用内没有任何引用）。 */
const PRUNE = ["og.png", "404", "404.html", "_not-found", ".gitignore", ".nojekyll"];

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : fallback;
};
const from = resolve(argOf("from", join(ROOT, ".workbuddy/tmp/m3e-src/m3e-canvas-main/out")));
const wantFonts = !argv.includes("--no-fonts");

/* 只换桥：产物已经在仓库里，改 scripts/sketch-bridge.js 不该要求你重新装一套 Next 工具链。
   ⛔ 替换用函数形式：桥正文里出现 `$&` 之类的串会被 String.replace 当成捕获组引用。 */
if (argv.includes("--bridge-only")) {
  const index = join(OUT_DIR, "index.html");
  if (!existsSync(index)) {
    console.error(`✗ ${relative(ROOT, index)} 不存在 —— 首次接入要跑完整刷新（--from <next export out/>）`);
    process.exit(1);
  }
  const html = readFileSync(index, "utf8");
  const pattern = /<script data-nuphus-sketch-bridge="1">[\s\S]*?<\/script>/;
  if (!pattern.test(html)) throw new Error("产物里找不到桥那一段：--bridge-only 只能替换已有的注入");
  const tag = `<script data-nuphus-sketch-bridge="1">\n${bridgeSource}\n</script>`;
  writeFileSync(index, html.replace(pattern, () => tag));
  console.log(`只换桥：${relative(ROOT, index)} ${html.length} → ${readFileSync(index, "utf8").length} 字节（其余产物一字未动）`);
  console.log("下一步：npm run build（public/ 进 dist/）");
  process.exit(0);
}

if (!existsSync(join(from, "index.html")) || !existsSync(join(from, "_next"))) {
  console.error(`✗ ${from} 不是 next build 的静态导出（缺 index.html 或 _next/）`);
  process.exit(1);
}

/* ───────────────────────── 字体本地化 ───────────────────────── */

/** 取回 css2 样式表，只保留指定子集，把 gstatic 的 woff2 下到本地并改成相对路径。 */
async function localizeFont({ cssUrl, prefix, cssName, keepSubsets }) {
  const res = await fetch(cssUrl, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${cssUrl}`);
  const css = await res.text();
  /* Google 的 css2 输出：每个 @font-face 前有一行 /* latin *\/ 之类的子集注释 */
  const blocks = [];
  const pattern = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?(@font-face\s*\{[^}]*\})/g;
  for (let m = pattern.exec(css); m; m = pattern.exec(css)) blocks.push({ subset: m[1] ?? "", body: m[2] });
  const picked = keepSubsets ? blocks.filter((b) => keepSubsets.includes(b.subset || "fallback")) : blocks;
  if (!picked.length) throw new Error(`样式表里没有可用 @font-face（子集=${(keepSubsets ?? []).join(",")}）`);
  let text = "";
  const files = [];
  for (const block of picked) {
    const urls = [...block.body.matchAll(/https:\/\/fonts\.gstatic\.com\/[^\s)]+/g)].map((m) => m[0]);
    let body = block.body;
    for (const url of [...new Set(urls)]) {
      const name = `${prefix}-${url.split("/").pop()}`;
      const fontRes = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) });
      if (!fontRes.ok) throw new Error(`字体下载失败 HTTP ${fontRes.status} ${url}`);
      writeFileSync(join(OUT_DIR, "fonts", name), Buffer.from(await fontRes.arrayBuffer()));
      body = body.split(url).join(`./${name}`);
      files.push(name);
    }
    text += `${body}\n`;
  }
  writeFileSync(join(OUT_DIR, "fonts", cssName), text);
  return { faces: picked.length, files };
}

/* ───────────────────────── 拷贝 + 改写 ───────────────────────── */

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, "fonts"), { recursive: true });
cpSync(from, OUT_DIR, {
  recursive: true,
  filter: (src) => !PRUNE.includes(relative(from, src).split(sep)[0]),
});
console.log(`拷贝 ${walk(from).length} 个文件 → public/sketch/（剪掉 ${PRUNE.length} 类 Pages 死文件）`);

/* MIT 许可与致谢必须随产物走（上游的 LICENSE / NOTICE 在源码目录根，不在 out/ 里） */
for (const name of ["LICENSE", "NOTICE"]) {
  const src = join(from, "..", name);
  if (existsSync(src)) cpSync(src, join(OUT_DIR, name));
}

let html = readFileSync(join(OUT_DIR, "index.html"), "utf8");
const before = html.length;
/* ⛔ 字体改写与桥注入**只允许动 `</head>` 之前**：10-05 实测，整文件正则会把 body 里那段
   React flight 数据（`self.__next_f.push([1,"…"])`，里面原样嵌着 <head> 的元数据标记）咬断，
   表现是「Uncaught SyntaxError: Invalid or unexpected token @index.html:118」+ 画布永远停在骨架屏
   —— 而 next 的产物本身是**一整行**，人眼根本看不出少了哪一段。 */
const headEnd = html.indexOf("</head>");
if (headEnd < 0) throw new Error("index.html 里没有 </head>，注入点找不到");
let head = html.slice(0, headEnd);
const tail = html.slice(headEnd);

if (wantFonts) {
  const roboto = await localizeFont({
    cssUrl: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap",
    prefix: "roboto", cssName: "roboto.css",
    /* 只留 latin：CJK 本来就走系统字体回落，带 cyrillic/greek/vietnamese 的 30 多个子集是死重 */
    keepSubsets: ["latin"],
  });
  const symbols = await localizeFont({
    cssUrl: "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400..700,0..1,0&display=block",
    prefix: "symbols", cssName: "material-symbols-rounded.css",
  });
  head = head
    .replace(/<link rel="(?:preconnect|preload)"[^>]*fonts\.(?:googleapis|gstatic)[^>]*\/?>/g, "")
    .replace(/https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto:wght[^"']*/g, "/fonts/roboto.css")
    .replace(/https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols[^"']*/g, "/fonts/material-symbols-rounded.css");
  console.log(`字体本地化：Roboto ${roboto.faces} face / 符号 ${symbols.faces} face（${symbols.files.join(", ")}）`);
} else {
  console.log("跳过字体本地化（--no-fonts）：离线打开时图标会退化成字母文本");
}

/* 桥：注入在 head 末尾（defer 语义下 head 内联脚本在 DOMContentLoaded 前跑完，
   比 body 尾部的产物脚本更早注册 message 监听 ⇒ 宿主 onload 后 ping 一定收得到）。 */
const bridgeTag = `<script data-nuphus-sketch-bridge="1">\n${bridgeSource}\n</script>`;
if (/<script data-nuphus-sketch-bridge/.test(html)) throw new Error("产物里已经有桥：请先删掉 public/sketch 再重跑");
html = `${head}${bridgeTag}\n${tail}`;
/* 自检：body 那一段必须**逐字节没动**（这是上面那条事故的永久防线）。 */
if (!html.endsWith(tail)) throw new Error("注入后 </head> 之后的内容被改动了，产物会白屏");
writeFileSync(join(OUT_DIR, "index.html"), html);

/* 出处记录：将来"这版产物是哪来的"必须能一句话回答，别靠记忆。 */
const upstream = JSON.parse(readFileSync(join(from, "..", "package.json"), "utf8"));
writeFileSync(join(OUT_DIR, "CANVAS-BUILD.json"), JSON.stringify({
  source: "https://github.com/lnkiai/m3e-canvas",
  license: upstream.license ?? "MIT",
  upstreamVersion: upstream.version,
  next: (upstream.dependencies ?? {}).next,
  builtAt: new Date().toISOString().slice(0, 10),
  fontsLocalized: wantFonts,
  bridge: "scripts/sketch-bridge.js",
  rebuiltBy: "node scripts/build-sketch-bundle.mjs --from <next export out/>",
  files: walk(OUT_DIR).length,
  bytes: walk(OUT_DIR).reduce((sum, file) => sum + statSync(file).size, 0),
  indexHtmlBytes: html.length,
}, null, 2));

console.log(`index.html ${before} → ${html.length} 字节；产物 ${walk(OUT_DIR).length} 个文件`);
console.log("下一步：npm run build（public/ 进 dist/）后由 sketch:// 协议加载");
