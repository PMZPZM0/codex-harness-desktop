/**
 * codex-logs 域的 IPC handler（09-29 用户：「加一个 Codex 日志管理功能，在数据管理里面，
 * 就是平时 Codex 写的那些日志，按项目分类，项目里面再按时间分类，可以批量删除和清空」）。
 *
 * 管的是什么：Codex 引擎自己写的**会话记录**（rollout 原档）——
 *   `<codex-home>/sessions/YYYY/MM/DD/rollout-<时间>-<uuid>.jsonl`（+ `archived_sessions/**`）
 * 每个文件首行是 `session_meta`，payload 里有 `cwd`（这条会话在哪个项目跑的）与 `id` ——
 * 所以能按**项目**分组、再按**日期**（目录本身就是年月日）分组。
 *
 * ⛔⛔ 这是**销毁性**通道：删掉的 rollout 就是删掉的对话记录，引擎不会重建。
 *   UI 侧必须强警告 + 二次确认；这里只保证「删得准」（只删这一类文件）。
 * ⛔ 级联：文件删了、`session_index.jsonl` 里的条目还在 ⇒ 会话列表留死条目（点开是空的）。
 *   所以删除时**同时剔除索引里对应 id 的行**（id 从文件名解析，与其他行逐字保留）。
 *
 * 安全口径与 fs-ipc / drama-canvas 同源：目标由主进程自己拼、必须落在 codex-home 的
 * sessions / archived_sessions 之下、必须是 `.jsonl` **文件**（目录一律拒绝）。
 */
import { ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { codexHome } from "../runtime-refs";

/** rollout 文件名：rollout-2026-08-29T14-37-36-<uuid>.jsonl */
const ROLLOUT_RE = /^rollout-.*\.jsonl$/i;

function logsRoots(): string[] {
  const home = path.resolve(String(codexHome || ""));
  return [path.join(home, "sessions"), path.join(home, "archived_sessions")];
}

/** 递归列出所有 rollout 文件（只下钻到深度 4：年/月/日，够用且不会走丢） */
async function listRolloutFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 4) return out;
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listRolloutFiles(full, depth + 1, out);
    else if (entry.isFile() && ROLLOUT_RE.test(entry.name)) out.push(full);
  }
  return out;
}

/** 从 id 反查文件名里的 uuid（rollout-...-<uuid>.jsonl） */
function idOfFile(file: string): string {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path.basename(file));
  return m ? m[1] : "";
}

/** 读 rollout 首行拿会话元信息（cwd / id / 时间）。读不到就返回空 —— 不抛。 */
async function metaOfFile(file: string): Promise<{ cwd: string; id: string; at: string }> {
  try {
    const handle = await fs.open(file, "r");
    try {
      /* ⛔⛔ 首行不是 16KB 能装下的（09-30 实测：session_meta 里带 base_instructions，
         首行 22181 字符）—— 原来只读 16KB ⇒ JSON.parse 必失败 ⇒ **所有记录都落「未知项目」**
         （用户实测：「怎么没有按项目分类呢」）。改成**分块读到行尾**（上限 512KB 保底）。 */
      const CHUNK = 64 * 1024;
      const LIMIT = 512 * 1024;
      let text = "";
      let pos = 0;
      let found = false;
      while (pos < LIMIT) {
        const buf = Buffer.alloc(CHUNK);
        const { bytesRead } = await handle.read(buf, 0, buf.length, pos);
        if (!bytesRead) break;
        text += buf.subarray(0, bytesRead).toString("utf8");
        pos += bytesRead;
        const nl = text.indexOf("\n");
        if (nl >= 0) { text = text.slice(0, nl); found = true; break; }
      }
      if (!found) text = text.slice(0, LIMIT);
      const first = text;
      try {
        const parsed = JSON.parse(first) as { type?: string; payload?: { cwd?: string; id?: string; timestamp?: string } };
        return {
          cwd: String(parsed?.payload?.cwd || ""),
          id: String(parsed?.payload?.id || ""),
          at: String(parsed?.payload?.timestamp || ""),
        };
      } catch {
        /* 首行仍解析不了（超长 / 截断在半个 UTF-8 字符上）时的**正则兜底**：
           直接抓 cwd / id 字段本身，不做整体解析（首行里这两个键都在靠前位置）。 */
        const grab = (key: string): string => {
          const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(first);
          if (!m) return "";
          try { return JSON.parse(`"${m[1]}"`) as string; } catch { return m[1]; }
        };
        return { cwd: grab("cwd"), id: grab("id") || idOfFile(file), at: grab("timestamp") };
      }
    } finally { await handle.close(); }
  } catch {
    return { cwd: "", id: idOfFile(file), at: "" };
  }
}

