/**
 * Uiverse 套装（pack）生成 —— 风格统一层（2026-10-01）
 *
 * 背景：单品级换肤 ⇒ 同屏开关/加载器各穿各的（3802 个元素出自上千作者，风格互不搭）。
 * 方案：按 **作者** 聚类 —— 同一作者的 toggle 与 loader 风格连贯，打包成「套装」；
 *       工坊一次激活一套，全局所有接线点同穿一套。
 *
 * 输入：src/features/ui-skin/catalog.gen.ts（仓库内，无外部依赖 ⇒ 任何机器可复现）
 * 输出：src/lib/ui-skin/packs.gen.ts（自动生成，勿手改；数据沉基座——⛔ 基座 store 不许反向 import 域层）
 *
 * 入选规则（自动、确定性）：
 *   1) 作者在 Toggle-switches 与 loaders **两类目都有作品**（套装才完整）；
 *   2) 每类目取目录序第一个作为套装代表（文件名排序稳定）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CATALOG = path.join(ROOT, "src", "features", "ui-skin", "catalog.gen.ts");
const OUT = path.join(ROOT, "src", "lib", "ui-skin", "packs.gen.ts");

const src = fs.readFileSync(CATALOG, "utf8");
const m = src.match(/UI_SKIN_CATALOG[^=]*= (\[[\s\S]*\]);/);
if (!m) {
  console.error("catalog.gen.ts 里找不到 UI_SKIN_CATALOG 数组");
  process.exit(1);
}
const entries = JSON.parse(m[1].replace(/"id":/g, '"id":')); // 已是合法 JSON（生成器写入时无尾逗号）

const byAuthor = new Map();
for (const e of entries) {
  if (!byAuthor.has(e.author)) byAuthor.set(e.author, new Map());
  const cats = byAuthor.get(e.author);
  if (!cats.has(e.cat)) cats.set(e.cat, []);
  cats.get(e.cat).push(e);
}

const packs = [];
for (const [author, cats] of byAuthor) {
  const toggle = cats.get("Toggle-switches")?.[0];
  const loader = cats.get("loaders")?.[0];
  if (!toggle || !loader) continue;
  packs.push({
    id: author.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
    label: author,
    items: { "toggle-switch": `Toggle-switches/${toggle.id}`, loader: `loaders/${loader.id}` },
  });
}
packs.sort((a, b) => a.label.localeCompare(b.label, "en"));

const ts = `/**
 * Uiverse 风格套装（自动生成，勿手改 —— scripts/gen-ui-skin-packs.mjs）
 * 按作者聚类：同作者的开关 + 加载器风格连贯，一次激活一套、全局统一生效。
 */
export type UiSkinPack = {
  id: string;
  label: string;
  /** 槽位 → "<类目>/<元素id>"（与单品绑定同键） */
  items: Record<string, string>;
};

export const UI_SKIN_PACKS: UiSkinPack[] = ${JSON.stringify(packs, null, 2)};
`;

fs.writeFileSync(OUT, ts);
console.log(`套装 ${packs.length} 个 → ${path.relative(ROOT, OUT)}`);
