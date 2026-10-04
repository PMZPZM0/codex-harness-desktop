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

/** 某一类**此刻**是否允许被调度（执行侧真相源）。
 *
 * ⛔⛔ 2026-10-04 用户拍板「调度开关就要对应生效工具，这个联动必须做好」——
 *   此前只有**提示词**在说「只开启了 X」，执行端（canDispatchFrom）只查身份 / 深度 / 独占锁，
 *   **完全不看 kind** ⇒ 用户取消勾选「专家 / 专家团」之后，模型仍能凭 MCP 工具的参数
 *   （kind=expert）把活派出去 —— 勾选等于装饰。
 * ⛔ 判据与 filterTargetsBySwitch **同源**（member 跟随 team；总开关关 ⇒ 一律不许），
 *   绝不许两处各写一套 —— 否则「列表里没有、调用却成功」这类口径漂移迟早回来。
 * 返回值带 reason：调用被拒时模型要能读到「哪一类没开、现在开了哪几类」，
 * 才能自己改派或如实回报用户，而不是反复重试同一个被拒的 kind。 */
export function dispatchKindAllowed(
  kind: DispatchKind | string,
  dispatch?: DispatchConfig | null,
): { ok: boolean; reason?: string } {
  if (dispatch?.enabled !== true) {
    return {
      ok: false,
      reason:
        "本会话的「调度」总开关是关着的，不能派活给任何智能体。" +
        "请自己把活干完；需要派人时请用户在顶栏的「调度」面板里开启（会话标题栏那一排的图标）。",
    };
  }
  const allowed: Record<string, boolean> = {
    expert: dispatch.expert === true,
    team: dispatch.team === true,
    // 团队成员没有独立开关：面板勾「专家团」即代表允许团内成员被调度
    member: dispatch.team === true,
    subagent: dispatch.subagent === true,
  };
  if (allowed[String(kind)] === true) return { ok: true };
  const on = (["expert", "team", "subagent"] as const)
    .filter((key) => dispatch[key] === true)
    .map((key) => KIND_LABEL[key]);
  return {
    ok: false,
    reason:
      `本会话没有开启「${KIND_LABEL[kind as DispatchKind] ?? String(kind)}」这一类调度` +
      `（当前开启：${on.length ? on.join("、") : "（无）"}）。` +
      "请改用已开启的类别、或自己完成；需要放开时请用户在顶栏的「调度」面板里勾选。",
  };
}

/** 目录 → 工具 description（模型据此知道「有什么可以调」，这是闭环的前提）。
 *
 * ⛔⛔ 2026-10-04 用户报「我勾了子智能体，提示词还让我派专家」——
 *   **allow 是关键**：用户在调度面板里逐类勾选（`dispatch.expert/team/subagent`），
 *   描述必须**只列勾选的那几类**，并对未勾选的明确说"本会话未开启，不要派"。
 *   ⚠️ 之前两个错叠加：
 *     ① 无 allow（三类全列）⇒ 模型面对一堆名字自由发挥；
 *     ② 三类平铺无分节 ⇒ 连"选谁"这件事都没讲清。
 *   ⇒ 两者都要：allow 决定**列不列**，分节+场景决定**怎么选**。
 *   ⚠️ 未勾选的类别要**显式否定**而不是隐藏：隐藏会让模型以为不存在而反复试错。
 *   ⚠️ allow 为 null（全 false / 取不到开关）时退化为"三类全列"，保持旧行为、不让描述变空。 */
