/**
 * 实时语音的「外放回声剔除」（10-08 用户报：开外放时 Codex 把自己说出去的话录回来，当成用户发的语音）。
 *
 * 为什么要有这一层：已有防护是 **DSP**（浏览器 AEC3 或自研 NLMS 参考环）＋ **打断门控**。
 * ⛔ 而门控只管「要不要打断」，**不管「这段算不算用户的话」** —— 采集音频是无条件喂给识别的
 *   （use-voice-call-float-state 里 `window.codex.voiceAudio(cleaned)` 没有任何判别），
 *   所以 AEC 没消干净的喇叭声照样能被识别成文本、当成用户消息发出去（外放 / 音量偏大时最明显）。
 * 这里补的是**文本级**判据：播报中、或播报刚结束的尾巴窗口内，识别文本与「正在朗读的文本」
 * 高度相似 ⇒ 判为回声丢弃。
 *
 * ⛔⛔ 刻意**不能**改成「播报期间不喂识别」：那会把「开口即打断」一起废掉（用户明确要这个能力）。
 * ⛔ 本模块是纯函数（不 import electron / 不碰 DOM）⇒ 守卫可以直接 import 它跑真值表。
 */
export const ECHO_TAIL_MS = 1500;
export const ECHO_MIN_CHARS = 8;
export const ECHO_SIMILARITY = 0.72;

/** 归一化：去掉空白与标点符号、统一小写（ASR 与 TTS 文本的标点几乎不会一致，留着只会稀释相似度）。 */
export function normalizeForEcho(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 字符二元组词频。 */
function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice 系数（字符二元组）：`2|A∩B| / (|A|+|B|)`。对短文本比 Jaccard 宽容，且对多字重复稳健。 */
export function echoSimilarity(a, b) {
  const x = normalizeForEcho(a);
  const y = normalizeForEcho(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // 包含关系直接判定（TTS 是整轮文本，麦克风听到的通常是其中一句）
  if (x.length >= ECHO_MIN_CHARS && y.includes(x)) return 1;
  if (y.length >= ECHO_MIN_CHARS && x.includes(y)) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const A = bigrams(x);
  const B = bigrams(y);
  let aCount = 0;
  let bCount = 0;
  let inter = 0;
  for (const [g, n] of A) {
    aCount += n;
    inter += Math.min(n, B.get(g) ?? 0);
  }
  for (const [, n] of B) bCount += n;
  if (!aCount || !bCount) return 0;
  return (2 * inter) / (aCount + bCount);
}

/**
 * 这段识别文本是不是「喇叭里回灌的我自己」？
 *
 * @param {{ heard?: string, spoken?: string, speaking?: boolean, msSinceSpoken?: number }} input
 *   heard          —— 刚识别出来的文本（ASR final）
 *   spoken         —— 本轮正在朗读的文本（agentTextRef）
 *   speaking       —— 是否正在播报
 *   msSinceSpoken  —— 距上一次播报结束过了多少毫秒（尾巴窗口用）
 * @returns {boolean} true = 判为回声，**不要**当作用户的话提交
 */
export function isLikelySelfEcho(input) {
  const heard = String(input?.heard ?? "").trim();
  if (!heard) return false;
  const ms = Number(input?.msSinceSpoken);
  const inTail = Number.isFinite(ms) && ms >= 0 && ms <= ECHO_TAIL_MS;
  // ⛔ 既不在播报中、也不在尾巴窗口里 ⇒ 一定是用户自己说的，放行（这一条保证不会误杀正常说话）
  if (!input?.speaking && !inTail) return false;
  const spoken = String(input?.spoken ?? "");
  if (!normalizeForEcho(spoken)) return false;
  return echoSimilarity(heard, spoken) >= ECHO_SIMILARITY;
}
