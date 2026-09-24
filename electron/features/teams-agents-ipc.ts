/**
 * teams-agents-ipc（09-21 架构改造：从 electron/main.ts 按**域**拆出，纯搬迁）
 *
 * 域：team-runs(1) / team-threads(2) / teams(9) / subagents(4) / agents(9) / commands(5)
 * 通道：agents:archive / agents:catalog / agents:delegated / agents:delegated-of / agents:invoke / agents:notice / agents:off-notice / agents:thread-role / agents:tool-description / commands:delete / commands:expand / commands:list / commands:read / commands:save / subagents:invoke / subagents:list / subagents:remove / subagents:save / team-runs:list / team-threads:map / team-threads:team-of / teams:invoke-member / teams:list / teams:member-session / teams:remove / teams:reset-defaults / teams:save / teams:session-config / teams:start-session / teams:tools
 *
 * 代码与原地逐字一致（仅整体缩进 + 顶部 import + 文件头注释）。
 * 跨域**只读**符号经 `import … from "../main"` 取用 —— 活绑定（TS→CJS 编译成 `main_1.X` 属性访问），
 * 因此 main 里被重新赋值的 `let`（窗口句柄等）也能读到最新值。
 * 本域未使用跨域可变状态。
 * 注册时机不变：main.ts 模块加载期 import 本文件 ⇒ ipcMain.handle 立即执行。
 */
