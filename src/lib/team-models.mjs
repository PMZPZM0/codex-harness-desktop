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

import { DEFAULT_GROUP_MENU, normalizeMenu, normalizeMenuPlacement } from "./team-menu.mjs";

/** 群消息排版：`split` = 智能体靠左、用户靠右（默认）；`left` = 全部靠左（专业群聊）。 */
export function normalizeMessageLayout(value) {
  return value === "left" ? "left" : "split";
}

/**
 * 成员回复的展示模式（11-08 用户令，群设置里可切）：
 * · `process`（默认）= **过程模式**：运行时展示运行过程（默认折叠、可展开，内容与主对话框同一套
 *   工具/思考/命令卡），跑完过程整块消失，只留最后那份汇报；
 * · `placeholder` = **占位模式**：不展示过程，用户消息下面只挂「图标 + 名字」的处理中占位，
 *   产出出来再把消息上屏。
 * ⛔ 只是"过程显不显示"，两种模式下**产出都照常上屏**（⛔ 不要做成"要不要回复"）。
 */
export function normalizeReplyMode(value) {
  return value === "placeholder" ? "placeholder" : "process";
}

/** 群消息形式（11-08 用户令：话题模式要**单独选项**，不要挤在回复模式一排）：
 *  · `chat` = 对话消息：所有消息按时间平铺（默认）；
 *  · `topic` = 话题消息：伙伴回复收进用户气泡，点开弹窗预览。
 * ⛔ 与 replyMode 正交：形式决定"消息怎么摆"，回复模式决定"运行时露什么"。 */
export function normalizeMessageForm(value) {
  return value === "topic" ? "topic" : "chat";
}
import { normalizeSchedules } from "./team-schedule.mjs";
/* 11-07 用户令：群消息也要带真实发送者身份（用户 / 上级 / 定时任务 / 伙伴 / 系统）。
   ⛔ 枚举只认 message-origin.mjs 这一份，⛔ 不在群模型里另抄一套。 */
import { SENDER_KINDS } from "./message-origin.mjs";

/** 老群日志没有 senderKind ⇒ 按已有的 authorKind / authorId 推导，⛔ 不是一律当「用户」。 */
function senderKindOf(entry) {
  const raw = entry?.senderKind;
  const kind = typeof raw === "string" ? raw : (raw && typeof raw === "object" ? String(raw.kind ?? "") : "");
  if (SENDER_KINDS.includes(kind)) return kind;
  if (entry?.authorKind === "bot") return "member";
  if (String(entry?.authorId ?? "") === "automation") return "automation";
  return "user";
}

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
    /* 11-07 用户令「加一个群内的成员头像自定义修改功能」：
       群里的脸**可以被改**，且只影响这个群（不动专家中心/用户中心那边的形象）。
       值三态：空串 = 跟随默认（智能体图集 / 用户中心头像）；`preset:<id>` = 内置头像；
       `data:image/...` = 用户上传的图（渲染层已压到 128px，见 `19-team-avatar-picker`）。 */
    avatar: normalizeMemberAvatar(entry?.avatar),
  };
}

/** 群成员自定义头像的长度上限（≈ 128px webp 的 3 倍余量）：⛔ 不设上限 = 一张 4K 图能把群 JSON 撑爆。 */
export const MAX_MEMBER_AVATAR_CHARS = 200_000;

/** 成员头像取值归一：只认清白的两类，别的一律当"没设"（⛔ 不猜是不是图片）。 */
export function normalizeMemberAvatar(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("preset:") && raw.length <= 64) return raw;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=\s]+$/i.test(raw)) return raw.slice(0, MAX_MEMBER_AVATAR_CHARS);
  return "";
}

/**
 * 群内的「派生成员」头像覆盖表（11-07 用户：「专家团下面的成员改不了头像」）：
 * 团成员来自调度目录、**不在 group.members 里**，所以他们的脸只能单独记一份。
 * key = 界面用的成员 id（团成员是合成 id `team:<teamId>:<memberId>`），value 同 normalizeMemberAvatar。
 */
