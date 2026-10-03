/**
 * subagents-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：subagents(4)
 * 通道：subagents:list / save / remove / invoke
 *
 * ⛔ 09-14：子智能体会话首条气泡也要包 `[SYSTEM TASK · 成员会话]` 壳 —— 渲染端
 *    `userDisplayText` 只认这个壳，不包的话整段角色提示词会裸露在首条气泡里。
 * ⛔ `inheritModel/Sandbox/Approval` 三个"继承"开关决定用调用方配置还是成员自带配置，
 *    判空一律用 `!== false`（缺省继承）—— 写成 `=== true` 会让缺省变成"不继承"，行为反转。
 * ⛔ 待接缝化（阶段 2）：safeStorage 为宿主能力。
 */
import { safeStorage } from "electron";
import { safeProviderId } from "../provider-id";
import { PROVIDER_RETRY_TUNING } from "../provider-retry";
import { readCustomModel } from "../main/01-model-catalog";
import { turnOutputText, waitForTurnCompletion } from "../main/03-turn-summary";
import { readSubAgents, writeSubAgents } from "../main/09-agents-plugins";
import { server, threadCwd } from "../runtime-refs";
import { bridgeDial } from "../main";
import type { SubAgentConfig } from "../main";
import { ensureProjectAgentsMd } from "../project-conventions";
import { defineFeature } from "../context";
import type { IpcHost } from "../ipc-host";

function safeAgentId(name: string) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || `agent-${Date.now()}`;
}

export const subagentsFeature = defineFeature<null>({
  id: "subagents",
  inject: ["ipc"],
  setup: (ctx) => {
    const ipcHost = ctx.get<IpcHost>("ipc");
    if (!ipcHost) throw new Error("subagents: 缺少 ipc 服务（宿主未提供）");

    ipcHost.handle("subagents:list", async () => {
      const list = await readSubAgents();
      return list;
    });
    ipcHost.handle("subagents:save", async (_event, input: any) => {
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
    ipcHost.handle("subagents:remove", async (_event, id: string) => {
      const list = await readSubAgents();
      const next = list.filter((entry) => entry.id !== id);
      await writeSubAgents(next);
      return { ok: true };
    });
    ipcHost.handle("subagents:invoke", async (_event, input: { id?: string; name?: string; query: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }) => {
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
      ensureProjectAgentsMd(input.cwd || process.cwd());
      const started: any = await server.request("thread/start", {
        model: effectiveModel,
        cwd: input.cwd || process.cwd(),
        approvalPolicy: agent.inheritApproval ? (input.approvalPolicy ?? "never") : agent.approvalPolicy,
        sandbox: agent.inheritSandbox ? (input.sandbox ?? "workspace-write") : agent.sandbox,
        modelProvider: provider,
        config: baseUrl ? { model_provider: safeProviderId(provider), model_providers: { [safeProviderId(provider)]: { name, base_url: bridgeDial(provider, baseUrl), env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
      });
      threadCwd.set(String(started.thread.id), String(input.cwd || process.cwd())); /* 文件变更追踪 cwd 登记（10-01） */
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

    ctx.effect(() => {
      for (const ch of ["subagents:list", "subagents:save", "subagents:remove", "subagents:invoke"]) ipcHost.removeHandler(ch);
    });
  },
});
