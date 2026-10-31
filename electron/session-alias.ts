/**
 * 会话笔名的**主进程侧**（10-31 用户令）：分配、落盘、改名的唯一真相源。
 *
 * 渲染层通过 `session-alias:*` 通道读写；主进程内部（delegation / teams / runner）直接调函数。
 *
 * 口径（⛔ 与 src/lib/session-names.mjs 同源，改规则去那边改，这里只做落盘与联动）：
 *   · 用户 = 总经理（不算会话）；
 *   · **主会话 = 主管**，ID = 笔名 + 「主管」（如「青崖主管」）；
 *   · 被调度的子会话挂在自己的上级主管下面，**不再带「主管」后缀**；
 *   · 笔名两字、全局不重名（用户自改的也算占用）；用户改过的一律以用户为准，不再自动分配。
 *
 * ⛔ 为什么落盘在主进程而不是 localStorage：被调度会话的**上级名字**要在主进程拼进它的
 *   持久指令与首条任务里（渲染层那时还没参与）；只存渲染层的话，主进程这边永远是空。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { pickSessionAlias, supervisorIdOf, validateAlias, aliasMeaningOf } from "../src/lib/session-names.mjs";
import { createSerialQueue } from "../src/lib/serial-queue.mjs";

export type SessionAliasRecord = {
  alias: string;
  /** 上级会话 id（空 = 它自己是主管；主会话都为空） */
  supervisorThreadId?: string;
  /** 用户亲手改过的（true ⇒ 不再自动改名，也不参与"自动分配"重排） */
  userEdited?: boolean;
  updatedAt: number;
};

let cache: Record<string, SessionAliasRecord> | null = null;
let loading: Promise<void> | null = null;

const fileOf = () => path.join(app.getPath("userData"), "session-aliases.json");

async function load(): Promise<Record<string, SessionAliasRecord>> {
  if (cache) return cache;
  if (loading) { await loading; return cache ?? {}; }
  loading = (async () => {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(fileOf(), "utf8"));
      cache = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, SessionAliasRecord>) : {};
    } catch {
      cache = {};
    }
  })();
  await loading;
  loading = null;
  return cache ?? {};
}

/**
 * 落盘。⛔ 10-31 审查后改成「改完立刻写」，去掉了 150ms debounce：
 *   debounce 需要一个 timer + 一个退出钩子才能保证不丢，而改名/新建都是低频操作
 *   （改名是人手点的，新建会话一天几十次），一次全量 JSON 写盘（几百字节~几 KB）不值得为它多两个机制。
 *   写失败不影响内存态（下一次写会带上全部记录）。
 */
export async function flushSessionAliases(): Promise<void> {
  if (!cache) return;
  try { await fs.writeFile(fileOf(), JSON.stringify(cache, null, 2), "utf8"); } catch { /* 写失败不影响内存态 */ }
}

/**
 * ⛔⛔ 分配与改名的**临界区串行闸**（10-31 审查实测撞名后加）。
 *
 * `ensure` / `set` 都是「读已用集合 → 挑名/校验 → 写入」，这个窗口里如果并发进来第二个请求，
 * 它看到的是**同一份**已用集合 ⇒ 两条会话挑到同一个笔名。
 * 实测：构造两个哈希同模（`hash % 2116` 相等）的 threadId 并发 `ensureSessionAlias`，
 * 两条都拿到「墨藤」。中枢开局 / 批量调度恰好就是并发建会话。
 *
 * 用户要求是「确保 200 个会话不能有重复名字」⇒ 撞名概率再低也不能留。
 */
const serial = createSerialQueue();

/** 已被占用的笔名（含用户自改的）。 */
async function usedAliases(): Promise<Set<string>> {
  const map = await load();
  return new Set(Object.values(map).map((entry) => entry.alias).filter(Boolean));
}

/** 只读取：该会话的笔名记录（没有就是 null）。 */
export async function aliasRecordOf(threadId: string): Promise<SessionAliasRecord | null> {
  const id = String(threadId ?? "").trim();
  if (!id) return null;
  const map = await load();
  return map[id] ?? null;
}

/**
 * 保证该会话有笔名（幂等）。新建会话时调一次即可。
 * @param supervisorThreadId 上级会话 id（被调度的会话传发起方；主会话不传）
 */
