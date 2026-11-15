/**
 * 专家团成员调度 —— **主进程实现**（10-22 从 features/teams-ipc.ts 原样搬出）。
 *
 * 为什么要单独成模块：同一条链路有两个入口 ——
 *   ① 渲染层收到 `item/tool/call`（用户正在看这个团队会话）→ IPC `teams:invoke-member`；
 *   ② 渲染层**收不到**该事件（团队会话在后台跑，被 renderer-fuse 按会话裁掉）→ 主进程兜底应答
 *      （见 electron/team-tool-fallback.ts）。两个入口必须共用**同一份**实现，否则行为迟早分叉。
 *
 * ⛔ 搬家时只把 `secure`（容器接缝）换成 electron 的 `safeStorage`：本文件在 features/ 之外，
 *    不受【266】「域不许直取宿主能力」的约束（同 cloud-api.ts 的处理）。
 * ⛔ 三条实证口径（原样保留）：成员线程复用 / 成员线程标题必须设 / 记忆注入排在 beginRun 之前。
 */
import { app, safeStorage } from "electron";
import { buildDelegateMemory } from "./delegate-memory";
import { memberThreadName } from "./team-runs";
import { bridgeDial } from "./main";
import { ensureProjectAgentsMd } from "./project-conventions";
import { readPersonalization } from "./personalization";
import { personalNormsPrompt } from "../src/lib/engineering-norms.mjs";
/* 11-07：主理人 → 成员这条链也要写结构化发件人（外层对话框据此判「上级」）。 */
import { senderLineOf, taskLineOf } from "../src/lib/message-origin.mjs";
import { MEMBER_TASK_NOTE, humanizeRefs } from "../src/lib/dispatch-voice.mjs";
import { parseAgentMentions, teamAuthorIdOf, collaborationProtocolLines } from "../src/lib/team-models.mjs";
/* ⛔ 11-10：两条产出链（群聊通道 / 专家团成员通道）共用同一份硬约束判据，⛔ 不各写一套。 */
import { evaluateMemberOutput } from "./features/group-talk";
import { appendMemberOutputToGroup, groupOfTeam, recentGroupMessages } from "./team-group-bridge";
/* ⛔ 名册 + 能力清单只有一份口径（主理人系统提示词与成员上下文共用）。 */
/* ⛔ 直连 06（别走 expert-teams 桶：那会把 02/04/14/15/16/07 全拖进来，依赖面白白变大）。 */
import { memberRosterLines } from "./expert-teams/06-team-tools";
import { PROVIDER_RETRY_TUNING } from "./provider-retry";
import { ensureSessionAlias, supervisorLabelOf } from "./session-alias";
import { refreshSupervisorScopeForThread } from "./session-scope";
import { HARNESS_PROVIDER_ID } from "./provider-id";
import { shouldBindHarness } from "./thread-provider";
import { readCustomModel, originSessionModel } from "./main/01-model-catalog";
import { TURN_WAIT_BACKGROUND_NOTE, TURN_WAIT_TIMEOUT_CODE, turnOutputText, waitForTurnCompletion } from "./main/03-turn-summary";
import { noteRoleThread } from "./role-memory-tool";
import { server, teamRunStore, threadCwd, threadRuntimeStore, delegateRegistry } from "./runtime-refs";
import { readUsableExpertTeams } from "./expert-teams";
/* ⛔ 11-11：成员开跑/收尾要广播到群里（否则主理人挂了、群里看不到有人在干活）。 */
import { broadcastHarnessEvent } from "./features/window-bus";

/** 成员调度入参（渲染层与主进程兜底共用）。 */
export type InvokeMemberInput = {
  teamId: string;
  memberId: string;
  query: string;
  leadThreadId?: string;
  cwd?: string;
  model?: string;
  effort?: string;
  sandbox?: string;
  approvalPolicy?: string;
  /** 成员互 @ 的递归深度（内部用；0 = 可再叫一位，1 = 不再往下派，防互 @ 对烧）。 */
  hop?: number;
};

export type InvokeMemberResult = {
  threadId: string;
  turnId: string | null;
  teamId: string;
  memberId: string;
  name: string;
  profession: string;
  output: string;
  runId: string;
  reused: boolean;
};

/** 调一个团成员：按「主理人会话 + 团队 + 成员」加锁串行（并行阶段对同一成员重复提交会各起一个会话）；不同成员仍并行。 */
/* ⛔⛔ 11-12 用户（连着四条）：「模型不知道自己要干什么，成员也不知道自己要干什么，团队是散的，
   互相不了解对方的能力和擅长领域」「交完就没事了」「飞书里智能体之间配合天衣无缝，团队是一个整体」。
   根因：成员会话只拿到**自己那一句任务**，不知道团队在做什么、同事擅长什么、上一环交回了什么
   ⇒ 各干各的、产出接不上、交完就停。
   ⇒ 每次派活都把「团队整体」拼进成员的系统前缀：成员名册（含擅长）＋ 团队负责人最近说的（计划/先后）。
   ⛔ 只读群日志快照，⛔ 不改任何状态；没接群就退化成"只有名册"，不影响派活。 */
