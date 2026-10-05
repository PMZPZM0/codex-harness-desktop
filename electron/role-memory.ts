/**
 * role-memory —— **角色私有记忆空间**（10-05 用户要求）。
 *
 * ── 需求原文 ──────────────────────────────────────────────────────────────
 * 「为子智能体、专家团主会话、专家团其他会话成员、每位专家这四类会话角色分别实现独立隔离的
 *   记忆库机制：每类会话拥有自己的持久化记忆空间，支持读取与写入记忆，交互方式与普通会话窗口
 *   保持一致。记忆按会话/角色维度存储且互不串扰，内容跨轮次保留。」
 *
 * ── 设计取舍（都是查过代码后的决定，不是偏好）──────────────────────────────
 * ① **落在工作区，不落 userData**：`MemoryStore` 的碎片池 `memory.json` 在
 *    `app.getPath("userData")`（electron/main.ts:238）⇒ **全局一个**。角色是「某个项目里派出去的
 *    这个人」，把它的记忆写进全局池会让 A 项目派出的知微与 B 项目派出的知微共用一份记忆 ——
 *    那正是用户要避免的"串扰"。故走 `<workspace>/.codex-harness/memory/roles/<归属键>/MEMORY.md`
 *    （与 L1/L1.5 同根��同生命周期，跟项目一起走、一起被 git 管）。
 * ② **不往 MemoryRecord 加字段**：那条池子被 `search()` 全局加权检索（跨工作区只降权到 0.5、
 *    **不过滤**，见 memory-store.ts:175）⇒ 加字段也拦不住"知微的私有记忆被别人的会话召回"。
 *    独立文件是唯一能给出**硬隔离**的形态。
 * ③ **归属键用稳定 id，不用显示名**：显示名会改（"洞明"→"洞明（高级）"），改名就丢记忆。
 *    四类各有稳定标识：子智能体 = `subagent:<id>`、专家 = `expert:<teamId>`（单人专家即只含
 *    lead 的团，与既有 `resolveDispatchTarget` 口径一致）、团主会话 = `team-lead:<teamId>`、
 *    团成员 = `team-member:<teamId>:<memberId>`。
 * ④ **注入复用既有标记**：角色记忆段**塞进 `[Harness 常驻记忆 …]` 之内**（由调用方拼），
 *    显示侧（user-refs / thread-backup / rollout-worker）按标记整段剥离 —— 自己另发明标记
 *    会让机器块漏进用户气泡（守卫【100】【119】）。
 *
 * ── 与既有记忆的关系（互不替代）──────────────────────────────────────────
 * 角色会话读到的仍然是「共享的项目记忆 + 纪律 + 日志」**再加**它自己的私有段；
 * 写则只进自己的私有段，**不污染**主会话记忆（用户 10-05 明确要"独立隔离"）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { MEMORY_BUDGET, isScratchWorkspace } from "./memory-layers";

/* 目录常量与 memory-layers.ts 同源（⛔ 不 import 它的私有常量，故在此重声明同值；
   守卫【role】钉住两处一致 —— 漂了就会写到别处、读时找不到）。 */
const MEMORY_DIR = ".codex-harness";
const MEMORY_SUB = "memory";
const ROLES_DIR = "roles";
const ROLE_FILE = "MEMORY.md";

/** 角色记忆的注入预算：独立于共享层（它是**额外**的一段，不占 MEMORY_BUDGET.total 的共享额度）。 */
export const ROLE_MEMORY_BUDGET = 4000;

/** 单条上限：⛔ 不限长的话，模型一次写 10MB 就能把角色记忆文件撑爆（注入时被钳掉但文件还在，
   且下次追加要重读整份）。与既有纪律一致：只追加、超限即拒。 */
export const ROLE_MEMORY_MAX_ENTRY = 2000;

export type RoleKind = "subagent" | "expert" | "team-lead" | "team-member";

