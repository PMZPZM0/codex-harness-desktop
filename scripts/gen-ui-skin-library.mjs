/**
 * Uiverse 组件库 · 预处理（ingest）
 *
 * 输入：`D:/临时1/galaxy/<Cat>/*.html`（Uiverse.io Galaxy 镜像，MIT 许可）
 * 输出（进仓库）：
 *   src/lib/ui-skin/data/<Cat>.html.gz          —— 每类一个 gzip（运行时 DecompressionStream 解压）
 *   src/lib/ui-skin/catalog.gen.ts              —— 轻量目录（全量 id/author/name，搜索用；不含正文）
 *
 * 消费方（10-01 个性化皮肤已删，只剩组件库）：渲染层组件库设置页 + SkinHost 预览、
 * 主进程 uiverse-library.ts（引擎 MCP 工具 ui_component_*）。
 * 设计要点：
 *   ⛔ 全量正文 ≈ 34MB，进 git/dist 都太大 ⇒ gzip 后 ~2.3MB，且按类**懒加载**（点开才解压那一类）。
 *   ⛔ 元素是 HTML+CSS 纯静态（实测 0 script / 0 内联事件），无需消毒；但 ingest 仍剥 <script> 兜底。
 *   ⛔ 生成物内容确定（同类同序），跑两次一致（幂等）。
 *
 * 用法：node scripts/gen-ui-skin-library.mjs [源目录，默认 D:/临时1/galaxy]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.resolve(process.argv[2] || "D:/临时1/galaxy");
const DATA_DIR = path.join(ROOT, "src", "lib", "ui-skin", "data");
const CATALOG = path.join(ROOT, "src", "lib", "ui-skin", "catalog.gen.ts");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(CATALOG), { recursive: true });

if (!fs.existsSync(SRC)) {
  console.error(`源目录不存在：${SRC}`);
  process.exit(1);
}

const cats = fs
  .readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
  .map((d) => d.name)
  .sort();

/** 类目 → 界面展示名（新增类目时补这里）。 */
const CAT_LABEL = {
  Buttons: "按钮",
  Cards: "卡片",
  Checkboxes: "复选框",
  Forms: "表单",
  Inputs: "输入框",
  Notifications: "通知",
  Patterns: "图案",
  "Radio-buttons": "单选",
  "Toggle-switches": "开关",
  Tooltips: "工具提示",
  loaders: "加载器",
};

const stripScript = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, "").trim();

const catalog = [];
const catCounts = [];
let total = 0;
for (const cat of cats) {
  const dir = path.join(SRC, cat);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
  const items = [];
  for (const f of files) {
    const stem = f.replace(/\.html$/, "");
    const [author, ...nameParts] = stem.split("_");
    const html = stripScript(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!html) continue;
    items.push({ id: stem.toLowerCase(), author, name: nameParts.join("_"), html });
  }
  const gzPath = path.join(DATA_DIR, `${cat}.html.gz`);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(items), "utf8"), { level: 9 });
  const unchanged = fs.existsSync(gzPath) && fs.statSync(gzPath).size === gz.length;
  if (!unchanged) fs.writeFileSync(gzPath, gz);
  catalog.push({ cat, label: CAT_LABEL[cat] ?? cat, count: items.length });
  catCounts.push({ cat, label: CAT_LABEL[cat] ?? cat, count: items.length });
  total += items.length;
  console.log(`  ${cat.padEnd(16)} ${String(items.length).padStart(4)} 项  ${(gz.length / 1024).toFixed(0)}KB gzip${unchanged ? "（未变）" : ""}`);
}

// 清掉已不存在的类目（源目录删了类 ⇒ 数据别留孤儿）
for (const f of fs.readdirSync(DATA_DIR)) {
  const cat = f.replace(/\.html\.gz$/, "");
  if (!cats.includes(cat)) {
    fs.rmSync(path.join(DATA_DIR, f));
    console.log(`  - 移除孤儿数据 ${f}`);
  }
}

const entries = [];
for (const c of cats) {
  for (const f of fs.readdirSync(path.join(SRC, c)).filter((x) => x.endsWith(".html")).sort()) {
    const stem = f.replace(/\.html$/, "");
    const [author, ...nameParts] = stem.split("_");
    entries.push({ id: stem.toLowerCase(), cat: c, name: nameParts.join("_"), author });
  }
}

const ts = `/**
 * Uiverse 组件库目录（自动生成，勿手改 —— scripts/gen-ui-skin-library.mjs）
 * 来源：Uiverse.io Galaxy（MIT）。正文按类目 gzip 存于 src/lib/ui-skin/data/<cat>.html.gz，运行时懒解压。
 */
export type UiSkinCatalogEntry = { id: string; cat: string; name: string; author: string };

export const UI_SKIN_CATS: { cat: string; label: string; count: number }[] = ${JSON.stringify(catCounts)};

export const UI_SKIN_CATALOG: UiSkinCatalogEntry[] = ${JSON.stringify(entries)};
`;

fs.writeFileSync(CATALOG, ts);
console.log(`\n共 ${total} 个元素 / ${cats.length} 类 → ${path.relative(ROOT, DATA_DIR)}`);
