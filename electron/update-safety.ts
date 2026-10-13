/**
 * update-safety —— 更新的**安全网**：快照 → 执行 → 失败回滚 / 成功丢弃。
 *
 * 为什么单列这一层（用户令：「更新失败时给出明确错误提示并执行回退，保证组件不处于损坏或半更新状态」）：
 *   各个后端（npm install / pip install / 市场重新落盘）都是「**就地写**」语义 ——
 *   中途断网、杀进程、磁盘满，目标目录就会停在「装了一半」的状态：旧文件被覆盖了一批，
 *   新文件还没补全，技能/插件既不能用也看不出为什么不能用。这种状态比更新失败本身糟得多。
 *
 * 本模块提供三件事：
 *   1. `snapshotDir`   —— 动写入前把目标目录整份快照到 `<userData>/update-backups/<id>/<ts>/`
 *   2. `restoreDir`    —— 失败时把快照搬回原位（先删残缺目标，再整份拷贝）⇒ 回到**更新前的确定状态**
 *   3. `dirFingerprint`—— 目录内容指纹（幂等判据：更新前后一样 ⇒ 本次是 no-op，别重复下载安装）
 *
 * ⛔⛔ **为什么用「目录快照」而不是包管理器的回滚**：pip/npm 没有可靠的 uninstall 语义，
 *    市场安装器更是直接解压覆盖。快照是唯一对所有后端都成立的统一回滚。
 * ⛔ 快照是**整份拷贝**而不是压缩包：少一个外部进程依赖（7z 自己也是要更新的组件之一），
 *    且回退时不需要任何解压工具可用 —— 回滚路径上依赖越少，越不可能自己也失败。
 * ⛔ 快照目录与「改动备份」不是一个東西别混：那是改代码前的文件备份（fix-change-backup），
 *    这是组件更新的回滚点，各自 prune 规则不同。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** 单个组件最多保留的快照份数（多了就是磁盘黑洞）。 */
const KEEP_PER_COMPONENT = 3;
/** 快照总量上限（字节）：超过就先淘汰最老的。 */
const TOTAL_CAP_BYTES = 1024 * 1024 * 1024; // 1 GB

export type SnapshotInfo = {
  /** 快照目录绝对路径（回滚用） */
  dir: string;
  /** 快照总字节 */
  bytes: number;
  /** 快照内文件数 */
  files: number;
};

async function pathExists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; } catch { return false; }
}

export async function dirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const walk = async (current: string): Promise<void> => {
    let entries: { name: string; isDirectory: () => boolean }[] = [];
    try { entries = await fs.readdir(current, { withFileTypes: true }) as unknown as typeof entries; } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      try {
        const stat = await fs.stat(full);
        bytes += stat.size;
        files += 1;
      } catch { /* 读不到的不计 */ }
    }
  };
  if (await pathExists(dir)) await walk(dir);
  return { bytes, files };
}

/**
 * 快照根目录：`<userData>/update-backups/<组件id>/<时间戳>/`。
 * ⛔ 用时间戳而不是固定名 ⇒ 同一组件多次更新不会互相覆盖（覆盖 = 上次的回滚点没了）。
 */
export function snapshotRoot(userData: string, id: string, at: number = Date.now()): string {
  const safeId = String(id).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "unknown";
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
  return path.join(userData, "update-backups", safeId, stamp);
}

/**
 * 把目录整份快照。源目录不存在 ⇒ 返回 null（**不是错误**：首次安装本来就没东西可保）。
 * ⛔ 拷贝失败必须让上层知道：静默跳过 = 以为有回滚点，失败时才发现没有 ⇒ 那还不如早失败。
 */
export async function snapshotDir(src: string, dest: string): Promise<SnapshotInfo | null> {
  if (!src || !dest) throw new Error("snapshotDir: 缺少源或目标路径");
  if (dest === src || dest.startsWith(src + path.sep)) throw new Error("snapshotDir: 快照目录不能落在被快照目录里（会自我递归）");
  if (!(await pathExists(src))) return null;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true, force: true, verbatimSymlinks: false });
  const { bytes, files } = await dirSize(dest);
  return { dir: dest, bytes, files };
}

/**
 * 回滚：删掉残缺的目标目录，把快照整份拷回原位。
 * ⛔ 先删后拷而不是 cp --force：后者的"合并"语义会把半截新文件留下，
 *    那份混合目录正是我们要消灭的「半更新状态」。
 */
export async function restoreDir(snapshot: string, dest: string): Promise<void> {
  if (!snapshot || !dest) throw new Error("restoreDir: 缺少快照或目标路径");
  if (!(await pathExists(snapshot))) throw new Error(`回滚点已丢失，无法自动回退：${snapshot}`);
  if (await pathExists(dest)) await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(snapshot, dest, { recursive: true, force: true, verbatimSymlinks: false });
}

/** 成功之后丢快照（留着能在下次 prune 时被回收，但没理由占着磁盘）。 */
export async function discardSnapshot(snapshot: string): Promise<void> {
  try { await fs.rm(snapshot, { recursive: true, force: true }); } catch { /* 清理失败不影响更新成功的结论 */ }
}

