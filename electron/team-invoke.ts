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
import { parseAgentMentions, teamAuthorIdOf } from "../src/lib/team-models.mjs";
import { appendMemberOutputToGroup, groupOfTeam } from "./team-group-bridge";
import { PROVIDER_RETRY_TUNING } from "./provider-retry";
import { ensureSessionAlias, supervisorLabelOf } from "./session-alias";
import { refreshSupervisorScopeForThread } from "./session-scope";
import { HARNESS_PROVIDER_ID } from "./provider-id";
import { shouldBindHarness } from "./thread-provider";
import { readCustomModel, originSessionModel } from "./main/01-model-catalog";
import { TURN_WAIT_BACKGROUND_NOTE, TURN_WAIT_TIMEOUT_CODE, turnOutputText, waitForTurnCompletion } from "./main/03-turn-summary";
import { noteRoleThread } from "./role-memory-tool";
import { server, teamRunStore, threadCwd, threadRuntimeStore } from "./runtime-refs";
import { readUsableExpertTeams } from "./expert-teams";

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

export async function invokeTeamMemberCore(input: InvokeMemberInput): Promise<InvokeMemberResult> {
  /* 同一「主理人会话 + 团队 + 成员」串行：并行阶段可能对同一成员重复提交任务，
     两条并发会在线程登记前各自 thread/start，产生重复会话。锁只按成员，不同成员仍并行。 */
  const lockKey = `${String(input.leadThreadId ?? "")}|${String(input.teamId ?? "")}|${String(input.memberId ?? "").trim().toLowerCase()}`;
  return withMemberLock(lockKey, () => invokeTeamMemberCoreUnlocked(input));
}

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
  try {
    const turn: any = await server.request("turn/start", {
      threadId: memberThreadId,
      input: [{ type: "text", text: finalQuery, text_elements: [] }],
      model: effectiveModel,
      effort: input.effort || member.effort || "high",
    });
    turnId = turn.turn?.id;
    if (!turnId) throw new Error("成员调度失败：未返回 turnId");
    const completed = await waitForTurnCompletion(memberThreadId, turnId);
    let output = turnOutputText(completed);
    if (!output) {
      const resumed: any = await server.request("thread/resume", { threadId: memberThreadId, excludeTurns: false }).catch(() => null);
      output = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
    }
    const text = output || `（成员 ${member.name} 未返回文本内容）`;
    teamRunStore.finishRun(run.runId, { status: "done", output: text });
    /* ⛔⛔ 11-07 用户令「关掉群弹窗任务就结束、没结果回传」：成员产出原来是**渲染层**在
       `team-run finished` 里写进群的 —— 面板一卸载就没人接。现在主进程直接落群：
       id 与渲染层同一个（`team-run:<runId>`），两边都写也只会是同一条（按 id 覆盖）。
       ⛔ 没绑群（主对话里调团 / 不在群里派活）⇒ groupOfTeam 返回空串，这里什么都不做。 */
    {
      const boundGroup = groupOfTeam(team.teamId);
      if (boundGroup) {
        void appendMemberOutputToGroup(boundGroup, {
          id: `team-run:${run.runId}`,
          authorId: teamAuthorIdOf(team.teamId, member.id),
          authorKind: "bot",
          senderKind: "member",
          threadId: memberThreadId,
          text,
        });
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
