/** reasoning item → 纯文本（summary 优先，content 兜底）。
 *
 *  ⛔ 引擎给**两种形状**：流式 item 是 `[{ type: "summary_text", text }]`，
 *     `thread/resume` 回读是 `["文本"]`（0.162.1 实测）。只读 `part.text`
 *     会让**历史里的思考**永远为空 —— 手机上就只剩回复、看不到思考。
 */
export function reasoningItemText(item: any): string {
  const join = (parts: any): string =>
    (Array.isArray(parts) ? parts : [])
      .map((part: any) => (typeof part === "string" ? part : String(part?.text ?? "")))
      .join("");
  return (join(item?.summary) + join(item?.content)).trim();
}