function normalizeAvatarMap(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    const id = String(key ?? "").trim();
    if (!id || id.length > 300) continue;
    const avatar = normalizeMemberAvatar(raw);
    if (avatar) out[id] = avatar;
  }
  return out;
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
    /* 派生成员（团成员，不在 members 里）的头像覆盖表 —— 见 normalizeAvatarMap */
    avatars: normalizeAvatarMap(input?.avatars),
    guard: { ...DEFAULT_GROUP_GUARD, ...(input?.guard ?? {}) },
    /* 群简介：这个群的共享背景（注入每次派活）。⛔ 与人/伙伴的私有记忆分开，别混。 */
    memory: String(input?.memory ?? "").slice(0, MAX_GROUP_MEMORY_CHARS),
    /* 项目地址（群的工作目录）：派活时作为子会话的 cwd —— 决定伙伴在哪个仓库里干活。
       ⛔ 空串 = 跟随应用默认目录（不编一个路径出来）。 */
    workspace: String(input?.workspace ?? "").trim(),
    /* 群记忆条目：带 type + origin 的结论/约定（见 normalizeMemoryNote） */
    memoryNotes,
    files,
    /* 快捷指令菜单（飞书 ChatBotMenu 的本地等价物） */
    menu,
    /* 菜单形态（飞书 INPUT_FIRST / FLOAT）：`input` 贴输入框，`float` 悬浮面板 */
    menuPlacement: normalizeMenuPlacement(input?.menuPlacement),
    /* 消息排版（11-07 用户令）：`split` 智能体靠左 / 用户靠右；`left` 全部靠左（专业群聊） */
    messageLayout: normalizeMessageLayout(input?.messageLayout),
    /* 回复模式（11-08 用户令）：`process` 运行时展示过程（默认折叠）；`placeholder` 只显示占位 */
    replyMode: normalizeReplyMode(input?.replyMode),
    /* 群消息形式（11-08 用户令：独立选项） */
    messageForm: normalizeMessageForm(input?.messageForm),
    /* 群定时任务（豆包 §③ 自动化定时）：到点 @ 指定伙伴，走同一条派活链路 */
    schedules: normalizeSchedules(input?.schedules),
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
 * 改某个成员在**这个群**里的头像（11-07 用户令：「加一个群内的成员头像自定义修改功能」）。
 * ⛔ 只改群成员表里的那一项，不碰专家中心 / 用户中心的形象 —— 那是另一个作用域
 *   （同一个专家在 A 群可以用一张脸、B 群用另一张）。
 * ⛔ `avatar` 传空串 = 恢复默认（回落智能体图集 / 用户中心头像）。
 */
/** 群消息排版（`split` / `left`）：只改一个枚举值。 */
export function setMessageLayout(group, layout) {
  return createGroup({ ...group, messageLayout: normalizeMessageLayout(layout) });
}

/** 群回复模式（`process` / `placeholder`）：同样只改一个枚举值。 */
export function setReplyMode(group, mode) {
  return createGroup({ ...group, replyMode: normalizeReplyMode(mode) });
}

/** 群消息形式：只改一个枚举值（与回复模式互不影响）。 */
export function setMessageForm(group, form) {
  return createGroup({ ...group, messageForm: normalizeMessageForm(form) });
}

export function setMemberAvatar(group, memberId, avatar) {
  const base = createGroup(group);
  const id = String(memberId ?? "");
  if (!id) return base;
  const next = normalizeMemberAvatar(avatar);
  if (base.members.some((m) => m.id === id)) {
    return { ...base, members: base.members.map((m) => (m.id === id ? { ...m, avatar: next } : m)) };
  }
  /* 团成员（调度目录派生）：写群级覆盖表；空值 = 删掉这条（恢复默认脸）。 */
  const avatars = { ...(base.avatars ?? {}) };
  if (next) avatars[id] = next; else delete avatars[id];
  return { ...base, avatars };
}

/**
 * 解析「伙伴在回复里点名，叫另一个伙伴接手」（11-06 用户令：
 * 「加了之后，他们就可以在群里 @ 沟通，不用限制啥，配套好工具就行」）。
 *
 * ── 为什么是文本协议，而不是给模型一个新工具 ────────────────────────────────
 * 被委派会话的工具面在 `thread/start` 就定死了，复用会话不会重建 ⇒ 新工具对**已有的**
 * 群伙伴会话不生效（除非改写 rollout 首行）。而这条判定发生在"产出落盘"这一刻，
 * 对老会话、老群立刻生效，零迁移。
 *
 * ── 判据（能不能触发）──────────────────────────────────────────────────────
 * **只认行首点名**：一行以 `@名字` 开头，紧跟「：」或空格，然后是要它做的事。
 *   ✅ `@洞明：帮我复核这段 diff`
 *   ✅ `@洞明 帮我复核这段 diff`
 *   ❌ `输出形态（Markdown / 表格 / PPT @星象）` ← 11-06 那次误触发的正是这种举例文本
 * ⛔ 只认群内**能派活**的伙伴（bot / 有 targetKind+targetKey / 未静音 / 不是自己）；
 * ⛔ 代码围栏里的不算（示例代码里常有 @）；
 * ⛔ 同一行只算第一个；同一条回复里同一人只算一次；`alreadyRan` 里的直接跳过（防回环）。
 *
 * @returns {{ memberId: string, name: string, ask: string }[]}
 */
