/**
 * codex-official-market —— **Codex 官方插件市场**（GitHub `openai/plugins`）的国内镜像读取 + 一键安装。
 *
 * 与 `codex-market.ts`（Gitee 上的 Claude Code 官方镜像，48 个）是**两个独立数据源**，刻意不合并成一个模块：
 * 清单格式、落盘目录、卸载路径、文案表都不同，混在一起改任何一边都要判另一边的回归。
 * 域前缀 = `codex-official-market`（IPC 在 `features/codex-official-market-ipc.ts`）。
 *
 * 上游实测（2026-10-03，`node scripts/gen-codex-official-catalog.mjs` 现算）：
 *   · 清单 = `.agents/plugins/marketplace.json`（name=openai-curated，**65 条**，只有 name/source/policy/category）；
 *     `.agents/plugins/api_marketplace.json` 是它的 **50 条子集**（ChatGPT 侧精选）。
 *   · **简介与显示名不在清单里**，在各插件的 `plugins/<slug>/.codex-plugin/plugin.json` ⇒ 文案走生成快照，
 *     运行时只拉 1 份清单拿活数据（分类 / 鉴权策略 / 上游新增插件）。
 *   · 62 条 `source.source="local"`（`./plugins/<slug>`，可一键安装）；3 条指向**外部仓库**
 *     （CrowdStrike 两个 git 仓库 + Qodo 的 git-subdir）⇒ 明确标「不可一键安装」，不猜怎么装。
 *   · 体积：62 个插件共 **51.13 MB**（> 50MB 内置口径 ⇒ 不随包）；单插件最多 795 个文件（zoom 5.2MB）；
 *     最大单文件 2.09MB（creative-production 的 server.bundle.mjs）。
 *   · **65 条全部要求鉴权**（ON_INSTALL 58 / ON_USE 7）⇒ 卡片必须写清「装完还要配凭据」，
 *     否则用户以为装上就能用（这是「已安装反馈」最容易骗人的一格）。
 *
 * ⛔ 镜像顺序 = gh-proxy → ghfast → 直连。前两个**连 api.github.com 都能代理**（实测 200，
 *   且用的是它自己的共享速率池、剩余 3000+，绕开未登录 60 次/小时）；直连是兜底不是首选。
 *   `git/trees?recursive=1` 全量 7,748 项 ≈ 2MB，**一次拿全并落盘缓存**（`.cache/tree.json`），
 *   装第二个插件不再打 API。
 * ⛔ 引擎侧口径照搬 codex-market 的三条实证：`marketplacePath` 传**清单文件**（传目录报 os error 5）；
 *   光写文件引擎不认，必须 `plugin/install` + 重启；「装没装」的真相源是**本地 marker**，不是引擎列表。
 */
import { net } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OFFICIAL_CATALOG_GENERATED_AT, OFFICIAL_PLUGIN_CATALOG } from "./codex-official-catalog.gen";

const GH_OWNER = "openai";
const GH_REPO = "plugins";
const GH_BRANCH = "main";
const GH_RAW_BASE = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/`;
const GH_API_TREE = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`;
const MARKET_MANIFEST = ".agents/plugins/marketplace.json";
const API_MANIFEST = ".agents/plugins/api_marketplace.json";
/** 镜像前缀（空串 = 直连）。顺序即实测可用性，改动前先确认本机还通。 */
const MIRROR_PREFIXES = ["https://gh-proxy.com/", "https://ghfast.top/", ""];
const MARKET_SOURCE_LABEL = "Codex 官方";
/** ⛔ 上限不是拍脑袋：上游 zoom 单插件就有 795 个文件，沿用 codex-market 的 300 会直接拒装 4 个合法插件 */
const MAX_FILES = 1_200;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;
/** 清单 5 分钟（列表页跟着用户点走），文件树 6 小时（2MB，只在装插件时用） */
const MANIFEST_TTL = 300_000;
const TREE_TTL = 6 * 3600_000;

