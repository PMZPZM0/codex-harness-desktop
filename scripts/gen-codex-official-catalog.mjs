/**
 * gen-codex-official-catalog —— 生成 `electron/codex-official-catalog.gen.ts`
 * （Codex 官方插件市场 `openai/plugins` 的**文案快照**：显示名 / 简介 / 版本 / 许可 / 分类 / 鉴权策略）。
 *
 * 为什么要有这份快照（而不是运行时逐个抓）：
 *   上游 `.agents/plugins/marketplace.json` 只有 65 条 {name, source, policy, category}，
 *   **简介与显示名在各插件自己的 `plugins/<slug>/.codex-plugin/plugin.json` 里** —— 一次列表要发 62 个请求，
 *   而国内直连 GitHub 正是当初换掉 codex-marketplace.com 的原因（整面 AbortError）。
 *   ⇒ 文案离线进快照（本脚本按需重跑），列表运行时只拉一份 marketplace.json 拿**活数据**（分类/策略/新增插件）。
 *
 * 用法（需联网；镜像优先、直连兜底）：
 *   node scripts/gen-codex-official-catalog.mjs            # 重新生成 + 打印与现有快照的差异
 *   node scripts/gen-codex-official-catalog.mjs --check    # 只比对不写文件（红了说明快照过期）
 *
 * ⛔ 英文文案**逐字来自上游**（截成首句、≤180 字符），本脚本不改写；
 *    中文表 `OFFICIAL_PLUGIN_ZH`（在 electron/codex-official-market.ts）手写，本脚本只报告快照里
 *    新增/消失的 slug 提醒补删 —— 不在表里的插件自动回落英文原文（宁可显示英文也不乱翻）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "electron", "codex-official-catalog.gen.ts");
const OWNER = "openai";
const REPO = "plugins";
const BRANCH = "main";
/** 国内镜像优先、直连兜底（实测：gh-proxy 通、ghfast 在本机不通；与 voice/model-store 的前缀表同源但优先级不同） */
const MIRROR_PREFIXES = ["https://gh-proxy.com/", "https://ghfast.top/", ""];
const MARKET_MANIFEST = ".agents/plugins/marketplace.json";
const API_MANIFEST = ".agents/plugins/api_marketplace.json";
const MAX_DESC_CHARS = 180;
const CONCURRENCY = 8;

