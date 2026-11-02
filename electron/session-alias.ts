/**
 * 会话笔名的**主进程侧**（10-31 用户令）：分配、落盘、改名的唯一真相源。
 *
 * 渲染层通过 `session-alias:*` 通道读写；主进程内部（delegation / teams / runner）直接调函数。
 *
 * 口径（⛔ 与 src/lib/session-names.mjs 同源，改规则去那边改，这里只做落盘与联动）：
 *   · **名字即会话名**（11-01 用户令：取消「主管」后缀、取消"笔名/会话名"两个概念）；
 *   · 自动分配从池子里取两字（11-03 起为手挑选的写意雅号，如「听雨 / 观澜 / 栖云」），用户改名可写 1~24 字符，仍不重名；
 *   · 被调度的子会话记着上级 id（气泡与指令里的「上级：X」由此而来），用户改过的一律以用户为准。
 *
 * ⛔ 为什么落盘在主进程而不是 localStorage：被调度会话的**上级名字**要在主进程拼进它的
 *   持久指令与首条任务里（渲染层那时还没参与）；只存渲染层的话，主进程这边永远是空。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { ALIAS_POOL, pickSessionAlias, supervisorIdOf, validateAlias, aliasMeaningOf } from "../src/lib/session-names.mjs";
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
  if (cache && migrateLegacyAliases(cache)) void flushSessionAliases();
  return cache ?? {};
}

/**
 * 落盘。⛔ 10-31 审查后改成「改完立刻写」，去掉了 150ms debounce：
 *   debounce 需要一个 timer + 一个退出钩子才能保证不丢，而改名/新建都是低频操作
 *   （改名是人手点的，新建会话一天几十次），一次全量 JSON 写盘（几百字节~几 KB）不值得为它多两个机制。
 *   写失败不影响内存态（下一次写会带上全部记录）。
 */
/**
 * 一次性迁移（11-01 用户：「笔名最后不要用人名啊，这样会被投诉的」；11-03 用户：「你取的笔名都很难听」）。
 * 旧池依次是「山水/姓名感」两字（林钟 / 青崖…）与「器物词」（快刀 / 明镜 / 稳舟…）。
 * 11-03 换成手挑选的写意雅号（听雨 / 观澜 / 栖云…）。
 * ⇒ 记录里的名字**不在当前池**且**不是用户自改的**，重新分配一个；userEdited 的一律保留
 *   （那是用户自己起的，不能悄悄改）。
 * ⛔ 只改记录、不在这里发 thread/name/set：会话名的落地在主进程建会话 / 打开会话那侧，
 *    本模块不依赖引擎连接（导入 server 会绕出循环）。
 */
function migrateLegacyAliases(map: Record<string, SessionAliasRecord>): boolean {
  const pool = new Set(ALIAS_POOL);
  const used = new Set(Object.values(map).map((record) => record?.alias).filter(Boolean));
  let changed = false;
  for (const [id, record] of Object.entries(map)) {
    if (!record?.alias || record.userEdited) continue;
    if (pool.has(record.alias)) continue;
    used.delete(record.alias);
    const next = pickSessionAlias(id, used);
    if (!next) continue;
    used.add(next);
    map[id] = { ...record, alias: next, updatedAt: Date.now() };
    changed = true;
  }
  return changed;
}

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

/** 用户改名（= 改笔名，同一个操作）：校验 → 落盘 → 广播，返回最新记录。 */
export function setSessionAlias(
  threadId: string,
  alias: string,
  /** `allowDuplicate`：显式改名（含团队/专家的自动命名）允许重名。
      自动分配永远走池子（不重名）；这里放行是因为"用户/system 明确要把这个会话叫这个名字"
      比"名字唯一"优先 —— 否则团队里两个同名职能就没法命名了。 */
  opts: { allowDuplicate?: boolean } = {},
): Promise<{ ok: boolean; error?: string; record?: SessionAliasRecord }> {
  return serial(() => setSessionAliasLocked(threadId, alias, opts));
}

