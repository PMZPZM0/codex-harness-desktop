import { net } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);
const API_BASE = "https://api.cocoloop.cn";
const MARKET_HOME = "https://hub.cocoloop.cn";
// SkillHub（skillhub.cn）国内 Skill 商店：showcase/搜索 JSON API + COS zip 直链，
// 与官方 CLI（skills_store_cli.py）走同一套后端接口，无需 python3/bash 依赖。
const SKILLHUB_COS = "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com";
const SKILLHUB_API = "https://api.skillhub.cn";
export type SkillHubSection = "hot" | "trending" | "newest" | "featured";
const skillHubShowcasePaths: Record<SkillHubSection, string> = {
  hot: "hot",            // 下载量最高（对应「总排行」）
  trending: "trending",  // 近期最热
  newest: "newest",      // 最新上传
  featured: "featured",  // 官方精选
};
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_SKILL_BYTES = 512 * 1024;
const MAX_EXTRACTED_FILES = 200;
/** 是否含中日韩文字：用来判断一段简介是不是中文，决定能否当「中文注释」存下来。 */
const CJK_RE = /[\u3400-\u9fff]/;

export type MarketCategory = "overall" | "trending" | "latest" | "ai_enhancement" | "development" | "office" | "efficiency" | "design" | "content_creation" | "professional";
export type MarketSkill = {
  id: string;
  name: string;
  description: string;
  /** 市场提供的中文简介（SkillHub 的 description_zh）。安装时写进来源清单，供宿主展示中文注释——
   *  技能装到本地后只有 SKILL.md frontmatter，其 description 往往是英文，没有它就只能显示英文原文。 */
  descriptionZh?: string;
  category: string;
  subCategory?: string;
  icon: string;
  author: string;
  securityLevel: string;
  sourceCredibility: string;
  downloads: string;
  favorites: string;
  downloadUrl: string;
  detailUrl: string;
};
export type InstalledMarketSkill = { marketId: string; sourceUrl: string; installedAt: string; icon?: string; category?: string; descriptionZh?: string };

// 注意：tab 参数本身已按分类过滤，不能再叠加 tags —— 实测
// `tab=development&tags=开发` 返回 total:0，去掉 tags 后正常返回 2838 条。
const categories: Record<MarketCategory, { sort: string }> = {
  overall: { sort: "downloads" },
  trending: { sort: "recommend" },
  latest: { sort: "downloads" },
  ai_enhancement: { sort: "downloads" },
  development: { sort: "downloads" },
  office: { sort: "downloads" },
  efficiency: { sort: "downloads" },
  design: { sort: "downloads" },
  content_creation: { sort: "downloads" },
  professional: { sort: "downloads" },
};

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function safeFolder(value: string) { return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "skill"; }
function psLiteral(value: string) { return value.replaceAll("'", "''"); }
function psEncoded(command: string) { return Buffer.from(command, "utf16le").toString("base64"); }

