// 目标条时长格式化（纯函数，目标条 GoalBar 用；预检守卫直接 import 真实现跑真值表）。
// 口径对齐 Qoder 的目标条：「3秒」/「2分5秒」/「2小时2分」；非法输入一律回落「0秒」（不抛）。

/** 秒 → 中文时长 */
export function formatGoalTime(seconds) {
  const total = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
  if (total < 60) return `${total}秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}分${total % 60}秒`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}
