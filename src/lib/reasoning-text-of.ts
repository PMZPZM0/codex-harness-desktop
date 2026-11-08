/** reasoningTextOf（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "./thread-item";

/** 从 item 提取思考文本：兼容「字符串数组」与 `{text|content}` 对象两种形状，去掉空项。 */
export function reasoningTextOf(item: ThreadItem): string {
  const norm = (arr: unknown): string[] => (Array.isArray(arr) ? arr : []).map((entry) => {
    if (typeof entry === "string") return entry.trim();
    if (entry && typeof entry === "object") {
      const t = (entry as any).text ?? (entry as any).content;
      if (typeof t === "string") return t.trim();
    }
    return "";
  }).filter(Boolean);
  return [...norm(item.summary), ...norm(item.content)].join("\n\n");
}