export function parseAgentMentions(text, group, options = {}) {
  const g = createGroup(group);
  const excludeId = String(options?.excludeId ?? "");
  const max = Number(options?.max) > 0 ? Number(options.max) : 3;
  const already = new Set(Array.isArray(options?.alreadyRan) ? options.alreadyRan.map(String) : []);
  /* ⛔ 团成员也要能被 @：它们不在 group.members 里，但宿主能按合成 id 派给本人
     （kind:member + key <teamId>:<memberId>）。返回的 target 就是派活要用的虚拟伙伴。 */
  const kids = teamKidsOf(g, options.catalog).filter(
    (m) => m.id !== excludeId && !already.has(m.id),
  );
  const bots = [
    ...g.members.filter(
      (m) => m && m.kind === "bot" && m.id !== excludeId && m.targetKind && m.targetKey && !m.muted && !already.has(m.id),
    ),
    ...kids,
  ];
  if (!bots.length) return [];
  const flat = (v) => String(v ?? "").replace(/\s+/g, "").toLowerCase();
  const out = [];
  const seen = new Set();
  let fenced = false;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !line.startsWith("@")) continue;
    /* 行首 `@某名字` + 分隔（冒号优先，也允许直接空格）+ 内容 */
    const m = line.match(/^@([^：:@]{1,40}?)\s*(?:[：:]\s*|\s+)(\S[\s\S]*)$/);
    if (!m) continue;
    const who = flat(m[1]);
    const ask = m[2].trim();
    if (!who || !ask) continue;
    /* ⛔ 后缀模糊只对 ≥2 个字生效：`@明` 这种单字会把「洞明 / 守明」随便挑一个 ⇒ 派错人。
       单字必须**精确等于**名字才算（`@洞明` 依然可以只写全名）。 */
    const hit = bots.find(
      (b) =>
        flat(b.name) === who
        || flat(b.targetKey) === who
        || (who.length >= 2 && flat(b.name).endsWith(who)),
    );
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({ memberId: hit.id, name: hit.name, ask, target: kids.some((k) => k.id === hit.id) ? hit : null });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 伙伴的**生效上级**（11-06 用户令：「专家团的时候，默认上级就是主会话那个」）。
 *
 * · 显式设过 `managerId` ⇒ 就用它；
 * · 没设过 ⇒ 默认回落到**群主**（`leadId`，也就是这个群的主会话/发起人「我」）——
 *   群是围绕群主派活组织的，伙伴天然向它汇报，⛔ 不该是一片"(无)"让用户一个个手填；
 * · 群主自己没有上级（⛔ 不能自己当自己上级）；成员不存在 / 群主缺失 ⇒ 空串。
 *
 * ⛔ 这是**读取时兜底**，不往落盘数据里塞默认值：老群不会被偷偷改写，
 *    用户显式改过谁就是谁（`setManager` 照旧只改他点的那一条）。
 * ⛔ 判据只此一处 —— 设置页下拉、成员栏、prompt 注入全部走它（否则三处会漂）。
 */
export function resolveManagerId(group, memberId) {
  const g = createGroup(group);
  const id = String(memberId ?? "");
  const self = g.members.find((m) => m.id === id);
  if (!self) return "";
  if (self.managerId) return self.managerId;
  return g.leadId && g.leadId !== id ? String(g.leadId) : "";
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
/**
 * 把群里绑定的专家团展开成「可直接派活的团成员」虚拟条目（11-07 用户令：
 * 「成员之间互相也不会艾特」）。
 *
 * ⛔ 群账本里只有一个 `targetKind=team` 的伙伴，团里那几位从来不在 `group.members` 里
 *    ⇒ 名录看不到他们、`parseAgentMentions` 也解析不到 `@问需` ⇒ 界面表现就是"没法互相 @"。
 * 合成 id 与 @ 面板 / team-run 镜像 / 派活虚拟伙伴**同一口径**（`teamAuthorIdOf`）。
 */
export function teamKidsOf(group, catalog) {
  const g = createGroup(group);
  const cat = Array.isArray(catalog) ? catalog : [];
  const teamIds = new Set(
    g.members
      .filter((m) => m && m.kind === "bot" && m.targetKind === "team" && m.targetKey)
      .map((m) => String(m.targetKey)),
  );
  if (!teamIds.size) return [];
  const out = [];
  const seen = new Set();
  for (const entry of cat) {
    if (!entry || entry.kind !== "member" || !teamIds.has(String(entry.teamId ?? ""))) continue;
    const memberId = teamMemberIdOf(entry);
    if (!memberId) continue;
    const teamId = String(entry.teamId ?? "");
    const id = teamAuthorIdOf(teamId, memberId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: "bot",
      name: String(entry.name ?? memberId),
      targetKind: "member",
      targetKey: `${teamId}:${memberId}`,
      targetProfession: String(entry.profession ?? "团成员"),
      muted: false,
    });
  }
  return out;
}

/**
 * 协作协议（11-07 用户令：「明确各成员如何沟通、如何配合、如何相互协调、如何汇报、如何产出结果，
 * 形成清晰可执行的角色分工、沟通规范与协作流程」，并让**含专家团的群**明显优于自定义群）。
 *
 * ⛔ 三档口径，按"你在这次派活里是什么身份"给：
 *   lead   = 专家团主理人（拆活 / 并发 / 验收 / 汇总）
 *   member = 专家团成员（只管自己那一环 / 交接 / 汇报格式）
 *   single = 自定义群里的单个伙伴（一次一件事 / 缺就问 / 产出可直接用）
 * ⛔ 措辞必须是人话：这些字会被模型**照抄**进它写给别人的消息（用户两次点名"生硬/废话"）。
 * ⛔ 别写成"要求清单"式的长文：每轮派活都注入，超过 15 行就挤掉真正的事实上下文。
 */
