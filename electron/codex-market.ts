// 插件市场（Gitee 官方镜像源，2026-10-01 二次换源）——展示 + 一键安装。
//
// 数据源：gitee.com/yuqiaodi/claude-plugins-official-gitee（Claude Code 官方插件市场的
//   **Gitee 镜像版**，专为中国大陆用户优化：32 个 Anthropic 官方插件 + 16 个精选第三方
//   = 48 个，全部是 .claude-plugin/plugin.json 兼容格式）。
// ⛔ 换源史：原 codex-marketplace.com（国内访问不稳，整面 AbortError）→ SkillHub
//   （api.skillhub.cn，9600+ 条，实测绝大多数面向 DeepSeek Harness（DSH）生态装不上，
//   用户令换源）→ 本源。本源 48 个插件 100% Codex 兼容，无需再探 manifest。
// list = .claude-plugin/marketplace.json（Gitee contents API，base64，5 分钟缓存）；
// install = git trees API（recursive，533 项一次拿全）+ raw 下载（gitee raw 是 302 跳转，
//   electron net 自动跟随）→ 写入本地 marketplace 目录 → 注册 [marketplaces.codex-market]
//   → 引擎 plugin/install + plugin/list 发现。
import { net } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const GITEE_OWNER = "yuqiaodi";
const GITEE_REPO = "claude-plugins-official-gitee";
const GITEE_BRANCH = "main";
const GITEE_API = "https://gitee.com/api/v5";
const GITEE_HOME = `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}`;
const MARKET_SOURCE_LABEL = "Gitee 官方镜像";
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 300;

export type CodexMarketPlugin = {
  slug: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  /** 分类中文名（映射表，列表时已映射好） */
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
  /** 仓库定位（Gitee 源：镜像仓库自己的 owner/name 与分支） */
  fullName?: string;
  owner?: string;
  defaultBranch?: string;
  license?: string;
  installability?: string;
};

export type CodexMarketInstallProgress = { stage: "resolve" | "download" | "install" | "register"; message: string };

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

/** 分类中文名（marketplace.json 的 category 是英文 key） */
const CATEGORY_ZH: Record<string, string> = {
  development: "开发",
  productivity: "效率",
  security: "安全",
  learning: "学习",
  database: "数据库",
  math: "数学",
  testing: "测试",
};

export type MarketCategory = { key: string; displayName: string };

let marketCache: { at: number; plugins: CodexMarketPlugin[] } | null = null;