export type OfficialMarketPlugin = {
  slug: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  categoryZh: string;
  /** 上游 policy.authentication：ON_INSTALL = 安装时授权，ON_USE = 首次使用时授权 */
  auth: string;
  /** 是否在 api_marketplace.json（ChatGPT 精选）里 —— 不在的那 15 个依赖 ChatGPT 应用连接器 */
  apiCurated: boolean;
  /** 仓库内插件目录（相对仓库根，如 `plugins/linear`）；外部仓库源为空 */
  pluginPath: string;
  version: string;
  license: string;
  author: string;
  homepage: string;
  sourceUrl: string;
  /** false = 源指向外部仓库，一键安装做不到（卡片要说明原因，不许让人装了才发现报错） */
  installable: boolean;
  unavailableReason?: string;
  /** 鉴权提示（写进卡片，避免「已安装 = 能用」的错觉） */
  authNote: string;
  /** 已装标记（真相源 = 本地 marker，见 listInstalledOfficialPlugins） */
  installed?: boolean;
  installedVersion?: string;
};

export type OfficialMarketProgress = { stage: "resolve" | "download" | "install" | "register"; message: string };

/** 官方清单的 10 个 category key（实测）；与 codex-market 的 CATEGORY_ZH key 集不重叠，故各留一张表 */
const OFFICIAL_CATEGORY_ZH: Record<string, string> = {
  Productivity: "效率协作",
  Communication: "沟通会议",
  Creativity: "创意设计",
  Finance: "金融支付",
  "Developer Tools": "开发工具",
  "Education & Research": "教育研究",
  Security: "安全",
  "Data & Analytics": "数据分析",
  "Business & Operations": "业务运营",
  "Scientific Research": "科研计算",
};

/**
 * 中文表（10-03 按上游 plugin.json 的真实简介逐条翻译）。上游新增插件不在表里 ⇒ 回落快照英文原文
 * （宁可显示英文也不乱翻）；补条目先跑 `node scripts/gen-codex-official-catalog.mjs` 重跑快照。
 */
