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
 *   ② 完成时刻离群消息 at 最近（默认 ±10 分钟内）；
 *   ③ 兜底：**只有整份列表都没有时间字段**（老数据）才退回最新一条 ——
 *      有时间但全部对不上 ⇒ 返回 null（⛔ 宁可不出卡，也不把上一轮的文件挂到这条消息下面）。
 * @param turns `thread/turns/list` 的 data 数组（desc 或 asc 都行）
 * @param opts  `maxGapMs` 收紧时间窗（刚结束的消息用，防止挑到跑之前的旧回合）；
 *              `allowNewestFallback: false` 禁止超窗兜底最新一条。
 */
export function pickTurnOf(turns, at = 0, bodyText = "", opts = {}) {
  const list = Array.isArray(turns) ? turns.filter(Boolean) : [];
  if (!list.length) return null;
  const body = String(bodyText ?? "").trim().slice(0, BODY_MATCH_CHARS);
  if (body) {
    const hit = list.find((t) => turnBodyOf(t).trim().slice(0, BODY_MATCH_CHARS) === body);
    if (hit) return hit;
  }
  const stamp = Number(at) || 0;
  const maxGap = Number(opts?.maxGapMs) > 0 ? Number(opts.maxGapMs) : 10 * 60_000;
  const allowNewest = opts?.allowNewestFallback !== false;
  if (stamp) {
    const timed = list
      .map((t) => ({ t, ms: epochMsOf(t?.completedAt ?? t?.startedAt) }))
      .filter((x) => x.ms > 0)
      .sort((a, b) => Math.abs(a.ms - stamp) - Math.abs(b.ms - stamp));
    if (timed.length && Math.abs(timed[0].ms - stamp) <= maxGap) return timed[0].t;
    /* 有时间字段但都对不上：⛔ 不许拿"最新一条"凑数（那会把上一轮的文件卡挂到这条消息下）。 */
    if (timed.length) return null;
  }
  if (!allowNewest) return null;
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
/** 话题里的「汇报到群主流」标记（⛔ 与 buildTalkInput 里的写法必须逐字一致）。 */
const ANNOUNCE_RE = /^[ \t]*【群里汇报】/m;

export function buildTopicThreads(rows) {
  const out = new Map();
  let rootKey = null;
  /* ⛔⛔ 11-09 用户（飞书对照截图）：「话题就是迷你群聊……后续的消息都在话题里面更新，
     而不是在群里更新」。⇒ 原来的口径「每条非 bot 消息都开新话题」是错的：
     在话题里接着说一句，就变成了**另一个话题**，看着像消息跑去群里了。
     ⇒ 新口径：非 bot 消息若**带着引用**（`> …` 开头，且引的就是某个已有话题的根），
        就并进那个话题（它自己也成为该话题的一条），其后的伙伴回复继续归这个话题。
        ⛔ 判据只用正文（落盘就带 `>` 前缀，刷新后仍成立），⛔ 不新加字段、⛔ 不改落盘结构。 */
  const norm = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  /** 取正文开头的引用段（连续 `>` 行），返回规范化后的文本；没有引用返回 ""。 */
  const quoteOf = (text) => {
    const quoted = [];
    for (const line of String(text ?? "").split("\n")) {
      if (/^[ \t]*>/.test(line)) quoted.push(line.replace(/^[ \t]*>\s?/, ""));
      else if (quoted.length) break;
    }
    return quoted.length ? norm(quoted.join(" ")) : "";
  };
  /** 引用 → 已有话题根。⛔ 用前缀比对（引用可能被截断 / 根消息很长），不做全文相等。 */
  const ownerOf = (quote) => {
    if (!quote) return null;
    const head = quote.slice(0, 80);
    let hit = null;
    for (const [key, thread] of out) {
      const root = norm(thread?.root?.text);
      if (!root) continue;
      const rootHead = root.slice(0, 80);
      if (quote.startsWith(rootHead) || root.startsWith(head) || (head.length >= 8 && rootHead.startsWith(head))) {
        hit = key; // 取**最近一个**匹配（后面的更可能是它要接的那条）
      }
    }
    return hit;
  };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.key) continue;
    if (r.authorKind !== "bot") {
      const owner = ownerOf(quoteOf(r.text));
      if (owner) { out.get(owner).replies.push(r); rootKey = owner; continue; }
      rootKey = r.key;
      out.set(rootKey, { root: r, replies: [] });
      continue;
    }
    /* ⛔⛔ 11-09 用户：「在话题里面，重要的消息也可以在外面汇报」。
       伙伴在话题里回复时，只要**单独一行**写 `【群里汇报】…`，这一条就**不进话题** ——
       它留在群主流当一条独立消息（其余内容照旧留在话题里）。prompt 侧已写明这个写法。
       ⛔ rootKey 保持不变：汇报完之后的回复仍然属于原话题。 */
    if (ANNOUNCE_RE.test(String(r.text ?? ""))) continue;
    if (rootKey && out.has(rootKey)) out.get(rootKey).replies.push(r);
  }
  return out;
}

/**
 * 话题条按**渲染行**取数据（11-08 Code review 发现的真缺陷）。
 *
 * ⛔ 群视图用 `mergeConsecutive()` 把 90 秒内同一作者的连续消息并成一行：
 *    合并后的行只保留第一条的 `key`，其余进 `continued`。而 `buildTopicThreads(rows)`
 *    按全量 rows 分组，每条非 bot 消息都是独立根 ⇒ 连发两条用户消息时，
 *    第二条的伙伴回复挂在 `u2` 上，渲染却只查 `u1` ⇒ 话题条为空、弹窗里也看不到回复。
 * ⇒ 这里把主行 + continued 子行的话题 replies 合并成一份（root 用渲染行的完整文本）。
 * @returns { root, replies } | undefined
 */
export function topicThreadOf(threads, displayRow) {
  const keys = [displayRow?.key, ...(displayRow?.continued ?? []).map((r) => r?.key)].filter(Boolean);
  const seen = new Set();
  const replies = [];
  for (const key of keys) {
    const thread = threads.get(key);
    if (!thread || seen.has(thread)) continue;
    seen.add(thread);
    replies.push(...thread.replies);
  }
  if (!seen.size) return undefined;
  const extra = (displayRow?.continued ?? []).map((r) => String(r?.text ?? "")).filter(Boolean);
  return {
    root: extra.length
      ? { ...displayRow, text: [String(displayRow?.text ?? ""), ...extra].join("\n") }
      : displayRow,
    replies,
  };
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
