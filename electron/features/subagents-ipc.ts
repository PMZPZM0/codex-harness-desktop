/**
 * subagents-ipc（10-03 从 `features/teams-agents-ipc.ts` 按前缀拆出，同时改为**插件形态**）
 *
 * 域：subagents(3)
 * 通道：subagents:list / save / remove
 *
 * ⛔⛔ 10-04：`subagents:invoke` **已整体删除**（用户拍板「合并成单一工具」）。原实现直接
 *   `thread/start` + `turn/start` 派活，是一条**绕过全部调度闸门**的旁路：既不查「调度」勾选
 *   （`dispatchKindAllowed`）、也不过 `canDispatchFrom`（身份/深度/独占锁），**更不登记
 *   `delegateRegistry`** ⇒ 它派出的会话不会缩进在发起会话下面、也不出现在调度头像轨上，
 *   运行中挂起时还没有异常兜底。⇒ 调度只能有一条通道：内置 MCP 的 `agent_invoke`
 *   （→ `runDelegatedTask`，闸门 + 登记齐备）。⛔ 不要再加回任何"直连引擎"的派活通道。
 *
 * ⛔ 09-14：子智能体会话首条气泡也要包 `[SYSTEM TASK · 成员会话]` 壳 —— 渲染端
 *    `userDisplayText` 只认这个壳，不包的话整段角色提示词会裸露在首条气泡里。
 * ⛔ `inheritModel/Sandbox/Approval` 三个"继承"开关决定用调用方配置还是成员自带配置，
 *    判空一律用 `!== false`（缺省继承）—— 写成 `=== true` 会让缺省变成"不继承"，行为反转。
 * ⛔ 本域已**不再触碰任何宿主能力**（原 `subagents:invoke` 是唯一用 safeStorage 解密自定义模型密钥的
 *    地方，随它一起删除）⇒ `inject` 只剩 `ipc`。将来若要再加回加解密，**必须**经 `host` 接缝取。
 */

import { readSubAgents, writeSubAgents } from "../main/09-agents-plugins";
import type { SubAgentConfig } from "../main";
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
    ctx.effect(() => {
      for (const ch of ["subagents:list", "subagents:save", "subagents:remove"]) ipcHost.removeHandler(ch);
    });
  },
});
