#!/usr/bin/env node
/**
 * 记忆存量审计 / 用量档案（10-17）
 *
 * ⛔⛔ 为什么需要它：**写入判据只挡新增，管不了已经躺在文件里的老条目**。
 *    升级后不跑一次审计，"越记越乱"的底子没变 —— 对一个用了几个月的用户尤其明显。
 *
 * 交付两件事（一次扫描出两份）：
 *   ① **用量档案**：各层/各文件的行数、字符数、条目数、预算占比（"容易爆满"的量化依据）；
 *   ② **流水账清单**：命中写入判据（`shouldRememberLine` 返回 keep=false）的**已有行**。
 *
 * ⛔ 默认 **dry-run**：只出报告，**不改任何文件**（批量动作先出清单——本项目踩过越界删除的坑）。
 *    `--apply` 才真动，且动作是**降级而非删除**（把流水行移到 `logs/<日期>.md`，可回溯）。
 *    `--json` 出机器可读报告（给面板/CI 用）。
 *
 * 用法：
 *   node scripts/memory-audit.mjs                       # 审计当前工作区（dry-run）
 *   node scripts/memory-audit.mjs --root <工作区路径>
 *   node scripts/memory-audit.mjs --json
 *   node scripts/memory-audit.mjs --apply               # 真移动（需人工确认过清单）
 *
 * ⛔ 跨平台：路径一律 path.join；**读取容忍 CRLF**（主仓 LF、副本/mac 可能 CRLF）；
 *    写文件用「同目录临时文件 + rename」原子替换（mac 与 Windows 语义一致，避免半截文件）。
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const WS = argOf("--root") || process.cwd();
const AS_JSON = argv.includes("--json");
const APPLY = argv.includes("--apply");

/* ⛔ 判据只能用**编译产物**（单一真相源在 electron/memory-lessons.ts）——
   审计脚本里另写一套判据 = 第二份口径，正是本轮刚修掉的那个债。 */
const mod = await import(pathToFileURL(join(ROOT, "dist-electron", "memory-lessons.js")).href);
const { shouldRememberLine, CORRECTION_CATEGORY } = mod;

const MEM = join(WS, ".codex-harness", "memory");
/** 层归属：按目录/文件名推断（与金字塔落点表同源）。 */
function layerOf(rel) {
  if (/^LESSONS\.md$|^lessons\//.test(rel)) return "L2 纪律";
  if (/^logs\//.test(rel)) return "L4 日志";
  if (/^rollup\//.test(rel)) return "L5 月度";
  if (/^archive\//.test(rel)) return "L6 归档";
  if (/^project\/BACKGROUND\.md$/.test(rel)) return "L3 背景";
  if (/^project\/MEMORY\.md$/.test(rel)) return "L1 长期";
  if (/^USER\.md$/.test(rel)) return "L0 画像";
  return "其它";
}
/** 预算（字符）：与 memory-layers.ts 的 MEMORY_BUDGET 同口径（基准倍率 ×1）。 */
const BUDGET = { "L0 画像": 4000, "L1 长期": 12000, "L2 纪律": 8000, "L3 背景": 6000, "L4 日志": 40000, "L5 月度": 12000 };

function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p, base));
    else if (name.endsWith(".md")) out.push({ path: p, rel: relative(base, p).replace(/\\/g, "/"), bytes: st.size, mtimeMs: st.mtimeMs });
  }
  return out;
}

const files = walk(MEM);
const usage = [];
const suspects = [];

for (const f of files) {
  /* ⛔ 容忍 CRLF：按 \r?\n 切。直接用 split("\n") 会让每行尾部多一个 \r，正则锚 $ 就失配。 */
  const text = readFileSync(f.path, "utf8");
  const lines = text.split(/\r?\n/);
  const entries = lines.filter((l) => /^\s*[-*]\s+\S/.test(l));
  const layer = layerOf(f.rel);
  usage.push({ ...f, layer, chars: text.length, lineCount: lines.length, entries: entries.length });

  /* ⛔ **用户纠错永不参与审计**（保护项，只增不减）—— 按分类文件直接跳过。 */
  if (/corrections\.md$/.test(f.rel)) continue;
  /* 只挑「纪律类」文件里的条目行：日志/归档/月度里本来就是流水，不该被清。 */
  if (layer !== "L2 纪律") continue;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    /* ⛔ 只审**条目行**（`- ` / `* ` 开头），跳过标题 / 引用 / 代码围栏 ——
       否则文件标题 `# 纪律与记忆` 会被 shell-echo 判成流水（实测误报）。 */
    if (!/^\s*[-*]\s+\S/.test(raw)) continue;
    const body = raw.replace(/^\s*[-*]\s+/, "").trim();
    if (!body) continue;
    /* 去掉 "2026-10-17 ⚠️ 坑：" 这类前缀再判 —— 否则行首的年月日会让判据看不清内容 */
    const content = body.replace(/^\d{4}-\d{2}-\d{2}\s*/, "").replace(/^⚠️\s*(纠错|坑)：\s*/, "").replace(/^(约定|偏好|画像)：\s*/, "").trim();
    const v = shouldRememberLine(content);
    if (!v.keep) suspects.push({ file: f.rel, line: i + 1, reason: v.reason, text: raw.trim().slice(0, 120) });
  }
}

