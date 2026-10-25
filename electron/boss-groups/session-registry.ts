/**
 * BOSS 会话身份登记表（**唯一真相源**，落盘 `<userData>/boss-sessions.json`）
 *
 * ⛔⛔ 为什么必须放在主进程（而不是渲染层 localStorage）：
 *   记忆层的读写**全部以 workspace 为键**（`<workspace>/.codex-harness/memory/…`），
 *   而「这个 thread 是不是 BOSS 会话」必须在**主进程**知道 —— 因为自动捕获
 *   （boot.ts 的 `memoryStore.captureTurn`）在主进程跑，它得知道该往哪个目录写。
 *   渲染层 localStorage 主进程读不到 ⇒ 记忆会被写进普通项目目录 ⇒ 与普通会话混在一起。
 *   ⇒ 名单落主进程，渲染层通过 `boss-groups:session` 通道读/写，两边同一份。
 *
 * ⛔ 每个 BOSS 会话一个**专属记忆目录**（`<userData>/boss-home/memories/<threadId>`）：
 *   记忆层核心（memory-layers.ts / memory-fabric.ts）不用改一个字 —— 它们只认 workspace，
 *   换 workspace 就换目录 ⇒ 与任何项目、任何普通会话完全拆开。
 *
 * ⛔ 惰性求值（记忆里的 91 号坑）：`app.getPath("userData")` **不能**在模块顶层取 ——
 *   `app.setPath("userData", …)` 在 main.ts 模块体，被 import 的模块体先于它运行 ⇒ 顶层取会拿到默认目录。
 *   所有路径都在**函数调用时**现算。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

export type BossSessionRecord = {
  /** 引擎会话 id（唯一键）。 */
  id: string;
  createdAt: number;
};

type RegistryFile = { version: 1; sessions: BossSessionRecord[] };

const FILE_NAME = "boss-sessions.json";

/** 线程 id 只允许安全字符（防目录穿越 / 非法文件名）。 */
function safeId(id: string): string {
  return String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

function registryFile(): string {
  // ⛔ 惰性：每次现算（app.setPath 可能在 import 之后才生效）。
  return path.join(app.getPath("userData"), FILE_NAME);
}

/** BOSS 会话的专属记忆目录（= 该会话记忆层的 workspace 键）。 */
export function bossMemoryWorkspace(threadId: string): string {
  const id = safeId(threadId);
  if (!id) return "";
  return path.join(app.getPath("userData"), "boss-home", "memories", id);
}

let cache: RegistryFile | null = null;

async function readRegistry(): Promise<RegistryFile> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(registryFile(), "utf8");
    const parsed = JSON.parse(raw);
    /* ⛔⛔ 读时**按 id 去重**（10-25 实测：用户的 boss-sessions.json 里同一个 id 存了两条
       ⇒ 面板列出两个同名条目、删一个另一个还在）。
       根因在 backfillFromGroups（同一个 bossThreadId 出现在两个群里时会被加两次）
       ⇒ 这里读时兜底去重（保留最早那条），并在写盘时也去重。 */
    const rawList = Array.isArray(parsed?.sessions)
      ? parsed.sessions.filter((s: any) => String(s?.id ?? "")).map((s: any) => ({ id: String(s.id), createdAt: Number(s.createdAt ?? 0) || Date.now() }))
      : [];
    const seen = new Set<string>();
    const sessions = rawList.filter((s: { id: string; createdAt: number }) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    cache = { version: 1, sessions };
  } catch {
    cache = { version: 1, sessions: [] };
  }
  return cache!;
}

