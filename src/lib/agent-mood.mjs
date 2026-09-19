// src/lib/agent-mood.mjs —— 「会话状态」的单一存放处与语气映射（纯函数，零依赖）
//
// 为什么写它（09-19 用户要求「想要 agent 有状态、语气跟着变」）：
//   同一个会话里连续失败十次和一次就成功，agent 的说法完全一样 —— 用户读到的是
//   「它没在状态里」。这一层给**每个会话**维护少量状态（心情/精力/默契），按回合结果
//   更新，再映射成一句「只影响说法、不影响内容」的语气指引，随会话自己的 instructions 下发。
//
// ⛔ 会话独立性（09-19 定下的铁律）：状态**按会话各自一份**（键族 `agent-mood-<threadId>`），
//   注入走会话自己的 developer instructions（thread/settings/update 的 collaborationMode）。
//   A 会话的低落**绝不会**改到 B 会话的语气上 —— 这是本模块存在的底线，不是优化项。
//
// ⛔ 只进「语气」，不进「内容」：映射文本里必须写明「事实/结论/代码一律照常」，
//   并禁止 agent 在回复里谈论自己的状态（否则用户会收到「我现在心情不错」这种噪音）。
//
// 本模块是纯函数：归一化 / 信号更新 / 时间衰减 / 映射 / 拼块 / 幂等剥离 / 变化签名。
// 行为断言在 scripts/check-preflight.mjs（直接 import 跑真实现）。

/** 注入块首行标记 —— 幂等剥离与「是否已注入」判定都以它为锚。 */
export const MOOD_HEADING = "会话状态（语气自适应·仅供风格参考）";

