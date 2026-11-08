/**
 * 团队模式 · 运行过程折叠的口径（纯函数，11-06）
 *
 * 用户要求：把**对话框里的运行过程**搬到群里一条消息的下面，默认折叠；
 * 只有最终正文作为正常消息发出，过程不进消息流；折叠头文字跟着过程内容走。
 *
 * ⛔ 这里只做两件"选数据"的纯计算，⛔ 不渲染、⛔ 不拉引擎：
 *   ① 从 `thread/turns/list` 的回合理挑出**这条群消息对应的那个回合**；
 *   ② 给每条伙伴消息找到它之前最近一条人类消息，做折叠块上方的引用行。
 * 过程/正文的分组直接用主对话的 `src/lib/turn-fold.ts`（classifyUnit / planCompletedFold / …），
 * 折叠头文案用主对话的 `dialogFlowStepTitle` —— ⛔ 群视图不写第二套口径。
 */

/** 引用行里原文最多几个字。 */
export const FOLD_QUOTE_CHARS = 60;

/**
 * 引擎 `thread/turns/list` 的 startedAt/completedAt 是**秒级** Unix 时间戳（实测 10 位），
 * 群消息 `at` 是 `Date.now()` 的**毫秒**。⛔ 不归一就会差 1e12，时间兜底永远失效。
 */
export function epochMsOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

/** 正文比对只取开头这么多字（长回复尾部可能被截断，比前段最稳）。 */
const BODY_MATCH_CHARS = 120;

/** 一个回合的最终正文（与主进程 turnOutputText 同口径：只认 agentMessage）。 */
export function turnBodyOf(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return items
    .filter((i) => i?.type === "agentMessage")
    .map((i) => String(i?.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 从 `thread/turns/list` 的返回里挑出这条群消息所属的回合。
 * 判定顺序（⛔ 不靠"最新一条"猜：同一个伙伴的子会话会被复用，里面有多轮）：
 *   ① 正文前缀一致（最硬：群日志存的正是 turnOutputText）；
 *   ② 完成时刻离群消息 at 最近（±10 分钟内）；
 *   ③ 兜底最新一条（老会话没有时间字段时）。
 * @param turns `thread/turns/list` 的 data 数组（desc 或 asc 都行）
 */
export function pickTurnOf(turns, at = 0, bodyText = "") {
  const list = Array.isArray(turns) ? turns.filter(Boolean) : [];
  if (!list.length) return null;
  const body = String(bodyText ?? "").trim().slice(0, BODY_MATCH_CHARS);
  if (body) {
    const hit = list.find((t) => turnBodyOf(t).trim().slice(0, BODY_MATCH_CHARS) === body);
    if (hit) return hit;
  }
  const stamp = Number(at) || 0;
  if (stamp) {
    const timed = list
      .map((t) => ({ t, ms: epochMsOf(t?.completedAt ?? t?.startedAt) }))
      .filter((x) => x.ms > 0)
      .sort((a, b) => Math.abs(a.ms - stamp) - Math.abs(b.ms - stamp));
    if (timed.length && Math.abs(timed[0].ms - stamp) <= 10 * 60_000) return timed[0].t;
  }
  return list[0] ?? null;
}

/**
 * 引用索引：每条伙伴消息 → **它实际回复的那条消息**（作者 id + 原文截断）。
 *
 * ⛔⛔ 11-08 用户实测：「他是回复主代理的，不是回复我的，而且都写了『由 软件开发专家团 叫来』，
 *     怎么引用了我的消息？」——旧版一律引用「最近一条人类消息」，把主代理叫来的那条回复
 *     也算到用户头上。⇒ **回复谁就引谁**：
 *       · 带 `via`（被某位伙伴叫来）⇒ 引群里 `via.memberId` 在这条之前最近说的那句；
 *       · 找不到（那条还没落盘 / 被裁剪）⇒ 才回退到最近一条人类消息；
 *       · 无 `via`（用户直接派活）⇒ 仍是最近一条人类消息（含定时任务，authorId=automation）。
 * ⛔ 只按已排序的 rows 走一遍，⛔ 不按 threadId / 会话猜"回复了谁"。
 * @returns Map<row.key, { authorId, text }>
 */
/**
 * 话题消息（11-08 用户令）：把伙伴回复**收进用户消息气泡**，主流只留用户消息。
 *
 * 规则（⛔ 与截图的「话题消息」同口径，不按 threadId / 会话猜）：
 *   · 每条非 bot 消息 = 一个话题根（用户 / 定时任务 / 系统都算）；
 *   · 其后所有 bot 回复（含伙伴之间互 @ 的）都归到这个根，直到下一条非 bot 消息；
 *   · 话题条显示 N 条回复 + 头像栈 + 最后一条缩略，点击弹窗预览完整话题串。
 * ⛔ 纯函数：只分组，不渲染、不改行。返回 Map<root.key, { root, replies }>。
 */
export function buildTopicThreads(rows) {
  const out = new Map();
  let rootKey = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.key) continue;
    if (r.authorKind !== "bot") {
      rootKey = r.key;
      out.set(rootKey, { root: r, replies: [] });
      continue;
    }
    if (rootKey && out.has(rootKey)) out.get(rootKey).replies.push(r);
  }
  return out;
}

export function buildReplyQuotes(rows) {
  const out = new Map();
  let lastHuman = null;
  const lastByAuthor = new Map();
  const snippet = (row) => String(row?.text ?? "").replace(/\s+/g, " ").trim().slice(0, FOLD_QUOTE_CHARS);
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.key) continue;
    const text = snippet(r);
    const authorId = String(r.authorId ?? "");
    if (r.authorKind !== "bot") {
      if (text) lastHuman = { authorId, text };
    } else {
      const viaId = String(r?.via?.memberId ?? "");
      const caller = viaId ? lastByAuthor.get(viaId) : null;
      const source = (caller && caller.text) ? caller : (lastHuman && lastHuman.text ? lastHuman : null);
      if (source) out.set(r.key, source);
    }
    /* ⛔ 每条消息都要登记（包括 human）：后面被它叫来的伙伴才能引到它。 */
    if (text && authorId) lastByAuthor.set(authorId, { authorId, text });
  }
  return out;
}
