// 插件市场（SkillHub 插件源，2026-10-01 换源）——展示 + 一键安装。
//
// 数据源：https://api.skillhub.cn/api/v1/plugins（skillhub.cn/plugins，公开 JSON API，
//   9600+ 条，支持 q= 搜索、category= 分类、page/page_size 分页）。原 codex-marketplace.com
//   源已整体删除（用户令；且该站国内访问不稳，市场页整面 AbortError）。
// ⛔ 生态事实（2026-10-01 实测 install-plan 接口）：SkillHub 插件多数面向 DeepSeek Harness
//   （DSH，安装命令 `dsh plugin add`），与 Codex 插件格式不通用。因此安装前先探仓库里
//   有没有 Codex 兼容 manifest（.claude-plugin/plugin.json）——没有就明确报错，不装废件。
// 安装原理：仓库（repositoryUrl + defaultBranch）按 trees API 枚举文件，逐文件
//   raw.githubusercontent.com 拉取，原样写入本地 marketplace 目录，再注册
//   [marketplaces.codex-market] 让引擎 plugin/list 直接发现 + plugin/install 注册。
import { net } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const SKILLHUB_API = "https://api.skillhub.cn";
const GITHUB_API = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 300;

export type CodexMarketPlugin = {
  slug: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  /** 分类中文名（SkillHub categories API 的 displayName，列表时已映射好） */
  categoryZh?: string;
  logo: string;
  author: string;
  repository: string;
  pluginPath: string;
  version: string;
  githubStars: number;
  installs: number;
  homepage: string;
  source: string;
  featured: boolean;
  hasSkills: boolean;
  hasMcpServers: boolean;
  /** SkillHub 源专属：GitHub 仓库全名（owner/name）与默认分支，安装时定位文件树 */
  fullName?: string;
  owner?: string;
  defaultBranch?: string;
  license?: string;
  installability?: string;
};

export type CodexMarketInstallProgress = { stage: "resolve" | "download" | "install" | "register"; message: string };

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

export type SkillHubPluginCategory = { key: string; displayName: string };
let categoryCache: { at: number; items: SkillHubPluginCategory[] } | null = null;

/** SkillHub 插件分类（10 分钟缓存） */
export async function listSkillHubPluginCategories(): Promise<SkillHubPluginCategory[]> {
  if (categoryCache && Date.now() - categoryCache.at < 600_000) return categoryCache.items;
  const response = await fetchWithRetry(`${SKILLHUB_API}/api/v1/plugins/categories`, 15_000, 3);
  const payload: any = await response.json();
  const items: SkillHubPluginCategory[] = (Array.isArray(payload?.items) ? payload.items : [])
    .map((entry: any) => ({ key: text(entry.key), displayName: text(entry.displayName) || text(entry.key) }))
    .filter((entry: SkillHubPluginCategory) => entry.key);
  categoryCache = { at: Date.now(), items };
  return items;
}

