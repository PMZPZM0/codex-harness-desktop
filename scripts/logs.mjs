#!/usr/bin/env node
/**
 * scripts/logs.mjs —— 项目日志库的**唯一入口**（建条目 / 检索 / 查看 / 统计 / 归档 / 删除 / 校验）。
 *
 * 为什么要有它（用户 2026-09-25 要求「新增独立日志目录 + 规范 + 索引 + 查看/清理/删除，
 * 确保记录完整留存不丢失」）：
 *   流水账式的每日记忆（`<ws>/.workbuddy/memory/YYYY-MM-DD.md`）**按天堆叠、按行扫读**，
 *   一条真结论沉在几百行里，事后根本检索不到；而「为什么当时这么定」恰恰是半年后最值钱的东西。
 *   所以这里做的是**规范化归档层**：一个结论一个文件、带结构化头、进索引、可被 sha256 校验。
 *
 * 与已有两层的关系（⛔ 别混淆，三层分工见 logs/README.md）：
 *   · `<ws>/.workbuddy/memory/`  —— 宿主约定的**每日原始记录**（append-only，本脚本不碰）
 *   · `<ws>/.codex-harness/memory/logs/` —— 应用自己的 L4 层（注入用，本脚本不碰）
 *   · `<repo>/logs/`            —— **本脚本管的规范归档层**（进 git、有索引、可校验）
 *
 * ⛔ 铁律：
 *   ① **一个条目一个文件**（`logs/<YYYY>/<MM>/<id>.md`），id 全局唯一；
 *   ② **追加写，永不改写历史**（改结论就新建条目并在 `supersedes` 里指旧 id）；
 *   ③ **索引是派生数据**（`logs/index.jsonl`），任何时候都能用 `reindex` 从磁盘重建 —— 索引坏了不丢内容；
 *   ④ **删除必须留墓碑**（`logs/audit-deletions.jsonl`）⇒ 内容可删，「它存在过、是什么、谁的指纹」永久留存；
 *   ⑤ `logs/` **必须提交进 git** —— 这是「项目记录不丢失」最强的一道保障（本地磁盘会坏、机器会换）。
 *
 * 用法（在仓库根跑）：
 *   node scripts/logs.mjs new --kind decision --area memory --title "记忆后端二选一" [--body "…"] [--tags a,b]
 *   node scripts/logs.mjs list [--kind decision] [--area memory] [--since 2026-09-01] [--limit 20] [--json]
 *   node scripts/logs.mjs search 上下文 供应商 [--area sidebar] [--tag memory] [--limit 10]
 *   node scripts/logs.mjs show 2026-09-25-decision-memory-backend
 *   node scripts/logs.mjs stats [--json]
 *   node scripts/logs.mjs reindex             # 从磁盘重建索引（索引损坏/手工加过文件时用）
 *   node scripts/logs.mjs verify              # 校验：缺文件 / 哈希不符 / 未入索引 ⇒ 非 0 退出
 *   node scripts/logs.mjs archive <id...>     # 清理 = 移进 archive 段并标记（内容仍在 git 里）
 *   node scripts/logs.mjs delete <id...> --confirm <id...|all> --reason "…"   # 硬删（墓碑留痕）
 *
 * 退出码：0 成功；1 用法/参数错；2 校验或操作失败（CI/预检可直接依赖）。
 */
"use strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");
const INDEX = path.join(LOGS, "index.jsonl");
const AUDIT = path.join(LOGS, "audit-deletions.jsonl");
const ARCHIVE = path.join(LOGS, "archive");

/** kind 取值（⛔ 与 logs/README.md 的表格同源，改一处要改两处） */
const KINDS = ["decision", "incident", "milestone", "change", "note"];
const IMPORTANCE = ["high", "normal"];
/** area 是自由文本，但常用值收在这里便于补全与统计 */
const AREAS = ["memory", "sidebar", "context", "build", "release", "icons", "guards", "teams", "voice", "ui", "other"];

