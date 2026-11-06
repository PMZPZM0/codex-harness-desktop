/**
 * 指挥中枢 / 群面板「当前群」解析（11-06 抽成纯函数，面板与成员弹窗共用）。
 *
 * ⛔⛔ 顺序不能反：**本会话显式选过的群优先**，其次才是「本会话绑定的群（bossThreadId）」。
 *   反过来写（bossThreadId 先）会让指挥中枢会话里的群下拉变成**死控件** ——
 *   用户 11-06 实测「切换不了，切换了也没有联动变化」：选中的群被 bossThreadId 规则立刻盖回去。
 *
 * @param {Array<{ id: string, bossThreadId?: string }>} groups 群列表
 * @param {string} explicitId 本会话上次手动选的群 id
 * @param {string} threadId 当前会话 id
 * @param {{ fallbackToFirst?: boolean }} [options] 面板允许回落到最近活动的群；成员弹窗不允许（防串项）
 * @returns {string} 群 id，解析不到返回 ""
 */
export function resolveSelectedGroup(groups, explicitId, threadId, options = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const explicit = String(explicitId ?? "");
  if (explicit && list.some((group) => String(group?.id ?? "") === explicit)) return explicit;
  const own = list.find((group) => String(group?.bossThreadId ?? "") === String(threadId ?? ""));
  if (own) return String(own.id ?? "");
  return options.fallbackToFirst ? String(list[0]?.id ?? "") : "";
}