export function ensureSessionAlias(threadId: string, supervisorThreadId = ""): Promise<SessionAliasRecord | null> {
  return serial(() => ensureSessionAliasLocked(threadId, supervisorThreadId));
}

async function ensureSessionAliasLocked(threadId: string, supervisorThreadId: string): Promise<SessionAliasRecord | null> {
  const id = String(threadId ?? "").trim();
  if (!id) return null;
  const map = await load();
  const existing = map[id];
  const supervisor = String(supervisorThreadId ?? "").trim();
  if (existing?.alias) {
    /* ⛔ 已有笔名：只在"上级"这条关系缺失时补上（不覆盖用户改过的名字/关系） */
    if (!existing.supervisorThreadId && supervisor) {
      existing.supervisorThreadId = supervisor;
      existing.updatedAt = Date.now();
      await flushSessionAliases();
      scheduledEmit();
    }
    return existing;
  }
  const used = await usedAliases();
  const alias = pickSessionAlias(id, used);
  if (!alias) return null;
  const record: SessionAliasRecord = { alias, ...(supervisor ? { supervisorThreadId: supervisor } : {}), updatedAt: Date.now() };
  map[id] = record;
  await flushSessionAliases();     // 先落盘再广播：广播出去的名字必须已经能查得到
  scheduledEmit();                 // 新会话拿到笔名 ⇒ 立刻广播，侧栏不用等下一次列表刷新
  return record;
}

/** 用户改笔名：校验（两字中文 + 不与别人重名）→ 落盘 → 返回最新记录。 */
export function setSessionAlias(threadId: string, alias: string): Promise<{ ok: boolean; error?: string; record?: SessionAliasRecord }> {
  return serial(() => setSessionAliasLocked(threadId, alias));
}

async function setSessionAliasLocked(threadId: string, alias: string): Promise<{ ok: boolean; error?: string; record?: SessionAliasRecord }> {
  const id = String(threadId ?? "").trim();
  if (!id) return { ok: false, error: "缺少会话 id" };
  const map = await load();
  const taken = await usedAliases();
  const current = map[id]?.alias;
  if (current) taken.delete(current);          // 自己的旧名不算占用（允许同名回填/原样保存）
  const verdict = validateAlias(alias, taken);
  if (!verdict.ok) return { ok: false, error: verdict.reason };
  const record: SessionAliasRecord = { ...(map[id] ?? { updatedAt: 0 }), alias: verdict.alias, userEdited: true, updatedAt: Date.now() };
  map[id] = record;
  await flushSessionAliases();
  scheduledEmit();
  return { ok: true, record };
}

/** 上级主会话的**身份串**（拼进被调度会话的指令与首任务用）：`青崖主管（01a1…）`。 */
export async function supervisorLabelOf(threadId: string): Promise<string> {
  const id = String(threadId ?? "").trim();
  if (!id) return "";
  const record = await aliasRecordOf(id);
  const supervisor = record?.supervisorThreadId ? await aliasRecordOf(record.supervisorThreadId) : null;
  if (!supervisor?.alias) return "";
  return `${supervisorIdOf(supervisor.alias)}（${String(record?.supervisorThreadId ?? "").slice(0, 8)}）`;
}

/** 全量快照（渲染层据此显示笔名、算"哪些名字被占用"）。 */
export async function snapshotSessionAliases(): Promise<Record<string, SessionAliasRecord & { meaning: string }>> {
  const map = await load();
  const out: Record<string, SessionAliasRecord & { meaning: string }> = {};
  for (const [id, record] of Object.entries(map)) {
    out[id] = { ...record, meaning: aliasMeaningOf(record.alias) };
  }
  return out;
}

/** 改名后通知所有窗口（渲染层据此立刻刷新侧栏/上级气泡，不用等轮询）。 */
let emitFn: ((payload: unknown) => void) | null = null;
let emitTimer: NodeJS.Timeout | null = null;
export function setSessionAliasEmitter(fn: (payload: unknown) => void) {
  emitFn = fn;
}
function scheduledEmit() {
  if (!emitFn) return;
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(async () => {
    emitTimer = null;
    try { emitFn?.({ type: "aliases-changed", snapshot: await snapshotSessionAliases() }); } catch { /* 广播失败不影响改名 */ }
  }, 60);
}
