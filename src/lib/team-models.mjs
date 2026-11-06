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

/** 一个群最多保留多少条群消息（P0b）：超了丢最老的 —— 群视图是**投影/索引**，
 *  真身永远在子会话里，截断不会丢任何真实产出。 */
export const MAX_GROUP_MESSAGES = 400;

/** 群护栏默认值：新群一律最严（禁外部、不响应 @所有人、范围限本项目）。 */
export const DEFAULT_GROUP_GUARD = Object.freeze({
  scope: "project",
  allowExternal: false,
  respondToEveryone: false,
});

/** 成员条目：人 或 伙伴（伙伴 = 调度目标）。 */
export function normalizeMember(entry) {
  const id = String(entry?.id ?? "").trim();
  if (!id) return null;
  /* ⛔ P0b：伙伴必须**绑定一个真实调度目标**（`agents:catalog` 里那一条），否则「@ 它派活」
     落不到任何子会话上 —— 那是纯装饰。`targetKind/targetKey` 就是那条目标的身份，
     `name` 只是显示名（可与目标同名，也可以改）。老群里的自由命名伙伴这两项为空 ⇒
     界面上标注「未绑定」，派活时被明确拒绝（⛔ 不静默当成成功）。 */
  const targetKind = ["expert", "team", "member", "subagent", "cli"].includes(String(entry?.targetKind ?? ""))
    ? String(entry.targetKind)
    : "";
  return {
    id,
    kind: entry?.kind === "human" ? "human" : "bot",
    name: String(entry?.name ?? id),
    managerId: entry?.managerId ? String(entry.managerId) : "",
    canDelegate: Array.isArray(entry?.canDelegate) ? entry.canDelegate.map(String) : [],
    addedBy: entry?.addedBy ? String(entry.addedBy) : "",
    muted: Boolean(entry?.muted),
    targetKind,
    targetKey: targetKind ? String(entry?.targetKey ?? entry?.name ?? "") : "",
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

/* ── 群消息日志（P0b）─────────────────────────────────────────────────────────
   群视图要显示的不只是"子会话里有什么"，还有**用户自己在群里说的那句**——那一条的真身
   就是这个日志（它不属于任何一个伙伴的子会话）。所以：
     · 人的消息 ⇒ threadId = `group:<群id>`（群自己就是真身），itemId = 日志条目 id；
     · 伙伴的消息 ⇒ threadId = 真实子会话 id，itemId = 日志条目 id（可点开回到原子会话）。
   ⛔ 两条都必须带 threadId + itemId：`projectGroupLog` 走的就是这条硬规矩（无真身即丢弃）。
   ⛔ 日志只是**投影索引**：截断（MAX_GROUP_MESSAGES）不会丢任何真实产出。 */

/** 群自己在投影里的"线程 id"（人的消息挂在这里）。 */
export function groupThreadId(groupId) {
  return `group:${String(groupId ?? "")}`;
}

/** 一条群消息的落盘形状（⛔ 没有 id / threadId 的一律判无效，不补齐不猜）。 */
export function normalizeGroupMessage(entry) {
  const id = String(entry?.id ?? "").trim();
  const threadId = String(entry?.threadId ?? "").trim();
  if (!id || !threadId) return null;
  return {
    id,
    threadId,
    authorId: String(entry?.authorId ?? ""),
    authorKind: entry?.authorKind === "bot" ? "bot" : "human",
    at: Number(entry?.at ?? 0) || 0,
    kind: entry?.kind === "card" ? "card" : "text",
    text: String(entry?.text ?? ""),
    card: entry?.card ?? null,
  };
}

/**
 * 追加一条群消息（幂等：同 id 覆盖旧的那条，用于"先占位、后补正文"）。
 * ⛔ 返回**新数组**，不改入参（主进程/渲染层/测试共用，谁都不许就地 push）。
 */
export function appendGroupMessage(list, entry, max = MAX_GROUP_MESSAGES) {
  const msg = normalizeGroupMessage(entry);
  const base = Array.isArray(list) ? list : [];
  if (!msg) return base;
  const next = [...base.filter((m) => String(m?.id ?? "") !== msg.id), msg];
  const cap = Number(max) > 0 ? Number(max) : MAX_GROUP_MESSAGES;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * 群日志 → 群视图投影（按时间升序 + 去重 + 编号）。
 * ⛔ 复用 `projectGroupMessages`（同一份排序/去重口径），⛔ 不另写一套。
 */
export function projectGroupLog(messages) {
  const buckets = new Map();
  for (const raw of Array.isArray(messages) ? messages : []) {
    const msg = normalizeGroupMessage(raw);
    if (!msg) continue;
    if (!buckets.has(msg.threadId)) buckets.set(msg.threadId, []);
    buckets.get(msg.threadId).push({ ...msg, itemId: msg.id });
  }
  return projectGroupMessages(
    [...buckets.entries()].map(([threadId, list]) => ({ threadId, messages: list })),
  );
}

/**
 * 建群**硬闸**：只有结构性错误才算错误。
 * ⛔⛔ 11-06 修：「还没有伙伴（只有人）」是**提示**不是错误 —— 之前 create 拿 groupIssues 当闸，
 *   于是**任何新建的群都会被拒**（新群本来就只有人），「建群」按钮从来没有成功过。
 *   结果列表里每个新群只能靠"先加伙伴再加群"这种不存在的顺序绕过 ⇒ 界面上永远是 0 个群。
 * ⛔ 判据分离：硬闸 = 结构自洽（id/成员/群主/重复），提示 = 建议类（还没有伙伴）。
 */
export function createBlockers(group) {
  const g = createGroup(group);
  const blockers = [];
  if (!g.id) blockers.push("缺群 id");
  if (!g.members.length) blockers.push("群内没有成员");
  if (!g.members.some((m) => m.id === g.leadId)) blockers.push("群主不在成员表里");
  const dup = memberIdsOf(g).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dup.length) blockers.push(`成员重复：${dup.join(", ")}`);
  return blockers;
}

/** 一致性问题体检（供设置页/守卫显示）：成员表与 leadId 是否自洽。
 *  ⛔ 返回问题列表而不是布尔 —— 文案要能直接显示给用户。
 *  ⛔ 含"建议类"条目（还没有伙伴）⇒ **不能**拿来当建群闸，用 `createBlockers`。
 */
export function groupIssues(group) {
  const g = createGroup(group);
  const issues = [...createBlockers(g)];
  if (!partnersOf(g).length) issues.push("还没有伙伴（只有人）");
  return issues;
}
