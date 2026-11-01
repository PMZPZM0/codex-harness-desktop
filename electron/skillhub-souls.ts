// HOTFIX-MARKER-1101
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
// 内置人格数据下沉到 src/lib/builtin-souls.mjs（前端引导向导共用同一真相源；⛔ 别再内联回来）
import { BUILT_IN_SOULS, getBuiltInSoul, isBuiltInSoulSlug } from "../src/lib/builtin-souls.mjs";

export type BuiltInSoul = SkillHubSoul & { content: string };

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
  // ⛔ 内置人格排在最前（本地离线，11-01 用户令「丰富内置」）；远端 SkillHub 紧随其后
  return { items: [...BUILT_IN_SOULS, ...items], total: items.length + BUILT_IN_SOULS.length };
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
export async function currentSkillHubSoul(): Promise<{ soulSlug: string; persona: string; displayName: string }> {
  const config = await readPersonalization();
  const soulSlug = String(config.soulSlug ?? "");
  /* 内置人格的显示名本地可算（SkillHub 远端条目名不落盘，前端显示 slug 兜底） */
  const displayName = getBuiltInSoul(soulSlug)?.displayName ?? "";
  return { soulSlug, persona: String(config.persona ?? ""), displayName };
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

/* ── 内置 Codex 人格（11-01 用户令「丰富 codex 人格内置」）──────────────────────
 * 与 SkillHub 远端人格（16 套，ZZZZ 装睡者一类娱乐向）并列的**本地内置**高质量助手人格：
 * 完全离线可用、content 按 SkillHub 同格式编写（描述/【基础信息】/【核心气质】/【外显风格】/
 * 【语言系统】/【行动逻辑】/【隐藏特质】，参照 soul-market 线上条目实测格式）。
 * ⛔ slug 一律带 `built-in:` 前缀（list/get/apply 三处据此分流本地源，不撞远端 slug）；
 *   应用走同一条 persona 字段写入（buildAgentsMd 渲染进 AGENTS.md，下一新会话即生效）。
 * ⛔ 设计口径：每套与 user-personas.mjs 的某类用户人格**成对**（COMBO_PACKS 引用 built-in:slug），
 *   单独应用也成立（不读用户人格字段，助手人格自洽）。
 */