const OFFICIAL_PLUGIN_ZH: Record<string, { name: string; description: string }> = {
  linear: { name: "Linear 事务管理", description: "搜索、创建、更新 Linear 的 Issue、项目与计划；起草 PRD、写进展、分析客户需求" },
  "atlassian-rovo": { name: "Atlassian Rovo", description: "快速管理 Jira 与 Confluence" },
  "google-calendar": { name: "Google 日历", description: "接入 Google 日历做排期、空闲查询、每日简报与日程管理" },
  gmail: { name: "Gmail", description: "通过已配置的 Gmail 应用连接器处理邮件" },
  slack: { name: "Slack", description: "通过已配置的 Slack 集成处理消息" },
  teams: { name: "Microsoft Teams", description: "通过已配置的 Microsoft Teams 应用连接器处理协作" },
  sharepoint: { name: "SharePoint", description: "通过已配置的 Microsoft SharePoint 应用连接器处理站点与文档" },
  "outlook-email": { name: "Outlook 邮件", description: "通过已配置的 Microsoft Outlook 应用连接器处理邮件" },
  "outlook-calendar": { name: "Outlook 日历", description: "接入 Microsoft Outlook 日历做排期、每日简报、会前准备与安全的会议改动" },
  canva: { name: "Canva 设计", description: "把 Canva 设计流程接进 Codex：对话式创建、修改与评审设计稿" },
  figma: { name: "Figma", description: "Figma 工作流：设计稿落地实现、Code Connect 模板与设计系统规则生成" },
  stripe: { name: "Stripe 支付", description: "加速支付集成开发：建商品/价格/收款链接，管理订阅、发票、退款与争议" },
  vercel: { name: "Vercel 部署", description: "构建并部署 Web 应用与智能体" },
  "game-studio": { name: "游戏工作室", description: "以引导式 2D/3D 流程、资源管线与试玩支持，设计原型并上线浏览器游戏" },
  superpowers: { name: "Superpowers 方法论", description: "一套真正可用的智能体技能框架与开发方法论：计划、TDD、调试、协作流程" },
  github: { name: "GitHub", description: "查仓库、分诊 PR 与 Issue、调试 CI，并用连接器 + CLI 混合流程发布改动" },
  circleci: { name: "CircleCI", description: "构建、测试并部署任意应用" },
  "google-drive": { name: "Google Drive", description: "以 Google Drive 为统一入口处理 Drive、Docs、Sheets、Slides" },
  notion: { name: "Notion", description: "Notion 工作流：实现计划、研究综合、会议准备与知识沉淀" },
  cloudflare: { name: "Cloudflare", description: "Cloudflare 平台插件：Workers、Wrangler、Agents SDK 精选技能 + 官方 API MCP 服务" },
  sentry: { name: "Sentry 异常监控", description: "在 Codex 里查看 Sentry 近期 Issue 与事件" },
  "build-ios-apps": { name: "iOS 应用开发", description: "iOS 开发流程：App Intents、SwiftUI 界面、应用内浏览器镜像、性能剖析与模拟器调试" },
  "build-macos-apps": { name: "macOS 应用开发", description: "用 Xcode、SwiftUI、AppKit 互操作与统一日志构建、运行、测试本地 macOS 应用" },
  "build-web-apps": { name: "Web 应用开发", description: "Web 应用开发：前端资源设计、浏览器测试、UI 组件、支付与数据库指引" },
  "build-web-data-visualization": { name: "Web 数据可视化", description: "设计、评审、实现并导出 Web 可视化：图表、地图、仪表盘、甘特、UML、滚动叙事与 WebGL" },
  "test-android-apps": { name: "Android 应用测试", description: "用模拟器流程测试 Android 应用：复现、截图、UI 检查、日志抓取与性能剖析" },
  "life-science-research": { name: "生命科学科研", description: "生命科学研究通用流程：查询路由、证据综合，可并行子智能体分析基因组学、化学与临床证据" },
  zotero: { name: "Zotero 文献管理", description: "在 Codex 里操作 Zotero：检索书库、导出 BibTeX、插入引用、导入条目" },
  expo: { name: "Expo 官方技能", description: "官方 Expo 技能：构建、部署、升级与调试 Expo 与 React Native 应用" },
  coderabbit: { name: "CodeRabbit 代码审查", description: "由 CodeRabbit 驱动的 Codex AI 代码审查" },
  remotion: { name: "Remotion 程序化视频", description: "Remotion 视频创作技能：最佳实践、动画、音频、字幕、3D 等，用 React 做程序化视频" },
  "plugin-eval": { name: "插件与技能评测", description: "在对话里评测 Codex 技能与插件：新手友好的启动命令、本地优先报告、令牌预算解释与基准对比" },
  granola: { name: "Granola 会议记录", description: "把 Granola 会议历史接入对话：按主题/人物/公司/时间检索并按会话引用出处" },
  "monday-com": { name: "monday.com", description: "monday.com AI 连接器：搜看板、建改事项与列、指派负责人、排时间线与发更新" },
  temporal: { name: "Temporal 工作流", description: "覆盖 Temporal 全生命周期：应用开发、CLI、服务端运行管理与 Temporal Cloud" },
  hyperframes: { name: "HyperFrames", description: "写 HTML 渲视频：合成、GSAP 动画、字幕、配音、音频响应视觉与网页转视频" },
  supabase: { name: "Supabase", description: "直接管理 Supabase 项目：跑 PostgreSQL SQL、改表结构、部署边缘函数、配认证与迁移" },
  "codex-security": { name: "Codex 安全", description: "Codex 安全工作流：安全扫描、分析与溯源调查" },
  "twilio-developer-kit": { name: "Twilio 开发套件", description: "为 AI 编码智能体提供 Twilio 流程知识：该用哪个 API、什么顺序、避开哪些坑（消息/语音/验证等 30+ 产品）" },
  "openai-developers": { name: "OpenAI 开发者", description: "用 OpenAI API、Agents SDK 与 ChatGPT Apps 开发，并在 Codex 里创建保存 API Key" },
  datadog: { name: "Datadog 可观测", description: "用自然语言分析、调查并处置 Datadog 遥测数据（仅 US1 客户可用）" },
  zoom: { name: "Zoom 会议洞察", description: "从 Zoom 会议中提取智能洞察" },
  "mixpanel-headless": { name: "Mixpanel 分析", description: "用 mixpanel_headless Python SDK 与 Codex 技能分析 Mixpanel 数据" },
  airtable: { name: "Airtable", description: "把 Airtable 运营数据接入对话：提问、建改记录、分析数据，作为当前工作的输入" },
  nvidia: { name: "NVIDIA 生态技能", description: "覆盖 GPU 加速、CUDA、AI 智能体、推理、机器人、Omniverse 与仿真：帮你选型、验证环境并搭工作流" },
  posthog: { name: "PostHog 产品分析", description: "让智能体直连产品分析、功能开关、实验、错误追踪、问卷与日志：问数据、建洞察、开关实验" },
  "ngs-analysis": { name: "二代测序分析", description: "引导式 NGS 接入、本地执行与公共流程路由：BCL、FASTQ、DNA 变异、RNA-seq、单细胞与表观组学" },
  shopify: { name: "Shopify 店铺", description: "像对话一样建站与管店：加商品、调库存、建折扣码、查订单、看客户与店铺分析" },
  magicpath: { name: "MagicPath UI 组件", description: "用 MagicPath 在 Codex 里查找、检视、安装、创建与编辑 UI 组件" },
  "openai-ads-conversions": { name: "OpenAI 广告度量", description: "配置 OpenAI Ads Measurement Pixel 与可选的 Conversions API 埋点" },
  "boltz-api-cli": { name: "Boltz 结构预测", description: "预测分子结构、筛查分子与蛋白、设计结合剂" },
  dropbox: { name: "Dropbox 文件", description: "把 Dropbox 文件直连对话：取文件、存生成内容、建分享链接，全程遵循既有权限" },
  "product-design": { name: "产品设计", description: "把早期想法做成可评审的原型：确认需求、探索方向、审计用户流程、从线上 URL 做原型" },
  "data-analytics": { name: "数据分析", description: "用数据回答产品与业务问题" },
  "creative-production": { name: "创意生产", description: "探索广告概念、示意图、情绪板、商品植入、社交帖与上线素材" },
  "public-equity-investing": { name: "公开股票投资", description: "上市公司研究工作流：财报分析、估值、模型更新、多空论点、催化剂与投研备忘录" },
  adobe: { name: "Adobe 创作", description: "接入 Creative Cloud 与 Acrobat：修图、做 PDF、设计社交素材、裁切视频、检索云端素材" },
  lovable: { name: "Lovable", description: "构建应用与网站" },
  clickup: { name: "ClickUp 指挥中心", description: "把 Codex 变成你的 ClickUp 指挥中心" },
  consensus: { name: "Consensus 学术检索", description: "直连 2.2 亿篇同行评审论文做检索与综合：文献综述、布尔式检索、书目与引文草稿" },
  chatcut: { name: "ChatCut 剪辑", description: "在 Codex 里安装、打开并连接已签名的 ChatCut 桌面应用" },
  higgsfield: { name: "Higgsfield 图像视频", description: "由文字或自有照片生成图像与视频：商品图转视频广告、照片风格化、静图做动画" },
  "crowdstrike-falcon-foundry": { name: "CrowdStrike Falcon Foundry", description: "CrowdStrike 官方技能仓库（源为外部 Git 仓库）" },
  "crowdstrike-falcon-fusion": { name: "CrowdStrike Falcon Fusion", description: "CrowdStrike 官方技能仓库（源为外部 Git 仓库）" },
  qodo: { name: "Qodo 测试", description: "Qodo 官方技能包（源为外部仓库子目录）" },
};

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