function teamBriefOf(
  team: { teamId: string; displayName?: { zh?: string }; description?: { zh?: string };
    lead?: { id?: string; name?: string; profession?: { zh?: string }; description?: string };
    members?: Array<{ id: string; name: string; profession?: { zh?: string }; description?: string }> },
  memberId: string,
  groupId: string,
): string {
  const roster = memberRosterLines(team as never, { withLead: true, selfId: memberId });
  /* 团队负责人最近说的一两条（多半就是那份计划）——成员据此对齐，别自己另起一套。 */
  const leadId = teamAuthorIdOf(team.teamId, String(team.lead?.id ?? ""));
  const rows = groupId ? recentGroupMessages(groupId) : [];
  const plan = rows
    .filter((row) => String(row?.authorId ?? "") === leadId && String(row?.text ?? "").trim().length >= 20)
    .slice(-2)
    .map((row) => String(row.text).replace(/\s+/g, " ").trim().slice(0, 420))
    .join("\n…\n");
  /* ⛔⛔ 11-15 用户：「都是那种傻逼，完全不知道群里在干嘛，就是系统让他干嘛，他就干嘛」。
     根因：成员只拿到自己那一句任务 —— 群里刚聊了什么、谁已经说过话、自己是不是已经露过面，
     一概不知 ⇒ 每次都当第一次（「第三次露面了」「又轮到我」）、产出也接不上群里的语境。
     ⇒ 把群里**最近的原始对话**（除自己外）也拼进去，每条截断，总量封顶。
     ⛔ 只读快照，不写、不改游标（成员的"未读"由群聊那条链自己管）。 */
  const nameOfAuthor = (authorId: string): string => {
    const me = teamAuthorIdOf(team.teamId, memberId);
    if (!authorId || authorId === me) return "";
    if (authorId === "local-user") return "用户";
    const all = [team.lead, ...(team.members ?? [])].filter(Boolean) as Array<{ id: string; name: string }>;
    const hit = all.find((m) => teamAuthorIdOf(team.teamId, String(m.id)) === authorId);
    return hit ? String(hit.name) : "";
  };
  const transcript: string[] = [];
  let used = 0;
  for (const row of rows.slice(-14).reverse()) {
    const who = nameOfAuthor(String(row?.authorId ?? ""));
    const body = String(row?.text ?? "").replace(/\s+/g, " ").trim();
    if (!who || !body) continue;
    const line = `${who}：${body.length > 180 ? `${body.slice(0, 180)}…` : body}`;
    if (used + line.length > 1400) break;
    used += line.length;
    transcript.unshift(line);
  }
  return `# 你们这个团队（一个整体，不是各干各的）
${String(team.displayName?.zh ?? "")}${team.description?.zh ? `：${String(team.description.zh).slice(0, 120)}` : ""}

## 成员与各自擅长（要协作就直接找对人）
${roster}
${plan ? `\n## 团队负责人最近说的（对齐它，别自己另起一套）\n${plan}\n` : ""}
${transcript.length ? `\n## 群里最近在聊什么（原文，按时间从早到晚；⛔ 你已经说过的话就在里面，别重复介绍自己）\n${transcript.join("\n")}\n` : ""}
⛔ 你的产出要接得上团队整体：写清交付物放在哪、下一步该谁接；需要别人配合就另起一行写 \`@名字：要他做什么\`（宿主会真的把他叫进来）。
⛔⛔ 发言纪律（11-15 用户：「什么时候该回消息不知道吗，都是系统推着走的吗」）：
  · 先看上面「群里最近在聊什么」，**别人已经答过的不要再答一遍**，你已经说过的不要再自我介绍；
  · 只有你这一轮确实有新信息（新结论 / 新交付物 / 需要别人配合）才写实质内容；
  · 没有新东西就只回一句「收到，无需补充」，⛔ 不要复述上级的任务、不要复述别人的话；
  · 不要因为"被叫到"就必然长篇输出 —— 没话说是可以的。
`;
}

/** 派一个成员执行任务的核心链路（按「主理人+团队+成员」串行、登记会话、回收结果）。 */
export async function invokeTeamMemberCore(input: InvokeMemberInput): Promise<InvokeMemberResult> {
  /* 同一「主理人会话 + 团队 + 成员」串行：并行阶段可能对同一成员重复提交任务，
     两条并发会在线程登记前各自 thread/start，产生重复会话。锁只按成员，不同成员仍并行。 */
  const lockKey = `${String(input.leadThreadId ?? "")}|${String(input.teamId ?? "")}|${String(input.memberId ?? "").trim().toLowerCase()}`;
  return withMemberLock(lockKey, () => invokeTeamMemberCoreUnlocked(input));
}

