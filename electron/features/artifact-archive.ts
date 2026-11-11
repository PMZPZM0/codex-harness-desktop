/**
 * 产物归档（11-11 独立板块）—— 把「artifacts/YYYYMMDD-短名/」从提示词约定变成真会落盘的能力。
 *
 * 背景：逆向豆包工作伙伴时看到它的文件区是**全量台账**（upload / chats / tasks），
 * 目录按「日期-任务短名」、文件按「内容语义」、多版迭代用 `-r94 / -low / -final` 区分。
 * 我们原来只在 buildTalkInput 里写了一句约定，模型不照做就什么都没有。
 *
 * ⛔ 设计边界（别越线）：
 *   · 只**复制**、绝不移动或删除原文件 —— 归档不是清理，删掉用户文件不可逆；
 *   · 目标永远锁在 `<workspace>/.codex-harness/artifacts/` 内（防路径逃逸）；
 *   · 同名不覆盖，自动加 `-r2 / -r3` 迭代后缀（豆包那套语义）；
 *   · 每次归档写目录内 `_manifest.json` + 根 `index.jsonl` 总台账（谁、哪次任务、从哪来）。
 *   · 本模块只依赖 node 内置模块 ⇒ 守卫可以直接 require 编译产物**真跑**。
 */
import fs from "node:fs";
import path from "node:path";

/** 单文件上限：误把大视频/整库归档进来会拖垮 IPC 与界面。 */
export const ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
/** 单次归档文件数上限。 */
export const ARTIFACT_MAX_FILES = 30;

/* ⛔ 无语义文件名：a1.png / 未命名.png / 纯时间戳 / uuid / screenshot(1).png。
   豆包文件区能一眼看出是哪次任务，靠的就是「内容语义」，这类名字必须能识别出来。 */
const NOISE_NAME = /^(?:未命名|无标题|新建|新建文件|untitled|image|img|screenshot|screen[\s_-]*shot|截图|output|file|tmp|temp|download|document|paste|a\d+|[\d._\-()（）]+|[0-9a-f]{8,})$/i;

/** 归档根目录：与 memory / sessions 同级，互不覆盖。 */
export function artifactsRoot(workspace: string): string {
  return path.join(path.resolve(String(workspace ?? "")), ".codex-harness", "artifacts");
}

/** 任务短名：保留中文，去掉路径与危险字符，空格转连字符，最长 24 字。 */
export function normalizeTaskName(raw: string): string {
  const cleaned = String(raw ?? "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    /* ⛔ 连续点也要去掉：`../../escape` 去掉斜杠后会留下 `....escape`，
       虽然不构成路径穿越，但目录名里带 `..` 会让人误以为越界、也难看。 */
    .replace(/\.{2,}/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
  return (cleaned || "未命名任务").slice(0, 24);
}

/** 目录名 `YYYYMMDD-<任务短名>`；at 可传时间戳（守卫用固定值真跑）。 */
export function archiveDirName(at: number | Date, task: string): string {
  const d = at instanceof Date ? at : new Date(Number(at) || Date.now());
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${stamp}-${normalizeTaskName(task)}`;
}

/** 去掉扩展名后的主名是否「有内容语义」。 */
export function isSemanticName(name: string): boolean {
  const base = path.basename(String(name ?? "")).replace(/\.[^.]+$/, "").trim();
  if (!base) return false;
  /* 已经带迭代后缀的（daily-1107-r2）按主名判。 */
  const stem = base.replace(/-r\d+$/i, "").replace(/[\s_-]*(?:副本|copy|\(\d+\))$/i, "");
  return !NOISE_NAME.test(stem);
}

/** 目标文件名清洗：只留 basename，危险字符换连字符，保扩展名。 */
export function safeFileName(raw: string): string {
  const base = path.basename(String(raw ?? "")).replace(/[\\/:*?"<>|\r\n\t]/g, "-").trim();
  const ext = path.extname(base);
  const stem = (base.slice(0, base.length - ext.length) || "artifact").slice(0, 60);
  return `${stem}${ext}`.replace(/^\.+/, "") || "artifact";
}

/** 目录里已经有同名时递进 `-r2 / -r3 …`（⛔ 绝不覆盖已归档的那一版）。 */
export function nextAvailableName(dir: string, wanted: string): string {
  const ext = path.extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  let candidate = wanted;
  let round = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem}-r${round}${ext}`;
    round += 1;
  }
  return candidate;
}

export type ArchiveRow = {
  dir: string;
  task: string;
  at: number;
  source?: string;
  note?: string;
  files: Array<{ name: string; from: string; bytes: number }>;
};

/** 列出归档（目录按日期/时间倒序）；目录里没有 manifest 也照样列出（老数据不丢）。 */
export function listArchives(workspace: string, limit = 30): ArchiveRow[] {
  const root = artifactsRoot(workspace);
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{8}-/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse()
      .slice(0, Math.max(1, Math.min(200, limit)));
  } catch { return []; }
  const rows: ArchiveRow[] = [];
  for (const dir of dirs) {
    const full = path.join(root, dir);
    let manifest: Partial<ArchiveRow> = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(full, "_manifest.json"), "utf8")) as Partial<ArchiveRow>; } catch { /* 老目录没有台账 */ }
    let files: ArchiveRow["files"] = Array.isArray(manifest.files) ? manifest.files : [];
    if (!files.length) {
      try {
        files = fs.readdirSync(full, { withFileTypes: true })
          .filter((d) => d.isFile() && d.name !== "_manifest.json")
          .map((d) => ({ name: d.name, from: "", bytes: fs.statSync(path.join(full, d.name)).size }));
      } catch { files = []; }
    }
    rows.push({
      dir,
      task: String(manifest.task ?? dir.replace(/^\d{8}-/, "")),
      at: Number(manifest.at ?? 0),
      ...(manifest.source ? { source: manifest.source } : {}),
      ...(manifest.note ? { note: manifest.note } : {}),
      files,
    });
  }
  return rows;
}