export async function listCocoLoopSkills(input: { category?: string; page?: number; pageSize?: number; query?: string }) {
  const category = (Object.prototype.hasOwnProperty.call(categories, input.category ?? "") ? input.category : "overall") as MarketCategory;
  const preset = categories[category];
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(30, Math.max(1, Math.floor(Number(input.pageSize) || 15)));
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort: preset.sort, tab: category });
  if (input.query?.trim()) params.set("keyword", input.query.trim());
  const response = await net.fetch(`${API_BASE}/api/v1/store/skills?${params}` , { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`CocoLoop 市场请求失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  if (payload?.code !== 0 || !Array.isArray(payload?.data?.items)) throw new Error("CocoLoop 返回的数据格式无效");
  const items: MarketSkill[] = payload.data.items.map((entry: any) => ({
    id: String(entry.id ?? ""),
    name: text(entry.name),
    description: text(entry.brief) || text(entry.subtitle) || "暂无技能简介",
    category: text(entry.category),
    icon: text(entry.icon) || "✨",
    author: text(entry.author) || "Unknown",
    securityLevel: ["S+", "S", "A", "B", "C", "D"].includes(text(entry.security_level)) ? text(entry.security_level) : "unknown",
    sourceCredibility: text(entry.source_credibility),
    downloads: text(entry.downloads) || "0",
    favorites: text(entry.favorites) || "0",
    downloadUrl: text(entry.download_url),
    detailUrl: `${MARKET_HOME}/skills/${encodeURIComponent(String(entry.id ?? ""))}`,
  })).filter((entry: MarketSkill) => entry.id && entry.name && entry.downloadUrl);
  return { items, total: Number(payload.data.total) || items.length, page, pageSize };
}

function mapSkillHubEntry(entry: any): MarketSkill {
  const slug = text(entry.slug) || text(entry.namespace?.publicSlug);
  const rawCategory = text(entry.category);
  // subCategories 是中文命名（如「上下文管理」），展示时优先用中文
  const zhSub = Array.isArray(entry.subCategories) && entry.subCategories.length ? text(entry.subCategories[0]?.name) : "";
  return {
    id: slug,
    name: text(entry.displayName) || text(entry.name) || slug,
    description: text(entry.description_zh) || text(entry.description) || "暂无技能简介",
    descriptionZh: text(entry.description_zh) || undefined,
    // category 保留英文 key 用于分类过滤；zhSub 中文二级分类追加到作者旁展示
    category: rawCategory || "skill",
    subCategory: zhSub,
    icon: text(entry.iconUrl) || text(entry.icon_url) || "✨",
    author: text(entry.ownerName) || text(entry.namespace?.displayName) || "Unknown",
    securityLevel: "unknown",
    sourceCredibility: entry.verified ? "官方验证" : "",
    downloads: String(entry.downloads ?? 0),
    favorites: String(entry.installs ?? 0),
    downloadUrl: `${SKILLHUB_COS}/skills/${encodeURIComponent(slug)}.zip`,
    detailUrl: text(entry.homepage) || `${SKILLHUB_API}/skills/${encodeURIComponent(slug)}`,
  };
}

/** SkillHub 市场清单：section 为 showcase 榜单；有 query 时走搜索接口 */
export async function listSkillHubSkills(input: { section?: string; query?: string; limit?: number }) {
  const section = (Object.prototype.hasOwnProperty.call(skillHubShowcasePaths, input.section ?? "") ? input.section : "hot") as SkillHubSection;
  const limit = Math.min(40, Math.max(4, Math.floor(Number(input.limit) || 30)));
  if (input.query?.trim()) {
    const params = new URLSearchParams({ q: input.query.trim(), limit: String(limit) });
    const response = await net.fetch(`${SKILLHUB_API}/api/v1/search?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`SkillHub 搜索失败（HTTP ${response.status}）`);
    const payload: any = await response.json();
    const items = (Array.isArray(payload?.results) ? payload.results : []).map(mapSkillHubEntry).filter((entry: MarketSkill) => entry.id && entry.downloadUrl);
    return { items, total: items.length, page: 1, pageSize: limit };
  }
  // 总排行（hot）拉四个 showcase 榜单并集去重，量级从 100 提升到 280+；
  // 其余榜单各自单榜拉取。
  const sections: SkillHubSection[] = section === "hot" ? ["hot", "trending", "newest", "featured"] : [section];
  const seen = new Map<string, MarketSkill>();
  for (const current of sections) {
    const response = await net.fetch(`${SKILLHUB_API}/api/v1/showcase/${skillHubShowcasePaths[current]}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`SkillHub 市场请求失败（HTTP ${response.status}）`);
    const payload: any = await response.json();
    for (const entry of Array.isArray(payload?.skills) ? payload.skills : []) {
      const mapped = mapSkillHubEntry(entry);
      if (mapped.id && mapped.downloadUrl && !seen.has(mapped.id)) seen.set(mapped.id, mapped);
    }
  }
  const items = [...seen.values()].sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0));
  return { items, total: items.length, page: 1, pageSize: limit };
}

async function collectFiles(root: string, relative = "", out: string[] = []): Promise<string[]> {
  if (out.length > MAX_EXTRACTED_FILES) throw new Error("技能压缩包包含过多文件，已拒绝安装");
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("技能包包含符号链接，已拒绝安装");
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) await collectFiles(root, next, out);
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

function auditSkill(content: string, files: string[]) {
  const findings: string[] = [];
  const lower = content.toLowerCase();
  if (/\brm\s+-rf\s+[/~]|\bformat\s+[a-z]:|\bdel\s+\/s\s+\/q\b/.test(lower)) findings.push("检测到破坏性删除命令");
  if (/curl\s+[^\n|]+\|\s*(sh|bash)|invoke-expression|\biex\s*\(/i.test(content)) findings.push("检测到远程脚本直接执行");
  if (/powershell(?:\.exe)?\s+-(?:enc|encodedcommand)\b/i.test(content)) findings.push("检测到编码 PowerShell 命令");
  if (files.some((file) => /\.(exe|dll|msi|bat|cmd|ps1)$/i.test(file))) findings.push("技能包包含可执行文件或脚本载荷");
  return findings;
}

async function expandZip(zipPath: string, outputDir: string) {
  if (process.platform === "win32") {
    const command = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath '${psLiteral(zipPath)}' -DestinationPath '${psLiteral(outputDir)}' -Force`;
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", psEncoded(command)], { windowsHide: true, maxBuffer: 1024 * 1024 });
    return;
  }
  await execFileAsync("tar", ["-xf", zipPath, "-C", outputDir], { maxBuffer: 1024 * 1024 });
}

