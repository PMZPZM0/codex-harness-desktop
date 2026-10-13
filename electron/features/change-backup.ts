/**
 * 改动备份（10-13）—— 与 WorkBuddy 的「改动备份」同构，但**路径可配 + 可开关**。
 *
 * ── 为什么有这层 ──────────────────────────────────────────────
 * 宿主已有 `turn-file-watch.ts` 在回合结束时做工作区快照并算出「哪些文件变了」
 * （带 additions/deletions，还跑过 4000 全局 + 600 单目录两级预算与 IGNORE 表）。
 * ⛔ **本模块只负责「把那份结果落成可回看的备份档案」，不重写 diff、不重写 walker** ——
 *   再写一套遍历就是两处真相源，且必然与 turn-file-watch 的 IGNORE/预算漂移。
 *
 * ── 与 WorkBuddy 的一致处（对齐其真实产物，不是想象）────────────────
 * 实测 `~/.workbuddy/` 的真实结构：
 *   changes-index/<conversationId>.json          ← 索引（version + changes[]）
 *   changes-detail/<conversationId>/cd_<uuid>.<revision>.json   ← 明细（含 hunks 全文）
 * 索引条目字段：`id`（`<conversationId>,<requestId>`）、`conversationId`、`requestId`、
 *   `summary`、`files[]`、`fileCount`、`additions`、`deletions`、`createdAt`(ms)、
 *   `revision`、`detailRef`、`checkpointId`。
 * 文件项：`filePath` / `action`(create|modify|delete) / `additions` / `deletions` /
 *   `hunks[]{oldStart,oldLines,newStart,newLines,lines[]}`，另有 `detailStatus`
 *   （明细省略正文时标 `content-omitted-size`）。
 * ⇒ 本模块沿用同名字段与同款命名，**便于将来互通/导入**。
 *
 * ⛔ **刻意与 WorkBuddy 的两处差异（用户 10-13 明确要求，WorkBuddy 实测并无这两项）**：
 *   ① 有**开关**（`changeBackupEnabled`）；② 根目录**可自定义**（`changeBackupDir`）。
 *   WorkBuddy 的目录固定在数据目录旁、settings.json 里搜不到任何 backup 开关。
 *   之所以能对齐，是因为**只有根目录不同、里面结构逐字段一致**。
 *
 * ⛔ 惰性求值（【91】）：`app.getPath("userData")` 一律**调用时**取，绝不在模块体求值。
 * ⛔ 备份失败**永不抛**：备份是旁路能力，磁盘满/路径失效都只记日志 + 通知一次，
 *    绝不能因此打断回合（用户正在写的东西比备份重要）。
 */
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";

/** 索引文件格式版本（与 WorkBuddy 一致 = 2）。 */
const INDEX_VERSION = 2;
/** 明细文件格式版本（同 = 1）。 */
const DETAIL_VERSION = 1;
/** 单次写入明细的大小上限（字节）：超了只留元信息 + `content-omitted-size`，
 *  与 WorkBuddy 的 `detailStatus` 同款处理 —— 备份不该把磁盘写爆。 */
const DETAIL_MAX_BYTES = 8 * 1024 * 1024;
/** 索引里最多保留的变更条数（超出丢最旧的；明细文件不删，避免误删用户唯一副本）。 */
const INDEX_MAX_CHANGES = 200;
/**
 * 备份总容量上限（10-13 用户令「最大 3G 备份，超过就删除旧的」）。
 * ⛔ **3G 指磁盘占用总和**（索引 + 明细），不是条数 —— 单条明细最大 8MB，
 *    200 条上限之下也可能堆到几百 MB，只按条数裁剪不构成容量约束。
 */
export const BACKUP_MAX_BYTES = 3 * 1024 * 1024 * 1024;
/** 单次清理最多搬多少条进回收站（防一次扫描/搬移卡住主进程；剩下的留给下一次写入再清）。 */
const PRUNE_MAX_PER_WRITE = 50;

export type BackupFileAction = "create" | "modify" | "delete";

