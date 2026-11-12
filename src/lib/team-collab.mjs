/**
 * 工作伙伴 · 群内协作的**判断标准**（11-10 用户令：「明确消息流转与确认规则，
 * 界定什么时候收尾、什么时候继续推进，给出可落地的判断标准」）。
 *
 * ⛔ 为什么单独一个文件：这是"该不该再叫人"的唯一判据，必须**可解释、可测、无副作用**。
 *   放在 IPC 里就会变成一堆 if，既测不了也会和渲染层漂。纯函数 ⇒ 守卫直接 import 真跑。
 * ⛔ 本文件不读文件、不发消息、不看时钟（一切输入都由调用方给）。
 *
 * ── 流转模型（三种，穷尽）────────────────────────────────────────────────
 *   handoff  ：A 的产出里点名了 B ⇒ 派给 B，登记一条"待确认"。A 不进锁、不等待。
 *   report   ：B 做完（不论成败）⇒ 回投给 A ⇒ A 获得"验收 / 继续 / 换人"的一次机会。
 *   broadcast：产出没点任何人 ⇒ 只进群记录，不触发任何人（⛔ 不猜"他可能想说给谁"）。
 *
 * ── 确认规则（ack）──────────────────────────────────────────────────────
 *   每条 handoff 有三个终态，缺一个就会出现"发出去没人管"：
 *     done    B 交了产出（哪怕他觉得没做完，也算"回了"）
 *     failed  B 那一轮失败（调用方拿到 error）
 *     timeout 到本轮结束它还没回（⛔ 必须回投发起者，不能静默蒸发）
 *   ⇒ `settleHandoffs()` 负责把超时的挑出来；`pendingOf()` 负责"还有人在等"。
 *
 * ── 继续 / 收尾（可落地判据）──────────────────────────────────────────────
 *   继续推进，任一成立：
 *     ① 有 handoff 未确认（有人在等回话）—— 交给被叫的人，不用主理人插手
 *     ② 本轮有**实质推进**：新建了任务 / 写出了文件 / 确认了一条 handoff
 *     ③ 产出里明确出现"下一步/接下来/继续"这类推进词
 *   收尾，任一成立：
 *     ① 产出里出现收尾词（收口/结论/到此为止…）**且**没有未确认的 handoff
 *     ② 连续 `MAX_IDLE_ROUNDS` 轮都没有实质推进（只是在聊天）
 *     ③ 预算或回合用尽（这是安全阀，不是设计目标）
 *   ⛔ 判据顺序固定：先看"有没有人在等" ⇒ 再看"有没有推进" ⇒ 最后才看预算。
 *      顺序错了会出现"活还没干完就以预算为由散会"。
 */

/** 收尾词：主理人/成员明确表示"这段完了"。⛔ 只认这些明确的说法，不猜语气。 */
export const WRAP_SIGNALS = Object.freeze([
  "收口", "结论", "到此为止", "没有后续", "已完成", "收尾", "散会", "先这样", "就这样",
]);

/** 推进词：明确要求下一步。⛔ 只用来"加分"，不单独决定继续（否则每句话都像要接着聊）。 */
export const CONTINUE_SIGNALS = Object.freeze([
  "下一步", "接下来", "接着", "然后", "继续",
]);

/** 连续多少轮没有任何实质推进就收尾。 */
export const MAX_IDLE_ROUNDS = 2;

/** 「活还没完」的任务状态 —— 只要群里有这些，就不该收尾（⛔ 与预算无关，看事实）。 */
/* ⛔⛔ 11-10 审查抓到：这里原来漏了 "open" —— 工作伙伴群的任务账本用的正是 open，
   漏了它 ⇒ openTaskCount 永远算出 0 ⇒ 收尾判据把「活没干完」当成「干完了」，直接散会。
   两套状态（boss-groups 的 queued… 和团队群的 open）必须都在表里。 */
export const OPEN_TASK_STATES = Object.freeze(["open", "queued", "assigned", "running", "submitted", "reviewing"]);

/** 群里还有几个活没结束。 */
export function openTaskCount(tasks) {
  const list = Array.isArray(tasks) ? tasks : Object.values(tasks ?? {});
  return list.filter((t) => OPEN_TASK_STATES.includes(String(t?.status ?? ""))).length;
}

