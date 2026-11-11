/**
 * 语音委派（MOSS-Live delegation=client → 本机 Codex）的**提示词与显示判据**。
 *
 * ⛔ 单一真相源：主进程拼注入文本、渲染层判定「这条 userMessage 要不要显示」都读这里。
 *    否则改一处漏一处 —— 用户实测「内置注入的系统提示词从用户消息里透出来」。
 * ⛔ 这条消息是**给模型看的**：模型要据此执行任务；用户气泡 / 标题 / 搜索 / 导出 / 云同步里必须隐藏。
 */

export const VOICE_DELEGATION_TAG = "[语音助手委派]";

/** 拼给 Codex 的委派正文（含最近对话摘录与输出要求）。 */
export function buildVoiceDelegationPrompt({ objective, context, purpose }) {
  const rows = (Array.isArray(context) ? context : [])
    .map((row) => {
      const content = String(row?.content ?? "").trim().slice(0, 600);
      if (!content) return "";
      const role = row?.role === "assistant" ? "助手" : row?.role === "user" ? "用户" : String(row?.role ?? "对话");
      return `${role}：${content}`;
    })
    .filter(Boolean)
    .slice(-6);
  const concise = purpose === "reasoning";
  return [
    `${VOICE_DELEGATION_TAG} 用户正在实时语音通话中，这件事交给你在 Codex 里直接完成。`,
    rows.length ? `最近对话：\n${rows.join("\n")}\n` : "",
    `任务：${String(objective ?? "").trim()}`,
    "",
    "要求：",
    "· 直接在工作区执行，不要反问用户确认（用户正在说话，等不了来回）。",
    concise
      ? "· 完成后用一两句话给出结论即可（会被念给用户听），细节留在会话里。"
      : "· 完成后用简洁中文给出结果要点（会被念给用户听），详细过程留在会话里。",
    "· 如果确实做不了，直接说明原因和下一步建议。",
  ].filter((line) => line !== "").join("\n");
}

/** 这条 userMessage 原文是不是语音委派注入（显示层据此整条隐藏）。 */
export function isVoiceDelegationPrompt(text) {
  return String(text ?? "").trimStart().startsWith(VOICE_DELEGATION_TAG);
}
