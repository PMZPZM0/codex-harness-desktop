/** revealStepForReasoning（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function revealStepForReasoning(remaining: number) {
  if (remaining > 3600) return Math.max(40, Math.ceil(remaining / 80));
  if (remaining > 1200) return 16;
  if (remaining > 300) return 8;
  return 3;
}
