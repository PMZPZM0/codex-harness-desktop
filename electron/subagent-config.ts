/**
 * 子智能体的唯一保存口径（设置表单 subagents:save 与 Codex 工具 subagent_save 共用）。
 *
 * ⛔ 两条路曾经各写一份：IPC 走 safeAgentId、尊重三个「跟随主对话」开关；
 *    工具却拿中文名当 id、强制继承与启用、还不认模型/沙箱/审批 ——
 *    同一条数据两种形状，用户改过的配置会被模型一次保存悄悄抹掉。
 *    现在两边都走 saveSubAgentConfig，默认值与归一只有这一处。
 * ⛔ 未传的字段在更新时**保留原值**（模型调 subagent_save 只补一句提示词，不该重置其它配置）。
 */
import { readSubAgents, writeSubAgents, type SubAgentConfig } from "./main/09-agents-plugins";

/** 与聊天里的思考强度同一套四档（低/中/高/极高）。 */
export const SUBAGENT_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export const SUBAGENT_SANDBOXES = ["read-only", "workspace-write", "danger-full-access"] as const;
export const SUBAGENT_APPROVALS = ["never", "on-request", "on-failure", "untrusted"] as const;

export type SubAgentSaveInput = Partial<Omit<SubAgentConfig, "createdAt" | "updatedAt" | "sandbox" | "approvalPolicy">> & {
  sandbox?: string;
  approvalPolicy?: string;
};

function safeAgentId(name: string) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || `agent-${Date.now()}`;
}

/** 历史扩展档（极简/最高/max）归一到四档 —— 与聊天滑块的映射同口径。 */
function normalizeEffort(value: unknown): string {
  const raw = String(value ?? "").trim();
  if ((SUBAGENT_EFFORTS as readonly string[]).includes(raw)) return raw;
  if (raw === "minimal") return "low";
  if (raw === "ultra" || raw === "max") return "xhigh";
  return "high";
}

function normalizeSandbox(value: unknown): NonNullable<SubAgentConfig["sandbox"]> {
  const raw = String(value ?? "").trim();
  return (SUBAGENT_SANDBOXES as readonly string[]).includes(raw) ? raw as NonNullable<SubAgentConfig["sandbox"]> : "workspace-write";
}

function normalizeApproval(value: unknown): NonNullable<SubAgentConfig["approvalPolicy"]> {
  const raw = String(value ?? "").trim();
  return (SUBAGENT_APPROVALS as readonly string[]).includes(raw) ? raw as NonNullable<SubAgentConfig["approvalPolicy"]> : "on-request";
}

/**
 * 创建或更新一个子智能体。
 * · 传了 id 按 id 更新；只传 name 时按 id/name 双路匹配（工具旧版把中文名当 id，存量条目也能命中）。
 * · 传了 model/sandbox/approvalPolicy 但没传对应 inherit 开关 ⇒ 视为「不跟随主对话」；
 *   三个都没传 ⇒ 新条目跟随主对话、更新保留原值。
 * · enabled 未传时保留原值（新建默认启用）—— 模型调一次保存不该把用户停用的角色重新启用。
 */
export async function saveSubAgentConfig(input: SubAgentSaveInput): Promise<{ agent: SubAgentConfig; created: boolean }> {
  const list = await readSubAgents();
  const now = new Date().toISOString();
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("子智能体名称不能为空");
  /* 传了 id：先按原值精确找（旧工具把中文名当 id，safeAgentId 会把它们改写掉 ⇒ 编辑后重建一份）；
     找不到再归一。没传 id：按名字生成。 */
  const rawId = String(input.id ?? "").trim();
  const wantedId = rawId
    ? (list.some((entry) => entry.id === rawId) ? rawId : safeAgentId(rawId))
    : safeAgentId(name);
  const existing = list.find((entry) => entry.id === wantedId) ?? list.find((entry) => entry.name === name);
  const id = existing?.id ?? wantedId;

  const inheritModel = input.inheritModel !== undefined
    ? input.inheritModel !== false
    : input.model !== undefined ? false : existing?.inheritModel ?? true;
  const inheritSandbox = input.inheritSandbox !== undefined
    ? input.inheritSandbox !== false
    : input.sandbox !== undefined ? false : existing?.inheritSandbox ?? true;
  const inheritApproval = input.inheritApproval !== undefined
    ? input.inheritApproval !== false
    : input.approvalPolicy !== undefined ? false : existing?.inheritApproval ?? true;

  const agent: SubAgentConfig = {
    id,
    name,
    description: input.description !== undefined
      ? String(input.description).trim() || `由「${name}」负责的子任务`
      : existing?.description || `由「${name}」负责的子任务`,
    systemPrompt: String(input.systemPrompt ?? "").trim() || existing?.systemPrompt || `你是「${name}」，请按你的角色完成任务并返回结构化结果。`,
    effort: normalizeEffort(input.effort ?? existing?.effort),
    inheritModel,
    model: inheritModel ? undefined : String(input.model ?? existing?.model ?? "").trim() || undefined,
    inheritSandbox,
    sandbox: inheritSandbox ? undefined : normalizeSandbox(input.sandbox ?? existing?.sandbox),
    inheritApproval,
    approvalPolicy: inheritApproval ? undefined : normalizeApproval(input.approvalPolicy ?? existing?.approvalPolicy),
    enabled: input.enabled !== undefined ? input.enabled !== false : existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing ? list.map((entry) => entry.id === id ? agent : entry) : [agent, ...list];
  await writeSubAgents(next);
  return { agent, created: !existing };
}