/** 角色归属：既能唯一定位一个角色，也能写进文件里自证。 */
export type RoleRef = {
  kind: RoleKind;
  /** 子智能体 id / 专家团 id / 专家团 id（成员时是团 id） */
  id: string;
  /** 仅 team-member：成员 id */
  memberId?: string;
  /** 显示名，仅用于注入抬头与文件自述（⛔ 不参与归属计算） */
  label?: string;
};

/* ── 归属键：唯一的身份来源 ──────────────────────────────────────────────
   ⛔ 必须稳定、可读、且**不同类别不会撞**：专家团里"主理人"与"成员"是两个角色，
   单人专家的 lead 既是 expert 又是 team-lead —— 靠 kind 前缀区分开。
   ⛔⛔ 分隔符**不能是 `:`**（实跑抓到：Windows 文件名非法字符，`mkdir` 直接 ENOENT ——
      四个角色一个都写不进去，而纯文本守卫全绿）。这里用 `__` 分段：跨平台合法、可读、仍唯一。 */
export function roleKey(ref: RoleRef): string {
  const kind = String(ref?.kind ?? "").trim();
  const id = String(ref?.id ?? "").trim();
  if (!kind || !id) return "";
  // ⛔ 文件名安全：id 可能含路径分隔符 / Windows 非法字符 ⇒ 统一净化。
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 64);
  return ref.kind === "team-member" && ref.memberId
    ? `${safe(kind)}__${safe(id)}__${safe(String(ref.memberId))}`
    : `${safe(kind)}__${safe(id)}`;
}

/** 归属键 → 展示名（注入抬头用；取不到就退回键本身，绝不空）。 */
export function roleTitle(ref: RoleRef): string {
  const label = String(ref?.label ?? "").trim();
  const kind = String(ref?.kind ?? "");
  const kindName = kind === "subagent" ? "子智能体"
    : kind === "expert" ? "专家"
    : kind === "team-lead" ? "专家团主会话"
    : "专家团成员";
  return label ? `${kindName}「${label}」` : kindName;
}

function roleDir(workspace: string | undefined, key: string): string | null {
  if (!workspace) return null;
  /* ⛔ scratch 会话（无项目聊天）没有项目记忆，理由同 memory-layers.projectDir：
       那里写进去就是构建即清的假归属。 */
  if (isScratchWorkspace(workspace)) return null;
  return path.join(workspace, MEMORY_DIR, MEMORY_SUB, ROLES_DIR, key);
}

function roleFile(workspace: string | undefined, key: string): string | null {
  const dir = roleDir(workspace, key);
  return dir ? path.join(dir, ROLE_FILE) : null;
}

async function readText(file: string): Promise<string> {
  try { return await fs.readFile(file, "utf8"); }
  catch (error: any) { if (error?.code !== "ENOENT") throw error; return ""; }
}

function clamp(text: string, max: number): { text: string; cut: number } {
  const value = String(text ?? "").trim();
  if (value.length <= max) return { text: value, cut: 0 };
  return { text: value.slice(0, max).trimEnd(), cut: value.length - max };
}

/**
 * 读某个角色的私有记忆全文（**未钳制** —— 钳制在注入时做，与既有层同口径）。
 * 角色不存在 / 没有工作区 / scratch ⇒ 空串（⛔ 不抛：记忆读不到不该让调度失败）。
 */
export async function readRoleMemory(workspace: string | undefined, ref: RoleRef): Promise<string> {
  const key = roleKey(ref);
  const file = key ? roleFile(workspace, key) : null;
  if (!file) return "";
  try { return (await readText(file)).trim(); }
  catch { return ""; }
}

export type RoleMemorySection = {
  /** 注入正文（已钳制，空串 = 这个角色还没有私有记忆） */
  text: string;
  /** 截掉多少字（注入时要如实告诉引擎，别让它在盲区里干活） */
  cut: number;
  /** 归属键（写进文件头自证 + 注入抬头） */
  key: string;
  title: string;
};

/**
 * 拼出可注入的「角色私有记忆」段。
 * ⛔ **只返回正文，不加 `[Harness 常驻记忆]` 标记** —— 由调用方（delegate-memory）拼进既有
 *   标记之内；自己发明标记会让显示侧剥不掉（见文件头约束 ④）。
 */