async function readJsonFile(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

/** 官方市场落盘根；插件在 `<root>/plugins/<slug>`、清单在 `<root>/.agents/plugins/marketplace.json`（与上游同构） */
export function codexOfficialMarketDir(codexHome: string): string {
  return path.join(codexHome, "plugins", "codex-official-market");
}
const pluginsRootOf = (marketDir: string) => path.join(marketDir, "plugins");
const treeCacheOf = (marketDir: string) => path.join(marketDir, ".cache", "tree.json");
const manifestPathOf = (marketDir: string) => path.join(marketDir, ".agents", "plugins", "marketplace.json");

/** 逐个镜像抓（codex-market 的「一次 URL + 重试」不够：这里连镜像一起换） */
async function fetchWithMirror(url: string, timeoutMs: number, tries = 3): Promise<Response> {
  let lastError: unknown;
  for (const mirror of MIRROR_PREFIXES) {
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const response = await net.fetch(`${mirror}${url}`, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "codex-harness-desktop" } });
        if (response.ok) return response;
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) { lastError = error; }
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchJsonViaMirror(url: string, timeoutMs: number): Promise<any> {
  return await (await fetchWithMirror(url, timeoutMs)).json();
}

type LiveEntry = { slug: string; category: string; auth: string; apiCurated: boolean; pluginPath: string; remoteUrl: string; displayName: string };

