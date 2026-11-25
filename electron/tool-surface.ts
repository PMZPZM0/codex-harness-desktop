/**
 * 工具面的**身份裁剪**（11-25 立；唯一写点 = 主进程写 rollout 首行之前）。
 *
 * ── 为什么需要这个模块（用户报「新会话里没有 agent_invoke」，三次同型）──────────
 * 引擎的工具面**只在 spawn 时定死**，来源是 rollout 首行的 `session_meta.dynamic_tools`
 * （resume / fork 传的 dynamicTools 引擎整份忽略）。所以「给一条会话配什么工具」这件事，
 * 本质是**按目标会话的类型算一次纯函数**，然后把结果写进它自己的首行。
 *
 * 旧实现的毛病是**算的时机和输入都不对**：渲染层用 `bag.threadRole`（= 当前显示的那条会话）
 * 决定要不要挂 `agent_invoke` / 群编排工具，而切会话 / 新建会话时那一时刻 state 还停在
 * **上一条会话**上 ⇒ 新会话被贴上旧会话的身份（普通会话缺派活工具、专家会话多出派活工具）。
 * 那不是加一个 await 能根治的：只要"身份"还由渲染层的可变状态决定，任何时序变化都会再犯。
 *
 * ── 现在的分工（⛔ 改之前先读这段）─────────────────────────────────────────
 *   · 渲染层：只提供**与身份无关**的能力面（图像 / 记忆 / 网关 / Laya / Craft / MCP / 影视…），
 *     ⛔ **不再按 caps 增删任何工具**（它不知道、也不该知道目标会话是谁）。
 *   · 主进程：在**唯一写点**（thread/start、thread/resume 写首行前）调用 `applyToolIdentity`，
 *     按目标会话的类型裁掉它没资格拥有的身份工具。派生会话（专家 / 团 / 工作伙伴 / 被调度）
 *     的工具面由各自域写，宿主不覆盖；但它们也得过同一张表（口径只有一份）。
 *   · 类型真相源只有 `src/lib/session-kind.mjs` 的 SESSION_CAPS —— 本模块不复制能力矩阵，
 *     只维护「工具名 → 它属于哪个能力位」这张对照表。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────
 *   ⛔ 这是**可见性**裁剪，不是权限闸：执行端（canDispatchFrom / restrictedThreadRole /
 *      dispatchKindAllowed）仍然是硬闸，两侧都要有。
 *   ⛔ 只登记「身份相关」的名字。图像四件套 / 记忆 / 定时任务 / 知识库是**网关能力**，
 *      对所有会话一致，别搬进来（搬进来就会变成第二份权限矩阵）。
 */

import { capabilitiesOf, normalizeSessionKind } from "../src/lib/session-kind.mjs";

/** 身份能力位（与 SESSION_CAPS 的键同名；⛔ 别新增这里没有的位）。 */
export type IdentityCap = "dispatch" | "bossGroup";

/**
 * 工具名 → 它属于哪个身份能力位。
 *
 * ⛔ 与渲染层清单的对应关系（守卫 11i 会逐条比对，改一边不改另一边就红）：
 *   · dispatch 三件套 —— `src/features/app-state/parts/part08/01-seg.tsx` 的 agent_invoke 段；
 *   · bossGroup 九个 —— `src/features/app-view/constants/05-boss-group-tools.tsx` 的 BOSS_GROUP_TOOLS。
 */
export const IDENTITY_TOOLS: Readonly<Record<string, IdentityCap>> = Object.freeze({
  /* 调度（caps.dispatch）：只有用户直接创建的主会话 / 中枢拥有 */
  agent_invoke: "dispatch",
  agent_archive_sessions: "dispatch",
  agent_list_children: "dispatch",
  /* 群编排（caps.bossGroup）：群主（中枢）与普通主会话拥有；派生会话一律没有 */
  group_create: "bossGroup",
  group_assign: "bossGroup",
  group_status: "bossGroup",
  group_review: "bossGroup",
  group_escalate: "bossGroup",
  group_add_member: "bossGroup",
  group_remove_member: "bossGroup",
  group_delete: "bossGroup",
  group_browser_setup: "bossGroup",
});

/** 取工具名：兼容 `{ name }` 与 `{ function: { name } }` 两种形态（与 tool-profiles 同口径）。 */
function toolNameOf(tool: unknown): string {
  const anyTool = tool as { name?: unknown; function?: { name?: unknown } };
  return String(anyTool?.name ?? anyTool?.function?.name ?? "");
}

/**
 * 把工具面拆成「身份类」与「其余」两半。
 *
 * ⛔⛔ 为什么必须拆：`tool-profiles` 的 CORE 画像（11-19 立的 schema 收窄）是**普通会话的
 * 通用能力画像**，它里面没有群编排九件套 ⇒ 直接拿它收窄会把**身份工具**一起裁掉，于是
 * 同一条会话「新建时没有群工具、resume 一次又回来了」—— 这正是用户说的「来回跳转就乱套」。
 * 身份工具的可见性只能由 `applyToolIdentity`（按会话类型）决定，**不许**再被通用收窄二次裁。
 *
 * @returns `identity` = 表里登记过的工具（顺序保持输入序）；`rest` = 其余（交给 CORE 收窄）
 */
export function splitIdentity<T>(tools: readonly T[]): { identity: T[]; rest: T[] } {
  const identity: T[] = [];
  const rest: T[] = [];
  for (const tool of tools ?? []) {
    if (IDENTITY_TOOLS[toolNameOf(tool)]) identity.push(tool);
    else rest.push(tool);
  }
  return { identity, rest };
}

/**
 * 按会话类型裁掉它没有资格拥有的身份工具（**纯函数**：不改入参、同输入同输出）。
 *
 * @param tools 候选工具面（渲染层给的与身份无关的能力面）
 * @param kind  目标会话类型（normal / hub / expertTeam / expert / workPartner / delegate）
 * @returns 新数组；未知类型按 normal 处理（与 `normalizeSessionKind` 同口径，不误禁）
 *
 * ⛔ 顺序无关、幂等：`apply(apply(x, k), k) === apply(x, k)`；
 *    与另一次调用的结果互不影响（每次返回新数组，绝不共享可变状态）。
 */
export function applyToolIdentity<T>(tools: readonly T[], kind: string): T[] {
  const caps = capabilitiesOf(normalizeSessionKind(kind)) as Record<string, unknown>;
  const out: T[] = [];
  for (const tool of tools ?? []) {
    const cap = IDENTITY_TOOLS[toolNameOf(tool)];
    if (!cap) { out.push(tool); continue; }
    if (caps[cap] === true) out.push(tool);
  }
  return out;
}

/** 某类会话**应当**拥有的身份工具名（守卫与诊断用；⛔ 不要拿它当执行判据）。 */
export function identityToolsOf(kind: string): string[] {
  const caps = capabilitiesOf(normalizeSessionKind(kind)) as Record<string, unknown>;
  return Object.keys(IDENTITY_TOOLS).filter((name) => caps[IDENTITY_TOOLS[name]] === true);
}
