/**
 * file-locate —— 按**文件名**在磁盘上找回真实文件（10-30）。
 *
 * ⛔⛔ 起因（用户第三次同一现象，附截图）：「这后面的文件跳转预览也同步修一下，只要是电脑上有的文件，
 * 不管在哪里都能打开，这个路径错」。根因不是读文件被拦，而是**卡片手里那条路径根本是错的**：
 *   · 命令卡/文件卡把相对路径按**会话目录**拼（`D:\测试` + `src\lib\x.mjs`）；
 *   · 而模型实际是在**另一个仓**里改同一个文件（命令里有 `cd D:\Codex Harness Desktop`，
 *     或者干脆只写了 `./src/lib/x.mjs`）。
 * 命令卡那条链已能按命令自己的 `cd` 解析（`resolveCommandTarget`），但**没有命令上下文**的
 * 卡片（引擎 fileChange / 回合产物 / 消息内文件卡）无从推断 ⇒ 只能问磁盘。
 *
 * 判据（三层，缺一层就会「明明有却打不开」）：
 *   ① **同名**：basename 必须完全一致（大小写不敏感），不做模糊匹配；
 *   ② **尾段证据**：给多个同名文件打分（从文件名往左连续相同的目录段数），取分最高的；
 *   ③ **有界**：时间预算 + 目录数预算 + 深度上限，超了就用已找到的最好结果。
 *      ⛔ 不做无界全盘遍历（用户点一次卡不该让主进程卡半分钟）。
 *
 * 根顺序 = **最可能命中的先扫**：会话工作目录（含各已知会话）→ 用户主目录（浅）→ 目标盘根。
 * 命中完美尾段匹配就提前结束，不必扫完。
 *
 * ⛔ 跳过重目录（node_modules / .git / dist / AppData / Windows…）：它们只会吃掉预算，
 *   而且用户真正要打开的文件不会在那里（真在里面就报「找不到」，比卡 3 秒好）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { threadCwd } from "./runtime-refs";

/** 单次查找的总时间预算（超时返回已找到的最好结果）。 */
const BUDGET_MS = 2600;
/** 目录数上限（防止超深目录树把时间预算全吃在 readdir 上）。 */
const MAX_DIRS = 24_000;
/** 命中缓存：正结果 5 分钟、负结果 60 秒（同一张卡连点不必重复扫盘）。 */
const HIT_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 60_000;

/** 只用来**排除**的重目录（小写比较）。 */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "dist-electron", "build", "out", "release",
  ".next", ".nuxt", ".output", ".turbo", "target", "vendor", "__pycache__",
  ".venv", "venv", "env", ".cache", ".idea", ".vs", ".vscode", "coverage", ".nyc_output",
  "$recycle.bin", "system volume information", "windows", "winsxs",
  "appdata", "program files", "program files (x86)", "programdata",
  ".gradle", ".m2", ".nuget", ".cargo", ".rustup", ".conda", "anaconda3", "miniconda3",
  "site-packages", "bower_components", ".pnpm-store", ".yarn", "logs", "temp", "tmp",
]);

const cache = new Map<string, { at: number; hit: string }>();
/** 同一次查找并发时共用一个 Promise（连点多张卡不重复扫盘）。 */
const inflight = new Map<string, Promise<string>>();

/** 百分号解码：会话文本里的路径常是 `D:/Codex%20Harness%20Desktop/...` 形态。 */
function safeDecode(value: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try { return decodeURIComponent(value); } catch { return value; }
}

/** 路径 → 目录段数组（去掉盘符 / 前导斜杠，统一小写）。 */
function segmentsOf(value: string): string[] {
  const parts = String(value).replace(/\\/g, "/").split("/").filter(Boolean);
  const start = /^[A-Za-z]:$/.test(parts[0] ?? "") ? 1 : 0;
  return parts.slice(start).map((part) => part.toLowerCase());
}

/** 从文件名往左数连续相同的目录段数（0 = 只有文件名对得上）。 */
function tailScore(found: string, tail: string[]): number {
  const segs = segmentsOf(found);
  let count = 0;
  const limit = Math.min(segs.length, tail.length);
  for (let index = 1; index <= limit; index += 1) {
    if (segs[segs.length - index] !== tail[tail.length - index]) break;
    count += 1;
  }
  return count;
}

type ScanState = { best: string; bestScore: number; bestTail: number };

/** 广度优先扫一棵根：浅的优先（同名文件里浅的更像"用户说的那个"）。
 *  ⛔ `maxDirs` 是**每棵根各自**的预算 —— 曾经写成全局计数器，主目录一扫就把它吃光，
 *     目标盘根压根轮不到（实测：`.bak-*` 那种不在会话目录里的文件永远找不回来）。 */