/** 上游 source 三态实测：local（仓库内目录，带 path）/ url / git-subdir（带 url，后两者指向外部仓库） */
function toLiveEntry(entry: any, apiCurated: boolean): LiveEntry {
  const source = entry?.source ?? {};
  const rel = text(source.path).replace(/^\.\//, "");
  return {
    slug: text(entry?.name),
    category: text(entry?.category),
    auth: text(entry?.policy?.authentication),
    apiCurated,
    pluginPath: source.source === "local" ? rel : "",
    remoteUrl: text(source.url),
    displayName: text(entry?.interface?.displayName),
  };
}

let manifestCache: { at: number; entries: LiveEntry[]; live: boolean } | null = null;

/**
 * 取上游活清单（5 分钟内存缓存）。
 * ⛔ 网络全挂时**回落到内置快照**（live=false）：官方插件列表在国内网络抖动下也能打开，
 *   UI 会如实显示「列表来自内置快照」——比整面报错强（当初换掉 codex-marketplace.com 就是这个原因）。
 */
async function loadLiveEntries(): Promise<{ entries: LiveEntry[]; live: boolean }> {
  if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL) return manifestCache;
  try {
    const manifest = await fetchJsonViaMirror(`${GH_RAW_BASE}${MARKET_MANIFEST}`, 20_000);
    const list: any[] = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
    if (!list.length) throw new Error("marketplace.json 里没有 plugins 数组（上游结构变了）");
    const apiNames = new Set<string>();
    try {
      const apiManifest = await fetchJsonViaMirror(`${GH_RAW_BASE}${API_MANIFEST}`, 20_000);
      for (const entry of apiManifest?.plugins ?? []) apiNames.add(text(entry?.name));
    } catch { /* 精选子集拿不到 ⇒ apiCurated 全 false，卡片只是少一条「依赖连接器」说明 */ }
    const entries = list.map((entry) => toLiveEntry(entry, apiNames.has(text(entry?.name)))).filter((entry) => entry.slug);
    manifestCache = { at: Date.now(), entries, live: true };
    return manifestCache;
  } catch (error: any) {
    console.warn("codex-official-market 上游清单获取失败，回落内置快照：", error?.message ?? error);
    const entries = Object.values(OFFICIAL_PLUGIN_CATALOG)
      .map((row) => toLiveEntry({ name: row.slug, category: row.category, policy: { authentication: row.auth }, source: { source: "local", path: `./${row.path}` }, interface: { displayName: row.displayName } }, row.apiCurated))
      .filter((entry) => entry.slug);
    manifestCache = { at: Date.now(), entries, live: false };
    return manifestCache;
  }
}

/** 单条 = 活数据（分类/策略/路径）+ 快照文案 + 中文表覆盖 */
function buildPlugin(entry: LiveEntry): OfficialMarketPlugin {
  const snapshot = OFFICIAL_PLUGIN_CATALOG[entry.slug];
  const zh = OFFICIAL_PLUGIN_ZH[entry.slug];
  const installable = Boolean(entry.pluginPath);
  const category = entry.category || text(snapshot?.category) || "Developer Tools";
  return {
    slug: entry.slug,
    name: entry.slug,
    displayName: zh?.name || entry.displayName || text(snapshot?.displayName) || entry.slug,
    description: zh?.description || text(snapshot?.description) || "暂无插件简介",
    category,
    categoryZh: OFFICIAL_CATEGORY_ZH[category] ?? category,
    auth: entry.auth || text(snapshot?.auth),
    apiCurated: entry.apiCurated,
    pluginPath: entry.pluginPath,
    version: text(snapshot?.version),
    license: text(snapshot?.license),
    author: "OpenAI / 第三方厂商",
    homepage: installable
      ? `https://github.com/${GH_OWNER}/${GH_REPO}/tree/${GH_BRANCH}/${entry.pluginPath}`
      : entry.remoteUrl || `https://github.com/${GH_OWNER}/${GH_REPO}`,
    sourceUrl: installable ? `https://github.com/${GH_OWNER}/${GH_REPO}` : entry.remoteUrl,
    installable,
    unavailableReason: installable ? undefined : "源指向外部仓库（不在 openai/plugins 目录内），当前只支持查看来源，不支持一键安装",
    authNote: entry.apiCurated
      ? (entry.auth === "ON_USE" ? "首次使用时需授权 / 配置服务凭据" : "安装时需授权 / 配置服务凭据")
      : "依赖 ChatGPT 应用连接器：需登录 ChatGPT 账号并配好对应连接器",
  };
}

