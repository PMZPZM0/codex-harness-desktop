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
 * 构建「谁调度了谁」的归属关系（09-25 用户要求：「谁调度的，那个就要生成分类在调度的会话下面」）。
 *
 * 口径：主进程调度登记里的 `originThreadId` = 发起调度的那个会话。
 *   · 只有**父会话也在当前列表里**时才收编（父被归档/删除 ⇒ 不缩进，回退到来源分组，⛔ 会话不能凭空消失）
 *   · 只做**单层**：父自己也是被调度会话时（链式调度）不收编 —— 否则会形成父子互指/深层嵌套，
 *     侧栏里看不出层级反而更乱
 *   · 防自指（originThreadId === 自己）与环（A→B 且 B→A 时两者都不收编）
 *
 * 返回 { childrenOf, childIds }：childIds 的会话应从来源分组里剔除（它们已挂在父行下面）。
 */
export function buildDispatchChildren(threads, delegateRecords, options) {
  const list = threads ?? [];
  const records = delegateRecords ?? {};
  // skipIds：已由既有「团队聚类」收编的成员会话（它们在主理人行下展开显示）——
  // 这里再收编会与团队聚类**重复渲染**（同一会话出现两次），故跳过。
  const skipIds = options?.skipIds ?? new Set();
  const ids = new Set(list.map((t) => String(t?.id ?? "")).filter(Boolean));
  const parentOf = (id) => {
    const origin = records[id]?.originThreadId;
    return origin && String(origin) !== String(id) && ids.has(String(origin)) ? String(origin) : null;
  };
  // 自指/环：互为父子的两条都放弃收编（保留在来源分组里，用户仍能看到）
  const mutual = new Set();
  for (const thread of list) {
    const id = String(thread?.id ?? "");
    const parent = parentOf(id);
    if (parent && parentOf(parent) === id) { mutual.add(id); mutual.add(parent); }
  }
  const childrenOf = {};
  const childIds = new Set();
  for (const thread of list) {
    const id = String(thread?.id ?? "");
    if (mutual.has(id)) continue;
    if (skipIds.has ? skipIds.has(id) : false) continue;
    const parent = parentOf(id);
    if (!parent) continue;
    // 单层：父自己也被调度 ⇒ 不收编（避免深层嵌套看不出层级）
    if (parentOf(parent)) continue;
    (childrenOf[parent] ||= []).push({ threadId: id, kind: String(records[id]?.kind ?? ""), name: String(records[id]?.name ?? "") });
    childIds.add(id);
  }
  return { childrenOf, childIds };
}

/**
 * 把会话列表按来源分组（返回 [{ key, label, items }]，空类不出现）。
 * 组内与组间排序规则：置顶项永远最前（沿用既有置顶约定），其余按最近活动倒序。
 */
export function groupThreadsBySource(threads, ctx) {
  const { delegateRecords = {}, teamThreadIndex = {}, teamMemberThreadIds = new Set(), pinnedThreadIds = [] } = ctx ?? {};
  // 已被收编到「调度者会话」下面的会话不再进来源分组（用户 09-25：挂在调度的会话下面方便看）
  const { childIds } = buildDispatchChildren(threads, delegateRecords, { skipIds: teamMemberThreadIds });
  const buckets = new Map();
  for (const thread of threads ?? []) {
    const id = String(thread?.id ?? "");
    if (!id || childIds.has(id)) continue;
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

/**
 * 解析每个会话在侧栏「项目」视图里应当归到哪个 cwd（09-25 用户要求：
 * 「被调度的专家或者专家团和子智能体跟随主对话的项目地址，不要新开项目地址」）。
 *
 * 规则（优先级从上到下）：
 *   ① 被调度会话（主进程登记的 originThreadId 指向发起调度的会话，且父也在列表里）⇒ 跟随父的 cwd（可链式）
 *   ② 团队成员会话 ⇒ 跟随**本团主理人**（team-threads.json 里同 teamId 且非成员会话那条）的 cwd
 *   ③ 兜底 = 自己的 cwd（⛔ 父不在列表 / 无团队主理人 / 成环 时都不许把会话弄丢）
 *
 * 返回 Record<threadId, cwd>；cwd 仍为空串的项表示无法解析（调用方按原样处理）。
 */
export function resolveGroupCwd(threads, ctx) {
  const list = threads ?? [];
  const { delegateRecords = {}, teamThreadIndex = {}, teamMemberThreadIds = new Set() } = ctx ?? {};
  const has = (set, id) => (set && typeof set.has === "function" ? set.has(id) : false);

  const own = new Map();
  for (const thread of list) {
    const id = String(thread?.id ?? "");
    if (id) own.set(id, String(thread?.cwd ?? ""));
  }
  // teamId → 主理人会话 id（该团里非成员会话；多个候选时优先有 cwd 的）
  const leadOfTeam = new Map();
  for (const [threadId, teamId] of Object.entries(teamThreadIndex)) {
    const id = String(threadId);
    if (has(teamMemberThreadIds, id) || !own.has(id)) continue;
    const key = String(teamId);
    const prev = leadOfTeam.get(key);
    if (!prev || (!own.get(prev) && own.get(id))) leadOfTeam.set(key, id);
  }
  const parentOf = (id) => {
    const origin = delegateRecords[id]?.originThreadId;
    return origin && String(origin) !== String(id) && own.has(String(origin)) ? String(origin) : null;
  };

  const memo = new Map();
  const walk = (id, seen) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return own.get(id) ?? "";   // 成环 ⇒ 该节点用自己的 cwd，不再上溯
    seen.add(id);
    let cwd = "";
    const parent = parentOf(id);
    if (parent) cwd = walk(parent, seen);
    if (!cwd && has(teamMemberThreadIds, id)) {
      const lead = leadOfTeam.get(String(teamThreadIndex[id] ?? ""));
      if (lead && lead !== id) cwd = walk(lead, seen);
    }
    if (!cwd) cwd = own.get(id) ?? "";
    seen.delete(id);
    memo.set(id, cwd);
    return cwd;
  };

  const resolved = {};
  for (const id of own.keys()) resolved[id] = walk(id, new Set());
  return resolved;
}
