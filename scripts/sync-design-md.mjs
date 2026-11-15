/**
 * sync-design-md —— 把 VoltAgent/awesome-design-md（MIT）的 84 份 DESIGN.md 收成随包资源。
 *
 * 产出：resources/design-md/library.json（分类 + 每条 { slug, name, category, description, designMd }）
 *       resources/design-md/LICENSE（上游 MIT 原文）
 * 用法：node scripts/sync-design-md.mjs [--force]
 *
 * ⛔ 走整包 tarball（codeload）而不是逐个调 GitHub API —— 84 个文件会把 60 次/小时的
 *    匿名配额一次用光；tarball 一次 2.5MB 搞定。镜像序 gh-proxy → ghfast → 直连。
 * ⛔ 上游更新后重跑本脚本即可；library.json 是生成物，不要手改。
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DESIGN_MD_ZH } from "./design-md-zh.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "resources", "design-md");
const TMP_DIR = join(ROOT, ".workbuddy", "tmp", "design-md-src");
const TARBALL = join(ROOT, ".workbuddy", "tmp", "design-md-src.tar.gz");
const REPO = "VoltAgent/awesome-design-md";
const URLS = [
  `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`,
  `https://gh-proxy.com/https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`,
  `https://ghfast.top/https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`,
];

/** README 里的英文分类 → 稳定 key + 中文标签（顺序即页面 tab 顺序）。 */
const CATEGORIES = [
  { en: "AI & LLM Platforms", key: "ai", label: "AI 与模型平台" },
  { en: "Developer Tools & IDEs", key: "devtools", label: "开发者工具" },
  { en: "Backend, Database & DevOps", key: "backend", label: "后端与数据平台" },
  { en: "Productivity & SaaS", key: "productivity", label: "效率与 SaaS" },
  { en: "Design & Creative Tools", key: "design", label: "设计与创意" },
  { en: "Fintech & Crypto", key: "fintech", label: "金融与加密" },
  { en: "E-commerce & Retail", key: "commerce", label: "电商与零售" },
  { en: "Media & Consumer Tech", key: "media", label: "媒体与消费科技" },
  { en: "Automotive", key: "auto", label: "汽车" },
  { en: "Retro Web · DESIGN.md Nostalgia", key: "retro", label: "复古网页" },
];

/** README 漏列的目录（上游 README 与 design-md/ 不是同一份清单时补齐；只补元数据，正文仍取原文件）。 */
const EXTRA = [
  { name: "Slack", slug: "slack", category: "productivity", description: "Team messaging platform. Aubergine purple with blue accents, friendly enterprise collaboration UI." },
];

const log = (msg) => console.log(`[sync-design-md] ${msg}`);

async function download(url, target) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  const size = statSync(target).size;
  if (size < 500_000) throw new Error(`下载不完整（${size} 字节）`);
  return size;
}

async function fetchTarball() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(dirname(TARBALL), { recursive: true });
  for (const url of URLS) {
    try {
      log(`下载 ${url}`);
      const size = await download(url, TARBALL);
      log(`下载完成 ${(size / 1048576).toFixed(1)} MB`);
      return;
    } catch (error) {
      log(`失败：${error.message}；换下一个源`);
    }
  }
  throw new Error("所有下载源都失败");
}

/** README 的 CollectiON 段 → [{ slug, name, category, description }]。 */
function parseReadme(readme) {
  const items = [];
  let category = "";
  for (const raw of readme.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      const hit = CATEGORIES.find((c) => c.en === heading[1].trim());
      category = hit ? hit.key : "";
      continue;
    }
    if (!category) continue;
    const item = line.match(/^-\s*\[\*\*(.+?)\*\*\]\((https:\/\/getdesign\.md\/([^/]+)\/design-md)\)\s*-\s*(.+)$/);
    if (!item) continue;
    items.push({ name: item[1].trim(), slug: item[3].trim(), category, description: item[4].trim() });
  }
  return items;
}

async function main() {
  const force = process.argv.includes("--force");
  const outFile = join(OUT_DIR, "library.json");
  if (!force && existsSync(outFile)) {
    log("library.json 已存在（加 --force 重新拉取）");
  }
  await fetchTarball();
  mkdirSync(TMP_DIR, { recursive: true });
  /* ⛔ 用**相对路径 + cwd** 解压：Git Bash 的 tar 会把 `D:\…` 里的冒号当远程主机，
     连 --force-local 也会被 MSYS 改写成 `D\:\…`。相对名两边都不歧义。 */
  execFileSync("tar", ["-xzf", "design-md-src.tar.gz", "-C", "design-md-src"],
    { cwd: join(ROOT, ".workbuddy", "tmp"), stdio: "inherit" });
  const [top] = readdirSync(TMP_DIR).filter((name) => statSync(join(TMP_DIR, name)).isDirectory());
  if (!top) throw new Error("解压后找不到仓库根目录");
  const src = join(TMP_DIR, top);

  const license = readFileSync(join(src, "LICENSE"), "utf8").trim();
  if (!/MIT License/i.test(license)) throw new Error("上游 LICENSE 不是 MIT —— 停下来人工确认");

  const parsed = parseReadme(readFileSync(join(src, "README.md"), "utf8"));
  for (const extra of EXTRA) if (!parsed.some((entry) => entry.slug === extra.slug)) parsed.push(extra);
  log(`README 解析到 ${parsed.length} 条`);

  const items = [];
  const missing = [];
  for (const entry of parsed) {
    const file = join(src, "design-md", entry.slug, "DESIGN.md");
    if (!existsSync(file)) { missing.push(entry.slug); continue; }
    items.push({ ...entry, zh: DESIGN_MD_ZH[entry.slug] ?? "", designMd: readFileSync(file, "utf8") });
  }
  if (missing.length) log(`⚠ 缺 DESIGN.md：${missing.join(", ")}`);
  const noZh = items.filter((item) => !item.zh).map((item) => item.slug);
  if (noZh.length) log(`⚠ 缺中文导读（scripts/design-md-zh.mjs）：${noZh.join(", ")}`);
  if (items.length < 60) throw new Error(`只收到 ${items.length} 份，明显不对`);

  const categories = CATEGORIES
    .map(({ key, label, en }) => ({ key, label, en, count: items.filter((i) => i.category === key).length }))
    .filter((c) => c.count > 0);

  const payload = {
    source: REPO,
    home: `https://github.com/${REPO}`,
    license: "MIT",
    fetchedAt: new Date().toISOString().slice(0, 10),
    categories,
    items,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outFile, JSON.stringify(payload), "utf8");
  writeFileSync(join(OUT_DIR, "LICENSE"), `${license}\n`, "utf8");
  const size = statSync(outFile).size;
  log(`写出 ${items.length} 份 / ${categories.length} 类（${(size / 1048576).toFixed(2)} MB）→ ${outFile}`);
  rmSync(TMP_DIR, { recursive: true, force: true });
  rmSync(TARBALL, { force: true });
}

main().catch((error) => {
  console.error(`[sync-design-md] 失败：${error?.stack || error}`);
  process.exit(1);
});