/* ── 派活回执：同一批只发**一条**消息，里面 @ 多个成员（11-15 用户令） ───────────
   用户原话：「一个消息艾特多个成员就可以解决的问题，一个消息艾特一个成员，不刷屏，见鬼了」。
   旧实现每次派活落一条 `@成员：任务` ⇒ 派 4 位 = 4 条几乎一样的消息 = 刷屏。
   ⇒ 并行派活的多次调用落在同一个 900ms 窗口内，合并成**一条**：
      · 同一件活：`@观湖 @执矩 @蔡本 @衡岱：<任务>`
      · 各有各的活：一条消息里每人一行 `@观湖：<任务>`
   ⛔ 不要再退回「一位成员一条消息」—— 那就是用户明确要删的机制。 */
type DispatchEchoRow = { name: string; brief: string };
type DispatchEcho = { leadAuthorId: string; since: number; rows: DispatchEchoRow[] };
const dispatchEchoes = new Map<string, DispatchEcho>();
const DISPATCH_ECHO_WINDOW_MS = 900;

function queueDispatchEcho(groupId: string, leadAuthorId: string, name: string, brief: string, since: number): void {
  const gid = String(groupId ?? "");
  const who = String(name ?? "").trim();
  const task = String(brief ?? "").trim();
  if (!gid || !who) return;
  const cur = dispatchEchoes.get(gid);
  if (cur && since - cur.since <= DISPATCH_ECHO_WINDOW_MS) {
    if (!cur.rows.some((row) => row.name === who)) cur.rows.push({ name: who, brief: task });
    return;
  }
  if (cur) flushDispatchEcho(gid);
  dispatchEchoes.set(gid, { leadAuthorId, since, rows: [{ name: who, brief: task }] });
  /* ⛔ 定时刷出：并发派活时最后一个成员可能晚到，不能等"下一次调用"才发。 */
  setTimeout(() => flushDispatchEcho(gid), DISPATCH_ECHO_WINDOW_MS);
}

function flushDispatchEcho(groupId: string): void {
  const pending = dispatchEchoes.get(groupId);
  if (!pending) return;
  dispatchEchoes.delete(groupId);
  if (!pending.rows.length) return;
  const mentions = (names: string[]) => names.map((n) => `@${n}`).join(" ");
  /* 按任务分组：同一件活的人合成一行（这才是"一条消息艾特多个成员"）。 */
  const byBrief = new Map<string, string[]>();
  for (const row of pending.rows) {
    const list = byBrief.get(row.brief) ?? [];
    if (!list.includes(row.name)) list.push(row.name);
    byBrief.set(row.brief, list);
  }
  const text = byBrief.size === 1
    ? `${mentions([...byBrief.values()][0])}：${[...byBrief.keys()][0]}`
    : [...byBrief.entries()].map(([brief, names]) => `${mentions(names)}：${brief}`).join("\n");
  void appendMemberOutputToGroup(groupId, {
    /* ⛔ 一个批次一个 id：渲染层按 `team-dispatch:` 前缀识别"宿主写的派活交接"，⛔ 不改前缀。 */
    id: `team-dispatch:${groupId}:${pending.since}`,
    authorId: pending.leadAuthorId,
    authorKind: "bot",
    senderKind: "member",
    text,
  }, pending.since).catch(() => undefined);
}

/* 同一条用户消息内「谁已经被派过」的记账（见 invokeTeamMemberCoreUnlocked 里的硬上限）。
   键 = 群 + 该群最后一条用户消息的时刻 + 成员 id；值恒为 1（只需要"派过没有"）。 */
const dispatchTurns = new Map<string, number>();

const memberLocks = new Map<string, Promise<void>>();
async function withMemberLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = memberLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = prev.then(() => gate);
  memberLocks.set(key, tail);
  await prev;
  try { return await fn(); }
  finally {
    release();
    if (memberLocks.get(key) === tail) memberLocks.delete(key);
  }
}