/**
 * 本地已装官方插件：slug → {version, description}。
 * 真相源 = 安装时写下的 `.codex-official.json`（**不是**引擎 plugin/list —— 引擎没认领时它返空，
 * 于是卡片永远显示「+」，这是 codex-market 那边已经踩过的同一个坑）。
 * 只扫 `<marketDir>/plugins`；点开头目录（.cache / .agents）不参与。
 */
export async function listInstalledOfficialPlugins(marketDir: string): Promise<Map<string, { version: string; description: string }>> {
  const out = new Map<string, { version: string; description: string }>();
  const root = pluginsRootOf(marketDir);
  let entries: string[] = [];
  try { entries = await fs.readdir(root); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const data = await readJsonFile(path.join(root, name, ".codex-official.json"));
    if (data) out.set(String(data?.marketId ?? name), { version: String(data?.version ?? ""), description: String(data?.description ?? "") });
    else out.set(name, { version: "", description: "" });
  }
  return out;
}

/** 分类 tab（按源各算各的：官方源这 10 类与 Gitee 源的 7 类 key 不重叠） */
export async function listOfficialMarketCategories(): Promise<{ key: string; displayName: string; count: number }[]> {
  const { entries } = await loadLiveEntries();
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, displayName: OFFICIAL_CATEGORY_ZH[key] ?? key, count }))
    .sort((a, b) => b.count - a.count);
}

export async function listOfficialMarketPlugins(input: { category?: string; query?: string; page?: number; pageSize?: number; installedDir?: string } = {}) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(30, Math.max(1, Math.floor(Number(input.pageSize) || 18)));
  const { entries, live } = await loadLiveEntries();
  let items = entries.map(buildPlugin);
  if (input.category && input.category !== "全部") items = items.filter((item) => item.category === input.category);
  const q = input.query?.trim().toLowerCase();
  if (q) {
    items = items.filter((item) =>
      item.slug.toLowerCase().includes(q)
      || item.displayName.toLowerCase().includes(q)
      || item.description.toLowerCase().includes(q)
      || item.categoryZh.toLowerCase().includes(q)
      || item.category.toLowerCase().includes(q));
  }
  const installedMap = input.installedDir ? await listInstalledOfficialPlugins(input.installedDir) : new Map<string, { version: string; description: string }>();
  const total = items.length;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize).map((item) => ({
      ...item,
      installed: installedMap.has(item.slug),
      installedVersion: installedMap.get(item.slug)?.version || undefined,
    })),
    /** 全量已装 slug（不分页）：渲染层靠它补齐「引擎没认领、但文件已落盘」的那批 */
    installedIds: [...installedMap.keys()],
    /** false = 这次读的是内置快照（上游网络不通），UI 要如实标注 */
    live,
    catalogGeneratedAt: OFFICIAL_CATALOG_GENERATED_AT,
    total,
    page,
    pageSize,
  };
}

type FileEntry = { path: string; size: number };
type ProgressFn = (stage: OfficialMarketProgress["stage"], message: string) => void;

/**
 * 仓库全量文件树：**一次拿全 + 落盘缓存**（2MB / 7,748 项，TTL 6 小时）。
 * ⛔ 必须走镜像：未登录 GitHub 的 API 限 60 次/小时，直连很容易撞限。
 */
