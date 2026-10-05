/**
 * memory-fabric-tool —— **统一记忆写入面**（10-05 架构改造，配套 `memory-fabric.ts`）。
 *
 * 改造前有**两个**写入工具（`memory_save` 主会话专用 / `role_memory_save` 角色专用），
 * 模型必须自己判断"这次该用哪个" —— 那是"两套同名能力"的变体（项目已踩过：
 * `agent_invoke` vs `subagent_invoke` 并存 ⇒ 模型只用名字最直白的那个 ⇒
 * 专家/专家团被绕过）。⇒ 现在**只有一个** `memory_write`。
 *
 * ⛔⛔ **必须在主进程应答**（`boot.ts` 的 `handleFabricToolCall`，排在 `filterForRenderer` **之前**）：
 *   被委派会话不在渲染层"正在看着"的列表里 ⇒ 它的 `item/tool/call` 会被裁掉 ⇒
 *   渲染层收不到、不会应答，工具调用会挂到超时。
 *
 * ⛔ 身份闸：只用引擎下发的 `params.threadId` 反查会话归属，
 *   **绝不用 args 任何字段当身份**（= 让模型自报家门）。
 */
import type { RoleRef } from "./role-memory";
import {
  getMemoryHandles,
  type MemoryAgentKind,
  type MemoryCategory,
  type MemorySourceAgent,
  type MemoryScope,
} from "./memory-fabric";

/** ⛔ 唯一的写入工具名。旧名（`memory_save` / `role_memory_save`）只作别名，见 `ALIASES`。 */
export const FABRIC_WRITE_TOOL = "memory_write";

/** 旧工具名 → 新名（⛔ 保留一个别名期：老会话里模型记着旧名，调不到会以为坏了）。 */
export const FABRIC_WRITE_ALIASES = ["memory_save", "role_memory_save"] as const;

export function isFabricWriteTool(name: unknown): boolean {
  const n = String(name ?? "");
  return n === FABRIC_WRITE_TOOL || (FABRIC_WRITE_ALIASES as readonly string[]).includes(n);
}

const CATEGORIES: MemoryCategory[] = ["用户偏好", "项目背景", "工作流/SOP", "任务经验", "临时上下文"];

/* ── 三个作用域（10-05 用户定稿「私有 + 团内共享 + 项目共享」）──────────────
   ⛔ 单一真相源：内核的 `MemoryScope`、这里的白名单、UI 的分区表都指这一组值。
   ⛔ 白名单⛔不用三元硬编：上一版写死 `=== "project" ? "project" : "session"`，
      加第三层时它会把 team 静默归成 session ⇒ 记忆落错层还不报错。 */
const SCOPES: MemoryScope[] = ["private", "team", "project"];

/** 写入成功后回给模型的话（⛔ 明确说"谁能看到"，否则它无法判断要不要写共享层）。 */
const SCOPE_ECHO: Record<MemoryScope, string> = {
  private: "私有记忆（只有你自己读得到）",
  team: "团内记忆（同团成员共享）",
  project: "项目记忆（全体共享）",
};

/** 拿不到句柄时给模型看的**可执行**理由（⛔ 别只说"失败"，它要能转达给用户）。 */
const SCOPE_DENY_TEXT: Record<MemoryScope, string> = {
  private: "拿不到私有记忆句柄（这个会话没有可归属的 id）",
  team: "你不在任何专家团里，没有团内记忆可写 —— 如果这段经验属于某个团，请让用户指定。",
  project: "拿不到项目记忆句柄（这个会话没有工作区？）",
};

/** 给模型看的三层说明（⛔ 措辞与 UI 保持一致：两边说法不同会让人怀疑"到底谁能看到"）。 */
const SCOPE_HINTS: Record<MemoryScope, string> = {
  private: "private（默认）= 只有你自己读得到，别人的事你看不到，也没人看得到你的",
  team: "team = 同一个专家团内的成员互通，团外读不到",
  project: "project = 全体会话与智能体共享 —— ⛔ 写它需要先征得用户同意",
};

/** 写入工具定义（注册给需要写记忆的会话）。 */
export function buildFabricWriteTool(agent: MemorySourceAgent): unknown {
  const isRole = agent.kind !== "main" && agent.kind !== "system";
  return {
    type: "function",
    name: FABRIC_WRITE_TOOL,
    description: [
      "保存一条记忆。三种作用域：",
      "· private（默认）= 只有**你自己**读得到 —— 适合记「这次任务的中间结论」。",
      "· team = **同一个专家团内**的成员互通，团外读不到。",
      "· project = **全体**会话与智能体都能读到 —— 适合记可复用的事实与经验。",
      isRole
        ? "⛔ 你是被派出来干活的：写 team/project 属于**共享**（团内 / 全体），需要先征得用户同意 —— 请先问用户「这段经验值得让其他会话都记住吗？」，用户同意后带 promote=true 重写。"
        : "⛔ 写 project 前先想清楚：这是所有会话都会读到的公共知识，别把一次性的中间结论写进去。",
      "分类沿用既有五类，别自造。相同内容会自动去重。",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["private", "team", "project"], description: `记忆作用域：${SCOPE_HINTS.private}；${SCOPE_HINTS.team}；${SCOPE_HINTS.project}` },
        category: { type: "string", enum: CATEGORIES, description: "分类" },
        content: { type: "string", description: "记忆正文（要精炼，单条上限 2000 字）" },
        weight: { type: "number", description: "重要性 0..1（省略则按分类取默认：工作流/SOP 最高、临时上下文最低）" },
        pinned: { type: "boolean", description: "钉住：蒸馏与裁剪时永不删除" },
        promote: { type: "boolean", description: "scope=team 或 project 且你是被派出的角色时，必须在**征得用户同意后**置 true" },
      },
      required: ["content"],
    },
  };
}