export async function roleMemorySection(workspace: string | undefined, ref: RoleRef): Promise<RoleMemorySection> {
  const key = roleKey(ref);
  const title = roleTitle(ref);
  if (!key) return { text: "", cut: 0, key: "", title };
  const raw = await readRoleMemory(workspace, ref);
  if (!raw) return { text: "", cut: 0, key, title };
  const { text, cut } = clamp(raw, ROLE_MEMORY_BUDGET);
  const clipped = cut ? `\n> ⛔ 该角色的私有记忆超出预算被截断 ${cut} 字 —— 先蒸馏（删掉已过时的条目）再干活。` : "";
  return { text: `## ${title}的私有记忆（只属于这个角色，其他角色看不到）${clipped}\n${text}`, cut, key, title };
}

/**
 * 追加一条到角色私有记忆（写入端唯一入口）。
 * - 逐条去重（归一化后已存在就跳过）⇒ 反复写同一件事不会膨胀。
 * - 只追加、**绝不改写或删除**既有行（与 appendUserProfile / appendLesson 同纪律）。
 * - 自动维护文件头的归属自述（哪个角色的记忆），换机/手改文件后仍能对上号。
 */
export async function appendRoleMemory(workspace: string | undefined, ref: RoleRef, line: string): Promise<{ written: boolean; reason?: string }> {
  const key = roleKey(ref);
  const text = String(line ?? "").trim();
  if (!key) return { written: false, reason: "缺少角色归属" };
  if (!text) return { written: false, reason: "记忆内容为空" };
  if (text.length > ROLE_MEMORY_MAX_ENTRY) {
    return { written: false, reason: `单条记忆超过 ${ROLE_MEMORY_MAX_ENTRY} 字（本次 ${text.length} 字）—— 请写得更精炼，细节留给产出本身` };
  }
  const file = roleFile(workspace, key);
  if (!file) return { written: false, reason: "没有工作区（scratch 会话不落角色记忆）" };

  /* 去重归一化：只抹**排版差异**（空白 + 标点），⛔ **保留数字与字母** ——
     记忆里"跑了 3 次""阈值 0.8"这类信息是有意义的，抹掉数字会把两条不同的记忆判成重复
     （10-05 实跑抓到：写"第 1 条/第 2 条…"只有第一条成功，后续全被"已存在相同内容"拒了）。
     对照：appendUserProfile 的归一化也抹数字，那是用户画像（"喜欢简洁"这类），
     角色记忆是**工作事实**，口径必须更严。 */
  const norm = (s: string) => s.replace(/[\s，。！？、,.!?:：；;"'（）()【】\[\]]/g, "");
  const existing = (await readText(file)).split("\n");
  if (existing.some((l) => norm(l) && norm(l) === norm(text))) return { written: false, reason: "已存在相同内容" };

  const header = `<!-- 角色私有记忆 · 归属 ${key} · ${roleTitle(ref)} · 追加式，禁止改写既有行 -->`;
  const body = existing.filter((l) => l.trim() && !l.trim().startsWith("<!--")).concat(text);
  const content = `${header}\n${body.join("\n")}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return { written: true };
}

/** 所有角色记忆的根目录（列举/清理用；⛔ 没工作区或 scratch ⇒ null）。 */
function rolesRoot(workspace: string | undefined): string | null {
  if (!workspace) return null;
  if (isScratchWorkspace(workspace)) return null;
  return path.join(workspace, MEMORY_DIR, MEMORY_SUB, ROLES_DIR);
}

/**
 * ── 会话 → 角色归属（反查表）────────────────────────────────────────────
 * 用途：**主进程**应答委派会话的工具调用时，只知道 threadId，需要反查「它是哪个角色」
 * 才知道该把记忆写到谁名下（渲染层那条路拿不到被委派会话的事件，见 features/boot.ts 的过滤）。
 * ⛔ 落**工作区外的 userData**：它是运行时索引（会话可归档、角色可改名），
 *   真正的记忆内容在 `<workspace>/.codex-harness/memory/roles/`（随项目走）。
 * ⛔ 幂等：同一 threadId 重复登记直接覆盖（一个会话只可能是一个角色）。
 */
const ROLE_INDEX_FILE = "role-memory-index.json";
type RoleIndex = Record<string, { ref: RoleRef; workspace: string; at: number }>;

let roleIndexCache: RoleIndex | null = null;

async function roleIndexPath(userDataDir: string): Promise<string> {
  await fs.mkdir(userDataDir, { recursive: true });
  return path.join(userDataDir, ROLE_INDEX_FILE);
}

async function readRoleIndex(userDataDir: string): Promise<RoleIndex> {
  if (roleIndexCache) return roleIndexCache;
  try {
    const raw = await fs.readFile(await roleIndexPath(userDataDir), "utf8");
    const parsed = JSON.parse(raw);
    roleIndexCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RoleIndex : {};
  } catch { roleIndexCache = {}; }
  return roleIndexCache!;
}

/** 登记「这个会话就是这个角色」。四条发起路径（委派三类 + 团成员会话）建会话后都要调。 */
export async function registerRoleSession(userDataDir: string, threadId: string, ref: RoleRef, workspace: string): Promise<void> {
  const tid = String(threadId ?? "").trim();
  const key = roleKey(ref);
  if (!tid || !key) return;
  const index = await readRoleIndex(userDataDir);
  index[tid] = { ref, workspace: String(workspace ?? ""), at: Date.now() };
  await fs.writeFile(await roleIndexPath(userDataDir), JSON.stringify(index, null, 2), "utf8");
}

/** 反查：会话 → 角色归属（⛔ 查不到返回 null，调用方按"无归属"处理，⛔ 不抛）。 */
export async function lookupRoleSession(userDataDir: string, threadId: string): Promise<{ ref: RoleRef; workspace: string } | null> {
  const tid = String(threadId ?? "").trim();
  if (!tid) return null;
  const index = await readRoleIndex(userDataDir);
  const hit = index[tid];
  return hit?.ref ? { ref: hit.ref, workspace: String(hit.workspace ?? "") } : null;
}

/** 忘掉一个会话的归属（会话被删时调，避免索引无限增长）。 */
export async function forgetRoleSession(userDataDir: string, threadId: string): Promise<boolean> {
  const tid = String(threadId ?? "").trim();
  if (!tid) return false;
  const index = await readRoleIndex(userDataDir);
  if (!index[tid]) return false;
  delete index[tid];
  await fs.writeFile(await roleIndexPath(userDataDir), JSON.stringify(index, null, 2), "utf8");
  return true;
}

/**
 * 列出**全部**会话↔角色归属（10-05 记忆前端用）。
 * ⛔ 为什么要它：fabric 的命名空间只带 `private__<threadId>`，前端拿不到
 *   「这个 threadId 是哪位专家/哪个子智能体」⇒ 没有它就无法把条目归到人看。
 * ⛔ 只读索引，不含记忆内容（内容按命名空间单独读）。
 */
export async function listRoleSessions(userDataDir: string): Promise<{ threadId: string; ref: RoleRef; workspace: string; at: number }[]> {
  const index = await readRoleIndex(userDataDir);
  return Object.entries(index).map(([threadId, v]) => ({
    threadId, ref: v.ref, workspace: String(v.workspace ?? ""), at: v.at,
  }));
}

/** 列出当前工作区下已有私有记忆的角色（给设置页/记忆中心用；⛔ 没工作区返回空数组）。 */
export async function listRoleMemories(workspace: string | undefined): Promise<{ key: string; chars: number }[]> {
  const dir = rolesRoot(workspace);
  if (!dir) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: { key: string; chars: number }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, ROLE_FILE);
      const text = await readText(file);
      if (!text.trim()) continue;
      out.push({ key: entry.name, chars: text.length });
    }
    return out.sort((a, b) => b.chars - a.chars);
  } catch { return []; }
}