export function collaborationProtocolLines(role) {
  if (role === "lead") {
    return [
      "协作方式（你是主理人，按这个走）：",
      "- 分工：你拆活、定顺序，给每个人写清「输入是什么、产出什么、几时交」；成品由成员出，你不代写。",
      "- 顺序：互不依赖的环节一次并发发出去；有依赖的等上一环结论再发，不让下游提前编。",
      "- 验收：先看能不能直接用（有数字、有依据、有可执行步骤）；不合格就带着具体缺口打回重做，别自己补。",
      "- 汇报：群里只发结论段——一句话结论 → 关键依据 2~3 条 → 风险/未决 → 下一步；过程细节留成员会话。",
      "- 冲突：两人口径不一致时摆出双方依据由你定，以群记忆里的约束为先，别让成员在群里互相说服。",
      "- 交付：最后按「结论 / 依据 / 还剩什么没做」三段给用户，不重复成员已经发进群的原话。",
    ];
  }
  if (role === "member") {
    return [
      "协作方式（你在团里只管自己这一环）：",
      "- 先对齐再动手：一句话确认「输入是什么、产出什么、交给谁」；缺输入就直接说要什么，别猜着做。",
      "- 别越界：别人的环节不替他们下结论；要人接手就另起一行 \`@名字：要他做什么\`，宿主会真派。",
      "- 交付：结论先行 → 关键依据 2~3 条 → 风险/未决 → 下一步；有数字给数字，有文件给路径。",
      "- 不重复：群里别人说过的不再复述，同一件事只报一次；你只补你那一部分。",
      "- 卡住就说卡在哪（缺什么、等谁、要多久），别用沉默代替进度。",
    ];
  }
  return [
    "协作方式：",
    "- 一次只推进一件事：先给结论，再给关键依据，最后给下一步。",
    "- 缺信息就直接问（缺什么、为什么需要），别猜着编。",
    "- 产出要能直接用：具体数字 / 步骤 / 文件路径；不写「建议进一步分析」这种空话。",
  ];
}

/**
 * 把「本轮 @ 了谁」写回正文（11-07 真机：「艾特@看不见」）。
 *
 * 根因：@ 只作为结构化 memberIds 传给主进程，落盘的消息正文里一个 `@名字` 都没有；
 * 而我们又删掉了旧的前缀 chip（那正是「同一条消息两个 @承枢」的根因），
 * 于是 linkifyMentions 无从解析 ⇒ 群里完全看不到艾特。
 * ⛔ 修法不是把 chip 加回来，而是**在正文开头补上 @名字**，让提及与正文同源、只出现一次。
 * ⛔ 正文里已经写过这个名字就不再补（防用户手打 + 选中重复）。
 */
