/**
 * memory-fabric —— **统一记忆内核**（10-05 用户要求：子智能体 / 被调度专家 / 主会话
 * 共用同一套记忆实现，会话记忆按会话隔离、项目记忆全局共享）。
 *
 * 架构真相源 = `docs/MEMORY-ARCHITECTURE-2026-10-05.md`。⛔ 改这里之前先改那份文档。
 *
 * ── 为什么不是"再加一套" ────────────────────────────────────────────────
 * 改造前全仓有两套并行记忆：L0–L7 分层（`memory-layers.ts`，**只有主会话能写**）
 * 与角色私有记忆（`role-memory.ts`，**只有角色能写**）。它们互不知道对方存在，
 * 模型得自己判断这次该调 `memory_save` 还是 `role_memory_save` —— 那是"两套同名能力"
 * 的变体。本模块把两者收敛成**一个内核 + 两种作用域 + 一个写入工具**。
 *
 * ── 三条硬纪律（都是踩过的坑，不���偏好）────────────────────────────────
 * ① **隔离靠寻址，不靠过滤**：`session__A` 与 `session__B` 是两个不同目录，
 *   检索函数在物理上只能扫到句柄对应的那一个。⛔ 绝不"读全量再过滤" ——
 *   漏掉一个过滤条件就是串扰事故（用户 10-05 的核心诉求就是隔离）。
 * ② **落工作区，不落 userData**：`userData/memory.json` 的 `search()` 对跨工作区
 *   只**降权到 0.5、不过滤**（memory-store.ts:175）⇒ 靠加字段永远拦不住串扰。
 *   独立文件 + 目录级隔离是唯一能给出硬保证的形态。
 * ③ **命名空间分隔符绝不能用 `:`** —— Windows 文件名非法字符，
 *   实跑验证 `mkdir` 直接 ENOENT、条目一个都写不进去，而纯文本守卫全绿。
 *
 * ── 与既有系统的关系（互不替代）────────────────────────────────────────
 * · L0–L7 层**不动**（单一真相源仍是 `memory-layers.ts`），本模块在它之上加一层寻址。
 * · `roles/<键>/MEMORY.md`（上一轮的四类角色私有记忆）**不删**：由 `legacyRoleSections`
 *   作为补充注入继续可读（架构文档 §7），删了会让用户已积累的专家记忆凭空消失。
 * · 旧的 `memory_save` / `role_memory_save` 都**转发到本模块**的同一个写入面。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { MEMORY_BUDGET, isScratchWorkspace } from "./memory-layers";
import { readRoleMemory, type RoleRef } from "./role-memory";

/* ── 常量 ───────────────────────────────────────────────────────────────── */

/* ⛔ 与 memory-layers.ts 同源（不 import 它的私有常量，故重声明同值；
   守卫 11l 钉住两处一致 —— 漂了就会写到别处、读时找不到）。 */
const MEMORY_DIR = ".codex-harness";
const MEMORY_SUB = "memory";
const FABRIC_DIR = "fabric";
const ENTRIES_FILE = "entries.jsonl";

/** 注入预算：fabric 段**独立**于 MEMORY_BUDGET（它是额外的一段，不占共享额度）。 */
export const FABRIC_BUDGET = { project: 3000, session: 4000 } as const;

/** 单条上限：⛔ 不限长的话模型一次写 10MB 就能把文件撑爆（注入被钳掉但文件还在）。 */
export const FABRIC_MAX_ENTRY = 2000;

/** 单命名空间条数上限（超出时裁掉最不重要且最久没用的；pinned 永不裁）。 */
export const FABRIC_MAX_ENTRIES = 400;

/** 时间衰减半衰期（天）—— 14 天前的东西 relevance 减半。 */
export const FABRIC_HALF_LIFE_DAYS = 14;

/** 会话记忆保留期（天）：超期归档而非删除（⛔ 归档 ≠ 失忆，见架构文档 §6）。 */
export const FABRIC_SESSION_RETENTION_DAYS = 90;

/* ── 类型 ───────────────────────────────────────────────────────────────── */

/** ⛔ 只有两级作用域（用户要求：会话隔离 / 项目共享）。角色是"谁写的"，不是"存在哪"。 */
export type MemoryScope = "session" | "project";