export type ArchiveInput = {
  files: Array<{ path: string; name?: string }>;
  task: string;
  note?: string;
  source?: string;
  /** 便于守卫固定时间；生产不传 = Date.now()。 */
  at?: number;
};

/** 归档结果：返回真实落盘路径（模型下一句就能引用），以及被跳过的文件与原因。 */
export async function archiveFiles(workspace: string, input: ArchiveInput): Promise<{
  ok: boolean;
  dir?: string;
  saved?: Array<{ path: string; name: string; bytes: number }>;
  skipped?: Array<{ path: string; reason: string }>;
  error?: string;
}> {
  const ws = String(workspace ?? "").trim();
  if (!ws) return { ok: false, error: "没有工作区 —— 先打开一个项目再归档产物" };
  const files = Array.isArray(input?.files) ? input.files : [];
  if (!files.length) return { ok: false, error: "files 是空的 —— 没有要归档的文件" };
  if (files.length > ARTIFACT_MAX_FILES) return { ok: false, error: `一次最多归档 ${ARTIFACT_MAX_FILES} 个文件（收到 ${files.length} 个）` };

  const root = artifactsRoot(ws);
  const dirName = archiveDirName(input.at ?? Date.now(), input.task);
  const dir = path.join(root, dirName);
  /* ⛔ 双保险：normalizeTaskName 已经去掉分隔符，这里再验一次落点没跑出 artifacts 根。 */
  const rel = path.relative(root, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, error: "归档目录越界（已被拒绝）" };
  fs.mkdirSync(dir, { recursive: true });

  const saved: Array<{ path: string; name: string; bytes: number }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const item of files) {
    const src = String(item?.path ?? "").trim();
    if (!src) { skipped.push({ path: "", reason: "空路径" }); continue; }
    const full = path.isAbsolute(src) ? path.resolve(src) : path.resolve(ws, src);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { skipped.push({ path: src, reason: "文件不存在" }); continue; }
    if (!stat.isFile()) { skipped.push({ path: src, reason: "不是文件（目录不能归档）" }); continue; }
    if (stat.size > ARTIFACT_MAX_BYTES) { skipped.push({ path: src, reason: `超过 ${Math.round(ARTIFACT_MAX_BYTES / 1024 / 1024)}MB 上限` }); continue; }
    /* 名字：显式给的 name 优先；否则原名有语义就用原名，无语义就补任务短名。 */
    const original = path.basename(full);
    const wanted = safeFileName(
      String(item?.name ?? "").trim()
      || (isSemanticName(original) ? original : `${normalizeTaskName(input.task)}${path.extname(original)}`),
    );
    const dest = nextAvailableName(dir, wanted);
    fs.copyFileSync(full, path.join(dir, dest));   // ⛔ 只复制，不删原文件
    saved.push({ path: path.join(dir, dest), name: dest, bytes: stat.size });
  }
  if (!saved.length) {
    try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch { /* 非空 / 并发写入就留着 */ }
    return { ok: false, error: "没有任何文件归档成功", skipped };
  }

  const at = Number(input.at ?? Date.now());
  const existing: ArchiveRow = { dir: dirName, task: normalizeTaskName(input.task), at, files: [] };
  try { Object.assign(existing, JSON.parse(fs.readFileSync(path.join(dir, "_manifest.json"), "utf8")) as Partial<ArchiveRow>); } catch { /* 首次 */ }
  const manifest: ArchiveRow = {
    dir: dirName,
    task: existing.task || normalizeTaskName(input.task),
    at: Number(existing.at ?? at),
    ...(existing.source ?? input.source ? { source: String(existing.source ?? input.source ?? "") } : {}),
    ...(existing.note ?? input.note ? { note: String(existing.note ?? input.note ?? "") } : {}),
    files: [
      ...(Array.isArray(existing.files) ? existing.files : []),
      ...saved.map((s) => ({ name: s.name, from: "", bytes: s.bytes })),
    ],
  };
  fs.writeFileSync(path.join(dir, "_manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  /* 总台账：一行一次归档，按时间追加 —— 「文件里能看的东西最全」靠它兜底。 */
  try {
    fs.appendFileSync(
      path.join(root, "index.jsonl"),
      `${JSON.stringify({ at, dir: dirName, task: manifest.task, source: input.source ?? "", count: saved.length, names: saved.map((s) => s.name) })}\n`,
      "utf8",
    );
  } catch { /* 台账写失败不该让已落盘的文件算失败 */ }
  return { ok: true, dir: dirName, saved, skipped };
}

/** 网关执行端：与 dispatch-rpc 的 memory_* 分支同构（cwd 由宿主注入，⛔ 不信任模型自报）。 */
export async function runArtifactTool(input: {
  name: string;
  args: Record<string, unknown>;
  workspace: string;
}): Promise<{ ok: boolean; output?: string; error?: string }> {
  const args = input.args ?? {};
  if (input.name === "artifact_list") {
    const rows = listArchives(input.workspace, Number(args.limit) || 20);
    if (!rows.length) return { ok: true, output: "这个工作区还没有归档产物。做完东西用 artifact_archive 归档，按「日期-任务短名」存。" };
    const lines = rows.map((r) => `【${r.dir}】${r.task} · ${r.files.length} 个文件${r.note ? ` · ${r.note}` : ""}\n  ${r.files.slice(0, 8).map((f) => f.name).join("、")}`);
    return { ok: true, output: lines.join("\n") };
  }
  if (input.name === "artifact_archive") {
    const raw = Array.isArray(args.files) ? args.files : [];
    const files = raw.map((f) => (typeof f === "string" ? { path: f } : {
      path: String((f as Record<string, unknown>)?.path ?? ""),
      ...(String((f as Record<string, unknown>)?.name ?? "").trim() ? { name: String((f as Record<string, unknown>)?.name ?? "") } : {}),
    }));
    const result = await archiveFiles(input.workspace, {
      files,
      task: String(args.task ?? ""),
      ...(args.note ? { note: String(args.note) } : {}),
      ...(args.source ? { source: String(args.source) } : {}),
    });
    if (!result.ok) return { ok: false, error: result.error };
    const skipped = result.skipped?.length ? `\n跳过 ${result.skipped.length} 个：${result.skipped.map((s) => `${s.path}（${s.reason}）`).join("、")}` : "";
    return {
      ok: true,
      output: `已归档到 .codex-harness/artifacts/${result.dir}/：\n${result.saved?.map((s) => `  ${s.path}`).join("\n")}${skipped}\n⛔ 原文件保留未动；同一任务再次归档会自动加 -r2 迭代后缀，不会覆盖旧版。`,
    };
  }
  return { ok: false, error: `未知的产物工具：${input.name}` };
}
