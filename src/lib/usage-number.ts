/** usageNumber（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function usageNumber(usage: any, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}