/* ── 小工具 ─────────────────────────────────────────────────────────── */
const die = (msg, code = 1) => { console.error(`✗ ${msg}`); process.exit(code); };
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const slug = (text) => String(text ?? "").trim().toLowerCase()
  .replace(/[\s_]+/g, "-")
  .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 48) || "untitled";

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;   // 允许注释行（便于在文件顶部写说明）
    try { out.push(JSON.parse(t)); } catch { /* 坏行跳过，verify 会报 */ }
  }
  return out;
}
function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
const appendJsonl = (file, record) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
};

/** 解析 front-matter（只认标量与简单数组，够用且零依赖） */
function parseEntry(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^\[.*\]$/.test(val)) val = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else val = val.replace(/^["']|["']$/g, "");
    meta[key] = val;
  }
  return { meta, body: text.slice(m[0].length) };
}

function entryFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== ARCHIVE) walk(p); continue; }   // archive 段单独收，便于标记
      if (!e.name.endsWith(".md")) continue;
      if (e.name === "README.md") continue;   // ⛔ 规范文档不是条目（否则 verify 会把它当缺字段的坏条目）
      out.push(p);
    }
  };
  walk(LOGS);
  return out;
}
const archivedFiles = () => {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(ARCHIVE);
  return out;
};

/** 从磁盘上的一个条目文件生成索引记录 */
function recordOf(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString("utf8");
  const { meta, body } = parseEntry(text);
  const isArchived = rel(file).startsWith("logs/archive/");
  const id = String(meta.id || path.basename(file, ".md"));
  return {
    id,
    date: String(meta.date || ""),
    kind: String(meta.kind || "note"),
    area: String(meta.area || "other"),
    title: String(meta.title || ""),
    tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
    commits: Array.isArray(meta.commits) ? meta.commits : (meta.commits ? [meta.commits] : []),
    files: Array.isArray(meta.files) ? meta.files : (meta.files ? [meta.files] : []),
    importance: String(meta.importance || "normal"),
    supersedes: String(meta.supersedes || ""),
    path: rel(file),
    bytes: buf.length,
    sha256: sha256(buf),
    /* ⛔ 正文（去掉 front-matter）的哈希：`new`/`dedupe` 用它拦「同一段话换个标题再记一遍」。
       与整文件 sha256 分开，是因为后者会被 front-matter 里的 tags/commits 变化影响。 */
    bodySha256: sha256(Buffer.from(normTitle(body).replace(/[#*`>\-\s]/g, ""), "utf8")),
    archived: isArchived,
  };
}

/* ── 子命令 ─────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i++; }
    } else rest.push(a);
  }
  return { flags, rest };
}

/** 标题归一化：去掉空白/标点/全角括号，便于比较 */
const normTitle = (t) => String(t ?? "").toLowerCase().replace(/[\s，。、；：！？,.;:!?（）()【】\[\]"'`~—-]/g, "");

/** 2-gram 集合（中文按字切、英文按词切都可退化到 2-gram，够用且零依赖） */
function bigrams(text) {
  const s = normTitle(text);
  const out = new Set();
  if (s.length <= 2) { if (s) out.add(s); return out; }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 相似条目（同 kind 且标题高度相近）——`new` 与 `dedupe` 共用这一份判据。
 *  ⛔ 为什么要它（用户 2026-09-25：「确保没有重复写日志哈」）：日志最怕的不是"漏记"而是
 *  "同一件事记两份、两份慢慢分叉" —— 之后没人知道哪份是真的。这里在**写入那一刻**就拦住。 */
function findSimilar(kind, title, date, threshold = 0.75) {
  const target = bigrams(title);
  const out = [];
  for (const r of readJsonl(INDEX)) {
    const score = jaccard(target, bigrams(r.title));
    if (score >= threshold) out.push({ record: r, score: Number(score.toFixed(3)), sameDay: r.date === date, sameKind: r.kind === kind });
  }
  return out.sort((a, b) => b.score - a.score);
}

function cmdNew(argv) {
  const { flags } = parseArgs(argv);
  const title = String(flags.title ?? "").trim();
  if (!title) die("new 需要 --title");
  const kind = String(flags.kind ?? "note");
  if (!KINDS.includes(kind)) die(`--kind 必须是 ${KINDS.join(" / ")}（收到 ${kind}）`);
  const area = String(flags.area ?? "other");
  const importance = String(flags.importance ?? "normal");
  if (!IMPORTANCE.includes(importance)) die(`--importance 必须是 ${IMPORTANCE.join(" / ")}`);
  const date = String(flags.date ?? today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date 必须 YYYY-MM-DD（收到 ${date}）`);

  /* ⛔ 写入那一刻就拦重复（用户要求「确保没有重复写日志」）：
     ① 同内容（正文哈希相同）—— 最硬的重复；
     ② 标题高度相似（默认 0.75）—— 同一件事换个说法再记一遍，这才是最常见的分叉来源。
     要真的并列记两条（例如"同一现象在两个模块各发生一次"），显式加 --allow-similar 并在正文里写清区别。 */
  if (!flags["allow-similar"]) {
    const bodyText = String(flags.body ?? "").trim();
    if (bodyText) {
      const h = sha256(Buffer.from(bodyText, "utf8"));
      const same = readJsonl(INDEX).filter((r) => r.bodySha256 && r.bodySha256 === h);
      if (same.length) die(`已存在**内容完全相同**的条目：${same.map((r) => r.id).join(", ")}\n` +
        `  要么别再记一份，要么用 supersedes 明确取代它；确认要并列请加 --allow-similar`);
    }
    const similar = findSimilar(kind, title, date).filter((s) => s.score >= 0.75);
    if (similar.length) {
      die(`标题与已有条目高度相似（≥0.75）—— 疑似重复记同一件事：\n` +
        similar.slice(0, 4).map((s) => `  ${s.score}  ${s.record.date}  ${s.record.title}\n         id: ${s.record.id}`).join("\n") +
        `\n\n  处理方式（选一个）：\n` +
        `   · 同一件事 → 别新建，直接编辑那条，或新建一条并写 --supersedes <旧 id>\n` +
        `   · 确实是两件事 → 重新拟一个能区分开的标题，或加 --allow-similar 并说明差别`);
    }
  }

  const id = `${date}-${kind}-${slug(flags.slug ?? title)}`;
  const target = path.join(LOGS, date.slice(0, 4), date.slice(5, 7), `${id}.md`);
  if (fs.existsSync(target)) die(`条目已存在：${rel(target)}（id 必须唯一；换个 --slug 或改用 supersedes）`);
  const list = (v) => (v && v !== true ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : []);
  const meta = [
    `id: ${id}`,
    `date: ${date}`,
    `kind: ${kind}`,
    `area: ${area}`,
    `title: ${title}`,
    `tags: [${list(flags.tags).join(", ")}]`,
    `commits: [${list(flags.commits).join(", ")}]`,
    `files: [${list(flags.files).join(", ")}]`,
    `importance: ${importance}`,
  ];
  if (flags.supersedes) meta.push(`supersedes: ${String(flags.supersedes)}`);
  const body = String(flags.body ?? "").trim() || [
    "## 背景", "（当时为什么会有这件事）", "",
    "## 结论", "（定下了什么）", "",
    "## 依据", "（代码 / 实测 / 用户原话，能指向文件与行号最好）", "",
    "## 影响面", "（哪些模块 / 哪些行为会因此变化）", "",
    "## 回滚", "（怎么退回；不确定就写不确定）",
  ].join("\n");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `---\n${meta.join("\n")}\n---\n\n# ${title}\n\n${body}\n`);
  reindexQuiet();
  console.log(`✓ 新建条目：${rel(target)}`);
  console.log(`  id: ${id}`);
  return 0;
}

function buildIndex() {
  const records = [...entryFiles().map(recordOf), ...archivedFiles().map(recordOf)]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  writeJsonl(INDEX, records);
  return records;
}
function reindexQuiet() { buildIndex(); }

function cmdReindex() {
  const before = readJsonl(INDEX).length;
  const records = buildIndex();
  console.log(`✓ 索引已重建：${records.length} 条（原 ${before} 条）→ ${rel(INDEX)}`);
  return 0;
}

/** `dedupe`：全库查重（用户 2026-09-25「确保没有重复写日志哈」）。
 *  三类重复，按严重度排：
 *   ① 内容完全相同（bodySha256 相同）—— 纯粹的重复记；
 *   ② 同一天同 kind 且标题高度相似（≥0.75）—— 同一件事写了两遍（最常见的分叉源）；
 *   ③ 跨天相似标题 —— 可能是「又踩了一遍同一个坑」（那也不该各记一条，应 supersedes 或合并）。
 *  ⛔ 只报告不自动删：合并哪一个、留哪一个，只有人（或带上下文的 agent）能判断。 */
function cmdDedupe(argv) {
  const { flags } = parseArgs(argv);
  const rows = readJsonl(INDEX);
  const problems = [];

  const byBody = new Map();
  for (const r of rows) {
    if (!r.bodySha256) continue;
    if (!byBody.has(r.bodySha256)) byBody.set(r.bodySha256, []);
    byBody.get(r.bodySha256).push(r);
  }
  for (const [, group] of byBody) {
    if (group.length > 1) problems.push({ level: "内容完全相同", items: group.map((r) => r.id) });
  }

  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.bodySha256 && a.bodySha256 === b.bodySha256) continue;   // 上面已报
      const score = jaccard(bigrams(a.title), bigrams(b.title));
      if (score < 0.75) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const sameDay = a.date === b.date;
      problems.push({
        level: sameDay && a.kind === b.kind ? "同天同类型标题相似" : sameDay ? "同天标题相似" : "跨天标题相似",
        score: Number(score.toFixed(3)),
        items: [`${a.date}  ${a.title}  (${a.id})`, `${b.date}  ${b.title}  (${b.id})`],
      });
    }
  }

  if (flags.json) { console.log(JSON.stringify(problems, null, 2)); return problems.length ? 2 : 0; }
  if (!problems.length) { console.log(`✓ 查重通过：${rows.length} 条，没有重复或高度相似（阈值 0.75）`); return 0; }
  console.error(`✗ 发现 ${problems.length} 组疑似重复（阈值 0.75）：\n`);
  for (const p of problems) {
    console.error(`  【${p.level}${p.score ? ` ${p.score}` : ""}】`);
    for (const it of p.items) console.error(`     ${it}`);
    console.error("     处理：留一条、另一条加 supersedes 指回来；确实是两件事就改标题让它们可区分\n");
  }
  return 2;
}

function cmdList(argv) {
  const { flags } = parseArgs(argv);
  let rows = readJsonl(INDEX);
  if (flags.kind) rows = rows.filter((r) => r.kind === flags.kind);
  if (flags.area) rows = rows.filter((r) => r.area === flags.area);
  if (flags.tag) rows = rows.filter((r) => (r.tags || []).includes(String(flags.tag)));
  if (flags.since) rows = rows.filter((r) => r.date >= String(flags.since));
  if (flags.archived !== undefined) rows = rows.filter((r) => Boolean(r.archived) === (flags.archived === true || flags.archived === "true"));
  const limit = Number(flags.limit ?? 40);
  const shown = rows.slice(0, limit);
  if (flags.json) { console.log(JSON.stringify(shown, null, 2)); return 0; }
  if (!shown.length) { console.log("（没有匹配的条目）"); return 0; }
  console.log(`共 ${rows.length} 条，显示 ${shown.length} 条：\n`);
  for (const r of shown) {
    console.log(`  ${r.date}  [${r.kind}/${r.area}]${r.importance === "high" ? " ★" : ""}${r.archived ? " (archived)" : ""}`);
    console.log(`      ${r.title}`);
    console.log(`      id: ${r.id}`);
  }
  return 0;
}

/** 关键词打分：命中数 × 字段权重 × 时间新鲜度（对齐 WorkBuddy「排序检索」的形态，纯本地实现） */
function scoreEntry(record, terms) {
  const hay = {
    title: String(record.title || "").toLowerCase(),
    id: String(record.id || "").toLowerCase(),
    tags: (record.tags || []).join(" ").toLowerCase(),
    area: String(record.area || "").toLowerCase(),
    kind: String(record.kind || "").toLowerCase(),
    files: (record.files || []).join(" ").toLowerCase(),
  };
  let score = 0;
  for (const t of terms) {
    const term = t.toLowerCase();
    if (hay.title.includes(term)) score += 6;
    if (hay.tags.includes(term)) score += 4;
    if (hay.id.includes(term)) score += 3;
    if (hay.area.includes(term) || hay.kind.includes(term)) score += 2;
    if (hay.files.includes(term)) score += 2;
  }
  if (!score) return 0;
  // 时间新鲜度：越新略加权（30 天半衰期，避免老条目永远沉底）
  const ageDays = Math.max(0, (Date.now() - Date.parse(`${record.date}T00:00:00Z`)) / 86400000);
  return score * Math.pow(0.5, ageDays / 30);
}

function cmdSearch(argv) {
  const { flags, rest } = parseArgs(argv);
  const terms = rest.flatMap((s) => String(s).split(/\s+/)).filter(Boolean);
  if (!terms.length) die("search 需要至少一个关键词");
  let rows = readJsonl(INDEX);
  if (flags.kind) rows = rows.filter((r) => r.kind === flags.kind);
  if (flags.area) rows = rows.filter((r) => r.area === flags.area);
  if (flags.tag) rows = rows.filter((r) => (r.tags || []).includes(String(flags.tag)));
  if (flags.since) rows = rows.filter((r) => r.date >= String(flags.since));
  if (flags.archived === undefined) rows = rows.filter((r) => !r.archived);   // 默认不搜归档段
  const scored = rows.map((r) => ({ r, s: scoreEntry(r, terms) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const limit = Number(flags.limit ?? 10);
  const shown = scored.slice(0, limit);
  if (flags.json) { console.log(JSON.stringify(shown.map((x) => ({ ...x.r, _score: Number(x.s.toFixed(2)) })), null, 2)); return 0; }
  if (!shown.length) { console.log(`（没有命中：${terms.join(" ")}）`); return 0; }
  console.log(`命中 ${scored.length} 条，显示前 ${shown.length} 条（按相关度）：\n`);
  for (const { r, s } of shown) {
    console.log(`  [${s.toFixed(1)}] ${r.date}  [${r.kind}/${r.area}]  ${r.title}`);
    console.log(`         ${r.path}`);
  }
  return 0;
}

/** 解析 id：支持「完整 id」「唯一前缀」「唯一子串」「相对路径」四种写法。
 *  ⛔ 为什么必须支持前缀：默认 id 里带中文标题（`2026-09-25-decision-记忆后端二选一…`），
 *  让人手打整串不现实；`list`/`search` 会打印 id，但能只敲前一段更省事。 */
function resolveId(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const index = readJsonl(INDEX);
  const byPath = index.find((r) => r.path === input || r.path === `logs/${input}`);
  if (byPath) return byPath;
  const exact = index.find((r) => r.id === input);
  if (exact) return exact;
  const prefixed = index.filter((r) => r.id.startsWith(input));
  if (prefixed.length === 1) return prefixed[0];
  const contained = index.filter((r) => r.id.includes(input));
  if (contained.length === 1) return contained[0];
  const n = prefixed.length || contained.length;
  if (n > 1) die(`「${input}」匹配到 ${n} 条，请给更长的前缀：\n` + (prefixed.length ? prefixed : contained).slice(0, 6).map((r) => `  · ${r.id}`).join("\n"));
  return null;
}

function cmdShow(argv) {
  const { rest } = parseArgs(argv);
  const rec = resolveId(rest[0]);
  if (!rec) die(`索引里找不到：${rest[0] ?? "(缺 id)"}（先用 list / search 拿 id，必要时 reindex）`);
  const file = path.join(ROOT, rec.path);
  if (!fs.existsSync(file)) die(`索引有、磁盘没有：${rec.path}（跑 verify 看全貌）`, 2);
  console.log(fs.readFileSync(file, "utf8"));
  return 0;
}

function cmdStats(argv) {
  const { flags } = parseArgs(argv);
  const rows = readJsonl(INDEX);
  const byKind = {}, byArea = {}, byYear = {};
  let bytes = 0, archived = 0, high = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    byArea[r.area] = (byArea[r.area] || 0) + 1;
    byYear[String(r.date).slice(0, 4)] = (byYear[String(r.date).slice(0, 4)] || 0) + 1;
    bytes += r.bytes || 0;
    if (r.archived) archived++;
    if (r.importance === "high") high++;
  }
  const summary = { total: rows.length, archived, high, bytes, byKind, byArea, byYear };
  if (flags.json) { console.log(JSON.stringify(summary, null, 2)); return 0; }
  console.log(`条目总数：${rows.length}（归档 ${archived} / 高优先 ${high}）`);
  console.log(`内容合计：${(bytes / 1024).toFixed(1)} KB`);
  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ");
  console.log(`按类别：${fmt(byKind)}`);
  console.log(`按功能域：${fmt(byArea)}`);
  console.log(`按年份：${fmt(byYear)}`);
  return 0;
}

function cmdVerify() {
  const index = readJsonl(INDEX);
  const onDisk = [...entryFiles(), ...archivedFiles()].map(rel);
  const indexed = new Map(index.map((r) => [r.path, r]));
  const problems = [];
  for (const r of index) {
    const file = path.join(ROOT, r.path);
    if (!fs.existsSync(file)) { problems.push(`索引有、磁盘缺：${r.path}`); continue; }
    const buf = fs.readFileSync(file);
    const h = sha256(buf);
    if (h !== r.sha256) problems.push(`内容被改过（哈希不符）：${r.path}\n      索引 ${String(r.sha256).slice(0, 12)} / 实际 ${h.slice(0, 12)}`);
    if (buf.length !== r.bytes) problems.push(`大小不符：${r.path}（索引 ${r.bytes} / 实际 ${buf.length}）`);
  }
  for (const p of onDisk) if (!indexed.has(p)) problems.push(`磁盘有、未入索引：${p}（跑 reindex）`);
  const tombstones = readJsonl(AUDIT).length;
  console.log(`校验：索引 ${index.length} 条 / 磁盘 ${onDisk.length} 个文件 / 删除墓碑 ${tombstones} 条`);
  if (!problems.length) { console.log("✓ 一致：没有丢失、没有被改过、没有漏索引"); return 0; }
  console.error(`\n✗ 发现 ${problems.length} 个问题：`);
  for (const p of problems) console.error(`  · ${p}`);
  return 2;
}

function cmdArchive(argv) {
  const { flags, rest } = parseArgs(argv);
  let ids = rest;
  if (flags["all-before"]) {
    ids = readJsonl(INDEX).filter((r) => !r.archived && r.date < String(flags["all-before"])).map((r) => r.id);
  }
  if (!ids.length) die("archive 需要 <id...> 或 --all-before YYYY-MM-DD");
  const index = readJsonl(INDEX);
  let moved = 0;
  for (const id of ids) {
    const rec = resolveId(id);
    if (!rec) { console.error(`  · 跳过（索引里没有）：${id}`); continue; }
    if (rec.archived) { console.error(`  · 跳过（已归档）：${id}`); continue; }
    const from = path.join(ROOT, rec.path);
    if (!fs.existsSync(from)) { console.error(`  · 跳过（文件不在）：${rec.path}`); continue; }
    const to = path.join(ARCHIVE, rec.date.slice(0, 4), rec.date.slice(5, 7), path.basename(rec.path));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    console.log(`  → ${rel(to)}`);
    moved++;
  }
  reindexQuiet();
  console.log(`✓ 已归档 ${moved} 条（内容仍在 git 里，可 search --archived true 找回）`);
  return 0;
}

function cmdDelete(argv) {
  const { flags, rest } = parseArgs(argv);
  const ids = rest;
  if (!ids.length) die("delete 需要 <id...>");
  const confirm = flags.confirm === undefined ? "" : String(flags.confirm === true ? "" : flags.confirm);
  if (!confirm) die("delete 必须显式二次确认：--confirm <id 列表（逗号分隔）| all>");
  const reason = String(flags.reason ?? "").trim();
  if (!reason) die("delete 必须给出 --reason（写进墓碑，半年后靠它解释为什么删）");
  const allowed = confirm === "all" ? new Set(ids) : new Set(confirm.split(",").map((s) => s.trim()).filter(Boolean));
  const index = readJsonl(INDEX);
  let n = 0;
  for (const id of ids) {
    if (!allowed.has(id)) { console.error(`  · 跳过（--confirm 未包含）：${id}`); continue; }
    const rec = resolveId(id);
    if (!rec) { console.error(`  · 跳过（索引里没有）：${id}`); continue; }
    const file = path.join(ROOT, rec.path);
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      // ⛔ 先写墓碑再删：任何情况下「存在过」都要留痕（用户要求可删，但项目记录不能凭空消失）
      appendJsonl(AUDIT, {
        deletedAt: new Date().toISOString(), id: rec.id, path: rec.path,
        bytes: buf.length, sha256: sha256(buf), reason, date: rec.date, kind: rec.kind, area: rec.area, title: rec.title,
      });
      fs.rmSync(file, { force: true });
    } else {
      appendJsonl(AUDIT, { deletedAt: new Date().toISOString(), id: rec.id, path: rec.path, bytes: rec.bytes, sha256: rec.sha256, reason, note: "删除时文件已不在磁盘" });
    }
    console.log(`  ✗ 已删除并留墓碑：${rec.path}`);
    n++;
  }
  reindexQuiet();
  console.log(`✓ 删除 ${n} 条；墓碑写入 ${rel(AUDIT)}（永久保留，verify 会统计）`);
  return 0;
}

/* ── 入口 ───────────────────────────────────────────────────────────── */
const USAGE = `项目日志库（全部子命令见文件头注释）

  node scripts/logs.mjs new --kind <${KINDS.join("|")}> --area <域> --title "标题" [--tags a,b] [--commits h1,h2] [--files p1,p2] [--importance high] [--body "…"]
  node scripts/logs.mjs list [--kind k] [--area a] [--tag t] [--since YYYY-MM-DD] [--limit n] [--json]
  node scripts/logs.mjs search <关键词...> [--area a] [--kind k] [--tag t] [--since d] [--limit n] [--json]
  node scripts/logs.mjs show <id>
  node scripts/logs.mjs stats [--json]
  node scripts/logs.mjs reindex
  node scripts/logs.mjs verify
  node scripts/logs.mjs dedupe [--json]                                   # 全库查重（防重复记同一件事）
  node scripts/logs.mjs archive <id...> | --all-before YYYY-MM-DD
  node scripts/logs.mjs delete <id...> --confirm <id...|all> --reason "…"`;

const [cmd, ...argv] = process.argv.slice(2);
const COMMANDS = {
  new: cmdNew, list: cmdList, search: cmdSearch, show: cmdShow, stats: cmdStats,
  reindex: cmdReindex, verify: cmdVerify, archive: cmdArchive, delete: cmdDelete, dedupe: cmdDedupe,
};
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(USAGE); process.exit(cmd ? 0 : 1); }
if (!Object.prototype.hasOwnProperty.call(COMMANDS, cmd)) die(`未知子命令：${cmd}\n\n${USAGE}`);
process.exit(COMMANDS[cmd](argv) ?? 0);
