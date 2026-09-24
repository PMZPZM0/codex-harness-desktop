/** truncateTailLines（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function truncateTailLines(text: string, max = 500): { text: string; omittedLines: number } {
  const lines = text.split("\n");
  if (lines.length <= max) return { text, omittedLines: 0 };
  return { text: lines.slice(lines.length - max).join("\n"), omittedLines: lines.length - max };
}
