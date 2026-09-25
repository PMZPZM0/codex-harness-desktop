/**
 * 侧栏「按来源分类」视图的分类口径（09-25，纯函数 ⇒ 可被预检直接跑断言）。
 *
 * 用户需求（09-25）：「专家团里面的成员不在主代理会话选项分类里面，正常调度也是要做对话选项分类里面」
 * ⇒ 侧栏会话列表新增第三个视图「分类」，按**会话来源**归类：
 *    主代理会话 / 专家团主理人 / 团队成员子任务 / 专家调度 / 子智能体调度 / 专家团调度。
 *
 * 数据口径（全部为既有真相源，零新增 IPC）：
 *   · 成员会话集合 = team-threads.json 的 members 值（权威；⛔ 不靠标题猜）
 *   · 团队会话索引 = team-threads.json 的 threads（threadId → teamId）
 *   · 调度来源 = 主进程 listDelegates() 的 kind: expert | team | member | subagent
 */

/** 分类顺序（也是侧栏里的展示顺序：越靠前越「主」） */
export const THREAD_SOURCE_ORDER = ["main", "lead", "member", "expert", "subagent", "team"];

/** 分类标签（中文） */
export const THREAD_SOURCE_LABELS = {
  main: "主代理会话",
  lead: "专家团主理人",
  member: "团队成员子任务",
  expert: "专家调度",
  subagent: "子智能体调度",
  team: "专家团调度",
};

/**
 * 判定一个会话的来源分类。
 * @param {{ delegateKind?: string, teamId?: string, isTeamMember?: boolean }} input
 *   delegateKind —— 主进程调度登记的 kind（expert/team/member/subagent）
 *   teamId —— 该会话所属团队（team-threads.json 的 threads）
 *   isTeamMember —— 该会话是否为团队成员会话（team-threads.json 的 members 值）
 */
export function classifyThreadSource(input) {
  const { delegateKind, teamId, isTeamMember } = input ?? {};
  // ⛔ 成员会话优先：它可能同时挂着 kind=member 的调度记录，但成员身份由 members 映射权威判定
  if (isTeamMember) return "member";
  if (delegateKind === "expert") return "expert";
  if (delegateKind === "subagent") return "subagent";
  if (delegateKind === "team") return "team";
  // 有团队归属但不是成员会话 ⇒ 团队主会话（主理人）
  if (teamId) return "lead";
  return "main";
}

/**
 * 把会话列表按来源分组（返回 [{ key, label, items }]，空类不出现）。
 * 组内与组间排序规则：置顶项永远最前（沿用既有置顶约定），其余按最近活动倒序。
 */
export function groupThreadsBySource(threads, ctx) {
  const { delegateRecords = {}, teamThreadIndex = {}, teamMemberThreadIds = new Set(), pinnedThreadIds = [] } = ctx ?? {};
  const buckets = new Map();
  for (const thread of threads ?? []) {
    const id = String(thread?.id ?? "");
    if (!id) continue;
    const source = classifyThreadSource({
      delegateKind: delegateRecords[id]?.kind,
      teamId: teamThreadIndex[id],
      isTeamMember: teamMemberThreadIds.has ? teamMemberThreadIds.has(id) : false,
    });
    const list = buckets.get(source) ?? [];
    list.push(thread);
    buckets.set(source, list);
  }
  const pinned = new Set(pinnedThreadIds);
  const byRecent = (a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  return THREAD_SOURCE_ORDER
    .filter((key) => buckets.has(key))
    .map((key) => ({ key: `source:${key}`, label: THREAD_SOURCE_LABELS[key], items: [...buckets.get(key)].sort(byRecent) }));
}