/** 写入者身份。⛔ 角色**不是存储维度** —— 写进哪个作用域由 scope 决定，不由它决定。 */
export type MemoryAgentKind = "main" | "subagent" | "expert" | "team-lead" | "team-member" | "system";

export type MemorySourceAgent = { kind: MemoryAgentKind; id: string; label?: string };

/** ⛔ 分类沿用既有 memory_save 的五个词，不新造（模型见过的词它才用得对）。 */
export type MemoryCategory = "用户偏好" | "项目背景" | "工作流/SOP" | "任务经验" | "临时上下文";

export type MemoryEntry = {
  /** 稳定 id：`<时间戳36进制>-<随机6位>`。⛔ 不做内容哈希（内容会变） */
  id: string;
  content: string;
  scope: MemoryScope;
  /** 所属会话：scope=session 时必填；scope=project 时也填（可追溯"谁在哪个会话写的"） */
  sessionId: string | null;
  /** 所属项目（两个作用域都填） */
  projectKey: string;
  sourceAgent: MemorySourceAgent;
  category: MemoryCategory;
  /** 重要性权重 0..1 */
  weight: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
  /** 归档时间（会话记忆被归档时打戳；⛔ 不删内容，见架构文档 §6） */
  archivedAt?: number | null;
};

export type WriteInput = {
  content: string;
  scope: MemoryScope;
  category: MemoryCategory;
  weight?: number;
  pinned?: boolean;
  /** scope=project 时的显式放行闸；⛔ 角色会话不 promote 一律拒（见 §write 的闸）。 */
  promote?: boolean;
};

export type RecallOptions = {
  limit?: number;
  includePinned?: boolean;
  categories?: MemoryCategory[];
  /** ⛔ 是否把**已归档**条目也算进来（默认否 —— 归档 = 不参与召回，只保留内容）。 */
  includeArchived?: boolean;
};

/** 写入结果。⛔ `reason` 必须是人能读、模型能转达给用户的一句话。 */
export type WriteResult = { id: string; written: boolean; reason?: string };

/* ── 命名空间寻址 ──────────────────────────────────────────────────────── */

