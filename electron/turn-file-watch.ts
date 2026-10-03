// 回合文件变更追踪（10-01 用户令：「修改/编辑/生成动了文件，汇总就要跟 ZCode 一样」+「触发条件齐全」）。
// 引擎只对 apply_patch 发 fileChange；模型走 shell / exec_command / MCP / 浏览器自动化写文件时引擎毫无感知。
// 宿主自己盯文件系统：
//   · turn/started|begin → 记工作目录快照（内容只收文本文件，双上限防大目录）；
//   · turn/(completed|aborted|failed|interrupted) → 算差异并广播 harness:event turn-file-changes；
//   · thread/status/changed idle → 兜底结算；turn/started 发现上一轮未结算 → 先补算再开新快照（防漏报）。
// ⛔ 本模块是叶子：不 import 任何业务模块，广播函数由 boot 注入。
import fs from "node:fs";
import path from "node:path";

const IGNORE = new Set(["node_modules", ".git", ".codex", ".codex-harness", "dist", "build", "out", ".next", ".cache", "coverage", "venv", "__pycache__"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".scss", ".html", ".py", ".rs", ".go", ".java", ".toml", ".yml", ".yaml", ".sh", ".xml", ".svg", ".csv", ".mdx"]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 4000;
const MAX_REPORT = 60;

type Entry = { size: number; mtime: number; content?: string };
const snaps = new Map<string, { cwd: string; snap: Map<string, Entry> }>();
let broadcastFn: ((payload: unknown) => void) | null = null;

export function setTurnFileWatchBroadcast(fn: (payload: unknown) => void): void {
  broadcastFn = fn;
}

function walk(cwd: string): Map<string, Entry> {
  const snap = new Map<string, Entry>();
  let total = 0;
  const visit = (dir: string, depth: number): void => {
    if (depth > 8 || snap.size >= MAX_FILES) return;
    let list: fs.Dirent[];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (snap.size >= MAX_FILES) return;
      if (IGNORE.has(e.name) || (e.name.startsWith(".") && e.name !== ".codex" && e.name !== ".env")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { visit(p, depth + 1); continue; }
      try {
        const st = fs.statSync(p);
        const ext = path.extname(e.name).toLowerCase();
        if (st.size <= MAX_FILE_BYTES && TEXT_EXT.has(ext) && total + st.size <= MAX_TOTAL_BYTES) {
          const content = fs.readFileSync(p, "utf8");
          total += st.size;
          snap.set(p, { size: st.size, mtime: st.mtimeMs, content });
        } else {
          snap.set(p, { size: st.size, mtime: st.mtimeMs });
        }
      } catch { /* 无权限等：跳过 */ }
    }
  };
  visit(cwd, 0);
  return snap;
}

/** 行级 ± 估算（多重集差）：added = 新有旧无的行数，deleted = 旧有新无的行数；
 *  另产出可读的伪 diff（共同前后缀裁剪，中间 -旧/+新），供审查弹窗展示。 */
function lineDelta(oldText: string, newText: string) {
  const count = (text: string) => {
    const m = new Map<string, number>();
    for (const l of text.split(/\r?\n/)) if (l.trim()) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(oldText);
  const b = count(newText);
  let added = 0;
  let deleted = 0;
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) ?? 0));
  for (const [line, n] of a) deleted += Math.max(0, n - (b.get(line) ?? 0));
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  let head = 0;
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
  let tail = 0;
  while (tail < oldLines.length - head && tail < newLines.length - head && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
  const removed = oldLines.slice(head, oldLines.length - tail);
  const addedLines = newLines.slice(head, newLines.length - tail);
  const diff = [
    `@@ -${head + 1},${removed.length} +${head + 1},${addedLines.length} @@`,
    ...removed.slice(0, 400).map((l) => "-" + l),
    ...addedLines.slice(0, 400).map((l) => "+" + l),
  ].join("\n");
  return { added, deleted, diff };
}

export function snapshotTurnWorkspace(threadId: string, cwd: string): void {
  const id = String(threadId ?? "");
  const dir = String(cwd ?? "").trim();
  if (!id || !dir || !fs.existsSync(dir)) return;
  // 触发条件补全：上一轮没等到 completed（事件丢失/中断未报）⇒ 先补算再开新快照
  if (snaps.has(id)) emitTurnFileChanges(id);
  snaps.set(id, { cwd: dir, snap: walk(dir) });
}

export function emitTurnFileChanges(threadId: string): void {
  const id = String(threadId ?? "");
  const entry = snaps.get(id);
  if (!entry) return;
  snaps.delete(id);
  const next = walk(entry.cwd);
  const files: { path: string; status: string; added: number; deleted: number; diff: string }[] = [];
  for (const [p, after] of next) {
    const before = entry.snap.get(p);
    if (!before) {
      const d = after.content != null ? lineDelta("", after.content) : { added: 0, deleted: 0, diff: "" };
      files.push({ path: p, status: "added", added: d.added, deleted: 0, diff: d.diff });
      continue;
    }
    if (before.content != null && after.content != null && before.content !== after.content) {
      const d = lineDelta(before.content, after.content);
      files.push({ path: p, status: "modified", added: d.added, deleted: d.deleted, diff: d.diff });
    } else if (before.size !== after.size || before.mtime !== after.mtime) {
      files.push({ path: p, status: "modified", added: 0, deleted: 0, diff: "" });
    }
  }
  for (const [p, before] of entry.snap) {
    if (!next.has(p)) {
      const d = before.content != null ? lineDelta(before.content, "") : { added: 0, deleted: 0, diff: "" };
      files.push({ path: p, status: "deleted", added: 0, deleted: d.deleted, diff: d.diff });
    }
  }
  files.sort((x, y) => y.added + y.deleted - (x.added + x.deleted));
  const report = files.slice(0, MAX_REPORT);
  if (report.length && broadcastFn) broadcastFn({ type: "turn-file-changes", turnId: id, files: report });
}