ipcMain.handle("codex-logs:scan", async () => {
  const roots = logsRoots();
  const home = path.resolve(String(codexHome || ""));
  const files: Array<{ path: string; rel: string; bytes: number; mtime: number; cwd: string; project: string; id: string; archived: boolean }> = [];
  for (const root of roots) {
    const archived = root.endsWith("archived_sessions");
    for (const file of await listRolloutFiles(root)) {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      const meta = await metaOfFile(file);
      const cwd = meta.cwd;
      files.push({
        path: file,
        rel: path.relative(home, file).replace(/\\/g, "/"),
        bytes: stat.size,
        mtime: stat.mtimeMs,
        cwd,
        // 项目名：cwd 的末级目录名（无 cwd 归到「未知项目」—— 老档可能没写）
        project: cwd ? path.basename(cwd.replace(/[\\/]+$/, "")) || cwd : "（未知项目）",
        id: meta.id || idOfFile(file),
        archived,
      });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return { files, sessionsDir: path.join(home, "sessions"), archivedDir: path.join(home, "archived_sessions") };
});

ipcMain.handle("codex-logs:delete", async (_event, input: { paths: string[] }) => {
  const roots = logsRoots().map((r) => path.resolve(r));
  const requested = Array.isArray(input?.paths) ? input.paths.slice(0, 5000) : [];
  const deletedIds: string[] = [];
  let deleted = 0, bytes = 0;
  const failed: string[] = [];
  for (const raw of requested) {
    const target = path.resolve(String(raw || ""));
    // ① 必须落在 codex-home 的 sessions / archived_sessions 之下（防越界删别的）
    const inside = roots.some((root) => target === root || target.startsWith(root + path.sep));
    if (!inside || !ROLLOUT_RE.test(path.basename(target))) { failed.push(target); continue; }
    // ② 必须真的是文件（目录一律拒绝）
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) { continue; } // 已不存在：幂等跳过
    if (!stat.isFile()) { failed.push(target); continue; }
    try {
      await fs.unlink(target);
      deleted++;
      bytes += stat.size;
      const id = idOfFile(target);
      if (id) deletedIds.push(id);
    } catch { failed.push(target); }
  }
  // ③ 级联：剔掉 session_index.jsonl 里对应 id 的行（其他行**逐字保留**）
  let indexCleaned = 0;
  if (deletedIds.length) {
    const indexPath = path.join(path.resolve(String(codexHome || "")), "session_index.jsonl");
    try {
      const raw = await fs.readFile(indexPath, "utf8");
      const ids = new Set(deletedIds);
      const kept: string[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) { kept.push(line); continue; }
        let id = "";
        try { id = String((JSON.parse(line) as { id?: string })?.id || ""); } catch { /* 坏行保留原样 */ }
        if (id && ids.has(id)) { indexCleaned++; continue; }
        kept.push(line);
      }
      if (indexCleaned) await fs.writeFile(indexPath, kept.join("\n"), "utf8");
    } catch { /* 索引不可读/不存在：不影响删除结果 */ }
  }
  return { deleted, bytes, failed, indexCleaned };
});