export const HANDOFF_STATES = Object.freeze({ pending: "pending", done: "done", failed: "failed", timeout: "timeout" });

function textOf(value) {
  return String(value ?? "");
}

/** 产出里是否明确表示"收口"。返回命中的词（空串 = 没有）。 */
export function wrapSignalOf(text) {
  const body = textOf(text);
  if (!body.trim()) return "";
  /* ⛔ 只看最后 400 字：收口是结尾才会说的话；开头提"结论"往往是在讲要做什么。 */
  const tail = body.length > 400 ? body.slice(-400) : body;
  return WRAP_SIGNALS.find((word) => tail.includes(word)) ?? "";
}

/** 产出里是否有"推进"的语气（只作加分项）。 */
export function continueSignalOf(text) {
  const body = textOf(text);
  if (!body.trim()) return "";
  const tail = body.length > 400 ? body.slice(-400) : body;
  return CONTINUE_SIGNALS.find((word) => tail.includes(word)) ?? "";
}

/**
 * 本轮有没有**实质推进**。
 * ⛔ 纯文字回复不算推进 —— 否则两个人可以互相"好的""收到"聊到预算耗尽。
 */
export function progressOf(input = {}) {
  /* ⛔ Number(undefined) 是 NaN，Math.max(0, NaN) 仍是 NaN ⇒ 一处脏输入会把整个判据变 NaN。
     用 num() 统一兜底（NaN / 负数 / 非数字一律当 0）。 */
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  return num(input.createdTasks) + num(input.writtenFiles) + num(input.ackedHandoffs);
}

/** 还没被确认的 handoff（有人在等回话）。 */
export function pendingOf(handoffs) {
  const list = Array.isArray(handoffs) ? handoffs : [];
  return list.filter((h) => String(h?.state ?? "") === HANDOFF_STATES.pending);
}

/**
 * 到点未回的 handoff ⇒ 标 timeout（调用方据此回投发起者）。
 * ⛔ 返回的是**新的**数组，不改入参（纯函数）。
 */
export function settleHandoffs(handoffs, now, timeoutMs) {
  const list = Array.isArray(handoffs) ? handoffs : [];
  const limit = Math.max(0, Number(timeoutMs ?? 0));
  const at = Number(now ?? 0);
  return list.map((h) => {
    if (String(h?.state ?? "") !== HANDOFF_STATES.pending) return h;
    const started = Number(h?.at ?? 0);
    if (!started || !limit || at - started < limit) return h;
    return { ...h, state: HANDOFF_STATES.timeout, settledAt: at };
  });
}

/**
 * 用户这句是不是「提问 / 要信息」，而不是「布置任务」。
 *
 * ⛔ 为什么需要它：团群主理人答完一条信息类问题后，宿主若把这句当成"给了活"，
 *   会再催它一轮「去派成员」⇒ 它只好再回一条「这是信息答复，没有成品要派，收口」——
 *   用户看到的就是**同一个问题被自动回复了两条**（11-12 用户截图实测）。
 * ⛔ 判据口径：问句词**任意位置**命中（不只行首）+ 信息类动词。中文提问几乎必带
 *   「什么 / 怎么 / 吗 / 哪 / 能不能…」之一，或「介绍 / 告诉我 / 擅长…」这类要信息的说法。
 * ⛔ 宁可漏催一次，也不能把"回答"当成"该推进了"：漏催只是少派一轮，误催就是刷屏。
 * 纯函数、无副作用 ⇒ 守卫直接 import 跑真值表。⛔ 别在 IPC 里再写第二套问句判据。
 */
export function isInfoRequest(text) {
  const plain = String(text ?? "").replace(/@[^\s：:]+/g, "").trim();
  if (!plain) return false;
  return /[?？]/.test(plain)
    || /(什么|怎么|怎样|如何|为什么|为啥|哪|吗|呢|谁|多少|几个|能不能|可不可以|是不是|有没有|会不会)/.test(plain)
    || /(介绍|说说|讲讲|聊聊|告诉我|擅长|流程|分工|协作|能做什么|会做什么|干什么的)/.test(plain);
}