/** SkillHub 插件市场清单：服务端分页（page/page_size/q/category 实测有效，total 9600+） */
export async function listSkillHubPlugins(input: { category?: string; query?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(30, Math.max(1, Math.floor(Number(input.pageSize) || 18)));
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (input.query?.trim()) params.set("q", input.query.trim());
  if (input.category && input.category !== "全部") params.set("category", input.category);
  const response = await fetchWithRetry(`${SKILLHUB_API}/api/v1/plugins?${params}`, 15_000, 3).catch((error: unknown) => {
    throw new Error(`SkillHub 插件市场连接失败（已重试 3 次，请检查网络后重试）：${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) throw new Error(`SkillHub 插件市场请求失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  const raw: any[] = Array.isArray(payload?.items) ? payload.items : [];
  let categories: SkillHubPluginCategory[] = [];
  try { categories = await listSkillHubPluginCategories(); } catch { /* 分类映射失败就展示英文 key */ }
  const zhByKey = new Map(categories.map((entry) => [entry.key, entry.displayName]));
  const items: CodexMarketPlugin[] = raw
    .filter((entry: any) => text(entry.fullName) && text(entry.name))
    .map((entry: any) => ({
      slug: text(entry.name),
      name: text(entry.name),
      displayName: text(entry.name),
      description: text(entry.description) || "暂无插件简介",
      category: text(entry.categoryKey) || "client",
      categoryZh: zhByKey.get(text(entry.categoryKey)) ?? text(entry.categoryKey),
      logo: text(entry.avatarUrl),
      author: text(entry.owner) || "Unknown",
      repository: text(entry.repositoryUrl),
      pluginPath: "",
      version: "",
      githubStars: num(entry.stars),
      installs: 0,
      homepage: text(entry.homepage),
      source: "skillhub",
      featured: false,
      hasSkills: false,
      hasMcpServers: false,
      fullName: text(entry.fullName),
      owner: text(entry.owner),
      defaultBranch: text(entry.defaultBranch) || "main",
      license: text(entry.license),
      installability: text(entry.installability),
    }));
  return { items, total: num(payload?.total) || items.length, page, pageSize };
}

/**
 * 在仓库文件树里找 Codex 兼容插件入口（.claude-plugin/plugin.json）。
 * 返回其所在目录（在根目录时为 ""）；找不到 = 不是 Codex 插件（多为 DSH 插件），返回 null。
 */
export async function resolveCodexPluginPath(plugin: { repository: string; fullName?: string; defaultBranch?: string }): Promise<string | null> {
  const ref = plugin.fullName
    ? (() => { const [owner, repo] = plugin.fullName.split("/"); return { owner, repo }; })()
    : parseRepo(plugin.repository);
  if (!ref) throw new Error(`插件仓库地址无法解析：${plugin.repository || plugin.fullName}`);
  const branch = plugin.defaultBranch || "main";
  const files = await listPluginFiles(ref.owner, ref.repo, branch, "");
  const hit = files.find((file) => file.path === ".claude-plugin/plugin.json" || file.path.endsWith("/.claude-plugin/plugin.json"));
  if (!hit) return null;
  return hit.path === ".claude-plugin/plugin.json" ? "" : hit.path.slice(0, -"/.claude-plugin/plugin.json".length);
}

type RepoRef = { owner: string; repo: string };
function parseRepo(repository: string): RepoRef | null {
  const match = /github\.com\/([^/]+)\/([^/?#]+)/i.exec(repository);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}

type FileEntry = { path: string; size: number };
type ProgressFn = (stage: CodexMarketInstallProgress["stage"], message: string) => void;

async function fetchJson(url: string, timeoutMs = 20_000): Promise<any | null> {
  try {
    const response = await fetchWithRetry(url, timeoutMs);
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

/** raw.githubusercontent.com 在国内网络会间歇性 ECONNRESET（实测 node 栈尤甚），必须重试 */
async function fetchWithRetry(url: string, timeoutMs: number, tries = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 枚举仓库里 pluginPath 下的所有文件；trees API truncated 时回退 contents 逐目录走 */
async function listPluginFiles(owner: string, repo: string, branch: string, pluginPath: string): Promise<FileEntry[]> {
  const tree = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (tree?.tree && !tree.truncated) {
    // pluginPath 为 ""（仓库根）时前缀也必须是空串——"/" 前缀会一个文件都匹配不上
    const prefix = pluginPath ? `${pluginPath}/` : "";
    return tree.tree
      .filter((t: any) => t.type === "blob" && t.path.startsWith(prefix))
      .map((t: any) => ({ path: t.path, size: num(t.size) }));
  }
  // contents API 逐目录走（跳过 submodule / symlink）
  const out: FileEntry[] = [];
  const stack = [pluginPath];
  while (stack.length && out.length <= MAX_FILES) {
    const current = stack.pop()!;
    const entries = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(current)}?ref=${branch}`);
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      if (item?.type === "dir") stack.push(item.path);
      else if (item?.type === "file") out.push({ path: item.path, size: num(item.size) });
      // submodule/symlink：跳过，无法用 raw 下载
    }
  }
  return out;
}

async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const info = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}`);
  if (info?.default_branch) return info.default_branch;
  return "main"; // 拿不到就赌 main（官方仓库均为 main）
}

/** 并发下载（限流 6 路） */
async function downloadFiles(owner: string, repo: string, branch: string, files: FileEntry[], tempDir: string, progress: ProgressFn) {
  let total = 0;
  for (const file of files) total += file.size;
  if (total > MAX_TOTAL_BYTES) throw new Error("插件包超过 50 MB，已拒绝安装");
  if (files.length > MAX_FILES) throw new Error("插件包含过多文件，已拒绝安装");
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      const file = files[cursor++];
      if (file.size > MAX_SINGLE_FILE_BYTES) throw new Error(`文件 ${file.path} 超过 20 MB，已拒绝安装`);
      const response = await fetchWithRetry(`${RAW_GITHUB}/${owner}/${repo}/${branch}/${file.path}`, 60_000);
      if (!response.ok) throw new Error(`插件文件下载失败：${file.path}（HTTP ${response.status}）`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length !== file.size && file.size > 0) {
        // LFS 指针等情况下 raw 返回内容与 tree 大小不一致，以实际为准但拒绝超大
        if (buffer.length > MAX_SINGLE_FILE_BYTES) throw new Error(`文件 ${file.path} 超过 20 MB，已拒绝安装`);
      }
      const dest = path.join(tempDir, file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buffer);
    }
  };
  const workers = Array.from({ length: Math.min(6, files.length) }, () => worker());
  await Promise.all(workers);
}

/** 一键安装：GitHub 下载插件目录 → 写入 marketplace 目录（幂等覆盖） */
export async function installCodexMarketPlugin(input: { plugin: CodexMarketPlugin; destinationRoot: string; onProgress?: (progress: CodexMarketInstallProgress) => void }) {
  const plugin = input.plugin;
  const progress: ProgressFn = (stage, message) => input.onProgress?.({ stage, message });
  if (!plugin?.slug || plugin.pluginPath == null) throw new Error("无效的插件条目");
  const repoRef = parseRepo(plugin.repository);
  if (!repoRef) throw new Error(`插件仓库地址无法解析：${plugin.repository}`);
  progress("resolve", "正在解析插件仓库与版本");
  const branch = await resolveDefaultBranch(repoRef.owner, repoRef.repo);
  progress("download", "正在从 GitHub 下载插件文件");
  const files = await listPluginFiles(repoRef.owner, repoRef.repo, branch, plugin.pluginPath);
  if (!files.length) throw new Error(`插件目录「${plugin.pluginPath}」不存在或为空`);
  const temp = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "codex-harness-plugin-"));
  try {
    await downloadFiles(repoRef.owner, repoRef.repo, branch, files, temp, progress);
    progress("install", `正在写入插件目录 ${plugin.slug}`);
    const target = path.join(input.destinationRoot, safeFolder(plugin.slug));
    await fs.mkdir(input.destinationRoot, { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    // 从临时目录把 pluginPath 子树拷到目标（临时目录内路径 = 仓库内相对路径）
    await fs.cp(path.join(temp, plugin.pluginPath), target, { recursive: true, dereference: false });
    progress("register", "正在写入市场来源清单");
    const manifest = { marketId: plugin.slug, sourceUrl: plugin.repository, pluginPath: plugin.pluginPath, version: plugin.version, installedAt: new Date().toISOString(), description: plugin.description, category: plugin.category };
    await fs.writeFile(path.join(target, ".codex-market.json"), JSON.stringify(manifest, null, 2), "utf8");
    // 引擎实证（0.153.4）：marketplace 根必须有受支持的 manifest（.claude-plugin/marketplace.json），
    // 否则 plugin/list 直接返回空（"marketplace root does not contain a supported manifest"），装了等于白装。
    progress("register", "正在注册本地 marketplace 清单");
    const manifestPath = await upsertCodexMarketManifest(input.destinationRoot, { name: safeFolder(plugin.slug), source: `./${safeFolder(plugin.slug)}`, description: plugin.description });
    return { id: safeFolder(plugin.slug), name: plugin.displayName, path: target, version: plugin.version, description: plugin.description, marketId: plugin.slug, sourceUrl: plugin.repository, manifestPath };
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function safeFolder(value: string) { return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "plugin"; }

/**
 * 维护本地 marketplace 的 .claude-plugin/marketplace.json（引擎认可的三种 manifest 之一，
 * 另两种是 .agents/plugins/marketplace.json 与 .cursor-plugin/marketplace.json）。
 * 每装一个插件就把 { name, source: "./slug" } 合并进 plugins 数组，返回 manifest 文件路径
 * （plugin/install RPC 的 marketplacePath 参数要传这个文件，传目录会报 os error 5）。
 */
export async function upsertCodexMarketManifest(marketDir: string, entry: { name: string; source: string; description?: string }): Promise<string> {
  const manifestDir = path.join(marketDir, ".claude-plugin");
  const manifestPath = path.join(manifestDir, "marketplace.json");
  let manifest: { name?: string; owner?: { name: string }; plugins: Array<{ name: string; source: string; description?: string }> } = { name: "codex-market", owner: { name: "codex-marketplace.com" }, plugins: [] };
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      manifest = parsed;
      if (!Array.isArray(manifest.plugins)) manifest.plugins = [];
    }
  } catch { /* 首次创建 */ }
  manifest.plugins = manifest.plugins.filter((item) => item?.name !== entry.name);
  manifest.plugins.push({ name: entry.name, source: entry.source, description: entry.description ?? "" });
  if (!manifest.name) manifest.name = "codex-market";
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

/**
 * 幂等注册本地插件 marketplace：缺 [marketplaces.codex-market] 才 append 一段
 * （source_type=local 指向插件落盘目录），让引擎 plugin/list 能扫到已装插件。
 * 该段不在 HARNESS_CONFIG_SECTIONS，harness 整份重写时会被 preserveUserConfig 原样拼回。
 */
export async function ensureCodexMarketplaceSection(codexHome: string): Promise<string> {
  const marketDir = path.join(codexHome, "plugins", "codex-market");
  const configPath = path.join(codexHome, "config.toml");
  try {
    let existing = await fs.readFile(configPath, "utf8").catch(() => "");
    if (!/\[marketplaces\.codex-market\]/.test(existing)) {
      const section = [
        "[marketplaces.codex-market]",
        'source_type = "local"',
        `source = "${marketDir.replaceAll("\\", "/")}"`,
        "",
      ].join("\n");
      const next = existing.trim() ? existing.trimEnd() + "\n\n" + section + "\n" : section + "\n";
      await fs.writeFile(configPath, next, "utf8");
    }
  } catch (error) {
    console.warn("seed codex-market marketplace section failed:", error);
  }
  return marketDir;
}