export type BackupFileHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type BackupFile = {
  filePath: string;
  action: BackupFileAction;
  additions: number;
  deletions: number;
  hunks?: BackupFileHunk[];
  detailStatus?: string;
};

export type BackupChange = {
  id: string;
  conversationId: string;
  requestId: string;
  summary: string;
  files: BackupFile[];
  fileCount: number;
  additions: number;
  deletions: number;
  createdAt: number;
  revision: string;
  detailRef?: string;
  checkpointId?: string;
  /** 明细因体积超限而省略正文时标 `content-omitted-size`（同 WorkBuddy 的 `detailStatus`）。 */
  detailStatus?: string;
};

type BackupIndex = { version: number; changes: BackupChange[] };

/** 一次写入的结果（供 IPC 如实回话，不吞错误）。 */
export type BackupWriteResult = { ok: boolean; error?: string; detailRef?: string };

/** 惰性取默认根目录：`<userData>/change-backups`。 */
function defaultRoot(): string {
  return path.join(app.getPath("userData"), "change-backups");
}

/**
 * 解析并规范化根目录。
 * ⛔ 空串 = 用默认；非法（相对路径 / 根目录本身 / 含 NUL）一律回退默认并由调用方告知，
 *   **不抛** —— 配置项写错不该让应用起不来。
 */
export function normalizeBackupDir(input: unknown): { dir: string; fallback: boolean } {
  const raw = String(input ?? "").trim();
  if (!raw) return { dir: defaultRoot(), fallback: false };
  if (raw.includes("\0")) return { dir: defaultRoot(), fallback: true };
  if (!path.isAbsolute(raw)) return { dir: defaultRoot(), fallback: true };
  try {
    const resolved = path.resolve(raw);
    // ⛔ 不允许指向盘符根或文件系统根：备份会往里写几百 MB，写到 C:\ 上等于自毁磁盘。
    const parsed = path.parse(resolved);
    if (resolved === parsed.root) return { dir: defaultRoot(), fallback: true };
    return { dir: resolved, fallback: false };
  } catch {
    return { dir: defaultRoot(), fallback: true };
  }
}

/** 确保根目录存在（不存在则创建）。返回是否成功。 */
export function ensureBackupDir(dir: string): boolean {
  try {
    fsSync.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function indexFile(root: string, conversationId: string): string {
  return path.join(root, "changes-index", `${conversationId}.json`);
}

function detailDir(root: string, conversationId: string): string {
  return path.join(root, "changes-detail", conversationId);
}

/** 读索引（坏文件当空，不抛）。 */
function readIndex(root: string, conversationId: string): BackupIndex {
  try {
    const raw = fsSync.readFileSync(indexFile(root, conversationId), "utf8");
    const parsed = JSON.parse(raw) as Partial<BackupIndex>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.changes)) {
      return { version: INDEX_VERSION, changes: [] };
    }
    return { version: Number(parsed.version) || INDEX_VERSION, changes: parsed.changes as BackupChange[] };
  } catch {
    return { version: INDEX_VERSION, changes: [] };
  }
}

