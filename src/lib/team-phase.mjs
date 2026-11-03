/**
 * 专家团并行阶段的入参归一（11-03 用户报「一个指令后创建了很多会话、都成了专家团」）。
 *
 * 根因之一：`team_phase_invoke` 的 tasks 由模型生成，可能把**同一条任务**重复写两遍；
 * 宿主之前逐条并发执行 ⇒ 同一成员在线程登记落盘前被并发创建多次，产生重复会话且同时运行。
 *
 * 这里只做**纯函数**去重：按「memberId + query」保留第一次出现，顺序不变；空 memberId 丢弃。
 * ⛔ 不按 memberId 一刀切：同一成员的不同任务要保留（`team-invoke` 已按成员串行，
 *    第二条会复用同一线程、顺序执行）；只去掉完全重复的条目，避免静默丢活。
 */
export function dedupeTeamPhaseTasks(tasks) {
  const seen = new Set();
  return (Array.isArray(tasks) ? tasks : []).filter((task) => {
    const memberId = String(task?.memberId ?? "").trim().toLowerCase();
    if (!memberId) return false;
    const key = `${memberId}\n${String(task?.query ?? "").trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
