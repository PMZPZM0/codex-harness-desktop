/**
 * 「结束汇总播报」的文本层（10-08 新增）。
 *
 * 用户需求原话：「运行结束后对最终消息进行汇总播报」，且**汇总来源选「本地要点截取」**
 * —— 不额外调模型、不联网、零延迟：取最终回复的要点句，剩余部分只报一句「另有 N 句」。
 *
 * 与 `speak-text.mjs` 的分工（⛔ 不要在这里重造清洗）：
 *   · 给耳朵听的文本清洗（markdown 记号 / 代码块 / 表格 / URL / 路径 / emoji / 数字中文化）
 *     全部复用 `createSpeakFilter()` + `toSpeakableText()`，这一层只做**压缩**；
 *   · 因为要「截取要点」，所以必须能在**句级**切分后再挑，而 speak-text 的断句是流式的。
 *
 * 纯函数、零依赖：`scripts/guards/11z-voice-call.mjs` 直接 import 跑真值表。
 */
import { createSpeakFilter, toSpeakableText } from "./speak-text.mjs";

/** 汇总默认上限（字符）。约 6~8 秒朗读量 —— 再长就不叫「汇总」了。 */
export const SUMMARY_MAX_CHARS = 140;

/** 汇总的开场白（唯一真相源：通话内播报与独立播报、守卫都读它）。 */
export const SUMMARY_PREFIX = "总结一下：";

/** 最终回复整段都是代码/表格时，改成念哪一句（免得用户以为播报坏了）。 */
export const SUMMARY_EMPTY_NOTICE = "这轮回复主要是代码，完整内容请看屏幕。";

/**
 * 句级切分（中文句末标点 + 英文句末标点 + 分号）。
 * ⛔ 不切小数点：`3.5` 里的 `.` 不在切分集合里，安全。
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const out = [];
  let buf = "";
  for (const ch of String(text ?? "")) {
    if (ch === "\n") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
    if ("。！？!?；;".includes(ch)) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * 把最终回复压成「可朗读的汇总」。
 *
 * 规则（都是可预期的，不做花活）：
 *   ① 先过朗读视图清洗（代码块/表格整段丢，markdown/URL/路径/emoji 去掉，数字中文化）；
 *   ② 按句切分，从第一句开始取，直到再加一句会超出 `maxChars`；
 *      —— **至少保留一句**（哪怕它本身就超长，此时按 maxChars 截断并补省略号）；
 *   ③ 还有剩句 → 尾部接一句「另有 N 句」（数字已中文化，念出来自然）；
 *   ④ 清洗完为空（整段是代码）→ `text` 为空串，由调用方决定要不要念 `SUMMARY_EMPTY_NOTICE`。
 *
 * @param {string} finalText 回合结束时那条最终回复的**原文**
 * @param {{ maxChars?: number; prefix?: string }} [options]
 * @returns {{ text: string; sentences: number; kept: number; truncated: boolean }}
 */
export function summarizeForSpeech(finalText, options = {}) {
  const maxChars = Math.max(20, Math.trunc(Number(options.maxChars) || SUMMARY_MAX_CHARS));
  const prefix = options.prefix ?? SUMMARY_PREFIX;
  const raw = String(finalText ?? "");
  const stats = { text: "", sentences: 0, kept: 0, truncated: false };
  if (!raw.trim()) return stats;

  // ① 朗读视图清洗：codeNotice/tableNotice 传空串 —— 汇总里不要「（代码块已跳过）」这种噪声
  const filter = createSpeakFilter({ codeNotice: "", tableNotice: "" });
  const spoken = filter.push(raw);
  if (!spoken.trim()) return stats;

  // ②③ 逐句取，到预算为止
  const sentences = splitSentences(spoken);
  if (!sentences.length) return stats;
  stats.sentences = sentences.length;

  const kept = [];
  let used = 0;
  for (const sentence of sentences) {
    if (kept.length && used + sentence.length > maxChars) break;
    kept.push(sentence);
    used += sentence.length;
  }
  // 单句就超预算：截断（宁可短一点也不要把整段念完）
  if (kept.length === 1 && kept[0].length > maxChars) {
    kept[0] = kept[0].slice(0, maxChars).replace(/[，,、]$/, "") + "…";
    stats.truncated = true;
  }
  stats.kept = kept.length;
  const rest = sentences.length - kept.length;
  stats.truncated = stats.truncated || rest > 0;

  let body = kept.join("");
  if (rest > 0) {
    const restSpoken = toSpeakableText(`另有 ${rest} 句`);
    if (restSpoken && !/[。！？!?；;]$/.test(body)) body += "。";
    body += restSpoken ? `${restSpoken}。` : `另有 ${rest} 句。`;
  }
  stats.text = `${prefix}${body}`.trim();
  return stats;
}