/** 把一次委派目标解析成写入面用的身份（⛔ 与 role-memory 的四类 kind 一一对应）。 */
export function agentOfRoleRef(ref: RoleRef): MemorySourceAgent {
  const kindMap: Record<RoleRef["kind"], MemoryAgentKind> = {
    subagent: "subagent",
    expert: "expert",
    "team-lead": "team-lead",
    "team-member": "team-member",
  };
  return { kind: kindMap[ref.kind] ?? "subagent", id: ref.memberId ? `${ref.id}/${ref.memberId}` : ref.id, label: ref.label };
}

/** 主会话身份（⛔ 稳定 id 就是 "main"，显示名不入键）。 */
export const MAIN_AGENT: MemorySourceAgent = { kind: "main", id: "main", label: "主会话" };

/**
 * 主进程应答一次写入调用。
 * @param input.args 模型给的参数
 * @param ctx.threadId **引擎下发**的会话 id（⛔ 唯一的身份来源，不信 args）
 * @param ctx.workspace 该会话的工作区（委派时由 delegation 给出）
 * @param ctx.agent 该会话的角色身份（主会话传 MAIN_AGENT）
 */
export async function handleFabricWrite(input: {
  args: Record<string, unknown>;
  threadId: string;
  workspace: string | undefined;
  agent: MemorySourceAgent;
  /** 专家团 id：给了才有 team 层（⛔ 非团成员不该写团内记忆）。 */
  teamId?: string;
  /** ⛔ 被委派实例的调度作用域（10-05「被调度实例按调度作用域隔离」）。 */
  dispatch?: { originThreadId: string; depth: number; teamId?: string } | null;
}): Promise<{ ok: boolean; text: string }> {
  const args = input.args ?? {};
  /* ⛔ scope 走**白名单**（三层：private/team/project），⛔ 不用三元硬编 ——
     上一版写死 `=== "project" ? "project" : "session"`，加第三层时静默把 team 归成 session。
     ⛔ 未知值退回 private（最窄的那层）：宁可记忆进不去，也不能越权落到共享层。 */
  const rawScope = String(args.scope ?? "");
  const scope: MemoryScope = (SCOPES as string[]).includes(rawScope) ? (rawScope as MemoryScope) : "private";
  const content = String(args.content ?? "").trim();
  if (!content) return { ok: false, text: "记忆内容为空 —— 请写具体一点（要记的是事实或结论，不是「已完成」这种空话）。" };
  /* ⛔ 分类**必须**是五个已知值之一：模型可能自造词，而分类决定默认权重
     （`CATEGORY_WEIGHT[category] ?? 0.5`）与注入分组。自造分类会让这条记忆
     落在错误的权重档上 ⇒ 裁剪时先被淘汰。⛔ 非法值退回"临时上下文"（最低档），
     并在回话里说明，不静默接受。 */
  const rawCategory = String(args.category ?? "");
  const category = (CATEGORIES as string[]).includes(rawCategory) ? (rawCategory as MemoryCategory) : "临时上下文";

  const handles = await getMemoryHandles({
    sessionId: input.threadId,
    workspace: input.workspace,
    agent: input.agent,
    teamId: input.teamId,
    dispatch: input.dispatch ?? null,
  });
  const handle = handles[scope];
  if (!handle) {
    return { ok: false, text: SCOPE_DENY_TEXT[scope] ?? "拿不到该作用域的记忆句柄" };
  }

  const result = await handle.write({
    content,
    scope,
    category,
    weight: typeof args.weight === "number" ? args.weight : undefined,
    pinned: args.pinned === true,
    promote: args.promote === true,
  });
  if (!result.written) return { ok: false, text: String(result.reason ?? "写入失败") };

  const where = SCOPE_ECHO[scope] ?? "私有记忆";
  const catNote = rawCategory && rawCategory !== category ? `（分类「${rawCategory}」不在五类里，已按「临时上下文」记）` : "";
  return { ok: true, text: `已记入${where}：${content.slice(0, 60)}${content.length > 60 ? "…" : ""}${catNote}` };
}
