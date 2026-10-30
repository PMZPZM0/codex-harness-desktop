/**
 * electron/dispatch.ts —— 「Codex 调度其他智能体干活」的核心判定与文案（纯函数）。
 *
 * 09-15 起：Codex 在任意会话里都能调度 单专家 / 专家团 / 子智能体 干活。
 * 10-29 起（用户令）：**专家与子智能体默认可用（无需任何开关，也没有数量 / 并发 / 独占锁限制）；
 *   只有专家团默认关闭，需在顶栏「调度」面板显式开启**。本文件的 DISPATCH_DEFAULTS 是这份默认值的
 *   唯一真相源（渲染层 emptyDispatch() 与之逐字同形）。
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

export type DispatchKind = "expert" | "team" | "member" | "subagent" | "cli";

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
  /** 专家团目标的成员数（不含主理人）：只用于面板上的「专家总数」口径，不参与调度。 */
  memberCount?: number;
  /** CLI 智能体：本机是否已安装（主进程 where/which 检测；false ⇒ @ 列表置灰不可选，不隐藏）。
   *  ⛔ 只是 UI 提示，真正的闸在 runDelegatedTask 派活前重检 —— 缓存过期也不能把活派给没装的 CLI。 */
  installed?: boolean;
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
      case "cli":
        return "直接干活产出结论；**不要调用其他专家、专家团、子智能体或 CLI**。该用 CLI 的时候用本机 shell 跑它，跑不了就如实说没装。";
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
 *
 * ⛔⛔ 10-29 用户令「不再做数量或使用上的限制，每个会话都可以调度它们」⇒
 *   **「调度总开关」与「全局独占锁」都已删除**，这里只剩两道**结构闸**（不是配额）：
 *     ① 身份闸：专家 / 专家团 / 被调度会话不能对外派人（它们有团内通道；对外派人会让「谁在干活」失控）；
 *     ② 深度闸：被委派会话不能再往下派（防指数套娃 —— 每层 fan-out 3 个就是 3^n 次模型调用）。
 *   配额类闸（并发上限）09-25 已删；类别许可改由 `dispatchKindAllowed` 按类判定（默认专家/子智能体可用）。
 */
