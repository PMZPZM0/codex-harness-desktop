/**
 * memory-ui —— **跨进程边界归一化层**（10-05 修 `.archive.files` 崩溃）。
 *
 * ── 为什么必须有这一层 ────────────────────────────────────────────────
 * 10-05 上午那版 `types.ts` 是**照着"理想形状"手写的**，没有对着主进程
 * handler 的真实返回体核对 ⇒ 三个视图各错一处：
 *
 *   ① 金字塔   前端读 `data.archive.files`
 *              ⇒ `MemoryLayersSnapshot` **根本没有 archive 字段**（它在
 *                `memory:hygiene:plan` 的返回体里）⇒ 点开金字塔即白屏。
 *   ② MCP 后端  前端读 `data.active / connector / ready / sinkLabel`
 *              ⇒ `MemoryBackendStatus` 的字段叫 `effective / installed /
 *                serverPath / fallbackReason`，**四个字段一个都不存在**
 *                ⇒ 界面永远显示"内置生效"，即使用户真开着 MCP（说谎）。
 *   ③ 被调度   前端把返回值当数组
 *              ⇒ `agents:delegated` 返回 `{ records: [...] }`（**包一层**）
 *                ⇒ `items.filter` 必崩。
 *
 * ⛔⛔ 教训（比这三个 bug 本身重要）：**当时的守卫 56/56、变异测试 12/12 全绿**。
 *    绿的原因是它们只断言「视图 ↔ types.ts」自洽 —— 两边都是同一个人按同一份
 *    想象写的，**没有任何一条断言跨进程边界**。⇒ 假绿的教科书案例。
 *    本文件存在的意义就是把那条边界**变成代码**，让"字段对不上"变成可测的事实。
 *
 * ── 铁律 ────────────────────────────────────────────────────────────
 * ① **归一化是唯一允许接触 IPC 原始返回体的地方**，视图只看归一化后的契约。
 * ② 每个字段都必须有兜底：⛔ 宁可显示"未知"，⛔ 也不许让 `undefined.x` 逃出去
 *    （一次字段改名就会让整个板块白屏，用户看到的只有"界面发生错误"）。
 * ③ 归一化函数**必须纯**（无 IPC、无 Date.now 依赖外部时点）⇒ 守卫能直接真跑它。
 */

/* ── 通用兜底工具：⛔ 所有取值都必须经过它们 ────────────────────────── */

type Rec = Record<string, any>;

