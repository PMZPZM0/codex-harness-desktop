/**
 * teams-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：teams(9)
 * 通道：teams:list / save / remove / reset-defaults / tools / session-config / start-session / member-session / invoke-member
 *
 * ⛔⛔ 三条实证口径（本次纯搬迁，一字未改）：
 *   1. **成员线程复用**（同一 teamId+memberId 沿用同一线程）—— 否则同一成员被调两次是两个互不知情
 *      的会话，跨阶段上下文只能靠主理人把结论内联进 query。
 *   2. **成员线程标题必须设**（`团名·角色`）—— 不设名字时引擎拿首条用户消息（角色提示词全文）当
 *      标题，侧栏会显示成一整坨提示词（09-14 实测截图）。
 *   3. **`teams:invoke-member` 里 `buildDelegateMemory` 必须排在 `beginRun` 之前** —— beginRun 会
 *      广播 started（点亮头像 + 自动弹工作窗），记忆在云模式要发一次召回请求，排在后面会出现
 *      "面板已打开但没有任何进展"的空窗。
 * ⛔ `dynamicTools` 只在 `thread/start` 生效（覆盖老会话只走 MCP）—— 别挪到 turn/start。
 * ⛔ 待接缝化（阶段 2）：safeStorage 为宿主能力。
 */

