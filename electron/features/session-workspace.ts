/**
 * session-workspace（10-29 用户令）
 *
 * 每个会话在**项目地址下**有一个专属工作区目录：
 *   <project>/.codex-harness/sessions/<threadId>/
 *
 * ── 为什么是「旁挂目录」而不是把引擎 cwd 换过去 ──────────────────────────────
 * 用户原话：「在项目地址下为新建会话创建独立的工作区」。第一版想法是把 cwd 直接指向
 * 会话目录，四个依赖面会同时断（实测确认，别重犯）：
 *   ① 模型所有相对路径失效 —— `npm run build` / `src/...` 都在项目根，会话目录里没有
 *      package.json ⇒ 编程任务全废；
 *   ② 侧栏「项目」视图**按会话 cwd 聚合**（04-project-groups-cwd-names）⇒ N 个会话
 *      炸成 N 个项目；
 *   ③ 项目级技能落点是 `<cwd>/.codex/skills`（skill-pool.syncSkillPool）⇒ 每个会话
 *      一份投影，改了不同步；
 *   ④ 项目记忆 fabric 按 workspace 寻址（memory-fabric.fabricRoot）⇒ 共享的项目记忆
 *      碎成 N 份，反而更容易「记不住」。
 * 唯一不会断的是 AGENTS.md（引擎从 cwd **向上遍历**拼接，见 AGENTS.md:389）。
 * ⇒ 结论：cwd 保持项目根，工作区作为**本会话专属的产物/临时落点**旁挂在项目内。
 *
 * ── 记忆隔离的边界（⛔ 别把工作区目录当 workspace 传给记忆）──────────────────
 * 工作区目录**不参与记忆寻址**。项目记忆仍按「项目根」寻址（跨会话共享是设计意图），
 * 会话私有用 fabric 的 private 层（按 threadId 物理寻址）。
 * ⛔ 一旦有人把 `.../sessions/<id>` 当 workspace 传给 memory，project 层就会碎成
 *    每会话一份 —— 与「共享项目经验」的设计相反。守卫【sw】钉这条。
 *
 * ── 状态机 ──────────────────────────────────────────────────────────────
 *   （无）──ensure──▶ active ──archive──▶ archived ──delete──▶ （记录移除 + 目录删除）
 *                        ▲                    │
 *                        └─────unarchive──────┘
 *   · active   ：正常会话，目录可用
 *   · archived ：目录**保留**（归档不是删除，取消归档要能接着用）
 *   · 删除     ：目录连同记录一起清掉；清理失败时记录降级为 orphan，交给下次 GC
 *   · 孤儿     ：目录存在但无记录，或记录存在但目录不在 ⇒ `gc()` 收口
 *
 * ── 边界（每一条都有对应处理，不靠"应该不会发生"）──────────────────────────
 *   · threadId 空 / 含路径分隔符 / 是 `..` ⇒ 拒绝（拼路径前消毒）
 *   · projectRoot 不存在 / 不是目录 / 空 ⇒ 不建（宁可不建，也不能建到错的盘符下）
 *   · projectRoot 是 scratch（无项目模式） ⇒ 不建（那类会话有自己的临时目录）
 *   · 同一 threadId 重复 ensure ⇒ 幂等，只刷 lastSeenAt
 *   · 会话换了项目地址 ⇒ 旧记录不动（工作区跟着**创建时**的项目走，不跨项目迁移）
 *   · 删除时路径必须落在 `<project>/.codex-harness/sessions/` 内 ⇒ 安全闸（同 boss-home 口径）
 */
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

/** 会话工作区相对项目根的位置。⛔ 与记忆目录同级（`.codex-harness/memory`），别混进去。 */
const SESSIONS_SUB = path.join(".codex-harness", "sessions");

/** 记录文件：放 userData（不放项目里 —— 换仓克隆时不该带过来）。 */
function registryFile(userData: string): string {
  return path.join(userData, "session-workspaces.json");
}

export type SessionWorkspaceState = "active" | "archived" | "orphan";

export interface SessionWorkspaceRecord {
  threadId: string;
  /** 创建时的项目根（⛔ 不是会话 cwd，也不是工作区目录本身） */
  projectRoot: string;
  /** 工作区绝对路径 */
  dir: string;
  state: SessionWorkspaceState;
  createdAt: string;
  /** 每次 ensure / 归档 / 取消归档刷新，GC 用它判"多久没动过" */
  lastSeenAt: string;
  /** 清理失败的原因（state=orphan 时才有） */
  note?: string;
}

interface Registry {
  version: 1;
  records: Record<string, SessionWorkspaceRecord>;
}

const EMPTY: Registry = { version: 1, records: {} };

/** threadId 消毒：只留常规 id 字符。⛔ 不做这步就会拼出 `../../` 之类的路径。 */
export function safeThreadId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!id || id.length > 128) return "";
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return "";
  if (id === "." || id === "..") return "";
  return id;
}