/** 路径安全的净化：⛔ id 可能含路径分隔符 / Windows 非法字符，统一替换并截断。 */
function safeId(s: string): string {
  return String(s ?? "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 64) || "unknown";
}

/**
 * 项目键：workspace → 稳定短键。
 * ⛔ 用**规范化后的绝对路径**（Windows 下小写化 + 斜杠归一），
 * 否则同一项目用 `D:\11` 和 `d:/11/` 两种写法会分成两份记忆。
 */
export function projectKeyOf(workspace: string | undefined): string {
  const raw = String(workspace ?? "").trim();
  if (!raw) return "";
  const norm = path.resolve(raw).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return safeId(norm);
}

/**
 * 命名空间键：`<scope>__<ownerId>`。
 * ⛔⛔ 分隔符**绝不能用 `:`** —— Windows 文件名非法字符（实跑 `mkdir` ENOENT，
 *    条目一个都写不进，而纯文本守卫全绿）。这里用 `__`，跨平台合法且仍可读。
 */
export function namespaceOf(scope: MemoryScope, ownerId: string): string {
  const owner = String(ownerId ?? "").trim();
  if (!owner) return "";
  return `${safeId(scope)}__${safeId(owner)}`;
}

function fabricRoot(workspace: string | undefined): string | null {
  if (!workspace) return null;
  /* ⛔ scratch 会话（无项目聊天）不落记忆，理由同 memory-layers.projectDir：
       那里写进去就是构建即清的假归属。 */
  if (isScratchWorkspace(workspace)) return null;
  return path.join(workspace, MEMORY_DIR, MEMORY_SUB, FABRIC_DIR);
}

function namespaceDir(workspace: string | undefined, ns: string): string | null {
  const root = fabricRoot(workspace);
  if (!root || !ns) return null;
  const dir = path.join(root, ns);
  /* ⛔ 目录必须仍在 fabric 根内（挡住 `..` 与绝对路径 —— 键是我们自己产的，
     但净化后仍做一次纵深防御：越界写等于任意文件写）。 */
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return dir;
}

function entriesFile(workspace: string | undefined, ns: string): string | null {
  const dir = namespaceDir(workspace, ns);
  return dir ? path.join(dir, ENTRIES_FILE) : null;
}

/* ── 条目 id 与默认权重 ─────────────────────────────────────────────────── */

let idSeq = 0;
function newId(): string {
  idSeq = (idSeq + 1) % 1_679_616;
  return `${Date.now().toString(36)}-${idSeq.toString(36).padStart(4, "0")}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}

/** 分类的默认权重：⛔ 这是"分类 ⇒ 重要性"的唯一映射，检索与裁剪都依赖它。 */
const CATEGORY_WEIGHT: Record<MemoryCategory, number> = {
  "用户偏好": 0.75,
  "项目背景": 0.8,
  "工作流/SOP": 0.85,
  "任务经验": 0.6,
  "临时上下文": 0.3,
};

export function defaultWeightOf(category: MemoryCategory): number {
  return CATEGORY_WEIGHT[category] ?? 0.5;
}

/* ── 读 ─────────────────────────────────────────────────────────────────── */

async function readJsonl<T>(file: string | null): Promise<T[]> {
  if (!file) return [];
  let raw = "";
  try { raw = await fs.readFile(file, "utf8"); }
  catch (error: any) { if (error?.code === "ENOENT") return []; throw error; }
  const out: T[] = [];
  /* ⛔ 逐行 try：单行坏掉（手改过 / 写了一半）不该让整份记忆读不出来。 */
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try { const parsed = JSON.parse(text); if (parsed && typeof parsed === "object") out.push(parsed as T); }
    catch { /* 跳过坏行 */ }
  }
  return out;
}

async function appendJsonl(file: string, entry: MemoryEntry): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  /* ⛔ 追加而非重写：崩了最多丢最后一行，不会像"读-改-写"那样把整份记忆清空。 */
  await fs.appendFile(file, JSON.stringify(entry) + "\n", "utf8");
}

async function rewriteJsonl(file: string, entries: MemoryEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""), "utf8");
}

/** 读某个命名空间的全部条目（⛔ 物理上只能读到一个命名空间 —— 这就是隔离的实现）。 */
export async function readNamespace(workspace: string | undefined, ns: string): Promise<MemoryEntry[]> {
  return readJsonl<MemoryEntry>(entriesFile(workspace, ns));
}

/**
 * 记账：把命中条目的 `useCount++` / `lastUsedAt=now` 写回。
 * ⛔⛔ **就地重写整份文件**，⛔ 绝不 appendFile 追加残缺行 —— `readNamespace` 会把
 *   残缺行原样返回，`rankEntries` 就会拿到 undefined 字段（第一版踩过这个坑）。
 * ⛔ 读-改-写在单主进程内是安全的（写入都在同一事件循环里串行完成）。
 */
async function touchEntries(workspace: string | undefined, ns: string, ids: Set<string>, now: number): Promise<number> {
  const file = entriesFile(workspace, ns);
  if (!file || !ids.size) return 0;
  const entries = await readNamespace(workspace, ns);
  let n = 0;
  for (const e of entries) {
    if (!ids.has(e.id)) continue;
    e.useCount = (Number(e.useCount) || 0) + 1;
    e.lastUsedAt = now;
    n++;
  }
  if (n) await rewriteJsonl(file, entries);
  return n;
}

/* ── 句柄 ───────────────────────────────────────────────────────────────── */

export type MemoryHandle = {
  readonly scope: MemoryScope;
  readonly namespace: string;
  readonly sessionId: string;
  readonly projectKey: string;
  readonly agent: MemorySourceAgent;
  /** 写入（⛔ 越界/超限/未过闸都返回 written:false + 人能读的 reason，不抛）。 */
  write(input: WriteInput): Promise<WriteResult>;
  /** 检索：只扫本句柄的命名空间。 */
  recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>;
  /** 注入正文：按预算钳制，⛔ 截断如实告知。 */
  section(query?: string): Promise<FabricSection>;
};

export type FabricSection = {
  text: string;
  cut: number;
  entries: number;
  namespace: string;
  scope: MemoryScope;
};

type HandleInit = {
  scope: MemoryScope;
  /** scope=session 时为 threadId；scope=project 时为 projectKey */
  ownerId: string;
  sessionId: string;
  projectKey: string;
  workspace: string | undefined;
  agent: MemorySourceAgent;
};

function clampText(text: string, max: number): { text: string; cut: number } {
  const value = String(text ?? "").trim();
  if (value.length <= max) return { text: value, cut: 0 };
  return { text: value.slice(0, max).trimEnd(), cut: value.length - max };
}

/** 判定「这是哪个角色的记忆段」用（兼容读，见 §legacyRoleSections）。 */
function isRoleAgent(agent: MemorySourceAgent): boolean {
  return agent.kind !== "main" && agent.kind !== "system";
}

function createHandle(init: HandleInit): MemoryHandle {
  const ns = namespaceOf(init.scope, init.ownerId);
  const workspace = init.workspace;

  return {
    scope: init.scope,
    namespace: ns,
    sessionId: init.sessionId,
    projectKey: init.projectKey,
    agent: init.agent,

    async write(input: WriteInput): Promise<WriteResult> {
      const id = newId();
      const content = String(input?.content ?? "").trim();
      if (!ns) return { id, written: false, reason: "没有可用的记忆命名空间（缺会话或工作区）" };
      if (!content) return { id, written: false, reason: "记忆内容为空" };
      if (content.length > FABRIC_MAX_ENTRY) {
        return { id, written: false, reason: `单条记忆超过 ${FABRIC_MAX_ENTRY} 字（本次 ${content.length} 字）—— 请写得更精炼，细节留给产出本身` };
      }
      /* ⛔⛔ 写入闸：角色会话（主会话与系统之外）写 project 必须显式 promote。
         project 是全局共享的 —— 一个子智能体把中间结论写进去会污染主会话与所有角色。
         ⛔ 不静默放行：返回可执行提示，让模型转达用户确认后再带 promote 重写。 */
      if (init.scope === "project" && isRoleAgent(init.agent) && input?.promote !== true) {
        return {
          id,
          written: false,
          reason: "项目记忆是全局共享的，需要先征得用户同意。要写进项目记忆请带 promote=true（建议先问用户「这段经验值得让所有会话都记住吗？」）",
        };
      }

      const file = entriesFile(workspace, ns);
      if (!file) return { id, written: false, reason: "没有工作区（scratch 会话不落记忆）" };

      const entries = await readNamespace(workspace, ns);
      /* ⛔ 去重归一化：只抹**排版差异**（空白 + 标点），⛔ 保留数字与字母 ——
         "跑了 3 次""阈值 0.8" 是有信息的。踩过：抹掉数字后"第 1 条/第 2 条…"
         被判成同一批，只有第一条写得进去（与 role-memory 的教训同源）。 */
      const norm = (s: string) => s.replace(/[\s，。！？、,.!?:：；;"'（）()【】\[\]]/g, "");
      if (entries.some((e) => norm(e.content) && norm(e.content) === norm(content))) {
        return { id, written: false, reason: "已存在相同内容" };
      }

      const now = Date.now();
      /* ⛔⛔ scope 以**句柄的**为准，不信 input.scope。
         句柄决定落到哪个目录（物理事实），input 只是调用方的声明 ——
         两者不一致时（例如 `projectHandle.write({ scope: "session" })`），
         采信声明会让元数据与实际存放位置对不上，检索与裁剪全错。
         ⛔ 不静默修正：直接拒，把 bug 报出来。 */
      if (input?.scope && input.scope !== init.scope) {
        return { id, written: false, reason: `写入作用域与句柄不一致（声明 ${input.scope}、句柄 ${init.scope}）—— 已拒绝，这是调用方的 bug` };
      }
      const entry: MemoryEntry = {
        id,
        content,
        scope: init.scope,
        sessionId: init.sessionId || null,
        projectKey: init.projectKey,
        sourceAgent: init.agent,
        category: (input?.category ?? "临时上下文") as MemoryCategory,
        weight: clamp01(input?.weight ?? defaultWeightOf(input?.category as MemoryCategory)),
        pinned: input?.pinned === true,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        useCount: 0,
        archivedAt: null,
      };
      await appendJsonl(file, entry);

      /* 超量则裁剪（⛔ pinned 永不裁；先按"不重要且最久没用"淘汰）。 */
      const after = await readNamespace(workspace, ns);
      if (after.length > FABRIC_MAX_ENTRIES) {
        const keep = pruneEntries(after, FABRIC_MAX_ENTRIES);
        await rewriteJsonl(file, keep);
      }
      return { id, written: true };
    },

    async recall(query: string, opts: RecallOptions = {}): Promise<MemoryEntry[]> {
      const entries = await readNamespace(workspace, ns);
      const hit = await rankEntries(entries, query, opts);
      /* ⛔ 记账（useCount / lastUsedAt）：命中就记一笔，供 LRU 裁剪用。
         ⛔ **fire-and-forget**（不 await、失败静默）：召回是**读路径**，
            同步写盘会让每次召回都产生写放大；
            而裁剪本身有 `lastUsedAt ?? createdAt` 回退 ⇒ 记账失败最多退化成
            "按创建时间裁"，**不会误裁重要条目**。
         ⛔⛔ 记账**只能就地重写整份文件**，⛔ 绝不许 appendFile 追加残缺行 ——
            readNamespace 会把残缺行原样返回，rankEntries 拿到 undefined 字段。
            （第一版就是写成 appendJsonl ⇒ 会污染 entries.jsonl，已当场改掉。）
         ⛔ 这两个字段若从不更新，就是"注释声称能力"（裁剪依赖它、实际恒为初值）。 */
      if (hit.length && ns) {
        void touchEntries(workspace, ns, new Set(hit.map((e) => e.id)), Date.now()).catch(() => undefined);
      }
      return hit;
    },

    async section(query?: string): Promise<FabricSection> {
      /* ⛔⛔ 本段**不自带** `[Harness 常驻记忆 …]` 注入标记 —— 标记由调用方
         （delegate-memory / 渲染层 send 路径）拼在整段外面。理由：显示侧（user-refs /
         thread-backup / rollout-worker）按标记整段剥离，自己另发明标记会让机器块
         漏进用户气泡（守卫【fabric】⑥ 钉着这条）。 */
      const budget = init.scope === "session" ? FABRIC_BUDGET.session : FABRIC_BUDGET.project;
      /* ⛔ 带 query 时**只注入相关的**（`rankEntries` 已保证；这里再过一层是双保险：
         万一有人把 rankEntries 改回"只排序不过滤"，注入就会重新带上噪声）。
         空 query = 常驻注入，那时按重要度全给。 */
      const entries = await rankEntries(await readNamespace(workspace, ns), query ?? "", {});
      const relevant = query?.trim() ? entries.filter((e) => isRelevant(e.content, tokenize(query))) : entries;
      if (!relevant.length) return { text: "", cut: 0, entries: 0, namespace: ns, scope: init.scope };
      /* ⛔ 注入按重要性降序拼接（同分按创建时间）—— 让最重要的先被读到。 */
      const lines = relevant
        .slice()
        .sort((a, b) => b.weight - a.weight || b.createdAt - a.createdAt)
        .map((e) => {
          const who = e.sourceAgent.kind === "main" ? "主会话" : (e.sourceAgent.label || e.sourceAgent.kind);
          const date = new Date(e.createdAt).toISOString().slice(0, 10);
          return `- （${e.category}·${who}·${date}·权重 ${e.weight.toFixed(2)}）${e.content}`;
        });
      const { text, cut } = clampText(lines.join("\n"), budget);
      const title = init.scope === "session" ? "本会话的记忆（仅本会话可见）" : "项目记忆（全体会话与智能体共享）";
      const clipped = cut ? `\n> ⛔ 该段超出预算被截断 ${cut} 字 —— 以上不是全部内容。` : "";
      return {
        text: `## ${title}（本次注入 ${relevant.length} / 命名空间共 ${entries.length} 条）${clipped}\n${text}`,
        cut,
        entries: relevant.length,
        namespace: ns,
        scope: init.scope,
      };
    },
  };
}

