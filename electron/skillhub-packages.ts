// SkillHub 专家市场包（skillhub.cn/skillspackage）——列表 + 一键安装 + 专家卡片。
//
// 数据源：https://api.skillhub.cn/api/v1/skillsets（公开 JSON，总 55 包）。
//   列表 { skillSets: [...], total }；翻页参数是 pageNum/pageSize（实测 page/page_size 不生效）。
//   条目自带 content = 整份 SKILL.md（meta-skill：frontmatter 里 orchestration.children
//   列出该包编排的子技能 slugs）——装包 = 落盘这份元技能 + 逐个装子技能 + 建专家卡片。
// 子技能安装：复用 installCocoLoopSkill 既有通道（COS zip，404 自动回退 /api/v1/download?slug=）。
// 专家卡片：包安装后在专家中心新增对应专家（lead.systemPrompt = 元技能正文，去掉 frontmatter）。
// ⛔ 本模块不 import electron/main（destinationRoot 由 handler 传入）——依赖面保持叶子。
import { net } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { installCocoLoopSkill, SKILLHUB_COS_BASE, type MarketSkill } from "./skills-market";
import { normalizeTeamConfig, readExpertTeams, writeExpertTeams } from "./expert-teams";

const API = "https://api.skillhub.cn";
const MARKET_HOME = "https://skillhub.cn/skillspackage";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

export type SkillHubSkillset = {
  slug: string;
  displayName: string;
  summary: string;
  scene: string;
  subScene: string;
  children: string[];
};

function mapSkillset(entry: any): SkillHubSkillset {
  const content = typeof entry.content === "string" ? entry.content : "";
  return {
    slug: text(entry.slug),
    displayName: text(entry.displayName) || text(entry.slug),
    summary: text(entry.summary) || text(entry.summaryEn) || "暂无简介",
    scene: text(entry.scene),
    subScene: text(entry.subScene),
    children: parseChildren(content),
  };
}

/** 从 SKILL.md frontmatter 里抠 orchestration.children 的 slug 列表（块级列表形态） */
export function parseChildren(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => /^orchestration\s*:/i.test(line));
  if (start < 0) return [];
  const childIdx = lines.findIndex((line, i) => i > start && /^\s+children\s*:/i.test(line));
  if (childIdx < 0) return [];
  const out: string[] = [];
  for (let i = childIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^\s+-\s+/.test(line)) break; // 缩进结束 = children 列表结束
    const slug = line.replace(/^\s+-\s*/, "").replace(/^["']|["']$/g, "").trim();
    if (slug) out.push(slug);
  }
  return out;
}

/** 去掉 SKILL.md 的 frontmatter（--- … ---），正文作为专家 systemPrompt */
export function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  return (match ? content.slice(match[0].length) : content).trim();
}

/** 包列表：有搜索词时服务端不支持（实测只有 pageNum/pageSize），拉全量本地过滤 */
export async function listSkillHubSkillsets(input: { page?: number; pageSize?: number; query?: string } = {}) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(20, Math.max(1, Math.floor(Number(input.pageSize) || 12)));
  const query = input.query?.trim().toLowerCase();
  const response = await net.fetch(`${API}/api/v1/skillsets?pageNum=${page}&pageSize=${pageSize}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`SkillHub 技能包请求失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  const sets: any[] = Array.isArray(payload?.skillSets) ? payload.skillSets : [];
  const total = num(payload?.total) || sets.length;
  let items: SkillHubSkillset[] = sets.map(mapSkillset).filter((entry) => entry.slug);
  if (query) {
    const all: SkillHubSkillset[] = [...items];
    const seen = new Set(items.map((entry) => entry.slug));
    for (let p = 2; all.length < total && p <= Math.ceil(total / pageSize); p += 1) {
      const next = await net.fetch(`${API}/api/v1/skillsets?pageNum=${p}&pageSize=${pageSize}`, { signal: AbortSignal.timeout(15_000) });
      if (!next.ok) break;
      const nextPayload: any = await next.json();
      for (const entry of (Array.isArray(nextPayload?.skillSets) ? nextPayload.skillSets : []).map(mapSkillset)) {
        if (!seen.has(entry.slug)) { seen.add(entry.slug); all.push(entry); }
      }
    }
    const filtered = all.filter((entry) => `${entry.displayName} ${entry.summary}`.toLowerCase().includes(query));
    items = filtered.slice((page - 1) * pageSize, page * pageSize);
    return { items, total: filtered.length, page, pageSize };
  }
  return { items, total, page, pageSize };
}