async function scanRoot(
  root: string,
  maxDepth: number,
  base: string,
  tail: string[],
  deadline: number,
  state: ScanState,
  maxDirs: number = MAX_DIRS,
): Promise<void> {
  let dirs = 0;
  let frontier = [root];
  for (let depth = 0; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const dir of frontier) {
      if (Date.now() > deadline || dirs >= maxDirs) return;
      if (state.bestTail >= tail.length) return; // 完美尾段匹配，不必再扫
      dirs += 1;
      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
      try {
        /* ⚠️ `fs.readdir` 的 Dirent 泛型在两个重载里不一致（Buffer/string），这里按结构取用，
           不跟类型体操纠缠 —— 只用 name / isDirectory / isFile 三个成员。 */
        entries = await fs.readdir(dir, { withFileTypes: true }) as unknown as typeof entries;
      } catch { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name.toLowerCase())) next.push(full);
          continue;
        }
        if (!entry.isFile() || entry.name.toLowerCase() !== base) continue;
        const tailHits = tailScore(full, tail);
        const score = tailHits * 1000 - depth;
        if (score > state.bestScore) {
          state.bestScore = score;
          state.bestTail = tailHits;
          state.best = full;
        }
      }
    }
    frontier = next;
  }
}

/** 扫描根 + 各自预算。⛔ 顺序 = **最可能命中的先扫**：
 *   ① 目标盘根（卡片给的路径多半只是"目录段错了"，盘是对的 —— 同盘仓里最可能真有这个文件）；
 *   ② 各已知会话工作目录（浅、小，命中率高）；
 *   ③ 用户主目录（深、杂，最后兜底）。
 *  之前把会话目录放第一、盘根放最后，主目录那 700ms 一扫就容易把预算吃光。 */
function buildRoots(abs: string): Array<{ dir: string; depth: number; budgetMs: number; dirs: number }> {
  const out: Array<{ dir: string; depth: number; budgetMs: number; dirs: number }> = [];
  const seen = new Set<string>();
  const push = (dir: string, depth: number, budgetMs: number, dirs: number) => {
    const value = String(dir ?? "").trim();
    if (!value || seen.has(value.toLowerCase())) return;
    seen.add(value.toLowerCase());
    out.push({ dir: value, depth, budgetMs, dirs });
  };
  if (abs) {
    const root = path.parse(abs).root;
    if (root) push(root, 6, 1200, 12_000);
  }
  for (const cwd of threadCwd.values()) if (cwd) push(cwd, 10, 500, 6_000);
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  if (home) push(home, 4, 600, 6_000);
  return out;
}

/**
 * 按文件名找回真实文件。
 * @param requested 卡片给的（可能不存在的）路径；相对路径无法定位时返回 ""
 * @returns 命中的绝对路径；找不到返回 ""
 */
export async function locateFile(requested: string, options: { timeBudgetMs?: number } = {}): Promise<string> {
  const raw = String(requested ?? "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  const decoded = safeDecode(raw);
  if (!path.isAbsolute(decoded)) return "";
  const abs = path.normalize(decoded);
  const base = path.basename(abs).toLowerCase();
  /* 只找"像文件"的名字（含扩展名）。⛔ 别把规则写成 `\.[a-z0-9]{1,8}$` ——
     备份文件 `x.mjs.bak-20261029`、`.d.mts`、`.tar.gz` 都会被挡掉（实测就栽在这条上，
     用户点的那张卡正好是 `.bak-20261029`）。扫描时反正只认 isFile，放宽没有副作用。 */
  if (!base || base.startsWith(".") || !/\.[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/.test(base)) return "";

  const cached = cache.get(base);
  if (cached && Date.now() - cached.at < (cached.hit ? HIT_TTL_MS : MISS_TTL_MS)) return cached.hit;

  const running = inflight.get(base);
  if (running) return running;

  const task = (async () => {
    const tail = segmentsOf(abs);
    const state: ScanState = { best: "", bestScore: -1, bestTail: 0 };
    const deadline = Date.now() + (options.timeBudgetMs ?? BUDGET_MS);
    for (const root of buildRoots(abs)) {
      if (Date.now() >= deadline) break;
      const slice = Math.min(deadline, Date.now() + root.budgetMs);
      await scanRoot(root.dir, root.depth, base, tail, slice, state, root.dirs);
      if (state.bestTail >= tail.length) break; // 完美尾段匹配：够准了，别再花钱
    }
    const hit = state.best || "";
    cache.set(base, { at: Date.now(), hit });
    return hit;
  })().finally(() => inflight.delete(base));

  inflight.set(base, task);
  return task;
}
