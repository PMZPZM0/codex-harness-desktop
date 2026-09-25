/**
 * electron/dispatch.ts —— 「Codex 调度其他智能体干活」的核心判定与文案（纯函数）。
 *
 * 09-15 起：Codex 在任意会话里都能调度 单专家 / 专家团 / 子智能体 干活。
 * 本文件只做**纯判定与文案**（不碰 server / IPC），因此可以被离线预检 require 编译产物直接断言
 * —— 四层防护里有三层的判定都在这里：
 *
 *   L1 提示词 —— 给被委派会话下发的会话级持久指令（直接干活、不要转派）
 *   L3 硬闸   —— 发起方本身是委派会话 → 一律拒绝（注册侧防不住的地方由它兜底）
 *   L4 总量闸 —— 并发上限 / 调用链深度上限 / 输出截断
 *
 * ⛔ 为什么 L3 必须存在：渲染层的工具注册是「所有会话无条件展开」的模式，一旦委派工具也走那条路，
 *    被委派的会话同样会拿到它 → 专家调专家调专家。提示词（L1）只能降低概率，拦不住「它真调了」。
 */

import type { DispatchConfig } from "./thread-runtime-store";

export type DispatchKind = "expert" | "team" | "member" | "subagent";

/** 一个「可被调度的对象」——目录项的统一定形（专家/团队成员/子智能体都是它） */
export type DispatchTarget = {
  kind: DispatchKind;
  /** 唯一键：expert = teamId（单人专家也是一支团队）；member = `${teamId}:${memberId}`；subagent = id */
  key: string;
  name: string;
  /** 单人专家/团队成员的职业头衔；子智能体退化为空串 */
  profession: string;
  description: string;
  teamId?: string;
  memberId?: string;
};

/* ─────────────── L1：被委派会话的持久指令 ─────────────── */

export const DELEGATE_HEADING = "调度约束（会话级·权威）";

/**
 * 给**被委派会话**下发的约束块。措辞刻意只禁「转派人员」，不禁正常工具
 * （洞明要读文件、主理人要用调度工具管本团成员）—— 禁宽了会把它的本职能力一起废掉。
 */
export function delegateScopeBlock(input: { kind: DispatchKind; name: string; origin?: string }): string {
  const name = String(input?.name ?? "").trim() || "（未命名）";
  const origin = String(input?.origin ?? "").trim();
  const head = [
    DELEGATE_HEADING,
    `- 你的身份：被**委派**执行本次任务的角色「${name}」`,
    origin ? `- 发起方会话：${origin}` : "",
    `- 你已进入**执行态**：本轮的目标是把事情做完并回传结论。`,
  ].filter(Boolean);

  const rule = (() => {
    switch (input?.kind) {
      case "team":
        return "你只能调度**本团队的成员**（用 team_member_invoke）；不要调用其他专家团，也不要调用子智能体。";
      case "member":
        return "直接干活，不要委派给任何人（你不是调度方）。";
      default:
        return "直接干活产出结论；**不要调用其他专家、专家团或子智能体**。";
    }
  })();

  return [
    ...head,
    "",
    `⛔ **${rule}**`,
    "信息不足时，在产出里写清「缺什么、需要谁提供」，由发起方决定后续 —— 不要自己转派。",
    "你的最终回答文本会被完整回传给发起方，无需调用任何回传工具。",
  ].join("\n");
}

/* ─────────────── L3：执行侧硬闸 ─────────────── */

/** 调用链深度上限：1 = 只允许「用户直连会话 → 被委派会话」一跳，被委派者不能再往下派。 */
export const MAX_DEPTH = 1;

/**
 * 这个会话能不能**发起**调度？（L3 硬闸，执行侧最后一道）
 * @param input.isDelegated 发起方会话本身是不是「被委派产生的会话」
 * @param input.depth 发起方处在调用链的第几层（用户直连会话 = 0）
 */