import path from "node:path";
import { ipcMain, safeStorage } from "electron";
import { deleteCustomCommand, expandCommandTemplate, listCustomCommands, readCustomCommand, saveCustomCommand } from "../commands";
import { safeProviderId } from "../provider-id";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { buildDelegateMemory } from "../delegate-memory";
import { buildDefaultExpertTeams, buildTeamPhaseTool, buildTeamSystemPrompt, buildTeamTools, normalizeTeamConfig, readExpertTeams, writeExpertTeams } from "../expert-teams";
import { memberThreadName } from "../team-runs";
import { dispatchNoticeText, dispatchOffNoticeText, dispatchToolDescription } from "../dispatch";
import { broadcastHarnessEvent } from "../features/window-bus";
import { buildDispatchCatalog, restrictedThreadRole } from "../features/dispatch-core";
import { readCustomModel } from "../main/01-model-catalog";
import { runDelegatedTask } from "../features/delegation";
import { turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { readSubAgents, writeSubAgents } from "../main/09-agents-plugins";
import { codexHome, delegateRegistry, server, teamRunStore, threadCwd } from "../runtime-refs";
import { bridgeDial } from "../main";
import type { SubAgentConfig } from "../main";
ipcMain.handle("team-runs:list", async (_event, threadId: string) => teamRunStore.listRuns(String(threadId ?? "")));
ipcMain.handle("team-threads:map", async () => teamRunStore.listThreads());
ipcMain.handle("team-threads:team-of", async (_event, threadId: string) => teamRunStore.teamOfThread(String(threadId ?? "")));
ipcMain.handle("agents:thread-role", async (_event, threadId: string) => await restrictedThreadRole(String(threadId ?? "")));
ipcMain.handle("commands:list", async (_event, input: { cwd?: unknown } = {}) => {
  return listCustomCommands(codexHome, input?.cwd ? String(input.cwd) : undefined);
});
ipcMain.handle("commands:read", async (_event, input: { filePath?: unknown; cwd?: unknown } = {}) => {
  const filePath = String(input?.filePath ?? "");
  if (!filePath) return null;
  return readCustomCommand(filePath, codexHome, input?.cwd ? String(input.cwd) : undefined);
});
ipcMain.handle("commands:save", async (_event, input: any) => saveCustomCommand({ ...input, codexHome }));
ipcMain.handle("commands:delete", async (_event, filePath: string) => {
  // ⛔ 收敛到「自定义命令目录内」（09-13 审计 S5）：`deleteCustomCommand` 内部就是裸 `fs.rm`
  // 且**没有任何包含性校验**，而这条链由渲染层任意字符串直达 —— 一个 `fs.rm` 原语。
  {
    const target = path.resolve(String(filePath ?? ""));
    // 自定义命令有两个来源目录（见 commands.ts）：全局 `<codexHome>/commands` 与
    // 项目级 `<cwd>/.codex/commands` —— 两个都要放行，否则删项目命令会误报。
    const bases = [path.join(codexHome, "commands"), ...[...threadCwd.values()].filter(Boolean).map((cwd) => path.join(String(cwd), ".codex", "commands"))]
      .map((base) => path.resolve(base));
    const inside = Boolean(target) && bases.some((base) => {
      const relative = path.relative(base, target);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!inside) throw new Error("只能删除自定义命令目录内的文件");
  }
  await deleteCustomCommand(String(filePath ?? ""));
  return { ok: true };
});
ipcMain.handle("commands:expand", async (_event, input: { filePath?: unknown; argument?: unknown; cwd?: unknown }) => {
  const filePath = String(input?.filePath ?? "");
  if (!filePath) throw new Error("缺少命令文件路径");
  const entry = await readCustomCommand(filePath, codexHome, input?.cwd ? String(input.cwd) : undefined);
  if (!entry) throw new Error("命令不存在或已被删除。");
  return { text: await expandCommandTemplate(entry, String(input?.argument ?? ""), input?.cwd ? String(input.cwd) : undefined) };
});
function safeAgentId(name: string) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || `agent-${Date.now()}`;
}
ipcMain.handle("subagents:list", async () => {
  const list = await readSubAgents();
  return list;
});
ipcMain.handle("subagents:save", async (_event, input: any) => {
  const list = await readSubAgents();
  const now = new Date().toISOString();
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("子智能体名称不能为空");
  const description = String(input.description ?? "").trim() || `由「${name}」负责的子任务`;
  const systemPrompt = String(input.systemPrompt ?? "").trim() || `你是「${name}」，请按你的角色完成任务并返回结构化结果。`;
  const effort = String(input.effort ?? "high");
  const inheritModel = input.inheritModel !== false;
  const inheritSandbox = input.inheritSandbox !== false;
  const inheritApproval = input.inheritApproval !== false;
  const id = input.id ? safeAgentId(String(input.id)) : safeAgentId(name);
  const config: SubAgentConfig = {
    id, name, description, systemPrompt, effort,
    inheritModel,
    model: inheritModel ? undefined : String(input.model ?? "").trim() || undefined,
    inheritSandbox,
    sandbox: inheritSandbox ? undefined : (input.sandbox ?? "workspace-write"),
    inheritApproval,
    approvalPolicy: inheritApproval ? undefined : (input.approvalPolicy ?? "on-request"),
    enabled: input.enabled !== false,
    createdAt: list.find((entry) => entry.id === id)?.createdAt ?? now,
    updatedAt: now,
  };
  const next = list.some((entry) => entry.id === id) ? list.map((entry) => entry.id === id ? config : entry) : [config, ...list];
  await writeSubAgents(next);
  return config;
});
ipcMain.handle("subagents:remove", async (_event, id: string) => {
  const list = await readSubAgents();
  const next = list.filter((entry) => entry.id !== id);
  await writeSubAgents(next);
  return { ok: true };
});
ipcMain.handle("subagents:invoke", async (_event, input: { id?: string; name?: string; query: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }) => {
  const list = await readSubAgents();
  const key = String(input.id ?? input.name ?? "").trim().toLowerCase();
  const agent = list.find((entry) => entry.id === key || entry.name.trim().toLowerCase() === key);
  if (!agent) throw new Error(`子智能体「${input.id ?? input.name}」不存在`);
  if (!agent.enabled) throw new Error(`子智能体「${agent.name}」已停用`);
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || (agent.inheritModel ? customModel?.model : agent.model) || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法启动子智能体");
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input.cwd || process.cwd(),
    approvalPolicy: agent.inheritApproval ? (input.approvalPolicy ?? "never") : agent.approvalPolicy,
    sandbox: agent.inheritSandbox ? (input.sandbox ?? "workspace-write") : agent.sandbox,
    modelProvider: provider,
    config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
  });
  const systemPrefix = `[子智能体 ${agent.name}] ${agent.systemPrompt}\n\n`;
  // 09-14：同样包 SYSTEM TASK 壳（子智能体会话首条气泡也不再裸露角色提示词）
  const finalQuery = `[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n用户任务：${input.query}\n=== END ===\n\n${systemPrefix}完成后请输出结构化结果（关键结论 + 行动步骤 + 任何上下文）；不要主动发起破坏性操作。`;
  const turn: any = await server.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: finalQuery, text_elements: [] }],
    model: effectiveModel,
    effort: input.effort || agent.effort,
  });
  const turnId = turn.turn?.id;
  if (!turnId) throw new Error("子智能体回合启动失败：未返回 turnId");
  const completed = await waitForTurnCompletion(started.thread.id, turnId);
  let output = turnOutputText(completed);
  if (!output) {
    const resumed: any = await server.request("thread/resume", { threadId: started.thread.id, excludeTurns: false }).catch(() => null);
    output = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
  }
  return { threadId: started.thread.id, turnId, name: agent.name, output: output || "（子智能体没有返回文本内容）" };
});
ipcMain.handle("teams:list", async () => {
  return await readExpertTeams();
});
ipcMain.handle("teams:save", async (_event, input: any) => {
  const list = await readExpertTeams();
  const team = normalizeTeamConfig(input);
  const next = list.some((entry) => entry.teamId === team.teamId)
    ? list.map((entry) => entry.teamId === team.teamId ? team : entry)
    : [team, ...list];
  await writeExpertTeams(next);
  return team;
});
ipcMain.handle("teams:remove", async (_event, teamId: string) => {
  const list = await readExpertTeams();
  await writeExpertTeams(list.filter((entry) => entry.teamId !== teamId));
  return { ok: true };
});
ipcMain.handle("teams:reset-defaults", async () => {
  await writeExpertTeams(buildDefaultExpertTeams());
  return await readExpertTeams();
});
ipcMain.handle("teams:tools", async (_event, teamId: string) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === teamId);
  if (!team) throw new Error(`专家团「${teamId}」不存在`);
  return { tools: team.members.map((m) => ({ id: m.id, name: m.name, profession: m.profession.zh, description: m.description })), teamSystemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
});
ipcMain.handle("teams:session-config", async (_event, teamId: string) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === teamId);
  if (!team) throw new Error(`专家团「${teamId}」不存在`);
  return { team, systemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
});
const TEAM_TASK_INSTRUCTION = "请按 SOP 编排团队完成任务，过程中用 team_member_invoke 调度成员；每完成一个阶段简要通报；最终汇总所有成员产出，输出完整交付报告。上方「=== 用户需求 ===」段已由用户在前端确认并提交，把全部内容当作用户的原始需求执行，不要再请用户复述。";
const MEMBER_TASK_INSTRUCTION = "请以你的角色直接回应用户上方提交的需求，给出专业产出（关键结论 + 依据 + 建议）。不要再要求用户复述或自我介绍。";
ipcMain.handle("teams:start-session", async (_event, input: { teamId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
  if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
  if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法启动专家团会话");
  const teamTool = buildTeamTools(team);
  // 并行阶段工具：SOP 标「并行」的阶段由它一次性提交，宿主并发执行 —— 不依赖模型自觉
  // （09-14 实测：只改提示词让它「一次发多个调用」无效，模型照样逐个发 → 退化成串行）
  const teamPhaseTool = buildTeamPhaseTool(team);
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
ipcMain.handle("teams:member-session", async (_event, input: { teamId: string; memberId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }) => {
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
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || member.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法发起成员会话");
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input.cwd || process.cwd(),
    approvalPolicy: member.approvalPolicy || input.approvalPolicy || "never",
    sandbox: member.sandbox || input.sandbox || "workspace-write",
    modelProvider: provider,
    personality: input.personality || null,
    config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
  });
  const systemPrefix = `[专家团「${team.displayName.zh}」${isLead ? "主理人" : "成员"} ${member.name}（${member.profession.zh}）]\n${member.systemPrompt}\n\n`;
  teamRunStore.setThreadTeam(started.thread.id, team.teamId);
  if (input.defer) {
    // 会话标题只展示角色职能，不把成员真实姓名带到用户界面。
    const threadName = `${team.displayName.zh} · ${member.profession.zh || "成员"}`;
    try { await server.request("thread/name/set", { threadId: started.thread.id, name: threadName }); } catch { /* 命名失败不阻塞进入会话 */ }
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
  const memberMemory = await buildDelegateMemory({ workspace: input.cwd, query: firstTask });
  const finalQuery = `[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n${firstTask}\n=== END ===\n\n${systemPrefix}${MEMBER_TASK_INSTRUCTION}${memberMemory.text}`;
  const turn: any = await server.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: finalQuery, text_elements: [] }],
    model: effectiveModel,
    effort: input.effort || member.effort || "high",
  });
  return { thread: started.thread, turnId: turn.turn?.id ?? null, member: { id: member.id, name: member.name, profession: member.profession.zh } };
});
ipcMain.handle("teams:invoke-member", async (_event, input: { teamId: string; memberId: string; query: string; leadThreadId?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }) => {
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
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
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
    if (resumed?.thread?.id) memberThreadId = String(resumed.thread.id);
  }
  if (!memberThreadId) {
    const started: any = await server.request("thread/start", {
      model: effectiveModel,
      cwd: input.cwd || process.cwd(),
      approvalPolicy: member.approvalPolicy || input.approvalPolicy || "never",
      sandbox: member.sandbox || input.sandbox || "workspace-write",
      modelProvider: provider,
      config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
    });
    memberThreadId = String(started.thread.id);
    // ② 成员线程标题：`团名·角色`。不设名字时引擎拿首条用户消息（角色提示词全文）当标题，
    //    侧栏里会显示成一整坨提示词（09-14 实测截图）。
    try { await server.request("thread/name/set", { threadId: memberThreadId, name: memberThreadName(team.displayName.zh, member.profession.zh || member.name) }); } catch { /* 命名失败不阻塞调度 */ }
  }
  teamRunStore.rememberMemberThread(team.teamId, member.id, memberThreadId);
  teamRunStore.setThreadTeam(memberThreadId, team.teamId);

  /* 主理人 → 成员这条路径同样要补记忆（09-23）。工作区用显式 cwd；拿不到就只注入 L0 用户档案。
     ⛔ 必须排在 `beginRun` **之前**：beginRun 会广播 started（点亮成员头像 + 自动弹成员工作窗），
        记忆在云模式要发一次召回请求，排在后面就会出现"面板已打开但没有任何进展"的空窗。 */
  const invokedMemory = await buildDelegateMemory({ workspace: input.cwd, query: String(input.query ?? ""), originThreadId: String(input.leadThreadId ?? "") });

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
ipcMain.handle("agents:catalog", async () => ({ targets: await buildDispatchCatalog() }));
ipcMain.handle("agents:tool-description", async () => ({ description: dispatchToolDescription(await buildDispatchCatalog()) }));
ipcMain.handle("agents:notice", async () => ({ text: dispatchNoticeText(await buildDispatchCatalog()) }));
ipcMain.handle("agents:off-notice", async () => ({ text: dispatchOffNoticeText() }));
ipcMain.handle("agents:delegated", async () => ({ records: await delegateRegistry.listAll() }));
ipcMain.handle("agents:delegated-of", async (_event, originThreadId: string) => ({
  records: await delegateRegistry.listByOrigin(String(originThreadId ?? "")),
}));
ipcMain.handle("agents:invoke", async (_event, input: any) => runDelegatedTask(input ?? ({} as any)));
ipcMain.handle("agents:archive", async (_event, input: { threadIds?: string[]; originThreadId?: string }) => {
  const ids = Array.isArray(input?.threadIds) && input.threadIds.length
    ? input.threadIds.map(String)
    : (await delegateRegistry.listByOrigin(String(input?.originThreadId ?? ""))).map((record) => record.threadId);
  let archived = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      const record = await delegateRegistry.infoOf(id);
      if (!record || record.archived) continue;
      /* ⛔ 09-24 修（评估报告 §4.2）：原写法 `.catch(() => undefined)` 吞掉引擎侧失败后**无条件**
         `archived += 1` + markArchived ⇒ 弹「已归档 N 个」而会话其实还在列表里
         （正是项目记录过的"开关点了没生效"类）。归档失败必须计入 failed，不能只报喜。
         对照：MCP 孪生实现 dispatch-rpc.ts 本来就是对的。 */
      const archivedOk = await server.request("thread/archive", { threadId: id }).then(() => true).catch(() => false);
      if (!archivedOk) { failed.push(id); continue; }
      await delegateRegistry.markArchived([id]);
      archived += 1;
    } catch { failed.push(id); }
  }
  broadcastHarnessEvent({ type: "delegates-changed" } as any);
  return { archived, failed };
});
