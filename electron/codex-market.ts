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
  /**
   * ⛔⛔ 10-03 用户报障「插件安装后没有更新状态、已安装里还是那个 +」：
   *   本地已装标记。**真相源 = 市场目录里安装时写入的 `.codex-market.json`**，
   *   不能再只靠引擎 `plugin/list` 的「id@market 前段 === slug」——
   *   引擎没认领（列表为空）或 id 命名不一致时，UI 永远显示「安装」按钮。
   */
  installed?: boolean;
  /** 已装版本（取自本地 manifest；未装为 undefined）。 */
  installedVersion?: string;
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

/**
 * 插件名称/简介的中文翻译表（10-01 用户：「能不能翻译成中文，英文看不懂」）。
 * ⛔ 上游 marketplace.json 是英文文案；这里按 slug 静态翻译，清单加载时覆盖 displayName/description。
 * 上游新增插件不在表里时自动回落英文原文（宁可显示英文也不显示乱翻）——补条目时同步这张表即可。
 */
const PLUGIN_ZH: Record<string, { name: string; description: string }> = {
  "agent-sdk-dev": { name: "Agent SDK 开发套件", description: "开发 Claude Agent SDK 应用的工具箱" },
  asana: { name: "Asana 项目管理", description: "Asana 项目管理集成：创建/管理任务、搜索项目、更新负责人、跟踪进度，把开发流程接进 Asana" },
  "autofix-bot": { name: "自动修复机器人", description: "代码审查智能体：检测安全漏洞、质量问题与硬编码密钥；整合 5000+ 静态分析器扫描代码与依赖里的 CVE" },
  "clangd-lsp": { name: "C/C++ 语言服务", description: "C/C++ 语言服务器（clangd），提供代码智能" },
  "claude-code-setup": { name: "环境配置顾问", description: "分析你的代码库，推荐量身定制的自动化方案：钩子、技能、MCP 服务、子智能体" },
  "claude-md-management": { name: "项目记忆管理", description: "维护和改进 CLAUDE.md 文件的工具——审计质量、沉淀会话经验、保持项目记忆常新" },
  "code-review": { name: "代码审查", description: "多专用智能体自动审查 PR，带置信度评分过滤误报" },
  "code-simplifier": { name: "代码精简", description: "在保持功能不变的前提下简化和精炼代码，提升清晰度、一致性与可维护性，重点关注最近修改的代码" },
  "commit-commands": { name: "Git 提交助手", description: "git 提交流程命令集：提交、推送、创建 PR" },
  context7: { name: "Context7 文档查询", description: "Upstash Context7 MCP 服务：拉取最新版本的官方文档与代码示例，直接注入模型上下文" },
  "csharp-lsp": { name: "C# 语言服务", description: "C# 语言服务器，提供代码智能" },
  discord: { name: "Discord 消息桥", description: "Discord 消息桥（内置访问控制）：配对、白名单与策略管理走 /discord:access" },
  "explanatory-output-style": { name: "教学讲解风格", description: "回复里补充实现选择与代码库模式的讲解说明（复刻已停用的 Explanatory 输出风格）" },
  fakechat: { name: "本地测试聊天", description: "本地网页聊天，用来测试通知链路：无令牌、无访问控制、不连第三方服务" },
  "feature-dev": { name: "功能开发工作流", description: "完整的功能开发工作流：代码库探查、架构设计、质量审查各有专用智能体" },
  firebase: { name: "Firebase 集成", description: "Google Firebase MCP 集成：管理 Firestore 数据库、认证、云函数、托管与存储，在开发流程里直接搭后端" },
  "frontend-design": { name: "前端设计", description: "产出有设计感、可上线的前端界面：生成有创意、打磨过的高质量代码，避免千篇一律的 AI 味" },
  github: { name: "GitHub 官方集成", description: "GitHub 官方 MCP 服务：建 Issue、管 PR、审代码、搜仓库，直接操作 GitHub 全量 API" },
  gitlab: { name: "GitLab 集成", description: "GitLab DevOps 平台集成：管理仓库、合并请求、CI/CD 流水线、Issue 与 Wiki" },
  "gopls-lsp": { name: "Go 语言服务", description: "Go 语言服务器，代码智能与重构" },
  greptile: { name: "语义代码搜索", description: "AI 驱动的代码库搜索与理解：用自然语言查仓库、理清依赖、获得关于代码架构的答案" },
  hookify: { name: "钩子生成器", description: "轻松创建自定义钩子防止不良行为：从对话模式或显式指令提炼规则，用简单 markdown 文件定义" },
  imessage: { name: "iMessage 消息桥", description: "iMessage 消息桥（内置访问控制）：直读 chat.db、AppleScript 发送，管理走 /imessage:access（仅 macOS）" },
  "jdtls-lsp": { name: "Java 语言服务", description: "Java 语言服务器（Eclipse JDT.LS），提供代码智能" },
  "kotlin-lsp": { name: "Kotlin 语言服务", description: "Kotlin 语言服务器，提供代码智能" },
  "laravel-boost": { name: "Laravel 工具箱", description: "Laravel 开发工具箱 MCP 服务：Artisan 命令、Eloquent 查询、路由、迁移与框架专属代码生成" },
  "learning-output-style": { name: "互动学习风格", description: "互动学习模式：在关键决策点请你亲手写代码（复刻未上线的 Learning 输出风格）" },
  linear: { name: "Linear 事务跟踪", description: "Linear 事务跟踪集成：建 Issue、管项目、更新状态、跨工作区搜索" },
  "lua-lsp": { name: "Lua 语言服务", description: "Lua 语言服务器，提供代码智能" },
  "math-olympiad": { name: "竞赛数学", description: "解竞赛数学题（IMO、Putnam、USAMO）：对抗式验证抓住自我验证漏掉的问题，宁可承认不会也不硬编" },
  "mcp-server-dev": { name: "MCP 服务开发", description: "设计并构建 MCP 服务器的技能集：部署模式（远程 HTTP/MCPB/本地）、工具设计模式、鉴权与交互式 MCP 应用" },
  "php-lsp": { name: "PHP 语言服务", description: "PHP 语言服务器（Intelephense），提供代码智能" },
  playground: { name: "交互式演示页", description: "生成交互式 HTML 演示页——单文件自包含、带可视控件、实时预览与复制按钮；含设计原型、数据浏览器、概念图等模板" },
  playwright: { name: "浏览器自动化", description: "微软 Playwright MCP：操作网页、截图、填表、点击，跑端到端自动化测试" },
  "plugin-dev": { name: "插件开发套件", description: "开发插件的完整工具箱：7 个专家技能覆盖钩子、MCP、命令、智能体与最佳实践，AI 辅助创建与校验" },
  "pr-review-toolkit": { name: "PR 审查套件", description: "PR 审查智能体全家桶：专注评论、测试、错误处理、类型设计、代码质量与代码精简" },
  "pyright-lsp": { name: "Python 类型检查", description: "Python 语言服务器（Pyright），类型检查与代码智能" },
  "ralph-loop": { name: "自循环迭代", description: "交互式自引用 AI 循环（Ralph 技法）：反复做同一任务、看见自己上一轮的成果，直到完成" },
  "ruby-lsp": { name: "Ruby 语言服务", description: "Ruby 语言服务器，代码智能与分析" },
  "rust-analyzer-lsp": { name: "Rust 语言服务", description: "Rust 语言服务器（rust-analyzer），代码智能与分析" },
  "security-guidance": { name: "安全提醒", description: "编辑文件时的安全提醒钩子：命令注入、XSS、不安全代码模式都会预警" },
  serena: { name: "语义代码分析", description: "语义级代码分析 MCP 服务：智能代码理解、重构建议、跨代码库导航（基于语言服务协议）" },
  "session-report": { name: "会话用量报告", description: "从本地会话记录生成可交互的 HTML 用量报告：令牌、缓存效率、子智能体、技能与最贵的提示词" },
  "skill-creator": { name: "技能创建器", description: "创建新技能、改进现有技能、评估技能表现：从零创建、更新优化、跑评估、做基准对比" },
  "swift-lsp": { name: "Swift 语言服务", description: "Swift 语言服务器（SourceKit-LSP），提供代码智能" },
  telegram: { name: "Telegram 消息桥", description: "Telegram 消息桥（内置访问控制）：配对、白名单与策略管理走 /telegram:access" },
  terraform: { name: "Terraform 集成", description: "Terraform MCP 服务：与 Terraform 生态无缝集成，基础设施即代码（IaC）的高级自动化" },
  "typescript-lsp": { name: "TypeScript 语言服务", description: "TypeScript/JavaScript 语言服务器，增强代码智能" },
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
      const slug = text(entry.name);
      const zh = PLUGIN_ZH[slug];
      const category = text(entry.category) || "development";
      return {
        slug,
        name: slug,
        // 名称/简介：翻译表命中显示中文，未收录的回落英文原文（上游新增插件自动兜底）
        displayName: zh?.name || slug,
        description: zh?.description || (text(entry.description) || "暂无插件简介"),
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
/** 本地市场目录（安装落点 + 清单来源）——「装没装」的真相源位置，单一真相源（守卫【245】）。 */
export function codexMarketDir(codexHome: string): string {
  return path.join(codexHome, "plugins", "codex-market");
}

/**
 * 本地已装市场插件：slug → 版本。
 * ⛔⛔ 10-03：这是「装没装」的**权威真相源**（安装时写下的 `.codex-market.json`）。
 *   不能只靠引擎 `plugin/list`：引擎未认领 / id 命名不一致时它返空，
 *   UI 于是永远显示「+」——用户原话「插件安装后没有更新状态」。
 *   目录在就算已装（用户视角就是装了）；manifest 缺失时用目录名兜底。
 */
export async function listInstalledMarketPlugins(marketDir: string): Promise<Map<string, { version: string; description: string }>> {
  const out = new Map<string, { version: string; description: string }>();
  let entries: string[] = [];
  try { entries = await fs.readdir(marketDir); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    try {
      const raw = await fs.readFile(path.join(marketDir, name, ".codex-market.json"), "utf8");
      const data = JSON.parse(raw);
      out.set(String(data?.marketId ?? name), { version: String(data?.version ?? ""), description: String(data?.description ?? "") });
    } catch {
      out.set(name, { version: "", description: "" });
    }
  }
  return out;
}

export async function listMarketPlugins(input: { category?: string; query?: string; page?: number; pageSize?: number; installedDir?: string } = {}) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(30, Math.max(1, Math.floor(Number(input.pageSize) || 18)));
  let items = await loadMarketPlugins();
  if (input.category && input.category !== "全部") items = items.filter((entry) => entry.category === input.category);
  const q = input.query?.trim().toLowerCase();
  if (q) {
    items = items.filter((entry) =>
      entry.name.toLowerCase().includes(q)
      || entry.displayName.toLowerCase().includes(q)
      || entry.description.toLowerCase().includes(q)
      || entry.author.toLowerCase().includes(q)
      || (entry.categoryZh ?? "").includes(input.query!.trim()));
  }
  const total = items.length;
  const start = (page - 1) * pageSize;
  // ⛔ 10-03：逐项合并本地已装标记（见 listInstalledMarketPlugins 的注释：这是唯一可靠的真相源）
  const installedMap = input.installedDir ? await listInstalledMarketPlugins(input.installedDir) : new Map<string, { version: string; description: string }>();
  return {
    items: items.slice(start, start + pageSize).map((entry) => ({
      ...entry,
      installed: installedMap.has(entry.slug),
      installedVersion: installedMap.get(entry.slug)?.version || undefined,
    })),
    // ⛔ 全量已装清单（不分页）：渲染层要靠它把「引擎没认领、但文件已落盘」的市场插件
    //   补进「已安装」列表 —— 否则那些插件在已安装页里彻底消失，用户以为没装上。
    installedIds: [...installedMap.keys()],
    total,
    page,
    pageSize,
  };
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
 * 卸载本地市场插件的**文件部分**（10-03）：删落盘目录 + 从 marketplace 清单摘除条目。
 * 引擎那侧（plugin/uninstall）由 IPC handler 先调 —— 它认领时才能真正停用。
 *
 * ⛔ 删除是高风险动作，三道防御（任一不过就拒绝，宁可不动也不误删）：
 *   ① 目录名经 `safeFolder` 归一 —— 它把一切非 `[A-Za-z0-9._-]` 字符（含 / 与 \）剥掉，
 *      `../..` 这类输入会退化成空串并回落到固定名 `plugin`；
 *   ② 归一化后的绝对路径必须仍在市场目录**之内**且不等于它本身（防穿越兜底）；
 *   ③ `.claude-plugin` 等以点开头的目录不作为插件目录（清单文件所在，不参与删除）。
 */
export async function removeCodexMarketPluginFiles(slug: string, marketDir: string): Promise<{ ok: boolean; reason?: string }> {
  const root = path.resolve(marketDir);
  const target = path.resolve(path.join(root, safeFolder(slug)));
  if (target === root || !target.startsWith(root + path.sep) || path.basename(target).startsWith(".")) {
    return { ok: false, reason: "安装路径解析异常，已取消卸载" };
  }
  // 清单条目先摘（清单坏了也要删目录，所以各自独立 try）
  const manifestPath = path.join(root, ".claude-plugin", "marketplace.json");
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (Array.isArray(parsed?.plugins)) {
      parsed.plugins = parsed.plugins.filter((item: any) => item?.name !== path.basename(target));
      await fs.writeFile(manifestPath, JSON.stringify(parsed, null, 2), "utf8");
    }
  } catch { /* 清单缺失或已损坏：目录仍要删 */ }
  await fs.rm(target, { recursive: true, force: true });
  return { ok: true };
}

/**
 * 幂等注册本地插件 marketplace：缺 [marketplaces.codex-market] 才 append 一段
 * （source_type=local 指向插件落盘目录），让引擎 plugin/list 能扫到已装插件。
 * 该段不在 HARNESS_CONFIG_SECTIONS，harness 整份重写时会被 preserveUserConfig 原样拼回。
 */
export async function ensureCodexMarketplaceSection(codexHome: string): Promise<string> {
  const marketDir = codexMarketDir(codexHome);
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
