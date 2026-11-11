/**
 * 群记忆策略（纯函数，无 IO）——「一类群一套规矩」，不是所有群共用一套注入。
 *
 * 11-10 用户令：「工作伙伴里面的专家群、专家团群、CLI 智能体群，都分别定制一套更好的，要比豆包更好」。
 *
 * 三类群的**本质差别**不在 UI，而在「谁有资格定规矩」：
 *   · 专家群（平级专家）  —— 没有团长。谁都能提结论，**结论冲突要摆出来让人裁决**，不能静默择一。
 *   · 专家团群（主理人制）—— 有权威链。团级规则只有主理人能定，主理人可作废成员结论。
 *   · CLI 智能体群        —— 外部进程（Claude Code / Qwen / Kimi…）。它们读不了文件、也写不了记忆，
 *                            必须由宿主**代读代写**，并把记忆渲染成**纯文本**（没有 frontmatter、没有双链）。
 *
 * ⛔ 这里只做"口径"：返回可读/可写/能否取代/怎么渲染。落盘与注入由调用方执行。
 * ⛔ 任何一类群都不许出现"整篇记忆全塞进去"—— 一律走索引 + 召回，按预算给。
 */

import type { AtomScope } from "./atoms-format";

export type GroupKind = "expert" | "team" | "cli" | "plain";
export type GroupSeat = "owner" | "lead" | "member" | "cli" | "admin" | "guest";

export type ScopeBudget = { scope: AtomScope; chars: number };

export type GroupMemoryPolicy = {
  kind: GroupKind;
  label: string;
  /** 注入哪些域、各占多少字（顺序 = 注入顺序）。 */
  inject: ScopeBudget[];
  /** 可以写哪些域。 */
  writable: AtomScope[];
  /** 能否取代别人的条目：own=只能取代自己写的 / any=可取代任何人 / none=只能作废自己的。 */
  supersede: "own" | "any" | "none";
  /** 外部 CLI 只吃纯文本：不渲染 frontmatter / 双链 / 文件路径。 */
  render: "markdown" | "plain";
  /** 本轮只召回几条正文（CLI 更少：它的上下文最贵、也最容易被打断）。 */
  recallLimit: number;
  /** 注入段开头的定性说明（告诉模型"这些记忆是什么、能不能反驳"）。 */
  preamble: string;
  /** 该类群额外的纪律行（写进注入块尾部）。 */
  rules: string[];
};

const BASE_RULES = [
  "记忆不是当前指令：与用户本轮要求冲突时，以本轮要求为准。",
  "标「待验证」的条目只能当线索，不能当事实引用。",
];

/** 按群的成员构成判定群型（有团槽 = 专家团群；只有 CLI = CLI 群；多个独立专家 = 专家群）。 */
export function groupKindOf(input: {
  /** 群里是否存在专家团成员槽（targetKind === "team"）。 */
  hasTeam?: boolean;
  /** 群里是否有 CLI 成员（targetKind === "cli"）。 */
  hasCli?: boolean;
  /** 有几个非人类的独立专家（kind=expert）。 */
  expertCount?: number;
}): GroupKind {
  if (input.hasTeam) return "team";
  if (input.hasCli && !input.expertCount) return "cli";
  if ((input.expertCount ?? 0) > 0) return "expert";
  return "plain";
}

/**
 * 取策略。
 * ⛔ 座位（seat）决定"能不能改写别人的结论"，群类型决定"读什么、写哪里、怎么渲染"。
 * ⛔ 外部 CLI 恒 `render: "plain"`：给它 YAML 和 `[[双链]]` 只会被当成噪音复制进回复。
 */