async function invokeTeamMemberCoreUnlocked(input: InvokeMemberInput): Promise<InvokeMemberResult> {
  const list = await readUsableExpertTeams();
  const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
  if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
  if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
  const memberKey = String(input.memberId ?? "").trim().toLowerCase();
  const member = team.members.find((m) => m.id.toLowerCase() === memberKey);
  if (!member) throw new Error(`成员「${input.memberId}」不存在于专家团「${team.displayName.zh}」`);
  /* ⛔ 任何子会话都不能调度成员：只有团队主理人会话可以。成员/被委派会话即使绕过工具面
     拿到 team_member_invoke（旧会话、伪造 IPC），在这里也一律拒绝。
     兼容旧档案：主理人标记缺失时，用「线程属于本团且不是成员线程」兜底。 */
  const leadThreadId = String(input.leadThreadId ?? "");
  const leadTeam = leadThreadId ? teamRunStore.teamOfThread(leadThreadId) : "";
  const isLead = Boolean(leadThreadId)
    && leadTeam === team.teamId
    && (teamRunStore.isLeadThread(leadThreadId) || !teamRunStore.isMemberThread(leadThreadId));
  if (!isLead) throw new Error("只有专家团主理人会话可以调度成员；当前会话是子会话，没有调度权限。");
  /* ⛔⛔ 11-15 用户令（截图 + 「成员每个傻逼都要重复回两次」「一直反反复复刷屏」「删了，重新做」）：
     实测台账：一句「喊你的成员出来打个招呼」，四位成员各自回了 **3 遍**自我介绍
     （runId 三个不同的 run-…，间隔 8~15 秒）。根因不是模型乱说，是宿主允许：
     一条用户消息内每位成员最多跑 3 次（MAX_TURNS_PER_MEMBER），而主理人每次被回喂后
     又派一轮 ⇒ 同一句需求把同一个人反复拉起来。
     ⇒ 硬上限：**同一条用户消息内，一位成员最多被派 1 次**（按 (群, 用户消息时刻, 成员) 计）。
       要打回重做：用户发下一条消息，或主理人自己动手改 —— 不在同一条需求里反复拉同一个人。
     ⛔ 不在群里（独立团会话 / 主对话派团）不加此限：那边产出走工具返回、不进群，不构成刷屏。 */
  const capGroupId = groupOfTeam(String(team.teamId ?? ""));
  if (capGroupId) {
    const rows = recentGroupMessages(capGroupId);
    const lastUserAt = rows.reduce(
      (acc, row) => (String(row?.authorId ?? "") === "local-user" ? Math.max(acc, Number(row?.at ?? 0)) : acc),
      0,
    );
    const key = `${capGroupId}|${lastUserAt}|${String(member.id)}`;
    if (Number(dispatchTurns.get(key) ?? 0) >= 1) {
      return {
        threadId: "", turnId: null, teamId: String(team.teamId), memberId: String(member.id),
        name: String(member.name), profession: String(member.profession?.zh ?? ""),
        output: `（本轮已经派过 ${member.name}，同一条需求内不重复派；要打回重做请在下一条消息里说，或你自己改）`,
        runId: "", reused: true,
      };
    }
    dispatchTurns.set(key, 1);
    if (dispatchTurns.size > 500) dispatchTurns.clear();
  }
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  /* ⛔⛔ 10-31 用户令「成员跟随主会话的模型配置」：成员模型优先级 = 显式指定 →
     **主理人会话的会话级模型**（originSessionModel，按激活供应商清单归一）→ 成员档案里存的旧值 → 全局。
     原先把 member.model 排在主会话前面 ⇒ 主理人换了模型、成员还跑在几周前存的旧模型上
     （实测：成员被建在 harness 供应商下却拿着 custom964 —— 引擎直接拒「供应商不一致」）。 */
  const originModel = await originSessionModel(String(input.leadThreadId ?? ""), threadRuntimeStore);
  const effectiveModel = input.model || originModel || member.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法调度团队成员");

  // ① 成员线程复用：**同一场团运行（主理人会话）+ 同一成员** 沿用同一个线程，
  //    成员因此在多阶段派活之间记得自己做过什么（跨阶段上下文不必靠主理人内联复述）。
  //    ⛔⛔ 10-29 起复用键含 ownerThreadId：不同用户会话派同一个团时**各自一条线程**，
  //       成员不会带着上一个会话的历史进来（会话级归属，防跨会话串用）。
  const ownerThreadId = String(input.leadThreadId ?? "");
  const existingThreadId = teamRunStore.memberThreadOf(ownerThreadId, team.teamId, member.id);
  let memberThreadId = "";
  if (existingThreadId) {
    /* ⛔⛔ 10-31 用户令「旧会话也要自动更新」：复用的成员线程是**创建那一刻**绑定的模型/供应商
       —— 发起方后来换了模型，光靠 turn/start 带 model 仍会撞「线程绑定供应商 ≠ 模型」的墙。
       ⇒ 复用时走 thread/resume 的**官方迁移通道**（渲染层 alignThreadToProvider 同款：
         excludeTurns:true + model/modelProvider/config 重绑），把常驻线程重新钉到主会话当前模型。
       ⛔ resume 必须带 sandbox/approvalPolicy：不带会把线程权限重置回默认（渲染层迁移实证）。 */
    const resumed: any = await server.request("thread/resume", {
      threadId: existingThreadId,
      excludeTurns: true,
      model: effectiveModel,
      modelProvider: shouldBindHarness(customModel) ? HARNESS_PROVIDER_ID : undefined,
      sandbox: member.sandbox || input.sandbox || "workspace-write",
      approvalPolicy: member.approvalPolicy || input.approvalPolicy || "never",
      ...(shouldBindHarness(customModel) ? {
        config: { model_provider: HARNESS_PROVIDER_ID, model_providers: { [HARNESS_PROVIDER_ID]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } },
      } : {}),
    }).catch(() => null);
    if (resumed?.thread?.id) {
      memberThreadId = String(resumed.thread.id);
      threadCwd.set(memberThreadId, String(input.cwd || process.cwd())); /* 文件变更追踪 cwd 登记（10-01，复用线程同样要登记） */
    }
  }
  if (!memberThreadId) {
    ensureProjectAgentsMd(input.cwd || process.cwd());
    const started: any = await server.request("thread/start", {
      model: effectiveModel,
      cwd: input.cwd || process.cwd(),
      approvalPolicy: member.approvalPolicy || input.approvalPolicy || "never",
      sandbox: member.sandbox || input.sandbox || "workspace-write",
      modelProvider: shouldBindHarness(customModel) ? HARNESS_PROVIDER_ID : undefined,
      config: shouldBindHarness(customModel) ? { model_provider: HARNESS_PROVIDER_ID, model_providers: { [HARNESS_PROVIDER_ID]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
    });
    memberThreadId = String(started.thread.id);
    threadCwd.set(memberThreadId, String(input.cwd || process.cwd())); /* 文件变更追踪 cwd 登记（10-01） */
    // ② 成员线程标题：`团名·角色`。不设名字时引擎拿首条用户消息（角色提示词全文）当标题，
    //    侧栏里会显示成一整坨提示词（09-14 实测截图）。
    try { await server.request("thread/name/set", { threadId: memberThreadId, name: memberThreadName(team.displayName.zh, member.profession.zh || member.name) }); } catch { /* 命名失败不阻塞调度 */ }
  }
  teamRunStore.rememberMemberThread(ownerThreadId, team.teamId, member.id, memberThreadId);
  teamRunStore.setThreadTeam(memberThreadId, team.teamId);
  /* ★ 10-31 用户令：成员会话也要有笔名、也知道自己归哪个主管（= 本团主理人会话）。 */
  await ensureSessionAlias(memberThreadId, String(input.leadThreadId ?? "")).catch(() => undefined);
  const memberSupervisor = await supervisorLabelOf(memberThreadId).catch(() => "");
  /* ⛔ 11-03：普通被调度会话也要有会话级「直接上级」，不能只写在首条任务里（会被历史淹没）。 */
  await refreshSupervisorScopeForThread(memberThreadId).catch(() => false);

  /* 主理人 → 成员这条路径同样要补记忆（09-23）。工作区用显式 cwd；拿不到就只注入 L0 用户档案。
     ⛔ 必须排在 `beginRun` **之前**：beginRun 会广播 started（点亮成员头像 + 自动弹成员工作窗），
        记忆在云模式要发一次召回请求，排在后面就会出现"面板已打开但没有任何进展"的空窗。 */
  const invokedRole = { kind: "team-member" as const, id: team.teamId, memberId: member.id, label: `${team.displayName.zh}·${member.name}` };
  const invokedMemory = await buildDelegateMemory({
    workspace: input.cwd,
    query: String(input.query ?? ""),
    originThreadId: String(input.leadThreadId ?? ""),
    role: invokedRole,
    /* ⛔⛔ 10-30：成员是**常驻会话**（memberThreadId 会复用）⇒ 传它自己，记忆才会跨轮累积；
       原先只传 leadThreadId ⇒ 成员读的是**主理人**的私有层，自己写的那份永远读不回来。 */
    threadId: String(memberThreadId ?? ""),
    teamId: team.teamId,
  });
  await noteRoleThread(app.getPath("userData"), String(memberThreadId), invokedRole, String(input.cwd ?? "")).catch(() => undefined);

  // 运行记录：开始时广播 started（界面点亮头像 + 自动打开成员工作弹窗），
  // 跑的过程由 teamRunStore.handleEngineEvent 转发流式增量，结束时落盘并广播 finished。
  const run = teamRunStore.beginRun({
    leadThreadId: String(input.leadThreadId ?? ""),
    teamId: team.teamId,
    memberId: member.id,
    memberName: member.name,
    profession: member.profession.zh,
    role: "member",
    memberThreadId,
    query: String(input.query ?? ""),
  });
  /* 联动专家（11-03）：成员被主理人调用时也带上前端设计 + 后端工程 / 架构规范。 */
  const userNorms = await readPersonalization()
    .then((config) => personalNormsPrompt(config))
    .catch(() => "");
  const systemPrefix = `[专家团「${team.displayName.zh}」成员 ${member.name}（${member.profession.zh}）]\n${member.systemPrompt}\n\n`
    + (userNorms ? `# User norms (frontend design + backend engineering / architecture)\n${userNorms}\n\n` : "")
    /* ⛔⛔ 11-07 用户令：成员也要知道「怎么沟通 / 配合 / 协调 / 汇报 / 产出」。
       团成员会话由 team_member_invoke 起，拿不到群派活的 groupContextBlock —— 协议必须在这里再给一份。
       ⛔ 与 team-models 同一份纯函数，别在提示词里抄第二套文案。 */
    + "# 协作方式\n" + collaborationProtocolLines("member").slice(1).join("\n") + "\n\n"
    /* ⛔⛔ 11-12：把「团队整体」交给成员（名册 + 负责人最近那份计划）。见 teamBriefOf 的注释。 */
    + teamBriefOf(team as never, member.id, groupOfTeam(String(team.teamId ?? "")))
    + "# 调度权限\n你是团里的成员，没有调度工具：别调 agent_invoke / team_member_invoke，也别跟用户说你能调人。要请团里另一位帮忙，另起一行写 `@名字：要他做什么`（这一行只放这句），宿主会真的叫他，他的回复自己发进群。\n\n";
  // ③ 修掉死指令：成员线程**没有**挂任何 dynamicTools，不存在 SendMessage 之类的回传工具。
  //    真实回传路径是同步的：宿主等这个回合跑完，把最终文本当 team_member_invoke 的返回值
  //    交回主理人。旧文案叫模型「通过 SendMessage 回传」，它可能白花 token 去调不存在的工具。
  // 09-14：包上 [SYSTEM TASK · 成员会话] 壳——渲染端 userDisplayText 只认这个壳，
  // 不包壳的话用户打开成员会话时整段角色提示词会裸露在首条气泡里（用户实测反馈）。
  /* ⛔⛔ 11-07 用户令：「专家团也是一样」——主理人派给成员的首任务是**上级发的**，
     以前只靠「主理人分配的子任务」这串正文标签猜；现在写结构化发件人，
     parseUserRefs 统一解析，老会话仍由旧标签兼容推导。 */
  const leadSender = { kind: "supervisor", name: memberSupervisor || `${team.displayName.zh}主理人` };
  /* ⛔ 11-07：尾巴那句话改成 `MEMBER_TASK_NOTE`（人话两句话）。原来那句「请直接给出你的专业产出
     （关键结论 + 依据 + 建议）…无需调用任何回传工具。不要发起破坏性操作。」是规格书腔，
     模型会照抄去写给别人的派活消息（用户：「转述都不会转述」）。 */
  const finalQuery = `[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n${senderLineOf(leadSender)}\n${memberSupervisor ? `上级：${memberSupervisor}\n` : ""}${taskLineOf(leadSender, humanizeRefs(input.query))}\n=== END ===\n\n${systemPrefix}${MEMBER_TASK_NOTE}${invokedMemory.text}`;
  let turnId: string | undefined;   // ⛔ 提到 try 外：catch 里也要能带上它（超时转后台那条返回值）
  /* ⛔ 11-08 审查：清空记录代际的基准 —— 这一轮成员派活是什么时候开跑的。 */
  const memberRunStartedAt = Date.now();
  /* ⛔⛔ 11-11 用户现场（截图「这是排不出去吗，不会吗」「一直卡着空转」）：
     主理人调完 team_phase_invoke 之后，群里**只有它自己那张"深度思考中"**——
     因为成员跑在**独立团队会话**里，这条链不广播 group-talk-live，用户看不到任何人在干活，
     只能判定"卡住了"。实测：它 21:15:56 真派了活、同一秒建了成员会话，界面却毫无痕迹。
     ⇒ 成员开跑 / 收尾各广播一次，群里出现「问俗 正在写」的卡（与群派活同一套事件口径）。 */
  const liveGroup = groupOfTeam(String(team.teamId ?? ""));
  /* ⛔⛔ 11-11 用户令「这个可以给外面会话也加上异步板块反馈」：
     主对话里派出去的团（没有绑群）也要有反馈 ⇒ 作用域退回**发起这次派活的那条会话**
     （`input.leadThreadId`）。板块按 threadId 订阅，群聊仍按 groupId，两条互不干扰。 */
  const liveThreadScope = liveGroup ? "" : String(input.leadThreadId ?? "");
  const liveMemberId = teamAuthorIdOf(String(team.teamId ?? ""), String(member.id ?? ""));
  const liveRunId = `team:${String(team.teamId)}:${String(member.id)}:${memberRunStartedAt}`;
  const announceLive = (phase: "started" | "finished") => {
    if (!liveGroup && !liveThreadScope) return;
    try {
      /* 群聊才有「正在写」流式卡；外面会话只要异步板块那条反馈。 */
      if (liveGroup) {
        broadcastHarnessEvent({
          type: "group-talk-live", phase, groupId: liveGroup, memberId: liveMemberId,
          name: member.name, threadId: memberThreadId, runId: liveRunId, at: Date.now(),
        } as never);
      }
      /* ⛔ 11-11 独立板块「异步执行反馈」：成员开跑 / 交回都要喂给板块（零 IPC）。
         ⛔ 群聊按 groupId、外面会话按 threadId —— 同一条 announceLive 里发，两张视图不会分家。 */
      broadcastHarnessEvent({
        type: "group-async-run",
        phase: phase === "started" ? "running" : "done",
        ...(liveGroup ? { groupId: liveGroup } : { threadId: liveThreadScope }),
        teamId: String(team.teamId ?? ""),
        memberId: liveMemberId, name: member.name, at: Date.now(),
      } as never);
    } catch { /* 广播失败不影响派活 */ }
  };
  /* ⛔⛔ 11-11 用户当场（原话：「给成员安排活不要艾特吗，啥狗屁反馈都没有，之前还有，
     鬼知道他派活了啊」）：换成**真调度工具**之后，派活只发生在工具调用里 ——
     群里一个字都不显示，用户既看不到派给谁、也看不到派了什么。
     ⇒ 每次派活都在群里落一条 `@成员：任务`（作者 = 主理人），这就是**可见的交接**。
     ⛔ 它不是"演给用户看的假 @"：真活由这次 team_member_invoke 同步跑，
        这条消息只负责让群里看得见"谁把什么交给了谁"。 */
  {
    const leadAuthor = teamAuthorIdOf(String(team.teamId ?? ""), String(team.lead?.id ?? ""));
    const briefRaw = String(input.query ?? "").replace(/\s+/g, " ").trim();
    const brief = briefRaw.length > 160 ? `${briefRaw.slice(0, 160)}…` : briefRaw;
    if (liveGroup && leadAuthor && brief) {
      /* ⛔⛔ 11-15 用户令（截图 + 「艾特成员就要每个成员发一个艾特，这种垃圾机制删了」）：
         原来每次派活都往群里落一条 `@成员：任务` —— 派 4 位成员 = 群里 4 条几乎一样的消息，
         用户看到的就是「疯狂刷屏」「反反复复艾特」。
         ⇒ 这批消息**整条删掉**，改成同一批派活合并成**一条**、且不带逐人 @ 的摘要
           （`已派给 观湖、执矩、蔡本、衡岱`）。谁在跑什么由底部「异步执行」面板逐行显示
           （它本来就带任务摘要与进度），群里不再全文复述同一段任务。
         ⛔ 不要再往这条摘要里塞 per-member 的 "@名字：任务" —— 那就是要删的东西。 */
      queueDispatchEcho(liveGroup, leadAuthor, String(member.name ?? ""), brief, memberRunStartedAt);
    }
  }
  try {
    const turn: any = await server.request("turn/start", {
      threadId: memberThreadId,
      input: [{ type: "text", text: finalQuery, text_elements: [] }],
      model: effectiveModel,
      effort: input.effort || member.effort || "high",
    });
    turnId = turn.turn?.id;
    if (!turnId) throw new Error("成员调度失败：未返回 turnId");
    announceLive("started");
    const completed = await waitForTurnCompletion(memberThreadId, turnId);
    let output = turnOutputText(completed);
    if (!output) {
      const resumed: any = await server.request("thread/resume", { threadId: memberThreadId, excludeTurns: false }).catch(() => null);
      output = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
    }
    /* ⛔ 11-10 硬约束：空产出原来被标成 done ⇒ 界面显示"已完成"但群里只有一句占位文本。
       ⛔ 这条链不剥汇报行（它不额外发汇报，剥了会丢内容），只共用「算不算有产出」这一个判据。 */
    const guard = evaluateMemberOutput({ text: output, selfName: member.name });
    const text = guard.countsAsOutput ? output : `（成员 ${member.name} 未返回文本内容）`;
    teamRunStore.finishRun(run.runId, { status: guard.countsAsOutput ? "done" : "failed", output: text });
    announceLive("finished");
    /* ⛔⛔ 11-07 用户令「关掉群弹窗任务就结束、没结果回传」：成员产出原来是**渲染层**在
       `team-run finished` 里写进群的 —— 面板一卸载就没人接。现在主进程直接落群：
       id 与渲染层同一个（`team-run:<runId>`），两边都写也只会是同一条（按 id 覆盖）。
       ⛔ 没绑群（主对话里调团 / 不在群里派活）⇒ groupOfTeam 返回空串，这里什么都不做。 */
    {
      const boundGroup = groupOfTeam(team.teamId);
      if (boundGroup) {
        /* ⛔⛔ 11-15 用户规格：「每个成员都能看见上一个成员的打招呼内容」——
           串行派活时，下一位开跑前这条产出**必须已经落群**（成员提示词读的就是群日志）。
           原来是 `void`（不 await）⇒ 落盘与下一位读日志竞争，常常读到"还没有上一位的产出"，
           于是四段自我介绍仍然雷同。⇒ 这里等落盘完成再返回。 */
        await appendMemberOutputToGroup(boundGroup, {
          id: `team-run:${run.runId}`,
          authorId: teamAuthorIdOf(team.teamId, member.id),
          /* ⛔⛔ 11-12 用户：「成员汇报给主代理的时候没有艾特主代理，主代理能知道他跑完了？」
             产出原来只是一段正文落群，下游收件人**哪里都没写**。⇒ 结构化记下交回给主理人，
             群里名字行显示「交回 @主理人」，同时这也是宿主回喂的那个对象。 */
          handoffTo: teamAuthorIdOf(String(team.teamId ?? ""), String(team.lead?.id ?? "")),
          authorKind: "bot",
          senderKind: "member",
          threadId: memberThreadId,
          text,
          ...(delegateRegistry?.tokensOf(memberThreadId)
            ? { usage: (() => { const t = delegateRegistry!.tokensOf(memberThreadId)!; return { inputTokens: t.input, outputTokens: t.output, cachedTokens: t.cached, totalTokens: t.total }; })() }
            : {}),
        }, memberRunStartedAt);
      }
    }
    /* ⛔⛔ 11-07 用户：「成员之间互相也不会艾特」——成员产出以前只是 team_member_invoke
       的返回值（主理人看得到、群里看不到）；现在 team-run 会把产出按成员身份投进群流，
       但**产出里的行首 @ 没人解析** ⇒ 成员之间仍然叫不动人。
       ⇒ 这里用同一个判据（parseAgentMentions）解析，真派给被叫的那位成员，他的产出
         同样经 team-run 进群；只走一跳、一次只叫一个，防止互 @ 指数对烧。
       ⛔ 递归走外层 invokeTeamMemberCore（带按成员锁），别直接调 Unlocked 绕过锁。 */
    if ((input.hop ?? 0) < 1 && text) {
      const roster = {
        id: team.teamId,
        name: team.displayName?.zh ?? team.teamId,
        leadId: String(team.lead?.id ?? ""),
        members: [team.lead, ...team.members].filter(Boolean).map((m) => ({
          id: String(m.id),
          name: String(m.name),
          kind: "bot",
          targetKind: "member",
          targetKey: `${team.teamId}:${m.id}`,
          targetProfession: String(m.profession?.zh ?? "团成员"),
          muted: false,
        })),
      };
      for (const ask of parseAgentMentions(text, roster, { excludeId: member.id, max: 1 })) {
        void invokeTeamMemberCore({
          ...input,
          memberId: ask.memberId,
          query: `（${member.name} 在群里叫你）${ask.ask}`,
          hop: 1,
        }).catch(() => undefined);
      }
    }
    return { threadId: memberThreadId, turnId, teamId: team.teamId, memberId: member.id, name: member.name, profession: member.profession.zh, output: text, runId: run.runId, reused: Boolean(existingThreadId) };
  } catch (error: any) {
    /* ★ 同 delegation：**等待到点 ≠ 失败**（10-10 用户令「超时不判失败，转后台等」）。
       成员的回合在引擎里还在跑 ⇒ 保持这次 run **活跃**，由 boot 的引擎事件在回合真正
       结束时收敛（见 `electron/delegate-settle.ts`）；这里只把「已转后台」的说明交回主理人。 */
    if (error?.code === TURN_WAIT_TIMEOUT_CODE) {
      /* ⛔ 打「待回报」标：完成时自动把结果投回**主理人会话**（见 delegate-report.ts）。 */
      teamRunStore.markPendingReportByThread(memberThreadId);
      return {
        threadId: memberThreadId, turnId: turnId ?? null, teamId: team.teamId, memberId: member.id,
        name: member.name, profession: member.profession.zh,
        output: TURN_WAIT_BACKGROUND_NOTE, runId: run.runId, reused: Boolean(existingThreadId),
      };
    }
    teamRunStore.finishRun(run.runId, { status: "failed", output: run.output, error: error?.message ?? String(error) });
    throw error;
  }
}
