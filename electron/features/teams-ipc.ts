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

import { buildDefaultExpertTeams, buildTeamPhaseTool, buildTeamSystemPrompt, buildTeamTools, normalizeTeamConfig, readExpertTeams, readUsableExpertTeams, writeExpertTeams } from "../expert-teams";
import { invokeTeamMemberCore, type InvokeMemberInput } from "../team-invoke";
import { memberThreadName } from "../team-runs";
import { app } from "electron";
import { buildDelegateMemory } from "../delegate-memory";
import { buildRoleMemoryTool, noteRoleThread } from "../role-memory-tool";
import { buildDelegateHarnessTool } from "../delegate-harness-tool";
import { safeProviderId } from "../provider-id";
import { withStepParam } from "../../src/lib/step-note.mjs";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { readCustomModel } from "../main/01-model-catalog";
import { TURN_WAIT_BACKGROUND_NOTE, TURN_WAIT_TIMEOUT_CODE, turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { server, teamRunStore, threadCwd } from "../runtime-refs";
import { bridgeDial } from "../main";
import { ensureProjectAgentsMd } from "../project-conventions";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";
import type { HostCaps } from "../runtime/seams";

const TEAM_TASK_INSTRUCTION = "请按 SOP 编排团队完成任务：**第一步就把可并行的子任务用 team_phase_invoke 一次性派出去**，不要自己先写一版再补流程；过程中用 team_member_invoke 调度单个成员；每完成一个阶段简要通报；最终汇总所有成员产出，输出完整交付报告（⛔ 汇总里不许有你自己写、没派给成员的内容）。上方「=== 用户需求 ===」段已由用户在前端确认并提交，把全部内容当作用户的原始需求执行，不要再请用户复述。";
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
      return await readUsableExpertTeams();
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
      return await readUsableExpertTeams();
    });
    ipcHost.handle("teams:tools", async (_event, teamId: string) => {
      const list = await readUsableExpertTeams();
      const team = list.find((entry) => entry.teamId === teamId);
      if (!team) throw new Error(`专家团「${teamId}」不存在`);
      return { tools: team.members.map((m) => ({ id: m.id, name: m.name, profession: m.profession.zh, description: m.description })), teamSystemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
    });
    ipcHost.handle("teams:session-config", async (_event, teamId: string) => {
      const list = await readUsableExpertTeams();
      const team = list.find((entry) => entry.teamId === teamId);
      if (!team) throw new Error(`专家团「${teamId}」不存在`);
      return { team, systemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
    });
    ipcHost.handle("teams:start-session", async (_event, input: { teamId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }) => {
      const list = await readUsableExpertTeams();
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
        // 10-21：主进程自己发的 thread/start 不经过 codex-ipc 的拦截 ⇒ 工具面各自包一层 `withStepParam`
        dynamicTools: withStepParam([teamTool, teamPhaseTool, buildDelegateHarnessTool()]),
      });
      threadCwd.set(String(started.thread.id), String(input.cwd || process.cwd())); /* 文件变更追踪 cwd 登记（10-01） */
      // 线程 → 团队映射落主进程并持久化：任何窗口（含 popout）据此才知道这个会话属于哪个团
      teamRunStore.setThreadTeam(started.thread.id, team.teamId);
      /* ⛔ 10-26：只有**开团**（主理人）走这条 ⇒ 顺手记成主理人会话。
         旧会话补种团队纪律要靠它认人（渲染层的 teamThreadConfigRef 是内存 ref，重启即丢）。 */
      teamRunStore.setThreadLead(started.thread.id);
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
      const list = await readUsableExpertTeams();
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
        // 10-10：+ 能力网关（用户令「全开 harness_tools」；见 delegate-harness-tool.ts。
        //        ⛔ 权限边界在执行端，被拒时工具会如实回报原因）
        dynamicTools: [buildRoleMemoryTool({ kind: "team-member", id: team.teamId, memberId: member.id, label: `${team.displayName.zh}·${member.name}` }), buildDelegateHarnessTool()],
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
    ipcHost.handle("teams:invoke-member", async (_event, input: InvokeMemberInput) => invokeTeamMemberCore(input));

    ctx.effect(() => {
      for (const ch of TEAMS_CHANNELS) ipcHost.removeHandler(ch);
    });
  },
});