/**
 * **这一步该干什么** —— 唯一判据入口。
 *
 * @returns {{ action: "handoff"|"wait"|"continue"|"wrap", reason: string }}
 *   handoff ：产出点了人 ⇒ 派给他（调用方负责真的派）
 *   wait    ：有人在等回话，而这次产出没点人 ⇒ 什么都别做（等对方回）
 *   continue：没人等、也没收尾 ⇒ 给主理人一次"下一步"的机会
 *   wrap    ：该收尾（给理由，调用方据此写结论/停链）
 */
export function classifyTurn(input = {}) {
  const handoffTo = textOf(input.handoffTo).trim();
  const text = textOf(input.text);
  const handoffs = Array.isArray(input.handoffs) ? input.handoffs : [];
  const budgetLeft = Number(input.budgetLeft ?? 0);
  const idleRounds = Math.max(0, Number(input.idleRounds ?? 0));
  const progress = progressOf(input.progress ?? {});
  /* ⛔ 11-10 修：这里原来把 openTasks 当摆设。现在它是**收尾的第一判据** ——
     "活还没干完"比"预算还剩多少"重要得多，比"模型说了收口"也更可信（模型会漏）。 */
  const openTasks = Math.max(0, Number(input.openTasks ?? 0));

  /* ① 产出点了人 ⇒ 先派，别的都不重要（有人在等接下来的话）。 */
  if (handoffTo) {
    return { action: "handoff", reason: `点了 ${handoffTo}，先交给他` };
  }
  /* ② 还有人没回 ⇒ 等，不催（催就是刷屏，且会让被叫的人收到重复指令）。 */
  const pending = pendingOf(handoffs);
  if (pending.length) {
    return { action: "wait", reason: `还有 ${pending.length} 条在等回话（${pending.map((h) => h?.to ?? "?").join("、")}）` };
  }
  /* ③ ⛔⛔ 群里有没结束的任务 ⇒ **必须继续**（这是"任务推进"而不是"聊够了"的唯一硬证据）。
     预算见底也要继续 —— 由调用方决定扩容或如实告知用户"活没干完但预算用尽"，⛔ 不许悄悄收尾。 */
  if (openTasks > 0) {
    /* ⛔ 预算见底也要继续 —— 但要把「超预算」这个事实交出去（调用方负责扩容或如实告知），
       ⛔ 不许在这里悄悄收尾。之前写了个 `budgetLeft > 0 ? "continue" : "continue"` 的假三元，
          看着像分流其实两边一样，纯粹是坑读代码的人。 */
    return {
      action: "continue",
      reason: `还有 ${openTasks} 个任务没结束${budgetLeft > 0 ? "（继续推进）" : "（预算已尽，需要如实告知并扩容）"}`,
      ...(budgetLeft > 0 ? {} : { overBudget: true }),
    };
  }
  /* ④ 收尾词 + 活已干完 ⇒ 收尾。 */
  const wrapWord = wrapSignalOf(text);
  if (wrapWord) return { action: "wrap", reason: `产出里明说「${wrapWord}」，且没有未完成任务` };
  /* ⑤ 连续多轮没推进 ⇒ 收尾（防"好的/收到"式空转）。 */
  if (idleRounds >= MAX_IDLE_ROUNDS) {
    return { action: "wrap", reason: `连续 ${idleRounds} 轮没有实质推进` };
  }
  /* ⑥ 有推进 或 有推进语气 ⇒ 继续给主理人一次机会。 */
  if (progress > 0) return { action: "continue", reason: `本轮有 ${progress} 项实质推进` };
  if (continueSignalOf(text)) return { action: "continue", reason: "产出里提到下一步" };
  /* ⑦ 什么都没发生 ⇒ 继续（让主理人决定收口还是点名），但由 idleRounds 兜住不会无限。 */
  if (budgetLeft > 0) return { action: "continue", reason: "本轮无推进，交给主理人决定下一步或收口" };
  /* ⑧ 预算耗尽 = 安全阀。 */
  return { action: "wrap", reason: "接力预算用尽且没有未完成任务" };
}
