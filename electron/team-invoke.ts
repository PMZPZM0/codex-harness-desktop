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
import { PROVIDER_RETRY_TUNING } from "./provider-retry";
import { safeProviderId } from "./provider-id";
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
  const list = await readUsableExpertTeams();
  const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
  if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
  if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
  const memberKey = String(input.memberId ?? "").trim().toLowerCase();
  const member = team.members.find((m) => m.id.toLowerCase() === memberKey);
  if (!member) throw new Error(`成员「${input.memberId}」不存在于专家团「${team.displayName.zh}」`);
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
    const resumed: any = await server.request("thread/resume", { threadId: existingThreadId, excludeTurns: false }).catch(() => null);
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
      modelProvider: provider,
      config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
    });
    memberThreadId = String(started.thread.id);
    threadCwd.set(memberThreadId, String(input.cwd || process.cwd())); /* 文件变更追踪 cwd 登记（10-01） */
    // ② 成员线程标题：`团名·角色`。不设名字时引擎拿首条用户消息（角色提示词全文）当标题，
    //    侧栏里会显示成一整坨提示词（09-14 实测截图）。
    try { await server.request("thread/name/set", { threadId: memberThreadId, name: memberThreadName(team.displayName.zh, member.profession.zh || member.name) }); } catch { /* 命名失败不阻塞调度 */ }
  }
  teamRunStore.rememberMemberThread(ownerThreadId, team.teamId, member.id, memberThreadId);
  teamRunStore.setThreadTeam(memberThreadId, team.teamId);

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
  const systemPrefix = `[专家团「${team.displayName.zh}」成员 ${member.name}（${member.profession.zh}）]\n${member.systemPrompt}\n\n`;
  // ③ 修掉死指令：成员线程**没有**挂任何 dynamicTools，不存在 SendMessage 之类的回传工具。
  //    真实回传路径是同步的：宿主等这个回合跑完，把最终文本当 team_member_invoke 的返回值
  //    交回主理人。旧文案叫模型「通过 SendMessage 回传」，它可能白花 token 去调不存在的工具。
  // 09-14：包上 [SYSTEM TASK · 成员会话] 壳——渲染端 userDisplayText 只认这个壳，
  // 不包壳的话用户打开成员会话时整段角色提示词会裸露在首条气泡里（用户实测反馈）。
  const finalQuery = `[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n主理人分配的子任务：${input.query}\n=== END ===\n\n${systemPrefix}请直接给出你的专业产出（关键结论 + 依据 + 建议）。你的最终回答文本会被完整回传给主理人，无需调用任何回传工具。不要发起破坏性操作。${invokedMemory.text}`;
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
