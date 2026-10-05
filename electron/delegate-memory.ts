/**
 * delegate-memory —— 被委派会话的记忆注入（09-23 新增）。
 *
 * ── 为什么需要这个模块 ──────────────────────────────────────────────
 * 主会话的「常驻记忆 + 按需召回」是在**渲染层发送路径**拼进去的：
 *   src/features/app-state/parts/part08/02-seg/send.tsx
 *     → window.codex.readMemoryContext(workspace, workspaceMemoryEnabled)   // 常驻层
 *     → window.codex.recallMemory(messageText, workspace)                   // L3 按需召回
 * 而**子智能体 / 专家 / 专家团主理人 / 成员**的委派回合由**主进程**直接 `turn/start` 发起
 * （`features/delegation.ts` 的 runDelegatedTask、`features/teams-agents-ipc.ts` 的
 *   teams:member-session / teams:invoke-member）—— 完全不经过渲染层。
 * ⇒ 这些会话此前**读不到任何记忆**：不知道用户偏好、不知道项目背景、不知道踩过的坑与纪律。
 * （用户 09-23：「子智能体跟专家团都有没有记忆板块跟功能，没有就完善好」。）
 *
 * ── 三条硬约束（改动前先读，守卫【125】逐条钉死）────────────────────
 *  ① **标记必须与主会话逐字一致**：常驻层用 `memoryLayers.context()` 原样产出（自带
 *     `[Harness 常驻记忆 …]` / `[常驻记忆结束]`），召回层用
 *     `[Harness 相关记忆，仅供参考]` … `[记忆结束]`。显示侧（src/lib/user-refs、
 *     thread-backup、rollout-worker-source）按这些标记**整段剥离** —— 换标记会把机器块
 *     漏进用户气泡、侧栏标题与导出（守卫【100】【119】）。
 *  ② **绝不阻塞委派**：任何一步失败都降级为空串。委派本身比记忆重要，
 *     记忆读不到只是少一层上下文，抛出去就是整个调度失败。
 *  ③ **工作区必须显式解析，不许退到 `process.cwd()`**：那是**应用安装目录**。
 *     拿它当工作区会读到一份不存在的工作区记忆，且 `workspaceMemoryEnabled()` 还会
 *     返回 true（默认放行）⇒ 静默错误、最难查。取不到就只注入全局的 L0 用户档案。
 *
 * ── 门禁 ────────────────────────────────────────────────────────────
 * 沿用既有真相源，**不新增开关**：`workspaceMemoryEnabled(workspace)`。
 * 关掉时与主会话 `context(workspace, false)` 同口径 —— 仍注入 L0 用户档案，只是不含
 * 项目记忆 / 背景 / 纪律 / 日志，也不做 L3 召回。
 */
import { memoryLayers, memoryStore, threadCwd, workspaceMemoryEnabled } from "./main";
import { type RoleRef } from "./role-memory";
import { buildContext, getMemoryHandles, type MemorySourceAgent } from "./memory-fabric";

export type DelegateMemory = {
  /** 可直接追加到出站文本尾部的记忆段（空串 = 这次没拿到记忆） */
  text: string;
  chars: number;
  standingChars: number;
  recalledChars: number;
  /** 统一记忆段（10-05 架构改造）：项目共享段 + 本会话段 + 上一版角色记忆兼容段 */
  fabricSection: string;
  /** fabric 段里的条目数（三层：project 共享 / team 团内 / private 私有 + 兼容段） */
  fabricCounts: { project: number; private: number; team: number; legacy: number };
  /** 解析到的角色归属键（空 = 这次没有角色归属） */
  roleKey: string;
  /** 解析到的工作区（空 = 只注入了全局 L0 用户档案） */
  workspace: string;
  scope: "workspace" | "user-only";
};

/**
 * 委派会话的工作区：显式 cwd → 发起方会话的 cwd → 空。
 * ⛔ **不许**退到 `process.cwd()`（应用安装目录）——理由见文件头约束 ③。
 */
export function resolveDelegateWorkspace(input: { workspace?: string; originThreadId?: string }): string {
  const direct = String(input?.workspace ?? "").trim();
  if (direct) return direct;
  const origin = String(input?.originThreadId ?? "").trim();
  if (!origin) return "";
  const cwd = threadCwd.get(origin);
  return cwd ? String(cwd) : "";
}