export function dispatchToolDescription(
  targets: DispatchTarget[],
  allow: { expert: boolean; team: boolean; subagent: boolean } | null = null,
): string {
  const list = Array.isArray(targets) ? targets : [];
  const line = (target: DispatchTarget) => {
    const who = target.kind === "member" && target.teamId ? `${target.teamId} / ${target.memberId}` : target.key;
    const title = [target.name, target.profession].filter(Boolean).join(" · ");
    const desc = String(target.description ?? "").replace(/\s+/g, " ").slice(0, 80);
    return `  - ${title} → name=${JSON.stringify(who)}（kind="${target.kind}"）${desc ? `：${desc}` : ""}`;
  };
  /* ⛔⛔ 2026-10-04 用户报「提示词写错了」——
     原版把三类**平铺在一个无分节的列表**里，只在每行前缀写「专家」「专家团」「子智能体」，
     模型据此自己挑 ⇒ 用户开了子智能体、明确要派子智能体，模型却派了专家。
     根因不是"没列出来"，而是**没把"选谁"这件事讲清**：三类适用场景完全不同，
     平铺后模型只能靠名字猜。⇒ 改成**按 kind 分节 + 每节写明"什么时候选它"**，
     并显式给出"用户点名了哪类就派哪类"这条硬规则。 */
  const KIND_LABEL: Record<string, string> = { expert: "专家", team: "专家团", subagent: "子智能体" };
  /** 该类是否被用户勾选（allow 为 null ⇒ 全开，保持旧行为）。
   *  ⚠️ `member` 不在 allow 键里（它是团结成员、不参与面板勾选）⇒ 一律按开处理。 */
  const enabled = (kind: DispatchTarget["kind"]) =>
    allow && (kind === "expert" || kind === "team" || kind === "subagent") ? allow[kind] === true : true;
  const section = (kind: DispatchTarget["kind"], title: string, when: string) => {
    const items = list.filter((t) => t.kind === kind);
    if (!items.length) return [];
    // ⛔⛔ 有对象但用户没勾 ⇒ 必须显式否定（隐藏会让模型以为不存在而反复试错）
    if (!enabled(kind)) {
      return ["", `⛔【${KIND_LABEL[kind]}】本会话**未开启**（用户没勾选）——不要派这一类，即使下面列出了名字也不要调。`];
    }
    return ["", `【${title}】${when}`, ...items.map(line)];
  };
  const sections = [
    ...section("expert", "专家（单人）", "一个独立的专业角色，适合评审/创作/调研这类**要专业判断、产出自己就是最终答案**的活。"),
    ...section("team", "专家团（多人协作）", "一个团队按 SOP 分工协作，适合**要多个角色配合、产出需要汇总**的活（如软件开发：设计+前端+后端+测试）。"),
    ...section("subagent", "子智能体（你自定义的角色）", "你在设置里配置的自定义角色，适合**固定流程、专精某一类活**（如只做评审、只做翻译）。"),
  ];
  const onList = (["expert", "team", "subagent"] as const).filter(enabled);
  // ⛔ 顶部第一句就说明“只能派勾选的那几类”——这是模型最先读到的约束
  const scope = allow
    ? `⛔ **本会话只开启了：${onList.map((k) => KIND_LABEL[k]).join("、") || "（无）"}。只能派这几类；未列出的类别一律不要派。**`
    : "";
  return [
    scope,
    "调度一个智能体替你完成**独立的子任务**并拿到它的产出。适合：需要专门角色、需要上下文隔离（大量文件阅读不要污染本会话）、可以并行推进的活。",
    "调用后会为它开一个独立会话（会出现在左侧侧栏），任务结束前保持同步等待；返回的是它的最终产出文本。",
    "",
    "⛔ **选谁：先看用户点名了哪一类，就派那一类。**用户说「派专家/找个专家」→ 专家；",
    "   说「用专家团/让团队」→ 专家团；说「派子智能体/让 XX 角色」→ 子智能体。",
    "   用户没指定时，按下面三节的适用场景挑**最贴切的一类**，并在回复里说明你选了谁、为什么。",
    "⛔ **不要把子智能体当专家用，也不要把专家当子智能体用**——它们是三套独立配置，",
    "   名字相似但能力和来源不同，派错类型用户会立刻发现。",
    "",
    "当前本会话可调度的对象：",
    ...(sections.length ? sections : ["  （当前没有任何可调度对象 —— 如需派活，先让用户到设置里启用专家/专家团/子智能体）"]),
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

/* ════════════════════════════════════════════════════════════════════════
 * ⛔⛔ 2026-10-04 用户拍板：勾选/取消勾选的**逐类**通知与提示词（完整映射）。
 *
 * 用户原话：「用户勾选某个可调度项时，被勾选的那一项要发送对应通知，并生成
 * 对应提示词内容。需分别覆盖一次勾选 1 个、2 个、3 个的场景，确保每个被勾选
 * 项都有独立的、准确的提示词文案，不遗漏也不重复发送。取消其中某一项、其他项
 * 仍开启时，同样要生成对应的提示词与通知，内容需正确反映状态。」
 *
 * 设计（映射规则的实现，守卫【dpcat】会真跑这 8 态）：
 *   · **一条通知、按类分段**：勾了 3 类 ⇒ 通知里 3 段（每段一段说明），不是 3 条消息。
 *     ——「不遗漏」：每段都列名字与职责；「不重复发送」：一次确认只发一条。
 *   · **差异驱动**：发什么由 before → next 的**差集**决定（新增勾了什么、取消了什么），
 *     与"第几类"无关 —— 三类对称，不会漏某一类。
 *   · **取消也要发**：关闭 A、B/C 仍开 ⇒ 通知里 A 段写「已停用」、末尾写「仍可调度：B、C」。
 *   · 全部取消（三类全关）但总开关还开着 ⇒ 等价于"无对象"，也要发（模型才不会白试）。
 * ════════════════════════════════════════════════════════════════════════ */

/** 用户在调度面板逐类勾选的结果（DispatchConfig 的三个子开关）。 */
export type DispatchAllow = { expert: boolean; team: boolean; subagent: boolean };

export const DISPATCH_KIND_LABEL: Record<Exclude<DispatchKind, "member">, string> = {
  expert: "专家",
  team: "专家团",
  subagent: "子智能体",
};

/** 每类"是什么、适合派什么活"——通知里给模型的一句话职责说明（按类独立，不共用）。 */
const KIND_ROLE: Record<Exclude<DispatchKind, "member">, string> = {
  expert: "一个独立的专业角色——适合评审、创作、调研这类要专业判断、产出本身就是最终答案的活。",
  team: "一个团队按 SOP 分工协作——适合要多角色配合（设计/开发/测试等）、产出需要汇总的活。",
  subagent: "你在设置里配置的自定义角色——适合固定流程、专精某一类活（如只做评审、只做翻译）。",
};

const KIND_ORDER = ["expert", "team", "subagent"] as const;

/** 当前开启的是哪几类（固定顺序：专家 → 专家团 → 子智能体；顺序即通知段落顺序）。 */
export function activeDispatchKinds(allow: DispatchAllow | null | undefined): Exclude<DispatchKind, "member">[] {
  if (!allow) return [];
  return KIND_ORDER.filter((k) => allow[k] === true);
}

/** 「A、B」形式的类名列表（空 ⇒ 「（无）」）。 */
function kindsLabel(kinds: Exclude<DispatchKind, "member">[]): string {
  return kinds.length ? kinds.map((k) => DISPATCH_KIND_LABEL[k]).join("、") : "（无）";
}

/** 一段「【类名】职责说明」——每个被勾选项的独立文案，互不共用。 */
function kindParagraph(kind: Exclude<DispatchKind, "member">): string {
  return `【${DISPATCH_KIND_LABEL[kind]}】${KIND_ROLE[kind]}`;
}

/**
 * 勾选变化通知：总开关保持开启、面板里勾了/取消了某些类时发。
 * 映射规则（8 态全覆盖，守卫逐态断言）：
 *   · turnedOn 非空 ⇒ 每个新增类一段独立文案（不遗漏、不共用）
 *   · turnedOff 非空 ⇒ 每个取消类一段「已停用」文案
 *   · 末尾固定写「当前仍可调度：…」（正确反映其余项保持开启）
 *   · 两者都空 ⇒ 不该调用（渲染层负责不发）；真调了就给一句中性状态说明，不发空串
 */
export function dispatchSelectionChangeNotice(
  turnedOn: Exclude<DispatchKind, "member">[],
  turnedOff: Exclude<DispatchKind, "member">[],
  nowAllow: DispatchAllow,
): string {
  const on = KIND_ORDER.filter((k) => turnedOn.includes(k));
  const off = KIND_ORDER.filter((k) => turnedOff.includes(k));
  /* ⛔ 仍可调度 = **当前开启的全部类**（含本轮刚勾上的）—— 之前误写成"排除本轮新增"，
     勾 2 个时 still 恒空 ⇒ 误打「当前没有任何可调度的对象」（守卫【dnotice】抓的）。 */
  const nowActive = activeDispatchKinds(nowAllow);
  const lines: string[] = ["【调度范围已更新】本会话的可调度对象有变化。"];
  if (on.length) {
    lines.push("新开启（可以派它们干活）：");
    for (const k of on) lines.push(kindParagraph(k));
  }
  if (off.length) {
    lines.push("已停用（之后不要再派这一类；即使工具参数里还能拼出名字，调用也会被拒绝）：");
    for (const k of off) lines.push(`【${DISPATCH_KIND_LABEL[k]}】已在本会话停用。`);
  }
  lines.push(`当前仍可调度：${kindsLabel(nowActive)}。`);
  // 未开启且不是本轮取消的 ⇒ 从没开过（首次勾选场景）⇒ 也给一句否定（防模型去试）
  const neverOn = KIND_ORDER.filter((k) => !nowActive.includes(k) && !off.includes(k));
  if (neverOn.length) lines.push(`⛔ 未开启（用户没勾选，不要派）：${neverOn.map((k) => DISPATCH_KIND_LABEL[k]).join("、")}。`);
  if (on.length) lines.push("对新增的类：收到本条后不用逐个回复，之后按需直接调度即可。");
  if (!on.length && !off.length) lines.push("（本次没有实际变化。）");
  if (nowActive.length === 0) lines.push("⚠️ 当前没有任何可调度的对象——所有任务都由你自己完成，不要尝试调度。");
  lines.push("收到请只回复「收到」两个字，不要展开。");
  return lines.join("\n");
}

/**
 * 总开关开启时的完整告知（原来那条 dispatchNoticeText 的升级版）：
 * 按当时勾选的类**逐段**列出（勾 1 类就 1 段、3 类就 3 段），未开启的类明确否定。
 */
export function dispatchEnabledNotice(targets: DispatchTarget[], allow: DispatchAllow | null): string {
  const list = Array.isArray(targets) ? targets : [];
  const on = activeDispatchKinds(allow);
  const byKind = new Map<string, string[]>();
  for (const target of list) {
    if (!on.includes(target.kind as Exclude<DispatchKind, "member">)) continue; // 只列开启的类
    const arr = byKind.get(target.kind) ?? [];
    if (target.name) arr.push(target.name);
    byKind.set(target.kind, arr);
  }
  const lines: string[] = [
    `【调度已开启】本会话已启用「调度」能力。开启的对象类别：${kindsLabel(on)}。`,
    "",
  ];
  if (!on.length) {
    lines.push("⚠️ 但没有勾选任何类别——请用户在调度面板里至少勾选一类，否则你无法派出任何任务，也不要白试。");
  }
  for (const k of on) {
    lines.push(kindParagraph(k));
    const names = byKind.get(k) ?? [];
    lines.push(names.length ? `  可派对象：${names.slice(0, 12).join("、")}${names.length > 12 ? ` 等 ${names.length} 个` : ""}。` : "  （该类当前没有已启用的对象——不要尝试派这一类。）");
    lines.push("");
  }
  // ⛔ 未勾选的类也要**显式否定**（守卫【dnotice】钉的）：只写"只开启了 X"不够，
  //    模型看到工具参数里能拼出其它类的名字仍可能去试 ⇒ 逐类点名"没开、别派"。
  const offAll = KIND_ORDER.filter((k) => !on.includes(k));
  if (offAll.length && on.length) {
    lines.push(`⛔ 未开启（用户没勾选，不要派）：${offAll.map((k) => DISPATCH_KIND_LABEL[k]).join("、")}。`);
    lines.push("");
  }
  lines.push(
    "原则：适合独立完成、需要专门角色、或会大量读取上下文而不该污染本会话的子任务，优先调度它们来做；",
    "需要来回确认的活、自己做更快，就自己做。",
    "调度它们会产生临时会话并出现在左侧侧栏（挂在发起调度的会话下面）；一个任务整体做完后，主动问用户是否归档这些临时会话。",
    "收到请只回复「收到」两个字，不要展开。",
  );
  return lines.join("\n");
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