export function withMentionPrefix(text, names) {
  const body = String(text ?? "").trim();
  const list = (Array.isArray(names) ? names : [])
    .map((n) => String(n ?? "").trim())
    .filter(Boolean);
  const missing = list.filter((n) => !body.includes(`@${n}`));
  if (!missing.length) return body;
  return `${missing.map((n) => `@${n}`).join(" ")} ${body}`.trim();
}

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
  /* 上级走 resolveManagerId：没显式设过 ⇒ 群主（主会话那个）。 */
  const managerId = self ? resolveManagerId(g, self.id) : "";
  const manager = managerId ? g.members.find((m) => m.id === managerId) : null;
  const reports = self
    ? g.members.filter((m) => m.kind === "bot" && m.id !== self.id && canDelegate(self.id, m.id, g))
    : [];
  const hasOrg = Boolean(self?.managerId || reports.length);
  /* 群成员名录：伙伴要能 **@ 到具体的人**（互相 @ 对话的前提）。
     ⛔ 名字与 id 一起给：只有名字时模型会自己编一个 id 去调 agent_invoke（然后失败）。
     ⛔ 团成员是虚拟条目：群账本里没有它们，但它们在群里发言、也必须能被 @（见 teamKidsOf）。 */
  const kids = teamKidsOf(g, options.catalog);
  const roster = [...g.members, ...kids];
  if (!memory && !notes.length && !files.length && !hasOrg && roster.length < 2) return "";
  const lines = [`【群聊上下文 · ${g.name}】`];
  if (memory) lines.push(memory);
  /* 项目地址：不说清"在哪干活"，伙伴会在应用默认目录里乱找（相对路径全落空） */
  if (g.workspace) lines.push(`工作目录：${g.workspace}（相对路径按它算）`);
  if (roster.length) {
    if (lines.length > 1) lines.push("");
    /* ⛔ 11-07 用户令（两次）：「提示词太生硬、跟机器人一样」/「需要这么废话和多余的垃圾赘述吗」。
       ⇒ 这一段（以及下面群记忆 / 组织关系 / 参考文件）的措辞一律改成**人对人**的密度：
         去掉 `⛔` 符号与「（名字是显示名；括号里是调度目标 kind:key，用户在界面上点名时用它）」
         这类解释性赘述 —— 模型会把这套文体照抄进它写给成员的派活消息。
       ⛔ 只改措辞，**不改** `【群聊上下文 · X】…【群聊上下文结束】` 这对信封标记：
          `harness-block-strip.mjs` / `user-refs.ts` / `cloud-sync.ts` 都按它剥离，改一个字就漏进气泡。 */
    lines.push("群里的人（括号里是派活用的目标）：");
    for (const m of roster) {
      if (!m) continue;
      const isMe = self && m.id === self.id;
      const isKid = kids.some((k) => k.id === m.id);
      const role = isKid ? `团成员 · ${m.targetProfession || "成员"}` : (m.id === g.leadId ? "群主" : m.targetProfession || (m.kind === "bot" ? "伙伴" : "成员"));
      /* 团成员不塞很长的 member:<teamId>:<memberId>：模型只需要按**名字** @，目标由宿主翻。 */
      const key = !isKid && m.kind === "bot" && m.targetKind ? ` · ${m.targetKind}:${m.targetKey}` : "";
      const up = m.managerId ? ` · 上级：${g.members.find((x) => x.id === m.managerId)?.name ?? m.managerId}` : "";
      lines.push(`- ${m.name}（${role}${key}${up}）${isMe ? " ← 就是你" : ""}`);
    }
    if (self || kids.length) {
      /* 11-06 用户令：群里允许伙伴之间 @ 沟通。判据是**行首点名**（见 parseAgentMentions），
         所以提示词必须把这个格式写死 —— 写在句子中间的 @ 不会触发。
         ⛔ 11-07：团成员也在名录里，写清「真派活」而不是文本装饰，否则模型只敢自己代答。 */
      /* ⛔ 11-07：「团成员也能这样叫」只对**有团的群**成立 —— 自定义群里没有团成员，
         写了就是误导（模型会以为群里还有别人，或对用户说"我去叫团成员"）。 */
      const hasTeam = kids.length > 0 || g.members.some((m) => m.kind === "bot" && m.targetKind === "team");
      lines.push(hasTeam
        ? "要叫某个伙伴接手，另起一行写 `@名字：要他做什么`（这一行只放这句）。团成员也能这样叫，宿主会真的派给他，他的回复自己发进群。句子中间的 @ 不触发，只是给人看的。"
        : "要叫某个伙伴接手，另起一行写 `@名字：要他做什么`（这一行只放这句）；句子中间的 @ 不触发，只是给人看的。");
      /* ⛔⛔ 11-07 用户实测：「专家团会话，总是主代理说话，代替其他成员回复，其他成员会话不会直接到群里」。
         真根因在渲染层：成员产出以前只在 team_member_invoke 的返回值里（只有主理人看得到）。
         现在群聊会把成员产出**按成员自己的身份**投进群流（见 02-team-store 的 team-run 镜像），
         所以这里必须把口径写死 —— 否则主理人仍会把成员原文整段复述一遍，群里变成双份。 */
      /* ⛔ self 可能为空：团成员派活传的是合成 id（team:<teamId>:<memberId>），
         g.members 里查不到 ⇒ 上面 `if (self || kids.length)` 会进来，这里必须可选链。 */
      if (self?.targetKind === "team" || options?.forTeam) {
        lines.push("成员做完会自己把结果发进群，你只给统筹结论和下一步，别替他们复述。");
      }
    }
    /* ⛔⛔ 11-07 用户令：把"怎么配合"写清楚 —— 有专家团的群要明显强于自定义群。
       判据：名册里出现了团成员（kids）或群里有 team 伙伴 ⇒ 团版协议；否则给单人精简版。 */
    const teamLike = kids.length > 0 || g.members.some((m) => m.kind === "bot" && m.targetKind === "team");
    const role = teamLike ? ((self?.targetKind === "team" || options?.forTeam) ? "lead" : "member") : "single";
    lines.push("");
    lines.push(...collaborationProtocolLines(role));
  }
  if (notes.length) {
    if (lines.length > 1) lines.push("");
    /* ⛔ 顺序固定：约束在前（硬护栏优先级最高，豆包 SECURITY.md 放最前的同理），
       做法（runbook）其次，事实最后。 */
    lines.push("群记忆（跟你的推断冲突时以这里为准）：");
    for (const type of ["constraint", "runbook", "fact"]) {
      const list = notes.filter((n) => n.type === type);
      if (!list.length) continue;
      lines.push(`· ${MEMORY_TYPE_LABELS[type]}：`);
      for (const n of list) lines.push(`  - ${n.text}`);
    }
  }
  /* 上级**总是**有（没显式设过 ⇒ 群主），所以只要给定了「我是谁」就写这一段；
     下级白名单才是可选的。⛔ 别再拿 hasOrg 当条件 —— 那会让默认上级写不进去。 */
  if (self && manager) {
    if (lines.length > 1) lines.push("");
    lines.push("组织关系：");
    lines.push(
      `- 你的上级：${manager.name}${manager.targetProfession ? `（${manager.targetProfession}）` : ""}${
        self.managerId ? "" : "（默认 · 群主）"
      }`,
    );
    if (reports.length) {
      /* ⛔ 原来写「你可以把子任务派给：X」—— 但群伙伴自己是被委派会话，
         调 agent_invoke 会被 canDispatchFrom 挡下（防套娃）。文案必须如实，
         否则模型照着派、拿到一句看不懂的拒绝。 */
      lines.push("- 你可以叫这些伙伴接手（他们向你汇报）：" + reports.map((m) => m.name).join("、") + "。叫法同上，没事不用叫。");
    }
  }
  if (files.length) {
    if (lines.length > 1) lines.push("");
    lines.push("参考文件（直接读，别凭文件名猜内容）：");
    for (const f of files) lines.push(`- ${f.path}${f.note ? `（${f.note}）` : ""}`);
  }
  return `${lines.join("\n")}\n【群聊上下文结束】`;
}

