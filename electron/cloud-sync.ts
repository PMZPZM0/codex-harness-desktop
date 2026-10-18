/**
 * 云端会话同步（P0：会话上传）
 *
 * 职责：扫描本机 CODEX_HOME 下 sessions/<年>/<月>/<日>/rollout-*.jsonl ⇒ **按行增量**上传到账号服务
 *      （`POST /sync/push`），并把"每条会话已推到第几行"记在 <userData>/sync/state.json。
 * ⛔ 本注释里**不许出现星号加斜杠的连续组合**（会提前终止块注释 —— 首版就栽在这）。
 *
 * ⛔ 为什么按行：rollout 是 append-only 事件流（每行带 ordinal）—— 只推新增的行，
 *    重传幂等、断点续传天然成立，且两台机器各自追加也不会冲突。
 *
 * ⛔ 单一职责：本模块**只做扫描/打包/上传/记游标**；触发时机（启动、定时、手动）由壳决定。
 * ⛔ 不做的事（P1+）：不下载、不合并、不做项目/记忆/技能的同步；不含任何凭据读取。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { canonicalStamp } from "./thread-backup";

export type SyncDeps = {
  /** 引擎数据根（sessions 在这里）。 */
  codexHome: string;
  /** 本地同步状态文件（游标）。 */
  stateFile: string;
  /** 账号服务地址（不含尾斜杠）。 */
  accountsBase: string;
  /** 设备令牌（空 = 未配对，直接跳过）。 */
  deviceToken: () => string;
  /** 机器标识（写进索引，便于"哪台机器传的"）。 */
  machineId: () => string;
};

export type SyncResult = {
  ok: boolean;
  reason?: string;
  pushedSessions?: number;
  pushedLines?: number;
  usedBytes?: number;
  limitBytes?: number;
  quotaExceeded?: boolean;
  scanned?: number;
  error?: string;
};

type State = { sessions: Record<string, { path: string; pushedLines: number; sizeBytes: number; title: string; project: string }> };

/** 单次同步最多处理的会话数（避免首跑把上千会话一次性推上去）。 */
const MAX_SESSIONS_PER_RUN = 40;
/** 单次上传的字节预算（服务端单请求 32MB 上限；客户端留足余量 ⇒ 超预算的拆到下一轮）。
 *  ⛔ 超长会话按**行**切片：装得下多少行就传多少行，游标同步前进 —— 增量设计天然支持。 */
const PUSH_BYTE_BUDGET = 4 * 1024 * 1024;

function readState(file: string): State {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as State;
    if (raw && typeof raw === "object" && raw.sessions && typeof raw.sessions === "object") return raw;
  } catch { /* 首次运行 */ }
  return { sessions: {} };
}
function writeState(file: string, state: State): void {
  try { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, JSON.stringify(state)); } catch { /* 忽略 */ }
}