function clamp01(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

/* ── 检索打分 ───────────────────────────────────────────────────────────── */

/** 中文近似分词：逐字 + 双字 bigram（零依赖、完全离线）。 */
export function tokenize(text: string): string[] {
  const s = String(text ?? "").toLowerCase();
  const out = new Set<string>();
  for (const ch of s) if (/[a-z0-9]/.test(ch) || ch.charCodeAt(0) > 127) out.add(ch);
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1];
    if (/[a-z0-9]/.test(a) || a.charCodeAt(0) > 127) {
      if (/[a-z0-9]/.test(b) || b.charCodeAt(0) > 127) out.add(a + b);
    }
  }
  return [...out];
}

/**
 * ⛔ 判定一条记忆是否与查询相关。
 * **为什么不能是"命中任意一个 token"**：tokenize 出了逐字 + bigram，
 * 查"蓝绿部署"会拆出"部""署""蓝绿"…，随便哪条含"部"就算命中 ⇒
 * 召回一堆不相关条目（实跑抓到：查一个项目里没有的词，召回了 6 条）。
 * ⇒ 双阈值：长短语命中任意一个即算；单字/双字 token 必须命中**足够比例**才算。
 */
function isRelevant(content: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const lower = content.toLowerCase();
  let shortHits = 0, shortTotal = 0;
  for (const t of tokens) {
    /* 长 token（≥3 字）是有区分度的，命中即算相关。 */
    if (t.length >= 3) { if (lower.includes(t)) return true; continue; }
    shortTotal++;
    if (lower.includes(t)) shortHits++;
  }
  if (!shortTotal) return false;
  /* ⛔ 门槛 0.34：低于它基本是噪声（中文单字命中率天然偏高）。
     例外：查询很短（≤2 token）时要求至少命中 1 个。 */
  return shortTotal <= 2 ? shortHits >= 1 : shortHits / shortTotal >= 0.34;
}