/** 状态基线：所有信号都围绕它涨落，长时间不活动也回落到它附近。 */
export const MOOD_BASELINE = { valence: 0, energy: 0.5, rapport: 0 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** 空状态（字段恒在，避免各处 `?? 0`） */
export function emptyMood() {
  return { valence: MOOD_BASELINE.valence, energy: MOOD_BASELINE.energy, rapport: MOOD_BASELINE.rapport, turns: 0, okStreak: 0, failStreak: 0, updatedAt: 0 };
}

/** 归一化任意输入（坏 JSON / 缺字段 / 越界数值）→ 完整且有界的对象 */
export function normalizeMood(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const turns = Math.floor(num(src.turns, 0));
  return {
    valence: clamp(num(src.valence, MOOD_BASELINE.valence), -1, 1),
    energy: clamp(num(src.energy, MOOD_BASELINE.energy), 0.05, 1),
    rapport: clamp(num(src.rapport, MOOD_BASELINE.rapport), 0, 1),
    turns: turns > 0 ? turns : 0,
    okStreak: Math.max(0, Math.floor(num(src.okStreak, 0))),
    failStreak: Math.max(0, Math.floor(num(src.failStreak, 0))),
    updatedAt: Math.max(0, num(src.updatedAt, 0)),
  };
}

/**
 * 时间衰减：隔得越久越回落到基线（避免「三天前的一次失败」永久压着今天的语气）。
 * 以 30 分钟为一档，每档朝基线收敛 30%，最多 5 档（约 2.5 小时后基本回落）。
 * @param {unknown} raw @param {number} now 当前时间戳（显式传入便于纯函数断言）
 */
export function decayMood(raw, now = Date.now()) {
  const state = normalizeMood(raw);
  if (!state.updatedAt) return state;
  const idleMs = Math.max(0, now - state.updatedAt);
  const steps = Math.min(5, Math.floor(idleMs / (30 * 60 * 1000)));
  if (steps <= 0) return state;
  const keep = Math.pow(0.7, steps);
  return normalizeMood({
    ...state,
    valence: MOOD_BASELINE.valence + (state.valence - MOOD_BASELINE.valence) * keep,
    energy: MOOD_BASELINE.energy + (state.energy - MOOD_BASELINE.energy) * keep,
    rapport: state.rapport * keep,
    // 连败/连胜也一并清零：隔着几十分钟的「连续」不成立
    okStreak: steps >= 2 ? 0 : state.okStreak,
    failStreak: steps >= 2 ? 0 : state.failStreak,
    updatedAt: now,
  });
}

/** 支持的信号（回合级事实，全部来自引擎的权威事件；见 App.tsx 的跨会话生命周期区） */
export const MOOD_SIGNALS = ["turn-ok", "turn-fail", "user-warm", "user-frustrated"];

/**
 * 按信号更新状态（纯函数）。
 * @param {unknown} raw 现有状态
 * @param {string} signal MOOD_SIGNALS 之一
 * @param {number} now
 */
export function applyMoodSignal(raw, signal, now = Date.now()) {
  const state = normalizeMood(raw);
  const next = { ...state, updatedAt: now };
  switch (signal) {
    case "turn-ok": {
      next.turns = state.turns + 1;
      next.okStreak = state.okStreak + 1;
      next.failStreak = 0;
      // 成功向「偏正但不满格」收敛：+0.08，越高越难再涨（避免几次成功就飘）
      next.valence = state.valence + 0.08 * (1 - Math.max(0, state.valence));
      next.energy = state.energy + 0.05;
      next.rapport = state.rapport + 0.03;
      break;
    }
    case "turn-fail": {
      next.turns = state.turns + 1;
      next.failStreak = state.failStreak + 1;
      next.okStreak = 0;
      // 连败加重：第一次 -0.12，之后每连败一次多 -0.03，最多 -0.30
      // （state.failStreak 是**更新前**的连败次数：0 = 这是第一次失败）
      const penalty = Math.min(0.3, 0.12 + 0.03 * state.failStreak);
      next.valence = state.valence - penalty;
      next.energy = state.energy - 0.06;
      break;
    }
    case "user-warm": {
      next.valence = state.valence + 0.12 * (1 - Math.max(0, state.valence));
      next.rapport = state.rapport + 0.06;
      next.energy = state.energy + 0.03;
      break;
    }
    case "user-frustrated": {
      next.valence = state.valence - 0.1;
      // 用户急了 → 精力上调（要更专注、更快给结论），不是一起低落
      next.energy = state.energy + 0.06;
      break;
    }
    default:
      return state;
  }
  return normalizeMood(next);
}

/** 组合：先按时间衰减，再吃信号（调用方一行搞定） */
export function advanceMood(raw, signal, now = Date.now()) {
  return applyMoodSignal(decayMood(raw, now), signal, now);
}

/** 默契档位（用于签名与文案，避免把浮点写进签名导致每回合都重新下发） */
export function rapportBand(raw) {
  const r = normalizeMood(raw).rapport;
  if (r >= 0.6) return "close";
  if (r >= 0.25) return "warm";
  return "fresh";
}

/**
 * 状态 → 语气档。**这是本功能的全部产品语义**，集中在一处便于评审与调整。
 * @returns {{ key: string, label: string, tone: string }}
 */
export function moodTone(raw) {
  const s = normalizeMood(raw);
  if (s.energy <= 0.25) {
    return { key: "terse", label: "极简", tone: "语气尽量精简：短句、要点式，不铺垫，把篇幅留给正事。" };
  }
  if (s.valence <= -0.35) {
    return { key: "sober", label: "收紧", tone: "语气收敛一些：少客套、少表情、不卖萌，先给结论和下一步。" };
  }
  if (s.valence >= 0.35 && s.energy >= 0.55) {
    return { key: "brisk", label: "轻快", tone: "语气可以轻快一点：直接、利落，允许一点点幽默，但别浮夸。" };
  }
  return { key: "steady", label: "平稳", tone: "保持平稳、专业、直接的语气。" };
}

const pct = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;

/**
 * 生成对模型可见的「会话状态」块（随会话自己的 developer instructions 下发）。
 * 措辞守两条：① 只谈说法，不谈内容；② 禁止 agent 在回复里提及这段状态。
 */
export function moodBlock(raw, now = Date.now()) {
  const s = decayMood(raw, now);
  if (!s.updatedAt && s.turns === 0) return "";
  const tone = moodTone(s);
  const moodWord = s.valence >= 0.35 ? "不错" : s.valence <= -0.35 ? "偏低" : "平稳";
  const energyWord = s.energy >= 0.6 ? "充足" : s.energy <= 0.3 ? "偏低" : "一般";
  const band = rapportBand(s);
  const bandWord = band === "close" ? "熟悉" : band === "warm" ? "顺手" : "初期";
  const streak = s.failStreak >= 2 ? `最近连续 ${s.failStreak} 次回合不顺利` : s.okStreak >= 3 ? `最近连续 ${s.okStreak} 次回合顺利` : "最近进展平稳";
  return [
    MOOD_HEADING,
    `- 本会话累计 ${s.turns} 个回合；${streak}。`,
    `- 状态估值：心情 ${moodWord}（${pct((s.valence + 1) / 2)}）· 精力 ${energyWord}（${pct(s.energy)}）· 默契 ${bandWord}（${pct(s.rapport)}）`,
    `- 本次回复的语气：**${tone.label}** —— ${tone.tone}`,
    "",
    "以上**只影响说法，不影响内容**：事实、结论、代码、风险提示一律照常，不得为了配合语气而模糊、省略或夸张。",
    "与用户的明确要求冲突时（比如对方说「简短点」「详细说」），一律以用户要求为准。",
    "⛔ 不要在回复里谈论这个状态本身，也不要说「我现在心情／精力如何」——它是内部风格提示，不是话题。",
  ].join("\n");
}

/** 剥离历史注入块（幂等保护：基线文本里若混进状态块，不会越拼越长）。
 *  组合时的分隔符（`---`）一并剥掉，否则每次重发都会多留一条横线。 */
export function stripMoodBlock(text) {
  const raw = text === undefined || text === null ? "" : String(text);
  if (!raw) return "";
  const at = raw.indexOf(MOOD_HEADING);
  if (at < 0) return raw;
  return raw.slice(0, at).replace(/(?:\s*---)?\s*$/, "");
}

/** 组合：基线在前、状态块在后（与 session-scope 同一套约定）。
 *  ⛔ 基线必须原样带上（config.toml 的 developer_instructions：语言/工具/自动化说明），
 *  否则状态块会把基线顶掉 —— 模型就不知道 nuphus-call / generate-image 这些怎么用了。 */
export function composeMoodInstructions(base, block) {
  const cleanBase = stripMoodBlock(base);
  const cleanBlock = block === undefined || block === null ? "" : String(block).trim();
  if (!cleanBlock) return cleanBase;
  return cleanBase ? `${cleanBase}\n\n---\n\n${cleanBlock}` : cleanBlock;
}

/**
 * 变化签名：只有**语气档或默契档真的变了**才需要重新下发。
 * ⛔ 绝不能把 valence/energy 的浮点写进签名 —— 每回合都会变 ⇒ 每回合都发一次
 *   thread/settings/update，白耗往返（下发去重在 App.tsx 的 scopeSigRef）。
 */
export function moodSignature(raw) {
  const s = normalizeMood(raw);
  if (!s.updatedAt && s.turns === 0) return "";
  return `${moodTone(s).key}|${rapportBand(s)}`;
}

/** 用户的语气信号（关键词法，够用即可；只在**用户消息**上判定） */
export function userSignalOf(text) {
  const t = String(text ?? "");
  if (!t) return "";
  if (/(谢谢|多谢|感谢|辛苦|太好了|不错|厉害|牛逼|给力|棒|赞|可以呀|完美)/.test(t)) return "user-warm";
  if (/(不对|错了|又错|怎么又|搞什么|垃圾|废物|你他妈|他妈|操|烦死|慢死|快点|赶紧|别废话|说了几遍|说了几百|听不懂|不行啊)/.test(t)) return "user-frustrated";
  return "";
}