/** 拉取并缓存镜像市场的插件清单（marketplace.json，5 分钟缓存） */
async function loadMarketPlugins(): Promise<CodexMarketPlugin[]> {
  if (marketCache && Date.now() - marketCache.at < 300_000) return marketCache.plugins;
  const url = `${GITEE_API}/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/.claude-plugin/marketplace.json?ref=${GITEE_BRANCH}`;
  const response = await fetchWithRetry(url, 15_000, 3).catch((error: unknown) => {
    throw new Error(`插件市场连接失败（已重试 3 次，请检查网络后重试）：${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) throw new Error(`插件市场请求失败（HTTP ${response.status}）`);
  const payload: any = await response.json();
  // contents API 返回 base64 content；直接解析
  const raw = payload?.encoding === "base64" && payload?.content
    ? Buffer.from(payload.content, "base64").toString("utf8")
    : text(payload?.content);
  const manifest = JSON.parse(raw);
  const entries: any[] = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
  const plugins: CodexMarketPlugin[] = entries
    .map((entry: any) => {
      const src = entry?.source;
      // source 支持 "./plugins/x" 字符串形态（镜像仓库全部是这种）；对象形态（外部 GitHub 源）镜像里已剔除
      const pluginPath = text(typeof src === "string" ? src : src?.path).replace(/^\.\//, "");
      const category = text(entry.category) || "development";
      return {
        slug: text(entry.name),
        name: text(entry.name),
        displayName: text(entry.name),
        description: text(entry.description) || "暂无插件简介",
        category,
        categoryZh: CATEGORY_ZH[category] ?? category,
        logo: "",
        author: text(entry.author?.name) || "Anthropic / 社区",
        repository: GITEE_HOME,
        pluginPath,
        version: text(entry.version),
        githubStars: 0,
        installs: 0,
        homepage: text(entry.homepage) || GITEE_HOME,
        source: MARKET_SOURCE_LABEL,
        featured: false,
        hasSkills: false,
        hasMcpServers: false,
        fullName: `${GITEE_OWNER}/${GITEE_REPO}`,
        owner: GITEE_OWNER,
        defaultBranch: GITEE_BRANCH,
        license: text(entry.license),
      } satisfies CodexMarketPlugin;
    })
    .filter((entry) => entry.slug && entry.pluginPath);
  marketCache = { at: Date.now(), plugins };
  return plugins;
}

/** 市场分类（从清单现算：key + 中文名 + 数量） */
export async function listMarketCategories(): Promise<MarketCategory[]> {
  const plugins = await loadMarketPlugins();
  const counts = new Map<string, number>();
  for (const entry of plugins) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, displayName: CATEGORY_ZH[key] ?? key }))
    .sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));
}

/** 市场清单：客户端过滤（48 个全量拉回，q/category 过滤 + 页切片） */
export async function listMarketPlugins(input: { category?: string; query?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(30, Math.max(1, Math.floor(Number(input.pageSize) || 18)));
  let items = await loadMarketPlugins();
  if (input.category && input.category !== "全部") items = items.filter((entry) => entry.category === input.category);
  const q = input.query?.trim().toLowerCase();
  if (q) {
    items = items.filter((entry) =>
      entry.name.toLowerCase().includes(q)
      || entry.description.toLowerCase().includes(q)
      || entry.author.toLowerCase().includes(q)
      || (entry.categoryZh ?? "").includes(input.query!.trim()));
  }
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

type RepoRef = { owner: string; repo: string };
function parseGiteeRepo(repository: string): RepoRef | null {
  const match = /gitee\.com\/([^/]+)\/([^/?#]+)/i.exec(repository);
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

/** Gitee API 偶发 502/超时，必须重试 */
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

/** 枚举镜像仓库里 pluginPath 下的所有文件（trees API recursive，533 项一次拿全） */
async function listPluginFiles(owner: string, repo: string, branch: string, pluginPath: string): Promise<FileEntry[]> {
  const tree = await fetchJson(`${GITEE_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (tree?.tree && !tree.truncated) {
    // pluginPath 为 ""（仓库根）时前缀也必须是空串——"/" 前缀会一个文件都匹配不上
    const prefix = pluginPath ? `${pluginPath}/` : "";
    return tree.tree
      .filter((t: any) => t.type === "blob" && t.path.startsWith(prefix))
      .map((t: any) => ({ path: t.path, size: num(t.size) }));
  }
  throw new Error(`Gitee 文件树获取失败（${owner}/${repo}@${branch}）——请稍后重试`);
}

/** 并发下载（限流 6 路）；gitee raw 是 302 跳转到带签名的 CDN 地址，net 自动跟随 */
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
      const response = await fetchWithRetry(`${GITEE_HOME}/raw/${branch}/${file.path}`, 60_000);
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

/** 一键安装：Gitee 下载插件目录 → 写入 marketplace 目录（幂等覆盖） */
export async function installCodexMarketPlugin(input: { plugin: CodexMarketPlugin; destinationRoot: string; onProgress?: (progress: CodexMarketInstallProgress) => void }) {
  const plugin = input.plugin;
  const progress: ProgressFn = (stage, message) => input.onProgress?.({ stage, message });
  if (!plugin?.slug || !plugin.pluginPath) throw new Error("无效的插件条目");
  const repoRef = parseGiteeRepo(plugin.repository);
  if (!repoRef) throw new Error(`插件仓库地址无法解析：${plugin.repository}`);
  progress("resolve", "正在解析插件清单与版本");
  const branch = plugin.defaultBranch || GITEE_BRANCH;
  progress("download", "正在从 Gitee 镜像下载插件文件（国内源）");
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
    const manifest = { marketId: plugin.slug, sourceUrl: `${GITEE_HOME}/tree/${branch}/${plugin.pluginPath}`, pluginPath: plugin.pluginPath, version: plugin.version, installedAt: new Date().toISOString(), description: plugin.description, category: plugin.category };
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
  let manifest: { name?: string; owner?: { name: string }; plugins: Array<{ name: string; source: string; description?: string }> } = { name: "codex-market", owner: { name: "Gitee 官方镜像" }, plugins: [] };
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