function decayOf(entry: MemoryEntry, now: number): number {
  const days = Math.max(0, now - entry.createdAt) / 86_400_000;
  return 1 / (1 + days / FABRIC_HALF_LIFE_DAYS);
}

/**
 * 排序：相关度 × 权重 × 时间衰减 × 钉住加成。
 * ⛔ 查询为空时**按重要度返回全部**（常驻注入要的是"重要且新"，不是"匹配"）。
 */
export function rankEntries(entries: MemoryEntry[], query: string, opts: RecallOptions = {}): MemoryEntry[] {
  const now = Date.now();
  const tokens = tokenize(query);
  const cats = opts.categories?.length ? new Set(opts.categories) : null;
  let pool = entries.filter((e) => !cats || cats.has(e.category));
  if (opts.includePinned === false) pool = pool.filter((e) => !e.pinned);

  /* ⛔⛔ **已归档的条目不参与召回**（只保留内容，不参与检索/注入）。
     ⛔ 归档必须真的有行为差异，否则那个标记就是装饰（"注释声称能力"的变体）：
     只写不读的字段等于没有。默认**过滤掉**；需要读历史时显式传 includeArchived。
     ⛔ 裁剪与清扫**不过滤**归档（归档不等于可删）。 */
  const live = opts.includeArchived ? pool : pool.filter((e) => e.archivedAt == null);
  /* ⛔ 带 query 时**不相关的条目一律不返回** —— 只把 score 排到后面是不够的：
     `limit` 默认全量 ⇒ 它们照样出现在结果里（实跑抓到：查"蓝绿部署"召回了
     一条零命中的 pnpm 记忆）。语义：召回 = 相关度过滤 + 排序，不是"全都给你看"。 */
  const kept = tokens.length ? live.filter((e) => isRelevant(e.content, tokens)) : live;
  kept.sort((a, b) => b.weight * decayOf(b, now) * (b.pinned ? 1.5 : 1) - a.weight * decayOf(a, now) * (a.pinned ? 1.5 : 1)
    || b.createdAt - a.createdAt);
  const limit = opts.limit && opts.limit > 0 ? opts.limit : kept.length;
  return kept.slice(0, limit);
}