/**
 * 从一段回复里解析出被 @ 的成员（伙伴之间互相 @ 的入口）。
 * ⛔ 只认**群里真实存在的成员名**（长名优先，避免 `@承枢` 命中 `@承枢2`）；
 * ⛔ 不解析 `@所有人`（本应用没有这个动作）。
 */
export function parseMentions(text, group, options = {}) {
  const g = createGroup(group);
  const exclude = new Set([String(options?.excludeId ?? "")].filter(Boolean));
  const src = String(text ?? "");
  const cands = g.members
    .filter((m) => m.name && !exclude.has(m.id))
    .sort((a, b) => b.name.length - a.name.length);
  const out = [];
  for (const m of cands) {
    if (!src.includes(`@${m.name}`)) continue;
    if (out.some((x) => x.id === m.id)) continue;
    out.push({ id: m.id, name: m.name, kind: m.kind });
  }
  return out;
}

/**
 * 群消息作者 id：专家团**成员**在群里发言时用的合成 id（11-07 用户令：
 * 「专家团会话总是主代理说话……其他成员会话，不会直接到群里」）。
 * 形如 `team:<teamId>:<memberId>`；⛔ 不写进群成员表（成员由主理人编排，不是独立伙伴行），
 * 渲染层按 `parseTeamAuthorId` 从调度目录里查出名字/职业/头像。
 */
export function teamAuthorIdOf(teamId, memberId) {
  const t = String(teamId ?? "").trim();
  const m = String(memberId ?? "").trim();
  if (!t || !m) return "";
  return `team:${t}:${m}`;
}

/**
 * 调度目录里「团成员」项的**裸成员 id**。
 *
 * ⛔⛔ 目录项的 `key` 是 `<teamId>:<memberId>`（dispatch-core 拼的，团队内唯一），
 *    ⛔ 它不是 memberId：直接拿 key 去拼合成 id 会得到 `team:t1:t1:问需`，
 *    派活下发的 targetKey 与目录 key 对不上 ⇒ 报「找不到可调度对象」，
 *    群里表现为"点了发送、毫无反应、也没有运行态"（11-07 真机实测踩过）。
 * 口径：优先 `memberId` 字段，取不到才按冒号切末段（兼容老 fixture / 手写数据）。
 */
export function teamMemberIdOf(entry) {
  const obj = entry && typeof entry === "object" ? entry : {};
  const explicit = String(obj.memberId ?? "").trim();
  if (explicit) return explicit;
  const key = String(obj.key ?? "").trim();
  const cut = key.indexOf(":");
  return cut >= 0 ? key.slice(cut + 1) : key;
}

/** 反解 `teamAuthorIdOf` 的产物；不是这个形状 ⇒ null。 */
export function parseTeamAuthorId(id) {
  const src = String(id ?? "");
  if (!src.startsWith("team:")) return null;
  const rest = src.slice(5);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { teamId: rest.slice(0, cut), memberId: rest.slice(cut + 1) };
}

/** 输入框里的斜杠命令（目前只有 `/stop`）。
 * ⛔ 只认**开头就是 /** 的整句；普通句子里出现 `/` 不当命令（路径、日期里到处都有）。
 */
export function parseCommand(text) {
  const src = String(text ?? "").trim();
  if (!src.startsWith("/")) return null;
  const m = /^\/([A-Za-z-]+)\s*([\s\S]*)$/.exec(src);
  if (!m) return null;
  return { name: m[1].toLowerCase(), rest: m[2].trim() };
}

/**
 * 把"同一作者、间隔很短"的连续消息并成一条（用户：「别框框刷屏」）。
 * ⛔ 只做**渲染分组**：`continued` 里仍是独立消息（各自有 itemId，可分别复制/溯源）。
 * ⛔ 不合并卡片消息（卡片的动作按钮各自独立，合并会让人不知道点的是哪条）。
 */
