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
  opts: { root?: string; checkpointId?: string; revision?: string } = {},
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
  return { ok: true, detailRef };
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

    return await writeChangeBackup(tid, rid, files, { root: settings.dir });
  } catch (error) {
    // ⛔ 旁路能力：备份失败绝不能打断回合
    console.warn("[change-backup] 回合备份失败：", error);
    return { ok: false, error: "backup_failed" };
  }
}