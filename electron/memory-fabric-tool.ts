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

/** 写入工具定义（注册给需要写记忆的会话）。 */
export function buildFabricWriteTool(agent: MemorySourceAgent): unknown {
  const isRole = agent.kind !== "main" && agent.kind !== "system";
  return {
    type: "function",
    name: FABRIC_WRITE_TOOL,
    description: [
      "保存一条记忆。三种作用域：",
      "· session（默认）= 只属于**本会话**的私事，别的会话看不到 —— 适合记「这次任务的中间结论」。",
      "· project = **全项目共享**，所有会话与智能体都能读到 —— 适合记可复用的事实与经验。",
      isRole
        ? "⛔ 你是被派出来干活的：写 project 属于**全局共享**，需要先征得用户同意 —— 请先问用户「这段经验值得让所有会话都记住吗？」，用户同意后带 promote=true 重写。"
        : "⛔ 写 project 前先想清楚：这是所有会话都会读到的公共知识，别把一次性的中间结论写进去。",
      "分类沿用既有五类，别自造。相同内容会自动去重。",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["session", "project"], description: "记忆作用域：session=本会话私有（默认），project=全项目共享" },
        category: { type: "string", enum: CATEGORIES, description: "分类" },
        content: { type: "string", description: "记忆正文（要精炼，单条上限 2000 字）" },
        weight: { type: "number", description: "重要性 0..1（省略则按分类取默认：工作流/SOP 最高、临时上下文最低）" },
        pinned: { type: "boolean", description: "钉住：蒸馏与裁剪时永不删除" },
        promote: { type: "boolean", description: "scope=project 且你是被派出的角色时，必须在**征得用户同意后**置 true" },
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
}): Promise<{ ok: boolean; text: string }> {
  const args = input.args ?? {};
  const scope: MemoryScope = args.scope === "project" ? "project" : "session";
  const content = String(args.content ?? "").trim();
  if (!content) return { ok: false, text: "记忆内容为空 —— 请写具体一点（要记的是事实或结论，不是「已完成」这种空话）。" };
  /* ⛔ 分类**必须**是五个已知值之一：模型可能自造词，而分类决定默认权重
     （`CATEGORY_WEIGHT[category] ?? 0.5`）与注入分组。自造分类会让这条记忆
     落在错误的权重档上 ⇒ 裁剪时先被淘汰。⛔ 非法值退回"临时上下文"（最低档），
     并在回话里说明，不静默接受。 */
  const rawCategory = String(args.category ?? "");
  const category = (CATEGORIES as string[]).includes(rawCategory) ? (rawCategory as MemoryCategory) : "临时上下文";

  const { session, project } = await getMemoryHandles({
    sessionId: input.threadId,
    workspace: input.workspace,
    agent: input.agent,
  });
  const handle = scope === "project" ? project : session;
  if (!handle) {
    return { ok: false, text: scope === "project" ? "拿不到项目记忆句柄（这个会话没有工作区？）" : "拿不到会话记忆句柄" };
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

  const where = scope === "project" ? "项目记忆（所有会话共享）" : "本会话记忆（仅本会话可见）";
  const catNote = rawCategory && rawCategory !== category ? `（分类「${rawCategory}」不在五类里，已按「临时上下文」记）` : "";
  return { ok: true, text: `已记入${where}：${content.slice(0, 60)}${content.length > 60 ? "…" : ""}${catNote}` };
}
