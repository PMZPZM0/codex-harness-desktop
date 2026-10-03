/**
 * work-logs 域的 IPC handler（09-30 用户立案：「记忆，有记忆管理，会话有归档管理，现在就是
 * 工作日志这个没有地方管理懂吗」）。
 *
 * 管的**不是**会话本身（会话的归档 / 删除在「归档管理」页），而是 **Codex 在每个项目里
 * 写下的工作日志与项目记忆**：`<项目>/.codex-harness/memory/**`
 *   · MEMORY.md          项目长期记忆
 *   · LESSONS.md         坑与纪律
 *   · logs/YYYY-MM-DD.md 每日工作日志（需求 → 结论，写入方 = 记忆捕获链）
 *   · lessons/*.md       分门别类的纪律与坑
 *   · archive/ project/  归档与项目资料
 *
 * 项目清单来源：rollout 首行扫出的 cwd 集合（曾跑过会话的目录）+ 当前活跃会话的工作目录。
 * 安全口径：目标由主进程自己拼、必须落在该项目的 `.codex-harness/memory`
 * 之下、必须是 `.md`/`.txt` **文件**（目录拒绝）。
 * ⛔ 删除是销毁性的（工作日志删了不重建），UI 侧必须二次确认。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { codexHome } from "../runtime-refs";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

const MEM_DIR = path.join(".codex-harness", "memory");
const READABLE_RE = /\.(md|txt|jsonl?)$/i;

/** memory 目录下的相对路径 → 分类（UI 分组用） */
function kindOf(rel: string): string {
  const first = rel.split("/")[0];
  if (rel === "MEMORY.md") return "长期记忆";
  if (rel === "LESSONS.md" || first === "lessons") return "坑与纪律";
  if (first === "logs") return "工作日志";
  if (first === "archive") return "归档";
  if (first === "project") return "项目资料";
  return "其它";
}

async function listRolloutFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 4) return out;
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listRolloutFiles(full, depth + 1, out);
    else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/** 读 rollout 首行拿 cwd（分块读到行尾 + 正则兜底 —— 首行含
    base_instructions，实测 22K 字符，固定小缓冲必失败）。 */
async function cwdOfRollout(file: string): Promise<string> {
  try {
    const handle = await fs.open(file, "r");
    try {
      const CHUNK = 64 * 1024, LIMIT = 512 * 1024;
      let text = "", pos = 0, found = false;
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
      try { return String(JSON.parse(text)?.payload?.cwd || ""); }
      catch {
        const m = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
        if (!m) return "";
        try { return JSON.parse(`"${m[1]}"`) as string; } catch { return m[1]; }
      }
    } finally { await handle.close(); }
  } catch { return ""; }
}

/** 曾跑过会话的项目目录（去重；不存在或不是目录的丢弃）。 */
async function knownProjectDirs(): Promise<string[]> {
  const home = path.resolve(String(codexHome || ""));
  const found = new Set<string>();
  for (const root of [path.join(home, "sessions"), path.join(home, "archived_sessions")]) {
    for (const file of await listRolloutFiles(root)) {
      const cwd = await cwdOfRollout(file);
      if (cwd) found.add(path.resolve(cwd));
    }
  }
  /* ⛔ 不用 threadCwd：它是 mutableState 访问器（只有 .get），不能遍历；项目集合只靠 rollout 扫描。 */
  const out: string[] = [];
  for (const dir of found) {
    const st = await fs.stat(dir).catch(() => null);
    if (st?.isDirectory()) out.push(dir);
  }
  return out;
}

async function walkFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 3) return out;
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, depth + 1, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function scanWorkLogs() {
  const projects: Array<{
    cwd: string; name: string; memoryDir: string; exists: boolean;
    files: Array<{ path: string; rel: string; kind: string; bytes: number; mtime: number }>;
    bytes: number;
  }> = [];
  for (const cwd of (await knownProjectDirs()).sort()) {
    const memoryDir = path.join(cwd, MEM_DIR);
    const exists = Boolean(await fs.stat(memoryDir).catch(() => null));
    const files: Array<{ path: string; rel: string; kind: string; bytes: number; mtime: number }> = [];
    let bytes = 0;
    if (exists) {
      for (const full of await walkFiles(memoryDir)) {
        const stat = await fs.stat(full).catch(() => null);
        if (!stat?.isFile()) continue;
        const rel = path.relative(memoryDir, full).replace(/\\/g, "/");
        files.push({ path: full, rel, kind: kindOf(rel), bytes: stat.size, mtime: stat.mtimeMs });
        bytes += stat.size;
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    projects.push({
      cwd, name: path.basename(cwd) || cwd, memoryDir, exists, files, bytes,
    });
  }
  // 有日志的项目排前面，其次按总量
  projects.sort((a, b) => (b.files.length ? 1 : 0) - (a.files.length ? 1 : 0) || b.bytes - a.bytes);
  return { projects };
}

async function readWorkLog(input: { path: string }) {
  const target = path.resolve(String(input?.path ?? ""));
  const dirs = await knownProjectDirs();
  const rooted = dirs.find((cwd) => target.startsWith(path.join(cwd, MEM_DIR) + path.sep));
  if (!rooted) throw new Error("只能读取项目工作日志目录（.codex-harness/memory）内的文件");
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) throw new Error("文件不存在");
  if (stat.size > 512 * 1024) throw new Error("文件过大（>512KB），请到文件管理器打开");
  const text = await fs.readFile(target, "utf8");
  return { path: target, text, bytes: stat.size, mtime: stat.mtimeMs };
}

async function deleteWorkLogs(input: { paths: string[] }) {
  const dirs = await knownProjectDirs();
  const roots = dirs.map((cwd) => path.join(cwd, MEM_DIR) + path.sep);
  let deleted = 0, bytes = 0;
  const failed: string[] = [];
  for (const raw of Array.isArray(input?.paths) ? input.paths : []) {
    const target = path.resolve(String(raw));
    if (!roots.some((root) => target.startsWith(root))) { failed.push(String(raw)); continue; }
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) { failed.push(String(raw)); continue; }
      await fs.unlink(target);
      deleted++; bytes += stat.size;
    } catch { failed.push(String(raw)); }
  }
  return { deleted, bytes, failed };
}

/* ── 插件形态（P2 批次 4）：三个 handler 的**实现**留在模块级纯函数里（逐字未改），
   注册 / 卸载交给容器 —— `inject: ["ipc"]` 声明依赖，不再直接 import electron。
   ⛔ 通道名 / 参数 / 返回值 / 错误文案一字不改：换容器不许改对外契约（守卫【226】锚三通道）。 */
export const workLogsFeature = defineFeature<null>({
  id: "work-logs",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // inject 已在容器侧挡过一次；这里再挡一次只为把类型收紧（⛔ 不写 `!`：缺依赖要报得出来）
    if (!ipcHost) throw new Error("work-logs: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("work-logs:scan", () => scanWorkLogs());
    ipcHost.handle("work-logs:read", (_event, input: { path: string }) => readWorkLog(input));
    ipcHost.handle("work-logs:delete", (_event, input: { paths: string[] }) => deleteWorkLogs(input));

    // 生命期：卸载时摘掉本域三个通道（不摘 = 卸载后通道还在、handler 却已被回收 ⇒ 调用报错）
    ctx.effect(() => {
      ipcHost.removeHandler("work-logs:scan");
      ipcHost.removeHandler("work-logs:read");
      ipcHost.removeHandler("work-logs:delete");
    });
  },
});
