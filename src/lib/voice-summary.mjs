/**
 * 句级切分工具（10-08 立，10-09 第二轮**瘦身**）。
 *
 * ⛔ 这个文件以前还负责「结束汇总播报」的本机压缩（`summarizeForSpeech`）。
 *    10-09 用户令「运行的正文和汇总正文不用播报了 —— 只播报 Codex 写的内容」⇒
 *    那条回退压缩整条**删除**（`SUMMARY_*` 常量一并不再需要）：非通话播报与通话播报
 *    现在都只念模型写在回复末尾的 `voice` 播报稿（解析见 `voice-script.mjs`）。
 * ⛔ 保留 `splitSentences`：它是**播报去重**（`voice-script.mjs` 的 `dedupeSpokenSentences`，
 *    按句对齐三条入口的切分粒度）与播报稿清洗的基座，仍有唯一消费者。
 *
 * 纯函数、零依赖：`scripts/guards/11z-voice-call.mjs` 直接 import 跑真值表。
 */

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