async function repoTree(marketDir: string, progress: ProgressFn): Promise<FileEntry[]> {
  const cachePath = treeCacheOf(marketDir);
  const cached = await readJsonFile(cachePath);
  if (cached?.at && Number(cached.at) && Date.now() - Number(cached.at) < TREE_TTL && Array.isArray(cached?.tree)) {
    return (cached.tree as any[]).filter((item) => item?.type === "blob").map((item) => ({ path: String(item.path), size: Number(item.size) || 0 }));
  }
  progress("resolve", "正在获取官方仓库文件清单（GitHub API，走国内镜像）");
  const payload = await fetchJsonViaMirror(GH_API_TREE, 60_000);
  const tree: any[] = Array.isArray(payload?.tree) ? payload.tree : [];
  if (!tree.length || payload?.truncated) throw new Error("官方仓库文件清单获取失败或被截断，请稍后重试");
  await fs.mkdir(path.dirname(cachePath), { recursive: true }).catch(() => undefined);
  await fs.writeFile(cachePath, JSON.stringify({ at: Date.now(), tree }), "utf8").catch(() => undefined);
  return tree.filter((item) => item?.type === "blob").map((item) => ({ path: String(item.path), size: Number(item.size) || 0 }));
}

type LocalManifestEntry = {
  name: string;
  source: { source: string; path: string };
  policy: { installation: string; authentication: string };
  category?: string;
};

/**
 * 维护本地市场的 `.agents/plugins/marketplace.json` —— **照上游形态写**（引擎认这份 manifest，
 * 另两种是 .claude-plugin/ 与 .cursor-plugin/）。每条
 * `{name, source:{source:"local", path:"./plugins/<slug>"}, policy, category}`。
 * 返回清单**文件**路径（`plugin/install` 的 marketplacePath 要传文件，传目录报 os error 5）。
 */
