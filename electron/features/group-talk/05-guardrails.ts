/**
 * 工作伙伴 · 群聊「代码层硬约束」（11-10 用户令：「不能光靠模型自觉」）。
 *
 * ⛔└ 边界（10-26 事故记录：用户明确要求删掉停滞/待审看门狗）：
 *   这里只做两件事 —— ① 把**动作**硬拦住（重复结论不再触发接力、空产出不假装成功、
 *   无效 @ 不再静默失效）；② 把**事实**摆出来（谁没交、汇报行真发到群主流）。
 *   ⛔ 不加定时器 / 不巡检 / 不自动催办 / 不替模型判断「该不该做、写得好不好」。
 *   看门狗当年往引擎用户消息队列无限回投、把界面刷爆；宿主替模型判断语义 = 越权 + 噪声。
 *
 * ⛔ 纯函数：不落盘、不广播、不读存储；接线在 harness-team-ipc.ts 的收尾段。
 * ⛔ GUARDRAIL_RULES 是**拓展接口**：新增约束只往表里加一项，不改调用方结构。
 * ⛔ 判据一律保守：宁可放过，不可误吞用户能看见的正文（防丢数据是硬要求）。
 */
import { textsAreNearDuplicate } from "../../../src/lib/team-models.mjs";
/* 11-12 三条编排机制里的 ①「执行与汇报分离」落在这一条规则上：
   ⛔ 纯函数，不落盘、不改写正文；只给可见回执 + 拦住「假进度拉起一串人」。 */
import { verifyProgressClaim, type ProgressVerdict } from "../../../src/lib/group-orchestration.mjs";

/** 规则表（唯一真相源，新增同类约束只加数据）。enabled 供接线处读，方便逐条灰度/回退。 */
export const GUARDRAIL_RULES = Object.freeze({
  crossMemberDuplicate: Object.freeze({ id: "crossMemberDuplicate", enabled: true, label: "与群里已有结论近重复 ⇒ 不再触发接力" }),
  emptyOutput: Object.freeze({ id: "emptyOutput", enabled: true, label: "空产出不算完成 ⇒ 记失败并给可见原因" }),
  mentionIssues: Object.freeze({ id: "mentionIssues", enabled: true, label: "一行多 @ / @ 找不到的人 / @ 自己 ⇒ 明确回执" }),
  announcements: Object.freeze({ id: "announcements", enabled: true, label: "【群里汇报】行真发到群主流，其余内容留在话题里" }),
  progressClaim: Object.freeze({ id: "progressClaim", enabled: true, label: "自报「已派出 / 进度到第 N 环」必须有真实派活或成员产出证据" }),
});

/** ⛔ 与 buildTalkInput 里的写法、team-fold.mjs 的 ANNOUNCE_RE 逐字一致（三处同源）。 */
const ANNOUNCE_LINE = /^[ \t]*【群里汇报】[：:\s]*/;
const MENTION_INLINE = /@([^：:@\s]{1,40})\s*[：:]/g;

export type GuardrailRow = {
  id?: string;
  authorId?: string;
  authorKind?: string;
  text?: string;
  at?: number;
};

export type MentionIssues = {
  /** 一行里写了多个 @名字： 的行（parseAgentMentions 只取第一个 ⇒ 原来静默丢） */
  multiple: string[];
  /** 行首点名但名册里查不到的人 */
  unknown: string[];
  /** 点了自己 */
  self: string[];
};

export type OutputVerdict = {
  /** 是否允许这条产出继续触发「行首 @」接力派活 —— 这是本板块最硬的一道闸 */
  allowRelay: boolean;
  /** 是否算这一轮有产出（空产出要算失败，不能静默当成功） */
  countsAsOutput: boolean;
  /** 命中的近重复原文（只用于说明，⛔ 不据此吞正文） */
  duplicateOf: { id: string; text: string } | null;
  /** 要额外发到群主流的汇报内容（已剥掉前缀） */
  announcements: string[];
  /** 去掉汇报行后的正文：落盘用它，保证其余内容仍归话题 */
  mainText: string;
  mentionIssues: MentionIssues;
  /** ① 自报进度的核验结果（null = 没命中该文案）；⛔ 只给回执，不改正文 */
  progressClaim: ProgressVerdict | null;
};

/** 把 `【群里汇报】…` 行拆出来；其余正文原样保留（⛔ 不改写、不截断）。 */
export function splitAnnouncements(text: string): { announcements: string[]; mainText: string } {
  const announcements: string[] = [];
  const kept: string[] = [];
  for (const line of String(text ?? "").split("\n")) {
    if (ANNOUNCE_LINE.test(line)) {
      const body = line.replace(ANNOUNCE_LINE, "").trim();
      if (body) announcements.push(body);
    } else {
      kept.push(line);
    }
  }
  const mainText = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return GUARDRAIL_RULES.announcements.enabled ? { announcements, mainText } : { announcements: [], mainText: String(text ?? "").trim() };
}