/** 递归找 rollout 文件（按目录名 年/月/日 排序，新的在前）。 */
function listRollouts(root: string, limit: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || out.length >= limit * 4) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = join(dir, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (name.startsWith("rollout-") && name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(root, 0);
  return out.sort().reverse().slice(0, limit);
}

/** 从 rollout 头部提取标题与项目（best-effort：首条用户消息 / cwd 目录名）。 */
function deriveMeta(lines: string[]): { title: string; project: string; sessionId: string } {
  let title = "";
  let project = "";
  let sessionId = "";
  for (const line of lines.slice(0, 40)) {
    try {
      const row = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
      const payload = row.payload || {};
      if (!sessionId && typeof payload.session_id === "string") sessionId = payload.session_id;
      if (!project && typeof payload.cwd === "string" && payload.cwd) project = basename(payload.cwd);
      if (!title && row.type === "user_message") {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (text.trim()) title = text.trim().replace(/\s+/g, " ").slice(0, 80);
      }
      if (title && project && sessionId) break;
    } catch { /* 跳过坏行 */ }
  }
  return { title, project, sessionId };
}

/** 跑一次同步：扫描 → 只推新增行 → 回写游标。失败如实返回，不抛。 */
export async function runCloudSyncOnce(deps: SyncDeps): Promise<SyncResult> {
  const token = deps.deviceToken();
  if (!token) return { ok: false, reason: "not-paired" };
  const root = join(deps.codexHome, "sessions");
  if (!existsSync(root)) return { ok: true, pushedSessions: 0, pushedLines: 0, scanned: 0 };

  const state = readState(deps.stateFile);
  let budgetUsed = 0;
  const files = listRollouts(root, MAX_SESSIONS_PER_RUN);
  const payload: { id: string; title: string; project: string; fromOrdinal: number; lines: string[]; }[] = [];
  const meta: { id: string; path: string; lines: number; sizeBytes: number; title: string; project: string }[] = [];

  for (const file of files) {
    let content = "";
    try { content = readFileSync(file, "utf8"); } catch { continue; }
    const all = content.split("\n").filter((l) => l.trim());
    if (all.length < 2) continue;                                  // 只有 session_meta 的空会话跳过
    const { title, project, sessionId } = deriveMeta(all);
    const id = sessionId || basename(file).replace(/^rollout-/, "").replace(/\.jsonl$/, "");
    const pushed = Number(state.sessions[id]?.pushedLines || 0);
    if (all.length <= pushed) continue;                            // 没有新行
    /* 按行切片：装进剩余预算的行才发（会话特别大时本轮只发一部分，游标随之前进） */
    const fresh: string[] = [];
    let bytes = 0;
    for (const line of all.slice(pushed)) {
      const n = Buffer.byteLength(line, "utf8") + 1;
      if (bytes + n > PUSH_BYTE_BUDGET - budgetUsed) break;
      fresh.push(line); bytes += n;
    }
    if (!fresh.length) { budgetUsed = PUSH_BYTE_BUDGET; continue; }
    budgetUsed += bytes;
    payload.push({ id, title: title || id.slice(0, 8), project: project || "未命名项目", fromOrdinal: pushed, lines: fresh });
    meta.push({ id, path: relative(root, file), lines: pushed + fresh.length, sizeBytes: bytes, title: title || "", project: project || "" });
  }

  if (!payload.length) return { ok: true, pushedSessions: 0, pushedLines: 0, scanned: files.length };

  try {
    const res = await fetch(`${deps.accountsBase}/sync/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: payload }),
      signal: AbortSignal.timeout(30000),
    });
    /* ⛔ `message` 是服务端给的**人话**（如"管理员已关闭云端会话同步"），`error` 是技术码
       （如 `session-sync-disabled`）。原来只取 `error` ⇒ 界面会显示一串英文码，
       用户根本不知道发生了什么（10-18 管理员总闸上线后必然踩到）⇒ 优先取 message。 */
    const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; results?: { id: string; ok: boolean; error?: string }[]; usedBytes?: number; limitBytes?: number; error?: string } | null;
    if (!res.ok || !body?.ok) {
      const human = body?.message || body?.error || `http-${res.status}`;
      return { ok: false, reason: human, error: human };
    }
    let quotaExceeded = false;
    for (const row of body.results || []) {
      const m = meta.find((x) => x.id === row.id);
      if (!m) continue;
      if (!row.ok) { if (row.error === "quota-exceeded") quotaExceeded = true; continue; }
      state.sessions[row.id] = { path: m.path, pushedLines: m.lines, sizeBytes: (state.sessions[row.id]?.sizeBytes || 0) + m.sizeBytes, title: m.title, project: m.project };
    }
    /* 本次实际推送的行数（服务端回执只保证写入成功，行数按 payload 长度累计） */
    const pushedLines = (body.results || []).reduce((n, row) => {
      if (!row.ok) return n;
      const p = payload.find((x) => x.id === row.id);
      return n + (p ? p.lines.length : 0);
    }, 0);
    writeState(deps.stateFile, state);
    return { ok: true, pushedSessions: (body.results || []).filter((r) => r.ok).length, pushedLines, scanned: files.length, usedBytes: body.usedBytes, limitBytes: body.limitBytes, quotaExceeded };
  } catch (error) {
    return { ok: false, reason: "unreachable", error: (error as Error).message };
  }
}

/** 状态摘要（界面展示用）：上次推送的会话数 / 游标条数。 */
export function readSyncSummary(stateFile: string): { sessions: number; lines: number } {
  const state = readState(stateFile);
  const rows = Object.values(state.sessions);
  return { sessions: rows.length, lines: rows.reduce((n, r) => n + Number(r.pushedLines || 0), 0) };
}

/** ── P1：云端 → 本机（下载/恢复） ─────────────────────────────────────────
 *  把云端会话拉回本地 sessions 目录（与本地同构：<年>/<月>/<日>/rollout-<时间>-<id>.jsonl）。
 *  ⛔ 拉回来后**把该会话标记为已推到总行数** —— 否则下一轮上传会把它当新内容重复推上去。
 *  ⛔ 幂等：本地已存在同名会话就跳过（不覆盖本地更新的那份）。 */
export type PullResult = { ok: boolean; reason?: string; pulled: number; skipped: number; failed: number; ids?: string[] };

export async function pullCloudSessions(deps: SyncDeps, ids: string[] = []): Promise<PullResult> {
  const token = deps.deviceToken();
  if (!token) return { ok: false, reason: "not-paired", pulled: 0, skipped: 0, failed: 0 };
  try {
    const idxRes = await fetch(`${deps.accountsBase}/sync/index`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const idx = (await idxRes.json().catch(() => null)) as { ok?: boolean; sessions?: { id: string }[] } | null;
    if (!idxRes.ok || !idx?.ok) return { ok: false, reason: `index-http-${idxRes.status}`, pulled: 0, skipped: 0, failed: 0 };
    const wanted = (idx.sessions || []).filter((r) => !ids.length || ids.includes(r.id));
    const local = new Set(listRollouts(join(deps.codexHome, "sessions"), 400).map((f) => (/([0-9a-f-]{36})\.jsonl$/.exec(f) || [])[1] || ""));
    const state = readState(deps.stateFile);
    let pulled = 0, skipped = 0, failed = 0;
    const doneIds: string[] = [];
    for (const row of wanted) {
      if (local.has(row.id)) { skipped += 1; continue; }
      try {
        const res = await fetch(`${deps.accountsBase}/sync/session?id=${encodeURIComponent(row.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; content?: string } | null;
        if (!res.ok || !body?.ok || typeof body.content !== "string") { failed += 1; continue; }
        const lines = body.content.split("\n").filter((l) => l.trim());
        /* 目标日期目录：按首行时间戳（与引擎约定一致）；取不到就用今天 */
        let stamp = new Date();
        try { const first = JSON.parse(lines[0]) as { timestamp?: string }; if (first.timestamp) stamp = new Date(first.timestamp); } catch { /* 用今天 */ }
        const y = String(stamp.getFullYear());
        const m = String(stamp.getMonth() + 1).padStart(2, "0");
        const d = String(stamp.getDate()).padStart(2, "0");
        const dir = join(deps.codexHome, "sessions", y, m, d);
        mkdirSync(dir, { recursive: true });
        /* ⛔⛔ 文件名必须 canonical（`rollout-<YYYY-MM-DDTHH-MM-SS>-<uuid>.jsonl`，**含 `T`**）：
           引擎 thread-store 直接拒读非 canonical 名（`does not have a canonical rollout filename`），
           而本机兜底扫描**照样**会把它列进侧栏 ⇒ 用户看到会话在、点开就报错（10-14 用户实测）。
           旧实现用 `toISOString().slice(0,19).replace(/[:T]/g, "-")` —— **连 `T` 一起换成了 `-`**，
           于是从云端拉回来的每条会话都是坏名。这里复用 thread-backup 的单一真相源
           （它用**本地时间**，与上面按本地时间算的日期目录同口径）。 */
        const file = join(dir, `rollout-${canonicalStamp(stamp.getTime())}-${row.id}.jsonl`);
        writeFileSync(file, lines.join("\n") + "\n");
        state.sessions[row.id] = { path: relative(join(deps.codexHome, "sessions"), file), pushedLines: lines.length, sizeBytes: Buffer.byteLength(body.content, "utf8"), title: state.sessions[row.id]?.title || "", project: state.sessions[row.id]?.project || "" };
        pulled += 1; doneIds.push(row.id);
      } catch { failed += 1; }
    }
    if (pulled) writeState(deps.stateFile, state);
    return { ok: true, pulled, skipped, failed, ids: doneIds };
  } catch (error) {
    return { ok: false, reason: (error as Error).message, pulled: 0, skipped: 0, failed: 0 };
  }
}
