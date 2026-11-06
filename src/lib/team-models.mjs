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

import { DEFAULT_GROUP_MENU, normalizeMenu } from "./team-menu.mjs";

/** 一个群最多几个伙伴（飞书有 maxBotNum；我们先给一个固定上限，留成数据便于后续改）。 */
export const GROUP_MAX_PARTNERS = 8;

/** 群记忆（这个群的共享背景/约定）字符上限。
 *  ⛔ 有上限不是抠门：这段会**拼进每次派活的 prompt**（豆包 baseline.md 的群级等价物），
 *    无限长等于每次派活都烧一遍预算。 */
export const MAX_GROUP_MEMORY_CHARS = 4000;

/** 一个群最多挂多少个参考文件（派活时把路径注入给伙伴）。 */
export const MAX_GROUP_FILES = 20;

/** 一个群最多存多少条**记忆条目**（豆包 MEMORY.md 索引那种：一条一个结论，不是一大段）。
 *  ⛔ 与 `memory`（群简介）分开：简介是"这个群是干什么的"，条目是"我们学到的事实/约定"。
 *    只有后者需要 `origin`（谁写的、哪次对话来的）——报告原话「记忆没有 origin 会烂」。 */
export const MAX_MEMORY_NOTES = 40;

/** 单条记忆的字符上限（防止有人把整篇文档粘成一条）。 */
export const MAX_MEMORY_NOTE_CHARS = 500;

/** 记忆类型（豆包 `type` 字段的同构）：事实 / 约束 / 做法。 */
export const MEMORY_TYPES = Object.freeze(["fact", "constraint", "runbook"]);

/** 类型的中文标签（注入与界面共用一份，⛔ 别两处各写一套）。 */
export const MEMORY_TYPE_LABELS = Object.freeze({
  fact: "事实",
  constraint: "约束",
  runbook: "做法",
});

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
    /* 角色（专家团成员的 profession / 专家的岗位）：飞书 `isAgentEmployee`、豆包「伙伴档案」都有身份，
       群里只有名字会分不清谁是谁。⛔ 空串就空着，别编。 */
    targetProfession: String(entry?.targetProfession ?? "").trim(),
  };
}

/**
 * 群参考文件：⛔ 只存**路径 + 说明**，不搬文件、不读内容 ——
 * 伙伴是真实子会话，它们自己能按路径去读盘（⛔ 复制一份会出现"群里的副本早就过期"）。
 */
export function normalizeGroupFile(entry) {
  const path = String(entry?.path ?? "").trim();
  if (!path) return null;
  const name = String(entry?.name ?? "").trim() || path.split(/[\\/]/).pop() || path;
  return {
    path,
    name,
    note: String(entry?.note ?? "").trim(),
    addedBy: String(entry?.addedBy ?? ""),
    at: Number(entry?.at ?? 0) || 0,
  };
}

/**
 * 一条群记忆：`{ id, text, type, origin: { groupId, actorId }, at }`。
 * ⛔ `origin` 必须落盘（报告：多 agent 往同一份记忆写，没有来源三天后就删都不敢删）。
 * ⛔ 没 id / 没正文一律判无效（⛔ 不替调用方生成 id —— 纯函数里没有可靠时钟）。
 */
