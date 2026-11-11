/**
 * 历史散落产物归位（11-11）—— 把「只有约定」变成真会落盘的迁移工具。
 *
 * ⛔ 默认 dry-run：只列清单、不写任何文件；必须显式 `--apply` 才归档。
 * ⛔ 只**复制**不删除/移动原文件（归档不是清理）。
 * ⛔ 落盘逻辑复用编译产物 dist-electron/features/artifact-archive.js（⛔ 不写第二份口径）。
 *
 * 用法：
 *   node scripts/artifacts-migrate.mjs --workspace <项目路径>              # 预览
 *   node scripts/artifacts-migrate.mjs --workspace <项目路径> --apply      # 真归档
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REPO = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const MODULE = path.join(REPO, "dist-electron", "features", "artifact-archive.js");
if (!existsSync(MODULE)) {
  console.error("⛔ 找不到编译产物：先跑 npm run build（本脚本不自己拼落盘逻辑）");
  process.exit(1);
}
const { archiveFiles, artifactsRoot } = require(MODULE);

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const wsIdx = argv.indexOf("--workspace");
const workspace = path.resolve(wsIdx >= 0 ? argv[wsIdx + 1] : process.cwd());
if (!existsSync(workspace)) { console.error("⛔ 工作区不存在：", workspace); process.exit(1); }

const EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf", ".md", ".txt", ".csv", ".tsv", ".json", ".html", ".htm", ".xlsx", ".docx", ".pptx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "artifacts", "memory", ".workbuddy", "build", "out", "coverage"]);
const sessionsRoot = path.join(workspace, ".codex-harness", "sessions");
const artifactRoot = artifactsRoot(workspace);

/** 只扫两处：会话工作区（历史产物都在这）+ 工作区根直属文件（散在根目录的那些）。 */
function collect() {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) {
        if (full.startsWith(artifactRoot + path.sep)) continue;  // 已经归档过的不重复收
        try {
          const st = statSync(full);
          files.push({ path: full, at: st.mtimeMs, bytes: st.size, parent: path.basename(dir) });
        } catch { /* 读不到就跳过 */ }
      }
    }
  };
  if (existsSync(sessionsRoot)) walk(sessionsRoot, 0);
  try {
    for (const e of readdirSync(workspace, { withFileTypes: true })) {
      if (!e.isFile() || !EXTS.has(path.extname(e.name).toLowerCase())) continue;
      const full = path.join(workspace, e.name);
      const st = statSync(full);
      files.push({ path: full, at: st.mtimeMs, bytes: st.size, parent: "根目录" });
    }
  } catch { /* 工作区不可读 */ }
  return files;
}

/** threadId / uuid 形态的目录名不能当任务短名 —— 一周后谁也认不出。 */
function shortTaskOf(parent) {
  const p = String(parent ?? "").trim();
  if (!p || /^[0-9a-f-]{16,}$/i.test(p) || /^thread[-_]/i.test(p) || /^\d{10,}$/.test(p)) return "会话产物";
  return p.slice(0, 24);
}

const files = collect();
if (!files.length) { console.log("没有找到可归位的历史产物（已归档的会跳过）。"); process.exit(0); }

/* 按「日期 + 任务短名」分组：同一天同一任务的多版进同一目录，靠 -r2 区分。 */
const groups = new Map();
for (const f of files) {
  const d = new Date(f.at);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const task = shortTaskOf(f.parent);
  const key = `${stamp}::${task}`;
  if (!groups.has(key)) groups.set(key, { task, at: f.at, files: [] });
  groups.get(key).files.push(f);
}

console.log(`${apply ? "【APPLY】" : "【DRY-RUN】"} 工作区 ${workspace}`);
console.log(`待归位 ${files.length} 个文件 → ${groups.size} 个任务目录（目录：${artifactRoot}）`);
let total = 0;
for (const [key, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${key.split("::")[0]}-${g.task}  (${g.files.length} 个)`);
  for (const f of g.files.slice(0, 5)) console.log(`      ${path.relative(workspace, f.path)}`);
  if (g.files.length > 5) console.log(`      … 另有 ${g.files.length - 5} 个`);
  total += g.files.length;
}
if (!apply) {
  console.log(`\n预览结束，未写任何文件。确认后加 --apply 真归档（⛔ 只复制，不删原文件）。`);
  process.exit(0);
}

let archived = 0;
for (const [, g] of groups) {
  /* ⛔ 一次最多 30 个文件（模块上限），超了分批。 */
  for (let i = 0; i < g.files.length; i += 30) {
    const chunk = g.files.slice(i, i + 30);
    const res = await archiveFiles(workspace, {
      files: chunk.map((f) => ({ path: f.path })),
      task: g.task,
      at: g.at,
      source: "历史归位（scripts/artifacts-migrate.mjs）",
      note: "从会话工作区/根目录归位，原文件保留",
    });
    if (!res.ok) console.error(`  ⚠ ${g.task} 第 ${i / 30 + 1} 批失败：${res.error}`);
    else archived += res.saved?.length ?? 0;
  }
}
console.log(`\n完成：实际归档 ${archived}/${total} 个文件；原文件一个没动。`);
