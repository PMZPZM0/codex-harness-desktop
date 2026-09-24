/** formatDuration（从 src/App.tsx 原样搬来）。多处共用 ⇒ 单独成模块，不复制一份。 */

export function formatDuration(value: unknown) {
  // 与 usage-stats 版本并存：接受 unknown 并返回空串语义，避免历史调用点行为变化
  const milliseconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  return localFormatDurationMs(milliseconds);
}

function localFormatDurationMs(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  if (milliseconds < 1000) return `${Math.max(1, Math.round(milliseconds))} 毫秒`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${(milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 0 : 1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}