async function fetchSkillsetDetail(slug: string): Promise<{ displayName: string; summary: string; content: string }> {
  const response = await net.fetch(`${API}/api/v1/skillsets/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`技能包详情获取失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  const entry = payload?.skillset ?? payload?.skillSet ?? payload;
  const content = typeof entry?.content === "string" ? entry.content : "";
  if (!content.trim()) throw new Error("该技能包没有可安装内容");
  return { displayName: text(entry.displayName) || slug, summary: text(entry.summary), content };
}

/** 标记一个技能目录为「专家包子技能」（幂等；.skillhub.json 不存在则新建一个最小档） */
export async function markSkillsetChild(folderPath: string, skillsetSlug: string) {
  const file = path.join(folderPath, ".skillhub.json");
  let raw: any = {};
  try { raw = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* 首建 */ }
  raw.kind = "skillset-child";
  raw.skillset = skillsetSlug;
  await fs.writeFile(file, JSON.stringify(raw, null, 2), "utf8");
}

async function writeSkillFolder(destinationRoot: string, folder: string, content: string) {  const target = path.join(destinationRoot, folder);
  await fs.mkdir(target, { recursive: true });
  const file = path.join(target, "SKILL.md");
  await fs.writeFile(file, content.replace(/^﻿/, ""), "utf8");
  await fs.writeFile(path.join(target, ".skillhub.json"), JSON.stringify({
    marketId: folder,
    sourceUrl: MARKET_HOME,
    kind: "skillset",
    installedAt: new Date().toISOString(),
  }, null, 2), "utf8");
  return file;
}

/**
 * 一键安装技能包：落盘元技能 → 逐个装子技能 → 专家中心建对应专家卡片。
 * 子技能装失败不阻塞（元技能和专家卡片已就位，缺的子技能在返回里点名）。
 */
export async function installSkillHubSkillset(input: { slug: string; destinationRoot: string; onProgress?: (stage: string, message: string) => void }) {
  const slug = String(input.slug ?? "").trim();
  if (!slug) throw new Error("缺少技能包 slug");
  const progress = (stage: string, message: string) => input.onProgress?.(stage, message);
  progress("resolve", `正在读取技能包「${slug}」`);
  const detail = await fetchSkillsetDetail(slug);
  progress("install", "正在写入专家包元技能");
  await writeSkillFolder(input.destinationRoot, slug, detail.content);
  const children = parseChildren(detail.content);
  const childFailures: string[] = [];
  const installedChildren: string[] = [];
  for (const child of children) {
    progress("install", `正在安装子技能 ${child}`);
    try {
      const skill: MarketSkill = {
        id: child,
        name: child,
        description: "",
        category: "skillset-child",
        icon: "✨",
        author: "SkillHub",
        securityLevel: "unknown",
        sourceCredibility: "",
        downloads: "0",
        favorites: "0",
        downloadUrl: `${SKILLHUB_COS_BASE}/skills/${encodeURIComponent(child)}.zip`,
        detailUrl: `${API}/skills/${encodeURIComponent(child)}`,
      };
      const installed = await installCocoLoopSkill({ skill, destinationRoot: input.destinationRoot });
      // 给子技能打「专家包专属」标记（10-01 用户：「# 面板里区分不出来哪些是专家专属技能」）：
      // 子技能目录的 .skillhub.json 补 kind/skillset，渲染层据此分组到「专家专属」。
      await markSkillsetChild(path.dirname(installed.path), slug).catch(() => undefined);
      installedChildren.push(child);
    } catch { childFailures.push(child); }
  }
  progress("expert", "正在创建对应专家卡片");
  const teams = await readExpertTeams();
  const existing = teams.find((team) => String(team.displayName?.zh ?? "") === detail.displayName);
  const team = normalizeTeamConfig({
    displayName: { zh: detail.displayName, en: "" },
    profession: { zh: "SkillHub 专家包" },
    description: { zh: detail.summary.slice(0, 200) },
    sop: "",
    lead: { name: detail.displayName, systemPrompt: stripFrontmatter(detail.content).slice(0, 8000) },
    members: [],
    quickPrompts: [],
  });
  const next = existing ? teams.map((entry) => (entry.teamId === team.teamId ? team : entry)) : [team, ...teams];
  await writeExpertTeams(next);
  return {
    slug,
    teamId: team.teamId,
    displayName: detail.displayName,
    installedChildren,
    childFailures,
    expertCreated: true,
    expertUpdated: Boolean(existing),
  };
}
