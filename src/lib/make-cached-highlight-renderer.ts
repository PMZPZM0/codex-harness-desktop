/** makeCachedHighlightRenderer（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */
import { HIGHLIGHT_CACHE } from "./highlight-cache";
import createHighlightElement from "react-syntax-highlighter/dist/esm/create-element";

/** 生成「带缓存的高亮渲染器」：同一 cacheKey 直接回放上次的 rows，省掉重复高亮开销。 */
export function makeCachedHighlightRenderer(cacheKey: string) {
  return function cachedHighlightRenderer({ rows, stylesheet, useInlineStyles }: {
    rows: unknown[];
    stylesheet?: Record<string, React.CSSProperties>;
    useInlineStyles?: boolean;
  }): React.ReactNode {
    const hit = HIGHLIGHT_CACHE.get(cacheKey) as { rows: number; nodes: React.ReactNode[] } | undefined;
    if (hit && hit.rows === rows.length) return hit.nodes;
    const nodes = rows.map((node, i) => createHighlightElement({ node, stylesheet, useInlineStyles, key: `code-segment-${i}` }));
    HIGHLIGHT_CACHE.set(cacheKey, { rows: rows.length, nodes });
    return nodes;
  };
}