/** 断言成对象：⛔ 数组/null/undefined 一律降级成 `{}`（`{}.x` 是 undefined 而不是抛错） */
function obj(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

/** 断言成数组：⛔ 非数组一律降级成 `[]`（这是 `items.filter` 崩溃的根治点） */
function arr(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

/** 取字符串，⛔ 非字符串/空值统一降级成兜底串（⛔ 不返回 undefined） */
function str(v: unknown, fallback = ""): string {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() ? s : fallback;
}

/** 取有限数字；⛔ NaN/Infinity/null 一律降级成 fallback（⛔ 不返回 NaN —— 它会渲染成 "NaN"） */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 取布尔 */
function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** 可选时间戳：⛔ 语义上"没有"就是 null（⛔ 不是 0 —— 0 会被 `!= null` 判成有值） */
function ts(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ══ ① 金字塔：MemoryLayersSnapshot ⇒ PyramidMemory ═══════════════════
 * 真实来源：`memory:layers:read` → `memoryLayers.snapshot()` + `entries`
 * ⛔ archive 不在这个返回体里（它只在 hygiene:plan 里）⇒ 由调用方用
 *   `memory:hygiene:plan` 补进来，本函数只负责"没给就归零"。
 */

export function normalizePyramid(raw: unknown, archive?: { files?: unknown; bytes?: unknown } | null): import("./types").PyramidMemory {
  const r = obj(raw);
  const layers = arr(r.layers).map((l: unknown) => {
    const x = obj(l);
    const budget = num(x.budget, 0);
    const ratio = x.ratio == null ? null : num(x.ratio, 0);
    return {
      id: str(x.id, "L?"),
      name: str(x.name, "未命名层"),
      where: str(x.where, "未标注"),
      writer: str(x.writer, "未标注"),
      sink: str(x.sink, "未标注"),
      budget,
      used: num(x.used, 0),
      ratio,
      needDistill: bool(x.needDistill, false),
    };
  });
  return {
    kind: "pyramid",
    /* ⛔ 主进程 snapshot **没有 id 字段** ⇒ 别用 `str(r.id, ...)` 假装有：
       那样会恒为兜底值，看起来"正常"实际是假数据。金字塔是**每工作区一份**，
       用 projectDir（真存在且稳定）当标识才有意义。 */
    id: str(obj(r.paths).projectDir, "pyramid"),
    createdAt: num(r.createdAt, 0),
    updatedAt: num(r.updatedAt, 0),
    layers,
    archive: {
      files: num(obj(archive).files, 0),
      bytes: num(obj(archive).bytes, 0),
    },
  };
}

/* ══ ② 本地 MCP 后端：MemoryBackendStatus ⇒ McpBackendMemory ══════════
 * ⛔⛔ 字段名映射是本文件最容易写错的地方（四个名字全不一样）：
 *   active     ← effective  （**实际生效**的，不是用户选的 backend）
 *   ready      ← installed  （服务入口文件是否存在）
 *   connector  ← 常量 "local-memory"（⛔ 返回体里没有连接器名，见下）
 *   sinkLabel  ← 由 effective 推导的一句话
 */

export const LOCAL_MEMORY_CONNECTOR = "local-memory";

export function normalizeMcpBackend(raw: unknown): import("./types").McpBackendMemory {
  const r = obj(raw);
  /* ⛔ 用 effective 而不是 backend：用户选了 MCP 但服务没装时会回退内置，
     这时界面必须显示"内置生效"，否则就是在骗用户（09-25 定的口径）。 */
  const effective = str(r.effective, "builtin") === "mcp" ? "mcp" : "builtin";
  const installed = bool(r.installed, false);
  return {
    kind: "mcp-backend",
    id: str(r.backend, effective),
    createdAt: 0,
    updatedAt: 0,
    active: effective,
    connector: LOCAL_MEMORY_CONNECTOR,
    ready: installed,
    sinkLabel: effective === "mcp"
      ? "MCP 记忆服务（独立数据库，不写金字塔文件）"
      : "内置记忆金字塔（<项目>/.codex-harness/memory/）",
    /* ⛔ 回退原因必须透出：这是用户唯一能知道"我明明开了 MCP 为什么没生效"的线索 */
    fallbackReason: str(r.fallbackReason, "") || null,
    installCommand: str(r.installCommand, ""),
  };
}

/* ══ ③④⑤ 私有/团内/项目 记忆条目：MemoryEntry ⇒ 前端契约 ══════════════
 * ⛔ sourceAgent 是**嵌套对象**：主进程老数据/手写数据可能缺它 ⇒ 兜底成
 *   `{kind:"unknown", id:""}`，⛔ 绝不返回 undefined（`entry.sourceAgent.label`
 *   是一处必崩点 —— 与 `.archive` 同型的错误，只是排在后面）。
 */

export function normalizeEntry(raw: unknown): import("./types").MemoryEntry {
  const r = obj(raw);
  const agent = obj(r.sourceAgent);
  const scopeRaw = str(r.scope, "private");
  const scope: import("./types").MemoryEntry["scope"] =
    scopeRaw === "team" || scopeRaw === "project" ? scopeRaw : "private";
  return {
    id: str(r.id, "entry-" + Math.random().toString(36).slice(2, 8)),
    content: str(r.content, ""),
    scope,
    sessionId: str(r.sessionId, "") || null,
    projectKey: str(r.projectKey, ""),
    sourceAgent: {
      kind: str(agent.kind, "unknown"),
      id: str(agent.id, ""),
      label: str(agent.label, "") || undefined,
    },
    category: str(r.category, "未分类"),
    weight: Math.max(0, Math.min(1, num(r.weight, 0.5))),
    pinned: bool(r.pinned, false),
    createdAt: num(r.createdAt, 0),
    updatedAt: num(r.updatedAt, 0),
    lastUsedAt: ts(r.lastUsedAt),
    useCount: num(r.useCount, 0),
    archivedAt: ts(r.archivedAt),
  };
}

export function normalizeEntries(raw: unknown): import("./types").MemoryEntry[] {
  return arr(raw).map(normalizeEntry);
}

/* ══ ⑥ 专家团成员 / ⑦ 被调度会话 ══════════════════════════════════════ */

/** 命名空间 → 归属键（⛔ 单一真相源：三种作用域的判别只有这一处做） */
export function parseNamespace(ns: unknown): { scope: "private" | "team" | "project"; owner: string } {
  const name = str(ns, "");
  if (name.startsWith("team__")) return { scope: "team", owner: name.slice("team__".length) };
  if (name.startsWith("project__")) return { scope: "project", owner: name.slice("project__".length) };
  if (name.startsWith("private__")) return { scope: "private", owner: name.slice("private__".length) };
  /* ⛔ 不认识的前缀 ⛔ 不猜归属：按 private 处理但 owner 留空 ⇒ 上层会标成"未归属" */
  return { scope: "private", owner: "" };
}

/** 成员卡（⛔ 显式写形状 ⛔ 不写 `ActorMemory["members"]`：那个是可选字段，
 *  拿它当返回类型会让数组被推成 `(T|undefined)[]`，赋值处直接报错） */
export type MemberCard = { id: string; name: string; profession?: string; running: boolean };

/** ExpertTeamConfig.members ⇒ 前端成员卡（⛔ profession 是 {zh,en} 对象，⛔ 不是字符串） */
export function normalizeMember(raw: unknown, running: boolean): MemberCard {
  const m = obj(raw);
  const profession = str(obj(m.profession).zh, "");
  return {
    id: str(m.id, "?"),
    name: str(m.name, "未命名成员"),
    ...(profession ? { profession } : {}),
    running: bool(running, false),
  };
}

/**
 * 委托登记表 ⇒ 被调度会话。
 * ⛔⛔ 真实返回体是 `{ records: [...] }`（**包一层**）—— 直接把返回值当数组
 *   用会在 `items.filter` 处必崩。同时 `kind` 要改名成 `dispatchKind`
 *   （⛔ 不改后端字段名：那张表还被侧栏/办公室多处消费）。
 */
export function normalizeDelegates(raw: unknown, memoryCountOf?: (threadId: string) => number): import("./types").DispatchedSession[] {
  /* ⛔ 两种形态都吃：包一层的 {records} 与裸数组（历史/未来形态都不断） */
  const list = Array.isArray(raw) ? raw : arr(obj(raw).records);
  return list.map((d: unknown) => {
    const r = obj(d);
    const statusRaw = str(r.status, "done");
    return {
      kind: "dispatched",
      threadId: str(r.threadId, ""),
      originThreadId: str(r.originThreadId, ""),
      dispatchKind: str(r.kind, "unknown"),
      name: str(r.name, "未命名任务"),
      depth: Math.max(1, num(r.depth, 1)),
      status: statusRaw === "running" || statusRaw === "failed" ? statusRaw : "done",
      startedAt: num(r.startedAt, 0),
      endedAt: ts(r.endedAt) ?? undefined,
      archived: bool(r.archived, false),
      error: str(r.error, "") || undefined,
      output: str(r.output, "") || undefined,
      /* ⛔ 登记表里没有"它自己的记忆条数"（那是 fabric 的事）⇒ 由调用方按命名空间查，⛔ 查不到就 0 */
      memoryCount: num(memoryCountOf?.(str(r.threadId, "")), 0),
    };
  });
}

/* ══ 组装：一个执行体的统计（⛔ 视图不重复算） ═════════════════════════ */

export function statOf(entries: import("./types").MemoryEntry[]): import("./types").ActorMemory["stats"] {
  const list = arr(entries);
  return {
    total: list.length,
    pinned: list.filter((e) => bool(e?.pinned)).length,
    archived: list.filter((e) => ts(e?.archivedAt) != null).length,
    chars: list.reduce((sum, e) => sum + str(e?.content, "").length, 0),
  };
}