/** 写索引（临时文件 + rename，防半截 JSON）。 */
function writeIndex(root: string, conversationId: string, index: BackupIndex): boolean {
  try {
    const file = indexFile(root, conversationId);
    fsSync.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fsSync.writeFileSync(tmp, JSON.stringify(index, null, 2), "utf8");
    fsSync.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** 把 turn-file-watch 那种「文件条目」归一成备份的形状（只认它真有的字段）。 */
function normalizeFile(raw: any): BackupFile | null {
  const filePath = String(raw?.filePath ?? "").trim();
  if (!filePath) return null;
  const actionRaw = String(raw?.action ?? "modify");
  const action: BackupFileAction = actionRaw === "create" || actionRaw === "delete" ? actionRaw : "modify";
  const file: BackupFile = {
    filePath,
    action,
    additions: Number(raw?.additions ?? 0) || 0,
    deletions: Number(raw?.deletions ?? 0) || 0,
  };
  // hunks 只在明细里给；索引侧省略正文（与 WorkBuddy 的 detailStatus 同思路）
  if (Array.isArray(raw?.hunks) && raw.hunks.length) {
    file.hunks = raw.hunks.map((h: any) => ({
      oldStart: Number(h?.oldStart ?? 0),
      oldLines: Number(h?.oldLines ?? 0),
      newStart: Number(h?.newStart ?? 0),
      newLines: Number(h?.newLines ?? 0),
      lines: Array.isArray(h?.lines) ? h.lines.map((x: any) => String(x)) : [],
    }));
  }
  return file;
}

/**
 * 落一条备份。
 *
 * @param conversationId 会话 id（对应 WorkBuddy 的 conversationId = 目录名）
 * @param requestId 本回合的 turn/request id（对应 WorkBuddy 的 requestId）
 * @param files `turn-file-watch` 给出的文件变更条目
 * @param opts.checkpointId / opts.revision 可选，用于与引擎 checkpoint 对齐
 *
 * ⛔ **永不抛**：所有失败都走返回值，由 IPC 决定要不要提示用户。
 * ⛔ 空变更（0 个文件）不写：备份目录只放「真的改过东西」的回合。
 */
export async function writeChangeBackup(
  conversationId: string,
  requestId: string,
  files: any[],
  opts: { root?: string; checkpointId?: string; revision?: string; trash?: (p: string) => Promise<boolean> } = {},
): Promise<BackupWriteResult> {
  const conv = String(conversationId ?? "").trim();
  const req = String(requestId ?? "").trim();
  if (!conv || !req) return { ok: false, error: "bad_arguments" };

  const normalized = (Array.isArray(files) ? files : []).map(normalizeFile).filter((f): f is BackupFile => Boolean(f));
  if (!normalized.length) return { ok: true, detailRef: undefined };

  const root = opts.root ? normalizeBackupDir(opts.root).dir : defaultRoot();
  if (!ensureBackupDir(root)) return { ok: false, error: "mkdir_failed" };

  const revision = opts.revision || randomUUID();
  const changeId = `${conv},${req}`;
  const additions = normalized.reduce((sum, f) => sum + f.additions, 0);
  const deletions = normalized.reduce((sum, f) => sum + f.deletions, 0);
  const change: BackupChange = {
    id: changeId,
    conversationId: conv,
    requestId: req,
    summary: `${normalized.length} 个文件变更，+${additions} −${deletions}`,
    files: normalized.map((f) => ({ filePath: f.filePath, action: f.action, additions: f.additions, deletions: f.deletions })),
    fileCount: normalized.length,
    additions,
    deletions,
    createdAt: Date.now(),
    revision,
  };

  // 明细（带 hunks 全文）—— 超过体积上限就降级为「省略正文」，索引仍可用。
  let detailRef: string | undefined;
  try {
    const dir = detailDir(root, conv);
    await fsp.mkdir(dir, { recursive: true });
    const detailName = `cd_${randomUUID()}.${revision}.json`;
    const detailPayload = { version: DETAIL_VERSION, change: { ...change, files: normalized } };
    let text = JSON.stringify(detailPayload, null, 2);
    if (text.length > DETAIL_MAX_BYTES) {
      change.detailStatus = "content-omitted-size";
      detailPayload.change.files = normalized.map((f) => ({
        ...f,
        hunks: undefined,
        detailStatus: "content-omitted-size",
      }));
      text = JSON.stringify(detailPayload, null, 2);
    }
    await fsp.writeFile(path.join(dir, detailName), text, "utf8");
    detailRef = detailName;
    change.detailRef = detailName;
  } catch {
    // 明细写不了不影响索引可用（索引才是回看的主入口）
    detailRef = undefined;
  }

  if (opts.checkpointId) change.checkpointId = opts.checkpointId;

  const index = readIndex(root, conv);
  index.version = INDEX_VERSION;
  // ⛔ 覆盖/版本策略：**同 requestId 视为同一条的重试** ⇒ 原地替换而不是追加
  //   （引擎重放同一回合会再触发一次 completed，追加就会出现两条重复记录）。
  const at = index.changes.findIndex((c) => c.requestId === req);
  if (at >= 0) index.changes[at] = change;
  else index.changes.push(change);
  if (index.changes.length > INDEX_MAX_CHANGES) index.changes.splice(0, index.changes.length - INDEX_MAX_CHANGES);

  if (!writeIndex(root, conv, index)) return { ok: false, error: "index_write_failed" };

  // 容量裁剪（10-13：最大 3G，超了把最旧的搬进回收站）。
  // ⛔ **必须在写完之后做**（不是写之前预估）：先裁再写会白裁一遍（写完又超了）。
  // ⛔ 裁剪失败不影响本次备份的成功返回 —— 备份已落盘，裁剪只是 housekeeping。
  if (opts.trash) {
    try {
      const pruned = await pruneBackupsBySize(root, { trash: opts.trash });
      if (pruned.prunedConversations > 0) {
        console.warn(
          `[change-backup] 超出 ${Math.round(BACKUP_MAX_BYTES / 1024 ** 3)}G 上限：已把 ${pruned.prunedConversations} 个最旧会话移入回收站（释放 ${(pruned.freedBytes / 1024 ** 2).toFixed(1)} MB）`,
        );
      }
    } catch { /* 旁路：裁剪失败不牵连本次备份 */ }
  }
  return { ok: true, detailRef };
}

/**
 * 容量裁剪：超过 `BACKUP_MAX_BYTES` 时把**最旧的**备份移进回收站，直到降回上限内。
 *
 * ⛔⛔ **进回收站而不是 `rm`**（10-13 用户令「删除旧的放回收站」）：
 *   备份是**用户代码的唯一副本**，直接 `rmSync` = 不可恢复地删掉别人写的东西。
 *   `shell.trashItem`（主进程）才是"用户能自己捞回来"的那条路。
 *   ⛔ `shell` 只有主进程有 ⇒ 这里通过注入的 `trash` 回调拿，模块本身不 import electron shell
 *      （顺带让本模块能被纯 Node 环境真跑测试）。
 *
 * ⚠️ 裁剪口径：**按会话**为单位删（同一会话的索引 + 明细一起走）——
 *   只删明细会让索引指向不存在的文件（点开就是"文件已被清理"，比删干净更让人困惑）。
 *
 * @param deps.trash 把路径移进回收站；返回是否成功（失败则**保留**该会话，绝不退化成硬删）
 * @returns 被裁掉的会话数与释放的字节数（供界面/日志如实回报）
 */
export function pruneBackupsBySize(
  root: string,
  deps: {
    trash: (targetPath: string) => Promise<boolean>;
    maxBytes?: number;
  },
): Promise<{ prunedConversations: number; freedBytes: number; skipped: number }> {
  const maxBytes = deps.maxBytes ?? BACKUP_MAX_BYTES;
  const result = { prunedConversations: 0, freedBytes: 0, skipped: 0 };
  return (async () => {
    try {
      const indexRoot = path.join(root, "changes-index");
      const detailRoot = path.join(root, "changes-detail");
      if (!fsSync.existsSync(indexRoot)) return result;

      // 逐会话汇总大小 + 最早时间（"最旧"= 索引里 createdAt 最小的那条；索引全空则退回目录 mtime）
      type Entry = { conv: string; bytes: number; oldest: number };
      const entries: Entry[] = [];
      let total = 0;
      for (const name of fsSync.readdirSync(indexRoot)) {
        if (!name.endsWith(".json")) continue;
        const conv = name.replace(/\.json$/, "");
        let bytes = 0;
        try { bytes += fsSync.statSync(path.join(indexRoot, name)).size; } catch { /* 读不到就当 0 */ }
        let oldest = 0;
        try {
          const parsed = JSON.parse(fsSync.readFileSync(path.join(indexRoot, name), "utf8")) as BackupIndex;
          const changes = Array.isArray(parsed?.changes) ? parsed.changes : [];
          oldest = changes.reduce((min, c) => Math.min(min, Number(c?.createdAt ?? Infinity)), Infinity);
        } catch { /* 坏索引：退回 mtime */ }
        const detailDir = path.join(detailRoot, conv);
        try {
          for (const f of fsSync.readdirSync(detailDir)) {
            try { bytes += fsSync.statSync(path.join(detailDir, f)).size; } catch { /* 尽力而为 */ }
          }
        } catch { /* 没有明细目录 */ }
        let mtime = 0;
        try { mtime = fsSync.statSync(path.join(indexRoot, name)).mtimeMs; } catch { /* 尽力而为 */ }
        entries.push({ conv, bytes, oldest: Number.isFinite(oldest) && oldest > 0 ? oldest : mtime });
        total += bytes;
      }
      if (total <= maxBytes) return result;

      entries.sort((a, b) => a.oldest - b.oldest);   // 最旧在前
      for (const entry of entries) {
        if (total <= maxBytes) break;
        if (result.prunedConversations >= PRUNE_MAX_PER_WRITE) break;   // 单次限量，别卡住主进程
        const indexFilePath = path.join(indexRoot, `${entry.conv}.json`);
        const detailDir = path.join(detailRoot, entry.conv);
        // ⛔ **先搬明细、后搬索引**：反了的话，中途失败会留下一个"有索引无明细"的孤儿会话。
        const okDetail = await moveToTrash(detailDir, deps.trash, result);
        const okIndex = await moveToTrash(indexFilePath, deps.trash, result);
        if (okDetail && okIndex) {
          total -= entry.bytes;
          result.prunedConversations++;
        }
      }
      return result;
    } catch {
      return result;   // 裁剪失败不影响备份本身（旁路能力）
    }
  })();
}

/** 把一个路径移进回收站；**失败返回 false 且不硬删**（保留数据优先）。 */
async function moveToTrash(target: string, trash: (p: string) => Promise<boolean>, result: { skipped: number }): Promise<boolean> {
  if (!fsSync.existsSync(target)) return true;   // 已经不在了（可能是上轮裁过的）
  try {
    const ok = await trash(target);
    if (!ok) result.skipped++;
    return ok;
  } catch {
    result.skipped++;
    return false;
  }
}

/** 读某个会话的备份索引（供界面回显/查看）。 */
export function readChangeBackups(conversationId: string, root?: string): BackupChange[] {
  const conv = String(conversationId ?? "").trim();
  if (!conv) return [];
  const base = root ? normalizeBackupDir(root).dir : defaultRoot();
  return readIndex(base, conv).changes;
}

/** 备份根目录下的产物概览（界面显示「已备份 N 个回合 / 占多少空间」）。 */
export function backupSummary(root?: string): { root: string; conversations: number; changes: number; bytes: number } {
  const base = root ? normalizeBackupDir(root).dir : defaultRoot();
  const result = { root: base, conversations: 0, changes: 0, bytes: 0 };
  const indexRoot = path.join(base, "changes-index");
  try {
    for (const name of fsSync.readdirSync(indexRoot)) {
      if (!name.endsWith(".json")) continue;
      result.conversations++;
      try {
        const parsed = JSON.parse(fsSync.readFileSync(path.join(indexRoot, name), "utf8")) as BackupIndex;
        result.changes += Array.isArray(parsed?.changes) ? parsed.changes.length : 0;
      } catch { /* 单个坏索引不影响概览 */ }
    }
  } catch { /* 目录还没有 = 还没有任何备份 */ }
  const detailRoot = path.join(base, "changes-detail");
  try {
    for (const conv of fsSync.readdirSync(detailRoot)) {
      for (const name of fsSync.readdirSync(path.join(detailRoot, conv))) {
        try { result.bytes += fsSync.statSync(path.join(detailRoot, conv, name)).size; } catch { /* 尽力而为 */ }
      }
    }
  } catch { /* 没有明细目录 */ }
  return result;
}

/** 清空备份（界面「清空备份」用；⚠️ 不可恢复，调用方必须先确认）。 */
export function clearChangeBackups(root?: string): boolean {
  const base = root ? normalizeBackupDir(root).dir : defaultRoot();
  for (const sub of ["changes-index", "changes-detail"]) {
    try { fsSync.rmSync(path.join(base, sub), { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 10-13：给 Codex 自己用的操作面（不只是"自动备份"，还要**能被 agent 驱动**）
 *
 * 场景：用户报「昨天那次改动我找不回来」时，模型应该能自己
 *   ① 看有哪些备份（list）② 读某条备份到底改了什么（read，含 hunks 全文）
 *   ③ 把某个文件**回滚**到备份里的内容（restore）④ 手动触发一次容量裁剪（prune）。
 * ⛔ 全部**只读优先**：restore 写的是工作区文件，必须显式指定文件路径与备份条目，
 *   不做"整条一键回滚"（那会连带覆盖用户之后的所有改动）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 列出全部会话的备份概览（供 agent 判断"有没有可捞的"）。 */
export function listAllBackups(root?: string): {
  conversations: { conversationId: string; changes: number; newest: number; oldest: number }[];
  total: number;
  bytes: number;
} {
  const base = root ? normalizeBackupDir(root).dir : defaultRoot();
  const conversations: { conversationId: string; changes: number; newest: number; oldest: number }[] = [];
  const out = { conversations, total: 0, bytes: 0 };
  const indexRoot = path.join(base, "changes-index");
  try {
    for (const name of fsSync.readdirSync(indexRoot)) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(fsSync.readFileSync(path.join(indexRoot, name), "utf8")) as BackupIndex;
        const changes = Array.isArray(parsed?.changes) ? parsed.changes : [];
        if (!changes.length) continue;
        const times = changes.map((c) => Number(c?.createdAt ?? 0)).filter((n) => n > 0);
        out.conversations.push({
          conversationId: name.replace(/\.json$/, ""),
          changes: changes.length,
          newest: times.length ? Math.max(...times) : 0,
          oldest: times.length ? Math.min(...times) : 0,
        });
        out.total += changes.length;
      } catch { /* 坏索引跳过 */ }
    }
  } catch { /* 没有备份目录 */ }
  out.conversations.sort((a, b) => b.newest - a.newest);
  const detailRoot = path.join(base, "changes-detail");
  try {
    for (const conv of fsSync.readdirSync(detailRoot)) {
      for (const f of fsSync.readdirSync(path.join(detailRoot, conv))) {
        try { out.bytes += fsSync.statSync(path.join(detailRoot, conv, f)).size; } catch { /* 尽力而为 */ }
      }
    }
  } catch { /* 没有明细目录 */ }
  return out;
}

/** 读某条备份的**全文**（索引里的条目 + 明细里的 hunks）。找不到返回 null。 */
export function readBackupChange(
  conversationId: string,
  requestId: string,
  root?: string,
): { index: BackupChange; detail: BackupChange | null } | null {
  const base = root ? normalizeBackupDir(root).dir : defaultRoot();
  const index = readIndex(base, String(conversationId ?? "").trim());
  const hit = index.changes.find((c) => c.requestId === String(requestId ?? "").trim());
  if (!hit) return null;
  let detail: BackupChange | null = null;
  if (hit.detailRef) {
    try {
      const raw = fsSync.readFileSync(path.join(detailDir(base, String(conversationId).trim()), hit.detailRef), "utf8");
      detail = (JSON.parse(raw) as any)?.change ?? null;
    } catch { /* 明细缺失或坏了：索引仍可用 */ }
  }
  return { index: hit, detail };
}

/**
 * 把某个文件回滚成备份里那一版的内容。
 *
 * ⛔ **必须能从备份里取出完整正文** —— 只有 hunks（差异片段）是不够的，
 *   重建整个文件需要「原文件内容 + 补丁」。因此本函数只在**明细里带完整正文**时可用；
 *   `writeChangeBackup` 默认只存 hunks（省空间）⇒ 多数情况下这里会返回
 *   `needs_full_content`，**如实告诉调用方"备份里有这次改动的差异，但没有整份正文"**，
 *   绝不假装成功、也不去乱猜文件现在的内容。
 *
 * ⛔ 目标文件必须落在**当前工作区**内（防路径穿越把用户文件写到任意位置）。
 */
export function restoreFileFromBackup(input: {
  conversationId: string;
  requestId: string;
  filePath: string;
  root?: string;
  workspace?: string;
}): { ok: boolean; error?: string; note?: string } {
  const conv = String(input?.conversationId ?? "").trim();
  const req = String(input?.requestId ?? "").trim();
  const filePath = String(input?.filePath ?? "").trim();
  if (!conv || !req || !filePath) return { ok: false, error: "bad_arguments" };
  const base = input.root ? normalizeBackupDir(input.root).dir : defaultRoot();
  const found = readBackupChange(conv, req, base);
  if (!found) return { ok: false, error: "backup_not_found" };
  // 明细里带的是 hunks（差异），不是整份正文 ⇒ 无法据此重建文件。
  const full = (found.detail as any)?.files?.find((f: any) => f?.filePath === filePath && typeof f?.content === "string");
  if (!full) {
    return {
      ok: false,
      error: "needs_full_content",
      note: `备份里有这次改动对 ${filePath} 的差异（hunks），但没有整份正文，无法自动回滚。可据 hunk 定位后手工改，或用「保留版本副本」的方式对照。`,
    };
  }
  // 路径穿越防线：目标必须落在工作区内
  const ws = String(input.workspace ?? "").trim();
  if (ws) {
    const abs = path.resolve(filePath);
    const rootWs = path.resolve(ws);
    if (abs !== rootWs && !abs.startsWith(rootWs + path.sep)) return { ok: false, error: "outside_workspace" };
  }
  try {
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
    fsSync.writeFileSync(filePath, String(full.content), "utf8");
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}

/** 手动触发一次容量裁剪（agent 也能用，不必等下一次写备份才触发）。 */
export async function pruneBackups(
  root: string | undefined,
  trash: (p: string) => Promise<boolean>,
  maxBytes?: number,
): Promise<{ prunedConversations: number; freedBytes: number; skipped: number; bytes: number }> {
  const base = root ? normalizeBackupDir(root).dir : defaultRoot();
  const before = backupSummary(base).bytes;
  const r = await pruneBackupsBySize(base, { trash, maxBytes });
  return { ...r, bytes: backupSummary(base).bytes };
}

/**
 * 回合收尾时落备份（**唯一入口**，由 boot 的 turn/completed 分支调）。
 *
 * ⛔ 阶梯第 2 级「本仓已有吗」：`turn-file-watch` 已经把工作区走完、算出哪些文件变了
 *   （带增删行数、跑过 IGNORE 与两级文件数预算），**这里只做搬运与落盘**。
 *   自己再写一遍遍历 = 两处真相源，且忽略规则必然与它漂移。
 *
 * ⛔ 开关关闭 ⇒ 直接返回，**一行都不落**（用户没主动开之前不产生任何产物）。
 * ⛔ 永不抛：磁盘满 / 目录失效只记日志。
 */
export async function backupTurnIfEnabled(
  threadId: string,
  turnId: string,
  deps: {
    /** 从 turn-file-watch 取该回合的文件变更条目（真实遍历结果的唯一来源） */
    filesForTurn: (threadId: string, turnId: string) => any[];
    /** 读设置（开关 + 目录） */
    readSettings: () => { enabled: boolean; dir: string };
    /** 把路径移进系统回收站（⛔ 容量裁剪专用；不给则不做裁剪） */
    trash?: (targetPath: string) => Promise<boolean>;
  },
): Promise<BackupWriteResult | null> {
  try {
    const settings = deps.readSettings();
    if (!settings.enabled) return null;                       // 关闭 = 不落盘
    const tid = String(threadId ?? "").trim();
    const rid = String(turnId ?? "").trim();
    if (!tid || !rid) return { ok: false, error: "bad_arguments" };

    const files = deps.filesForTurn(tid, rid);
    if (!Array.isArray(files) || !files.length) return { ok: true };  // 这回合没改文件

    return await writeChangeBackup(tid, rid, files, { root: settings.dir, trash: deps.trash });
  } catch (error) {
    // ⛔ 旁路能力：备份失败绝不能打断回合
    console.warn("[change-backup] 回合备份失败：", error);
    return { ok: false, error: "backup_failed" };
  }
}