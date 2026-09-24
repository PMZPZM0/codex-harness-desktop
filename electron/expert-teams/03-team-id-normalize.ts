/**
 * expert-teams 的「team-id-normalize」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import type { ExpertTeamConfig } from "./01-team-types";
function safeTeamId(name: string) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || `team-${Date.now()}`;
}

function safeMemberId(name: string) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || `member-${Date.now()}`;
}

/** 校验并规范化一个团队配置（补默认值、生成 ID、过滤无效成员） */
export function normalizeTeamConfig(input: any): ExpertTeamConfig {
  const now = new Date().toISOString();
  const lead: any = input.lead ?? {};
  const members: any[] = Array.isArray(input.members) ? input.members : [];
  const cleanMembers = members
    .filter((m) => m && String(m.systemPrompt ?? "").trim())
    .map((m) => ({
      id: m.id ? safeMemberId(String(m.id)) : safeMemberId(String(m.name ?? "")),
      name: String(m.name ?? "").trim() || "团队成员",
      profession: {
        zh: String(m.profession?.zh ?? "").trim() || String(m.profession ?? ""),
        en: String(m.profession?.en ?? "").trim() || String(m.profession?.zh ?? ""),
      },
      description: String(m.description ?? "").trim(),
      systemPrompt: String(m.systemPrompt ?? "").trim(),
      effort: m.effort || undefined,
      model: m.model || undefined,
      sandbox: m.sandbox || undefined,
      approvalPolicy: m.approvalPolicy || undefined,
    }));
  return {
    teamId: input.teamId ? safeTeamId(String(input.teamId)) : safeTeamId(String(input.displayName?.zh ?? "")),
    displayName: {
      zh: String(input.displayName?.zh ?? "").trim() || "未命名团队",
      en: String(input.displayName?.en ?? "").trim() || String(input.displayName?.zh ?? ""),
    },
    profession: {
      zh: String(input.profession?.zh ?? "").trim() || String(input.displayName?.zh ?? ""),
      en: String(input.profession?.en ?? "").trim() || String(input.displayName?.en ?? ""),
    },
    description: {
      zh: String(input.description?.zh ?? "").trim(),
      en: String(input.description?.en ?? "").trim(),
    },
    category: String(input.category ?? "12-IndustryConsultant").trim(),
    tags: Array.isArray(input.tags) && input.tags.length
      ? input.tags.slice(0, 3).map((t: any) => ({
          zh: String(t?.zh ?? "").trim() || String(t ?? ""),
          en: String(t?.en ?? "").trim() || String(t?.zh ?? ""),
        }))
      : [{ zh: "多角色协作", en: "Multi-agent" }, { zh: "专家团", en: "Expert team" }, { zh: "SOP 编排", en: "SOP" }],
    quickPrompts: Array.isArray(input.quickPrompts) && input.quickPrompts.length
      ? input.quickPrompts.slice(0, 3).map((p: any) => ({
          zh: String(p?.zh ?? "").trim() || String(p ?? ""),
          en: String(p?.en ?? "").trim() || String(p?.zh ?? ""),
        }))
      : [{ zh: "请带领团队完成我的任务", en: "Lead the team to complete my task" }],
    lead: {
      id: lead.id ? safeMemberId(String(lead.id)) : `${safeTeamId(String(input.displayName?.zh ?? ""))}-team-lead`,
      name: String(lead.name ?? "").trim() || "主理人",
      profession: {
        zh: String(lead.profession?.zh ?? "").trim() || "团队主理人",
        en: String(lead.profession?.en ?? "").trim() || String(lead.profession?.zh ?? ""),
      },
      description: String(lead.description ?? "").trim() || "负责编排调度团队完成综合任务",
      systemPrompt: String(lead.systemPrompt ?? "").trim() || "你是团队主理人，负责编排调度成员、汇总产出。",
      effort: lead.effort || undefined,
      model: lead.model || undefined,
      sandbox: lead.sandbox || undefined,
      approvalPolicy: lead.approvalPolicy || undefined,
    },
    members: cleanMembers,
    sop: String(input.sop ?? "").trim(),
    enabled: input.enabled !== false,
    createdAt: String(input.createdAt ?? now),
    updatedAt: now,
  };
}