function rawUrl(mirror, relPath) {
  const direct = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${relPath}`;
  return mirror ? `${mirror}${direct}` : direct;
}

/** 抓文本；三个镜像 × 3 次重试都不成才算失败（镜像偶发 502 是常态） */
async function fetchText(relPath) {
  for (const mirror of MIRROR_PREFIXES) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(rawUrl(mirror, relPath), { signal: AbortSignal.timeout(30_000) });
        if (response.ok) return await response.text();
      } catch { /* 换下一次/换镜像 */ }
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw new Error(`抓取失败：${relPath}（三个镜像 + 直连都试过）`);
}

/** 抓不到返回 null（外部仓库源的插件就没有这个文件，不是错误） */
async function fetchJson(relPath) {
  try { return JSON.parse(await fetchText(relPath)); } catch { return null; }
}

/** 首句截断：上游不少简介是整页营销文案，卡片里读不完 */
function firstSentence(value) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = /^(.{12,}?[.!?])\s/.exec(clean);
  const head = match ? match[1] : clean;
  return head.length > MAX_DESC_CHARS ? `${head.slice(0, MAX_DESC_CHARS - 1).trimEnd()}…` : head;
}

/** 写 .ts 用 JSON 字面量即可（全是 ASCII 安全串；\u003c 防 `</script>` 之类的串扰） */
function literal(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const market = JSON.parse(await fetchText(MARKET_MANIFEST));
  const entries = Array.isArray(market?.plugins) ? market.plugins : [];
  if (!entries.length) throw new Error(`${MARKET_MANIFEST} 里没有 plugins 数组，结构变了`);

  const apiNames = new Set();
  const apiManifest = await fetchJson(API_MANIFEST);
  if (apiManifest) for (const entry of apiManifest.plugins ?? []) apiNames.add(entry.name);
  else console.warn("⚠ api_marketplace.json 没拿到 —— apiCurated 全记 false（会让「需 ChatGPT 登录」标注失真）");

  // 并行读各插件的 manifest（只走 raw，不打 API ⇒ 不受 60 次/小时限制）
  const catalog = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      const rel = typeof entry?.source?.path === "string" ? entry.source.path.replace(/^\.\//, "") : "";
      const manifest = rel ? await fetchJson(`${rel}/.codex-plugin/plugin.json`) : null;
      catalog.set(entry.name, {
        slug: entry.name,
        path: rel,
        category: entry.category ?? "",
        auth: entry.policy?.authentication ?? "",
        apiCurated: apiNames.has(entry.name),
        displayName: entry.interface?.displayName || manifest?.interface?.displayName || manifest?.name || entry.name,
        description: firstSentence(manifest?.description),
        version: typeof manifest?.version === "string" ? manifest.version : "",
        license: typeof manifest?.license === "string" ? manifest.license : "",
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const rows = [...catalog.values()];
  const noText = rows.filter((row) => !row.description);
  const generatedAt = new Date().toISOString().slice(0, 10);
  const body = [
    "/* ⛔ 自动生成，请勿手改 —— 生成器：`node scripts/gen-codex-official-catalog.mjs`（需联网）",
    ` * 数据源：github.com/${OWNER}/${REPO}@${BRANCH} 的 .agents/plugins/{marketplace,api_marketplace}.json`,
    ` *         与各插件的 plugins/<slug>/.codex-plugin/plugin.json（简介 = 上游首句逐字截断，未改写）`,
    ` * 抓取时间：${generatedAt}　共 ${rows.length} 个条目（其中 ${noText.length} 个无本地 manifest：外部仓库源）`,
    " * ⛔ 运行时仍以 marketplace.json 为活数据（分类/策略/新增插件）；本快照只提供文案。",
    " *    中文表在 electron/codex-official-market.ts 的 OFFICIAL_PLUGIN_ZH（缺条目回落这里的英文）。",
    " */",
    "export type OfficialPluginCatalogEntry = {",
    "  slug: string; path: string; category: string; auth: string; apiCurated: boolean;",
    "  displayName: string; description: string; version: string; license: string;",
    "};",
    "",
    `export const OFFICIAL_CATALOG_GENERATED_AT = ${literal(generatedAt)};`,
    "",
    "export const OFFICIAL_PLUGIN_CATALOG: Record<string, OfficialPluginCatalogEntry> = {",
    // ⛔⛔ 这里必须逐字段序列化，**不能** `literal(row)` 直接 JSON.stringify 整个对象：
    //    那样产出的是 `"slug":"linear","path":…` —— 属性名没引号、不是合法 TS，
    //    tsc 立刻报 TS1005/TS1109，而且该文件**不在 git 里**（.gen 快照从不提交）
    //    ⇒ 症状是「跑一次生成器之后 tcs 全红」，且没有任何地方 import 它（纯垃圾也会挡类型检查）。
    //    逐字段走 key: literal(value)，产出的才是合法对象字面量。
    ...rows.map((row) => `  ${literal(row.slug)}: { ${Object.entries(row)
      .map(([k, v]) => `${k}: ${literal(v)}`)
      .join(", ")} },`),
    "};",
    "",
  ].join("\n");

  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  const previousSlugs = new Set([...existing.matchAll(/^  "([^"]+)": \{/gm)].map((m) => m[1]));
  const currentSlugs = new Set(rows.map((row) => row.slug));
  const added = [...currentSlugs].filter((slug) => previousSlugs.size && !previousSlugs.has(slug));
  const removed = [...previousSlugs].filter((slug) => !currentSlugs.has(slug));

  console.log(`上游条目：${rows.length} 个（api 精选 ${rows.filter((r) => r.apiCurated).length} / 仅连接器 ${rows.filter((r) => !r.apiCurated).length}）`);
  console.log(`无本地 plugin.json（外部仓库源，不能一键安装）：${noText.length} → ${noText.map((row) => row.slug).join(", ") || "无"}`);
  console.log(`分类：${[...new Set(rows.map((row) => row.category))].join(" / ")}`);
  if (added.length) console.log(`\n⚠ 上游新增 ${added.length} 个：${added.join(", ")} —— 记得补 OFFICIAL_PLUGIN_ZH 中文条目`);
  if (removed.length) console.log(`⚠ 上游移除 ${removed.length} 个：${removed.join(", ")}`);

  if (checkOnly) {
    if (existing === body) { console.log("✓ 快照与上游一致"); return; }
    console.error("✗ 快照已过期（内容与上游不一致），请跑 node scripts/gen-codex-official-catalog.mjs");
    process.exit(1);
  }
  if (existing && !added.length && !removed.length && existing.replace(/抓取时间：[\d-]+/, "") === body.replace(/抓取时间：[\d-]+/, "")) {
    console.log("✓ 只有日期变了，不重写文件");
    return;
  }
  fs.writeFileSync(OUT, body, "utf8");
  console.log(`✓ 已写 ${path.relative(ROOT, OUT)}（${rows.length} 条 / ${Buffer.byteLength(body)} 字节）`);
}

main().catch((error) => { console.error(error); process.exit(1); });
