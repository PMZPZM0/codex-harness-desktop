/** itemText（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "./thread-item";

/** 取一条 item 的可读文本（agentMessage 用 `text`，userMessage 拼 text part，其它类型返回空串）。 */
export function itemText(item: ThreadItem) {
  if (item.type === "agentMessage") return item.text ?? "";
  if (item.type === "userMessage") return (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
  return "";
}