const flatName = (v: unknown): string => String(v ?? "").replace(/\s+/g, "").toLowerCase();

/**
 * 产出是否**复述了群里已有的结论**（跨成员 / 跨轮）。
 * ⛔ 只比最近 limit 条 bot 消息、且复用保守的 textsAreNearDuplicate（长度可比 + 二元组 50%）。
 * ⛔ excludeIds 用来排除「本回合自己通过 group_say 已落的那条」——那由既有同回合判重处理，别重复记账。
 */
export function findCrossMemberDuplicate(
  output: string,
  rows: GuardrailRow[] = [],
  options: { limit?: number; excludeIds?: Set<string> } = {},
): { id: string; text: string } | null {
  if (!output || !GUARDRAIL_RULES.crossMemberDuplicate.enabled) return null;
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 12;
  const recent = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && String(r.authorKind ?? "") === "bot"
      && String(r.authorId ?? "") !== "system"
      && String(r.text ?? "").trim())
    .slice(-limit);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const row = recent[i];
    if (options.excludeIds?.has(String(row.id ?? ""))) continue;
    if (textsAreNearDuplicate(String(row.text), output)) {
      return { id: String(row.id ?? ""), text: String(row.text ?? "") };
    }
  }
  return null;
}

/** 行首 @ 的三种"静默失效"：一行多 @ / 名册里查不到 / 点了自己。⛔ 只报告，不改正文。 */
export function mentionIssuesOf(text: string, rosterNames: string[] = [], selfName = ""): MentionIssues {
  const issues: MentionIssues = { multiple: [], unknown: [], self: [] };
  if (!GUARDRAIL_RULES.mentionIssues.enabled) return issues;
  const known = new Set((Array.isArray(rosterNames) ? rosterNames : []).map(flatName));
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("@")) continue;
    const names = [...line.matchAll(MENTION_INLINE)].map((m) => String(m[1] ?? "")).filter(Boolean);
    if (names.length > 1) issues.multiple.push(line.slice(0, 60));
    for (const name of names) {
      const n = flatName(name);
      if (n === flatName(selfName)) issues.self.push(name);
      else if (!known.has(n) && !/^(管理员|admin)$/i.test(n)) issues.unknown.push(name);
    }
  }
  return issues;
}

/** 一条产出的总判定。⛔ 只判「能不能继续派活 / 算不算有产出」，不评价文本好坏。 */
export function evaluateMemberOutput(input: {
  text: string;
  recentRows?: GuardrailRow[];
  excludeIds?: Set<string>;
  rosterNames?: string[];
  selfName?: string;
  /** 本回合真实调用过的工具名（派活工具才有证据效力） */
  toolCalls?: Array<{ name?: string } | string>;
  /** 本回合其他成员的真实产出（群里已落盘的消息正文） */
  memberOutputs?: unknown[];
}): OutputVerdict {
  const raw = String(input.text ?? "").trim();
  const { announcements, mainText } = splitAnnouncements(raw);
  const progressClaim = GUARDRAIL_RULES.progressClaim.enabled
    ? verifyProgressClaim({ text: raw, toolCalls: input.toolCalls, memberOutputs: input.memberOutputs })
    : null;
  /* ⛔ 把事实摆出来：假进度不吞正文、不替模型判断，只在群主流追加一条宿主回执，
     并阻止它继续触发 @ 接力（否则一条编出来的进度会拉起一整串人烧 token）。 */
  const notices = progressClaim && !progressClaim.ok ? [...announcements, progressClaim.notice] : announcements;
  const body = mainText || (notices.length ? "" : raw);
  const countsAsOutput = Boolean(raw) && (GUARDRAIL_RULES.emptyOutput.enabled ? Boolean(body || notices.length) : true);
  const duplicateOf = findCrossMemberDuplicate(body, input.recentRows ?? [], { excludeIds: input.excludeIds });
  const mentionIssues = mentionIssuesOf(mainText, input.rosterNames ?? [], input.selfName ?? "");
  return {
    /* ⛔ 重复结论不再拉起一串人 —— 这是防止"刷屏式接力"的动作层硬闸。
       ⛔ 空产出也不接力（没内容可转达）。@ 违规不阻止有效 @ 的接力，只给可见回执。
       11-12：自报进度无证据同样不接力（① 执行与汇报分离）。 */
    /* ⛔ mainText 不许 fallback 回原文：只有汇报行时返回空串，调用方据此跳过占位正文落盘
       （否则"占位正文 + 汇报行"两条重复）。⛔ 没正文也没有可转达的内容 ⇒ 不接力。 */
    allowRelay: countsAsOutput && Boolean(mainText) && !duplicateOf && !(progressClaim && !progressClaim.ok),
    countsAsOutput,
    duplicateOf,
    announcements: notices,
    mainText,
    mentionIssues,
    progressClaim,
  };
}