export function normalizeMemoryNote(entry) {
  const id = String(entry?.id ?? "").trim();
  const text = String(entry?.text ?? "").trim();
  if (!id || !text) return null;
  const type = MEMORY_TYPES.includes(entry?.type) ? String(entry.type) : "fact";
  return {
    id,
    text: text.slice(0, MAX_MEMORY_NOTE_CHARS),
    type,
    origin: {
      groupId: String(entry?.origin?.groupId ?? ""),
      actorId: String(entry?.origin?.actorId ?? ""),
      threadId: String(entry?.origin?.threadId ?? ""),
    },
    at: Number(entry?.at ?? 0) || 0,
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
  const files = (Array.isArray(input?.files) ? input.files : [])
    .map(normalizeGroupFile)
    .filter(Boolean)
    .slice(0, MAX_GROUP_FILES);
  /* 菜单：`undefined` = 老数据/新群 ⇒ 用默认那套（否则新群连「指令」按钮都没有）；
     `[]` = 用户主动清空 ⇒ 保持空（⛔ 别再"帮"他补回来）。 */
  const menu = normalizeMenu(input?.menu === undefined ? DEFAULT_GROUP_MENU : input.menu);
  const noteSeen = new Set();
  const memoryNotes = (Array.isArray(input?.memoryNotes) ? input.memoryNotes : [])
    .map(normalizeMemoryNote)
    .filter(Boolean)
    .filter((n) => (noteSeen.has(n.id) ? false : (noteSeen.add(n.id), true)))
    .slice(0, MAX_MEMORY_NOTES);
  return {
    id: String(input?.id ?? ""),
    name: String(input?.name ?? "未命名团队"),
    leadId,
    members: deduped,
    guard: { ...DEFAULT_GROUP_GUARD, ...(input?.guard ?? {}) },
    /* 群简介：这个群的共享背景（注入每次派活）。⛔ 与人/伙伴的私有记忆分开，别混。 */
    memory: String(input?.memory ?? "").slice(0, MAX_GROUP_MEMORY_CHARS),
    /* 群记忆条目：带 type + origin 的结论/约定（见 normalizeMemoryNote） */
    memoryNotes,
    files,
    /* 快捷指令菜单（飞书 ChatBotMenu 的本地等价物） */
    menu,
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

/**
 * 设置某成员的上级（豆包 `managerId`；空串 = 清掉）。
 * ⛔ 不许成环（A→B→A 会让"上级"这条路永远走不到头）；⛔ 不能把自己设成自己的上级。
 */
export function setManager(group, memberId, managerId) {
  const base = createGroup(group);
  const id = String(memberId ?? "");
  const up = String(managerId ?? "");
  if (!base.members.some((m) => m.id === id)) return { ok: false, reason: "not_member", group: base };
  if (up && up === id) return { ok: false, reason: "self", group: base };
  if (up && !base.members.some((m) => m.id === up)) return { ok: false, reason: "no_manager", group: base };
  if (up) {
    /* 顺着 up 往上走一圈，遇到 id 就是环 */
    const byId = new Map(base.members.map((m) => [m.id, m]));
    let cursor = up;
    for (let hop = 0; hop < 32 && cursor; hop += 1) {
      if (cursor === id) return { ok: false, reason: "cycle", group: base };
      cursor = String(byId.get(cursor)?.managerId ?? "");
    }
  }
  return {
    ok: true,
    changed: String(base.members.find((m) => m.id === id)?.managerId ?? "") !== up,
    group: { ...base, members: base.members.map((m) => (m.id === id ? { ...m, managerId: up } : m)) },
  };
}

/**
 * 加一条记忆（超上限 ⇒ 丢最老的，返回 dropped 让人知道）。
 * ⛔ 同 id 覆盖（"先记后改"是正常操作，不该堆两条）。
 */
export function addMemoryNote(group, note) {
  const base = createGroup(group);
  const n = normalizeMemoryNote(note);
  if (!n) return { ok: false, reason: "invalid", group: base };
  const list = [...base.memoryNotes.filter((x) => x.id !== n.id), n];
  const dropped = list.length > MAX_MEMORY_NOTES ? list.splice(0, list.length - MAX_MEMORY_NOTES) : [];
  return { ok: true, changed: true, dropped: dropped.map((d) => d.id), group: { ...base, memoryNotes: list } };
}

/** 删一条记忆（不存在 ⇒ 幂等 ok，⛔ 不报错）。 */
export function removeMemoryNote(group, noteId) {
  const base = createGroup(group);
  const id = String(noteId ?? "");
  const list = base.memoryNotes.filter((n) => n.id !== id);
  return { ok: true, changed: list.length !== base.memoryNotes.length, group: { ...base, memoryNotes: list } };
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

/**
 * 群上下文块：派活时拼在用户那句话**前面**注入给伙伴。
 * ⛔ 这是豆包 `baseline.md (inject: always)` 的群级等价物：群背景 + 参考文件路径。
 * ⛔ 纯函数，主进程/渲染层/测试共用一份口径 —— ⛔ 别在派活处手拼字符串（两套必然漂）。
 * 返回空串 = 这个群没有任何上下文可注入。
 */
export function groupContextBlock(group, options = {}) {
  const g = createGroup(group);
  const memory = String(g.memory ?? "").trim();
  const notes = Array.isArray(g.memoryNotes) ? g.memoryNotes : [];
  const files = Array.isArray(g.files) ? g.files : [];
  /* 上下级（豆包：`managerId` / `canDelegate`）：告诉**这个**伙伴它能把子任务派给谁。
     ⛔ 只有在配置了关系时才写，否则每段注入都带一句空话。
     ⛔ 目标写 `kind:name`（与 `agent_invoke` 的参数同形），模型照着就能调，不用猜。 */
  const me = String(options?.forMemberId ?? "");
  const self = me ? g.members.find((m) => m.id === me) : null;
  const manager = self?.managerId ? g.members.find((m) => m.id === self.managerId) : null;
  const reports = self
    ? g.members.filter((m) => m.kind === "bot" && m.id !== self.id && canDelegate(self.id, m.id, g))
    : [];
  const hasOrg = Boolean(manager || reports.length);
  if (!memory && !notes.length && !files.length && !hasOrg) return "";
  const lines = [`【群聊上下文 · ${g.name}】`];
  if (memory) lines.push(memory);
  if (notes.length) {
    if (lines.length > 1) lines.push("");
    /* ⛔ 顺序固定：约束在前（硬护栏优先级最高，豆包 SECURITY.md 放最前的同理），
       做法（runbook）其次，事实最后。 */
    lines.push("群记忆（本群已确认的结论；⛔ 与你自己的推断冲突时以这里为准）：");
    for (const type of ["constraint", "runbook", "fact"]) {
      const list = notes.filter((n) => n.type === type);
      if (!list.length) continue;
      lines.push(`· ${MEMORY_TYPE_LABELS[type]}：`);
      for (const n of list) lines.push(`  - ${n.text}`);
    }
  }
  if (hasOrg) {
    if (lines.length > 1) lines.push("");
    lines.push("组织关系（派活用 agent_invoke 的 kind/name）：");
    if (manager) lines.push(`- 你的上级：${manager.name}${manager.targetProfession ? `（${manager.targetProfession}）` : ""}`);
    if (reports.length) {
      lines.push("- 你可以把子任务派给：" + reports.map((m) => `${m.name}（${m.targetKind || "expert"}:${m.targetKey || m.name}）`).join("、"));
      lines.push("  ⛔ 只在用户明确要求、或确实需要时才派，不要为了显得忙碌而派。");
    }
  }
  if (files.length) {
    if (lines.length > 1) lines.push("");
    lines.push("参考文件（本机绝对路径；需要时直接读，⛔ 别凭文件名猜内容）：");
    for (const f of files) lines.push(`- ${f.path}${f.note ? `（${f.note}）` : ""}`);
  }
  return lines.join("\n");
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
        mentions: Array.isArray(msg?.mentions) ? msg.mentions.map(String) : [],
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
    /* @ 了谁（成员 id 数组）：飞书消息里 @ 是高亮 mention，不是普通文本。
       ⛔ 只留群里真实存在的 id，别把已移除的伙伴留在消息里。 */
    mentions: Array.isArray(entry?.mentions) ? entry.mentions.map(String).filter(Boolean) : [],
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