/** 裁剪到上限：⛔ pinned 永不裁；其余按"权重低 + 最久没用"优先淘汰。 */
export function pruneEntries(entries: MemoryEntry[], max: number): MemoryEntry[] {
  if (entries.length <= max) return entries;
  const keep = new Set(
    entries
      .filter((e) => e.pinned)
      .map((e) => e.id),
  );
  const rest = entries
    .filter((e) => !keep.has(e.id))
    .sort((a, b) => b.weight - a.weight || (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
  for (const e of rest) {
    if (keep.size >= max) break;
    keep.add(e.id);
  }
  const order = new Map(entries.map((e, i) => [e.id, i] as const));
  return entries.filter((e) => keep.has(e.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/* ── 句柄获取（唯一的工厂）──────────────────────────────────────────────── */

/**
 * ⛔⛔ **所有智能体（主会话 / 子智能体 / 被调度专家 / 团成员）拿的都是这个工厂的产物**
 * —— 这是"共用同一套记忆实现"的字面含义。
 * ⛔ 一次返回**两个**句柄（session + project），调用方不能只要一个：
 *   "读得到项目记忆"是全体智能体的共同基线；写 project 另走写入闸。
 */
export async function getMemoryHandles(input: {
  sessionId: string;
  workspace: string | undefined;
  agent: MemorySourceAgent;
}): Promise<{ session: MemoryHandle | null; project: MemoryHandle | null; projectKey: string }> {
  const sessionId = String(input?.sessionId ?? "").trim();
  const workspace = input?.workspace;
  const projectKey = projectKeyOf(workspace);
  const agent: MemorySourceAgent = {
    kind: input?.agent?.kind ?? "main",
    id: String(input?.agent?.id ?? (input?.agent?.kind === "main" ? "main" : "")),
    label: input?.agent?.label,
  };
  const common = { sessionId, projectKey, workspace, agent };
  return {
    session: sessionId ? createHandle({ ...common, scope: "session", ownerId: sessionId }) : null,
    project: projectKey ? createHandle({ ...common, scope: "project", ownerId: projectKey }) : null,
    projectKey,
  };
}

/**
 * 一次拼齐注入上下文：**L0–L7 层（既有 context）+ fabric 的 project 段 + session 段 + 兼容段**。
 * ⛔⛔ 主会话与被委派会话**必须都调这一个函数** —— 分两处拼装就会出现
 * "派出去的专家拿不到自己刚写的东西"这类只在部分路径复现的 bug。
 * @param options.contextBuilder 既有 L 层注入（L0–L7），⛔ 不传则只有 fabric 段
 */
export async function buildContext(options: {
  handles: { session: MemoryHandle | null; project: MemoryHandle | null };
  query?: string;
  contextBuilder?: () => Promise<{ text: string } | null>;
  /** 兼容上一轮的四类角色私有记忆（架构文档 §7：不删，读得到） */
  legacyRole?: RoleRef | null;
  /** ⛔ 兼容段需要工作区才能读（上一轮的 MEMORY.md 落在工作区里） */
  workspace?: string | undefined;
}): Promise<{ text: string; chars: number; counts: { project: number; session: number; legacy: number } }> {
  const parts: string[] = [];
  const counts = { project: 0, session: 0, legacy: 0 };

  const projectSection = await options.handles.project?.section(options.query);
  if (projectSection?.text) { parts.push(projectSection.text); counts.project = projectSection.entries; }

  const sessionSection = await options.handles.session?.section(options.query);
  if (sessionSection?.text) { parts.push(sessionSection.text); counts.session = sessionSection.entries; }

  /* 兼容段：上一轮的角色 MEMORY.md —— 排在 fabric 之后（新数据优先）。 */
  if (options.legacyRole) {
    const legacy = await readLegacyRole(options.workspace, options.legacyRole);
    if (legacy) { parts.push(legacy); counts.legacy = 1; }
  }

  const layer = await options.contextBuilder?.();
  if (layer?.text) parts.push(layer.text);

  const text = parts.join("\n\n");
  return { text, chars: text.length, counts };
}

async function readLegacyRole(workspace: string | undefined, ref: RoleRef): Promise<string> {
  const raw = (await readRoleMemory(workspace, ref)).trim();
  return raw ? `## 角色历史记忆（兼容段，来自上一版实现）\n${raw}` : "";
}

/* ── 生命周期 ───────────────────────────────────────────────────────────── */

/**
 * 会话被删 / 归档：清 `session → 角色` 索引（由 role-memory 的 forgetRoleSession 负责），
 * **并给该会话的条目打上 archivedAt**。
 * ⛔ 内容一律保留：会话删了不等于记忆该删（专家还在，下次派出继续用它积累的经验）。
 * @returns 归档了多少条
 */
export async function archiveSessionMemory(
  workspace: string | undefined,
  sessionId: string,
  archived: boolean,
): Promise<number> {
  const file = entriesFile(workspace, namespaceOf("session", sessionId));
  if (!file) return 0;
  const entries = await readJsonl<MemoryEntry>(file);
  if (!entries.length) return 0;
  let n = 0;
  const now = Date.now();
  for (const e of entries) {
    if (archived) {
      if (e.archivedAt == null) { e.archivedAt = now; e.updatedAt = now; n++; }
    } else if (e.archivedAt != null) {
      e.archivedAt = null; e.updatedAt = now; n++;
    }
  }
  if (n) await rewriteJsonl(file, entries);
  return n;
}

/**
 * 生命周期清扫（⛔ 必须接到启动路径上才有意义 —— `prune()` 从未被调用是既有教训）：
 * ① 会话记忆过保留期 → 归档（不删）
 * ② 单命名空间超量 → 裁剪
 * @returns 汇总
 */
export async function sweepFabric(workspace: string | undefined): Promise<{ archived: number; trimmed: number; namespaces: number }> {
  const root = fabricRoot(workspace);
  const out = { archived: 0, trimmed: 0, namespaces: 0 };
  if (!root) return out;
  let dirs: string[] = [];
  try { dirs = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return out; }
  const now = Date.now();
  for (const ns of dirs) {
    out.namespaces++;
    const file = path.join(root, ns, ENTRIES_FILE);
    if (ns.startsWith("session__")) {
      const entries = await readJsonl<MemoryEntry>(file);
      if (!entries.length) continue;
      let dirty = false;
      for (const e of entries) {
        if (e.archivedAt == null && now - e.createdAt > FABRIC_SESSION_RETENTION_DAYS * 86_400_000) {
          e.archivedAt = now; e.updatedAt = now; dirty = true; out.archived++;
        }
      }
      if (dirty) await rewriteJsonl(file, entries);
    }
    const entries2 = await readJsonl<MemoryEntry>(file);
    if (entries2.length > FABRIC_MAX_ENTRIES) {
      const kept = pruneEntries(entries2, FABRIC_MAX_ENTRIES);
      await rewriteJsonl(file, kept);
      out.trimmed += entries2.length - kept.length;
    }
  }
  return out;
}

/** 列出某工作区下所有命名空间的统计（给设置页 / 记忆中心用）。 */
export async function listNamespaces(workspace: string | undefined): Promise<{ namespace: string; scope: MemoryScope; entries: number; chars: number }[]> {
  const root = fabricRoot(workspace);
  if (!root) return [];
  let dirs: string[] = [];
  try { dirs = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return []; }
  const out: { namespace: string; scope: MemoryScope; entries: number; chars: number }[] = [];
  for (const ns of dirs) {
    const entries = await readJsonl<MemoryEntry>(path.join(root, ns, ENTRIES_FILE));
    if (!entries.length) continue;
    out.push({
      namespace: ns,
      scope: ns.startsWith("project__") ? "project" : "session",
      entries: entries.length,
      chars: entries.reduce((sum, e) => sum + e.content.length, 0),
    });
  }
  return out.sort((a, b) => b.entries - a.entries);
}

/**
 * 列出「有记忆可扫」的工作区集合 —— 启动清扫的输入。
 * ⛔ 来源 = 已知工作区（会话登记表里的 cwd）；**取不到就返回空**（宁可不清扫，
 *   也不能猜一个路径去遍历 —— 那等于对任意目录做读扫描）。
 * @param known 已登记的工作区（调用方给：threadCwd 的键 + 委托记录里的 workspace）
 */
export function pickWorkspacesToSweep(known: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const w of known) {
    const p = String(w ?? "").trim();
    if (!p) continue;
    /* ⛔ scratch 会话不落记忆（与 fabricRoot 同口径）⇒ 不必扫。 */
    if (isScratchWorkspace(p)) continue;
    out.add(p);
  }
  return [...out];
}