import { buildDefaultExpertTeams, buildTeamPhaseTool, buildTeamSystemPrompt, buildTeamTools, normalizeTeamConfig, readExpertTeams, writeExpertTeams } from "../expert-teams";
import { memberThreadName } from "../team-runs";
import { app } from "electron";
import { buildDelegateMemory } from "../delegate-memory";
import { buildRoleMemoryTool, noteRoleThread } from "../role-memory-tool";
import { safeProviderId } from "../provider-id";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { readCustomModel } from "../main/01-model-catalog";
import { turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { server, teamRunStore, threadCwd } from "../runtime-refs";
import { bridgeDial } from "../main";
import { ensureProjectAgentsMd } from "../project-conventions";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const TEAM_TASK_INSTRUCTION = "请按 SOP 编排团队完成任务，过程中用 team_member_invoke 调度成员；每完成一个阶段简要通报；最终汇总所有成员产出，输出完整交付报告。上方「=== 用户需求 ===」段已由用户在前端确认并提交，把全部内容当作用户的原始需求执行，不要再请用户复述。";
const MEMBER_TASK_INSTRUCTION = "请以你的角色直接回应用户上方提交的需求，给出专业产出（关键结论 + 依据 + 建议）。不要再要求用户复述或自我介绍。";

const TEAMS_CHANNELS = [
  "teams:list", "teams:save", "teams:remove", "teams:reset-defaults", "teams:tools",
  "teams:session-config", "teams:start-session", "teams:member-session", "teams:invoke-member",
];

export const teamsFeature = defineFeature<null>({
  id: "teams",
  inject: ["ipc", "host"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    // 宿主能力经接缝取（10-03 阶段 2b）：safeStorage 触碰系统密钥库，
    // 域直取等于"插件自选加解密策略" ⇒ 锁进容器（守卫【266】零容忍）。
    const { secure } = ctx.get<HostCaps>("host")!;
    if (!ipcHost) throw new Error("teams: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("teams:list", async () => {
      return await readExpertTeams();
    });
    ipcHost.handle("teams:save", async (_event, input: any) => {
      const list = await readExpertTeams();
      const team = normalizeTeamConfig(input);
      const next = list.some((entry) => entry.teamId === team.teamId)
        ? list.map((entry) => entry.teamId === team.teamId ? team : entry)
        : [team, ...list];
      await writeExpertTeams(next);
      return team;
    });
    ipcHost.handle("teams:remove", async (_event, teamId: string) => {
      const list = await readExpertTeams();
      await writeExpertTeams(list.filter((entry) => entry.teamId !== teamId));
      return { ok: true };
    });
    ipcHost.handle("teams:reset-defaults", async () => {
      await writeExpertTeams(buildDefaultExpertTeams());
      return await readExpertTeams();
    });
    ipcHost.handle("teams:tools", async (_event, teamId: string) => {
      const list = await readExpertTeams();
      const team = list.find((entry) => entry.teamId === teamId);
      if (!team) throw new Error(`专家团「${teamId}」不存在`);
      return { tools: team.members.map((m) => ({ id: m.id, name: m.name, profession: m.profession.zh, description: m.description })), teamSystemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
    });
    ipcHost.handle("teams:session-config", async (_event, teamId: string) => {
      const list = await readExpertTeams();
      const team = list.find((entry) => entry.teamId === teamId);
      if (!team) throw new Error(`专家团「${teamId}」不存在`);
      return { team, systemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
    });
    ipcHost.handle("teams:start-session", async (_event, input: { teamId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }) => {
      const list = await readExpertTeams();
      const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
      if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
      if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
      const customModel = await readCustomModel();
      const provider = customModel?.provider ?? "openai";
      const baseUrl = customModel?.baseUrl;
      const name = customModel?.name ?? provider;
      const apiKey = customModel?.encryptedKey && secure.isEncryptionAvailable() ? secure.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
      if (apiKey) server.setApiKey(apiKey);
      const effectiveModel = input.model || customModel?.model;
      if (!effectiveModel) throw new Error("尚未配置自定义模型，无法启动专家团会话");
      const teamTool = buildTeamTools(team);
      // 并行阶段工具：SOP 标「并行」的阶段由它一次性提交，宿主并发执行 —— 不依赖模型自觉
      // （09-14 实测：只改提示词让它「一次发多个调用」无效，模型照样逐个发 → 退化成串行）
      const teamPhaseTool = buildTeamPhaseTool(team);
      ensureProjectAgentsMd(input.cwd || process.cwd());
      const started: any = await server.request("thread/start", {
        model: effectiveModel,
        cwd: input.cwd || process.cwd(),
        approvalPolicy: input.approvalPolicy || "never",
        sandbox: input.sandbox || "workspace-write",
        modelProvider: provider,
        personality: input.personality || null,
        config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
        dynamicTools: [teamTool, teamPhaseTool],
      });
      threadCwd.set(String(started.thread.id), String(input.cwd || process.cwd())); /* 文件变更追踪 cwd 登记（10-01） */
      // 线程 → 团队映射落主进程并持久化：任何窗口（含 popout）据此才知道这个会话属于哪个团
      teamRunStore.setThreadTeam(started.thread.id, team.teamId);
      if (input.defer) {
        const threadName = team.displayName.zh;
        try { await server.request("thread/name/set", { threadId: started.thread.id, name: threadName }); } catch { /* 命名失败不阻塞进入会话 */ }
        return {
          thread: { ...started.thread, name: threadName },
          turnId: null,
          role: { kind: "team", prefix: `${buildTeamSystemPrompt(team)}\n\n`, instruction: TEAM_TASK_INSTRUCTION },
        };
      }
      const systemPrefix = buildTeamSystemPrompt(team);
      const finalTask = `${systemPrefix}\n\n[SYSTEM TASK · 团队会话]\n=== 用户需求 ===\n${String(input.task ?? "")}\n=== END ===\n\n${TEAM_TASK_INSTRUCTION}`;
      const turn: any = await server.request("turn/start", {
        threadId: started.thread.id,
        input: [{ type: "text", text: finalTask, text_elements: [] }],
        model: effectiveModel,
        effort: input.effort || team.lead.effort || "high",
      });
      return { thread: started.thread, turnId: turn.turn?.id ?? null };
    });
    ipcHost.handle("teams:member-session", async (_event, input: { teamId: string; memberId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }) => {
      const list = await readExpertTeams();
      const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
      if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
      if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
      const memberKey = String(input.memberId ?? "").trim().toLowerCase();
      const member = [team.lead, ...team.members].find((m) => m.id.toLowerCase() === memberKey);
      if (!member) throw new Error(`成员「${input.memberId}」不存在于专家团「${team.displayName.zh}」`);
      const isLead = member.id === team.lead.id;
      const customModel = await readCustomModel();
      const provider = customModel?.provider ?? "openai";
      const baseUrl = customModel?.baseUrl;
      const name = customModel?.name ?? provider;
      const apiKey = customModel?.encryptedKey && secure.isEncryptionAvailable() ? secure.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
      if (apiKey) server.setApiKey(apiKey);
      const effectiveModel = input.model || member.model || customModel?.model;
      if (!effectiveModel) throw new Error("尚未配置自定义模型，无法发起成员会话");
      ensureProjectAgentsMd(input.cwd || process.cwd());
      const started: any = await server.request("thread/start", {
        model: effectiveModel,
        cwd: input.cwd || process.cwd(),
        approvalPolicy: member.approvalPolicy || input.approvalPolicy || "never",
        sandbox: member.sandbox || input.sandbox || "workspace-write",
        modelProvider: provider,
        personality: input.personality || null,
        config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
        // 10-05：成员会话能写自己的私有记忆（主进程侧应答，见 role-memory-tool.ts）
        dynamicTools: [buildRoleMemoryTool({ kind: "team-member", id: team.teamId, memberId: member.id, label: `${team.displayName.zh}·${member.name}` })],
      });
      const systemPrefix = `[专家团「${team.displayName.zh}」${isLead ? "主理人" : "成员"} ${member.name}（${member.profession.zh}）]\n${member.systemPrompt}\n\n`;
      threadCwd.set(String(started.thread.id), String(input.cwd || process.cwd())); /* 文件变更追踪 cwd 登记（10-01） */
      teamRunStore.setThreadTeam(started.thread.id, team.teamId);
      if (input.defer) {
        // 会话标题只展示角色职能，不把成员真实姓名带到用户界面。
        const threadName = `${team.displayName.zh} · ${member.profession.zh || "成员"}`;
        try { await server.request("thread/name/set", { threadId: started.thread.id, name: threadName }); } catch { /* 命名失败不阻塞进入会话 */ }
        /* 10-05：defer 分支（用户亲自与该成员对话）同样登记角色归属 ——
           否则这个会话将来调 role_memory_save 会被判「无归属」而拒写。
           ⚠️ 这条会话**能读到**该成员的私有记忆（注入在渲染层发送路径之外，
              需在 send 侧补 —— 见守卫【role】的接线断言）。 */
        await noteRoleThread(app.getPath("userData"), String(started.thread.id), { kind: "team-member", id: team.teamId, memberId: member.id, label: `${team.displayName.zh}·${member.name}` }, String(input.cwd ?? "")).catch(() => undefined);
        return {
          thread: { ...started.thread, name: threadName },
          turnId: null,
          member: { id: member.id, name: member.name, profession: member.profession.zh },
          role: { kind: "member", prefix: systemPrefix, instruction: MEMBER_TASK_INSTRUCTION },
        };
      }
      const firstTask = String(input.task ?? "").trim();
      if (!firstTask) throw new Error(`请先在对话框描述你的需求`);
      /* 成员会话也要有记忆（09-23，同 delegation.ts 的理由）：这条路径由主进程直接 turn/start，
         不经过渲染层 send 路径 ⇒ 不补就永远读不到常驻记忆。见 electron/delegate-memory.ts（守卫【125】）。 */
      /* 10-05 角色私有记忆：这个成员自己的记忆（⛔ 与其他成员、与主理人互不可见）。
         kind 用 team-member —— 成员的角色归属是「团 + 成员」两段，主理人是另一条（team-lead）。 */
      const memberRole = { kind: "team-member" as const, id: team.teamId, memberId: member.id, label: `${team.displayName.zh}·${member.name}` };
      const memberMemory = await buildDelegateMemory({ workspace: input.cwd, query: firstTask, role: memberRole });
      await noteRoleThread(app.getPath("userData"), String(started.thread.id), memberRole, String(input.cwd ?? "")).catch(() => undefined);
      const finalQuery = `[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n${firstTask}\n=== END ===\n\n${systemPrefix}${MEMBER_TASK_INSTRUCTION}${memberMemory.text}`;
      const turn: any = await server.request("turn/start", {
        threadId: started.thread.id,
        input: [{ type: "text", text: finalQuery, text_elements: [] }],
        model: effectiveModel,
        effort: input.effort || member.effort || "high",
      });
      return { thread: started.thread, turnId: turn.turn?.id ?? null, member: { id: member.id, name: member.name, profession: member.profession.zh } };
    });
    ipcHost.handle("teams:invoke-member", async (_event, input: { teamId: string; memberId: string; query: string; leadThreadId?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }) => {
      const list = await readExpertTeams();
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
      const apiKey = customModel?.encryptedKey && secure.isEncryptionAvailable() ? secure.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
      if (apiKey) server.setApiKey(apiKey);
      const effectiveModel = input.model || member.model || customModel?.model;
      if (!effectiveModel) throw new Error("尚未配置自定义模型，无法调度团队成员");

      // ① 成员线程复用：同一 (团队, 成员) 始终沿用同一个线程，成员因此记得自己之前做过什么。
      //    旧行为每次委托都新建线程 —— 同一成员被调两次是两个互不知情的会话，跨阶段上下文
      //    只能靠主理人把结论内联进 query。
      const existingThreadId = teamRunStore.memberThreadOf(team.teamId, member.id);
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
      teamRunStore.rememberMemberThread(team.teamId, member.id, memberThreadId);
      teamRunStore.setThreadTeam(memberThreadId, team.teamId);

      /* 主理人 → 成员这条路径同样要补记忆（09-23）。工作区用显式 cwd；拿不到就只注入 L0 用户档案。
         ⛔ 必须排在 `beginRun` **之前**：beginRun 会广播 started（点亮成员头像 + 自动弹成员工作窗），
            记忆在云模式要发一次召回请求，排在后面就会出现"面板已打开但没有任何进展"的空窗。 */
      const invokedRole = { kind: "team-member" as const, id: team.teamId, memberId: member.id, label: `${team.displayName.zh}·${member.name}` };
      const invokedMemory = await buildDelegateMemory({ workspace: input.cwd, query: String(input.query ?? ""), originThreadId: String(input.leadThreadId ?? ""), role: invokedRole });
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
      try {
        const turn: any = await server.request("turn/start", {
          threadId: memberThreadId,
          input: [{ type: "text", text: finalQuery, text_elements: [] }],
          model: effectiveModel,
          effort: input.effort || member.effort || "high",
        });
        const turnId = turn.turn?.id;
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
        teamRunStore.finishRun(run.runId, { status: "failed", output: run.output, error: error?.message ?? String(error) });
        throw error;
      }
    });

    ctx.effect(() => {
      for (const ch of TEAMS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