export async function upsertOfficialMarketManifest(marketDir: string, entry: LocalManifestEntry): Promise<string> {
  const manifestPath = manifestPathOf(marketDir);
  const manifest = (await readJsonFile(manifestPath)) ?? { name: "codex-official-market", interface: { displayName: MARKET_SOURCE_LABEL }, plugins: [] };
  if (!Array.isArray(manifest.plugins)) manifest.plugins = [];
  manifest.plugins = manifest.plugins.filter((item: any) => item?.name !== entry.name);
  manifest.plugins.push(entry);
  if (!manifest.name) manifest.name = "codex-official-market";
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

/** 一键安装：镜像下载 `plugins/<slug>` 子树 → 写入 `<marketDir>/plugins/<slug>` → 写 marker + 本地清单 */
export async function installOfficialMarketPlugin(input: { plugin: OfficialMarketPlugin; marketDir: string; onProgress?: (progress: OfficialMarketProgress) => void }) {
  const plugin = input.plugin;
  const progress: ProgressFn = (stage, message) => input.onProgress?.({ stage, message });
  if (!plugin?.slug || !plugin.pluginPath) throw new Error(plugin?.unavailableReason || "无效的插件条目");
  const marketDir = input.marketDir;
  progress("resolve", "正在解析官方插件清单与文件列表");
  const files = (await repoTree(marketDir, progress)).filter((file) => file.path.startsWith(`${plugin.pluginPath}/`));
  if (!files.length) throw new Error(`官方仓库里找不到插件目录「${plugin.pluginPath}」`);
  if (files.length > MAX_FILES) throw new Error(`插件文件过多（${files.length} 个），已拒绝安装`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("插件包超过 50 MB，已拒绝安装");

  // ⛔ 10-03 合并时补上（WorkBuddy 侧加的校验，引擎那份缺）：pluginPath 是**渲染层传来的字符串**，
  //   而它会被拼进临时目录里的取值路径 —— 只允许 `plugins/<slug>` 这一种上游形态
  //   （含 `..` 或以 / 开头的都拒绝）。
  //   越界拼写在下游拿不到任何文件（tree 前缀过滤）看似无害，但**路径校验不能靠"大概传不到"**。
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(plugin.pluginPath) || plugin.pluginPath.split("/").includes("..")) {
    throw new Error(`插件路径不合法：${plugin.pluginPath}`);
  }

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-harness-official-"));
  try {
    progress("download", `正在从 GitHub 镜像下载 ${files.length} 个文件（国内加速）`);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < files.length) {
        const file = files[cursor++];
        if (file.size > MAX_SINGLE_FILE_BYTES) throw new Error(`文件 ${file.path} 超过 20 MB，已拒绝安装`);
        const response = await fetchWithMirror(`${GH_RAW_BASE}${file.path}`, 60_000);
        const buffer = Buffer.from(await response.arrayBuffer());
        const dest = path.join(temp, ...file.path.split("/"));
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, buffer);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));

    const slug = safeFolder(plugin.slug);
    const target = path.join(pluginsRootOf(marketDir), slug);
    progress("install", `正在写入插件目录 plugins/${slug}`);
    await fs.mkdir(pluginsRootOf(marketDir), { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(path.join(temp, ...plugin.pluginPath.split("/")), target, { recursive: true, dereference: false });
    progress("register", "正在写入来源清单");
    const marker = {
      marketId: plugin.slug,
      sourceUrl: `https://github.com/${GH_OWNER}/${GH_REPO}/tree/${GH_BRANCH}/${plugin.pluginPath}`,
      pluginPath: plugin.pluginPath,
      version: plugin.version,
      installedAt: new Date().toISOString(),
      description: plugin.description,
      category: plugin.category,
      auth: plugin.auth,
      apiCurated: plugin.apiCurated,
    };
    await fs.writeFile(path.join(target, ".codex-official.json"), JSON.stringify(marker, null, 2), "utf8");
    const manifestPath = await upsertOfficialMarketManifest(marketDir, {
      name: slug,
      source: { source: "local", path: `./plugins/${slug}` },
      policy: { installation: "AVAILABLE", authentication: plugin.auth || "ON_INSTALL" },
      category: plugin.category,
    });
    return { id: slug, name: plugin.displayName, path: target, version: plugin.version, description: plugin.description, marketId: plugin.slug, manifestPath };
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function safeFolder(value: string) { return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "plugin"; }

/**
 * 卸载的**文件部分**：删落盘目录 + 摘本地清单条目（引擎侧由 handler 先调 plugin/uninstall）。
 * ⛔ 删除不可逆，三道防御照搬 codex-market（任一不过就拒绝，宁可不动也不误删）：
 *   ① 目录名经 safeFolder 归一（`../..` 会退化成固定名 plugin）；
 *   ② 归一后的绝对路径必须仍在 `<marketDir>/plugins` **之内**且不等于它；
 *   ③ 点开头目录不作为插件目录（.cache / .agents 不参与）。
 */
export async function removeOfficialMarketPluginFiles(slug: string, marketDir: string): Promise<{ ok: boolean; reason?: string }> {
  const root = path.resolve(pluginsRootOf(marketDir));
  const target = path.resolve(path.join(root, safeFolder(slug)));
  if (target === root || !target.startsWith(root + path.sep) || path.basename(target).startsWith(".")) {
    return { ok: false, reason: "安装路径解析异常，已取消卸载" };
  }
  const manifestPath = manifestPathOf(marketDir);
  const parsed = await readJsonFile(manifestPath);
  if (Array.isArray(parsed?.plugins)) {
    parsed.plugins = parsed.plugins.filter((item: any) => item?.name !== path.basename(target));
    await fs.writeFile(manifestPath, JSON.stringify(parsed, null, 2), "utf8").catch(() => undefined);
  }
  await fs.rm(target, { recursive: true, force: true });
  return { ok: true };
}

/**
 * 幂等注册 `[marketplaces.codex-official-market]`（缺才 append），让引擎 plugin/list 扫得到已装插件。
 * 与 codex-market 那段并存、互不影响；不在 HARNESS_CONFIG_SECTIONS 里 ⇒ harness 整份重写时
 * 由 preserveUserConfig 原样拼回。
 */
export async function ensureOfficialMarketplaceSection(codexHome: string): Promise<string> {
  const marketDir = codexOfficialMarketDir(codexHome);
  const configPath = path.join(codexHome, "config.toml");
  try {
    const existing = await fs.readFile(configPath, "utf8").catch(() => "");
    if (!/\[marketplaces\.codex-official-market\]/.test(existing)) {
      const section = [
        "[marketplaces.codex-official-market]",
        'source_type = "local"',
        `source = "${marketDir.replaceAll("\\", "/")}"`,
        "",
      ].join("\n");
      const next = existing.trim() ? `${existing.trimEnd()}\n\n${section}\n` : `${section}\n`;
      await fs.writeFile(configPath, next, "utf8");
    }
  } catch (error) {
    console.warn("seed codex-official-market marketplace section failed:", error);
  }
  return marketDir;
}
