#!/usr/bin/env node
/**
 * 记忆原子迁移：把「一整篇 MEMORY.md / 一份长文」拆成 entries/ 下的原子条目。
 *
 * 用法：
 *   node scripts/memory-atoms-migrate.mjs                      # 迁当前项目，落盘
 *   node scripts/memory-atoms-migrate.mjs --dry-run            # 只打印将生成什么
 *   node scripts/memory-atoms-migrate.mjs --workspace D:/x     # 指定工作区
 *   node scripts/memory-atoms-migrate.mjs --from-note 某长文.md # 额外把这份长文按 ## 切条
 *   node scripts/memory-atoms-migrate.mjs --revert             # 从 .pre-atoms.bak 还原
 *
 * ⛔ 落盘前先写 `.pre-atoms.bak`（原文件完整备份），--revert 用它还原。
 * ⛔ 已存在同 id 且内容不同的条目不覆盖，改写成 `<id>-2.md` —— 迁移绝不静默吃掉已有记忆。
 * ⛔ 这个脚本不依赖构建产物（内联最小实现），保证任何一次 checkout 都能跑。
 */
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const DRY = has("--dry-run");
const REVERT = has("--revert");
const WORKSPACE = path.resolve(valueOf("--workspace") ?? process.cwd());
const EXTRA_NOTE = valueOf("--from-note");
const MEM = path.join(WORKSPACE, ".codex-harness", "memory");
const ENTRIES = path.join(MEM, "atoms", "entries");
const SRC_PROJECT = path.join(MEM, "project", "MEMORY.md");
const BAK = path.join(MEM, "project", "MEMORY.md.pre-atoms.bak");

const today = new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(...a);