/** 项目根规整：去掉尾分隔符、必须是真实存在的目录。返回 "" 表示不可用（调用方就当没这功能）。 */
export function normalizeProjectRoot(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  /* 无项目模式的 scratch 目录（userData/scratch/chat-YYYYMMDD-xxx）不建工作区：
     那类会话的"项目"是自动创建的临时目录，再套一层 sessions/ 只会制造垃圾。 */
  if (/[\\/]scratch[\\/]chat-\d{8}-/.test(raw)) return "";
  const resolved = path.resolve(raw);
  try {
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) return "";
  } catch {
    return "";
  }
  return resolved;
}

/** 会话工作区路径。⛔ 唯一的拼法，别在别处再拼一次。 */
export function workspaceDirOf(projectRoot: string, threadId: string): string {
  return path.join(projectRoot, SESSIONS_SUB, threadId);
}

async function readRegistry(userData: string): Promise<Registry> {
  try {
    const raw = JSON.parse(await fs.readFile(registryFile(userData), "utf8"));
    if (!raw || typeof raw !== "object" || raw.version !== 1 || typeof raw.records !== "object") return { ...EMPTY, records: {} };
    return { version: 1, records: { ...raw.records } };
  } catch {
    /* 首次运行没有文件；损坏按空处理（代价只是丢记录，GC 会把无记录目录当孤儿收掉）。 */
    return { ...EMPTY, records: {} };
  }
}

