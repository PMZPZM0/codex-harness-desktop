/** reasoningTextOf（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { ThreadItem } from "./thread-item";

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