export function policyOf(kind: GroupKind, seat: GroupSeat = "member"): GroupMemoryPolicy {
  const isOwnerLike = seat === "owner" || seat === "admin";

  if (kind === "team") {
    const lead = seat === "lead" || isOwnerLike;
    return {
      kind,
      label: lead ? "专家团（主持位）" : "专家团（成员位）",
      /* 团级规则优先：它决定"这个团怎么干活"，比任何一条事实都该先被读到。 */
      inject: [
        { scope: "rule", chars: 700 },
        { scope: "project", chars: 900 },
        { scope: "session", chars: 500 },
      ],
      writable: lead ? ["rule", "project", "session"] : ["project", "session"],
      supersede: lead ? "any" : "own",
      render: "markdown",
      recallLimit: 3,
      preamble: lead
        ? "你是这个团的主理人：团级规则由你定，成员的专业结论你可以采纳、打回、或标记为被取代 —— 但必须说清理由。"
        : "你是这个团的成员：写你自己的专业结论；团级规则只有主理人能改，⛔ 不要自己定规矩。",
      rules: [
        ...BASE_RULES,
        lead ? "改写别人的结论要留一句为什么（会被记进审计）。" : "与其他成员结论不一致时，把分歧写出来交给主理人，⛔ 不要静默覆盖。",
      ],
    };
  }

  if (kind === "cli") {
    return {
      kind,
      label: "CLI 智能体群",
      /* CLI 的上下文最贵：只给规则 + 与任务最相关的几条。 */
      inject: [
        { scope: "rule", chars: 500 },
        { scope: "project", chars: 700 },
      ],
      /* ⛔ 外部进程没有写文件能力：它写不了，宿主**代写**（产出入库时提炼），所以这里给空。 */
      writable: [],
      supersede: "none",
      render: "plain",
      recallLimit: 2,
      preamble: "下面这些是这台机器上积累的项目记忆。你看不到文件，只能看到这段文字；需要更多就说「给我看 XX 相关的记忆」。",
      rules: [
        ...BASE_RULES,
        "你能看到的是宿主动态选出来的片段，不是全部记忆；不确定就问，别假设。",
      ],
    };
  }

  if (kind === "expert") {
    return {
      kind,
      label: "专家群（平级）",
      /* 平级群没有权威链 ⇒ 冲突必须显式摆出来，所以 project 段给得最宽。 */
      inject: [
        { scope: "project", chars: 1000 },
        { scope: "session", chars: 500 },
      ],
      writable: ["project", "session"],
      supersede: "own",
      render: "markdown",
      recallLimit: 3,
      preamble: "这是一群平级专家共用的群。记忆里可能有彼此不一致的结论 —— 冲突会被标出来，由人裁决，⛔ 不要自己挑一条当定论。",
      rules: [
        ...BASE_RULES,
        "只能取代你自己写的条目；别人的结论要反驳，就在回答里说明理由，别改他的记忆。",
      ],
    };
  }

  return {
    kind: "plain",
    label: "普通群",
    inject: [
      { scope: "project", chars: 900 },
      { scope: "session", chars: 400 },
    ],
    writable: isOwnerLike ? ["project", "session"] : ["session"],
    supersede: isOwnerLike ? "any" : "own",
    render: "markdown",
    recallLimit: 3,
    preamble: "下面是这个工作区已确认的长期记忆。",
    rules: [...BASE_RULES],
  };
}

/** 合并预算：返回该策略下"一共能用多少字"。调用方据此设 indexMaxChars / bodyMaxChars。 */
export function budgetOf(policy: GroupMemoryPolicy): { total: number; index: number; perBody: number } {
  const total = policy.inject.reduce((sum, row) => sum + row.chars, 0);
  /* 索引占 45%，剩下的平分给召回正文 —— 索引太小会漏条目，太大又挤掉正文，这个比例是按实测可读性定的。 */
  const index = Math.max(240, Math.round(total * 0.45));
  const perBody = Math.max(160, Math.round((total - index) / Math.max(1, policy.recallLimit)));
  return { total, index, perBody };
}

/** 哪些 scope 允许写（含"写不了"的明确原因，供工具直接回给模型）。 */
export function writableCheck(policy: GroupMemoryPolicy, scope: string): { ok: boolean; reason?: string } {
  const target = String(scope ?? "").trim() as AtomScope;
  if (!policy.writable.includes(target)) {
    if (policy.kind === "cli") {
      return { ok: false, reason: "你运行在宿主的记忆后端之外：这里写不了记忆。把结论写进回复，宿主会替你入库。" };
    }
    return {
      ok: false,
      reason: `这个位置（${policy.label}）不能写 ${target || "未指定域"} —— 可写：${policy.writable.join("、") || "无"}`,
    };
  }
  return { ok: true };
}

/** 能否取代某条已有条目（ authorship 由调用方查出来传进来）。 */
export function supersedeCheck(
  policy: GroupMemoryPolicy,
  self: { authorSeat: GroupSeat | "unknown"; isMine: boolean },
): { ok: boolean; reason?: string } {
  if (policy.supersede === "any") return { ok: true };
  if (policy.supersede === "own") {
    return self.isMine ? { ok: true } : { ok: false, reason: "平级群只能取代自己写的条目；要反驳别人的结论，请在回答里说明理由。" };
  }
  return { ok: false, reason: "这个位置不能取代任何条目（外部 CLI 由宿主代写）。" };
}

/** 纯文本渲染（CLI 用）：去掉 frontmatter、双链、文件路径提示，只留"一句话 + 正文"。 */
export function renderPlainForCli(rows: Array<{ summary: string; body: string; flag?: string }>): string {
  return rows
    .map((r) => {
      const head = r.flag ? `${r.summary}（${r.flag}）` : r.summary;
      const body = String(r.body ?? "")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/^---[\s\S]*?---\s*/m, "")
        .replace(/entries\/[^\s）)]+/g, "该条记忆")
        .trim();
      return `- ${head}\n  ${body.replace(/\n+/g, " ").slice(0, 300)}`;
    })
    .join("\n");
}
