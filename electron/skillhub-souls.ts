// SkillHub 人格市场（skillhub.cn/soul）——列表 + 应用/还原。
//
// 数据源：https://api.skillhub.cn/api/v1/souls（公开 JSON，共 16 套，无翻页参数，一次拉全）。
//   条目 { slug, displayName, summary, version }；详情 /api/v1/souls/{slug} 带 content =
//   完整中文人设（气质/语言系统/行动逻辑）。
// 生效机制（2026-10-01 设计）：人格写进 personalization.json 的 persona 字段，随
//   buildAgentsMd 渲染进 $CODEX_HOME/AGENTS.md——引擎每个会话动态重读该文件，
//   新会话即生效、无需重启引擎。soulSlug 记录当前生效人格（「还原默认」时清空）。
// ⛔ 本模块只做数据与应用动作，不碰 electron/main；codexHome 由 handler 传入。
import { net } from "electron";
import { applyPersonalizationToAgentsMd, readPersonalization, writePersonalization } from "./personalization";

const API = "https://api.skillhub.cn";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export type SkillHubSoul = { slug: string; displayName: string; summary: string; version: string };

/** 人格列表（一次全量，16 套） */
export async function listSkillHubSouls(): Promise<{ items: SkillHubSoul[]; total: number }> {
  const response = await net.fetch(`${API}/api/v1/souls`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`SkillHub 人格列表请求失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  const items: SkillHubSoul[] = (Array.isArray(payload?.souls) ? payload.souls : [])
    .map((entry: any) => ({
      slug: text(entry.slug),
      displayName: text(entry.displayName) || text(entry.slug),
      summary: text(entry.summary) || text(entry.remark) || "暂无简介",
      version: text(entry.version),
    }))
    .filter((entry: SkillHubSoul) => entry.slug);
  return { items, total: Number(payload?.total) || items.length };
}

/** 人格详情（content = 完整人设文本） */
export async function getSkillHubSoul(slug: string): Promise<SkillHubSoul & { content: string }> {
  const response = await net.fetch(`${API}/api/v1/souls/${encodeURIComponent(String(slug ?? "").trim())}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`人格详情获取失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  const content = text(payload?.content);
  if (!content) throw new Error("该人格没有内容");
  return {
    slug: text(payload.slug),
    displayName: text(payload.displayName) || text(payload.slug),
    summary: text(payload.summary) || text(payload.remark) || "暂无简介",
    version: text(payload.version),
    content,
  };
}

/** 当前生效人格（soulSlug 为空 = 默认人格） */
export async function currentSkillHubSoul(): Promise<{ soulSlug: string; persona: string }> {
  const config = await readPersonalization();
  return { soulSlug: String(config.soulSlug ?? ""), persona: String(config.persona ?? "") };
}

/** 应用人格：写 personalization 并同步 $CODEX_HOME/AGENTS.md（引擎每会话重读，即生效） */
export async function applySkillHubSoul(slug: string, codexHome: string): Promise<{ slug: string; displayName: string }> {
  const soul = await getSkillHubSoul(slug);
  await writePersonalization({ persona: soul.content, soulSlug: soul.slug });
  await applyPersonalizationToAgentsMd(await readPersonalization(), codexHome);
  return { slug: soul.slug, displayName: soul.displayName };
}

/** 还原默认人格：清空 persona 与 soulSlug */
export async function resetSkillHubSoul(codexHome: string): Promise<void> {
  await writePersonalization({ persona: "", soulSlug: "" });
  await applyPersonalizationToAgentsMd(await readPersonalization(), codexHome);
}