/** 拼装委派会话的记忆段。失败一律降级为空串，绝不抛。 */
export async function buildDelegateMemory(input: {
  /** 显式工作区（通常是委派入参里的 cwd） */
  workspace?: string;
  /** 本次任务文本 —— 用于 L3 按需召回 */
  query?: string;
  /** 发起方会话 id —— 没显式 cwd 时用它反查工作区 */
  originThreadId?: string;
  /** 10-05 角色独立记忆：被委派者的角色归属（子智能体 / 专家 / 团主 / 团成员） */
  role?: RoleRef;
  /** ⛔ 被委派会话自己的 threadId（建会话后才有 ⇒ 可空）。为空时用发起方会话 id 当 session 归属。 */
  threadId?: string;
}): Promise<DelegateMemory> {
  const workspace = resolveDelegateWorkspace({ workspace: input?.workspace, originThreadId: input?.originThreadId });
  /* ⛔ 被委派会话自己的 threadId（建会话后才有 ⇒ 可空）。为空时退回发起方会话 id ——
     委派是**建会话之前**拼注入文本的，那时还没有它。这不影响隔离：
     它写会话记忆时用的是自己的真实 threadId（见 memory-fabric-tool 的句柄构造）。 */
  const delegateThreadId = String(input?.threadId ?? input?.originThreadId ?? "").trim();
  const includeWorkspace = workspace ? await workspaceMemoryEnabled(workspace).catch(() => false) : false;

  let standingChars = 0;
  let recalledChars = 0;
  let body = "";

  /* 常驻层：L0 用户档案 + L1 项目记忆 + L1.5 纪律 + L2 近期日志。
     与主会话同口径：即使工作区记忆关掉，也要拿到 L0（用户偏好不该因为关项目记忆就丢）。 */
  try {
    const standing = await memoryLayers.context(workspace || undefined, includeWorkspace);
    if (standing?.text) {
      body += standing.text;
      standingChars = standing.text.length;
    }
  } catch {
    /* 记忆读取失败不阻塞委派 */
  }

  /* ⛔⛔ 统一记忆段（10-05 架构改造）：**和主会话走同一个 buildContext**。
     分两处拼装就会出现"派出去的专家拿不到自己刚写的东西"这类只在部分路径复现的 bug。
     · project 段 = 全项目共享（主会话写的事实，角色读得到）
     · session 段 = 这个委派会话自己的（threadId 命名空间 ⇒ 与别的会话硬隔离）
     · legacy 段 = 上一轮 roles/<键>/MEMORY.md（架构文档 §7：不删，读得到）
     ⛔ 放在常驻层之后、召回之前：身份/项目段最靠近当前任务。 */
  let fabricSection = "";
  let fabricCounts = { project: 0, private: 0, team: 0, legacy: 0 };
  let roleKey = "";
  try {
    const agent = agentOf(input?.role);
    const handles = await getMemoryHandles({ sessionId: delegateThreadId, workspace: workspace || undefined, agent });
    const built = await buildContext({ handles, query: input?.query, legacyRole: input?.role ?? null, workspace: workspace || undefined });
    if (built.text) { fabricSection = built.text; body += `\n\n${built.text}`; }
    fabricCounts = built.counts;
    roleKey = roleKeyOf(input?.role);
  } catch {
    /* 统一记忆读不到不影响委派（与上面两层同纪律） */
  }

  /* L3 按需召回：只在工作区记忆开启时做（与 send.tsx 的 if (bag.workspaceMemoryEnabled) 一致）。 */
  const query = String(input?.query ?? "").trim();
  if (includeWorkspace && query) {
    try {
      const recalled = await memoryStore.recall(query, { workspace });
      if (recalled?.context) {
        const block = `\n\n[Harness 相关记忆，仅供参考]\n${recalled.context}\n[记忆结束]\n`;
        body += block;
        recalledChars = block.length;
      }
    } catch {
      /* 同上 */
    }
  }

  return {
    text: body,
    chars: body.length,
    standingChars,
    recalledChars,
    fabricSection,
    fabricCounts,
    roleKey,
    workspace,
    scope: includeWorkspace ? "workspace" : "user-only",
  };
}

/* ── 统一记忆：角色 → 写入者身份 / 归属键 ───────────────────────────────── */

/**
 * 角色归属 → 写入者身份（⛔ 与 `memory-fabric-tool` 的 `agentOfRoleRef` 同口径，
 * 但这里不能 import 它 —— 那个文件经 delegation 依赖本模块，会成环。
 * ⇒ 两处由守卫 11l 钉住 kind 映射一致，漂了会红）。
 */
function agentOf(role: RoleRef | undefined): MemorySourceAgent {
  if (!role) return { kind: "main", id: "main", label: "主会话" };
  const kind = role.kind === "subagent" ? "subagent"
    : role.kind === "expert" ? "expert"
    : role.kind === "team-lead" ? "team-lead" : "team-member";
  return { kind, id: role.memberId ? `${role.id}/${role.memberId}` : role.id, label: role.label };
}

/** 兼容段用的归属键（空串 = 无角色归属）。⛔ 分隔符不能是 `:`（Windows 非法文件名字符）。 */
function roleKeyOf(role: RoleRef | undefined): string {
  if (!role) return "";
  const safe = (s: string) => String(s).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 64);
  return role.kind === "team-member" && role.memberId
    ? `${safe(role.kind)}__${safe(role.id)}__${safe(String(role.memberId))}`
    : `${safe(role.kind)}__${safe(role.id)}`;
}