async function writeRegistry(next: RegistryFile): Promise<void> {
  /* ⛔ 落盘前统一去重（同一 id 只留一条）—— 名单是「哪些会话是 BOSS 会话」的集合，
     重复条目会让面板列出两个同名会话、删一个另一个还在（10-25 实测）。 */
  const merged = new Map<string, BossSessionRecord>();
  for (const s of next.sessions) if (!merged.has(s.id)) merged.set(s.id, s);
  next = { version: 1, sessions: [...merged.values()] };
  cache = next;
  const file = registryFile();
  const tmp = `${file}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmp, file);          // ⛔ 原子写（写坏了等于名单全丢）
  } catch (error: any) {
    console.warn("[boss-sessions] 落盘失败：", String(error?.message ?? error).slice(0, 200));
  }
}

/** 列出全部 BOSS 会话（附各自的记忆目录）。 */
export async function listBossSessions(): Promise<Array<{ id: string; createdAt: number; memoryDir: string }>> {
  const reg = await readRegistry();
  return reg.sessions.map((s) => ({ ...s, memoryDir: bossMemoryWorkspace(s.id) }));
}

/** 登记一个 BOSS 会话（幂等）。 */
export async function registerBossSession(id: string): Promise<{ id: string; createdAt: number; memoryDir: string } | null> {
  const key = String(id ?? "").trim();
  if (!key) return null;
  const reg = await readRegistry();
  const hit = reg.sessions.find((s) => s.id === key);
  if (hit) return { ...hit, memoryDir: bossMemoryWorkspace(hit.id) };
  const entry: BossSessionRecord = { id: key, createdAt: Date.now() };
  /* ⛔ 写盘前再查一次并去重：两个 add 并发（渲染层 setBossHomeThreadId + ensureBossSessionRegistered
     可能同时发）时，两者都读到"没有这条" ⇒ 各写一份 ⇒ 名单里出现重复 id。 */
  const merged = new Map<string, BossSessionRecord>();
  for (const s of reg.sessions) merged.set(s.id, s);
  merged.set(entry.id, entry);
  await writeRegistry({ version: 1, sessions: [...merged.values()] });
  return { ...entry, memoryDir: bossMemoryWorkspace(entry.id) };
}

/** 注销一个 BOSS 会话，并删掉它专属的记忆目录（会话都没了，记忆留着只是垃圾）。 */
export async function unregisterBossSession(id: string): Promise<{ ok: boolean; removedDir: boolean }> {
  const key = String(id ?? "").trim();
  const reg = await readRegistry();
  const next = reg.sessions.filter((s) => s.id !== key);
  if (next.length === reg.sessions.length) return { ok: false, removedDir: false };
  await writeRegistry({ version: 1, sessions: next });
  let removedDir = false;
  try {
    const dir = bossMemoryWorkspace(key);
    if (dir) { await fs.rm(dir, { recursive: true, force: true }); removedDir = true; }
  } catch { /* 目录删不掉不致命：名单已摘，记忆面板不会再列它 */ }
  return { ok: true, removedDir };
}

/** 会话重建（rollout 丢失自愈）时把身份登记从旧 id 换成新 id。 */
export async function renameBossSession(previousId: string, nextId: string): Promise<boolean> {
  const prev = String(previousId ?? "").trim();
  const next = String(nextId ?? "").trim();
  if (!prev || !next || prev === next) return false;
  const reg = await readRegistry();
  if (!reg.sessions.some((s) => s.id === prev)) return false;
  const nextReg: RegistryFile = {
    version: 1,
    sessions: reg.sessions.map((s) => (s.id === prev ? { id: next, createdAt: s.createdAt } : s)),
  };
  await writeRegistry(nextReg);
  /* 记忆目录也跟着搬（目录名 = 线程 id）⇒ 重建后记忆不丢。 */
  try {
    await fs.rename(bossMemoryWorkspace(prev), bossMemoryWorkspace(next));
  } catch { /* 搬不动就留着旧目录（下次新建会另起一份） */ }
  return true;
}

/** 这个 thread 是不是 BOSS 会话？（主进程捕获写入时判路由用） */
export async function isBossSession(threadId: string): Promise<boolean> {
  const key = String(threadId ?? "").trim();
  if (!key) return false;
  const reg = await readRegistry();
  return reg.sessions.some((s) => s.id === key);
}

/** 启动时从群账本**补登**（老用户的 BOSS 会话可能只在 boss-groups.json 里）。
 *  ⛔ 只补进群账本的 bossThreadId；没建群的「孤儿」BOSS 会话补不回来（那是 10-25 前的旧数据）。 */
export async function backfillFromGroups(bossThreadIds: string[]): Promise<number> {
  const reg = await readRegistry();
  const known = new Set(reg.sessions.map((s) => s.id));
  /* ⛔ 去重：同一个 bossThreadId 出现在**两个群里**时（用户换了个会话建新群，旧群还挂着它）
     不去重就会把同一个 id 登记两次 ⇒ 面板出现两个同名条目（10-25 实测）。 */
  const add = [...new Set(bossThreadIds.map(String).filter((id) => id && !known.has(id)))];
  if (!add.length) return 0;
  await writeRegistry({ version: 1, sessions: [...reg.sessions, ...add.map((id) => ({ id, createdAt: Date.now() }))] });
  return add.length;
}

/** 清空某个 BOSS 会话的专属记忆目录（⛔ 只清记忆，**不删会话**）。 */
export async function clearBossMemory(memoryDir: string): Promise<{ ok: boolean; error?: string }> {
  const dir = String(memoryDir ?? "").trim();
  if (!dir) return { ok: false, error: "缺 memoryDir" };
  /* ⛔ 安全闸：只许删**本进程算出来的** boss-home/memories 下的目录 ——
     渲染层传什么路径都不能让它删到别处（这是删除类操作，必须卡死范围）。 */
  const root = path.join(app.getPath("userData"), "boss-home", "memories");
  const resolved = path.resolve(dir);
  if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) {
    return { ok: false, error: "拒绝清理该路径（不在 BOSS 记忆目录内）" };
  }
  try {
    await fs.rm(resolved, { recursive: true, force: true });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 160) };
  }
}