async function writeRegistry(userData: string, registry: Registry): Promise<void> {
  await fs.mkdir(userData, { recursive: true });
  const file = registryFile(userData);
  const tmp = `${file}.tmp`;
  /* 原子替换：先写 tmp 再 rename —— 直接覆写在中途失败时会留下半截 JSON，
     下次读到就整份丢（GC 随后会把所有目录当孤儿删掉 = 用户文件丢失）。 */
  await fs.writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

export async function listSessionWorkspaces(userData: string): Promise<SessionWorkspaceRecord[]> {
  const registry = await readRegistry(userData);
  return Object.values(registry.records).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 建（或刷新）某会话的工作区。幂等。
 * ⛔ 目录建失败不影响会话本身 —— 调用方不该因为"没建出目录"就中止 thread/start。
 */
export async function ensureSessionWorkspace(
  userData: string,
  threadIdRaw: unknown,
  projectRootRaw: unknown,
): Promise<{ ok: boolean; dir?: string; reason?: string }> {
  const threadId = safeThreadId(threadIdRaw);
  if (!threadId) return { ok: false, reason: "threadId 非法" };
  const projectRoot = normalizeProjectRoot(projectRootRaw);
  if (!projectRoot) return { ok: false, reason: "项目地址不可用（不存在 / 是临时目录）" };
  /* ⛔ userData 之下的目录默认不建工作区：`scratch` 这类是应用内部临时目录，不是用户项目。
     例外只有 `boss-home` —— 指挥中枢的 cwd 就是它（中枢有自己的"项目地址"），
     不放行的话「中枢会话 + 它调用的专家会话」全都没有工作区（用户 10-29 追问确认要的）。 */
  const userDataRoot = path.resolve(userData);
  if (projectRoot === userDataRoot) {
    return { ok: false, reason: "应用内部目录不建会话工作区" };
  }
  if (projectRoot.startsWith(userDataRoot + path.sep)) {
    const top = path.relative(userDataRoot, projectRoot).split(path.sep)[0];
    if (top !== "boss-home") return { ok: false, reason: "应用内部目录不建会话工作区" };
  }

  const dir = workspaceDirOf(projectRoot, threadId);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: any) {
    return { ok: false, reason: String(error?.message ?? error).slice(0, 160) };
  }

  const registry = await readRegistry(userData);
  const now = new Date().toISOString();
  const existing = registry.records[threadId];
  registry.records[threadId] = {
    threadId,
    projectRoot,
    dir,
    /* 已有记录被重新 ensure（比如取消归档后再进来）⇒ 回到 active；
       已经是 archived 且这次只是刷新，保持 archived 由 setState 负责，这里只处理"新建"。 */
    state: existing ? (existing.state === "orphan" ? "active" : existing.state) : "active",
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
  };
  await writeRegistry(userData, registry);
  return { ok: true, dir };
}

/** 改状态：active ↔ archived。删除不走这里（见 removeSessionWorkspace）。 */
export async function setSessionWorkspaceState(
  userData: string,
  threadIdRaw: unknown,
  state: "active" | "archived",
): Promise<{ ok: boolean; record?: SessionWorkspaceRecord; reason?: string }> {
  const threadId = safeThreadId(threadIdRaw);
  if (!threadId) return { ok: false, reason: "threadId 非法" };
  const registry = await readRegistry(userData);
  const record = registry.records[threadId];
  /* ⛔ 没有记录时**不新建**：归档一个从没建过工作区的老会话，不该凭空造目录。
     返回 ok=false 让调用方知道"这条本来就没有工作区"。 */
  if (!record) return { ok: false, reason: "该会话没有工作区记录" };
  record.state = state;
  record.lastSeenAt = new Date().toISOString();
  delete record.note;
  await writeRegistry(userData, registry);
  return { ok: true, record };
}

/**
 * 删除某会话的工作区（目录 + 记录）。会话被永久删除时调用。
 * ⛔ 安全闸：只许删**本函数算出来的** `<projectRoot>/.codex-harness/sessions/<threadId>`，
 *    且必须在 sessions 根之下 —— 渲染层传什么都不可能让它删到别处（同 boss-home 口径）。
 */
export async function removeSessionWorkspace(
  userData: string,
  threadIdRaw: unknown,
): Promise<{ ok: boolean; removed: boolean; reason?: string; projectRoot?: string }> {
  const threadId = safeThreadId(threadIdRaw);
  if (!threadId) return { ok: false, removed: false, reason: "threadId 非法" };

  const registry = await readRegistry(userData);
  const record = registry.records[threadId];
  if (!record) return { ok: true, removed: false };

  const sessionsRoot = path.join(record.projectRoot, SESSIONS_SUB);
  const expected = path.resolve(workspaceDirOf(record.projectRoot, threadId));
  const resolved = path.resolve(record.dir || expected);
  if (resolved !== expected || !resolved.startsWith(path.resolve(sessionsRoot) + path.sep)) {
    return { ok: false, removed: false, reason: "拒绝清理该路径（不在会话工作区目录内）" };
  }

  try {
    /* force:true 让"目录本来就不在"也算成功（记录一定要移除，否则永远挂着一条孤儿记录）；
       但**目录存在却删不掉**（文件被占用）必须让记录降级为 orphan，交给下次 GC 重试。 */
    await fs.rm(resolved, { recursive: true, force: true });
  } catch (error: any) {
    record.state = "orphan";
    record.note = String(error?.message ?? error).slice(0, 160);
    record.lastSeenAt = new Date().toISOString();
    await writeRegistry(userData, registry);
    return { ok: false, removed: false, reason: record.note };
  }

  delete registry.records[threadId];
  await writeRegistry(userData, registry);
  /* 把 projectRoot 一并交回：调用方还要用它清**该会话的私有记忆目录**
     （fabric 的 private__<threadId>/）—— 那里是会话级记忆，删除后永不复活。
     ⛔ 不在这函数里清记忆：记忆归 memory-fabric 管，跨域直接写它的目录 = 两个 owner。 */
  return { ok: true, removed: true, projectRoot: record.projectRoot };
}

/**
 * 收口孤儿。两种：
 *   ① 记录在、目录不在 ⇒ 移除记录（会话可能是被外部删掉的，记录留着只会永远报错）；
 *   ② 目录在、记录不在 ⇒ 这是「删除后残留的孤立工作区」的主通道，**超过 maxAgeMs 才删**
 *      （刚建出来的目录可能还没来得及登记，立刻删会误伤正在创建的会话）。
 * 返回清理统计，供日志与界面提示。
 */
export async function gcSessionWorkspaces(
  userData: string,
  options?: { maxAgeMs?: number; dryRun?: boolean },
): Promise<{ recordsRemoved: number; dirsRemoved: number; scanned: number }> {
  const maxAge = options?.maxAgeMs ?? 30 * 24 * 3600_000;
  const dryRun = options?.dryRun === true;
  const registry = await readRegistry(userData);
  const now = Date.now();
  let recordsRemoved = 0;
  let dirsRemoved = 0;
  let scanned = 0;

  /* ⛔ root 必须在**删记录之前**收集：第一轮会把"记录在、目录不在"的条目删掉，
     如果那时才去读 records 拿项目根，那些项目就再也扫不到 ⇒ 它们的孤立目录永远收不掉。 */
  const roots = new Set(
    Object.values(registry.records)
      .map((record) => record.projectRoot)
      .filter(Boolean),
  );

  for (const [threadId, record] of Object.entries(registry.records)) {
    scanned += 1;
    let dirExists = false;
    try {
      dirExists = existsSync(record.dir) && statSync(record.dir).isDirectory();
    } catch {
      dirExists = false;
    }
    if (dirExists) continue;
    /* ① 记录在、目录不在 */
    if (!dryRun) delete registry.records[threadId];
    recordsRemoved += 1;
  }

  /* ② 目录在、记录不在：逐个项目根扫 sessions/。
     ⛔ 只扫我们登记过的项目根 —— 全盘扫描是灾难。 */
  for (const root of roots) {
    const sessionsRoot = path.join(root, SESSIONS_SUB);
    let names: string[] = [];
    try {
      names = await fs.readdir(sessionsRoot);
    } catch {
      continue;
    }
    for (const name of names) {
      const threadId = safeThreadId(name);
      if (!threadId || registry.records[threadId]) continue;
      const full = path.join(sessionsRoot, name);
      let age = 0;
      try {
        age = now - statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (age < maxAge) continue;
      if (!dryRun) await fs.rm(full, { recursive: true, force: true }).catch(() => undefined);
      dirsRemoved += 1;
    }
  }

  if (!dryRun && (recordsRemoved || dirsRemoved)) await writeRegistry(userData, registry);
  return { recordsRemoved, dirsRemoved, scanned };
}
