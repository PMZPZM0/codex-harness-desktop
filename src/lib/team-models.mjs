/**
 * 团队模式 · 纯函数模型（单一真相源，10-05 立）
 *
 * 这是「群 / 伙伴 / 委派白名单 / 群护栏 / 消息投影」的**唯一**计算入口。
 * ⛔ 只做纯函数：不读盘、不发 IPC、不碰 React —— 主进程、渲染层、测试三处共用同一份口径。
 * ⛔ 新增同类项（新护栏、新消息类型、新委派规则）只加数据 / 加一个分支，不改结构。
 *
 * 三条不变量（守卫钉）：
 *   ① `memberIds` 只是索引，**成员真身以 `members` 为准**；两边不一致时以 members 过滤（防"成员收编"）。
 *   ② 群消息是**投影**，真身永远在子会话（`threadId + itemId`）；投影不得凭空造消息。
 *   ③ 移除伙伴只有**群主**与**添加者**可以（飞书实测文案：「仅群主和添加者可移除该机器人」）。
 */

/** 一个群最多几个伙伴（飞书有 maxBotNum；我们先给一个固定上限，留成数据便于后续改）。 */
export const GROUP_MAX_PARTNERS = 8;

/** 群护栏默认值：新群一律最严（禁外部、不响应 @所有人、范围限本项目）。 */
export const DEFAULT_GROUP_GUARD = Object.freeze({
  scope: "project",
  allowExternal: false,
  respondToEveryone: false,
});

/** 成员条目：人 或 伙伴（伙伴 = 专家团成员 id）。 */
export function normalizeMember(entry) {
  const id = String(entry?.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    kind: entry?.kind === "human" ? "human" : "bot",
    name: String(entry?.name ?? id),
    managerId: entry?.managerId ? String(entry.managerId) : "",
    canDelegate: Array.isArray(entry?.canDelegate) ? entry.canDelegate.map(String) : [],
    addedBy: entry?.addedBy ? String(entry.addedBy) : "",
    muted: Boolean(entry?.muted),
  };
}

/** 建群：成员表去重、护栏补默认值。`leadId` 必须在成员里（否则群主凭空存在）。 */
export function createGroup(input) {
  const members = (Array.isArray(input?.members) ? input.members : [])
    .map(normalizeMember)
    .filter(Boolean);
  const seen = new Set();
  const deduped = members.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  const leadId = String(input?.leadId ?? deduped[0]?.id ?? "");
  return {
    id: String(input?.id ?? ""),
    name: String(input?.name ?? "未命名团队"),
    leadId,
    members: deduped,
    guard: { ...DEFAULT_GROUP_GUARD, ...(input?.guard ?? {}) },
  };
}

/** 成员索引（渲染用）。⛔ 只从 members 派生，不额外维护一份 id 数组。 */
export function memberIdsOf(group) {
  return (Array.isArray(group?.members) ? group.members : []).map((m) => m.id);
}

/** 取伙伴（bot）列表：人类用户不算"伙伴"。 */
export function partnersOf(group) {
  return (Array.isArray(group?.members) ? group.members : []).filter((m) => m.kind === "bot");
}

/**
 * 加伙伴。规则：
 *   · 已在群里 ⇒ 幂等返回（不重复加）；
 *   · 超过上限 ⇒ 拒绝并给原因（界面上按钮该灰，但判定仍在这里 —— 按钮灰不是准入）；
 *   · 记录添加者（决定谁能移除）。
 */
export function addPartner(group, partner, addedBy) {
  const p = normalizeMember({ ...partner, kind: "bot", addedBy });
  if (!p) return { ok: false, reason: "invalid" };
  const base = createGroup(group);
  if (base.members.some((m) => m.id === p.id)) return { ok: true, group: base, changed: false };
  if (partnersOf(base).length >= GROUP_MAX_PARTNERS) {
    return { ok: false, reason: "limit", limit: GROUP_MAX_PARTNERS, group: base };
  }
  return { ok: true, changed: true, group: { ...base, members: [...base.members, p] } };
}

/**
 * 移除伙伴：只有**群主**与**添加者**可以。
 * ⛔ 人类成员不走这条（人员由用户自己管）；⛔ 群主本人不能被移除。
 */