async function setSessionAliasLocked(
  threadId: string,
  alias: string,
  opts: { allowDuplicate?: boolean },
): Promise<{ ok: boolean; error?: string; record?: SessionAliasRecord }> {
  const id = String(threadId ?? "").trim();
  if (!id) return { ok: false, error: "缺少会话 id" };
  const map = await load();
  const taken = await usedAliases();
  const current = map[id]?.alias;
  if (current) taken.delete(current);          // 自己的旧名不算占用（允许同名回填/原样保存）
  const verdict = validateAlias(alias, opts.allowDuplicate ? [] : taken);
  if (!verdict.ok) return { ok: false, error: verdict.reason };
  const record: SessionAliasRecord = { ...(map[id] ?? { updatedAt: 0 }), alias: verdict.alias, userEdited: true, updatedAt: Date.now() };
  map[id] = record;
  await flushSessionAliases();
  scheduledEmit();
  try { aliasChangeHook?.(id); } catch { /* 刷新失败不影响改名 */ }
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

/**
 * 批量为**缺名字**的会话补分配（幂等）。
 *
 * ⛔⛔ 11-01 用户（截图：「名字没同步左侧栏这个会话选项呢，这里还是显示未命名任务」）：
 *   原先只有「新建会话」那一刻分配，于是
 *     ① 存量会话永远没有名字 ⇒ 侧栏只能显示"未命名任务"，而顶栏显示的是引擎名 ⇒ 两边不一致；
 *     ② 建会话发生在渲染层订阅**之前**时，那次广播丢了（`emitFn` 还没接上）⇒ 名字在磁盘上、
 *        界面永远看不到。
 *   ⇒ 列表出口统一补一次（`thread/list` 是侧栏数据的唯一来源），并把"广播丢了"这件事在
 *      接线时补发（见 `setSessionAliasEmitter`）。
 * @returns 是否有新增（有 ⇒ 调用方可以放心广播）
 */
export function ensureAliasesFor(threadIds: string[]): Promise<boolean> {
  return serial(async () => {
    const map = await load();
    const used = new Set(Object.values(map).map((entry) => entry?.alias).filter(Boolean));
    let changed = false;
    for (const raw of Array.isArray(threadIds) ? threadIds : []) {
      const id = String(raw ?? "").trim();
      if (!id || map[id]?.alias) continue;
      const alias = pickSessionAlias(id, used);
      if (!alias) continue;
      used.add(alias);
      map[id] = { alias, updatedAt: Date.now() };
      changed = true;
    }
    if (changed) {
      await flushSessionAliases();
      scheduledEmit();
    }
    return changed;
  });
}

/**
 * ⛔ 改名后通知所有窗口（渲染层据此立刻刷新侧栏/上级气泡，不用等轮询）。
 * 11-01 补：`emitFn` 还没接上时**记住有待广播**，接上那一刻补发一次 ——
 *   否则"启动早期分配的名字"会永久停在磁盘上、界面永远看不见（用户看到的"未命名任务"）。
 */
let emitFn: ((payload: unknown) => void) | null = null;
let emitTimer: NodeJS.Timeout | null = null;
let emitPending = false;
/** 11-03：用户改名后，群编排成员会话的权威身份块要跟着重写（上级笔名变了，模型不能还记旧名）。
 *  ⛔ 由 boss 域注册；本模块不 import 引擎/编排，避免成环。 */
let aliasChangeHook: ((threadId: string) => void) | null = null;
export function setSessionAliasChangeHook(fn: ((threadId: string) => void) | null) { aliasChangeHook = fn; }
export function setSessionAliasEmitter(fn: (payload: unknown) => void) {
  emitFn = fn;
  if (emitPending) { emitPending = false; scheduledEmit(); }
}
function scheduledEmit() {
  if (!emitFn) { emitPending = true; return; }
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(async () => {
    emitTimer = null;
    try { emitFn?.({ type: "aliases-changed", snapshot: await snapshotSessionAliases() }); } catch { /* 广播失败不影响改名 */ }
  }, 60);
}