export type InstallProgress = { stage: "download" | "extract" | "audit" | "install" | "register"; message: string };

export async function installCocoLoopSkill(input: { skill: MarketSkill; destinationRoot: string; onProgress?: (progress: InstallProgress) => void }) {
  const skill = input.skill;
  const progress = (stage: InstallProgress["stage"], message: string) => input.onProgress?.({ stage, message });
  const isCocoLoopUrl = /^https:\/\/dl\.cocoloop\.cn\//i.test(skill.downloadUrl ?? "");
  const isSkillHubUrl = /^https:\/\/skillhub-1388575217\.cos\.ap-guangzhou\.myqcloud\.com\//i.test(skill.downloadUrl ?? "");
  const market = isSkillHubUrl ? "skillhub" : "cocoloop";
  if (!skill?.id || !skill?.name || (!isCocoLoopUrl && !isSkillHubUrl)) throw new Error("无效的技能下载地址");
  progress("download", market === "skillhub" ? "正在从 SkillHub 下载技能包" : "正在从 CocoLoop 下载技能包");
  let response = await net.fetch(skill.downloadUrl, { signal: AbortSignal.timeout(45_000) });
  // SkillHub 部分带 namespace 的技能不在 COS 直链上，404 时回退官方下载 API
  if (!response.ok && isSkillHubUrl && response.status === 404) {
    response = await net.fetch(`${SKILLHUB_API}/api/v1/download?slug=${encodeURIComponent(skill.id)}`, { signal: AbortSignal.timeout(45_000) });
  }
  if (!response.ok) throw new Error(`技能下载失败（HTTP ${response.status}）`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_ARCHIVE_BYTES) throw new Error("技能压缩包超过 50 MB，已拒绝安装");
  const archive = Buffer.from(await response.arrayBuffer());
  if (!archive.length || archive.length > MAX_ARCHIVE_BYTES) throw new Error("技能压缩包为空或超过 50 MB，已拒绝安装");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-harness-skill-"));
  try {
    const zipPath = path.join(temp, "skill.zip");
    const extracted = path.join(temp, "extracted");
    await fs.mkdir(extracted);
    await fs.writeFile(zipPath, archive);
    progress("extract", "正在解压并检查技能文件结构");
    await expandZip(zipPath, extracted);
    const files = await collectFiles(extracted);
    const skillFiles = files.filter((file) => path.basename(file).toLowerCase() === "skill.md");
    if (skillFiles.length !== 1) throw new Error("技能包必须且只能包含一个 SKILL.md");
    const sourceDir = path.dirname(path.join(extracted, skillFiles[0]));
    const content = await fs.readFile(path.join(extracted, skillFiles[0]), "utf8");
    if (!content.trim() || Buffer.byteLength(content) > MAX_SKILL_BYTES) throw new Error("SKILL.md 为空或超过 512 KB");
    progress("audit", "正在进行安全检查");
    const findings = auditSkill(content, files);
    if (findings.length) throw new Error(`安全检查未通过：${findings.join("；")}`);
    const folder = `${safeFolder(skill.name)}-${safeFolder(skill.id)}`;
    const target = path.join(input.destinationRoot, folder);
    progress("install", "正在写入 Codex 技能目录");
    await fs.mkdir(input.destinationRoot, { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(sourceDir, target, { recursive: true, dereference: false, errorOnExist: true });
    progress("register", "正在写入市场来源清单");
    const manifest: InstalledMarketSkill = { marketId: skill.id, sourceUrl: skill.detailUrl, installedAt: new Date().toISOString(), icon: skill.icon || undefined, category: skill.category || undefined, descriptionZh: skill.descriptionZh || (CJK_RE.test(skill.description ?? "") ? skill.description : undefined) };
    // 清单文件名按市场区分；读取端（local-list / 健康检查）两个名字都认
    await fs.writeFile(path.join(target, market === "skillhub" ? ".skillhub.json" : ".cocoloop.json"), JSON.stringify(manifest, null, 2), "utf8");
    return { id: folder, name: skill.name, path: path.join(target, "SKILL.md"), description: skill.description, marketId: skill.id, sourceUrl: skill.detailUrl, securityLevel: skill.securityLevel };
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