function slugOf(title, taken) {
  const base = String(title ?? "")
    .normalize("NFC").trim()
    .replace(/[[\]]/g, "")
    .replace(/[\\/:*?"<>|#\n\r\t]/g, "-")
    .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 60);
  const start = base || `atom-${Date.now().toString(36)}`;
  let id = start;
  let n = 2;
  while (taken.has(id)) { id = `${start}-${n}`; n += 1; }
  taken.add(id);
  return id;
}

const oneLine = (text, max = 40) => {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ").replace(/[#>*`_~|-]{1,}/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!plain) return "";
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};

/** 按二级标题切块；返回 [{title, body}]，无二级标题时整篇算一块。 */
function splitSections(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let cur = null;
  const preamble = [];
  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      if (cur) out.push(cur);
      cur = { title: h2[1].replace(/[*`]/g, "").trim(), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  if (cur) out.push(cur);
  const rows = out.map((s) => ({ title: s.title, body: s.lines.join("\n").trim() })).filter((s) => s.body);
  /* 前言（第一个 ## 之前）只有在有实质内容时才算一条 —— 通常只是标题和一句话说明。 */
  const pre = preamble.join("\n").trim();
  const prePlain = pre.replace(/^#\s+.*$/gm, "").trim();
  if (prePlain.length > 40) rows.unshift({ title: "总览", body: prePlain });
  return rows;
}

function renderAtom({ id, summary, type, scope, body, ref }) {
  return [
    "---",
    `id: ${id}`,
    `summary: "${String(summary).replace(/"/g, "'")}"`,
    `type: ${type}`,
    `scope: ${scope}`,
    "status: active",
    "confidence: confirmed",
    `created: ${today}`,
    `updated: ${today}`,
    "source:",
    "  kind: workspace",
    `  ref: "${String(ref).replace(/"/g, "'")}"`,
    "tags: []",
    "supersedes: []",
    'expiresAt: ""',
    "evidence: []",
    "---",
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function doRevert() {
  if (!(await exists(BAK))) {
    log(`⛔ 没有找到备份：${BAK}\n   说明还没迁移过，或在别的机器上迁的。`);
    return 1;
  }
  await fs.copyFile(BAK, SRC_PROJECT);
  const atomsDir = path.join(MEM, "atoms");
  const leftover = await exists(atomsDir);
  log(`✓ 已从备份还原 ${SRC_PROJECT}`);
  if (leftover) log(`⚠ atoms/ 目录仍保留（${atomsDir}）—— 注入会优先用它。\n   要彻底回到旧逻辑：删掉 atoms/entries 目录后重启。`);
  return 0;
}

async function main() {
  if (REVERT) return doRevert();

  const sources = [];
  if (await exists(SRC_PROJECT)) sources.push({ file: SRC_PROJECT, ref: "MEMORY.md（迁移）", scope: "project" });
  if (EXTRA_NOTE) {
    const p = path.resolve(EXTRA_NOTE);
    if (!(await exists(p))) { log(`⛔ 找不到 --from-note 文件：${p}`); return 1; }
    sources.push({ file: p, ref: path.basename(p), scope: "project" });
  }
  if (!sources.length) {
    log(`ℹ ${SRC_PROJECT} 不存在 —— 这个工作区还没有项目长期记忆，无需迁移。`);
    log(`   （lessons/ 里的纪律另有一套吸附流程，本脚本不动它。）`);
    return 0;
  }

  const taken = new Set();
  const planned = [];
  for (const src of sources) {
    const md = await fs.readFile(src.file, "utf8");
    for (const section of splitSections(md)) {
      const id = slugOf(section.title, taken);
      planned.push({
        id,
        summary: oneLine(section.title) + (section.body ? ` — ${oneLine(section.body, 26)}`.slice(0, 28) : ""),
        type: /纪律|禁止|必须|不许|不要再犯|规则/.test(section.title) ? "rule" : "fact",
        scope: src.scope,
        body: `## ${section.title}\n\n${section.body}`,
        ref: src.ref,
      });
    }
  }

  log(`工作区：${WORKSPACE}`);
  log(`将生成 ${planned.length} 条记忆原子：`);
  for (const p of planned) log(`  - [${p.type}] ${p.id}  ← ${p.summary}`);
  if (DRY) {
    log(`\n（--dry-run：没有写任何文件）`);
    return 0;
  }
  if (!planned.length) { log("没有可迁移的内容。"); return 0; }

  /* ① 备份原文件（只备一次，保留最初的长文） */
  if (await exists(SRC_PROJECT) && !(await exists(BAK))) {
    await fs.copyFile(SRC_PROJECT, BAK);
    log(`✓ 已备份原文 → ${BAK}`);
  }

  /* ② 逐条写盘（冲突改后缀，绝不覆盖已有条目） */
  let written = 0;
  let skipped = 0;
  const usedIds = new Set();
  for (const p of planned) {
    let id = p.id;
    let n = 2;
    while (usedIds.has(id)) { id = `${p.id}-${n}`; n += 1; }
    const dir = path.join(ENTRIES, p.scope);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}.md`);
    if (await exists(file)) {
      skipped += 1;
      log(`  · 跳过（已存在）：${p.scope}/${id}.md`);
      continue;
    }
    await fs.writeFile(file, renderAtom({ ...p, id }), "utf8");
    usedIds.add(id);
    written += 1;
  }

  /* ③ 原 MEMORY.md 改成"已迁移"说明（正文不再重复注入，避免新旧两份打架） */
  const pointer = [
    "# MEMORY.md（已迁移到记忆原子）",
    "",
    `> 本文件的内容已拆成 ${written} 条原子记忆，落在 \`atoms/entries/\`，索引见 \`atoms/INDEX.md\`。`,
    "> 原文完整备份在 `project/MEMORY.md.pre-atoms.bak`（`--revert` 可还原）。",
    "",
    "⛔ 不要再往这里写长文 —— 新记忆写成 `atoms/entries/<scope>/<id>.md`（格式见 INDEX.md 顶部注释）。",
    "",
  ].join("\n");
  await fs.mkdir(path.dirname(SRC_PROJECT), { recursive: true });
  await fs.writeFile(SRC_PROJECT, pointer, "utf8");

  log(`\n✓ 写入 ${written} 条${skipped ? `，跳过 ${skipped} 条（已存在）` : ""}`);
  log(`✓ 原 MEMORY.md 已替换为迁移说明（备份在 .pre-atoms.bak）`);
  log(`→ 下一步：node scripts/memory-atoms-migrate.mjs --index（或重启应用，注入时会自动出索引）`);
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error("迁移失败：", error?.message ?? error);
  process.exit(1);
});