export function mergeConsecutive(rows, gapMs = 90_000) {
  const list = Array.isArray(rows) ? rows : [];
  const gap = Number(gapMs) > 0 ? Number(gapMs) : 90_000;
  const out = [];
  for (const r of list) {
    const prev = out[out.length - 1];
    /* ⛔ 11-08 审查确认：bot 行不能合并 —— 合并后第二条只渲染正文，
       引用行 / 文件卡 / 来源 / 用量 / 追问引用全丢（用户实测「成员消息重复/缺块」）。 */
    const canMerge = prev
      && prev.authorId === r.authorId
      && prev.authorKind !== "bot" && r.authorKind !== "bot"
      && prev.kind === "text" && r.kind === "text"
      && Number(r.at) - Number(prev.lastAt ?? prev.at) <= gap;
    if (canMerge) {
      out[out.length - 1] = { ...prev, lastAt: r.at, continued: [...(prev.continued ?? []), r] };
      continue;
    }
    out.push({ ...r, lastAt: r.at, continued: [] });
  }
  return out;
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
        /* 11-07：真实发送者（定时任务 / 伙伴转交不再默认按用户消息处理） */
        senderKind: senderKindOf(msg),
        at: Number(msg?.at ?? 0),
        kind: msg?.kind === "card" ? "card" : "text",
        text: String(msg?.text ?? ""),
        card: msg?.card ?? null,
        mentions: Array.isArray(msg?.mentions) ? msg.mentions.map(String) : [],
        /* 「由谁叫来」要跟着投影走：它是消息属性，不是日志本地字段 */
        via: msg?.via ?? null,
        usage: msg?.usage ?? null,
        runId: String(msg?.runId ?? "") || undefined,
        runFirst: msg?.runFirst === true,
        summary: msg?.summary === true,
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
    /* 11-07：结构化发送者身份。老日志缺字段 ⇒ senderKindOf 按 authorKind/authorId 推导。 */
    senderKind: senderKindOf(entry),
    at: Number(entry?.at ?? 0) || 0,
    kind: entry?.kind === "card" ? "card" : "text",
    text: String(entry?.text ?? ""),
    card: entry?.card ?? null,
    /* @ 了谁（成员 id 数组）：飞书消息里 @ 是高亮 mention，不是普通文本。
       ⛔ 只留群里真实存在的 id，别把已移除的伙伴留在消息里。 */
    mentions: Array.isArray(entry?.mentions) ? entry.mentions.map(String).filter(Boolean) : [],
    /* 这条回复是**被哪个伙伴叫来的**（11-06 伙伴之间 @ 沟通）：null = 用户派的。
       ⛔ 只存 id + 名字，不存整条消息；渲染层据此标「由 X 叫来」。 */
    via: entry?.via && typeof entry.via === "object" && String(entry.via.memberId ?? "")
      ? { memberId: String(entry.via.memberId), name: String(entry.via.name ?? "") }
      : null,
    /* 11-08 用户令「用量页脚也要一致」：这一回合的 token 用量（主进程在落消息时带上；老日志没有 ⇒ null）。 */
    /* 11-08 用户令「正文输出一次就发一次新消息 / 最早那条继续挂运行流程」：
       这一条属于哪一轮（runId）· 是否该轮**第一条**（大折叠挂在它上面）· 是否收尾汇总（文件卡挂在它上面）。 */
    runId: String(entry?.runId ?? "") || undefined,
    runFirst: entry?.runFirst === true,
    summary: entry?.summary === true,
    usage: entry?.usage && typeof entry.usage === "object"
      ? {
        inputTokens: Number(entry.usage.inputTokens ?? entry.usage.input_tokens ?? 0) || 0,
        outputTokens: Number(entry.usage.outputTokens ?? entry.usage.output_tokens ?? 0) || 0,
        cachedTokens: Number(entry.usage.cachedTokens ?? entry.usage.cached_tokens ?? 0) || 0,
        totalTokens: Number(entry.usage.totalTokens ?? entry.usage.total_tokens ?? 0) || 0,
      }
      : null,
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


/**
 * 伙伴添加模式的正反向联动（11-06 用户令：「专家团，就要纯新群聊才能加，
 * 已经自定义了，就不能专家团」「正向反向联动不做好」）。
 *
 *  · 正向：群里已有**任意**伙伴 ⇒ 不能再加专家团（团会按 SOP 自己拉起成员，
 *    与已有伙伴重复派活 / 身份串位，这就是用户点名的 BUG）。
 *  · 反向：群里已有专家团 ⇒ 不能再加单专家 / 自定义角色（成员归团统一编排）。
 *  · 两种先后顺序都判；移除后由调用方按最新伙伴表重算，自动恢复（纯函数无状态）。
 *
 * ⛔ 判据只用「有没有伙伴 / 伙伴是不是团」，⛔ 不去猜 teamId 归属：
 *    用户要的是「纯新群」这条硬规则，推断归属反而会把已有单专家误判成团成员。
 *
 * @param {unknown} partners 群里的伙伴（bot 成员）
 * @param {string} mode "expert" | "team" | "custom"
 * @returns {{ blocked: boolean, reason: string }}
 */
export function addModeStateOf(partners, mode) {
  const list = Array.isArray(partners) ? partners : [];
  const hasTeam = list.some((p) => p && p.targetKind === "team");
  if (mode === "team") {
    if (list.length > 0) {
      return {
        blocked: true,
        reason: hasTeam
          ? "群里已经有专家团了；要换成别的团，先移除它或新建一个群"
          : `专家团只能在纯新群添加：当前已有 ${list.length} 位伙伴，先移除他们或新建一个群`,
      };
    }
    return { blocked: false, reason: "" };
  }
  if (hasTeam) {
    return { blocked: true, reason: "群里已有专家团，团内成员由它统一编排；要换成自定义伙伴，先移除团或新建一个群" };
  }
  return { blocked: false, reason: "" };
}

/**
 * 群聊伙伴会话在「外面那条普通会话」里要显示的身份（11-09 用户令：
 * 「群聊名字/头像要实时同步给外面会话的伙伴会话」）。
 *
 * ⛔ 名字取**群成员当前名字**：群里看到的是哪个名字，外面会话就显示哪个
 *   （台账里的是建会话那一刻的快照，成员改名后不能再用它）。
 * ⛔ 团成员是合成 id（`team:<团队>:<成员>`），不在 `group.members` 里 ⇒
 *   名字回落台账、头像取群级覆盖表（与群视图 `faceOfId` 同一口径）。
 * @param row   群聊台账行（`{ memberId, name }`）
 * @param group 群档案；群已删 / 读不到时传 null，退回台账名字
 * @returns 可直接喂 `MemberAvatar` 的成员形状（id/name/avatar/kind/targetKind/targetKey）
 */
export function talkPartnerIdentity(row, group) {
  const memberId = String(row?.memberId ?? "");
  const members = Array.isArray(group?.members) ? group.members : [];
  const member = members.find((m) => String(m?.id ?? "") === memberId) ?? null;
  const teamKid = memberId.startsWith("team:");
  const kidId = teamKid ? memberId.split(":").slice(2).join(":") : "";
  return {
    id: memberId,
    name: String(member?.name ?? row?.name ?? ""),
    avatar: String(member?.avatar ?? group?.avatars?.[memberId] ?? ""),
    kind: String(member?.kind ?? "bot"),
    targetKind: String(member?.targetKind ?? (teamKid ? "member" : "")),
    targetKey: String(member?.targetKey ?? kidId),
  };
}

/**
 * 群成员改名（11-09 用户令：「群里的成员都加上支持改名字，联动会话改名/成员识别同步」）。
 * ⛔ 名字是群里一切展示的唯一来源（消息署名 / @ / 队列 / 资料卡）——
 *   改这里就够了，各视图按 authorId 现算，⛔ 不存消息级快照。
 * ⛔ 拒绝空名与重名（重名会让正文里的 `@名字` 解析歧义）；超过 24 字截断。
 * @returns `{ ok, changed, reason?, group }`；入参非法时 group 仍是规范化后的副本（⛔ 不写脏盘）。
 */
export function renameMember(group, memberId, name) {
  const base = createGroup(group);
  const id = String(memberId ?? "");
  const next = String(name ?? "").trim().slice(0, 24);
  const target = base.members.find((m) => m.id === id);
  if (!target) return { ok: false, changed: false, reason: "not_member", group: base };
  if (!next) return { ok: false, changed: false, reason: "empty", group: base };
  if (target.name === next) return { ok: true, changed: false, group: base };
  if (base.members.some((m) => m.id !== id && m.name === next)) return { ok: false, changed: false, reason: "duplicate", group: base };
  return { ok: true, changed: true, group: { ...base, members: base.members.map((m) => (m.id === id ? { ...m, name: next } : m)) } };
}

/**
 * 两段文本是否「几乎同一句」（11-08 用户实测「成员消息重复」）。
 *
 * 现场：成员一回合里既调了 `group_say`（把回复发进群），又写了最终回复
 * （宿主再把最终回复发进群）⇒ 同一件事出现两条。
 * 宿主侧的兜底：这一回合已经通过工具说过话时，最终回复若与工具那句高度重合就不再落盘。
 *
 * 判据（保守，宁可不合并也别吞正文）：
 *   · 去掉空白与标点后完全相等 ⇒ true；
 *   · 否则按**字符二元组**算重合率：交集 / 较短文本的二元组数 ≥ 0.5 ⇒ true。
 *     「问需，在。管数据分析这条线：接口口径、表结构、指标定义。」vs
 *     「问需已经报到过了：数据分析这条线，接口口径、表结构、指标定义归我。」≈ 0.6 ⇒ 判重。
 */
export function textsAreNearDuplicate(a, b) {
  const norm = (value) => String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、：；,.!?:;"'“”‘’()（）\[\]【】《》<>—\-…·]/g, "");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  /* ⛔⛔ 长度差太大 ⇒ 不算重复：短句（「收到，我马上开始」）的二元组会被长文全覆盖
     （重合率≈1），照着判重就会把**更详细的那条最终回复**吞掉 —— 用户丢的是真正文。
     现场判重只针对"同一句话的两种说法"，长度必须可比。 */
  const shortLen = Math.min(x.length, y.length);
  const longLen = Math.max(x.length, y.length);
  if (longLen > shortLen * 1.3 + 12) return false;
  const bigrams = (text) => {
    const set = new Set();
    for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
    return set;
  };
  const A = bigrams(x);
  const B = bigrams(y);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const gram of A) if (B.has(gram)) hit += 1;
  return hit / Math.min(A.size, B.size) >= 0.5;
}