/**
 * 目录内容指纹 —— 所有文件相对路径 + sha256 排序后整体哈希。
 * 用途：① 幂等（内容没变就不用装）；② 更新后确认"确实变了"。
 * ⛔ 目录名/修改时间**不进**指纹：只认内容，否则重装还会得到一个不同的值。
 */
export async function dirFingerprint(dir: string): Promise<string> {
  const parts: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries: { name: string; isDirectory: () => boolean }[] = [];
    try { entries = await fs.readdir(current, { withFileTypes: true }) as unknown as typeof entries; } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(full, rel); continue; }
      try {
        const buf = await fs.readFile(full);
        parts.push(`${rel}:${crypto.createHash("sha256").update(buf).digest("hex")}`);
      } catch { parts.push(`${rel}:<unreadable>`); }
    }
  };
  if (!(await pathExists(dir))) return "missing";
  await walk(dir, "");
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

/** 列出某组件的全部回滚点，新的在前。 */
export async function listSnapshots(userData: string, id: string): Promise<{ dir: string; at: number }[]> {
  const safeId = String(id).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "unknown";
  const base = path.join(userData, "update-backups", safeId);
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ dir: path.join(base, entry.name), at: Number(Date.parse(entry.name.replace(/-/g, (m, i) => (i > 9 ? ":" : "-")))) || 0 }))
      .sort((a, b) => b.at - a.at);
  } catch { return []; }
}

/**
 * 淘汰多余快照：每个组件只留最近 KEEP_PER_COMPONENT 份，总量超 TOTAL_CAP_BYTES 再按时间淘汰。
 * ⛔ 为什么必须 prune：快照是整份拷贝，技能目录几十 MB，不 prune 迟早撑爆磁盘
 *    —— 而磁盘满恰恰又是最常见的更新失败原因，形成死循环。
 */
export async function pruneSnapshots(userData: string, id: string): Promise<number> {
  const snapshots = await listSnapshots(userData, id);
  let removed = 0;
  for (const snapshot of snapshots.slice(KEEP_PER_COMPONENT)) {
    await discardSnapshot(snapshot.dir).then(() => { removed += 1; }).catch(() => undefined);
  }
  // 总量兜底：还在超就从最老的继续删
  let remain = snapshots.slice(0, KEEP_PER_COMPONENT);
  let total = 0;
  for (const snapshot of remain) total += (await dirSize(snapshot.dir)).bytes;
  for (const snapshot of [...remain].reverse()) {
    if (total <= TOTAL_CAP_BYTES) break;
    const size = (await dirSize(snapshot.dir)).bytes;
    try {
      await discardSnapshot(snapshot.dir);
      total -= size;
      removed += 1;
    } catch { /* 删不掉就留给下轮 */ }
  }
  return removed;
}

/**
 * 统一的「动手前快照 → 执行 → 失败回滚 / 成功 discard」包装。
 *
 * ⛔ 只有 **targetDir 给了** 才走这套保护（本文件滚动更新这类无目标目录的后端，由它们自己原子替换）。
 * ⛔ 回滚失败**要在结果里如实写出**（rolledBack:false + restoreError），不许吞掉
 *    —— 用户必须知道"这次没回滚成功，组件可能停在半更新状态"。
 */
export async function withRollback<T>(input: {
  targetDir?: string;
  userData: string;
  id: string;
  run: () => Promise<T>;
}): Promise<{ value: T; rolledBack: boolean; restoreError: string; snapshot: string }> {
  const { targetDir, userData, id, run } = input;
  if (!targetDir) {
    return { value: await run(), rolledBack: false, restoreError: "", snapshot: "" };
  }
  const snapshot = snapshotRoot(userData, id);
  let taken: SnapshotInfo | null = null;
  try { taken = await snapshotDir(targetDir, snapshot); }
  catch (error) {
    // ⛔ 拿不到回滚点就别动手 —— 保守失败好过事后无路可退
    throw new Error(`无法为 ${id} 创建回滚点，已放弃本次更新：${(error as Error)?.message ?? error}`);
  }
  try {
    const value = await run();
    // 成功 ⇒ 丢弃快照（保留最近的几份用于手动回滚，prune 负责淘汰）
    if (taken) await pruneSnapshots(userData, id);
    return { value, rolledBack: false, restoreError: "", snapshot: taken?.dir ?? "" };
  } catch (error) {
    if (!taken) throw error; // 本来就没东西可保 ⇒ 原样抛出，不加"回滚"字眼误导
    try {
      await restoreDir(taken.dir, targetDir);
      throw new Error(`${(error as Error)?.message ?? error}（已自动回滚到更新前的版本，未受影响）`);
    } catch (restoreError) {
      // 双重失败：如实报告，让用户知道要手动处理
      throw new Error(
        `${(error as Error)?.message ?? error}；⛔ 回滚也失败了（${(restoreError as Error)?.message ?? restoreError}），`
        + `请将 ${taken.dir} 手动拷回 ${targetDir}`,
      );
    }
  }
}