export function canDispatchFrom(input: { isDelegated?: boolean; depth?: number; holdsLock?: boolean; restricted?: boolean; restrictedLabel?: string }): { ok: boolean; reason?: string } {
  const depth = Number.isFinite(Number(input?.depth)) ? Number(input?.depth) : 0;
  // 身份闸（09-16 用户要求）：专家会话 / 专家团会话（含成员会话）**一律不允许对外调度**。
  // 理由：它们有自己的团内协作通道（team_member_invoke，不受此处限制）；对外再派人会
  // 让「谁在干活」失控。UI 上这些会话的调度开关直接禁用（灰掉），这里是硬闸兜底。
  if (input?.restricted) {
    return {
      ok: false,
      reason:
        `本会话是**${input.restrictedLabel || "专家 / 专家团"}会话**，不允许对外调度人员。` +
        "请直接在本会话把活干完；专家团需要成员协作用团内的调度工具（那套不受此限制），" +
        "确需外部协作的部分写进产出，由发起方决定。",
    };
  }
  if (input?.isDelegated || depth >= MAX_DEPTH) {
    return {
      ok: false,
      reason:
        "本次调用来自一个**被委派的会话** —— 委派会话不允许再向下委派（防套娃）。" +
        "请直接在当前会话把活干完；确实需要他人协作的部分，在产出里说明清楚，由发起方决定。",
    };
  }
  // 独占锁（09-16 用户要求「同一时间只能一个会话开调度，避免同时调用」）：
  // 只有**当前持有者**的调用才作数。会话被别的会话接管、或开关被关掉之后，
  // 残留的工具面/在途调用一律不认 —— 这是发出去之后唯一还能刹住的地方。
  // ⚠️ 只在显式给 false 时拦（undefined = 老调用点没传，保持向后兼容，不误伤）。
  if (input?.holdsLock === false) {
    return {
      ok: false,
      reason:
        "本会话当前**不持有调度权限**（同一时间只允许一个会话调度，可能已被另一个会话接管，或开关被关掉了）。" +
        "请直接在当前会话把活干完，并把需要在别处协作的部分写清楚；需要恢复权限时请用户在**顶栏右上角的「调度」图标**里重新开启（会话标题栏那一排，独立窗口图标左边；会话若开在独立弹窗里则该按钮不显示，需回主窗口开启）。",
    };
  }
  return { ok: true };
}

/* ─────────────── 原 L4「总量闸」（同时进行的调度任务上限）已于 09-25 删除 ───────────────
   用户原话：「直接把并发限制删了吧」。被删的符号：`MAX_CONCURRENT_DISPATCH*` /
   `maxConcurrentDispatch()` / `admitDispatch()`；调用点 `features/delegation.ts` 同步移除。
   ⛔ 删除后：一次 fan-out 派出多少成员**不再有人拦**。已知后果 = 专家团并行时更容易撞上游 429
      （同一个 Key 的窗口内配额）。上游限流仍由引擎默认重试/退避处理（provider-retry.ts）。
   ⛔ 保留的仍是 L3 深度闸（`canDispatchFrom`）—— 它挡的是**调用链无限延长**（被委派者再委派），
      与"同时几路"无关，不属于并发限制，不要顺手删。
   恢复方式见 `logs/` 本轮 decision 条目。 */

/** 单次回传给调用方的输出上限（字符）。超出部分截断并指向完整会话。 */
export const MAX_OUTPUT_CHARS = 12000;

export function clipDispatchOutput(text: unknown, threadId?: string): string {
  const raw = String(text ?? "").trim();
  if (raw.length <= MAX_OUTPUT_CHARS) return raw;
  const tail = threadId ? `\n\n…（输出过长已截断，完整结果见会话 ${threadId}）` : "\n\n…（输出过长已截断）";
  return raw.slice(0, MAX_OUTPUT_CHARS - tail.length) + tail;
}

/* ─────────────── 目录 / 开关 / 工具说明 ─────────────── */

const KIND_LABEL: Record<DispatchKind, string> = { expert: "专家", team: "专家团", member: "团队成员", subagent: "子智能体" };

export function kindLabel(kind: DispatchKind): string {
  return KIND_LABEL[kind] ?? String(kind ?? "");
}

/** 按会话开关过滤可调度对象：总开关关 → 空；否则按三类勾选过滤。 */
export function filterTargetsBySwitch(targets: DispatchTarget[], dispatch?: DispatchConfig | null): DispatchTarget[] {
  const list = Array.isArray(targets) ? targets : [];
  const enabled = dispatch?.enabled === true;
  if (!enabled) return [];
  return list.filter((target) => {
    switch (target?.kind) {
      case "expert": return dispatch?.expert !== false;
      case "team": return dispatch?.team !== false;
      case "member": return dispatch?.team !== false;
      case "subagent": return dispatch?.subagent !== false;
      default: return false;
    }
  });
}