const byLayer = {};
for (const u of usage) {
  const b = (byLayer[u.layer] ||= { files: 0, chars: 0, entries: 0, budget: BUDGET[u.layer] || 0 });
  b.files++; b.chars += u.chars; b.entries += u.entries;
}
const days = usage.filter((u) => u.layer === "L4 日志").map((u) => ({ date: (u.rel.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || u.rel, chars: u.chars })).sort((a, b) => (a.date < b.date ? -1 : 1));

const report = {
  workspace: WS,
  scannedAt: new Date().toISOString(),
  exists: existsSync(MEM),
  files: usage.length,
  byLayer,
  days,
  suspects,
  apply: APPLY,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n记忆存量审计 · ${WS}`);
  console.log(`落点 ${existsSync(MEM) ? MEM : "（不存在 —— 新用户，无需处理）"}`);
  console.log(`\n【用量档案】共 ${usage.length} 个文件`);
  for (const [layer, b] of Object.entries(byLayer).sort()) {
    const pct = b.budget ? ` · 预算 ${Math.round((b.chars / b.budget) * 100)}%` : "";
    console.log(`  ${layer.padEnd(10)} 文件 ${String(b.files).padStart(2)} · ${String(b.chars).padStart(6)} 字符 · ${String(b.entries).padStart(3)} 条${pct}`);
  }
  if (days.length) {
    console.log(`\n【L4 单日用量】（预算 8000/天，超了按天从最旧丢）`);
    for (const d of days) console.log(`  ${d.date}  ${String(d.chars).padStart(5)} 字符 ${d.chars > 8000 ? " ← ⚠️ 超单日预算" : ""}`);
  }
  console.log(`\n【流水账清单】命中写入判据的条目 ${suspects.length} 条${suspects.length ? "（⛔ 默认不动，确认后再 --apply）" : ""}`);
  for (const s of suspects.slice(0, 20)) console.log(`  ${s.file}:${s.line}  [${s.reason}]  ${s.text}`);
  if (suspects.length > 20) console.log(`  … 还有 ${suspects.length - 20} 条（用 --json 看全量）`);
  console.log(`\n${APPLY ? "⚠️ --apply 模式：下面会真移动" : "dry-run：未改任何文件"}`);
  if (!APPLY) {
    const done = join(MEM, ".layout-v3-audit-done");
    console.log(existsSync(done) ? `上次审计：${readFileSync(done, "utf8").trim()}` : "尚未审计过（老用户升级后建议跑一次 --apply）");
  }
}

/* ── 可选：真执行（降级而非删除）────────────────────────────────────
   ⛔ 只做一件事：把确认是流水的行**移动到 logs/<日期>.md**（追加），然后从 lessons 里移除。
   ⛔ 不做批量删除；⛔ 不碰 corrections.md（上面已跳过）。 */
if (APPLY && suspects.length) {
  const byFile = {};
  for (const s of suspects) (byFile[s.file] ||= []).push(s);
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const logFile = join(MEM, "logs", `${stamp}.md`);
  const moved = [];
  for (const [rel, list] of Object.entries(byFile)) {
    const p = join(MEM, rel);
    const lines = readFileSync(p, "utf8").split(/\r?\n/);
    const drop = new Set(list.map((s) => s.line));
    const kept = lines.filter((_, i) => !drop.has(i + 1));
    /* ⛔ 原子替换：同目录临时文件 + rename（跨平台一致，不会留半截文件） */
    const tmp = `${p}.tmp-${Date.now()}`;
    writeFileSync(tmp, kept.join("\n"), "utf8");
    renameSync(tmp, p);
    for (const s of list) moved.push(`- [审计降级自 ${rel}] ${s.text}`);
  }
  if (moved.length) {
    const head = existsSync(logFile) ? readFileSync(logFile, "utf8") : `# ${stamp}\n`;
    writeFileSync(logFile, `${head.replace(/\s*$/, "")}\n\n## 存量审计降级（${stamp}）\n${moved.join("\n")}\n`, "utf8");
    /* 老用户只审一次：留标记，免得每次升级都重扫（⛔ 标记只记"审过"，不代表"以后不许审"）。 */
    writeFileSync(join(MEM, ".layout-v3-audit-done"), `${new Date().toISOString()} 降级 ${moved.length} 条\n`, "utf8");
  }
  console.log(`\n✅ 已把 ${moved.length} 条流水降级到 logs/${stamp}.md（可回溯；lessons 里已移除）`);
  console.log(`   纠错类未参与；建议跑一次 node scripts/memory-audit.mjs 复核余额。`);
} else if (APPLY) {
  console.log("\n✅ 没有需要降级的条目（清单为空）");
}
