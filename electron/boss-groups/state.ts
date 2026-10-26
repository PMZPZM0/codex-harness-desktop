/**
 * 创世 boss · 群编排 —— 状态机（**纯函数**，无 electron / 无 IO / 无时间依赖）
 *
 * 为什么要这么严：这套东西的价值全在「打回真的会换人、超限真的会停」。
 *   ⛔ 任何一条规则写成注释/提示词都等于没有（本仓第 6 条评审就是前车之鉴），
 *      所以判定全部收在这里，且只允许抛错或返回明确结果 —— 由守卫 scripts/guards/13-boss-groups.mjs 真跑。
 * ⛔ 函数就地修改传入的 state（store 负责落盘），返回被改的那个对象；不搞不可变拷贝（这里没有并发读）。
 */
import {
  DEFAULT_POLICY, MAX_MEMBERS, MAX_EVENTS,
  type BossGroup, type BossState, type EscalateChoice, type GroupEvent, type GroupMember, type GroupPolicy,
  type GroupTask, type ReviewRecord, type TaskStatus,
} from "./types";

let seq = 0;
/** 可读 id（时间戳 + 序号），够用且便于在日志里对时。 */
function makeId(prefix: string): string {
  seq = (seq + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(2, "0")}`;
}

export function emptyState(): BossState {
  return { version: 1, groups: {}, tasks: {}, events: [] };
}

export function pushEvent(state: BossState, event: Omit<GroupEvent, "id" | "at"> & { at?: number }): GroupEvent {
  const entry: GroupEvent = { id: makeId("e"), at: event.at ?? Date.now(), ...event } as GroupEvent;
  state.events.push(entry);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  return entry;
}

export function groupOf(state: BossState, groupId: string): BossGroup {
  const group = state.groups[String(groupId ?? "")];
  if (!group) throw new Error(`群「${groupId}」不存在`);
  return group;
}

export function taskOf(state: BossState, taskId: string): GroupTask {
  const task = state.tasks[String(taskId ?? "")];
  if (!task) throw new Error(`任务「${taskId}」不存在`);
  return task;
}

export function memberOf(group: BossGroup, memberId: string): GroupMember {
  const member = group.members.find((entry) => entry.id === String(memberId ?? ""));
  if (!member) throw new Error(`成员「${memberId}」不在群「${group.name}」里`);
  return member;
}

/** 新建群：成员岗位在建群那一刻定死（`dynamicTools` 只在建会话时生效，中途改不了）。 */
export function createGroup(state: BossState, input: {
  name: string; workspace: string; bossThreadId: string;
  members: { name: string; role: string; systemPrompt?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }[];
  policy?: Partial<GroupPolicy>;
}): BossGroup {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("群名不能为空");
  if (!String(input.bossThreadId ?? "").trim()) throw new Error("缺少 boss 会话 id（群必须挂在一个会话上）");
  const members = (input.members ?? []).filter((m) => String(m?.name ?? "").trim());
  if (!members.length) throw new Error("至少要有 1 个成员");
  if (members.length > MAX_MEMBERS) throw new Error(`成员最多 ${MAX_MEMBERS} 个（再多就没有"群"的样子，并发也失控）`);

  const group: BossGroup = {
    id: makeId("g"),
    name,
    createdAt: Date.now(),
    workspace: String(input.workspace ?? ""),
    bossThreadId: String(input.bossThreadId),
    policy: {
      // ⛔ 逐字段挑，别 `{...DEFAULT, ...input.policy}` —— 渲染层传 {maxRejects: undefined}
      //    会把默认值覆盖成 undefined，之后所有比较都变 NaN（打回上限就失效了）。
      maxRejects: Number.isFinite(Number(input.policy?.maxRejects)) && Number(input.policy?.maxRejects) > 0 ? Number(input.policy?.maxRejects) : DEFAULT_POLICY.maxRejects,
      reviewer: input.policy?.reviewer ?? DEFAULT_POLICY.reviewer,
      budgetMinutes: Number.isFinite(Number(input.policy?.budgetMinutes)) && Number(input.policy?.budgetMinutes) > 0 ? Number(input.policy?.budgetMinutes) : DEFAULT_POLICY.budgetMinutes,
    },
    members: members.map((m, index) => ({
      id: `m${index + 1}_${String(m.name).trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, "").slice(0, 12) || "member"}`,
      name: String(m.name).trim(),
      role: String(m.role ?? "").trim() || "成员",
      systemPrompt: String(m.systemPrompt ?? "").trim(),
      model: m.model || undefined,
      effort: m.effort || undefined,
      sandbox: m.sandbox || "workspace-write",
      approvalPolicy: m.approvalPolicy || "on-request",
      status: "idle",
      lockedTaskIds: [],
    })),
    pinnedEventIds: [],
  };
  group.pinnedEventIds = [];
  state.groups[group.id] = group;
  pushEvent(state, { groupId: group.id, kind: "created", text: `建群「${name}」：${group.members.map((m) => `${m.name}（${m.role}）`).join("、")}` });
  return group;
}

export function addTask(state: BossState, input: {
  groupId: string; title: string; brief: string; criteria: string; assignee?: string;
}): GroupTask {
  const group = groupOf(state, input.groupId);
  const title = String(input.title ?? "").trim();
  const criteria = String(input.criteria ?? "").trim();
  // ⛔ 验收标准是审查的唯一依据：没有它，审查就退化成"我觉得不行"，打回就变成空转。
  if (!title) throw new Error("任务标题不能为空");
  if (!criteria) throw new Error("必须给验收标准（criteria）—— 审查与打回都按它判，没有它就等于没法审");
  const assignee = String(input.assignee ?? "").trim() || group.members[0]?.id || "";
  const task: GroupTask = {
    id: makeId("t"), groupId: group.id, title, brief: String(input.brief ?? "").trim(), criteria,
    assignee, status: "queued", attempts: [], rejects: 0, lockedAuthors: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  state.tasks[task.id] = task;
  pushEvent(state, { groupId: group.id, taskId: task.id, kind: "queued", text: `新任务「${title}」` });
  return task;
}

/** 派活（含打回后的重派）：这里就是"作者锁"的执法点。 */
export function assignTask(state: BossState, taskId: string, memberId: string): GroupTask {
  const task = taskOf(state, taskId);
  const group = groupOf(state, task.groupId);
  if (group.paused) throw new Error(`群「${group.name}」已暂停（预算或用户叫停），不再自动派活`);
  if (!["queued", "assigned", "rejected"].includes(task.status)) {
    throw new Error(`任务「${task.title}」当前状态 ${task.status} 不能派活（只有 queued/assigned/rejected 可以）`);
  }
  // ⛔⛔ 作者锁：被打回的作者不许再碰这条任务 —— 这是"换人重做"的全部意义。
  if (task.lockedAuthors.includes(String(memberId ?? ""))) {
    throw new Error(`成员「${memberId}」已被锁在这条任务上（上一版就是 TA 做的、被打回了）。请换一个成员重做，或升级给用户。`);
  }
  const member = memberOf(group, memberId);
  if (member.status === "removed") {
    throw new Error(`成员「${member.name}」已移出群，不能再派活`);
  }
  if (member.status === "locked" && member.lockedTaskIds.includes(task.id)) {
    throw new Error(`成员「${member.name}」当前被锁在任务「${task.title}」上`);
  }
  /* ⛔⛔ 并发唯一性（压测抓到的真实缺陷）：原来这里不看他手上有没有活 ⇒ 同一个成员可以被同时派
     两条任务并双双 running。成员的常驻线程只有一条 ⇒ 两条提示词会前后脚进同一个会话，
     成员的上下文互相污染，交活时成员状态（busy/reviewing/idle 只有一个字段）互相踩。
     ⇒ 一次只许一条「在办」（assigned / running）。reviewing 不算在办：那一步他不占线程，
        等结论期间可以接新活（打回也只锁那条任务，不影响别的）。 */
  const busyOn = Object.values(state.tasks).find((t) =>
    t.groupId === group.id && t.id !== task.id && t.assignee === member.id
    && (t.status === "assigned" || t.status === "running"));
  if (busyOn) {
    throw new Error(`成员「${member.name}」手上还有没做完的「${busyOn.title}」（${busyOn.status}），一次只能派一条活`);
  }
  task.assignee = member.id;
  task.status = "assigned";
  task.updatedAt = Date.now();
  task.attempts.push({ n: task.attempts.length + 1, memberId: member.id, threadId: "", startedAt: Date.now() });
  pushEvent(state, { groupId: group.id, taskId: task.id, memberId: member.id, kind: "assigned", text: `派活「${task.title}」→ ${member.name}（第 ${task.attempts.length} 次）` });
  return task;
}

/** turn 真的发出去之后回填线程/回合 id（派活与开跑是两步：先占位，再真正开跑）。 */
export function markRunning(state: BossState, taskId: string, input: { threadId: string; turnId?: string }): GroupTask {
  const task = taskOf(state, taskId);
  const group = groupOf(state, task.groupId);
  /* ⛔⛔ 状态闸（压测抓到的真实缺陷）：原来只要求"有 attempt" ⇒ 已打回 / 已完成 / 已升级的任务
     都能被一个迟到的回调标回 running，而且复用的是**上一次的 attempt**（人还是被锁的那个作者）。
     压测里就复现出「running 的任务派给了被锁作者」这种自相矛盾的状态。
     ⇒ 只有 assigned 能进 running，且 attempt 的成员必须就是当前 assignee（并发派活时防串）。 */
  if (task.status !== "assigned") {
    throw new Error(`任务「${task.title}」当前状态 ${task.status} 不能标 running（只有 assigned 可以；迟到的回合回调请走 settleSubmission）`);
  }
  const attempt = task.attempts[task.attempts.length - 1];
  if (!attempt) throw new Error(`任务「${task.title}」还没有 attempt，不能标 running`);
  if (attempt.memberId && attempt.memberId !== task.assignee) {
    throw new Error(`任务「${task.title}」的 attempt 属于 ${attempt.memberId}，与当前 assignee ${task.assignee} 不一致（并发派活）`);
  }
  attempt.threadId = String(input.threadId ?? "");
  attempt.turnId = input.turnId;
  attempt.startedAt = Date.now();
  task.status = "running";
  task.updatedAt = Date.now();
  const member = memberOf(group, task.assignee);
  member.status = "busy";
  pushEvent(state, { groupId: group.id, taskId: task.id, memberId: member.id, kind: "running", text: `${member.name} 开始做「${task.title}」` });
  return task;
}

/** 成员交活（回合正常结束）。注意：等待超时 ≠ 交活，别在这里收。 */
export function submitTask(state: BossState, taskId: string, output: string): GroupTask {
  const task = taskOf(state, taskId);
  const group = groupOf(state, task.groupId);
  if (task.status !== "running" && task.status !== "assigned") {
    throw new Error(`任务「${task.title}」状态 ${task.status} 不在可交活阶段`);
  }
  const attempt = task.attempts[task.attempts.length - 1];
  if (!attempt) throw new Error(`任务「${task.title}」没有 attempt`);
  attempt.output = String(output ?? "").slice(0, 20000);
  attempt.endedAt = Date.now();
  task.status = "reviewing";
  task.updatedAt = Date.now();
  const member = memberOf(group, task.assignee);
  member.status = "reviewing";
  pushEvent(state, { groupId: group.id, taskId: task.id, memberId: member.id, kind: "submitted", text: `${member.name} 交活「${task.title}」（尝试 ${attempt.n}）` });
  return task;
}

/**
 * 审查结论。approved → 完成；rejected → 记一次打回 + 锁作者，超限则升级。
 * ⛔ 打回理由必须非空：空理由的打回是"我不满意"，会把作者锁白烧一轮。
 */
export function recordReview(state: BossState, taskId: string, review: { by: string; verdict: "approved" | "rejected"; reasons: string[] }): GroupTask {
  const task = taskOf(state, taskId);
  const group = groupOf(state, task.groupId);
  if (task.status !== "reviewing" && task.status !== "submitted") {
    throw new Error(`任务「${task.title}」状态 ${task.status} 不在待审阶段`);
  }
  const reasons = (review.reasons ?? []).map((r) => String(r ?? "").trim()).filter(Boolean);
  if (review.verdict === "rejected" && !reasons.length) {
    throw new Error("打回必须给理由（且理由要对得上验收标准），空理由的打回一律拒绝");
  }
  const attempt = task.attempts[task.attempts.length - 1];
  const record: ReviewRecord = { by: review.by, verdict: review.verdict, reasons, at: Date.now() };
  if (attempt) attempt.review = record;
  task.updatedAt = Date.now();
  const member = memberOf(group, task.assignee);

  if (review.verdict === "approved") {
    task.status = "done";
    task.endedAt = Date.now();
    member.status = "idle";
    member.lockedTaskIds = member.lockedTaskIds.filter((id) => id !== task.id);
    pushEvent(state, { groupId: group.id, taskId: task.id, memberId: member.id, kind: "done", text: `审查通过：「${task.title}」（${member.name}，尝试 ${attempt?.n ?? 1}）` });
    return task;
  }

  task.rejects += 1;
  // ⛔ 作者锁：锁住的是"这条任务的这一版作者"，不是这个人。他别的活照做。
  if (!task.lockedAuthors.includes(task.assignee)) task.lockedAuthors.push(task.assignee);
  if (!member.lockedTaskIds.includes(task.id)) member.lockedTaskIds.push(task.id);
  member.status = "locked";

  const nextAssignee = pickReassignee(state, task);
  const overLimit = task.rejects >= group.policy.maxRejects;
  if (overLimit || !nextAssignee) {
    task.status = "escalated";
    task.escalation = {
      reasons,
      options: ["retry", "relax-criteria", "user-takeover"],
      at: Date.now(),
    };
    pushEvent(state, {
      groupId: group.id, taskId: task.id, memberId: member.id, kind: "escalated",
      text: overLimit
        ? `「${task.title}」已打回 ${task.rejects} 次（上限 ${group.policy.maxRejects}），升级给用户决定：${reasons.join("；")}`
        : `「${task.title}」被打回，但群里已没有未被锁的成员可派，升级给用户决定：${reasons.join("；")}`,
    });
    return task;
  }
  task.status = "rejected";
  pushEvent(state, { groupId: group.id, taskId: task.id, memberId: member.id, kind: "rejected", text: `打回「${task.title}」：${reasons.join("；")}（${member.name} 已锁，待换人）` });
  return task;
}

/** 拉人：只建档不建会话 —— 成员会话在下一次派活时才建（工具面在建会话那刻定死，所以晚建没损失）。 */
export function addMember(state: BossState, groupId: string, input: {
  name: string; role: string; systemPrompt?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string;
  /** 执行体来源（10-25 群聊重构）：默认 engine；cli = 本机外部 CLI agent。 */
  source?: "engine" | "cli";
  /** cli 成员命令模板，`{prompt}` 替换任务全文；source=cli 时必填。 */
  cliCommand?: string;
}): GroupMember {
  const group = groupOf(state, groupId);
  const name = String(input.name ?? "").trim();
  const role = String(input.role ?? "").trim() || "成员";
  if (!name) throw new Error("成员名不能为空");
  const active = group.members.filter((m) => m.status !== "removed").length;
  if (active >= MAX_MEMBERS) throw new Error(`在群成员最多 ${MAX_MEMBERS} 个（当前 ${active} 个），先移人再加`);
  const member: GroupMember = {
    id: `m${group.members.length + 1}_${name.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, "").slice(0, 12) || "member"}_${Math.floor(Math.random() * 1000)}`,
    name, role,
    systemPrompt: String(input.systemPrompt ?? "").trim(),
    model: input.model || undefined,
    effort: input.effort || undefined,
    sandbox: input.sandbox || "workspace-write",
    approvalPolicy: input.approvalPolicy || "on-request",
    status: "idle",
    lockedTaskIds: [],
    source: input.source === "cli" ? "cli" : "engine",
    cliCommand: input.source === "cli" ? String(input.cliCommand ?? "").trim() || undefined : undefined,
  };
  if (member.source === "cli" && !member.cliCommand) {
    throw new Error(`CLI 成员「${name}」必须有命令模板（cliCommand，{prompt} 会被替换成任务全文）`);
  }
  group.members.push(member);
  pushEvent(state, { groupId: group.id, memberId: member.id, kind: "note", text: `新成员进群：${member.name}（${member.role}）` });
  return member;
}

/**
 * 移人：**会话保留**（轨迹不丢），成员标 removed —— 不再接新活。
 * ⛔ 正在跑的任务**不打断**（默认口径：等它交活，结果照常回投与审查；之后由换人逻辑接管）。
 */
export function removeMember(state: BossState, groupId: string, memberId: string): GroupMember {
  const group = groupOf(state, groupId);
  const member = memberOf(group, memberId);
  if (member.status === "removed") throw new Error(`成员「${member.name}」已经被移出了`);
  const running = Object.values(state.tasks).some((t) => t.groupId === group.id && t.status === "running" && t.assignee === member.id);
  member.status = "removed";
  member.lockedTaskIds = [];
  pushEvent(state, {
    groupId: group.id, memberId: member.id, kind: "note",
    text: running
      ? `${member.name} 已移出群；TA 手上正在跑的任务**不打断**，交活后照常审查，之后不再派活。`
      : `${member.name} 已移出群（TA 的会话与轨迹保留）。`,
  });
  return member;
}

/** 置顶/取消置顶某条群事件（视图层收藏，最多 3 条，超出挤掉最旧）。 */
export function setPinned(state: BossState, groupId: string, eventId: string, pinned: boolean): BossGroup {
  const group = groupOf(state, groupId);
  const event = state.events.find((e) => e.id === String(eventId ?? "") && e.groupId === group.id);
  if (!event) throw new Error("事件不存在或不属于这个群");
  group.pinnedEventIds = group.pinnedEventIds ?? [];
  if (pinned) {
    if (!group.pinnedEventIds.includes(event.id)) {
      group.pinnedEventIds.push(event.id);
      while (group.pinnedEventIds.length > 3) group.pinnedEventIds.shift();
    }
  } else {
    group.pinnedEventIds = group.pinnedEventIds.filter((id) => id !== event.id);
  }
  return group;
}

/** 下一个可派的人：不在锁名单、状态不是 locked。全被锁 ⇒ null（调用方必须升级，不许放行）。 */
export function pickReassignee(state: BossState, task: GroupTask): GroupMember | null {
  const group = groupOf(state, task.groupId);
  /* ⛔⛔ 手上已有在办任务的成员不能被选中。运行态压测实测：不筛这一条时，一次并发派 40 条活
     会对**同一个空闲成员**连派 ⇒ 第 2 条起全被并发闸拒掉（实测 40 条只成功 1 条），
     用户看到的就是「派活失败」，而不是「排队」。 */
  const busyIds = new Set(Object.values(state.tasks)
    .filter((t) => t.groupId === group.id && t.id !== task.id && (t.status === "assigned" || t.status === "running"))
    .map((t) => t.assignee));
  for (const member of group.members) {
    if (member.status === "removed") continue;          // ⛔ 已移出的成员不再接新活
    if (busyIds.has(member.id)) continue;               // ⛔ 手上还有没做完的活
    if (task.lockedAuthors.includes(member.id)) continue;
    if (member.status === "locked" && member.lockedTaskIds.includes(task.id)) continue;
    return member;
  }
  return null;
}

/**
 * 旧账本兼容：老值 `retry-with-other-model` 归一成 `retry`。
 * ⛔ 落盘里已经存着老值的升级记录（escalation.options 是历史快照）⇒ 读的时候必须能认，
 *    否则用户点"重做"会撞一句"choice 只能是…"。
 */
export function normalizeEscalateChoice(choice: unknown): EscalateChoice | null {
  const raw = String(choice ?? "").trim();
  if (raw === "retry" || raw === "retry-with-other-model") return "retry";
  if (raw === "relax-criteria" || raw === "user-takeover") return raw;
  return null;
}

/** 用户的三个选项（P0：retry / relax / takeover 都只是把状态推进到可继续，不自动改标准）。 */
export function resolveEscalation(state: BossState, taskId: string, choice: EscalateChoice, note?: string): GroupTask {
  const task = taskOf(state, taskId);
  const group = groupOf(state, task.groupId);
  if (task.status !== "escalated") throw new Error(`任务「${task.title}」不在升级状态（当前 ${task.status}）`);
  const action = normalizeEscalateChoice(choice);
  if (!action) throw new Error(`升级选项不认识：「${String(choice)}」（只有 retry / relax-criteria / user-takeover）`);
  if (action === "user-takeover") {
    task.status = "done";
    task.endedAt = Date.now();
    pushEvent(state, { groupId: group.id, taskId: task.id, kind: "note", text: `用户接手「${task.title}」${note ? `：${note}` : ""}` });
    return task;
  }
  if (action === "relax-criteria") {
    // ⛔ 放宽标准必须**写进 criteria**（不然下一轮审查还按老的判，打回会再来一次）。
    const relaxed = String(note ?? "").trim();
    if (!relaxed) throw new Error("放宽标准必须给出放宽后的验收标准（note），否则审查仍按老标准打回");
    task.criteria = relaxed;
  }
  // retry / relax：解锁全部作者（用户已介入，锁的目的已达成）+ 清零打回计数，重新进队。
  task.lockedAuthors = [];
  task.rejects = 0;
  task.escalation = undefined;
  task.status = "queued";
  task.updatedAt = Date.now();
  const member = group.members.find((m) => m.lockedTaskIds.includes(task.id));
  for (const m of group.members) {
    m.lockedTaskIds = m.lockedTaskIds.filter((id) => id !== task.id);
    if (m.status === "locked" && !m.lockedTaskIds.length) m.status = "idle";
  }
  pushEvent(state, {
    groupId: group.id, taskId: task.id, kind: "note",
    /* ⛔ 文案跟行为一致：这里**不换模型**，只是解锁 + 清零后按原样重排队。 */
    text: `用户决定：${action === "relax-criteria" ? "放宽标准后重做" : "清锁重排队"}「${task.title}」${member ? `（原锁：${member.name}）` : ""}`,
  });
  return task;
}

/** 预算：只按**分钟**算（tokens 要引擎用量口径，P1 再接，别编）。返回是否刚刚越过阈值。 */
export function checkBudget(state: BossState, groupId: string, now = Date.now()): { usedMinutes: number; ratio: number; warn?: "80" | "100" } {
  const group = groupOf(state, groupId);
  const usedMinutes = (now - group.createdAt) / 60000;
  const ratio = group.policy.budgetMinutes > 0 ? usedMinutes / group.policy.budgetMinutes : 0;
  if (ratio >= 1 && group.paused !== true) {
    group.paused = true;
    pushEvent(state, { groupId: group.id, kind: "budget", text: `预算用尽（${Math.round(usedMinutes)} 分钟 / ${group.policy.budgetMinutes} 分钟），全群暂停` });
    return { usedMinutes, ratio, warn: "100" };
  }
  if (ratio >= 0.8) return { usedMinutes, ratio, warn: "80" };
  return { usedMinutes, ratio };
}

/** 账本快照（给 boss 工具与看板用）：只读、可直接 JSON 化。 */
export function snapshot(state: BossState, groupId: string) {
  const group = groupOf(state, groupId);
  const tasks = Object.values(state.tasks).filter((t) => t.groupId === group.id);
  const counts: Record<TaskStatus, number> = {
    queued: 0, assigned: 0, running: 0, submitted: 0, reviewing: 0,
    approved: 0, rejected: 0, escalated: 0, done: 0, failed: 0,
  };
  for (const task of tasks) counts[task.status] += 1;
  return {
    group: {
      id: group.id, name: group.name, paused: Boolean(group.paused), createdAt: group.createdAt,
      workspace: group.workspace, bossThreadId: group.bossThreadId, policy: group.policy,
      members: group.members.map((m) => ({
        id: m.id, name: m.name, role: m.role, status: m.status,
        threadId: m.threadId ?? "", lockedTaskIds: m.lockedTaskIds,
        source: m.source ?? "engine",
      })),
      pinnedEventIds: group.pinnedEventIds ?? [],
    },
    counts,
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, assignee: t.assignee, rejects: t.rejects,
      criteria: t.criteria, lockedAuthors: t.lockedAuthors, escalation: t.escalation ?? null,
      attempts: t.attempts.map((a) => ({ n: a.n, memberId: a.memberId, threadId: a.threadId, startedAt: a.startedAt, endedAt: a.endedAt ?? null, verdict: a.review?.verdict ?? null, reasons: a.review?.reasons ?? [] })),
    })),
    events: state.events.filter((e) => e.groupId === group.id).slice(-40),
  };
}

/** 严格解析评审输出：只认 JSON。解析不出来 ⇒ 打回（带原因），绝不默认通过。 */
export function parseVerdict(text: string): { verdict: "approved" | "rejected"; reasons: string[] } {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      const pass = parsed?.pass === true;
      const reasons = Array.isArray(parsed?.reasons) ? parsed.reasons.map((r: unknown) => String(r ?? "").trim()).filter(Boolean) : [];
      if (pass) return { verdict: "approved", reasons: [] };
      return { verdict: "rejected", reasons: reasons.length ? reasons : ["评审未给出具体理由（按验收标准不通过）"] };
    } catch { /* 落到下面 */ }
  }
  return { verdict: "rejected", reasons: ["评审输出不是可解析的 JSON 结论，无法判定通过"] };
}