/** 目录 → 工具 description（模型据此知道「有什么可以调」，这是闭环的前提）。 */
export function dispatchToolDescription(targets: DispatchTarget[]): string {
  const list = Array.isArray(targets) ? targets : [];
  const lines = list.slice(0, 40).map((target) => {
    const who = target.kind === "member" && target.teamId ? `${target.teamId} / ${target.memberId}` : target.key;
    const title = [target.name, target.profession].filter(Boolean).join(" · ");
    const desc = String(target.description ?? "").replace(/\s+/g, " ").slice(0, 80);
    return `- ${kindLabel(target.kind)}「${title}」→ name=${JSON.stringify(who)}${desc ? `：${desc}` : ""}`;
  });
  return [
    "调度一个智能体替你完成**独立的子任务**并拿到它的产出。适合：需要专门角色（代码审查/演示文稿/内容创作）、需要上下文隔离（大量文件阅读不要污染本会话）、可以并行推进的活。",
    "调用后会为它开一个独立会话（会出现在左侧侧栏），任务结束前保持同步等待；返回的是它的最终产出文本。",
    "",
    "当前本会话可调度的对象：",
    ...lines,
    "",
    "参数 kind 必须与上面列出的对象类型一致；name 用上面给出的值。委托时把「要它做什么、验收标准、相关文件/背景」一次说清——它看不到你和用户的对话。",
    "任务整体完成后，如果本次调度产生了临时会话，可以先问用户是否归档它们（用 agent_ask），用户同意后再调用 agent_archive_sessions。",
  ].join("\n");
}

/** 开启调度开关时，自动发往对话框的那条「告知」消息。 */
export function dispatchNoticeText(targets: DispatchTarget[]): string {  const list = Array.isArray(targets) ? targets : [];
  const byKind = new Map<DispatchKind, string[]>();
  for (const target of list) {
    const arr = byKind.get(target.kind) ?? [];
    if (target.name) arr.push(target.name);
    byKind.set(target.kind, arr);
  }
  const parts: string[] = [];
  if (byKind.get("expert")?.length) parts.push(`专家（${(byKind.get("expert") ?? []).join("、")}）`);
  if (byKind.get("team")?.length) parts.push(`专家团（${(byKind.get("team") ?? []).join("、")}）`);
  if (byKind.get("subagent")?.length) parts.push(`子智能体（${(byKind.get("subagent") ?? []).join("、")}）`);
  const what = parts.length ? parts.join("、") : "（当前没有可调度的对象，请先到专家中心/子智能体页启用）";
  return [
    "【调度已开启】本会话已启用「调度」能力。",
    `你可以在需要时调度这些对象替你干活：${what}。`,
    "原则：**适合独立完成、需要专门角色、或会大量读取上下文而不该污染本会话的子任务，优先调度它们来做**，而不是自己硬做；琐碎的一两行改动、需要来回确认的活，自己做完更快。",
    "调度它们会产生临时会话并出现在左侧侧栏；一个任务整体做完后，主动问用户是否归档这些临时会话。",
    "收到请只回复「收到」两个字，不要展开。",
  ].join("\n");
}

/** 关闭调度开关时，自动发往对话框的告知（让 Codex 立刻知道权限被收回了）。 */
export function dispatchOffNoticeText(): string {
  return [
    "【调度已关闭】本会话已停用「调度」能力。",
    "之后的任务都由你自己完成；即使你再尝试调度专家 / 专家团 / 子智能体，调用也会被拒绝——不要白费回合去试。",
    "收到请只回复「收到」两个字，不要展开。",
  ].join("\n");
}

/**
 * 按 kind + name 在目录里定位一个可调度对象。
 * name 允许给 key（英文 id）或显示名（中文），大小写不敏感；再不行做一次包含匹配。
 */
export function resolveDispatchTarget(
  targets: DispatchTarget[],
  input: { kind?: DispatchKind; name?: string },
): { target?: DispatchTarget; error?: string } {
  const list = Array.isArray(targets) ? targets : [];
  const kind = input?.kind;
  const raw = String(input?.name ?? "").trim();
  if (!raw) return { error: "缺少 name：要调度的对象名称" };
  const needle = raw.toLowerCase();
  const pool = kind ? list.filter((t) => t.kind === kind) : list;
  const hit = pool.find((t) => String(t.key).toLowerCase() === needle)
    ?? pool.find((t) => String(t.name).toLowerCase() === needle)
    ?? pool.find((t) => String(t.key).toLowerCase().includes(needle) || String(t.name).toLowerCase().includes(needle));
  if (!hit) {
    const available = pool.map((t) => `${t.name}(${t.key})`).slice(0, 20).join("、");
    return { error: `找不到${kind ? kindLabel(kind) : "可调度对象"}「${raw}」。当前可用：${available || "（无）"}` };
  }
  if (kind && hit.kind !== kind) return { error: `「${raw}」的类型是${kindLabel(hit.kind)}，与传入的 kind=${kind} 不一致` };
  return { target: hit };
}