export function removePartner(group, partnerId, byId) {
  const base = createGroup(group);
  const target = base.members.find((m) => m.id === String(partnerId));
  if (!target) return { ok: true, group: base, changed: false };
  if (target.kind !== "bot") return { ok: false, reason: "not_partner", group: base };
  if (target.id === base.leadId) return { ok: false, reason: "is_lead", group: base };
  const actor = String(byId ?? "");
  const allowed = actor === base.leadId || actor === target.addedBy;
  if (!allowed) return { ok: false, reason: "forbidden", group: base };
  return { ok: true, changed: true, group: { ...base, members: base.members.filter((m) => m.id !== target.id) } };
}

/** 伙伴静音（飞书：每个机器人可单独静音）。 */
export function setPartnerMuted(group, partnerId, muted) {
  const base = createGroup(group);
  return {
    ...base,
    members: base.members.map((m) => (m.id === String(partnerId) ? { ...m, muted: Boolean(muted) } : m)),
  };
}

/**
 * 委派白名单：A 能不能把活派给 B。
 * ⛔ 规则来自豆包实测：上下级是**数据**（managerId / canDelegate），不是进程树；
 *    `canDelegate` 为空表示"没配白名单"⇒ 按上级关系判（B 的 managerId === A 才算）。
 */
export function canDelegate(fromId, toId, group) {
  const list = Array.isArray(group?.members) ? group.members : [];
  const from = list.find((m) => m.id === String(fromId));
  const to = list.find((m) => m.id === String(toId));
  if (!from || !to || from.id === to.id) return false;
  if (from.canDelegate.length > 0) return from.canDelegate.includes(to.id);
  return String(to.managerId ?? "") === from.id;
}

/**
 * 群护栏：派活入口统一问这一处。
 * @param group 群
 * @param facts { isExternal?, mentionsEveryone?, targetKind? }
 */
export function guardAllows(group, facts = {}) {
  const g = { ...DEFAULT_GROUP_GUARD, ...(group?.guard ?? {}) };
  if (!g.allowExternal && facts.isExternal) return { ok: false, reason: "external_blocked" };
  if (!g.respondToEveryone && facts.mentionsEveryone) return { ok: false, reason: "everyone_blocked" };
  return { ok: true };
}

/** 成员显示名（找不到就显示 id，⛔ 不编造名字）。 */
export function displayNameOf(group, id) {
  const hit = (Array.isArray(group?.members) ? group.members : []).find((m) => m.id === String(id));
  return hit?.name ?? String(id ?? "");
}

/**
 * 消息投影：把多个子会话的消息合并成群视图（按时间升序 + 去重）。
 * ⛔ 只做重排与标注，**不新增、不删改**任何一条消息内容 —— 真身始终在 `threadId + itemId`。
 * @param sources [{ threadId, messages: [{ itemId, authorId, authorKind?, at, kind?, text?, card? }] }]
 */
export function projectGroupMessages(sources) {
  const seen = new Set();
  const rows = [];
  for (const src of Array.isArray(sources) ? sources : []) {
    const threadId = String(src?.threadId ?? "");
    for (const msg of Array.isArray(src?.messages) ? src.messages : []) {
      const itemId = String(msg?.itemId ?? "");
      if (!threadId || !itemId) continue; // 无真身引用 ⇒ 丢弃（不造投影）
      const key = `${threadId}:${itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        threadId,
        itemId,
        authorId: String(msg?.authorId ?? ""),
        authorKind: msg?.authorKind === "human" ? "human" : "bot",
        at: Number(msg?.at ?? 0),
        kind: msg?.kind === "card" ? "card" : "text",
        text: String(msg?.text ?? ""),
        card: msg?.card ?? null,
      });
    }
  }
  rows.sort((a, b) => (a.at === b.at ? a.key.localeCompare(b.key) : a.at - b.at));
  return rows.map((row, index) => ({ ...row, seq: index + 1 }));
}

/**
 * 一致性问题体检（供设置页/守卫显示）：成员表与 leadId 是否自洽。
 * ⛔ 返回问题列表而不是布尔 —— 文案要能直接显示给用户。
 */
export function groupIssues(group) {
  const g = createGroup(group);
  const issues = [];
  if (!g.id) issues.push("缺群 id");
  if (!g.members.length) issues.push("群内没有成员");
  if (!g.members.some((m) => m.id === g.leadId)) issues.push("群主不在成员表里");
  if (!partnersOf(g).length) issues.push("还没有伙伴（只有人）");
  const dup = memberIdsOf(g).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dup.length) issues.push(`成员重复：${dup.join(", ")}`);
  return issues;
}