export function canDispatchFrom(input: { isDelegated?: boolean; depth?: number; restricted?: boolean; restrictedLabel?: string }): { ok: boolean; reason?: string } {
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

const KIND_LABEL: Record<DispatchKind, string> = { expert: "专家", team: "专家团", member: "团队成员", subagent: "子智能体", cli: "CLI 智能体" };

export function kindLabel(kind: DispatchKind): string {
  return KIND_LABEL[kind] ?? String(kind ?? "");
}

/** 三类目标的**默认许可**（10-29 用户令）：专家与子智能体默认可用 —— 不需要任何开关；
 *  专家团默认关闭 —— 它是多角色 SOP 编排，一次派活会拉起多名成员，必须由用户**显式开启**。
 *  10-29 晚追加 `cli`：CLI 智能体同样**默认可用**（用户令「与子智能体、专家、专家团保持一致」），
 *    面板上没有它的开关 —— 关不掉的类别不该出现在许可表里，这里留字段只为与 allow 形状同源。
 *  ⛔ 这是「默认行为」的唯一真相源（渲染层 `emptyDispatch()` 与它逐字同形，两边各一份字面量，
 *     `electron/` 与 `src/` 互不 import）。 */
export const DISPATCH_DEFAULTS = { expert: true, team: false, subagent: true, cli: true } as const;

/** 某一类此刻的许可（dispatch 为 null = 该会话还没有运行时记录 ⇒ 取默认）。
 *  ⛔ 10-29 定稿：面板只剩「专家团」一个开关 ⇒ `expert` / `subagent` **恒为 true**（连手改
 *    thread-runtime.json 里的 false 也不再生效）。理由：界面上没有关闭它们的入口，任何"关着"
 *    的状态都无法被用户纠正，只会让模型让用户去点一个不存在的开关。 */
export function dispatchAllowOf(dispatch?: DispatchConfig | null): DispatchAllow {
  const src = dispatch && typeof dispatch === "object" ? dispatch : null;
  // `cli` 恒 true：面板没有这一类的开关（与专家 / 子智能体同待遇）
  return { expert: true, team: src ? src.team === true : DISPATCH_DEFAULTS.team, subagent: true, cli: true };
}

/** 按会话许可过滤可调度对象（目录给模型 / 面板计数共用这一处口径）。
 *  ⛔ 不再有「总开关」：各类独立判定，默认值见 DISPATCH_DEFAULTS。 */
export function filterTargetsBySwitch(targets: DispatchTarget[], dispatch?: DispatchConfig | null): DispatchTarget[] {
  const list = Array.isArray(targets) ? targets : [];
  const allow = dispatchAllowOf(dispatch);
  return list.filter((target) => {
    switch (target?.kind) {
      case "expert": return allow.expert;
      case "team": return allow.team;
      case "member": return allow.team;
      case "subagent": return allow.subagent;
      case "cli": return allow.cli !== false;
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
 * ⛔ 判据与 filterTargetsBySwitch **同源**（member 跟随 team），绝不许两处各写一套。
 * 返回值带 reason：调用被拒时模型要能读到「哪一类没开」，才能自己改派或如实回报用户。 */
export function dispatchKindAllowed(
  kind: DispatchKind | string,
  dispatch?: DispatchConfig | null,
): { ok: boolean; reason?: string } {
  const allow = dispatchAllowOf(dispatch);
  const key = String(kind);
  const ok = key === "team" || key === "member"
    ? allow.team
    : key === "expert"
      ? allow.expert
      : key === "subagent"
        ? allow.subagent
        : key === "cli"
          ? allow.cli !== false
          : false;
  if (ok) return { ok: true };
  if (key === "team" || key === "member") {
    return {
      ok: false,
      reason:
        "本会话**没有开启「专家团」**（它是唯一需要用户手动打开的一类，出厂关闭；一次派活会按 SOP 拉起多名成员）。" +
        "⛔ 不要重复调用同一类：要团就请用户在顶栏「调度」面板打开「专家团」。在此之前可以改用" +
        "**专家或子智能体**（这两类一直可派、不需要任何开关），或你自己把活干完。",
    };
  }
  return {
    ok: false,
    reason:
      `「${KIND_LABEL[key as DispatchKind] ?? key}」在本会话被**旧版设置**关掉了（那个开关已从界面移除，现在恒开）。` +
      "⛔ 不要重试；直接自己完成，并把这件事如实告诉用户（重新确认一次调度面板或重启应用会把它纠正回默认）。",
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
  allow: { expert: boolean; team: boolean; subagent: boolean; cli?: boolean } | null = null,
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
  const KIND_LABEL: Record<string, string> = { expert: "专家", team: "专家团", subagent: "子智能体", cli: "CLI 智能体" };
  /** 该类是否被用户勾选（allow 为 null ⇒ 全开，保持旧行为）。
   *  ⚠️ `member` 不在 allow 键里（它是团结成员、不参与面板勾选）⇒ 一律按开处理。
   *  ⚠️ `cli` 恒开（面板没有它的开关）⇒ 只有显式 false 才算关。 */
  const enabled = (kind: DispatchTarget["kind"]) => {
    if (!allow) return true;
    if (kind === "cli") return allow.cli !== false;
    return kind === "expert" || kind === "team" || kind === "subagent" ? allow[kind] === true : true;
  };
  const section = (kind: DispatchTarget["kind"], title: string, when: string) => {
    const items = list.filter((t) => t.kind === kind);
    if (!items.length) return [];
    // ⛔⛔ 有对象但没开 ⇒ 必须显式否定（隐藏会让模型以为不存在而反复试错）
    if (!enabled(kind)) {
      const why = kind === "team"
        ? "默认关闭，需用户在顶栏「调度」面板打开"
        : "被旧版设置关掉（该开关已移除，现在恒开）";
      return ["", `⛔【${KIND_LABEL[kind]}】本会话**未开启**（${why}）——不要派这一类，也不要反复试；换成其它类或自己做。`];
    }
    return ["", `【${title}】${when}`, ...items.map(line)];
  };
  const sections = [
    ...section("expert", "专家（单人）", "一个独立的专业角色，适合评审/创作/调研这类**要专业判断、产出自己就是最终答案**的活。"),
    ...section("team", "专家团（多人协作）", "一个团队按 SOP 分工协作，适合**要多个角色配合、产出需要汇总**的活（如软件开发：设计+前端+后端+测试）。"),
    ...section("subagent", "子智能体（你自定义的角色）", "你在设置里配置的自定义角色，适合**固定流程、专精某一类活**（如只做评审、只做翻译）。"),
    ...section("cli", "CLI 智能体（本机命令行工具）", "用户在本机装好的命令行 AI（Claude Code / Codex CLI / OpenClaw 等）。适合**它比你在行、或要把活交给一个独立进程跑**的场景；它会在自己的会话里调 shell 跑那个 CLI，**没装就会如实回「没装」，不要当它跑过**。"),
  ];
  // ⛔ 顶部第一句就说明**能不能派、要不要用户动手** —— 这是模型最先读到的约束，
  //    也是"模型让用户去勾一个不存在的开关"这类错觉的唯一止损点。
  const scope = allow
    ? (allow.team
      ? "⛔ **本会话：专家、子智能体、CLI 智能体、专家团都可直接派（不要再让用户去开任何开关）。**"
      : "⛔ **本会话：专家、子智能体、CLI 智能体可直接派（不需要任何开关）；专家团未开启 —— team/member 会被拒，要团请用户在顶栏「调度」面板打开，别硬试。**")
    : "";
  return [
    scope,
    "调度一个智能体替你完成**独立的子任务**并拿到它的产出。适合：需要专门角色、需要上下文隔离（大量文件阅读不要污染本会话）、可以并行推进的活。",
    "调用后会为它开一个独立会话（会出现在左侧侧栏），任务结束前保持同步等待；返回的是它的最终产出文本。",
    "",
    "⛔ **不要把「先去调度面板开启」当成前置条件**——它们随时可派，也不需要用户先做什么。",
    "⛔ **专家团默认关闭**：确需多角色协作时，让用户在顶栏「调度」面板打开「专家团」；在此之前用专家或子智能体并行做同样可行。",
    "",
    /* ★ 10-30 用户令：提示词要与输入框的实际行为**一致** ——
       @ 唤出的选择列表按调度开通状态联动（未开通置灰不可选、开通后实时恢复）。 */
    "【输入框的 @ 选择列表 = 本段的许可范围】用户在输入框打 @ 会弹出可选对象列表，该列表**按本会话的调度开通状态实时联动**：",
    "  · 未开通的类别（当前就是「专家团」）**仍然出现在列表里，但置灰、不可选中**（不是消失）；",
    "  · 用户在顶栏「调度」里打开该类开关后，列表**立刻**恢复为可选中（不需要重启、不需要重开会话）；",
    "  · 因此用户说「@ 里专家团是灰的 / 列表里没有团队」时，正确回答是「该类别未开通，去顶栏「调度」打开即可」；",
    "    ⛔ 不要说这个团队不存在、也不要建议用户重建它 —— 那是把「没开开关」说成了「数据没了」。",
    "",
    "⛔ **选谁：先看用户点名了哪一类，就派那一类。**用户说「派专家/找个专家」→ 专家；",
    "   说「用专家团/让团队」→ 专家团；说「派子智能体/让 XX 角色」→ 子智能体；说「@ 某个 CLI / 用 Claude Code 跑」→ CLI 智能体。",
    "   用户没指定时，按下面各节的适用场景挑**最贴切的一类**，并在回复里说明你选了谁、为什么。",
    "⛔ **不要把子智能体当专家用，也不要把专家当子智能体用，更不要拿 CLI 顶替它们**——它们是四套独立配置，",
    "   名字相似但能力和来源不同，派错类型用户会立刻发现。",
    "",
    "当前可调度的对象：",
    ...(sections.length ? sections : ["  （当前没有任何可调度对象 —— 如需派活，先让用户到设置里启用专家 / 专家团 / 子智能体，或到「开发工具 → CLI 智能体」接入一个命令行工具）"]),
    "",
    "参数 kind 必须与上面列出的对象类型一致；name 用上面给出的值。委托时把「要它做什么、验收标准、相关文件/背景」一次说清——它看不到你和用户的对话。",
    "任务整体完成后，如果本次调度产生了临时会话，可以先问用户是否归档它们（用 agent_ask），用户同意后再调用 agent_archive_sessions。",
  ].join("\n");
}

/* ════════════════════════════════════════════════════════════════════════
 * 许可变化通知（10-29 重构）：**一条通知、按类分段、差异驱动**。
 *
 * 沿革：10-04 用户要求「勾选 / 取消某一类都要发对应通知与提示词，覆盖勾 1 / 2 / 3 个与
 * 取消其一其余仍开」。当时有三种事件（总开关开 / 关 / 逐类变化）⇒ 三条文案、两条通道。
 * 10-29 用户令「专家与子智能体默认可用、只有专家团需显式开启」⇒ **总开关删除**，
 * 只剩「逐类许可变化」一种事件 ⇒ 收敛为**一个函数 + 一条通道**（agents:notice）。
 * 映射规则与 10-04 完全一致：新增类一段独立文案、取消类一段停用文案、末尾写「当前仍可调度：…」。
 *
 * ⛔ 为什么保留「按类独立文案」：模型据此判断「用户点名的那一类能不能派」；
 *    混成一句话它就会自由发挥（10-04 的"派错类型"事故）。
 * ⛔ targets 可选：传了就为**新开启**的类附带该类对象名单（中途开启专家团时模型立刻知道有谁）。
 * ════════════════════════════════════════════════════════════════════════ */

/** 用户在调度面板的逐类许可（DispatchConfig 的三个子开关）。
 *  `cli` 是**可选**的恒真项：面板上没有它的开关（10-29 晚接入 CLI 智能体时与专家/子智能体同待遇），
 *  留字段只为让 filterTargetsBySwitch / 描述生成用同一份 allow，不必各自特判缺键。 */
export type DispatchAllow = { expert: boolean; team: boolean; subagent: boolean; cli?: boolean };

export const DISPATCH_KIND_LABEL: Record<Exclude<DispatchKind, "member">, string> = {
  expert: "专家",
  team: "专家团",
  subagent: "子智能体",
  cli: "CLI 智能体",
};

/** 专家团的一句话职责（通知里只保留**真正会变化**的那一类，其余不占篇幅）。 */
const TEAM_ROLE = "一个团队按 SOP 分工协作——适合要多角色配合（设计 / 开发 / 测试等）、产出需要汇总的活。";

const KIND_ORDER = ["expert", "team", "subagent"] as const;

/** 当前开启的是哪几类（固定顺序：专家 → 专家团 → 子智能体）。保留给守卫/调试读同一份口径。 */
export function activeDispatchKinds(allow: DispatchAllow | null | undefined): Exclude<DispatchKind, "member">[] {
  if (!allow) return [];
  return KIND_ORDER.filter((k) => allow[k] === true);
}

function namesOfKind(list: DispatchTarget[], kind: DispatchKind): string[] {
  return list.filter((t) => t.kind === kind).map((t) => t.name).filter(Boolean);
}

/**
 * 许可变化通知（唯一入口：面板确认后发一条，注入下一条用户消息）。
 *
 * ⛔ 10-29 定稿：面板上**只剩下「专家团」一个开关** ⇒ 这条通知也只有两种状态。
 *    旧版按「勾了几类」分段的写法（勾 1/2/3 个、取消其一）随三类平行开关一起作废 ——
 *    继续按类分段只是给模型灌它不需要的信息，还会暗示"专家/子智能体也能被关掉"；
 *    模型一旦这么以为，就会像 10-29 实测那样**让用户去点一个不存在的开关**。
 *    ⛔ 形参保留（调用方 / 守卫不必改），正文只认 `nowAllow.team`。
 */
export function dispatchSelectionChangeNotice(
  turnedOn: Exclude<DispatchKind, "member">[],
  turnedOff: Exclude<DispatchKind, "member">[],
  nowAllow: DispatchAllow,
  targets?: DispatchTarget[],
): string {
  const list = Array.isArray(targets) ? targets : [];
  const teamOn = nowAllow?.team === true;
  const names = namesOfKind(list, "team");
  const changed = turnedOn.length > 0 || turnedOff.length > 0;
  const lines: string[] = [];
  if (teamOn) {
    lines.push(
      "【调度范围已更新】用户**打开了「专家团」**。",
      `【专家团】${TEAM_ROLE}`,
      list.length
        ? (names.length
          ? `  可派对象：${names.slice(0, 12).join("、")}${names.length > 12 ? ` 等 ${names.length} 个` : ""}。`
          : "  （当前没有已启用的专家团 —— 不要尝试派 team。）")
        : "",
      "专家与子智能体一直可派，不受这次变化影响。",
    );
  } else {
    lines.push(
      "【调度范围已更新】用户**关掉了「专家团」**。",
      "之后 kind=\"team\" / \"member\" 的调用会被拒绝 —— 别再试；需要团时请用户重新打开。",
      "专家与子智能体仍然可以直接派，不需要任何开关。",
    );
  }
  if (!changed) lines.push("（本次没有实际变化。）");
  lines.push("每次调度都会新开一个**独立会话**（挂在发起会话下面），产出只回传给发起它的这个会话；一个任务整体做完后，主动问用户是否归档这些临时会话。");
  lines.push("收到请只回复「收到」两个字，不要展开。");
  return lines.filter(Boolean).join("\n");
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
