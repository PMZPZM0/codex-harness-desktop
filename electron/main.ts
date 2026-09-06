import { Menu, Notification, app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, powerSaveBlocker, protocol, safeStorage, shell, systemPreferences } from "electron";
import os from "node:os";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { ChannelBotService, type ChannelBotConfig } from "./channel-bot";
import { CodexServer, codexBinaryPath } from "./codex-server";
import { collectMcpServerNames, extractMcpSection, preserveUserConfig } from "./config-toml";
import { deleteCustomCommand, expandCommandTemplate, listCustomCommands, readCustomCommand, saveCustomCommand } from "./commands";
import { MemoryStore, Scheduler, type MemoryCategory, type MemoryRemoteConfig } from "./harness-services";
import { PROVIDER_RETRY_TUNING } from "./provider-retry";
import { MemoryLayers } from "./memory-layers";
import { RpaStore, type RpaRecipe } from "./rpa-store";
import { TerminalService } from "./terminal";
import { RemoteControlService } from "./remote";
import QRCode from "qrcode";
import { WeixinGateway } from "./weixin-gateway";
import { TelegramGateway } from "./telegram-gateway";
import { readPersonalization, writePersonalization, applyPersonalizationToAgentsMd, buildAgentsMd } from "./personalization";
import { developerInstructionsLine } from "./developer-instructions";
import { readAppSettings, saveAppSettings, type AppSettings } from "./app-settings";
import { checkLatestUpdate, defaultDownloadDir, downloadUpdate, fileExists, installUpdate, UPDATE_CHANNEL, UPDATE_SERVER_URL } from "./updates";
import { checkEngineUpdate, performEngineUpdate } from "./engine-updater";
import {
  deleteSshServer, execSshCommand, exportSshServers, parseSshImport, readSshServers, saveSshServer, setSshServerEnabled,
  testSshConnection, writeSshServers, SshSessionManager, type SshExecResult, type SshServer, type SshTestResult,
} from "./ssh-servers";

/** 二维码 SVG（官方 qrcode 包：mask/纠错全规范实现，自研版有机读缺陷已弃用） */
function qrSvg(text: string) {
  return QRCode.toString(text, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
}
import { installCocoLoopSkill, listCocoLoopSkills, listSkillHubSkills, type InstalledMarketSkill, type MarketSkill } from "./skills-market";
import { ensureCodexMarketplaceSection, installCodexMarketPlugin, listCodexMarketPlugins, type CodexMarketPlugin } from "./codex-market";
import { augmentedPath, bundledGit, bundledNode, bundledPython, cloakCacheDir, cloakOpenHelper, nuphusBinary, npmGlobalRoot, toolchainEnv, toolsRoot } from "./toolchain";
import { ensureBuiltinSkills } from "./builtin-skills";
import { ensurePonytailPlugin } from "./ponytail-plugin";
import { getPonytailMode, setPonytailMode } from "./ponytail-mode";
import { enrichThreadWithRolloutTools, listRolloutThreads, mergeThreadList } from "./session-tools";
import { applySessionsBackup, backupFromRolloutFile, buildMarkdownExport, buildSessionsBackup, buildThreadPreview, parseMarkdownConversation, BACKUP_FORMAT, BACKUP_VERSION } from "./thread-backup";
import {
  buildDefaultExpertTeams, buildTeamSystemPrompt, buildTeamTools, normalizeTeamConfig,
  readExpertTeams, setExpertTeamsFile, writeExpertTeams, type ExpertTeamConfig, type ExpertTeamMember,
} from "./expert-teams";

protocol.registerSchemesAsPrivileged([{ scheme: "harness-image", privileges: { secure: true, supportFetchAPI: true } }]);
app.setName("Codex Harness Desktop");
app.setPath("userData", process.env.CODEX_HARNESS_USER_DATA || path.join(app.getPath("appData"), "Codex Harness Desktop"));
// 自定义 AUMID 只有在系统里有快捷方式注册它时才有意义（安装版由 electron-builder NSIS 写入）。
// 裸 electron.exe（dev/绿色启动）下设置未注册 AUMID 会让任务栏回退取 electron.exe
// 的默认原子图标、顶掉窗口图标——因此仅在打包后设置。
if (app.isPackaged) app.setAppUserModelId("com.codexharness.desktop");
if (process.env.CODEX_HARNESS_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.CODEX_HARNESS_DEBUG_PORT);
// GPU 渲染策略：全部保持 Chromium 默认（健康显卡默认就走硬件加速）。
// 曾试过 ignore-gpu-blocklist / enable-gpu-rasterization / enable-zero-copy / disable-frame-rate-limit
// 四开关强推 GPU 通道，用户实测「点击延迟明显变高」——部分显卡（黑名单/驱动弱）上强制 GPU 反而劣化交互，
// 已全部回退。仅保留启动时 GPU 功能状态日志，供掉帧/卡顿时诊断（引擎日志 grep "[gpu]"）。
void app.whenReady().then(() => {
  try {
    const gpuStatus = app.getGPUFeatureStatus();
    console.log("[gpu] feature status:", JSON.stringify(gpuStatus));
  } catch { /* 诊断日志，失败不影响启动 */ }
});

const codexHome = path.join(app.getPath("userData"), "codex-home");
const customModelFile = path.join(app.getPath("userData"), "custom-model.json");
const customModelsFile = path.join(app.getPath("userData"), "custom-models.json");
const channelBotFile = path.join(app.getPath("userData"), "channel-bot.json");
const memoryFile = path.join(app.getPath("userData"), "memory.json");
const memoryGatewayFile = path.join(app.getPath("userData"), "memory-gateway.json");
const scheduleFile = path.join(app.getPath("userData"), "scheduled-tasks.json");
const connectorsFile = path.join(app.getPath("userData"), "connectors.json");
// 专家团（Team 型专家）：团队定义 + 内置示例首次启动写入
const expertTeamsFile = path.join(app.getPath("userData"), "expert-teams.json");
setExpertTeamsFile(expertTeamsFile);
void (async () => {
  try {
    const existing = await readExpertTeams();
    if (!existing.length) await writeExpertTeams(buildDefaultExpertTeams());
  } catch { /* 忽略初始化失败 */ }
})();
// 引擎直管的 MCP 服务器（如内置 nuphus）不在 connectors 列表里，单独存一份 名字 -> 是否启用
const mcpOverridesFile = path.join(app.getPath("userData"), "mcp-server-overrides.json");
// 剪贴板/临时图片持久化目录：userData 不会被系统重启清理，避免缩略图重启后破图
const imagesDir = path.join(app.getPath("userData"), "images");
// 1x1 透明 PNG（base64），图片文件缺失时的兜底响应
const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
function placeholderPngResponse(): Response {
  return new Response(Buffer.from(PLACEHOLDER_PNG_B64, "base64"), {
    headers: { "content-type": "image/png" },
  });
}
const server = new CodexServer(codexHome);
const engineActiveTurnIds = new Set<string>();
// 记忆捕获：turnId → { user, assistant, cwd }；threadId → cwd（thread/start 响应与 settings/updated 维护）
const captureBuffers = new Map<string, { user: string; assistant: string; cwd?: string }>();
const threadCwd = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;
function sendToWindow(channel: string, payload: unknown) {
  // 退出时窗口可能已销毁，?. 挡不住 destroyed 的 webContents，必须显式判活
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}
const terminals = new Map<string, TerminalService>();
function terminalFor(id: string) {
  let service = terminals.get(id);
  if (!service) {
    service = new TerminalService();
    service.onData((data) => sendToWindow("terminal:data", { id, data }));
    terminals.set(id, service);
  }
  return service;
}
/** 引擎流式事件 → 手机对话页转发器（remote.ts 的 onThreadEvent 注册） */
const remoteEventForwarders: ((event: { threadId: string; kind: string; text: string }) => void)[] = [];

const remote = new RemoteControlService({
  getStatus: () => "idle",
  storageFile: path.join(app.getPath("userData"), "remote-sessions.json"),
  onDeviceConnected: (device) => { try { mainWindow?.webContents.send("remote:device", device); } catch { /* ignore */ } },
  onCommand: (command, device) => { try { mainWindow?.webContents.send("remote:command", { command, device }); } catch { /* ignore */ } },
  // 手机对话 UI 的引擎桥：选会话 / 新建会话 / 发消息 / 实时收流式回复
  listThreads: async () => {
    const result = await server.request("thread/list", { limit: 30, sortKey: "updated_at", sortDirection: "desc", archived: false }) as any;
    return (result.data ?? []).map((entry: any) => ({ id: entry.id, name: entry.name ?? null, preview: entry.preview ?? "", updatedAt: entry.updatedAt ?? 0 }));
  },
  getThreadMessages: async (threadId) => {
    const resumed = await server.request("thread/resume", { threadId, excludeTurns: false }) as any;
    const messages: { role: "user" | "assistant" | "system"; text: string }[] = [];
    for (const turn of resumed.thread?.turns ?? []) {
      for (const item of turn.items ?? []) {
        if (item.type === "userMessage") messages.push({ role: "user", text: (item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") });
        else if (item.type === "agentMessage" && item.text?.trim()) messages.push({ role: "assistant", text: item.text });
      }
    }
    return messages;
  },
  newThread: async () => {
    const model = await readCustomModel();
    if (!model) throw new Error("尚未配置自定义模型");
    const apiKey = model.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(model.encryptedKey, "base64")) : "";
    server.setApiKey(apiKey);
    const started = await server.request("thread/start", {
      model: model.model,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      modelProvider: model.provider,
    }) as any;
    return { id: started.thread.id };
  },
  sendMessage: async (threadId, text) => {
    const model = await readCustomModel();
    await server.request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }], model: model?.model, effort: "high" });
  },
  onThreadEvent: (listener) => {
    remoteEventForwarders.push(listener);
    return () => { const index = remoteEventForwarders.indexOf(listener); if (index >= 0) remoteEventForwarders.splice(index, 1); };
  },
});
const rpaFile = path.join(app.getPath("userData"), "rpa-recipes.json");
const taskListFile = path.join(app.getPath("userData"), "task-list.json");
const rpaStore = new RpaStore(rpaFile, taskListFile);
const memoryStore = new MemoryStore(memoryFile);
const memoryLayers = new MemoryLayers(app.getPath("userData"));
// 自动捕获的出口接到 L2 日志层：从此对话原文不再进检索池
memoryStore.setLayers(memoryLayers);
/** 主进程内部会话（记忆蒸馏等）：其事件不参与记忆捕获与远程转发，否则蒸馏输出会被当成对话写回日志 */
const internalThreads = new Set<string>();
const scheduler = new Scheduler(scheduleFile, server, async () => {
  const model = await readCustomModel();
  return model ? { model: model.model, provider: model.provider, name: model.name, baseUrl: model.baseUrl } : null;
}, (message) => sendToWindow("harness:event", { type: "scheduler", message, at: Date.now() }));

/** 供应商下的单个模型配置（图二弹窗编辑的字段） */
type ProviderModel = {
  id: string;
  /** 是否加入该供应商的可用模型列表；旧配置缺失时按 true 迁移。 */
  enabled?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputTypes?: ("text" | "image" | "video")[];
  outputTypes?: ("text" | "image" | "video")[];
  /** 该模型支持的思考档位（按声明顺序）；缺省走默认三档 low/medium/high。
   *   GPT 系等模型支持 minimal/xhigh/ultra 更多档位，在这里显式声明后引擎才认。 */
  efforts?: string[];
};

type CustomModelFile = {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  contextWindow: number;
  wireApi?: "responses" | "chat";
  encryptedKey?: string;
  /** 该供应商下已保存的模型列表，model 是其中当前生效的那个 */
  models?: ProviderModel[];
  /** 启用状态；禁用时若为当前供应商则清空当前配置 */
  enabled?: boolean;
};

type StoredChannelBot = Omit<ChannelBotConfig, "appSecret" | "verificationToken" | "encryptKey"> & {
  encryptedAppSecret?: string;
  encryptedVerificationToken?: string;
  encryptedEncryptKey?: string;
};
type StoredMemoryGateway = Omit<MemoryRemoteConfig, "apiKey"> & { encryptedApiKey?: string };
type ConnectorTransport = "stdio" | "streamable_http";
type ConnectorConfig = {
  id: string;
  name: string;
  transport: ConnectorTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
  env?: Record<string, string>;
  encryptedSecrets?: Record<string, string>;
  oauth?: { status: "connected"; provider: string; authorizedAt: number; accountHint?: string };
  // 停用的连接器不写入引擎 config.toml（等效于引擎看不到该 MCP），配置本身保留
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
};
type PublicConnectorConfig = Omit<ConnectorConfig, "headers" | "envHttpHeaders" | "env" | "encryptedSecrets"> & { hasSecrets: boolean; headerKeys: string[]; envKeys: string[]; envHttpHeaderKeys: string[] };

/** 内置连接器模板：把官方/社区 MCP 服务的真实配置固化成可填表模板 */
type ConnectorTemplateField = {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  hint?: string;
  envVar?: string; // stdio 模板：字段经此环境变量传给 MCP server（secret 字段走加密注入）
  tokenFor?: string; // HTTP 模板：该字段的值作为指定 envHttpHeaders 的 secret
  optional?: boolean;
};
type ConnectorOAuthKind = "lark-login" | "http-code";
type ConnectorOAuthSpec = {
  kind: ConnectorOAuthKind;
  port: number; // 本地回调/授权监听端口（与开发后台配置的 redirect_uri 对应）
  credentialKeys: string[]; // 表单字段里作为客户端凭据的 key
  redirectUri?: string; // 固定回调地址；缺省用 http://127.0.0.1:{port}/callback
  authorizeUrl?: string; // http-code：授权页 URL 模板（{client_id}/{redirect_uri}/{state} 占位）
  tokenUrl?: string; // http-code：code 换 token 接口
  tokenMethod?: "GET" | "POST";
  tokenParams?: Record<string, string>; // 附加请求参数（grant_type 等）
  tokenResult?: { accessToken: string; refreshToken?: string; userId?: string }; // 响应字段映射
  scopes?: string; // lark-login 的 scope
  note?: string; // 该服务商授权注意事项（提示用户）
};
type ConnectorTemplate = {
  id: string;
  name: string;
  vendor: string;
  summary: string;
  helpUrl: string;
  transport: "stdio" | "streamable_http";
  command?: string;
  args?: string[]; // 支持 {field} 占位符
  url?: string; // 支持 {field} 占位符
  envHttpHeaders?: Record<string, string>; // header 名 -> 环境变量名（密钥经 connectorEnv 注入）
  env: Record<string, string>; // 明文字段里的默认 env
  fields: ConnectorTemplateField[];
  oauth?: ConnectorOAuthSpec; // OAuth 授权流程（跳转官方授权页，授权完成即连接）
  oauthNote?: string; // 授权注意事项（展示在弹窗）
};
const BUILTIN_CONNECTOR_TEMPLATES: ConnectorTemplate[] = [
  {
    id: "feishu", name: "飞书", vendor: "官方 Larksuite MCP", transport: "stdio",
    summary: "即时通讯、日历、云文档、多维表格、知识库、审批、OKR 等全产品能力",
    helpUrl: "https://open.feishu.cn/app",
    command: "npx",
    args: ["-y", "@larksuiteoapi/lark-mcp", "mcp", "-a", "{app_id}", "-s", "{app_secret}", "--token-mode", "tenant_access_token"],
    env: {},
    fields: [
      { key: "app_id", label: "App ID", placeholder: "cli_xxxxxxxx", hint: "飞书开发者后台创建自建应用后，在「凭证与基础信息」页获取" },
      { key: "app_secret", label: "App Secret", placeholder: "应用密钥", secret: true, hint: "同页获取；仅保存在本机，加密后写入引擎配置" },
    ],
    oauth: { kind: "lark-login", port: 3000, credentialKeys: ["app_id", "app_secret"], scopes: "offline_access" },
    oauthNote: "授权前请在飞书开发者后台为应用配置重定向 URL：http://localhost:3000/callback，并开启「刷新 user_access_token」开关；授权后 MCP 将以你的用户身份（user_access_token）调用接口，token 过期自动刷新。",
  },
  {
    id: "dingtalk", name: "钉钉", vendor: "官方 DingTalk MCP", transport: "stdio",
    summary: "通讯录、群聊与机器人、日历、待办、OA 审批、AI 表格、DING 消息等",
    helpUrl: "https://open.dingtalk.com",
    command: "npx",
    args: ["-y", "dingtalk-mcp@latest"],
    env: { ACTIVE_PROFILES: "ALL" },
    fields: [
      { key: "client_id", label: "Client ID (AppKey)", placeholder: "钉钉应用 AppKey", envVar: "DINGTALK_Client_ID", hint: "钉钉开放平台创建企业内部应用后，在「凭证与基础信息」获取" },
      { key: "client_secret", label: "Client Secret (AppSecret)", placeholder: "应用密钥", secret: true, envVar: "DINGTALK_Client_Secret", hint: "同页获取；加密保存" },
      { key: "agent_id", label: "AgentId", placeholder: "可选", optional: true, envVar: "DINGTALK_AgentId", hint: "如需发送工作通知才需要；留空则跳过" },
    ],
    oauth: {
      kind: "http-code", port: 8765, credentialKeys: ["client_id", "client_secret"],
      authorizeUrl: "https://login.dingtalk.com/oauth2/auth?redirect_uri={redirect_uri}&response_type=code&client_id={client_id}&scope=openid&state={state}&prompt=consent",
      tokenUrl: "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
      tokenMethod: "POST",
      tokenParams: { grantType: "authorization_code" },
      tokenResult: { accessToken: "accessToken", refreshToken: "refreshToken" },
      note: "请在钉钉开放平台应用「安全设置」配置回调域名 http://localhost:8765；授权后以你的钉钉账号身份获取用户令牌（官方 MCP 目前以应用身份调用，用户令牌先加密保存备用）。",
    },
    oauthNote: "点「授权连接」会打开钉钉扫码授权页，扫码同意后自动换取并保存用户令牌。",
  },
  {
    id: "tencent-docs", name: "腾讯文档", vendor: "官方腾讯文档 MCP", transport: "streamable_http",
    summary: "创建/编辑在线文档、表格、幻灯片，查询与整理内容",
    helpUrl: "https://docs.qq.com/open/auth/mcp.html",
    url: "https://docs.qq.com/openapi/mcp",
    env: {},
    envHttpHeaders: { Authorization: "TENCENT_DOCS_TOKEN" },
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "应用审核通过后分配", hint: "登录腾讯文档开放合作平台创建第三方应用，审核通过后获得" },
      { key: "client_secret", label: "Client Secret", placeholder: "应用密钥", secret: true, hint: "同页获取；加密保存" },
      { key: "redirect_uri", label: "回调地址", placeholder: "http://127.0.0.1:8766/callback", optional: true, hint: "默认本机 8766；腾讯文档要求 HTTPS 回调，被拦截时用内网穿透转发到本机 8766 并在此填公网地址" },
      { key: "token", label: "个人访问 Token", placeholder: "docs.qq.com 开放平台签发", optional: true, secret: true, tokenFor: "TENCENT_DOCS_TOKEN", hint: "访问 https://docs.qq.com/open/auth/mcp.html 领取，供官方 MCP 端点使用" },
    ],
    oauth: {
      kind: "http-code", port: 8766, credentialKeys: ["client_id", "client_secret"],
      authorizeUrl: "https://docs.qq.com/oauth/v2/authorize?client_id={client_id}&redirect_uri={redirect_uri}&new_login=1&response_type=code&scope=all&state={state}",
      tokenUrl: "https://docs.qq.com/oauth/v2/token",
      tokenMethod: "GET",
      tokenParams: { grant_type: "authorization_code" },
      tokenResult: { accessToken: "access_token", refreshToken: "refresh_token", userId: "user_id" },
      note: "腾讯文档要求 HTTPS 回调地址；本地 127.0.0.1 可能被拦截，需用内网穿透把公网 HTTPS 转发到本机 8766 端口并填入上方回调地址。OAuth 令牌用于 OpenAPI（Client ID + Open ID + Token 三元组），官方 MCP 端点仍用个人 Token。",
    },
    oauthNote: "点「授权连接」会跳转腾讯文档授权页，登录同意后自动换取令牌并加密保存。",
  },
  {
    id: "tdx", name: "通达信选股", vendor: "MCP 行情 · 需自备数据地址", transport: "streamable_http",
    summary: "股票行情、条件选股、研究报告、公告与宏观信息（依赖可达的 MCP 端点）",
    helpUrl: "https://github.com/adambbhe/TDX-finance-mcp-plugin-v3",
    url: "https://{endpoint}",
    env: {},
    envHttpHeaders: { Authorization: "TDX_API_TOKEN" },
    fields: [
      { key: "endpoint", label: "MCP 服务地址", placeholder: "https://tdxhub.example.com", hint: "通达信无官方 MCP，请填可达的 MCP 端点；本地方案可改用「添加 MCP」手动配置" },
      { key: "token", label: "API Token", placeholder: "可选", optional: true, secret: true, tokenFor: "TDX_API_TOKEN", hint: "服务商签发的令牌；无鉴权可留空" },
    ],
  },
];

const channelLogs: { at: number; level: "info" | "error"; message: string }[] = [];
const channelBot = new ChannelBotService(
  server,
  path.join(app.getPath("userData"), "channel-bindings.json"),
  async () => {
    const model = await readCustomModel();
    return model ? { provider: model.provider, name: model.name, model: model.model, baseUrl: model.baseUrl } : null;
  },
  (level, message) => {
    channelLogs.push({ at: Date.now(), level, message });
    if (channelLogs.length > 50) channelLogs.shift();
    sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
  },
);

async function readCustomModel(): Promise<CustomModelFile | null> {
  try {
    return JSON.parse(await fs.readFile(customModelFile, "utf8"));
  } catch (error: any) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readCustomModels(): Promise<CustomModelFile[]> {
  try {
    const list: CustomModelFile[] = JSON.parse(await fs.readFile(customModelsFile, "utf8"));
    return list.map(normalizeProvider);
  } catch { return []; }
}

async function writeCustomModels(list: CustomModelFile[]) {
  await fs.writeFile(customModelsFile, JSON.stringify(list, null, 2), "utf8");
}

async function upsertCustomModel(value: CustomModelFile) {
  const list = await readCustomModels();
  const index = list.findIndex((entry) => entry.provider === value.provider);
  if (index >= 0) list[index] = value; else list.push(value);
  await writeCustomModels(list);
}

/** 老版本 models 是 string[]，统一迁移成 ProviderModel[]；并确保生效 model 在列表里 */
function normalizeProvider(entry: CustomModelFile): CustomModelFile {
  const models = (entry.models ?? []).map((raw: any): ProviderModel => typeof raw === "string" ? { id: raw, contextWindow: entry.contextWindow, enabled: true } : { ...raw, enabled: raw?.enabled !== false }).filter((m) => m && typeof m.id === "string" && m.id);
  if (entry.model && !models.some((m) => m.id === entry.model)) models.unshift({ id: entry.model, contextWindow: entry.contextWindow, enabled: true });
  return { ...entry, models };
}

/** 合并去重保序，model 始终在列表最前 */
function withModels(entry: CustomModelFile, extra?: string): CustomModelFile {
  const normalized = normalizeProvider(entry);
  if (extra) {
    const existing = normalized.models ?? [];
    if (!existing.some((m) => m.id === extra)) {
      const cloned = [...existing];
      cloned.unshift({ id: extra, contextWindow: entry.contextWindow });
      return { ...normalized, models: cloned };
    }
  }
  return normalized;
}

/**
 * 拆出「用户自己管的配置」+「用户手工写的 MCP 段」。
 * mcp_servers 永远不进 preserved：harness 自己会重新生成连接器与内置 nuphus，
 * 用户手工写的那些则由覆盖表决定是否原样拼回（并顺手把原文记进覆盖表）。
 */
async function readUserConfigSplit(ownedMcpServers: Set<string>, overrides: McpOverrides) {
  let raw = "";
  try { raw = await fs.readFile(path.join(codexHome, "config.toml"), "utf8"); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  const kept = preserveUserConfig(raw);
  const found: Record<string, string> = {};
  for (const name of new Set([...collectMcpServerNames(raw), ...Object.keys(overrides)])) {
    if (ownedMcpServers.has(name)) continue;
    const text = extractMcpSection(raw, name) || overrides[name]?.toml || "";
    if (!text) { delete overrides[name]; continue; } // 原文已丢且没存档，清掉这条死记录
    overrides[name] = { enabled: overrides[name]?.enabled !== false, toml: text, permissions: overrides[name]?.permissions };
    if (overrides[name].enabled) found[name] = text;
  }
  return { kept, mcpExtra: Object.values(found) };
}


/** 引擎健康看门狗开关同步：按 app-settings.json 的 engineWatchdog（默认开）启停 */
async function syncEngineWatchdog() {
  const settings = await readAppSettings(app.getPath("userData"));
  if (settings.engineWatchdog !== false) server.startWatchdog();
  else server.stopWatchdog();
}

/**
 * 为当前供应商的所有模型生成 model_catalog.json。
 *
 * 背景：Codex 引擎对「不在内置目录里的自定义模型」会用 fallback 元数据（上下文 ~121K）。
 * 引擎支持 model_catalog_json 指向一个自定义模型目录 JSON，加载后引擎认识这些模型
 * （实测 0.150.1 接受精简格式，Unknown model 警告消失）。
 *
 * ⚠️ 早期注释曾写「config.toml 顶层的 model_context_window 会被引擎无视」—— 该结论对当前
 * 引擎版本**不成立**：引擎实际使用的就是顶层那个值（UI 显示的 12.8 万正是它，与 catalog
 * 里写的 1M 不一致时以顶层为准）。故顶层与 catalog 两处必须用同一个值，
 * 见 applyCustomModel 里的 effectiveContextWindow。
 *
 * 这里为供应商下每个模型生成一条 catalog 记录，contextWindow 取模型自己的
 * contextWindow（缺省用供应商级 entry.contextWindow）。
 */
const modelCatalogFile = path.join(codexHome, "model-catalog.json");

function buildModelCatalog(entry: CustomModelFile) {
  const models = (normalizeProvider(entry).models ?? []).filter((model) => model.enabled !== false);
  const fallbackWindow = entry.contextWindow ?? 128000;
  // 只收「有明确 contextWindow」的模型，其余交给引擎默认；把生效 model 放最前
  const ordered = entry.model && models.some((m) => m.id === entry.model)
    ? [models.find((m) => m.id === entry.model)!, ...models.filter((m) => m.id !== entry.model)]
    : models;
  const seen = new Set<string>();
  const catalogModels = [];
  for (const m of ordered) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const contextWindow = m.contextWindow ?? fallbackWindow;
    if (!contextWindow) continue;
    // 该模型显式声明的思考档位（GPT 系可声明 minimal/xhigh/ultra 等）；未声明默认全档位——
    // 复刻 ZCode：思考等级下拉选什么都能用，用户无需理解"档位声明"；显式勾选用于收窄。
    // 引擎按 catalog 的 supported_reasoning_levels 校验 effort，UI 也按它显示选项，
    // 两处必须同源——只在这里收口，UI 从 catalog 读。
    const efforts = (m.efforts ?? ["minimal", "low", "medium", "high", "xhigh", "ultra"]).filter((effort): effort is string => typeof effort === "string" && ["minimal", "low", "medium", "high", "xhigh", "ultra"].includes(effort));
    const effortDescriptions: Record<string, string> = {
      minimal: "Minimal reasoning, fastest responses",
      low: "Fast responses with lighter reasoning",
      medium: "Greater reasoning depth",
      high: "Deep reasoning",
      xhigh: "Very deep reasoning, slower responses",
      ultra: "Maximum reasoning depth",
    };
    catalogModels.push({
      slug: m.id,
      display_name: m.id,
      description: `${entry.name} · custom model`,
      default_reasoning_level: efforts.includes("medium") ? "medium" : (efforts.at(-1) ?? "medium"),
      supported_reasoning_levels: efforts.map((effort) => ({ effort, description: effortDescriptions[effort] ?? effort })),
      context_window: contextWindow,
      max_context_window: contextWindow,
      effective_context_window_percent: 100,
      supports_parallel_tool_calls: false,
      supports_image_detail_original: (m.inputTypes ?? []).includes("image") || (m.outputTypes ?? []).includes("image"),
      input_modalities: (m.inputTypes ?? ["text"]).includes("image") ? ["text", "image"] : ["text"],
      shell_type: "default",
      visibility: "list",
      supported_in_api: true,
      priority: 1,
      base_instructions: "",
      support_verbosity: false,
      supports_reasoning_summaries: false,
      experimental_supported_tools: [],
      truncation_policy: { mode: "bytes", limit: 10000 },
    });
  }
  return { models: catalogModels };
}

/** 把模型 catalog 写进 codex-home/model-catalog.json，返回其 TOML 配置行（无模型则空）。
 * 合并所有已保存供应商的模型（含禁用）：历史线程引用禁用供应商的模型时引擎也要能
 * 认出它——禁用只影响下拉新增可选，不影响旧会话继续使用。当前生效供应商排最前，同名去重保留靠前者。 */
async function writeModelCatalogToml(entry: CustomModelFile): Promise<string> {
  const savedProviders = await readCustomModels();
  const providers = [entry, ...savedProviders.filter((candidate) => candidate.provider !== entry.provider)];
  const seen = new Set<string>();
  const models = providers.flatMap((candidate) => buildModelCatalog(candidate).models).filter((m) => !seen.has(m.slug) && seen.add(m.slug));
  if (!models.length) return "";
  await fs.writeFile(modelCatalogFile, JSON.stringify({ models }, null, 2), "utf8");
  return `model_catalog_json = "${escapeToml(modelCatalogFile)}"`;
}

/** 把某个供应商配置写进 codex-home/config.toml 并重启 Codex 服务 */
async function applyCustomModel(entry: CustomModelFile) {
  const connectors = await readConnectors();
  const mcpOverrides = await readMcpOverrides();
  const appSettings = await readAppSettings(app.getPath("userData"));
  // 自动化开关（设置页「常规」可切）：桌面=nuphus MCP，浏览器=playwright/cloakbrowser 指令 + browser_use
  const desktopAuto = appSettings.desktopAutomation !== false;
  const browserAuto = appSettings.browserAutomation !== false;
  // 内置媒体插件（生图/视觉）：配置并启用后向 developer_instructions 注入命令行用法，
  // 引擎（所有会话，含老会话）由此「看见」并真实调用 harness-media.mjs。
  const builtinPlugins = await readBuiltinPlugins();
  const imagePluginOn = Boolean(builtinPlugins.image?.enabled !== false && builtinPlugins.image?.baseUrl && builtinPlugins.image?.apiKey && builtinPlugins.image?.model);
  const visionPluginOn = Boolean(builtinPlugins.vision?.enabled !== false && builtinPlugins.vision?.baseUrl && builtinPlugins.vision?.apiKey && builtinPlugins.vision?.model);
  const bundledNodePath = bundledNode();
  const mediaHelper = path.join(toolsRoot(), "harness-media.mjs");
  const mediaCommand = bundledNodePath
    ? `"${bundledNodePath}" "${mediaHelper}"`
    : `node "${mediaHelper}"`;
  // 内置 nuphus 与所有连接器都由 harness 重新生成，用户手工写的 MCP 段交给覆盖表
  const ownedMcpServers = new Set(["nuphus", ...connectors.map((connector) => safeConnectorId(connector.id))]);
  const { kept: preservedConfig, mcpExtra } = await readUserConfigSplit(ownedMcpServers, mcpOverrides);
  await writeMcpOverrides(mcpOverrides);
  server.setExternalEnv(connectorEnv(connectors));
  // 自定义模型目录：让引擎认识非内置模型，用 catalog 里的 context_window（否则 fallback ~121K，
  // 用户设置的 1M 上下文不生效）。无模型时返回空串不写该行。
  const catalogToml = await writeModelCatalogToml(entry);
  // 顶层 model_context_window 才是引擎真正使用的上下文上限。必须取「当前生效模型自己」的
  // contextWindow —— 用户在模型编辑器里改的 1M 存在 entry.models[].contextWindow，
  // 而 entry.contextWindow 只是供应商级默认值（128000）。写默认值会让用户设的 1M 完全不生效，
  // 表现为 UI 一直显示 12.8 万。与 buildModelCatalog 的取值口径保持一致。
  const currentCatalogModel = (normalizeProvider(entry).models ?? []).find((m) => m.id === entry.model);
  const effectiveContextWindow = currentCatalogModel?.contextWindow ?? entry.contextWindow ?? 128000;
  const savedProviders = await readCustomModels();
  // 全部已保存供应商都写进引擎配置（含禁用的）：旧线程的 rollout 里记录着创建时的
  // model_provider，抹掉 provider 段会让这些历史会话 resume 直接失败
  // （"Model provider `X` not found"→ 表现为归档/恢复后内容全空）。禁用只影响下拉可选。
  const providerEntries = [entry, ...savedProviders.filter((candidate) => candidate.provider !== entry.provider)];
  const providerToml = providerEntries.flatMap((provider, index) => {
    const normalized = normalizeProvider(provider);
    const context = normalized.models?.find((model) => model.id === normalized.model)?.contextWindow ?? normalized.contextWindow ?? 128000;
    return [
      ...(index ? [""] : []),
      `[model_providers.${escapeToml(normalized.provider)}]`,
      `name = "${escapeToml(normalized.name)}"`,
      `base_url = "${escapeToml(normalized.baseUrl)}"`,
      'env_key = "CODEX_HARNESS_API_KEY"',
      `wire_api = "${normalized.wireApi === "chat" ? "chat" : "responses"}"`,
      "requires_openai_auth = false",
      // 429 限流防御（已用真实 app-server 探针实证，见 scripts/probe-provider-retries.cjs）：
      // request_max_retries=10 HTTP 请求失败（含 429）最多重试 10 次；
      // stream_max_retries=10 SSE 流断开重连最多 10 次；
      // stream_idle_timeout_ms=600000 流空闲判定超时从默认 5 分钟放长到 10 分钟。
      // 写在每个 provider 段内 → 不管什么模型都必须生效。
      "request_max_retries = 10",
      "stream_max_retries = 10",
      "stream_idle_timeout_ms = 600000",
      `model_auto_compact_token_limit = ${Math.round(context * (appSettings.autoCompactRatio ?? 0.8))}`,
      'model_auto_compact_token_limit_scope = "model"',
    ];
  });
  // 自动化三件套不再注册为 MCP 常驻服务器：35 个工具 schema 会把每轮 prompt 撑大十几 KB，
  // 拖慢所有对话。改为按需命令行调用（nuphus-call / playwright-cli / cloakbrowser，
  // 用法见 developer_instructions），工具能力不变，上下文零占用。
  await fs.writeFile(path.join(codexHome, "config.toml"), [
    `model = "${escapeToml(entry.model)}"`,
    `model_context_window = ${effectiveContextWindow}`,
    `model_provider = "${escapeToml(entry.provider)}"`,
    ...(catalogToml ? [catalogToml] : []),
    // 完全自主工程模式 + 已装自动化工具使用说明（个性化走 $CODEX_HOME/AGENTS.md 原生机制）。
    // 桌面/浏览器自动化开关关掉时，对应段说明不注入，模型不会被引导去调用它们。
    // 生图/视觉插件配置后才注入对应段——引擎据此知道能力存在并通过命令行真实调用。
    developerInstructionsLine({ desktop: desktopAuto, browser: browserAuto, imagePlugin: imagePluginOn, visionPlugin: visionPluginOn, mediaCommand }),
    ...connectorToml(connectors),
    ...providerToml,
    "",
    // Windows 原生沙箱：elevated 模式需要一次性管理员安装（建沙箱用户/防火墙规则），
    // harness 静默 spawn 装不了，会导致所有 exec_command "blocked by policy"。
    // unelevated 用受限令牌，无需安装，是官方兜底。
    "[windows]",
    'sandbox = "unelevated"',
    "",
    // 联网工具开关：web_search 是 Responses API 服务端搜索工具，每轮 prompt 都带上；
    // 关掉能省掉模型「顺手联网」的往返（设置页「联网搜索」开关可切）。
    // workspace-write 沙箱网络访问保持开启（模型仍可用 curl/pip 自行联网，不依赖该开关）。
    "[tools]",
    `web_search = ${appSettings.webSearch === false ? "false" : "true"}`,
    "",
    // 关闭 otel/feedback 遥测写出：OtelExporterKind 的 "none" 会停掉 spans 的本地落库
    // （logs_*.sqlite 里那些 Reloading auth / remote control 噪音）。本机是 API key 模式，
    // 不需要 OpenTelemetry 导出，纯本地日志保留在引擎自有 feedback log 里够用了。
    "[otel]",
    'exporter = "none"',
    "",
    "[sandbox_workspace_write]",
    "network_access = true",
    "",
    // Codex 会按 shell_environment_policy 重新构造每次工具调用的环境；显式覆盖 PATH，
    // 防止 WindowsApps 的 0 字节 python.exe 占位符抢在应用内置 Python 前面。
    "[shell_environment_policy]",
    'inherit = "all"',
    "ignore_default_excludes = true",
    "",
    "[shell_environment_policy.set]",
    `PATH = "${escapeToml(augmentedPath())}"`,
    ...(bundledPython() ? [
      `PYTHON = "${escapeToml(bundledPython())}"`,
      `PYTHON_EXECUTABLE = "${escapeToml(bundledPython())}"`,
      `PYTHONHOME = "${escapeToml(path.dirname(bundledPython()))}"`,
    ] : []),
    "",
    // 内置浏览器 = CloakBrowser 指纹浏览器（见 developer_instructions 的浏览器能力段）。
    // 浏览器自动化开关关掉后不开启 features.browser_use，模型不再被引导操作浏览器。
    ...(browserAuto ? [
      "[features]",
      "browser_use = true",
      "",
    ] : []),
    // 各 MCP 服务器的按工具权限规则（deny/ask/allow），复刻 WorkBuddy 工具级权限模型。
    // 引擎用 [permissions.allow/ask/deny] + `mcp__server__tool` 命名约定原生表达；
    // 无规则时这一段为空，不产生任何影响。
    ...permissionsToml(mcpOverrides),
    // 内置桌面自动化 MCP：受覆盖表 + 桌面自动化开关双重控制，任一关闭则整段不写入。
    // 全量注册 35 个工具，schema 虽占 ~10k 前缀，但作为 prompt 常量前缀可被上游缓存，
    // 引擎工具列表完整暴露 desktop_*/browser_*，能力不阉割。
    ...(desktopAuto && nuphusBinary() && mcpOverrideEnabled(mcpOverrides, "nuphus") ? [
      "[mcp_servers.nuphus]",
      `command = "${escapeToml(nuphusBinary())}"`,
      "args = []",
      "startup_timeout_sec = 20",
      "",
    ] : []),
    // 用户手工写进 config.toml 的 MCP 段：启用中的原样拼回，停用的保留原文但不输出
    ...mcpExtra.flatMap((section) => [section, ""]),
    // 用户自行管理的段落（projects / marketplaces / plugins 等）原样拼回，
    // 避免保存模型时把已安装插件的注册信息抹掉。
    ...(preservedConfig ? [preservedConfig, ""] : []),
  ].join("\n"), "utf8");
  const apiKey = entry.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(entry.encryptedKey, "base64")) : "";
  server.setApiKey(apiKey);
  await server.restart();
}

async function readStoredChannelBot(): Promise<StoredChannelBot | null> {
  try { return JSON.parse(await fs.readFile(channelBotFile, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}

async function readMemoryGateway(): Promise<MemoryRemoteConfig | null> {
  try {
    const stored = JSON.parse(await fs.readFile(memoryGatewayFile, "utf8")) as StoredMemoryGateway;
    return { endpoint: stored.endpoint, sessionKey: stored.sessionKey, userId: stored.userId, apiKey: decryptSecret(stored.encryptedApiKey) };
  } catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}

/**
 * 记忆来源模式：local 只用本机 memory.json；cloud 走 TencentDB Gateway。
 * 这个开关必须落到主进程——真正决定 recall/capture 去哪儿的是 MemoryStore 有没有 remote。
 */
const memoryModeFile = path.join(app.getPath("userData"), "memory-mode.json");
const memoryWorkspaceFile = path.join(app.getPath("userData"), "memory-workspaces.json");
type MemoryMode = "local" | "cloud";
async function readMemoryMode(): Promise<MemoryMode> {
  try { return JSON.parse(await fs.readFile(memoryModeFile, "utf8"))?.mode === "cloud" ? "cloud" : "local"; }
  catch { return "local"; }
}
async function applyMemoryMode(mode: MemoryMode) {
  await fs.writeFile(memoryModeFile, JSON.stringify({ mode }, null, 2), "utf8");
  memoryStore.setRemote(mode === "cloud" ? await readMemoryGateway() ?? undefined : undefined);
  return mode;
}

async function readWorkspaceMemorySettings(): Promise<Record<string, boolean>> {
  try {
    const raw = JSON.parse(await fs.readFile(memoryWorkspaceFile, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, boolean> : {};
  } catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
}

async function workspaceMemoryEnabled(workspace?: string): Promise<boolean> {
  if (!workspace) return false;
  const settings = await readWorkspaceMemorySettings();
  // Keep existing behavior for projects that have never explicitly been disabled.
  return settings[path.resolve(workspace)] !== false;
}

async function setWorkspaceMemoryEnabled(workspace: string, enabled: boolean): Promise<boolean> {
  const key = path.resolve(workspace);
  const settings = await readWorkspaceMemorySettings();
  settings[key] = Boolean(enabled);
  await fs.mkdir(path.dirname(memoryWorkspaceFile), { recursive: true });
  await fs.writeFile(memoryWorkspaceFile, JSON.stringify(settings, null, 2), "utf8");
  return settings[key];
}

async function saveMemoryGateway(input: any) {
  const previous = await readMemoryGateway();
  const config: MemoryRemoteConfig = {
    endpoint: String(input.endpoint ?? "").trim().replace(/\/$/, ""),
    sessionKey: String(input.sessionKey ?? "").trim(),
    userId: String(input.userId ?? "codex-harness").trim(),
    apiKey: String(input.apiKey ?? "").trim() || previous?.apiKey || "",
  };
  if (config.endpoint && !/^https?:\/\//.test(config.endpoint)) throw new Error("Memory Gateway 地址必须使用 http 或 https");
  if (config.endpoint && (!config.sessionKey || !config.userId)) throw new Error("Gateway 模式需要 session key 和 user ID");
  if (config.apiKey && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 Memory Gateway Key");
  await fs.writeFile(memoryGatewayFile, JSON.stringify({ endpoint: config.endpoint, sessionKey: config.sessionKey, userId: config.userId, encryptedApiKey: config.apiKey ? safeStorage.encryptString(config.apiKey).toString("base64") : undefined } satisfies StoredMemoryGateway, null, 2), "utf8");
  // 填了网关地址就切到云端（Codex 从此去云端找记忆），清空地址则回到本地
  await applyMemoryMode(config.endpoint ? "cloud" : "local");
  return { ...memoryStore.remoteStatus(), sessionKey: config.sessionKey, userId: config.userId, hasApiKey: Boolean(config.apiKey) };
}

function decryptSecret(value?: string) {
  return value && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, "base64")) : "";
}

function escapeToml(value: string) { return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }
function safeConnectorId(value: string) { return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64); }
function publicConnector(value: ConnectorConfig): PublicConnectorConfig {
  const { headers, env, encryptedSecrets, ...rest } = value;
  return { ...rest, hasSecrets: Boolean(Object.keys(encryptedSecrets ?? {}).length), headerKeys: Object.keys(headers ?? {}), envKeys: Object.keys(env ?? {}), envHttpHeaderKeys: Object.keys(value.envHttpHeaders ?? {}) };
}
async function readConnectors(): Promise<ConnectorConfig[]> {
  try {
    const list = JSON.parse(await fs.readFile(connectorsFile, "utf8"));
    return Array.isArray(list) ? list.filter((entry: any) => entry && typeof entry.id === "string" && typeof entry.name === "string") : [];
  } catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
}
async function writeConnectors(list: ConnectorConfig[]) { await fs.writeFile(connectorsFile, JSON.stringify(list, null, 2), "utf8"); }

// —— app-server MCP 启停覆盖表 ——
// app-server 回报的 MCP 分两类：harness 自己的连接器（connectors.json），
// 以及引擎直管的服务器（内置 nuphus、用户手工写进 config.toml 的段落）。
// 后者没有连接器记录，用这张表记住启用/停用，写 config.toml 时按它决定是否输出该段。
//
// 除了服务器级启停，还支持按工具的权限规则（deny/ask/allow）——复刻 WorkBuddy 的
// 工具级权限模型。引擎原生用 [permissions.allow/ask/deny] + `mcp__server__tool` 命名
// 约定表达（已用 permissionProfile/list 对真实引擎验证：该格式会解析出 allow/ask 档位，
// 而 `[permissions]` 直接写成 `"mcp__x__y" = "ask"` 会报 PermissionProfileToml 类型错误）。
/** 单工具的审批档位；值语义对齐 Codex 权限档位 */
type McpToolPermission = "deny" | "ask" | "allow";
type McpOverrideEntry = {
  enabled: boolean;
  /** 停用前的整段 config.toml 原文；只有用户手工写进 config.toml 的 MCP 才需要 */
  toml?: string;
  /** 按工具名的权限规则（deny 硬拒绝 / ask 每次询问 / allow 直接放行） */
  permissions?: Record<string, McpToolPermission>;
};
type McpOverrides = Record<string, McpOverrideEntry>;
async function readMcpOverrides(): Promise<McpOverrides> {
  try {
    const raw = JSON.parse(await fs.readFile(mcpOverridesFile, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as McpOverrides) : {};
  } catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
}
async function writeMcpOverrides(value: McpOverrides) { await fs.writeFile(mcpOverridesFile, JSON.stringify(value, null, 2), "utf8"); }
/** 没记过的一律视为启用，只有显式写了 false 才算停用 */
function mcpOverrideEnabled(overrides: McpOverrides, id: string) { return overrides[id]?.enabled !== false; }

/**
 * 把各 MCP 服务器的 per-tool 权限规则聚合输出为 [permissions.allow/ask/deny] 段。
 * 引擎原生读这套表（`mcp__server__tool` 标识符），复刻 WorkBuddy 的 deny/ask/allow 模型。
 * 只输出真的配了规则的档位，避免写空段。
 */
function permissionsToml(overrides: McpOverrides): string[] {
  const buckets: Record<Exclude<McpToolPermission, "deny">, string[]> = { allow: [], ask: [] };
  const deny: string[] = [];
  for (const [server, entry] of Object.entries(overrides)) {
    if (!entry?.permissions) continue;
    for (const [tool, mode] of Object.entries(entry.permissions)) {
      const key = `"mcp__${server}__${tool}"`;
      if (mode === "deny") deny.push(key);
      else buckets[mode].push(key);
    }
  }
  const out: string[] = [];
  for (const mode of ["allow", "ask", "deny"] as const) {
    const keys = mode === "deny" ? deny : buckets[mode];
    if (!keys.length) continue;
    out.push(`[permissions.${mode}]`);
    for (const key of keys.sort()) out.push(`${key} = true`);
    out.push("");
  }
  return out;
}
function connectorEnv(list: ConnectorConfig[]) {
  const result: Record<string, string> = {};
  for (const connector of list) {
    // 停用的连接器：密钥不再注入引擎环境，与「不写入 config.toml」保持一致
    if (connector.enabled === false) continue;
    for (const [key, encrypted] of Object.entries(connector.encryptedSecrets ?? {})) {
      const value = decryptSecret(encrypted);
      if (value) result[key] = value;
    }
  }
  return result;
}
function connectorToml(list: ConnectorConfig[]) {
  const lines: string[] = [];
  for (const connector of list) {
    // 停用的连接器整段跳过：引擎侧完全没有该 MCP，而不是加载后靠 enabled 字段生效
    if (connector.enabled === false) continue;
    const id = safeConnectorId(connector.id);
    if (!id) continue;
    lines.push("", `[mcp_servers.${id}]`);
    if (connector.transport === "stdio") {
      if (!connector.command) continue;
      lines.push(`command = "${escapeToml(connector.command)}"`);
      if (connector.args?.length) lines.push(`args = [${connector.args.map((arg) => `"${escapeToml(arg)}"`).join(", ")}]`);
      if (Object.keys(connector.env ?? {}).length) lines.push(`env = { ${Object.entries(connector.env ?? {}).map(([key, value]) => `${key} = "${escapeToml(String(value))}"`).join(", ")} }`);
    } else {
      if (!connector.url) continue;
      lines.push(`url = "${escapeToml(connector.url)}"`);
      // envHttpHeaders：HTTP header 名 -> 环境变量名。密钥走 connectorEnv 注入，不落盘到 config.toml。
      if (Object.keys(connector.envHttpHeaders ?? {}).length) lines.push(`env_http_headers = { ${Object.entries(connector.envHttpHeaders ?? {}).map(([key, value]) => `"${escapeToml(key)}" = "${escapeToml(value)}"`).join(", ")} }`);
      const tokenKey = Object.keys(connector.encryptedSecrets ?? {})[0];
      if (tokenKey && !Object.keys(connector.envHttpHeaders ?? {}).length) lines.push(`bearer_token_env_var = "${escapeToml(tokenKey)}"`);
    }
    lines.push("startup_timeout_sec = 20");
  }
  return lines;
}

async function readChannelBot(): Promise<ChannelBotConfig | null> {
  const stored = await readStoredChannelBot();
  if (!stored) return null;
  return {
    enabled: stored.enabled,
    host: stored.host,
    port: stored.port,
    workspace: stored.workspace,
    sandbox: stored.sandbox,
    appId: stored.appId,
    appSecret: decryptSecret(stored.encryptedAppSecret),
    verificationToken: decryptSecret(stored.encryptedVerificationToken),
    encryptKey: decryptSecret(stored.encryptedEncryptKey),
  };
}

function publicChannelBot(config: ChannelBotConfig | null) {
  const defaults = { enabled: false, host: "127.0.0.1" as const, port: 8787, workspace: "", sandbox: "workspace-write" as const, appId: "" };
  const value = config ?? defaults;
  return {
    ...defaults,
    ...value,
    appSecret: undefined,
    verificationToken: undefined,
    encryptKey: undefined,
    hasAppSecret: Boolean(config?.appSecret),
    hasVerificationToken: Boolean(config?.verificationToken),
    hasEncryptKey: Boolean(config?.encryptKey),
    ...channelBot.status(),
    logs: channelLogs,
  };
}

async function normalizeChannelBot(input: any): Promise<ChannelBotConfig> {
  const previous = await readChannelBot();
  const host = input.host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = Number(input.port ?? 8787);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("回调端口必须在 1024 到 65535 之间");
  const config: ChannelBotConfig = {
    enabled: Boolean(input.enabled),
    host,
    port,
    workspace: String(input.workspace ?? "").trim(),
    sandbox: ["read-only", "danger-full-access"].includes(input.sandbox) ? input.sandbox : "workspace-write",
    appId: String(input.appId ?? "").trim(),
    appSecret: String(input.appSecret ?? "").trim() || previous?.appSecret || "",
    verificationToken: String(input.verificationToken ?? "").trim() || previous?.verificationToken || "",
    encryptKey: String(input.encryptKey ?? "").trim() || previous?.encryptKey || "",
  };
  if (config.enabled && (!config.workspace || !config.appId || !config.appSecret || !config.verificationToken)) throw new Error("启用前需填写工作区、App ID、App Secret 和 Verification Token");
  return config;
}

async function saveChannelBot(input: any) {
  const config = await normalizeChannelBot(input);
  if ((config.appSecret || config.verificationToken || config.encryptKey) && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存机器人密钥");
  const encrypt = (value: string) => value ? safeStorage.encryptString(value).toString("base64") : undefined;
  const stored: StoredChannelBot = {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    workspace: config.workspace,
    sandbox: config.sandbox,
    appId: config.appId,
    encryptedAppSecret: encrypt(config.appSecret),
    encryptedVerificationToken: encrypt(config.verificationToken),
    encryptedEncryptKey: encrypt(config.encryptKey),
  };
  await channelBot.configure(config);
  await fs.writeFile(channelBotFile, JSON.stringify(stored, null, 2), "utf8");
  return publicChannelBot(config);
}

function publicCustomModel(value: CustomModelFile | null) {
  if (!value) return null;
  const { encryptedKey, ...config } = value;
  return { ...config, hasKey: Boolean(encryptedKey) };
}

function probeFetch(url: string, init: RequestInit, timeoutMs: number) {
  return net.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }).catch((error: any) => {
    throw new Error(classifyProbeError(error));
  });
}

/** 把 net.fetch 的底层错误翻译成能看懂的中文提示 */
function classifyProbeError(error: any): string {
  const message = String(error?.message ?? error);
  if (error?.name === "TimeoutError" || error?.name === "AbortError" || /timeout|aborted/i.test(message)) return "连接超时（服务器长时间无响应）";
  if (error?.code === "ENOTFOUND" || /getaddrinfo|ENOTFOUND/i.test(message)) return "域名解析失败（检查 Base URL）";
  if (error?.code === "ECONNREFUSED" || /ECONNREFUSED/i.test(message)) return "连接被拒绝（服务未启动或端口不对）";
  return message;
}

// 已知不提供 /models 列表的网关（Coding Plan 套餐等）：探测拉列表失败时返回内置推荐清单。
// 模型清单基于各官方文档（2026-09）；wire 是该网关实测的协议偏好（火山 Coding 仅支持 Chat）。
const KNOWN_GATEWAY_MODELS: { match: RegExp; wire: "responses" | "chat"; models: string[] }[] = [
  // 火山方舟 Coding Plan：https://ark.cn-beijing.volces.com/api/coding/v3（仅 Chat 协议）
  { match: /volces\.com\/api\/coding/, wire: "chat", models: ["doubao-seed-2.0-code", "doubao-seed-code", "glm-4.7", "deepseek-v3.2", "kimi-k2.5"] },
  // 火山方舟标准端点
  { match: /volces\.com/, wire: "chat", models: ["doubao-seed-1.8", "doubao-seed-1.6", "doubao-1.5-pro-32k", "deepseek-v3"] },
  // 智谱 Coding Plan：https://open.bigmodel.cn/api/coding/paas/v4
  { match: /bigmodel\.cn\/api\/coding/, wire: "responses", models: ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5"] },
  { match: /bigmodel\.cn/, wire: "responses", models: ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-4.6"] },
  // Kimi For Coding：https://api.kimi.com/coding/v1
  { match: /api\.kimi\.com|kimi\.com/, wire: "chat", models: ["kimi-k3", "kimi-k2-0905-preview", "kimi-k2-turbo-preview"] },
  // MiniMax
  { match: /minimaxi\.com|minimax\.io|minimax/, wire: "responses", models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2"] },
];

async function probeCustomModel(input: { provider?: string; baseUrl: string; apiKey?: string; model?: string; wireApi?: "responses" | "chat" | "auto" }) {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  let parsedUrl: URL;
  try { parsedUrl = new URL(baseUrl); } catch { throw new Error("Base URL 不是合法地址"); }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("Base URL 必须使用 http 或 https");
  const previous = await readCustomModel();
  const canReuseKey = previous?.provider === input.provider?.trim() && previous?.baseUrl === baseUrl;
  const apiKey = input.apiKey?.trim() || (canReuseKey && previous?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(previous.encryptedKey, "base64")) : "");
  const model = input.model?.trim();
  const startedAt = Date.now();
  const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  // 第一步：GET /models 轻量探测，毫秒级即可判断网络连通与认证
  let models: string[] | null = null;
  let modelsStatus = 0;
  let modelsError: Error | null = null;
  try {
    const response = await probeFetch(`${baseUrl}/models`, { headers: { ...authHeaders, Accept: "application/json" } }, 8_000);
    if (response.ok) {
      const body = await response.text();
      try {
        const data: any = JSON.parse(body);
        models = [...new Set<string>((Array.isArray(data) ? data : data.data ?? data.models ?? []).map((entry: any) => typeof entry === "string" ? entry : entry?.id ?? entry?.name).filter(Boolean))].sort();
        modelsStatus = response.status;
      } catch { /* 返回的不是 JSON，走流式探测兜底 */ }
    } else if (response.status === 401 || response.status === 403) {
      throw new Error(`认证失败（HTTP ${response.status}）：网络是通的，请检查 API Key`);
    } else if (response.status !== 404 && response.status !== 405) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200) || response.statusText}`);
    }
    // 404/405：网关不提供 /models，走流式探测
  } catch (error: any) {
    modelsError = error instanceof Error ? error : new Error(String(error));
  }
  // 网络层/认证已确定失败的场景直接报错，不再浪费时间做第二次请求
  if (modelsError && /域名解析失败|连接被拒绝|认证失败/.test(modelsError.message)) throw modelsError;

  if (models) {
    // /models 可用：没指定模型，或模型在列表里 → 直接连通成功（最快路径）
    if (!model || !models.length || models.includes(model)) {
      return { status: modelsStatus, latencyMs: Date.now() - startedAt, model: model ?? "", models, ok: true, via: "models" };
    }
    // 模型不在列表里：列表可能不全，用流式请求做精确判定
  }

  // 第二步：对指定模型发起流式极简请求，收到首个响应分片即判定连通，避免推理模型思考耗时。
  // wireApi=auto（自动跟随上游）：先试 Responses，端点/参数不被认就自动换 Chat Completions，
  // 并把实际成功的协议通过 wireUsed 返回——前端回写配置，保存时落定具体值。
  const wireOrder: ("responses" | "chat")[] = input.wireApi === "chat" ? ["chat"] : input.wireApi === "auto" ? ["responses", "chat"] : ["responses"];
  if (!model) {
    // Coding Plan 类网关（火山方舟/智谱 Coding/Kimi/MiniMax 等）不提供 /models 列表：
    // 命中已知网关时返回内置推荐清单（可手动增删），并给出该网关实测的协议偏好。
    const known = KNOWN_GATEWAY_MODELS.find((entry) => entry.match.test(baseUrl));
    if (known) {
      const wireHint = /volces\.com\/api\/coding|coding\/v3/.test(baseUrl) ? "chat" : known.wire;
      return { status: 200, latencyMs: Date.now() - startedAt, model: "", models: known.models, ok: true, via: "builtin", wireUsed: wireHint as "responses" | "chat" };
    }
    throw new Error(modelsError ? `该网关不提供 /models 列表接口：${modelsError.message}。可用下方「添加模型」手动输入模型 ID` : "该网关不提供 /models，且未指定要测试的模型。可用下方「添加模型」手动输入模型 ID");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders };
  const buildPayload = (wire: "responses" | "chat", tokenParam: string) => wire === "chat"
    ? { model, messages: [{ role: "user", content: "hi" }], [tokenParam]: 16, stream: true }
    : { model, input: "hi", max_output_tokens: 16, stream: true };
  const attempt = async (wire: "responses" | "chat", tokenParam: string) => {
    const endpoint = wire === "chat" ? `${baseUrl}/chat/completions` : `${baseUrl}/responses`;
    const response = await probeFetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildPayload(wire, tokenParam)) }, 20_000);
    const body = response.ok ? "" : await response.text();
    return { response, body };
  };
  // gpt-5 系列要求 max_completion_tokens，旧网关只认 max_tokens：先按新规范发，参数不识别时自动换旧参数重试
  let response!: Response;
  let body = "";
  let wireUsed: "responses" | "chat" = wireOrder[0];
  for (let w = 0; w < wireOrder.length; w++) {
    const wire = wireOrder[w];
    wireUsed = wire;
    ({ response, body } = await attempt(wire, "max_completion_tokens"));
    if (!response.ok && response.status === 400 && /max_completion_tokens|max_tokens/i.test(body)) {
      ({ response, body } = await attempt(wire, "max_tokens"));
    }
    if (response.ok) break;
    // 自动模式：端点不存在/参数不认（非认证、非模型缺失错误）→ 换另一种协议再试
    const canSwitch = w + 1 < wireOrder.length && (response.status === 404 || response.status === 405 || response.status === 400);
    if (!canSwitch) {
      const detail = body.slice(0, 300) || response.statusText;
      if (response.status === 401 || response.status === 403) throw new Error(`认证失败（HTTP ${response.status}）：网络是通的，请检查 API Key`);
      if (response.status === 400 && /model.*(not.*(found|exist)|不存在)/i.test(body)) throw new Error(`模型不存在（HTTP 400）：${detail}`);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
  }
  // 200 已证明网络、认证、模型名全部有效；读首个分片后立即断开，不等待生成完成
  const reader = (response.body as any)?.getReader?.();
  if (reader) {
    try { await reader.read(); } finally { try { await reader.cancel(); } catch { /* 已断开 */ } }
  }
  return { status: response.status, latencyMs: Date.now() - startedAt, model, models: models ?? [model], ok: true, via: "stream", wireUsed };
}
// ── 原生右键菜单：为输入框/选中文本提供 Windows 式复制、粘贴、剪切、全选、删除、撤销、重做 ──
// 渲染层跑在 sandbox + contextIsolation 下，且消息气泡的自定义「复制」按钮已存在；
// 这里补的是系统级右键菜单（此前右键无任何响应）。链接会额外提供「复制链接 / 浏览器打开」。
function installContextMenu(win: BrowserWindow) {
  win.webContents.on("context-menu", (_event, params) => {
    const editable = params.isEditable;
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim().length > 0);
    const flags = params.editFlags;
    const link = params.linkURL?.trim();

    const template: Electron.MenuItemConstructorOptions[] = [];
    const usable = () => template.some((item) => item.type !== "separator" && (item as { enabled?: boolean }).enabled !== false);

    // 复制：只要有选中文本即可（只读的正文 / 消息气泡区域也能复制）
    template.push({ label: "复制", accelerator: "CmdOrCtrl+C", enabled: hasSelection, click: () => win.webContents.copy() });
    // 剪切：仅可编辑且选中文本
    template.push({ label: "剪切", accelerator: "CmdOrCtrl+X", enabled: editable && hasSelection, click: () => win.webContents.cut() });
    // 粘贴：仅可编辑
    template.push({ label: "粘贴", accelerator: "CmdOrCtrl+V", enabled: editable, click: () => win.webContents.paste() });
    template.push({ label: "删除", enabled: editable && flags.canDelete, click: () => win.webContents.delete() });
    template.push({ type: "separator" });
    template.push({ label: "全选", accelerator: "CmdOrCtrl+A", enabled: flags.canSelectAll, click: () => win.webContents.selectAll() });

    if (link) {
      template.push({ type: "separator" });
      template.push({ label: "复制链接地址", click: () => clipboard.writeText(link) });
      template.push({ label: "在浏览器中打开", click: () => void shell.openExternal(link) });
    }

    template.push({ type: "separator" });
    template.push({ label: "撤销", accelerator: "CmdOrCtrl+Z", enabled: editable && flags.canUndo, click: () => win.webContents.undo() });
    template.push({ label: "重做", accelerator: "CmdOrCtrl+Shift+Z", enabled: editable && flags.canRedo, click: () => win.webContents.redo() });

    // 空白区域右键（无选中、非编辑、非链接）时没有任何可用项，不弹菜单
    if (!usable()) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function createWindow() {
  // Windows 任务栏图标必须用 .ico 才可靠（PNG 会被 electron.exe 默认图标顶掉）；
  // dev 下 __dirname=dist-electron → ../build/icon.ico；打包后 build/ 不进 asar，
  // existsSync 为 false 走 exe 内嵌图标（electron-builder win.icon 已注入）。
  const windowIcon = path.join(
    __dirname,
    "..",
    "build",
    process.platform === "win32" ? "icon.ico" : "icon.png",
  );
  mainWindow = new BrowserWindow({
    // 默认桌面尺寸要容纳展开侧栏和完整输入工具栏；小屏仍由响应式布局处理。
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#ffffff",
    title: "Codex Harness Desktop",
    icon: existsSync(windowIcon) ? windowIcon : undefined,
    autoHideMenuBar: true,
    // 无边框标题栏：系统标题栏隐藏，应用 topbar 顶到窗口边缘（省 ~32px 高度），
    // 右上角保留系统窗口控制钮（贴靠/双击最大化等原生行为不变），颜色随主题由 theme:apply 更新。
    titleBarStyle: "hidden",
    titleBarOverlay: {
      // 与聊天顶栏 var(--bg) 同色（亮 #fff / 暗 #1b1b1a）——独立标题栏行已取消，
      // 整条 44px 顶行（顶栏+操作簇+原生窗口钮）必须同色
      color: "#ffffff",
      symbolColor: "#1b1b1a",
      // 43 而非 44：底下留 1px 给 .topbar::after 分隔线，线可贯通窗口钮下方
      height: 43,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // <webview> 标签（Electron 默认禁用）：主区「浏览器」视图用它嵌入外部网页。
      // guest 内容是独立 webContents，与主应用隔离（拿不到 preload / node API），
      // 仅用于渲染，不赋予任何宿主权限。
      webviewTag: true,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  installContextMenu(mainWindow);
}

// 前端切主题时同步窗口外观：nativeTheme.themeSource 让系统标题栏与 Chromium 默认
// 滚动条跟随应用主题（不影响系统全局，只作用于本应用窗口）；同时更新窗口底色，
// 避免深色模式下「外边框/滚轮」残留浅色。
ipcMain.handle("theme:apply", (_event, theme: string) => {
  const dark = theme === "dark";
  nativeTheme.themeSource = dark ? "dark" : "light";
  mainWindow?.setBackgroundColor(dark ? "#1b1b1a" : "#ffffff");
  // 无边框标题栏：窗口控制钮的底色/符号色跟随主题
  try { mainWindow?.setTitleBarOverlay({ color: dark ? "#1b1b1a" : "#ffffff", symbolColor: dark ? "#e8e8e5" : "#1b1b1a", height: 43 }); } catch { /* overlay 未启用时忽略 */ }
  return { ok: true };
});

// ── 单实例锁：防止启动两个应用前端（两份引擎 + 共享 codex-home 会互相打架） ──
// 第二个实例启动时 requestSingleInstanceLock 返回 false → 立即退出；
// 已运行实例收到 second-instance 事件 → 聚焦已有窗口（唤起）。
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  await fs.mkdir(codexHome, { recursive: true });
  await ensureBuiltinSkills(userSkillsDir);
  // 启动即补齐 AGENTS.md（emoji + 中文语言规范基础段）：老版本升级后没有这些段，
  // 重写让模型默认用中文思考与回复；AGENTS.md 引擎每请求动态重读，无需重启即生效。
  try {
    await applyPersonalizationToAgentsMd(await readPersonalization(), codexHome);
  } catch (error) { console.warn("AGENTS.md bootstrap failed:", error); }
  const custom = await readCustomModel();
  if (custom?.encryptedKey && safeStorage.isEncryptionAvailable()) {
    try {
      server.setApiKey(safeStorage.decryptString(Buffer.from(custom.encryptedKey, "base64")));
    } catch (error) {
      console.warn("custom-model API key decrypt failed, starting without key:", error);
    }
  }
  protocol.handle("harness-image", async (request) => {
    const imagePath = new URL(request.url).searchParams.get("path");
    if (!imagePath) return new Response("Missing path", { status: 400 });
    // 兜底：图片被清理/不存在时返回 1x1 透明占位，避免渲染层破图报错
    try {
      if (!existsSync(imagePath)) return placeholderPngResponse();
      return net.fetch(pathToFileURL(imagePath).toString());
    } catch {
      return placeholderPngResponse();
    }
  });
  createWindow();
  server.on("event", (event) => {
    sendToWindow("codex:event", event);
    channelBot.handleCodexEvent(event);
    // 引擎就绪后按设置启停健康看门狗（engineWatchdog 默认开）
    if (event.kind === "status" && event.status === "ready") void syncEngineWatchdog();
    // 手机对话页实时同步：流式增量 / 用户消息 / 回合完成
    if (event.kind === "notification") {
      const p = event.params as any;
      if (event.method === "turn/started" && p?.turn?.id) engineActiveTurnIds.add(String(p.turn.id));
      if (event.method === "turn/completed" && p?.turn?.id) engineActiveTurnIds.delete(String(p.turn.id));
      // 记忆捕获缓冲：turn/completed 不带完整 items，必须靠流式事件累积文本（同 channel-bot 的做法）
      if (event.method === "item/started" && p?.item?.type === "userMessage") {
        const text = (p.item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
        if (text) captureBuffers.set(`${p.threadId}:${p.turnId}`, { user: text, assistant: "", cwd: threadCwd.get(String(p.threadId)) });
      } else if (event.method === "item/agentMessage/delta" && p?.delta) {
        const buffer = captureBuffers.get(`${p.threadId}:${p.turnId}`);
        if (buffer) buffer.assistant += p.delta;
        for (const forward of remoteEventForwarders) forward({ threadId: p.threadId, kind: "delta", text: p.delta });
      } else if (event.method === "item/completed" && p?.item?.type === "agentMessage" && p.item.text) {
        const buffer = captureBuffers.get(`${p.threadId}:${p.turnId}`);
        if (buffer) buffer.assistant = p.item.text;
      } else if (event.method === "turn/completed") {
        if (!internalThreads.has(String(p?.threadId))) for (const forward of remoteEventForwarders) forward({ threadId: p?.threadId, kind: "done", text: "" });
      }
      if (event.method === "turn/completed" && !internalThreads.has(String(p?.threadId))) {
        const key = `${p?.threadId}:${p?.turnId}`;
        const buffer = captureBuffers.get(key) ?? { user: "", assistant: "", cwd: undefined };
        captureBuffers.delete(key);
        // completed.items 有内容时兜底覆盖
        const items = p?.turn?.items ?? [];
        if (items.length) {
          buffer.user = items.filter((item: any) => item.type === "userMessage").flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") || buffer.user;
          buffer.assistant = items.filter((item: any) => item.type === "agentMessage").map((item: any) => item.text ?? "").join("\n") || buffer.assistant;
        }
        // 欢迎语隐藏线程（[welcome-gen] 标记）不进记忆：一次性生成文案的内部线程
        const isWelcomeGen = buffer.user.includes("[welcome-gen]") || items.some((item: any) => JSON.stringify(item?.content ?? item).includes("[welcome-gen]"));
        if (!isWelcomeGen && (buffer.user.trim() || buffer.assistant.trim())) {
          void workspaceMemoryEnabled(buffer.cwd).then((enabled) => memoryStore.captureTurn(p?.threadId ?? "", buffer.user, buffer.assistant, { workspace: buffer.cwd, includeWorkspace: enabled })).catch((error) => sendToWindow("harness:event", { type: "memory", message: `Memory Gateway 捕获失败：${error.message}`, at: Date.now() }));
        }
        // 会话结束自动蒸馏：主进程内部节流（6 小时一次），异常全吞，绝不影响主流程
        if (buffer.cwd) {
          void workspaceMemoryEnabled(buffer.cwd).then((enabled) => {
            if (!enabled) return null;
            return memoryLayers.autoDistill(buffer.cwd!, distillSummarize).then((result) => {
              if (result?.ok) sendToWindow("harness:event", { type: "memory", message: `记忆自动蒸馏完成：${result.dates.length} 天日志已提炼进项目记忆`, at: Date.now() });
              return result;
            });
          }).catch(() => undefined);
        }
      }
    }
  });
  try {
    await server.start();
  } catch (error) {
    sendToWindow("codex:event", { kind: "status", status: "error", message: String(error) });
  }
  // 自愈：config.toml 顶层的 model_context_window 才是引擎真正使用的上下文上限。
  // 旧版本把它写成供应商级默认值（128000），用户在模型编辑器里改的 1M 只进了 models[] 与
  // model-catalog.json → UI 一直显示 12.8 万。检测到漂移就重写一次（幂等：一致则跳过）。
  if (custom) {
    try {
      // catalog 每次启动都重写（幂等）：确保包含所有启用供应商的模型——
      // 旧会话切换到任何供应商的模型时引擎都查得到，不会报「不支持」。
      await writeModelCatalogToml(custom);
      const configText = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
      const written = Number(/^\s*model_context_window\s*=\s*(\d+)\s*$/m.exec(configText)?.[1] ?? 0);
      const wanted = (normalizeProvider(custom).models ?? []).find((candidate) => candidate.id === custom.model)?.contextWindow ?? custom.contextWindow ?? 128000;
      const environmentOutdated = !configText.includes("[shell_environment_policy.set]") || !configText.includes("PYTHON_EXECUTABLE");
      const instructionsOutdated = !configText.includes("Never infer Python availability");
      // 禁用供应商的 provider 段必须保留在 config.toml：历史线程 resume 时按创建时的
      // model_provider 加载配置，段被移除会报 "Model provider `X` not found" → 会话内容全空。
      // 旧版本 applyCustomModel 写配置时过滤了禁用供应商——检测到缺失就整份重写补回。
      const disabledMissing = (await readCustomModels()).some((candidate) => candidate.enabled === false && !configText.includes(`[model_providers.${candidate.provider}]`));
      if (written !== wanted || environmentOutdated || instructionsOutdated || disabledMissing) {
        console.warn(`[custom-model] config drift: context=${written}/${wanted}, environment=${environmentOutdated}, instructions=${instructionsOutdated}, disabledMissing=${disabledMissing}; rewriting`);
        await applyCustomModel(custom);
      }
    } catch (error) {
      console.warn("[custom-model] context window self-heal failed:", error);
    }
  }
  await applyMemoryMode(await readMemoryMode());
  await scheduler.start();
  await remote.start();
  // 微信机器人网关：扫码登录 → 微信消息 → Codex 会话处理 → 回复发回微信
  weixinGateway = new WeixinGateway(path.join(app.getPath("userData"), "weixin-accounts"), {
    onMessage: (message) => void handleWeixinMessage(message),
    log: (level, message) => {
      channelLogs.push({ at: Date.now(), level, message });
      sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
    },
  });
  void weixinGateway.resume();
  void telegramGateway.resume().catch(() => undefined);
  try {
    await channelBot.configure(await readChannelBot());
  } catch (error) {
    channelLogs.push({ at: Date.now(), level: "error", message: `频道机器人启动失败：${String(error)}` });
    sendToWindow("channel-bot:event", { level: "error", message: `频道机器人启动失败：${String(error)}`, at: Date.now(), status: channelBot.status() });
  }
});

// ── 微信机器人：收消息 → Codex → 回复发回微信 ───────────────────
let weixinGateway: WeixinGateway | null = null;
const weixinBindings = new Map<string, string>(); // 微信用户 → Codex 线程

async function handleWeixinMessage(message: { from: string; text: string; contextToken: string }) {
  if (!weixinGateway) return;
  try {
    const model = await readCustomModel();
    if (!model) { await weixinGateway.sendText(message.from, "请先在应用里配置模型再使用微信机器人。"); return; }
    let threadId = weixinBindings.get(message.from) ?? "";
    if (threadId) {
      try { await server.request("thread/resume", { threadId, excludeTurns: false }); }
      catch { threadId = ""; weixinBindings.delete(message.from); }
    }
    if (!threadId) {
      const botConfig = await readChannelBot().catch(() => null);
      const started = await server.request("thread/start", {
        model: model.model,
        cwd: botConfig?.workspace || app.getPath("home"),
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        modelProvider: model.provider,
      }) as any;
      threadId = started.thread.id;
      weixinBindings.set(message.from, threadId);
    }
    // 微信回复需要 context_token，绑一个完成回调：turn 完成时把最终回复发回微信
    const from = message.from;
    const onDone = (event: any) => {
      if (event.params?.threadId !== threadId) return;
      server.off?.("event", onDoneProxy);
    };
    const onDoneProxy = (event: any) => {
      if (event.kind !== "notification" || event.method !== "turn/completed" || event.params?.threadId !== threadId) return;
      server.off("event", onDoneProxy);
      const finalText = [...(event.params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
      if (finalText.trim()) weixinGateway?.sendText(from, finalText.trim()).catch((error) => console.warn("微信回信失败:", error.message));
    };
    server.on("event", onDoneProxy);
    await server.request("turn/start", { threadId, input: [{ type: "text", text: `[微信用户] ${message.text}`, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    console.warn("微信消息处理失败:", error.message);
    weixinGateway.sendText(message.from, `处理失败：${error.message}`).catch(() => undefined);
  }
}

// ── 微信机器人 IPC ───────────────────────────────────────────
ipcMain.handle("weixin:start-login", async () => {
  const result = await weixinGateway?.startLogin();
  if (!result?.qrcodeImg) return result;
  // iLink 的 qrcode_img_content 格式不固定：可能是裸 base64 图片、data URL 图片、
  // 或二维码内容文本（liteapp.weixin.qq.com/... 短链）。统一归一化成渲染端可直接
  // 使用的形式，避免裸 base64 被当成 HTML 注入导致二维码区域白屏：
  //   data:image → 原样返回（<img> 直接显示）
  //   裸 base64 图片 → 补 data:image/png;base64, 前缀（浏览器会嗅探真实格式）
  //   http URL / 短文本 → 内容文本，编码成 SVG 码
  const raw = String(result.qrcodeImg).trim();
  const compact = raw.replace(/\s+/g, "");
  const isBareB64 = compact.length > 64 && /^[A-Za-z0-9+/=]+$/.test(compact);
  const qr = raw.startsWith("data:")
    ? raw
    : isBareB64
      ? `data:image/png;base64,${compact}`
      : await qrSvg(raw);
  return { ...result, qrcodeImg: qr };
});
ipcMain.handle("weixin:poll-login", async () => weixinGateway?.pollLogin());
ipcMain.handle("weixin:status", async () => ({ bound: weixinGateway?.hasSession() ?? false }));
// 各渠道真实连接状态（机器人列表圆点用）
ipcMain.handle("channels:status", async () => ({ weixin: weixinGateway?.hasSession() ?? false, telegram: telegramGateway.hasSession() }));

const telegramGateway = new TelegramGateway({
  onMessage: (message) => void handleTelegramMessage(message),
  log: (level, message) => {
    channelLogs.push({ at: Date.now(), level, message });
    sendToWindow("channel-bot:event", { level, message, at: Date.now(), status: channelBot.status() });
  },
});
const telegramBindings = new Map<string, number>();
async function handleTelegramMessage(message: { from: string; chatId: number; text: string }) {
  try {
    const model = await readCustomModel();
    if (!model) { await telegramGateway.sendText(message.chatId, "请先在应用里配置模型。"); return; }
    let threadId = weixinBindings.get("tg:" + message.from) ?? "";
    if (threadId) { try { await server.request("thread/resume", { threadId, excludeTurns: false }); } catch { threadId = ""; weixinBindings.delete("tg:" + message.from); } }
    if (!threadId) {
      const botConfig = await readChannelBot().catch(() => null);
      const started = await server.request("thread/start", { model: model.model, cwd: botConfig?.workspace || app.getPath("home"), approvalPolicy: "never", sandbox: "danger-full-access", modelProvider: model.provider }) as any;
      threadId = started.thread.id;
      weixinBindings.set("tg:" + message.from, threadId);
    }
    const chatId = message.chatId;
    const onDoneProxy = (event: any) => {
      if (event.kind !== "notification" || event.method !== "turn/completed" || event.params?.threadId !== threadId) return;
      server.off("event", onDoneProxy);
      const finalText = [...(event.params?.turn?.items ?? [])].reverse().find((item: any) => item.type === "agentMessage")?.text ?? "";
      if (finalText.trim()) telegramGateway.sendText(chatId, finalText.trim()).catch(() => undefined);
    };
    server.on("event", onDoneProxy);
    await server.request("turn/start", { threadId, input: [{ type: "text", text: message.text, text_elements: [] }], model: model.model, effort: "high" });
  } catch (error: any) {
    telegramGateway.sendText(message.chatId, `处理失败：${error.message}`).catch(() => undefined);
  }
}
ipcMain.handle("telegram:connect", async (_event, token: string) => { try { return { ok: true, ...(await telegramGateway.connect(String(token ?? ""))) }; } catch (error: any) { return { ok: false, error: error.message }; } });
ipcMain.handle("telegram:status", async () => ({ bound: telegramGateway.hasSession() }));

// ponytail 技能包开关（写代码模式）：off 时钩子静默跳过，full 时注入精简工程规则
ipcMain.handle("ponytail:mode:get", async () => getPonytailMode());
ipcMain.handle("ponytail:mode:set", async (_event, mode: string) => { await setPonytailMode(mode as any); return { mode }; });

ipcMain.handle("codex:request", async (_event, method: string, params: unknown) => {
  let result: unknown;
  try {
    result = await server.request(method, params);
  } catch (error: any) {
    // 历史线程引用了已删除/换 ID 的供应商（rollout 里硬编码旧 model_provider）：
    // 引擎 resume 报 "Model provider `X` not found" → 会话内容全空。
    // 自动补一个指向当前生效端点的同名 provider 段，重启引擎后重试——内容找回。
    const missing = /Model provider `([^`]+)` not found/.exec(String(error?.message ?? ""));
    const active = missing ? await readCustomModel() : null;
    if (!missing || !active?.baseUrl) throw error;
    const alias = missing[1];
    const configText = await fs.readFile(path.join(codexHome, "config.toml"), "utf8").catch(() => "");
    if (configText.includes(`[model_providers.${alias}]`)) throw error;
    const savedWire = (await readCustomModels()).find((c) => c.provider === alias)?.wireApi;
    const wireApi = savedWire === "chat" ? "chat" : active.wireApi === "chat" ? "chat" : "responses";
    await fs.appendFile(path.join(codexHome, "config.toml"), `\n[model_providers.${alias}]\nname = "${alias}"\nbase_url = "${active.baseUrl}"\nenv_key = "CODEX_HARNESS_API_KEY"\nwire_api = "${wireApi}"\n`);
    await server.restart();
    result = await server.request(method, params);
  }
  if (method === "thread/list") {
    const response = result as any;
    const archiveFilter = typeof (params as any)?.archived === "boolean" ? Boolean((params as any).archived) : null;
    const indexed = Array.isArray(response?.data) ? response.data : [];
    const fallback = listRolloutThreads(codexHome);
    result = { ...response, data: mergeThreadList(indexed, fallback, archiveFilter, Number((params as any)?.limit ?? 100)) };
  }
  // 记忆捕获用：记录 threadId → cwd（新建线程响应 / 线程设置更新都带 cwd）
  try {
    const p = params as any;
    const r = result as any;
    if (method === "thread/start" && r?.thread?.id) {
      threadCwd.set(String(r.thread.id), String(p?.cwd ?? r.thread.cwd ?? ""));
    } else if (method === "thread/resume" && r?.thread?.id) {
      r.thread = enrichThreadWithRolloutTools(r.thread, codexHome);
      threadCwd.set(String(r.thread.id), String(r.thread.cwd ?? r.cwd ?? p?.cwd ?? ""));
    } else if (method === "thread/settings/update" && p?.threadId && p?.cwd) {
      threadCwd.set(String(p.threadId), String(p.cwd));
    }
  } catch { /* cwd 映射失败不影响请求本身 */ }
  return result;
});
ipcMain.handle("codex:respond", (_event, id: string | number, result: unknown) => server.respond(id, result));
ipcMain.handle("user:name", async () => {
  // 用户名的权威源是个性化昵称（personalization.json），重启不丢；
  // 只有未设置昵称时才回退到操作系统用户名，避免每次启动把自定义称呼覆盖回系统用户。
  try {
    const cfg = await readPersonalization();
    if (cfg?.nickname) return cfg.nickname;
  } catch { /* 忽略，走回退 */ }
  try { return os.userInfo().username || "Codex 用户"; } catch { return "Codex 用户"; }
});
ipcMain.handle("app:userData", () => app.getPath("userData"));

// ── 内置斜杠命令支撑：/doctor（环境诊断）、/debug（引擎信息）、/export（导出会话）、
//    /bashes（后台终端）、/plugin-validate（插件目录校验）────────────────────────
/** 跑一次外部命令取输出，带超时，失败返回空串（诊断用，绝不抛错） */
function commandOutput(binary: string, args: string[], timeoutMs = 6000): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    let out = "";
    const finish = (value: string) => { if (done) return; done = true; clearTimeout(timer); resolve(value.trim()); };
    const timer = setTimeout(() => { try { child?.kill(); } catch { /* 已退出 */ } finish(out || "（超时未返回）"); }, timeoutMs);
    let child: ReturnType<typeof spawn> | undefined;
    try {
      child = spawn(binary, args, { windowsHide: true, env: toolchainEnv() });
      child.stdout?.on("data", (chunk) => { out += String(chunk); });
      child.stderr?.on("data", (chunk) => { out += String(chunk); });
      child.on("error", () => finish(""));
      child.on("close", () => finish(out));
    } catch { finish(""); }
  });
}
function sizeLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
function fileStat(target: string) {
  try { return statSync(target); } catch { return null; }
}
function dirEntries(target: string) {
  try { return readdirSync(target); } catch { return null; }
}
function engineLogFile() {
  for (const name of ["logs_2.sqlite", "logs_1.sqlite", "logs.sqlite"]) {
    const stat = fileStat(path.join(codexHome, name));
    if (stat) return { path: path.join(codexHome, name), size: stat.size, modifiedAt: stat.mtimeMs };
  }
  return null;
}

ipcMain.handle("app:doctor", async (_event, input: { cwd?: string } = {}) => {
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  checks.push({
    label: "应用", ok: true,
    detail: `Codex Harness Desktop ${app.getVersion()} · Electron ${process.versions.electron} · Node ${process.versions.node} · ${process.platform}/${process.arch}`,
  });
  let binary = "";
  try { binary = codexBinaryPath(); } catch { binary = ""; }
  const binaryOk = Boolean(binary) && existsSync(binary);
  checks.push({ label: "引擎二进制", ok: binaryOk, detail: binaryOk ? binary : "未找到 codex 引擎二进制（重新安装 @openai/codex 依赖）" });
  if (binaryOk) {
    const version = await commandOutput(binary, ["--version"]);
    checks.push({ label: "引擎版本", ok: Boolean(version), detail: version || "读取版本失败" });
  }
  checks.push({ label: "引擎服务", ok: server.running, detail: server.running ? "app-server 子进程运行中" : "app-server 未运行——发起一次对话会自动拉起" });
  const configStat = fileStat(path.join(codexHome, "config.toml"));
  checks.push({
    label: "引擎配置", ok: Boolean(configStat),
    detail: configStat ? `config.toml · ${sizeLabel(configStat.size)} · 更新于 ${new Date(configStat.mtimeMs).toLocaleString("zh-CN")}` : `${codexHome}\\config.toml 不存在`,
  });
  let modelOk = false;
  let modelDetail = "未配置自定义模型（/model 打开模型设置）";
  try {
    const raw = JSON.parse(readFileSync(existsSync(customModelsFile) ? customModelsFile : customModelFile, "utf8"));
    const list = Array.isArray(raw) ? raw : (raw?.providers ?? [raw]).filter(Boolean);
    const enabled = list.filter((entry: any) => entry?.enabled !== false);
    modelOk = enabled.length > 0;
    modelDetail = modelOk
      ? `${enabled.length}/${list.length} 个模型服务启用 · ${enabled.slice(0, 3).map((entry: any) => `${entry.name ?? entry.id}/${entry.model ?? ""}`).join("、")}`
      : `已配置 ${list.length} 个模型服务，但全部停用`;
  } catch { /* 尚未配置模型 */ }
  checks.push({ label: "模型", ok: modelOk, detail: modelDetail });
  const cwd = input?.cwd ? String(input.cwd) : "";
  checks.push({ label: "工作区", ok: Boolean(cwd) && existsSync(cwd), detail: cwd ? (existsSync(cwd) ? cwd : `${cwd}（目录已不存在）`) : "未选择工作区（/cd 选择目录）" });
  if (cwd && existsSync(cwd)) {
    const git = bundledGit() || "git";
    const version = await commandOutput(git, ["--version"], 4000);
    const branch = version ? await commandOutput(git, ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], 4000) : "";
    checks.push({
      label: "Git", ok: Boolean(version),
      detail: version ? `${version}${branch && !branch.includes("fatal") ? ` · 分支 ${branch}` : " · 当前目录不是 git 仓库"}` : "未检测到 git（应用内置或系统 PATH 中均找不到）",
    });
  }
  const log = engineLogFile();
  checks.push({
    label: "引擎日志", ok: !log || log.size < 200 * 1024 * 1024,
    detail: log ? `${path.basename(log.path)} · ${sizeLabel(log.size)}${log.size > 200 * 1024 * 1024 ? "（偏大，可在设置里清理 codex-home）" : ""}` : "暂无日志文件",
  });
  const toolRoot = toolsRoot();
  const modulesDir = npmGlobalRoot();
  checks.push({
    label: "自动化工具链", ok: Boolean(modulesDir) && existsSync(modulesDir),
    detail: modulesDir ? `${modulesDir}${existsSync(modulesDir) ? " · 已安装" : " · 未安装（npm 包缺失）"}` : "未找到 resources/tools",
  });
  if (process.platform === "darwin") {
    const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
    const screen = systemPreferences.getMediaAccessStatus("screen");
    checks.push({
      label: "macOS 辅助功能权限", ok: accessibility,
      detail: accessibility ? "已授权键鼠和窗口控制" : "请在系统设置 → 隐私与安全性 → 辅助功能中允许本应用及 Nuphus",
    });
    checks.push({
      label: "macOS 屏幕录制权限", ok: screen === "granted",
      detail: screen === "granted" ? "已授权屏幕捕获" : "请在系统设置 → 隐私与安全性 → 屏幕录制中允许本应用及 Nuphus，授权后重新启动应用",
    });
  }
  const git = bundledGit();
  const python = bundledPython();
  checks.push({ label: "Git 运行时", ok: Boolean(git), detail: git || "未找到 Git（请重新安装应用工具包）" });
  checks.push({ label: "Python 运行时", ok: Boolean(python), detail: python || "未找到 Python（请重新安装应用工具包）" });
  if (python) {
    const tk = await commandOutput(python, ["-c", "import tkinter; print('Tk ' + str(tkinter.TkVersion))"], 5000);
    checks.push({ label: "Python Tkinter", ok: Boolean(tk), detail: tk || "内置 Python 已存在，但 Tkinter/Tcl/Tk 组件缺失" });
  }
  const free = Math.round(os.freemem() / 1024 ** 3 * 10) / 10;
  checks.push({ label: "内存", ok: free >= 1, detail: `可用物理内存 ${free} GB / 共 ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB` });
  return { checks, at: Date.now() };
});

ipcMain.handle("app:engine-info", async () => {
  let binary = "";
  try { binary = codexBinaryPath(); } catch { binary = ""; }
  const version = binary && existsSync(binary) ? await commandOutput(binary, ["--version"]) : "";
  const entries = dirEntries(codexHome) ?? [];
  const databases = entries
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => ({ name, size: fileStat(path.join(codexHome, name))?.size ?? 0 }))
    .sort((a, b) => b.size - a.size);
  return {
    codexHome,
    binary,
    binaryExists: Boolean(binary) && existsSync(binary),
    version,
    running: server.running,
    userData: app.getPath("userData"),
    agentsMd: Boolean(fileStat(path.join(codexHome, "AGENTS.md"))),
    configToml: Boolean(fileStat(path.join(codexHome, "config.toml"))),
    logFile: engineLogFile(),
    databases: databases.slice(0, 8),
    sessions: (dirEntries(path.join(codexHome, "sessions"))?.length ?? 0),
    archived: (dirEntries(path.join(codexHome, "archived_sessions"))?.length ?? 0),
  };
});

// ── Codex 引擎在线更新（设置 → 控制台 → Codex 引擎更新） ──
let engineUpdateRunning = false;
ipcMain.handle("engine:check-update", async () => {
  const settings = await readAppSettings(app.getPath("userData"));
  return checkEngineUpdate(settings.engineProxyUrl?.trim() || undefined);
});
ipcMain.handle("engine:perform-update", async () => {
  if (engineUpdateRunning) throw new Error("引擎更新正在进行中，请稍候");
  engineUpdateRunning = true;
  try {
    const settings = await readAppSettings(app.getPath("userData"));
    const proxy = settings.engineProxyUrl?.trim() || undefined;
    // 有任务在跑就等它结束（最多 10 分钟），避免替换文件时引擎仍在写
    if (engineActiveTurnIds.size) {
      sendToWindow("engine:update:progress", { stage: "wait", detail: "等待当前任务结束后开始替换…" });
      const deadline = Date.now() + 10 * 60_000;
      while (engineActiveTurnIds.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // 替换二进制前必须停引擎（否则 codex.exe 被占用，rename 失败）
    server.stop();
    const result = await performEngineUpdate(proxy, (progress) => {
      sendToWindow("engine:update:progress", { stage: progress.stage, detail: progress.detail, percent: progress.percent });
    });
    if (!result.ok) {
      // 更新失败要把引擎拉起来，应用保持可用（引擎会加载旧/回滚后的二进制）
      await server.restart().catch(() => undefined);
    }
    return result;
  } finally {
    engineUpdateRunning = false;
  }
});
ipcMain.handle("app:relaunch", () => {
  app.relaunch();
  app.exit(0);
});


// ── 内置插件：生图 + 视觉辅助 ──
const builtinPluginsFile = path.join(app.getPath("userData"), "builtin-plugins.json");

type BuiltinPluginConfig = {
  image?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string };
  vision?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string };
};

async function readBuiltinPlugins(): Promise<BuiltinPluginConfig> {
  try { return JSON.parse(await fs.readFile(builtinPluginsFile, "utf8")); } catch { return {}; }
}
async function writeBuiltinPlugins(cfg: BuiltinPluginConfig) {
  await fs.writeFile(builtinPluginsFile, JSON.stringify(cfg, null, 2), "utf8");
}

// 网络层错误中文化：证书过期/域名解析/超时等 give 用户能看懂的原因（引擎/插件直连供应商时可能遇到）
function describeNetworkError(error: unknown, what: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const code = String((error as any)?.cause?.code ?? (error as any)?.code ?? "");
  const haystack = raw + " " + code;
  if (/CERT_HAS_EXPIRED|certificate has expired|ERR_CERT/i.test(haystack)) return new Error(`${what}失败：服务器的 HTTPS 证书已过期——这是接口服务商的问题，等其续期后自动恢复；也可先在插件配置里换成其他可用的接口地址。`);
  if (/ENOTFOUND|EAI_AGAIN/i.test(haystack)) return new Error(`${what}失败：域名解析不到，检查网络连接或接口地址是否写错`);
  if (/ECONNREFUSED/i.test(haystack)) return new Error(`${what}失败：连接被拒绝，服务未开放或地址/端口不对`);
  if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(haystack)) return new Error(`${what}失败：连接超时，检查网络或代理设置`);
  if (/ECONNRESET|socket hang up/i.test(haystack)) return new Error(`${what}失败：连接被重置，网络波动或被防火墙拦截`);
  return new Error(`${what}失败：${raw}`);
}

async function probeBuiltinModels(input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const url = base + "/models";
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: "Bearer " + (input.apiKey || ""), "Content-Type": "application/json" } });
  } catch (error) {
    throw describeNetworkError(error, "检测");
  }
  if (!response.ok) throw new Error("模型列表请求失败 HTTP " + response.status + (response.status === 401 ? "（密钥无效）" : response.status === 404 ? "（地址可能缺少 /v1）" : ""));
  const data = await response.json();
  const models = (Array.isArray(data) ? data : data.data ?? data.models ?? []).map((x: any) => typeof x === "string" ? x : x?.id ?? x?.model).filter(Boolean);
  return { models: [...new Set<string>(models)] };
}

async function generateImageWith(input: { baseUrl: string; apiKey: string; model: string; prompt: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  // 兼容 /images/generations（OpenAI 兼容）与 /v1/images/generations
  const endpoint = /\/images\/generations$/.test(base) ? base : base + "/images/generations";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, prompt: input.prompt, n: 1 }),
    });
  } catch (error) {
    throw describeNetworkError(error, "生图请求");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let hint = "";
    try { hint = JSON.parse(detail)?.error?.message ?? ""; } catch { hint = detail.slice(0, 160); }
    throw new Error("生图失败 HTTP " + response.status + (hint ? "：" + hint : ""));
  }
  const data = await response.json();
  const item = data?.data?.[0];
  // 注意优先级：url 存在用 url；否则 b64_json 转 data URL（旧写法运算符优先级有误，
  // 返回 url 时会拼出 "data:image/png;base64,undefined"，已修）
  const url = item?.url ?? (item?.b64_json ? "data:image/png;base64," + item.b64_json : "");
  return { url };
}

async function describeImageWith(input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) {
  const base = input.baseUrl.trim().replace(/\/$/, "");
  const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
  const content = [
    { type: "text", text: input.prompt || "请详细描述这张图片的内容，包括画面主体、场景、文字、布局等，用中文回答。" },
    { type: "image_url", image_url: { url: input.imageUrl } },
  ];
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: [{ role: "user", content }] }),
    });
  } catch (error) {
    throw describeNetworkError(error, "识图请求");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let hint = "";
    try { hint = JSON.parse(detail)?.error?.message ?? ""; } catch { hint = detail.slice(0, 160); }
    throw new Error("识图失败 HTTP " + response.status + (hint ? "：" + hint : ""));
  }
  const data = await response.json();
  return { text: data?.choices?.[0]?.message?.content ?? "" };
}

ipcMain.handle("builtin:read", async () => readBuiltinPlugins());
ipcMain.handle("builtin:save", async (_e, cfg: BuiltinPluginConfig) => {
  await writeBuiltinPlugins(cfg);
  // 保存后重写 config.toml 并重启引擎：developer_instructions 的生图/视觉段与
  // dynamicTools 都依赖这份配置，不重启的话引擎和已有会话感知不到配置变化。
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else await server.restart();
  return readBuiltinPlugins();
});
ipcMain.handle("builtin:probe", async (_e, input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) => probeBuiltinModels(input));
ipcMain.handle("builtin:generate-image", async (_e, input: { baseUrl: string; apiKey: string; model: string; prompt: string }) => generateImageWith(input));
ipcMain.handle("builtin:describe-image", async (_e, input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) => describeImageWith(input));

/**
 * 输入框提示词增强（复刻 WorkBuddy enhance 按钮）：用当前自定义模型把用户原文润色成
 * 更清晰、结构化的提示词。直调 chat/completions（一次非流式调用），不经过引擎会话。
 * 成功返回 { ok: true, text }；原文为空/模型未配置返回 { ok: false, error }。
 */
const ENHANCE_SYSTEM_PROMPT = [
  "你是提示词优化助手。把用户的原始输入改写成一个清晰、具体、结构化的 AI 提示词：",
  "- 保留用户原文的全部意图与信息，不编造新需求",
  "- 补齐缺失的背景、目标、输出要求，使指令可直接执行",
  "- 用简洁的中文输出优化后的提示词本身，不要任何解释、前言或 markdown 代码块",
].join("\n");

ipcMain.handle("prompt:enhance", async (_event, input: { text: string }) => {
  const text = String(input?.text ?? "").trim();
  if (!text) return { ok: false, error: "输入内容为空" };
  try {
    const model = await readCustomModel();
    if (!model?.baseUrl || !model.model || model.enabled === false) return { ok: false, error: "请先在设置中配置并启用自定义模型" };
    const apiKey = model.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(model.encryptedKey, "base64")) : "";
    const base = model.baseUrl.trim().replace(/\/$/, "");
    const endpoint = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
        body: JSON.stringify({
          model: model.model,
          messages: [
            { role: "system", content: ENHANCE_SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
          temperature: 0.4,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { ok: false, error: `增强失败 HTTP ${response.status}${body ? "：" + body.slice(0, 160) : ""}` };
      }
      const data: any = await response.json();
      const enhanced = String(data?.choices?.[0]?.message?.content ?? "").trim();
      if (!enhanced) return { ok: false, error: "增强结果为空，请重试" };
      return { ok: true, text: enhanced };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: any) {
    return { ok: false, error: error?.name === "AbortError" ? "增强超时，请重试" : `增强失败：${error?.message ?? error}` };
  }
});

ipcMain.handle("terminal:list", () => [...terminals.entries()].map(([id, service]) => ({ id, alive: service.alive, cwd: service.dir })));

ipcMain.handle("updates:check", async (_event, input?: { source?: "web" | "github" }) => {
  try {
    const currentVersion = String(app.getVersion() || "0.0.0");
    const source = input?.source ?? "web";
    const info = await checkLatestUpdate(currentVersion, source, process.platform, process.arch);
    return { ok: true, info, currentVersion, serverUrl: UPDATE_SERVER_URL, channel: UPDATE_CHANNEL, source };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});
ipcMain.handle("updates:download", async (event, input: { downloadUrl: string; filename?: string }) => {
  try {
    const dir = defaultDownloadDir(app.getPath("downloads"));
    const safeName = (input.filename || "codex-harness-update.bin").replace(/[\\/:*?"<>|]/g, "_");
    const dest = path.join(dir, safeName);
    let lastPushed = -1;
    const info = await downloadUpdate(input.downloadUrl, dest, ({ percent }) => {
      const pct = Math.round(percent * 100);
      // 每 2% 推一次（+ 必定推 100%），避免高频 IPC 刷屏
      if (pct !== lastPushed && (pct - lastPushed >= 2 || pct >= 100)) {
        lastPushed = pct;
        event.sender.send("updates:download-progress", percent);
      }
    });
    return { ok: true, path: info.path, bytes: info.bytes };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});
ipcMain.handle("updates:reveal", async (_event, filePath: string) => {
  if (!filePath) return { ok: false };
  shell.showItemInFolder(filePath);
  return { ok: true };
});
// 下载完成后运行安装包：交给系统默认程序打开（Windows 下即启动安装向导）
ipcMain.handle("updates:install", async (_event, filePath: string) => {
  if (!filePath || !fileExists(filePath)) return { ok: false, error: "file_not_found" };
  const started = await installUpdate(filePath);
  return { ok: started, error: started ? undefined : "open_failed" };
});

ipcMain.handle("plugin:validate", async (_event, input: { path?: string }) => {
  const root = input?.path ? String(input.path) : "";
  if (!root) return { ok: false, root: "", issues: ["未提供插件目录路径"], inventory: {} };
  if (!existsSync(root)) return { ok: false, root, issues: [`目录不存在：${root}`], inventory: {} };
  const manifestCandidates = [".codex-plugin/plugin.json", "plugin.json", ".codebuddy-plugin/plugin.json"];
  const manifestPath = manifestCandidates.map((rel) => path.join(root, rel)).find((full) => existsSync(full)) ?? "";
  const issues: string[] = [];
  let manifest: any = null;
  if (manifestPath) {
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch (error: any) { issues.push(`清单解析失败：${manifestPath} — ${error.message}`); }
  } else {
    issues.push("缺少插件清单（.codex-plugin/plugin.json 或 plugin.json）");
  }
  if (manifest && !manifest.name) issues.push("清单缺少 name 字段");
  const count = (rel: string) => dirEntries(path.join(root, rel))?.length ?? 0;
  const inventory = { skills: count("skills"), commands: count("commands"), agents: count("agents"), hooks: existsSync(path.join(root, "hooks", "hooks.json")) ? 1 : 0 };
  if (!inventory.skills && !inventory.commands && !inventory.agents && !inventory.hooks) issues.push("插件没有任何能力目录（skills / commands / agents / hooks）");
  return { ok: issues.length === 0, root, manifestPath, issues, inventory, name: manifest?.name ?? "" };
});
ipcMain.handle("remote:start", () => { const port = remote.start(); return { port, url: remote.pairUrl() }; });
ipcMain.handle("remote:status", () => ({ status: "idle", devices: remote.listDevices(), url: remote.pairUrl() }));
ipcMain.handle("remote:devices", () => remote.listDevices());
ipcMain.handle("remote:send", (_event, cmd: string) => { mainWindow?.webContents.send("remote:command", { command: String(cmd), device: { id: "local", name: "本机" } }); return { ok: true }; });
ipcMain.handle("remote:stop", () => { remote.stop(); return { ok: true }; });
ipcMain.handle("remote:qrcode", async (_event, botId?: string) => {
  const base = remote.pairUrl();
  return qrSvg(botId ? `${base}?bot=${encodeURIComponent(botId)}` : base);
});
// 机器人扫码绑定：创建绑定会话二维码 + 渲染层轮询状态
let lastBindSession = "";
ipcMain.handle("bot:bind-qrcode", async (_event, botId: string, botName: string) => {
  lastBindSession = remote.createBindSession(botId, botName);
  const code = lastBindSession.match(/\/r\/([a-z0-9]+)\?/)?.[1] ?? "";
  return { qr: await qrSvg(lastBindSession), url: lastBindSession, code };
});
ipcMain.handle("bot:bind-status", (_event, code: string) => remote.bindStatus(code));
ipcMain.handle("bot:bind-consume", (_event, code: string) => remote.consumeBind(code));
let awakeId: number | null = null;
ipcMain.handle("notify:show", (_event, title: string, body: string) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title ?? "Codex Harness"), body: String(body ?? ""), silent: false });
  n.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
  n.show();
  return true;
});
ipcMain.handle("awake:set", (_event, on: boolean) => {
  if (on && awakeId == null) awakeId = powerSaveBlocker.start("prevent-app-suspension");
  if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
  return awakeId != null;
});

// 自动化工具链状态：nuphus-mcp（桌面）/ playwright-cli（浏览器）/ cloakbrowser（指纹浏览器）。
// 静态检测安装目录与缓存，不 spawn 进程，打开设置页即时返回。
ipcMain.handle("tools:status", () => {
  const readVersion = (pkgDir: string) => {
    try { return JSON.parse(readFileSync(pkgDir, "utf8")).version as string; }
    catch { return ""; }
  };
  const root = toolsRoot();
  const modules = npmGlobalRoot();
  const nuphusBin = nuphusBinary();
  // CloakBrowser 内核优先查应用内置缓存，兼容旧的用户目录缓存
  const cloakDirs = [cloakCacheDir(), path.join(os.homedir(), ".cloakbrowser")].filter(Boolean);
  let cloakBinary = false;
  for (const dir of cloakDirs) {
    try { if (readdirSync(dir).some((entry) => entry.includes("chromium"))) { cloakBinary = true; break; } } catch { /* 未下载 */ }
  }
  return [
    {
      id: "nuphus-mcp", name: "Nuphus 桌面自动化", scope: "computer",
      version: modules ? readVersion(path.join(modules, "@nuphus", "nuphus-mcp", "package.json")) : "",
      installed: Boolean(nuphusBin), binaryReady: Boolean(nuphusBin),
      detail: nuphusBin ? "35 个桌面/浏览器自动化工具就绪（屏幕、窗口、键鼠、剪贴板、OCR、Chrome CDP），经 nuphus-call 按需调用，不占模型上下文" : "未安装：运行 scripts/install-automation.cjs",
      command: nuphusBin,
    },
    {
      id: "playwright-cli", name: "Playwright 浏览器自动化", scope: "browser",
      version: modules ? readVersion(path.join(modules, "@playwright", "cli", "package.json")) : "",
      installed: modules ? existsSync(path.join(modules, "@playwright", "cli", "package.json")) : false,
      binaryReady: existsSync(path.join(root, "pw-browsers")) && readdirSync(path.join(root, "pw-browsers")).some((entry) => entry.startsWith("chromium-")),
      detail: "命令行浏览器自动化：open / snapshot / click / type / screenshot，首次 open 时自动下载浏览器内核",
      command: "playwright-cli",
    },
    {
      id: "cloakbrowser", name: "CloakBrowser 指纹浏览器", scope: "browser",
      version: modules ? readVersion(path.join(modules, "cloakbrowser", "package.json")) : "",
      installed: modules ? existsSync(path.join(modules, "cloakbrowser", "package.json")) : false,
      binaryReady: cloakBinary,
      detail: cloakBinary ? "反检测 Chromium 内核已就绪（resources/tools/cloak-cache，随应用内置）" : "npm 包已装，Chromium 内核未下载（node scripts/download-cloak.cjs）",
      command: "cloakbrowser",
    },
  ];
});

type DevRuntimeId = "python" | "node" | "pwsh" | "git" | "ffmpeg" | "vscode-cli" | "automation" | "jq" | "ninja" | "sevenzip" | "yt-dlp" | "rg" | "uv" | "cmake" | "playwright-browsers" | "cloak-browsers" | "ponytail" | "conda" | "docker" | "mingw" | "openssl";
type DevRuntimeSpec = { name: string; description: string; size: string; marker: string; builtIn?: boolean; kind?: "download" | "browsers" | "guide" | "plugin" };
const devRuntimeSpecs: Record<DevRuntimeId, DevRuntimeSpec> = {
  python: { name: "Python + Tkinter + pip", description: "Python 项目、数据处理、GUI 脚本和 Python MCP（含 Tkinter、requests/httpx/flask/fastapi/playwright）", size: "约 40 MB + 依赖", marker: "python\\python.exe", builtIn: true },
  node: { name: "Node.js + npm", description: "JavaScript / TypeScript 项目和 npm 工具", size: "约 101 MB", marker: "node\\node.exe", builtIn: true },
  pwsh: { name: "PowerShell 7", description: "现代 PowerShell 脚本与跨平台命令", size: "约 282 MB", marker: "pwsh\\pwsh.exe", builtIn: true },
  git: { name: "Git", description: "Diff、分支、提交、历史和仓库操作", size: "约 90 MB", marker: "git\\cmd\\git.exe", builtIn: true },
  ffmpeg: { name: "FFmpeg", description: "音视频转码、抽帧、探测与媒体处理", size: "约 307 MB", marker: "ffmpeg\\bin\\ffmpeg.exe" },
  "vscode-cli": { name: "VS Code CLI", description: "通过 code 命令打开文件与工作区", size: "约 28 MB", marker: "vscode-cli\\code.exe", builtIn: true },
  automation: { name: "桌面与浏览器自动化", description: "Nuphus（桌面 MCP）+ Playwright CLI + CloakBrowser 包本体，下载压缩包解压即用（不含浏览器内核）", size: "压缩包 18 MB", marker: "npm-global\\node_modules\\@nuphus\\nuphus-mcp\\package.json" },
  jq: { name: "jq", description: "命令行查询、筛选和转换 JSON", size: "约 1 MB", marker: "jq\\jq.exe", builtIn: true },
  ninja: { name: "Ninja", description: "高速构建工具，常与 CMake 配合", size: "约 1 MB", marker: "ninja\\ninja.exe", builtIn: true },
  sevenzip: { name: "7-Zip CLI", description: "解压和创建 7z、zip、tar 等归档", size: "约 1 MB", marker: "sevenzip\\7z.exe", builtIn: true },
  "yt-dlp": { name: "yt-dlp", description: "下载和分析在线视频与音频资源", size: "约 20 MB", marker: "yt-dlp\\yt-dlp.exe" },
  rg: { name: "ripgrep (rg)", description: "极速代码搜索，Codex 检索代码库的主力工具", size: "约 5 MB", marker: "rg\\rg.exe", builtIn: true },
  uv: { name: "uv", description: "极速 Python 包管理器（pip/venv 替代）", size: "约 12 MB", marker: "uv\\uv.exe", builtIn: true },
  cmake: { name: "CMake", description: "C/C++ 构建系统生成器（配合 Ninja）", size: "约 45 MB", marker: "cmake\\bin\\cmake.exe", builtIn: true },
  "playwright-browsers": { name: "Playwright 浏览器内核", description: "Chromium 等浏览器内核，浏览器自动化 CLI 首次运行所需，联网下载", size: "约 170 MB", marker: "pw-browsers", kind: "browsers" },
  "cloak-browsers": { name: "Cloak 指纹浏览器内核", description: "反检测 Chromium 内核（Cloudflare/reCAPTCHA 站点用），CloakBrowser 运行所需，联网下载", size: "约 200 MB", marker: "cloak-cache" },
  conda: { name: "Miniconda", description: "Python 环境管理器（conda 命令，科学计算/环境隔离）", size: "约 100 MB", marker: "miniconda\\Scripts\\conda.exe", kind: "download" },
  docker: { name: "Docker Desktop", description: "容器运行时，需要系统级安装（管理员权限 + 重启 + 登录）", size: "约 500 MB", marker: "docker\\docker.exe", kind: "guide" },
  mingw: { name: "MinGW-w64 (gcc/g++/make)", description: "C/C++ 编译器工具链，含 gcc、g++、make、gdb", size: "约 267 MB", marker: "mingw\\mingw64\\bin\\g++.exe", kind: "download" },
  openssl: { name: "OpenSSL", description: "加密/证书命令行工具（openssl 命令），系统级安装", size: "约 25 MB", marker: "openssl\\openssl.exe", kind: "guide" },
  ponytail: { name: "ponytail 写代码模式插件", description: "Codex 写代码模式（会话钩子 + 6 个技能），安装后开箱即用", size: "随包 2 MB", marker: "ponytail-plugin", kind: "plugin" },
};
const runtimeInstalls = new Map<DevRuntimeId, Promise<void>>();

function runtimeList() {
  const root = toolsRoot();
  return (Object.entries(devRuntimeSpecs) as [DevRuntimeId, DevRuntimeSpec][]).map(([id, spec]) => ({
    id, ...spec,
    // ponytail 插件装在引擎侧 codex-home/plugins/cache，不走 tools 目录 marker
    installed: id === "ponytail"
      ? existsSync(path.join(codexHome, "plugins", "cache", "ponytail"))
      : Boolean(root) && existsSync(path.join(root, spec.marker)),
    // docker 是系统级安装：未在工具目录时也探测系统 PATH 上的 docker.exe（已装则视为完成）
    installedBySystem: id === "docker" ? !!(process.env.PATH ?? "").split(";").some((dir) => dir && existsSync(path.join(dir.trim(), "docker.exe"))) : false,
    installing: runtimeInstalls.has(id),
  }));
}

function runtimeInstaller(name: string) {
  return app.isPackaged ? path.join(toolsRoot(), name) : path.join(app.getAppPath(), "scripts", name);
}

function runRuntimeInstaller(id: DevRuntimeId, script: string, args: string[], node = process.execPath) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(node, [script, ...args], {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: node === process.execPath ? "1" : undefined, TOOLS_ROOT: toolsRoot() },
    });
    let tail = "";
    const report = (chunk: Buffer | string) => {
      const message = String(chunk).trim();
      if (!message) return;
      tail = `${tail}\n${message}`.slice(-4000);
      sendToWindow("runtime:progress", { id, message });
    };
    child.stdout?.on("data", report);
    child.stderr?.on("data", report);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(tail.trim() || `安装进程退出（${code}）`)));
  });
}

async function restartServerWhenIdle(id: DevRuntimeId) {
  if (engineActiveTurnIds.size) sendToWindow("runtime:progress", { id, message: "安装完成，等待当前任务结束后刷新引擎" });
  const deadline = Date.now() + 10 * 60_000;
  while (engineActiveTurnIds.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  await server.restart();
}

ipcMain.handle("runtime:list", () => runtimeList());
ipcMain.handle("runtime:install", async (_event, idValue: string) => {
  const id = idValue as DevRuntimeId;
  if (!devRuntimeSpecs[id]) throw new Error("未知开发工具");
  if (devRuntimeSpecs[id].builtIn) return { ok: true, runtimes: runtimeList() };
  if (runtimeInstalls.has(id)) throw new Error("该工具正在安装");
  const spec = devRuntimeSpecs[id];
  // 引导型（docker/openssl）：静默安装需要管理员/重启/登录，这里打开官方下载页由用户自己装
  if (spec.kind === "guide") {
    const url = id === "openssl"
      ? "https://slproweb.com/products/Win32OpenSSL.html"
      : "https://www.docker.com/products/docker-desktop/";
    await shell.openExternal(url);
    return { ok: true, guide: url, runtimes: runtimeList() };
  }
  const task = (async () => {
    if (id === "automation") {
      if (!bundledNode()) await runRuntimeInstaller("node", runtimeInstaller("install-runtimes.cjs"), ["node"]);
      await runRuntimeInstaller(id, runtimeInstaller("install-automation.cjs"), [], bundledNode());
      // 解压安装成功后自动激活「桌面自动化」「浏览器自动化」联动开关（nuphus MCP 注册 + 技能启用）
      await saveAppSettings(app.getPath("userData"), { desktopAutomation: true, browserAutomation: true });
    } else if (id === "playwright-browsers") {
      // 用内置 Python 的 playwright 下载 Chromium 到 pw-browsers（toolchainEnv 已注入 PLAYWRIGHT_BROWSERS_PATH）
      const node = bundledNode();
      const cli = path.join(npmGlobalRoot(), "@playwright", "cli", "node_modules", "playwright", "cli.js");
      if (!node || !existsSync(cli)) throw new Error("缺少 Playwright CLI，请先在「开发工具」安装「桌面与浏览器自动化」");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(node, [cli, "install", "chromium"], {
          windowsHide: true,
          env: toolchainEnv(),
        });
        let tail = "";
        const report = (chunk: Buffer | string) => {
          const message = String(chunk).trim();
          if (!message) return;
          tail = `${tail}\n${message}`.slice(-4000);
          sendToWindow("runtime:progress", { id, message });
        };
        child.stdout?.on("data", report);
        child.stderr?.on("data", report);
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(tail.trim() || `浏览器内核下载失败（${code}）`)));
      });
    } else if (id === "cloak-browsers") {
      // CloakBrowser 反检测 Chromium 内核下载到 tools/cloak-cache（toolchainEnv 已注入 CLOAKBROWSER_CACHE_DIR）
      const node = bundledNode();
      const cli = path.join(npmGlobalRoot(), "cloakbrowser", "dist", "cli.js");
      if (!node || !existsSync(cli)) throw new Error("缺少 CloakBrowser，请先在「开发工具」安装「桌面与浏览器自动化」");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(node, [cli, "install"], {
          windowsHide: true,
          env: toolchainEnv(),
        });
        let tail = "";
        const report = (chunk: Buffer | string) => {
          const message = String(chunk).trim();
          if (!message) return;
          tail = `${tail}\n${message}`.slice(-4000);
          sendToWindow("runtime:progress", { id, message });
        };
        child.stdout?.on("data", report);
        child.stderr?.on("data", report);
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(tail.trim() || `Cloak 内核下载失败（${code}）`)));
      });
    } else if (id === "ponytail") {
      // ponytail 写代码模式插件：从随包安装源种到引擎（plugins cache + config 注册段），技能随 cache 自动列出
      await ensurePonytailPlugin(codexHome, path.join(toolsRoot(), "ponytail-plugin"));
    } else {
      await runRuntimeInstaller(id, runtimeInstaller("install-runtimes.cjs"), [id]);
    }
    await restartServerWhenIdle(id);
  })();
  runtimeInstalls.set(id, task);
  try {
    await task;
    sendToWindow("runtime:progress", { id, message: "安装完成", done: true });
    return { ok: true, runtimes: runtimeList() };
  } finally {
    runtimeInstalls.delete(id);
  }
});

// CloakBrowser 常驻助手：单个 node 进程托管指纹浏览器窗口（headed + humanize），
// stdin 逐行喂 URL；stdout 回传 JSON 事件（boot / launching / ready / opened / error / closed）。
let cloakProc: ReturnType<typeof spawn> | null = null;
let cloakStatus: { event?: string; message?: string; url?: string; title?: string } = {};

ipcMain.handle("browser:open-cloak", (_event, url: string) => {
  const modules = npmGlobalRoot();
  if (!modules || !existsSync(path.join(modules, "cloakbrowser", "package.json"))) {
    return { ok: false, detail: "CloakBrowser 未安装：运行 scripts/install-automation.cjs" };
  }
  if (!cloakProc || cloakProc.exitCode !== null) {
    const helper = cloakOpenHelper();
    if (!helper || !existsSync(helper)) return { ok: false, detail: "缺少 resources/tools/cloak-open.mjs 助手脚本" };
    const node = bundledNode() || "node";
    cloakProc = spawn(node, [helper], { windowsHide: true, env: { ...toolchainEnv(), CLOAK_NPM_ROOT: modules } });
    cloakProc.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        try { cloakStatus = JSON.parse(line); } catch { /* 非 JSON 行 */ }
      }
    });
    cloakProc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) cloakStatus = { event: "error", message: text.slice(0, 300) };
    });
    cloakProc.once("error", (error) => { cloakStatus = { event: "error", message: error.message }; cloakProc = null; });
    cloakProc.once("exit", (code) => {
      if (cloakStatus.event !== "error") cloakStatus = { event: "exit", ...(code ? { message: `浏览器进程退出（${code}）` } : {}) };
      cloakProc = null;
    });
    cloakProc.stdin?.on("error", () => { /* EPIPE：进程刚退出 */ });
    cloakStatus = { event: "launching" };
  }
  try {
    cloakProc.stdin?.write(`${url.trim()}\n`);
    return { ok: true, detail: "已提交给 CloakBrowser" };
  } catch (error: any) {
    return { ok: false, detail: error.message };
  }
});

ipcMain.handle("browser:cloak-status", () => cloakStatus);

ipcMain.handle("terminal:input", (_event, id: string, data: string) => terminalFor(id).input(data));
ipcMain.handle("terminal:resize", (_event, id: string, cols: number, rows: number) => terminalFor(id).resize(cols, rows));
ipcMain.handle("terminal:restart", (_event, id: string, cwd?: string) => terminalFor(id).restart(cwd));
ipcMain.handle("terminal:ready", () => true);
ipcMain.handle("git:diff", (_event, input: { cwd: string; scope: string }) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
  const args = input.scope === "staged" ? ["diff", "--cached"] : input.scope === "head" ? ["diff", "HEAD"] : ["diff"];
  const proc = spawn(bundledGit() || "git", args, { cwd: input.cwd, windowsHide: true, env: toolchainEnv() });
  let output = "";
  proc.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  proc.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  proc.on("error", () => resolve({ code: null, output: "" }));
  proc.on("close", (code) => resolve({ code, output }));
}));
ipcMain.handle("fs:write", async (_event, input: { path: string; content: string; root: string }) => {
  const resolved = path.resolve(input.path);
  const root = path.resolve(input.root || resolved);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("仅允许保存工作区内的文件");
  await fs.writeFile(resolved, input.content, "utf8");
  return { ok: true };
});
// 本地读文件：预览文件内容（Base64 返回，渲染层解码）。取代转发给引擎的 fs/readFile——
// 引擎的 fs/readFile 是给 AI 用的工具，非任务上下文会失败或返回结构不一致。
ipcMain.handle("fs:read", async (_event, input: { path: string }) => {
  const target = path.resolve(input.path);
  const stat = fileStat(target);
  if (!stat || !stat.isFile()) throw new Error(`文件不存在或不可读：${input.path}`);
  const size = stat.size;
  if (size > 2 * 1024 * 1024) throw new Error(`文件过大（${sizeLabel(size)}），预览仅支持 2MB 以内`);
  const buf = await fs.readFile(target);
  return { dataBase64: buf.toString("base64"), size };
});
// 探测文件是否存在（InlineFileCards 用：不存在的引用文件灰显，点击不再直接报 os error 2）
ipcMain.handle("fs:exists", async (_event, input: { path: string }) => {
  try {
    const target = path.resolve(input.path);
    const stat = fileStat(target);
    return { exists: Boolean(stat && stat.isFile()) };
  } catch {
    return { exists: false };
  }
});
ipcMain.handle("dialog:directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
// /add-dir：从指定起始目录打开选择器（目录不存在时回落到默认行为）
ipcMain.handle("dialog:directory-at", async (_event, startPath: string) => {
  const start = startPath && existsSync(startPath) ? startPath : undefined;
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"], defaultPath: start });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("dialog:images", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("dialog:files", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "All files", extensions: ["*"] }],
  });
  return result.canceled ? [] : result.filePaths;
});
const userSkillsDir = path.join(codexHome, "skills");
const skillsRegistryFile = path.join(codexHome, "skills-registry.json");
type SkillRegistryRecord = { name: string; path: string; source: "cocoloop" | "local"; marketId?: string; sourceUrl?: string; installedAt: string };
async function readSkillRegistry(): Promise<SkillRegistryRecord[]> {
  try {
    const records = JSON.parse(await fs.readFile(skillsRegistryFile, "utf8"));
    return Array.isArray(records) ? records.filter((entry: any) => entry && typeof entry.name === "string" && typeof entry.path === "string") : [];
  } catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
}
async function updateSkillRegistry(record: SkillRegistryRecord) {
  const records = await readSkillRegistry();
  const next = [...records.filter((entry) => entry.path !== record.path && entry.marketId !== record.marketId), record];
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(skillsRegistryFile, JSON.stringify(next, null, 2), "utf8");
}
async function removeFromSkillRegistry(skillPath: string) {
  const records = await readSkillRegistry();
  await fs.writeFile(skillsRegistryFile, JSON.stringify(records.filter((entry) => entry.path !== skillPath), null, 2), "utf8");
}
function skillFolderName(source: string) {
  return path.basename(path.dirname(source)).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `skill-${Date.now()}`;
}
ipcMain.handle("skills:import", async () => {
  const picked = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: [{ name: "Skill definition", extensions: ["md"] }],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const source = picked.filePaths[0];
  if (path.basename(source).toLowerCase() !== "skill.md") throw new Error("请选择名为 SKILL.md 的技能定义文件");
  const content = await fs.readFile(source, "utf8");
  if (!content.trim()) throw new Error("SKILL.md 不能为空");
  const name = skillFolderName(source);
  const destination = path.join(userSkillsDir, name);
  await fs.mkdir(destination, { recursive: true });
  const skillPath = path.join(destination, "SKILL.md");
  await fs.copyFile(source, skillPath);
  await updateSkillRegistry({ name, path: skillPath, source: "local", installedAt: new Date().toISOString() });
  await server.restart();
  return { name, path: destination, source, content };
});
// SkillHub 榜单分类（技能中心 tab → showcase section）；其余分类名一律落回 hot
const skillHubSectionMap: Record<string, string> = { "总排行": "hot", "近期最热": "trending", "最新上传": "newest", "官方精选": "featured" };
ipcMain.handle("skills:market-list", (_event, input: { category?: string; query?: string } = {}) => {
  const section = skillHubSectionMap[input.category ?? ""] ?? "hot";
  return listSkillHubSkills({ section, query: input.query });
});
ipcMain.handle("skills:market-install", async (_event, skill: MarketSkill) => {
  const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "skill-install", skillId: skill.id, stage, message, at: Date.now() });
  const installed = await installCocoLoopSkill({
    skill,
    destinationRoot: userSkillsDir,
    onProgress: ({ stage, message }) => emit(stage, message),
  });
  await updateSkillRegistry({ name: installed.name, path: installed.path, source: "cocoloop", marketId: installed.marketId, sourceUrl: installed.sourceUrl, installedAt: new Date().toISOString() });
  // SKILL.md 落到 CODEX_HOME/skills 后重启进程，再强制刷新 skills/list；返回的状态才是 UI 的“Codex 已发现”依据。
  emit("engine", "正在重启 Codex 引擎并注册技能");
  await server.restart();
  emit("verify", "正在确认 Codex 是否已发现该技能");
  let engineRegistered = false;
  let engineCheckMessage = "Codex 技能目录已刷新，下一轮任务可使用该技能";
  try {
    const result: any = await server.request("skills/list", { cwds: [], forceReload: true });
    const discovered = (result.data ?? []).flatMap((entry: any) => entry.skills ?? []);
    engineRegistered = discovered.some((entry: any) => entry?.path === installed.path || entry?.name === installed.name || entry?.name === skill.name);
    if (!engineRegistered) engineCheckMessage = "技能已写入 Codex 技能目录；引擎已刷新，但当前接口未返回该技能名称。新建或下一轮任务仍会重新扫描。";
  } catch (error: any) {
    engineCheckMessage = `技能已安装且引擎已重启，但自动确认暂时不可用：${error.message}`;
  }
  emit(engineRegistered ? "complete" : "pending", engineCheckMessage);
  return { ...installed, engineRegistered, engineCheckMessage };
});
ipcMain.handle("plugins:market-list", (_event, input: { category?: string; query?: string; page?: number; pageSize?: number } = {}) => listCodexMarketPlugins(input));
ipcMain.handle("plugins:market-install", async (_event, plugin: CodexMarketPlugin) => {
  const emit = (stage: string, message: string) => sendToWindow("harness:event", { type: "plugin-install", pluginId: plugin.slug, stage, message, at: Date.now() });
  // 幂等注册本地 marketplace 段（缺才写），返回插件落盘目录
  const destinationRoot = await ensureCodexMarketplaceSection(codexHome);
  const installed = await installCodexMarketPlugin({
    plugin,
    destinationRoot,
    onProgress: ({ stage, message }) => emit(stage, message),
  });
  // 引擎实证：光把文件写进本地 marketplace 引擎不认（plugin/list 返回空），
  // 必须调 plugin/install（marketplacePath 传 .claude-plugin/marketplace.json 文件路径）
  // 让引擎把它拷进 plugins/cache/<marketplace>/<plugin>/<version> 并置 installed=true。
  emit("engine", "正在通过引擎注册插件");
  try {
    await server.request("plugin/install", { pluginName: installed.marketId ?? plugin.slug, marketplacePath: installed.manifestPath });
  } catch (error: any) {
    emit("pending", `引擎注册插件未成功：${error?.message ?? error}（文件已落盘，重启引擎后会重新扫描）`);
  }
  emit("engine", "正在重启 Codex 引擎并注册插件");
  await server.restart();
  emit("verify", "正在确认 Codex 是否已发现该插件");
  let engineRegistered = false;
  let engineCheckMessage = "插件目录已写入，重启 Codex 后生效";
  try {
    const list: any = await server.request("plugin/list", { cwds: [], forceRefetch: false });
    const base = (value: string) => String(value ?? "").split("@")[0];
    const found = (list?.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? [])
      .find((entry: any) => entry?.installed && (base(entry.id) === plugin.slug || entry.name === plugin.slug || entry.name === plugin.name));
    engineRegistered = Boolean(found);
    if (!engineRegistered) engineCheckMessage = "插件已写入本地插件目录；引擎已刷新，但当前列表未返回该插件，新建会话后仍会重新扫描。";
  } catch (error: any) {
    engineCheckMessage = `插件已安装且引擎已重启，但自动确认暂时不可用：${error.message}`;
  }
  emit(engineRegistered ? "complete" : "pending", engineCheckMessage);
  return { ...installed, engineRegistered, engineCheckMessage };
});
ipcMain.handle("skills:local-list", async () => {
  try {
    const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
    const results = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const file = path.join(userSkillsDir, entry.name, "SKILL.md");
      // 停用是把 SKILL.md 改名成 SKILL.md.disabled：Codex 扫描目录时看不到，技能就真的不生效。
      const disabledFile = path.join(userSkillsDir, entry.name, "SKILL.md.disabled");
      const active = existsSync(file);
      const target = active ? file : disabledFile;
      try {
        const content = await fs.readFile(target, "utf8");
        let market: InstalledMarketSkill | null = null;
        let marketSource: "cocoloop" | "skillhub" | null = null;
        // 市场来源清单：cocoloop 与 skillhub 两种命名都认
        try { market = JSON.parse(await fs.readFile(path.join(userSkillsDir, entry.name, ".cocoloop.json"), "utf8")); marketSource = "cocoloop"; } catch { /* 继续查 skillhub 清单 */ }
        if (!market) { try { market = JSON.parse(await fs.readFile(path.join(userSkillsDir, entry.name, ".skillhub.json"), "utf8")); marketSource = "skillhub"; } catch { /* 本地导入没有市场清单 */ } }
        // .plugin.json 记录「这个技能由哪个插件提供」，钩子页的联动开关靠它定位关联技能
        let pluginId: string | undefined;
        try { pluginId = JSON.parse(await fs.readFile(path.join(userSkillsDir, entry.name, ".plugin.json"), "utf8"))?.pluginId || undefined; } catch { /* 非插件技能没有归属 */ }
        const description = (content.match(/^description:\s*["']?(.+?)["']?\s*$/mi)?.[1] ?? content.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("---")) ?? "本地导入技能").slice(0, 120);
        // 文件夹名是安装 ID（例如 Memory-Setup-7733），技能名必须以 SKILL.md 的 frontmatter 为准，
        // 否则会与 Codex skills/list 返回的规范名（例如 memory-setup）显示成两条。
        const declaredName = content.match(/^name:\s*["']?(.+?)["']?\s*$/mi)?.[1]?.trim();
        // allowed-tools：SKILL.md frontmatter 里声明的工具白名单（复刻 WorkBuddy 的 allowed-tools）。
        // 引擎不做强制（引擎技能对象只有 enabled），这里是给 UI 展示声明的工具范围；不声明则为空。
        const allowedTools = parseSkillAllowedTools(content);
        return { name: declaredName || entry.name, folder: entry.name, path: target, description, enabled: active, pluginId, marketId: market?.marketId, sourceUrl: market?.sourceUrl, installedAt: market?.installedAt, source: marketSource ?? "local", allowedTools, icon: market?.icon, category: market?.category };
      } catch { return null; }
    }));
    return results.filter(Boolean);
  } catch { return []; }
});
/**
 * 解析 SKILL.md frontmatter 里的 allowed-tools 白名单。支持两种 YAML 写法：
 *   allowed-tools:
 *     - Read
 *     - Bash(git:*)
 * 或行内列表：allowed-tools: [Read, Bash]
 * 引擎不强制这个字段（引擎技能对象只有 enabled），这里仅解析展示用；不声明返回空数组。
 */
function parseSkillAllowedTools(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((line) => /^allowed-tools\s*:/i.test(line));
  if (idx < 0) return [];
  // 行内列表写法
  const inline = lines[idx].match(/^allowed-tools\s*:\s*\[(.*)\]\s*$/i);
  if (inline) {
    return inline[1].split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  // 块级列表写法：后续以 "- " 开头的行，直到下一个 frontmatter 键或结束
  const tools: string[] = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!/^-\s+/.test(line)) break; // 不再是列表项
    const tool = line.replace(/^-\s+/, "").replace(/^["']|["']$/g, "").trim();
    if (tool) tools.push(tool);
  }
  return tools;
}

/** 只改文件名，不重启；批量操作由调用方统一重启一次，避免每个技能都拉起一次引擎 */
async function setSkillEnabledSilent(folder: string, enabled: boolean) {
  const resolved = path.resolve(userSkillsDir, String(folder ?? ""));
  if (!resolved.startsWith(path.resolve(userSkillsDir) + path.sep)) throw new Error("非法技能路径");
  const active = path.join(resolved, "SKILL.md");
  const inactive = path.join(resolved, "SKILL.md.disabled");
  if (enabled) {
    if (existsSync(inactive) && !existsSync(active)) await fs.rename(inactive, active);
  } else if (existsSync(active)) {
    await fs.rename(active, inactive);
  }
}
ipcMain.handle("skills:set-enabled", async (_event, input: { folder: string; enabled: boolean }) => {
  await setSkillEnabledSilent(input.folder, Boolean(input.enabled));
  await server.restart();
  return { ok: true };
});
ipcMain.handle("skills:set-enabled-batch", async (_event, input: { folders: string[]; enabled: boolean }) => {
  const folders = Array.isArray(input?.folders) ? input.folders : [];
  const failures: string[] = [];
  for (const folder of folders) {
    try { await setSkillEnabledSilent(folder, Boolean(input.enabled)); }
    catch (error: any) { failures.push(`${folder}：${error.message}`); }
  }
  await server.restart();
  return { ok: failures.length === 0, changed: folders.length - failures.length, failures };
});
ipcMain.handle("skills:local-remove", async (_event, name: string) => {
  const target = path.resolve(userSkillsDir, name);
  if (!target.startsWith(path.resolve(userSkillsDir) + path.sep)) throw new Error("非法技能路径");
  await removeFromSkillRegistry(path.join(target, "SKILL.md"));
  await fs.rm(target, { recursive: true, force: true });
  await server.restart();
  return { ok: true };
});
/**
 * 信任钩子：Codex 默认不执行未信任的钩子（装了等于没装）。
 * 信任记录写在 config.toml 的 [hooks.state."<hook key>"].trusted_hash，
 * 值与 hooks/list 返回的 currentHash 一致；写完后无需重启即可生效。
 */
ipcMain.handle("hooks:trust", async (_event, input: { cwds?: string[] } = {}) => {
  const result: any = await server.request("hooks/list", { cwds: input.cwds ?? [] });
  const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
  const targets = hooks.filter((hook: any) => hook.trustStatus !== "trusted" && hook.currentHash && hook.key);
  if (!targets.length) return { total: hooks.length, trusted: 0, alreadyTrusted: hooks.length, failures: [] };
  const configPath = path.join(codexHome, "config.toml");
  const failures: string[] = [];
  for (const hook of targets) {
    // 钩子 key 里含 Windows 路径反斜杠，写进 TOML 点路径前必须转义，否则会被吞掉、信任记录匹配不上
    const escaped = String(hook.key).split("\\").join("\\\\");
    try {
      await server.request("config/value/write", {
        filePath: configPath,
        keyPath: `hooks.state."${escaped}".trusted_hash`,
        value: hook.currentHash,
        mergeStrategy: "replace",
      });
    } catch (error: any) {
      failures.push(`${hook.eventName ?? hook.key}：${error.message}`);
    }
  }
  return { total: hooks.length, trusted: targets.length - failures.length, alreadyTrusted: hooks.length - targets.length, failures };
});
/** 把 hook key 转义成能安全写进 TOML 点路径的形式（反斜杠与引号都要处理） */
function escapeHookKey(key: string) {
  return String(key).split("\\").join("\\\\").split('"').join('\\"');
}

/** 单条钩子的启停：状态在 config.toml 的 [hooks.state."<key>"] enabled */
async function writeHookEnabled(key: string, enabled: boolean) {
  await server.request("config/value/write", {
    filePath: path.join(codexHome, "config.toml"),
    keyPath: `hooks.state."${escapeHookKey(key)}".enabled`,
    value: Boolean(enabled),
    mergeStrategy: "replace",
  });
}

ipcMain.handle("hooks:set-enabled", async (_event, input: { hookKeys: string[]; enabled: boolean }) => {
  const keys = (Array.isArray(input?.hookKeys) ? input.hookKeys : []).map((key) => String(key ?? "")).filter(Boolean);
  const failures: string[] = [];
  for (const key of keys) {
    try { await writeHookEnabled(key, Boolean(input.enabled)); }
    catch (error: any) { failures.push(`${key}：${error.message}`); }
  }
  return { changed: keys.length - failures.length, failures };
});

/**
 * 联动开关：插件、它的全部钩子、它提供的全部技能一起开/关。
 * 用户要的是「钩子开关联动对应技能与插件」，这里把三处状态一次性对齐：
 *   1. config.toml 的 [plugins."<id>"] enabled
 *   2. 该插件每条钩子的 [hooks.state."<key>"] enabled
 *   3. 技能目录里带 .plugin.json（pluginId 相同）的 SKILL.md ↔ SKILL.md.disabled
 * 最后只重启一次引擎，避免每个技能重启一次导致界面长时间卡住。
 */
ipcMain.handle("plugins:set-linked-enabled", async (_event, input: { pluginId: string; enabled: boolean }) => {
  const pluginId = String(input?.pluginId ?? "");
  if (!pluginId) throw new Error("缺少插件 ID");
  const enabled = Boolean(input.enabled);
  const failures: string[] = [];

  // 市场安装的插件真实 ID 形如 "ponytail@ponytail"（id@市场名），调用方可能传短名。
  // 先从 plugin/list 解析出真实 ID，否则 config 写错键、钩子/技能归属全部匹配不上。
  let targetId = pluginId;
  try {
    const list: any = await server.request("plugin/list", { cwds: [], forceRefetch: false });
    const base = (value: string) => String(value ?? "").split("@")[0];
    const found = (list?.marketplaces ?? []).flatMap((marketplace: any) => marketplace.plugins ?? [])
      .find((plugin: any) => plugin.installed && (plugin.id === pluginId || base(plugin.id) === base(pluginId)));
    if (found?.id) targetId = String(found.id);
  } catch { /* 列表失败时保留原 ID */ }

  // 1. 插件本体
  try {
    await server.request("config/value/write", {
      filePath: path.join(codexHome, "config.toml"),
      keyPath: `plugins."${escapeHookKey(targetId)}".enabled`,
      value: enabled,
      mergeStrategy: "replace",
    });
  } catch (error: any) { failures.push(`插件：${error.message}`); }

  // 2. 该插件提供的钩子（按 pluginId 过滤，用户自定义钩子 source=user 不受影响）
  try {
    const result: any = await server.request("hooks/list", { cwds: [] });
    const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
    for (const hook of hooks.filter((hook: any) => hook.pluginId === targetId)) {
      try { await writeHookEnabled(hook.key, enabled); }
      catch (error: any) { failures.push(`${hook.eventName ?? hook.key}：${error.message}`); }
    }
  } catch (error: any) { failures.push(`读取钩子列表失败：${error.message}`); }

  // 3. 该插件提供的技能（.plugin.json 的 pluginId 可能带市场后缀，按 base 名归一化匹配）
  try {
    const base = (value: string) => String(value ?? "").split("@")[0];
    const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      const dir = path.join(userSkillsDir, entry.name);
      let owner: string | undefined;
      try { owner = JSON.parse(await fs.readFile(path.join(dir, ".plugin.json"), "utf8"))?.pluginId || undefined; } catch { /* 没有归属清单 */ }
      if (!owner || base(owner) !== base(targetId)) continue;
      try { await setSkillEnabledSilent(entry.name, enabled); }
      catch (error: any) { failures.push(`技能 ${entry.name}：${error.message}`); }
    }
  } catch { /* 技能目录不存在时跳过 */ }

  await server.restart();
  return { ok: failures.length === 0, failures };
});

/**
 * 插件启用/停用：Codex 没有 plugin/enable 这类 RPC，开关状态存在
 * config.toml 的 [plugins."<id>"] enabled，通过 config/value/write 改写。
 * 支持批量，最后统一重新拉一次插件列表校验是否真的生效。
 */
ipcMain.handle("plugins:set-enabled", async (_event, input: { pluginIds: string[]; enabled: boolean }) => {
  const ids = (Array.isArray(input?.pluginIds) ? input.pluginIds : []).map((id) => String(id ?? "")).filter(Boolean);
  if (!ids.length) return { changed: 0, failures: [] };
  const configPath = path.join(codexHome, "config.toml");
  const failures: string[] = [];
  const idSet = new Set(ids);
  for (const id of ids) {
    try {
      await server.request("config/value/write", {
        filePath: configPath,
        keyPath: `plugins."${escapeHookKey(id)}".enabled`,
        value: Boolean(input.enabled),
        mergeStrategy: "replace",
      });
    } catch (error: any) {
      failures.push(`${id}：${error.message}`);
    }
  }
  // 联动：插件停用后它提供的钩子在 UI 上也应显示成停用，否则两页状态打架
  try {
    const result: any = await server.request("hooks/list", { cwds: [] });
    const hooks = (result?.data ?? []).flatMap((entry: any) => entry.hooks ?? []);
    for (const hook of hooks.filter((hook: any) => hook.pluginId && idSet.has(hook.pluginId))) {
      try { await writeHookEnabled(hook.key, Boolean(input.enabled)); }
      catch (error: any) { failures.push(`${hook.eventName ?? hook.key}：${error.message}`); }
    }
  } catch (error: any) { failures.push(`读取钩子列表失败：${error.message}`); }
  return { changed: ids.length - failures.length, failures };
});
// —— 连接器 OAuth 授权（跳转官方授权页，授权完成自动保存令牌并重启引擎） ——
type OAuthSession = {
  kind: ConnectorOAuthKind;
  child?: ReturnType<typeof spawn>;
  server?: http.Server;
  timer: NodeJS.Timeout;
  state: string;
};
const oauthSessions = new Map<string, OAuthSession>();

function sendOAuthEvent(payload: { templateId: string; phase: "waiting" | "authorized" | "failed"; message: string; authorizeUrl?: string }) {
  sendToWindow("connectors:oauth-event", payload);
}

function closeOAuthSession(templateId: string) {
  const session = oauthSessions.get(templateId);
  if (!session) return;
  clearTimeout(session.timer);
  if (session.child) try { session.child.kill(); } catch { /* ignore */ }
  if (session.server) try { session.server.close(); } catch { /* ignore */ }
  oauthSessions.delete(templateId);
}

/** 本地回调服务器：接收授权页 redirect 回来的 code/state，返回成功提示页 */
function startCallbackServer(port: number): Promise<{ server: http.Server; waitCode: (state: string, timeoutMs: number) => Promise<{ code: string; state: string; error: string }> }> {
  return new Promise((resolve, reject) => {
    const pending = new Map<string, { resolve: (value: { code: string; state: string; error: string }) => void; timer: NodeJS.Timeout }>();
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const code = parsed.searchParams.get("code") ?? "";
      const state = parsed.searchParams.get("state") ?? "";
      const error = parsed.searchParams.get("error") ?? "";
      const waiter = pending.get(state);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(state);
        if (error) {
          res.writeHead(400);
          res.end(`<h3>授权失败：${error}</h3><p>可以关闭此窗口并回到 Codex Harness。</p>`);
        } else {
          res.writeHead(200);
          res.end("<h3>✅ 授权成功</h3><p>令牌已保存，可以关闭此窗口并回到 Codex Harness。</p>");
        }
        waiter.resolve({ code, state, error });
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({
        server,
        waitCode: (waitState, timeoutMs) => new Promise((resolveWait, rejectWait) => {
          const timer = setTimeout(() => { pending.delete(waitState); rejectWait(new Error("等待授权回调超时，请重试")); }, timeoutMs);
          pending.set(waitState, { resolve: resolveWait, timer });
        }),
      });
    });
  });
}

/** Windows 下 npx 是 npx.cmd，spawn 必须用带扩展名的二进制名，否则 ENOENT；stdio 恒为 pipe，stdout 非空 */
function spawnNpx(args: string[], options: Parameters<typeof spawn>[2] = {}): ChildProcessWithoutNullStreams {
  return spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, { shell: false, windowsHide: true, stdio: "pipe", ...options }) as ChildProcessWithoutNullStreams;
}

/** 飞书：官方 lark-mcp login 子进程回显授权 URL；授权完成后进程以 0 退出并自行保存 token */
function startFeishuLogin(appId: string, appSecret: string, port: number, scopes?: string): Promise<{ authorizeUrl: string; child: ReturnType<typeof spawn> }> {
  return new Promise((resolve, reject) => {
    const args = ["-y", "@larksuiteoapi/lark-mcp", "login", "-a", appId, "-s", appSecret, "--host", "127.0.0.1", "--port", String(port)];
    if (scopes) args.push("--scope", scopes);
    const child = spawnNpx(args);
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { child.kill(); } catch { /* ignore */ } reject(new Error("等待飞书授权地址超时，请确认 App ID/Secret 正确")); }
    }, 60000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/https?:\/\/[^\s"'<>，。]+/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ authorizeUrl: match[0], child });
      }
    });
    child.on("error", (error: Error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`启动飞书授权进程失败：${error.message}`)); }
    });
    child.on("exit", (code) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`飞书授权进程提前退出（code=${code}），请检查 App ID/Secret 与网络`)); }
    });
  });
}

async function exchangeOAuthToken(spec: ConnectorOAuthSpec, params: Record<string, string>): Promise<any> {
  const url = spec.tokenUrl ?? "";
  const body = { ...(spec.tokenParams ?? {}), ...params };
  let response: Response;
  if (spec.tokenMethod === "POST") {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } else {
    response = await fetch(`${url}?${new URLSearchParams(body)}`);
  }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`令牌接口返回 ${response.status}：${JSON.stringify(data)}`);
  return data;
}

async function applyOAuthResult(template: ConnectorTemplate, values: Record<string, string>, secrets: Record<string, string>, accountHint?: string, argsPatch?: { remove: string[]; add: string[] }) {
  const list = await readConnectors();
  const previous = list.find((entry) => entry.id === template.id);
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? "").trim() || `{${key}}`);
  const config: ConnectorConfig = previous ?? {
    id: template.id, name: template.name, transport: template.transport,
    command: template.transport === "stdio" ? template.command : undefined,
    args: template.transport === "stdio" ? (template.args ?? []).map(fill) : undefined,
    url: template.transport === "streamable_http" ? fill(template.url ?? "") : undefined,
    env: { ...template.env },
    envHttpHeaders: template.envHttpHeaders,
    encryptedSecrets: {},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (argsPatch && config.args) {
    const args = [...config.args];
    for (const token of argsPatch.remove) { const index = args.indexOf(token); if (index >= 0) args.splice(index, 1); }
    config.args = [...new Set([...args, ...argsPatch.add])];
  }
  config.encryptedSecrets = { ...(previous?.encryptedSecrets ?? {}), ...Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, safeStorage.encryptString(value).toString("base64")])) };
  config.oauth = { status: "connected", provider: template.id, authorizedAt: Date.now(), accountHint };
  config.updatedAt = new Date().toISOString();
  await writeConnectors([...list.filter((entry) => entry.id !== template.id), config]);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(await readConnectors())); await server.restart(); }
}

ipcMain.handle("connectors:oauth-start", async (_event, input: any) => {
  const templateId = String(input?.templateId ?? "");
  const template = BUILTIN_CONNECTOR_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template?.oauth) throw new Error("该模板不支持 OAuth 授权");
  const values: Record<string, string> = input?.values ?? {};
  const spec = template.oauth;
  const missing = spec.credentialKeys.filter((key) => !String(values[key] ?? "").trim());
  if (missing.length) {
    const labels = missing.map((key) => template.fields.find((field) => field.key === key)?.label ?? key).join("、");
    throw new Error(`请先填写：${labels}`);
  }
  closeOAuthSession(templateId);
  try {
    if (spec.kind === "lark-login") {
      const port = spec.port;
      const { authorizeUrl, child } = await startFeishuLogin(String(values[spec.credentialKeys[0]]).trim(), String(values[spec.credentialKeys[1]]).trim(), port, spec.scopes);
      oauthSessions.set(templateId, { kind: "lark-login", child, timer: setTimeout(() => { closeOAuthSession(templateId); sendOAuthEvent({ templateId, phase: "failed", message: "授权超时，已取消" }); }, 240000), state: "" });
      sendOAuthEvent({ templateId, phase: "waiting", message: "已在浏览器打开飞书授权页，请登录并点击授权", authorizeUrl });
      void shell.openExternal(authorizeUrl);
      child.once("exit", (code) => {
        closeOAuthSession(templateId);
        if (code === 0) {
          void applyOAuthResult(template, values, {}, undefined, { remove: ["--token-mode", "tenant_access_token"], add: ["--oauth", "--token-mode", "user_access_token"] })
            .then(() => sendOAuthEvent({ templateId, phase: "authorized", message: "飞书授权成功，已保存用户令牌并重启引擎" }))
            .catch((error: Error) => sendOAuthEvent({ templateId, phase: "failed", message: `授权成功但保存失败：${error.message}` }));
        } else {
          sendOAuthEvent({ templateId, phase: "failed", message: `飞书授权未完成（进程退出码 ${code}），请重试` });
        }
      });
      return { ok: true, authorizeUrl };
    }
    // http-code：钉钉 / 腾讯文档 —— 本地回调收 code，再换 token
    const port = spec.port;
    const redirectUri = String(values.redirect_uri ?? "").trim() || spec.redirectUri || `http://127.0.0.1:${port}/callback`;
    const state = crypto.randomBytes(8).toString("hex");
    const { server, waitCode } = await startCallbackServer(port);
    oauthSessions.set(templateId, { kind: "http-code", server, timer: setTimeout(() => { closeOAuthSession(templateId); sendOAuthEvent({ templateId, phase: "failed", message: "等待授权超时，已取消" }); }, 240000), state });
    const clientId = String(values[spec.credentialKeys[0]]).trim();
    const clientSecret = String(values[spec.credentialKeys[1]]).trim();
    const authorizeUrl = (spec.authorizeUrl ?? "")
      .replace("{client_id}", encodeURIComponent(clientId))
      .replace("{redirect_uri}", encodeURIComponent(redirectUri))
      .replace("{state}", state);
    sendOAuthEvent({ templateId, phase: "waiting", message: `${template.name}：请在浏览器完成授权`, authorizeUrl });
    void shell.openExternal(authorizeUrl);
    const { code, error } = await waitCode(state, 210000);
    if (error) throw new Error(`${template.name}授权失败：${error}`);
    const tokenData = await exchangeOAuthToken(spec, { client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
    const map = spec.tokenResult ?? { accessToken: "access_token" };
    const accessToken = tokenData[map.accessToken] ?? "";
    if (!accessToken) throw new Error(`令牌接口未返回访问令牌：${JSON.stringify(tokenData)}`);
    const refreshToken = map.refreshToken ? tokenData[map.refreshToken] ?? "" : "";
    const userId = map.userId ? tokenData[map.userId] ?? "" : "";
    const prefix = template.id.toUpperCase().replace("-", "_");
    const secrets: Record<string, string> = { [`${prefix}_OAUTH_TOKEN`]: accessToken };
    if (refreshToken) secrets[`${prefix}_OAUTH_REFRESH`] = refreshToken;
    const accountHint = userId
      ? (template.id === "tencent-docs" ? `OpenID ${userId.slice(0, 8)}…` : `用户 ${userId.slice(0, 8)}…`)
      : template.id === "dingtalk" ? (tokenData.nick ?? tokenData.nickName ?? "") : "";
    await applyOAuthResult(template, values, secrets, accountHint || undefined);
    closeOAuthSession(templateId);
    sendOAuthEvent({ templateId, phase: "authorized", message: `${template.name}授权成功，用户令牌已加密保存` });
    return { ok: true, authorizeUrl };
  } catch (error: any) {
    closeOAuthSession(templateId);
    sendOAuthEvent({ templateId, phase: "failed", message: error.message });
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("connectors:oauth-cancel", (_event, templateId: string) => {
  closeOAuthSession(String(templateId));
  return { ok: true };
});

ipcMain.handle("connectors:list", async () => (await readConnectors()).map(publicConnector));ipcMain.handle("connectors:templates", () => BUILTIN_CONNECTOR_TEMPLATES);
ipcMain.handle("connectors:save", async (_event, input: any) => {
  const id = safeConnectorId(String(input.id ?? input.name ?? ""));
  const name = String(input.name ?? "").trim();
  const transport: ConnectorTransport = input.transport === "streamable_http" ? "streamable_http" : "stdio";
  if (!id || !name) throw new Error("连接器名称不能为空");
  const command = String(input.command ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (transport === "stdio" && !command) throw new Error("stdio 连接器必须填写启动命令");
  if (transport === "streamable_http") {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("HTTP MCP 地址不是合法 URL"); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("HTTP MCP 地址必须使用 http 或 https");
  }
  const list = await readConnectors();
  const previous = list.find((entry) => entry.id === id);
  const secrets: Record<string, string> = Object.fromEntries(Object.entries(input.secrets ?? {}).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => Boolean(key && value)) as [string, string][]);
  if (Object.keys(secrets).length && !safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存连接器密钥");
  const encryptedSecrets = { ...(previous?.encryptedSecrets ?? {}), ...Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, safeStorage.encryptString(value).toString("base64")])) };
  const config: ConnectorConfig = {
    id, name, transport, command: transport === "stdio" ? command : undefined,
    args: transport === "stdio" ? (Array.isArray(input.args) ? input.args.map((value: unknown) => String(value).trim()).filter(Boolean) : []) : undefined,
    url: transport === "streamable_http" ? url : undefined,
    headers: transport === "streamable_http" && input.headers && typeof input.headers === "object" ? Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
    envHttpHeaders: transport === "streamable_http" && input.envHttpHeaders && typeof input.envHttpHeaders === "object" ? Object.fromEntries(Object.entries(input.envHttpHeaders).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
    env: transport === "stdio" && input.env && typeof input.env === "object" ? Object.fromEntries(Object.entries(input.env).map(([key, value]) => [String(key).trim(), String(value ?? "").trim()]).filter(([key, value]) => key && value)) : undefined,
    encryptedSecrets, enabled: input.enabled === undefined ? previous?.enabled ?? true : Boolean(input.enabled), createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await writeConnectors([...list.filter((entry) => entry.id !== id), config]);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(await readConnectors())); await server.restart(); }
  return publicConnector(config);
});
ipcMain.handle("connectors:remove", async (_event, id: string) => {
  const list = await readConnectors();
  const next = list.filter((entry) => entry.id !== id);
  if (next.length === list.length) throw new Error("未找到连接器");
  await writeConnectors(next);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
  return { ok: true };
});
// 单个或批量启用/停用：ids 传一个等价单卡开关，传多个走批量勾选。每次改动都重启引擎使 config.toml 生效
ipcMain.handle("connectors:set-enabled", async (_event, input: { ids?: unknown; enabled?: unknown }) => {
  const ids = Array.isArray(input.ids)
    ? input.ids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (!ids.length) throw new Error("未指定要更新状态的连接器");
  const enabled = input.enabled !== false;
  const list = await readConnectors();
  let updated = 0;
  const next = list.map((entry) => {
    if (!ids.includes(entry.id) || entry.enabled === enabled) return entry;
    updated += 1;
    return { ...entry, enabled, updatedAt: new Date().toISOString() };
  });
  if (!updated) return { ok: true, updated: 0 };
  await writeConnectors(next);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
  return { ok: true, updated };
});

// —— app-server MCP 服务器启停（页面上的「app-server MCP 状态」卡片用） ——
// 同一个入口同时处理两类服务器：名字能匹配到连接器的走 connectors.json，
// 其余（内置 nuphus 等）走覆盖表。渲染层因此不需要区分来源。
// 渲染层只需要 名字 -> 是否启用；原文（toml）是主进程恢复用的内部数据，不外泄
ipcMain.handle("mcp-servers:overrides", async () => {
  const overrides = await readMcpOverrides();
  return Object.fromEntries(Object.entries(overrides).map(([name, entry]) => [name, entry?.enabled !== false]));
});
ipcMain.handle("mcp-servers:set-enabled", async (_event, input: { ids?: unknown; enabled?: unknown }) => {
  const ids = Array.isArray(input.ids)
    ? input.ids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (!ids.length) throw new Error("未指定要更新状态的 MCP 服务");
  const enabled = input.enabled !== false;
  const connectors = await readConnectors();
  const connectorIds = new Set(connectors.map((entry) => entry.id));
  let updated = 0;
  let next = connectors;
  const connectorTargets = ids.filter((id) => connectorIds.has(id));
  if (connectorTargets.length) {
    next = connectors.map((entry) => {
      if (!connectorTargets.includes(entry.id) || entry.enabled === enabled) return entry;
      updated += 1;
      return { ...entry, enabled, updatedAt: new Date().toISOString() };
    });
    if (updated) await writeConnectors(next);
  }
  const overrides = await readMcpOverrides();
  // 覆盖表只管非连接器的服务器（内置 nuphus + 用户手工写在 config.toml 的段 + 已有记录）。
  // 陌生 id 一律忽略：记进去也只是死记录（readUserConfigSplit 会清掉），还白触发一次引擎重启。
  let knownExtra = new Set<string>();
  try {
    knownExtra = new Set(collectMcpServerNames(await fs.readFile(path.join(codexHome, "config.toml"), "utf8")));
  } catch { /* config.toml 还不存在就当没有手工段 */ }
  for (const id of ids) {
    if (connectorIds.has(id)) continue; // 已由连接器处理，别在覆盖表里留下同名垃圾
    if (id !== "nuphus" && !(id in overrides) && !knownExtra.has(id)) continue;
    if (mcpOverrideEnabled(overrides, id) === enabled) continue;
    // 保留已有原文与工具权限：用户手工写的 MCP 靠原文才能启用时拼回，工具权限不能因启停被抹掉
    overrides[id] = { enabled, toml: overrides[id]?.toml, permissions: overrides[id]?.permissions };
    updated += 1;
  }
  await writeMcpOverrides(overrides);
  if (!updated) return { ok: true, updated: 0 };
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else { server.setExternalEnv(connectorEnv(next)); await server.restart(); }
  return { ok: true, updated };
});

// —— MCP 服务器按工具权限（deny/ask/allow）——
// 复刻 WorkBuddy 工具级权限模型：对某个服务器的某个工具设/清权限档位。
// mode 传 "deny" | "ask" | "allow"；传 null 清除该工具规则。改动落覆盖表，
// 重写 config.toml（[permissions.*] 段）并重启引擎。未知服务器 id 直接忽略。
// 读接口返回 { server: { tool: mode } }，供渲染层展示每个工具的当前档位。
ipcMain.handle("mcp-servers:permissions", async () => {
  const overrides = await readMcpOverrides();
  return Object.fromEntries(
    Object.entries(overrides)
      .filter(([, entry]) => entry?.permissions && Object.keys(entry.permissions).length)
      .map(([name, entry]) => [name, entry!.permissions])
  );
});
ipcMain.handle("mcp-servers:set-tool-permission", async (_event, input: { server?: unknown; tool?: unknown; mode?: unknown }) => {
  const serverId = String(input.server ?? "").trim();
  const tool = String(input.tool ?? "").trim();
  if (!serverId || !tool) throw new Error("缺少服务器名或工具名");
  const mode = input.mode == null ? null : String(input.mode);
  if (mode !== null && mode !== "deny" && mode !== "ask" && mode !== "allow") {
    throw new Error(`未知权限档位：${mode}（应为 deny/ask/allow，或传 null 清除）`);
  }
  const overrides = await readMcpOverrides();
  // 陌生服务器不落死记录：只在覆盖表已有记录或已知服务器上生效
  const connectors = await readConnectors();
  let knownExtra = new Set<string>();
  try {
    knownExtra = new Set(collectMcpServerNames(await fs.readFile(path.join(codexHome, "config.toml"), "utf8")));
  } catch { /* config.toml 不存在就当没有手工段 */ }
  const known = serverId === "nuphus" || connectors.some((c) => c.id === serverId) || (serverId in overrides) || knownExtra.has(serverId);
  if (!known) return { ok: true, updated: false, reason: "unknown-server" };

  const permissions = overrides[serverId]?.permissions ?? {};
  if (mode === null) {
    delete permissions[tool];
  } else {
    permissions[tool] = mode;
  }
  // 清空整表就删掉字段，保持覆盖表干净
  overrides[serverId] = { ...overrides[serverId], enabled: overrides[serverId]?.enabled !== false, toml: overrides[serverId]?.toml, ...(Object.keys(permissions).length ? { permissions } : {}) };
  await writeMcpOverrides(overrides);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model); else await server.restart();
  return { ok: true, updated: true, server: serverId, tool, mode };
});

// —— 个性化：称呼 + 自定义指令。走 Codex 原生 AGENTS.md 机制（$CODEX_HOME/AGENTS.md），
// 引擎每个会话开始时自动注入 prompt；纯 Markdown 落盘，无 TOML 转义风险 ——
ipcMain.handle("personalization:read", async () => readPersonalization());
ipcMain.handle("personalization:save", async (_event, input: { nickname?: unknown; customInstructions?: unknown }) => {
  const config = await writePersonalization(input);
  await applyPersonalizationToAgentsMd(config, codexHome);
  const model = await readCustomModel();
  // 重写 config.toml：把迁移前残留在 developer_instructions 里的旧个性化段清掉，并重启引擎
  if (model) await applyCustomModel(model);
  return config;
});

// 应用级运行时开关（联网搜索等）。改完重写 config.toml 让引擎重载生效。
ipcMain.handle("appSettings:read", async (): Promise<AppSettings> => readAppSettings(app.getPath("userData")));
// 外部模型规格规则（userData/model-specs.json）：数据与代码分离，更新模型数据无需重新构建。
// 文件不存在返回 null，渲染层用内置表兜底；更新 JSON 后重启应用生效。
ipcMain.handle("model-specs:read", async () => {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "model-specs.json"), "utf8")); } catch { return null; }
});
ipcMain.handle("appSettings:save", async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
  const next = await saveAppSettings(app.getPath("userData"), patch);
  const model = await readCustomModel();
  if (model) await applyCustomModel(model);
  // 引擎健康看门狗开关即时生效（不依赖重启后的 ready 事件）
  await syncEngineWatchdog();
  return next;
});

// SSH 服务器连接管理：列表 CRUD + 启用开关 + 连接测试 + 命令执行 + 交互式会话（userData/ssh-servers.json）
const sshSessions = new SshSessionManager();
ipcMain.handle("ssh:list", async (): Promise<SshServer[]> => readSshServers(app.getPath("userData")));
ipcMain.handle("ssh:save", async (_event, input: SshServer): Promise<SshServer[]> => {
  const server: SshServer = {
    ...input,
    id: input.id || crypto.randomUUID(),
    port: Number(input.port) || 22,
    createdAt: input.createdAt || new Date().toISOString(),
  };
  return saveSshServer(app.getPath("userData"), server);
});
ipcMain.handle("ssh:delete", async (_event, ids: string[]): Promise<SshServer[]> => {
  const list = Array.isArray(ids) ? ids.map((id) => String(id)) : [String(ids)];
  return deleteSshServer(app.getPath("userData"), list);
});
ipcMain.handle("ssh:set-enabled", async (_event, input: { ids: string[]; enabled: boolean }): Promise<SshServer[]> => {
  const ids = Array.isArray(input?.ids) ? input.ids.map(String) : [];
  return setSshServerEnabled(app.getPath("userData"), ids, Boolean(input?.enabled));
});
ipcMain.handle("ssh:test", async (_event, input: SshServer): Promise<SshTestResult> => {
  try {
    return await testSshConnection(input, (input.connectTimeout && input.connectTimeout > 0 ? input.connectTimeout : 10) * 1000);
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle("ssh:exec", async (_event, input: { server: SshServer; command: string }): Promise<SshExecResult> => {
  try {
    return await execSshCommand(input?.server, String(input?.command ?? ""));
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
});
// 交互式 shell 会话：一次 open 建立一个 ssh2 连接，数据/退出通过窗口事件推送给渲染层
ipcMain.handle("ssh:session-open", async (_event, input: { server: SshServer; cols: number; rows: number }): Promise<{ sessionId: string } | { error: string }> => {
  try {
    return await sshSessions.open(input.server, {
      cols: Number(input?.cols) || 100,
      rows: Number(input?.rows) || 30,
      onData: (data) => sendToWindow("ssh:data", { data }),
      onExit: (info) => sendToWindow("ssh:exit", info),
    });
  } catch (error: any) {
    return { error: error.message };
  }
});
ipcMain.handle("ssh:session-write", (_event, input: { sessionId: string; data: string }) => {
  sshSessions.write(String(input?.sessionId ?? ""), String(input?.data ?? ""));
});
ipcMain.handle("ssh:session-resize", (_event, input: { sessionId: string; cols: number; rows: number }) => {
  sshSessions.resize(String(input?.sessionId ?? ""), Number(input?.cols) || 100, Number(input?.rows) || 30);
});
ipcMain.handle("ssh:session-close", (_event, sessionId: string) => {
  sshSessions.close(String(sessionId));
});
// 导出连接配置：弹出保存对话框，支持「不含凭据」的安全导出
ipcMain.handle("ssh:export", async (_event, input: { servers: SshServer[]; includeSecrets: boolean }): Promise<string | null> => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "导出 SSH 连接配置",
    defaultPath: `ssh-servers-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, exportSshServers(input?.servers ?? [], Boolean(input?.includeSecrets)), "utf8");
  return result.filePath;
});
ipcMain.handle("ssh:import", async (): Promise<SshServer[] | null> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "导入 SSH 连接配置",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  const imported = parseSshImport(await fs.readFile(result.filePaths[0], "utf8"));
  if (!imported.length) return null;
  const current = await readSshServers(app.getPath("userData"));
  const merged = [...current];
  for (const server of imported) merged.push({ ...server, id: crypto.randomUUID() });
  await writeSshServers(app.getPath("userData"), merged);
  return merged;
});
// ── 会话备份导入/导出：导出 = 引擎 rollout 原档 + 元信息打包成单文件 .json；
//    导入 = rollout 原样写回 codex-home/sessions，主进程扫描兜底立即可见，不依赖引擎索引。──
ipcMain.handle("threads:export", async (_event, input?: { threadIds?: string[] }): Promise<{ path: string; count: number } | null> => {
  const ids = Array.isArray(input?.threadIds) && input.threadIds.length ? input.threadIds.map((id) => String(id)) : undefined;
  const backup = buildSessionsBackup(codexHome, ids);
  if (!backup.threads.length) return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const single = ids && ids.length === 1 ? `codex-thread-${ids[0].slice(0, 8)}-${stamp}` : `codex-sessions-backup-${stamp}`;
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: ids?.length === 1 ? "导出会话备份" : "导出全部会话备份",
    defaultPath: `${single}.json`,
    filters: [{ name: "Codex 会话备份", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, JSON.stringify(backup, null, 1), "utf8");
  return { path: result.filePath, count: backup.threads.length };
});
ipcMain.handle("threads:export-markdown", async (_event, input?: { threadIds?: string[] }): Promise<{ path: string; count: number; totalMessages: number } | null> => {
  const ids = Array.isArray(input?.threadIds) && input.threadIds.length ? input.threadIds.map((id) => String(id)) : undefined;
  const md = buildMarkdownExport(codexHome, ids);
  if (!md.count) return null;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const single = ids && ids.length === 1 ? `codex-thread-${ids[0].slice(0, 8)}-${stamp}` : `codex-sessions-${stamp}`;
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: ids?.length === 1 ? "导出会话记录为 Markdown" : "导出全部会话记录为 Markdown",
    defaultPath: `${single}.md`,
    filters: [{ name: "Markdown 对话记录", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, md.markdown, "utf8");
  return { path: result.filePath, count: md.count, totalMessages: md.totalMessages };
});
// 单会话只读全文预览（全局搜索「会话」命中点开）：直接读 rollout 原档渲染消息序列，不动引擎焦点
ipcMain.handle("threads:preview-conversation", (_event, threadId: string) => buildThreadPreview(codexHome, String(threadId ?? "")));
ipcMain.handle("threads:import", async (): Promise<{ path: string; imported: number; skipped: number; threads: { id: string; name: string; status: string }[] } | null> => {
  // 支持两类文件：本应用导出的会话备份（.json）+ 原生 Codex rollout 会话记录（.jsonl，
  // 用户反馈 #10：原生会话记录都是 .jsonl，此前只认 .json 导不进来）。可多选合并导入。
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "导入会话备份 / 原生 Codex 会话记录",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "会话备份 / Codex 会话记录（json, jsonl）", extensions: ["json", "jsonl"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  const merged: any = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), threads: [] };
  for (const filePath of result.filePaths) {
    if (/\.jsonl$/i.test(filePath)) {
      // 原生 Codex rollout：转成本应用备份格式后走同一条写回管线（重导入同会话按 duplicate/conflict 跳过）
      merged.threads.push(...backupFromRolloutFile(filePath).threads);
    } else {
      let parsed: any;
      try {
        parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch (error: any) {
        throw new Error(`${path.basename(filePath)}：不是有效的 JSON 文件（${error.message}）`);
      }
      if (!parsed || parsed.format !== BACKUP_FORMAT || !Array.isArray(parsed.threads)) {
        // .json 但不是本应用备份格式：常见原因是把 rollout 内容存成了 .json，提示改扩展名
        const looksLikeRollout = typeof parsed === "object" && parsed !== null && (parsed.type === "session_meta" || (Array.isArray(parsed) && parsed[0]?.type === "session_meta"));
        throw new Error(
          looksLikeRollout
            ? `${path.basename(filePath)}：这是单条会话记录内容，请把扩展名改为 .jsonl 后再导入`
            : `${path.basename(filePath)}：不是有效的会话备份文件（缺少 format 标记）`
        );
      }
      merged.threads.push(...parsed.threads);
    }
  }
  if (!merged.threads.length) return { path: result.filePaths[0], imported: 0, skipped: 0, threads: [] };
  const summary = applySessionsBackup(codexHome, merged);
  return { path: result.filePaths[0], ...summary };
});
// 导入外部对话记录（主流 AI / 官方 Codex /export 导出的 .md/.txt 文本）→ 自动新建一个命名会话：
// 标题「导入：原会话名」带导入标识，会话本身留空（不自动跑）。渲染层在用户发出该会话第一条
// 消息时，把整段记录附在消息前发给引擎，并把界面折叠成一条可展开的「导入的会话记录」卡。
ipcMain.handle("threads:import-conversation", async (_event, input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }): Promise<{ thread: any; imported: { title: string; fileName: string; turns: number; text: string; at: string } } | null> => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "导入外部会话记录（Markdown）",
    properties: ["openFile"],
    filters: [
      { name: "对话记录（Markdown/文本）", extensions: ["md", "markdown", "txt"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) return null;
  const filePath = result.filePaths[0];
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = parseMarkdownConversation(raw, path.basename(filePath));
  if (!parsed.text.trim()) throw new Error("文件中没有可导入的对话内容");
  // 超出上下文窗口的记录直接拒绝，提示拆分——避免首条消息过大被引擎截断/超窗
  if (parsed.text.length > 400000) throw new Error("记录过长（超过 40 万字符），请先拆分成更小的文件再导入");
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input?.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法新建导入会话");
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input?.cwd || process.cwd(),
    approvalPolicy: input?.approvalPolicy || "never",
    sandbox: input?.sandbox || "workspace-write",
    modelProvider: provider,
    personality: input?.personality || null,
    config: baseUrl ? { model_provider: provider, model_providers: { [provider]: { name, base_url: baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
  });
  const threadName = `导入：${parsed.title || path.basename(filePath, path.extname(filePath))}`.slice(0, 80);
  try { await server.request("thread/name/set", { threadId: started.thread.id, name: threadName }); } catch { /* 命名失败不阻塞进入会话 */ }
  return {
    thread: { ...started.thread, name: threadName },
    imported: { title: parsed.title, fileName: path.basename(filePath), turns: parsed.turns, text: parsed.text, at: new Date().toISOString() },
  };
});
// 私钥文件选择器：设置页「浏览…」按钮
ipcMain.handle("dialog:ssh-key", async (_event, startPath?: string) => {
  const start = startPath && existsSync(path.dirname(startPath)) ? path.dirname(startPath) : undefined;
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择 SSH 私钥文件",
    properties: ["openFile"],
    defaultPath: start,
    filters: [{ name: "SSH 私钥", extensions: ["", "pem", "key", "ppk", "id_rsa", "id_ed25519"] }, { name: "All files", extensions: ["*"] }],
  });
  return result.canceled || !result.filePaths?.length ? null : result.filePaths[0];
});
// 仅更新称呼（昵称）：只写 personalization.json + AGENTS.md，不重启引擎。// AGENTS.md 是 Codex 原生动态加载机制（每个请求都重新读），下次对话即生效，无需重启。
// 用于左下角账户名改名的轻量联动，避免打断正在进行的对话。
ipcMain.handle("personalization:setNickname", async (_event, nickname: unknown) => {
  const current = await readPersonalization();
  const config = await writePersonalization({ nickname, customInstructions: current.customInstructions });
  await applyPersonalizationToAgentsMd(config, codexHome);
  return config;
});
// 回读真实落盘的 AGENTS.md，确认个性化确实在引擎会读取的位置——避免「保存成功但没生效」
// emoji 基础段始终存在：AGENTS.md 永不删除，inSync = 落盘内容与 buildAgentsMd 逐字一致（无论个性化是否为空）
ipcMain.handle("personalization:verify", async () => {
  const stored = await readPersonalization();
  const expects = Boolean(stored.nickname || stored.customInstructions);
  const agentsPath = path.join(codexHome, "AGENTS.md");
  const expectedText = buildAgentsMd(stored);
  let raw = "";
  try { raw = await fs.readFile(agentsPath, "utf8"); }
  catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    // 缺文件：直接补齐基础段（emoji + 中文语言规范），老实例升级后自动生效
    await fs.writeFile(agentsPath, expectedText, "utf8");
    return { exists: true, expects, applied: true, inSync: true, preview: expectedText.trim().slice(0, 2000), agentsPath };
  }
  const applied = Boolean(raw.trim());
  const inSync = raw === expectedText;
  // 生成逻辑与写入共用 buildAgentsMd，逐字一致才算同步。
  // 不一致（如新增了语言基础段、或用户手改过）时重写补齐——AGENTS.md 是
  // 引擎动态加载（每请求重读），重写后下一条消息即生效，无需重启引擎。
  if (raw !== expectedText) {
    await fs.writeFile(agentsPath, expectedText, "utf8");
    return { exists: true, expects, applied: true, inSync: true, preview: expectedText.trim().slice(0, 2000), agentsPath, replayed: true };
  }
  return {
    exists: true,
    expects,
    applied,
    inSync,
    preview: raw.trim().slice(0, 2000),
    agentsPath,
  };
});

// —— 自定义斜杠命令：$CODEX_HOME/commands + <cwd>/.codex/commands 下的 .md 文件 ——
ipcMain.handle("commands:list", async (_event, input: { cwd?: unknown } = {}) => {
  return listCustomCommands(codexHome, input?.cwd ? String(input.cwd) : undefined);
});
ipcMain.handle("commands:read", async (_event, input: { filePath?: unknown; cwd?: unknown } = {}) => {
  const filePath = String(input?.filePath ?? "");
  if (!filePath) return null;
  return readCustomCommand(filePath, codexHome, input?.cwd ? String(input.cwd) : undefined);
});
ipcMain.handle("commands:save", async (_event, input: any) => saveCustomCommand({ ...input, codexHome }));
ipcMain.handle("commands:delete", async (_event, filePath: string) => {
  await deleteCustomCommand(String(filePath ?? ""));
  return { ok: true };
});
// 把命令模板展开成可直接发送的 prompt（参数替换 / @file 注入 / !`cmd` 转执行指令）
ipcMain.handle("commands:expand", async (_event, input: { filePath?: unknown; argument?: unknown; cwd?: unknown }) => {
  const filePath = String(input?.filePath ?? "");
  if (!filePath) throw new Error("缺少命令文件路径");
  const entry = await readCustomCommand(filePath, codexHome, input?.cwd ? String(input.cwd) : undefined);
  if (!entry) throw new Error("命令不存在或已被删除。");
  return { text: await expandCommandTemplate(entry, String(input?.argument ?? ""), input?.cwd ? String(input.cwd) : undefined) };
});

// —— 子智能体（用户自定义；跟随当前会话模型/effort，codex 通过 dynamicTools 真正调用） ——
const subAgentsFile = path.join(app.getPath("userData"), "sub-agents.json");
type SubAgentConfig = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  effort: string;
  inheritModel: boolean;
  model?: string;
  inheritSandbox: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  inheritApproval: boolean;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
async function readSubAgents(): Promise<SubAgentConfig[]> {
  try {
    const list = JSON.parse(await fs.readFile(subAgentsFile, "utf8")) as SubAgentConfig[];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
async function writeSubAgents(list: SubAgentConfig[]) { await fs.writeFile(subAgentsFile, JSON.stringify(list, null, 2), "utf8"); }
function safeAgentId(name: string) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || `agent-${Date.now()}`;
}
ipcMain.handle("subagents:list", async () => {
  const list = await readSubAgents();
  return list;
});
ipcMain.handle("subagents:save", async (_event, input: any) => {
  const list = await readSubAgents();
  const now = new Date().toISOString();
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("子智能体名称不能为空");
  const description = String(input.description ?? "").trim() || `由「${name}」负责的子任务`;
  const systemPrompt = String(input.systemPrompt ?? "").trim() || `你是「${name}」，请按你的角色完成任务并返回结构化结果。`;
  const effort = String(input.effort ?? "high");
  const inheritModel = input.inheritModel !== false;
  const inheritSandbox = input.inheritSandbox !== false;
  const inheritApproval = input.inheritApproval !== false;
  const id = input.id ? safeAgentId(String(input.id)) : safeAgentId(name);
  const config: SubAgentConfig = {
    id, name, description, systemPrompt, effort,
    inheritModel,
    model: inheritModel ? undefined : String(input.model ?? "").trim() || undefined,
    inheritSandbox,
    sandbox: inheritSandbox ? undefined : (input.sandbox ?? "workspace-write"),
    inheritApproval,
    approvalPolicy: inheritApproval ? undefined : (input.approvalPolicy ?? "on-request"),
    enabled: input.enabled !== false,
    createdAt: list.find((entry) => entry.id === id)?.createdAt ?? now,
    updatedAt: now,
  };
  const next = list.some((entry) => entry.id === id) ? list.map((entry) => entry.id === id ? config : entry) : [config, ...list];
  await writeSubAgents(next);
  return config;
});
ipcMain.handle("subagents:remove", async (_event, id: string) => {
  const list = await readSubAgents();
  const next = list.filter((entry) => entry.id !== id);
  await writeSubAgents(next);
  return { ok: true };
});
/** 等待 app-server 的某个回合完成，返回 turn 对象；用于子智能体同步取回结果。 */
function waitForTurnCompletion(threadId: string, turnId: string, timeoutMs = 600_000) {
  return new Promise<any>((resolve, reject) => {
    const handler = (event: any) => {
      if (event.kind !== "notification") return;
      const method = String(event.method ?? "");
      if (!["turn/completed", "turn/aborted", "turn/failed"].includes(method)) return;
      if (event.params?.threadId !== threadId || event.params?.turn?.id !== turnId) return;
      cleanup();
      if (method === "turn/completed") resolve(event.params.turn);
      else reject(new Error(`子智能体回合未正常完成（${method}）`));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("子智能体执行超时（10 分钟）")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); server.off("event", handler); };
    server.on("event", handler);
  });
}

function turnOutputText(turn: any) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const text = items
    .filter((item: any) => item?.type === "agentMessage")
    .map((item: any) => String(item.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  return text || String(turn?.finalMessage ?? "").trim();
}

/**
 * 记忆蒸馏的模型通道：开一个只读的一次性会话把旧日志提炼成长期记忆。
 * 全程标记 internalThreads —— 否则它自己的 turn/completed 会被捕获逻辑当成对话写回日志。
 */
async function distillSummarize(prompt: string, body: string): Promise<string> {
  const model = await readCustomModel();
  const effectiveModel = model?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法蒸馏记忆");
  if (model?.encryptedKey && safeStorage.isEncryptionAvailable()) {
    const apiKey = safeStorage.decryptString(Buffer.from(model.encryptedKey, "base64"));
    if (apiKey) server.setApiKey(apiKey);
  }
  const provider = model?.provider ?? "openai";
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: process.cwd(),
    approvalPolicy: "never",
    sandbox: "read-only",
    modelProvider: provider,
    config: model?.baseUrl
      ? { model_provider: provider, model_providers: { [provider]: { name: model?.name ?? provider, base_url: model.baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } }
      : undefined,
  });
  const threadId = started.thread.id;
  internalThreads.add(threadId);
  try {
    const turn: any = await server.request("turn/start", {
      threadId,
      input: [{ type: "text", text: `${prompt}\n\n下面是原始日志：\n\n${body}`, text_elements: [] }],
      model: effectiveModel,
      effort: "low",
    });
    const turnId = turn.turn?.id;
    if (!turnId) throw new Error("蒸馏回合启动失败：未返回 turnId");
    const completed = await waitForTurnCompletion(threadId, turnId, 300_000);
    return turnOutputText(completed);
  } finally {
    internalThreads.delete(threadId);
  }
}

ipcMain.handle("subagents:invoke", async (_event, input: { id?: string; name?: string; query: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }) => {
  const list = await readSubAgents();
  const key = String(input.id ?? input.name ?? "").trim().toLowerCase();
  const agent = list.find((entry) => entry.id === key || entry.name.trim().toLowerCase() === key);
  if (!agent) throw new Error(`子智能体「${input.id ?? input.name}」不存在`);
  if (!agent.enabled) throw new Error(`子智能体「${agent.name}」已停用`);
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || (agent.inheritModel ? customModel?.model : agent.model) || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法启动子智能体");
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input.cwd || process.cwd(),
    approvalPolicy: agent.inheritApproval ? (input.approvalPolicy ?? "never") : agent.approvalPolicy,
    sandbox: agent.inheritSandbox ? (input.sandbox ?? "workspace-write") : agent.sandbox,
    modelProvider: provider,
    config: baseUrl ? { model_provider: provider, model_providers: { [provider]: { name, base_url: baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
  });
  const systemPrefix = `[子智能体 ${agent.name}] ${agent.systemPrompt}\n\n`;
  const finalQuery = `${systemPrefix}用户任务：${input.query}\n\n完成后请输出结构化结果（关键结论 + 行动步骤 + 任何上下文）；不要主动发起破坏性操作。`;
  const turn: any = await server.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: finalQuery, text_elements: [] }],
    model: effectiveModel,
    effort: input.effort || agent.effort,
  });
  const turnId = turn.turn?.id;
  if (!turnId) throw new Error("子智能体回合启动失败：未返回 turnId");
  const completed = await waitForTurnCompletion(started.thread.id, turnId);
  let output = turnOutputText(completed);
  if (!output) {
    const resumed: any = await server.request("thread/resume", { threadId: started.thread.id, excludeTurns: false }).catch(() => null);
    output = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
  }
  return { threadId: started.thread.id, turnId, name: agent.name, output: output || "（子智能体没有返回文本内容）" };
});

// —— 专家团（Team 型专家）：团队 CRUD + 成员调度（复用子智能体引擎） ——
ipcMain.handle("teams:list", async () => {
  return await readExpertTeams();
});
ipcMain.handle("teams:save", async (_event, input: any) => {
  const list = await readExpertTeams();
  const team = normalizeTeamConfig(input);
  const next = list.some((entry) => entry.teamId === team.teamId)
    ? list.map((entry) => entry.teamId === team.teamId ? team : entry)
    : [team, ...list];
  await writeExpertTeams(next);
  return team;
});
ipcMain.handle("teams:remove", async (_event, teamId: string) => {
  const list = await readExpertTeams();
  await writeExpertTeams(list.filter((entry) => entry.teamId !== teamId));
  return { ok: true };
});
ipcMain.handle("teams:reset-defaults", async () => {
  await writeExpertTeams(buildDefaultExpertTeams());
  return await readExpertTeams();
});
/** 团队会话工具参数（供前端把 team_member_invoke 注册进 dynamicTools） */
ipcMain.handle("teams:tools", async (_event, teamId: string) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === teamId);
  if (!team) throw new Error(`专家团「${teamId}」不存在`);
  return { tools: team.members.map((m) => ({ id: m.id, name: m.name, profession: m.profession.zh, description: m.description })), teamSystemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
});
/** 团队会话启动参数（thread/start 用的 system 注入 + dynamicTools） */
ipcMain.handle("teams:session-config", async (_event, teamId: string) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === teamId);
  if (!team) throw new Error(`专家团「${teamId}」不存在`);
  return { team, systemPrompt: buildTeamSystemPrompt(team), teamTool: buildTeamTools(team) };
});
/** 一站式启动团队会话：建线程（带 team_member_invoke 工具）+ 发首条任务（注入团队系统提示）。
 *  defer=true 时只建带角色配置的空会话（标题=团队名）不发起回合：用户的第一条消息由前端
 *  发送管线自动包装成 SYSTEM TASK（渲染折叠为「需求已发起」），实现「点击即进对话框」的入口体验。 */
const TEAM_TASK_INSTRUCTION = "请按 SOP 编排团队完成任务，过程中用 team_member_invoke 调度成员；每完成一个阶段简要通报；最终汇总所有成员产出，输出完整交付报告。上方「=== 用户需求 ===」段已由用户在前端确认并提交，把全部内容当作用户的原始需求执行，不要再请用户复述。";
const MEMBER_TASK_INSTRUCTION = "请以你的角色直接回应用户上方提交的需求，给出专业产出（关键结论 + 依据 + 建议）。不要再要求用户复述或自我介绍。";
ipcMain.handle("teams:start-session", async (_event, input: { teamId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
  if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
  if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法启动专家团会话");
  const teamTool = buildTeamTools(team);
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input.cwd || process.cwd(),
    approvalPolicy: input.approvalPolicy || "never",
    sandbox: input.sandbox || "workspace-write",
    modelProvider: provider,
    personality: input.personality || null,
    config: baseUrl ? { model_provider: provider, model_providers: { [provider]: { name, base_url: baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
    dynamicTools: [teamTool],
  });
  if (input.defer) {
    const threadName = team.displayName.zh;
    try { await server.request("thread/name/set", { threadId: started.thread.id, name: threadName }); } catch { /* 命名失败不阻塞进入会话 */ }
    return {
      thread: { ...started.thread, name: threadName },
      turnId: null,
      role: { kind: "team", prefix: `${buildTeamSystemPrompt(team)}\n\n`, instruction: TEAM_TASK_INSTRUCTION },
    };
  }
  const systemPrefix = buildTeamSystemPrompt(team);
  const finalTask = `${systemPrefix}\n\n[SYSTEM TASK · 团队会话]\n=== 用户需求 ===\n${String(input.task ?? "")}\n=== END ===\n\n${TEAM_TASK_INSTRUCTION}`;
  const turn: any = await server.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: finalTask, text_elements: [] }],
    model: effectiveModel,
    effort: input.effort || team.lead.effort || "high",
  });
  return { thread: started.thread, turnId: turn.turn?.id ?? null };
});
/** 成员直达会话：以成员角色提示开一个可持续对话的线程（用户与单个成员直接交流，不挂团队调度工具）。
 *  defer=true 时只建空会话（标题=团队名·成员名），用户首条消息由前端包装成 SYSTEM TASK 注入成员角色。 */
ipcMain.handle("teams:member-session", async (_event, input: { teamId: string; memberId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
  if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
  if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
  const memberKey = String(input.memberId ?? "").trim().toLowerCase();
  const member = [team.lead, ...team.members].find((m) => m.id.toLowerCase() === memberKey);
  if (!member) throw new Error(`成员「${input.memberId}」不存在于专家团「${team.displayName.zh}」`);
  const isLead = member.id === team.lead.id;
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || member.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法发起成员会话");
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input.cwd || process.cwd(),
    approvalPolicy: member.approvalPolicy || input.approvalPolicy || "never",
    sandbox: member.sandbox || input.sandbox || "workspace-write",
    modelProvider: provider,
    personality: input.personality || null,
    config: baseUrl ? { model_provider: provider, model_providers: { [provider]: { name, base_url: baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
  });
  const systemPrefix = `[专家团「${team.displayName.zh}」${isLead ? "主理人" : "成员"} ${member.name}（${member.profession.zh}）]\n${member.systemPrompt}\n\n`;
  if (input.defer) {
    // 会话标题只展示角色职能，不把成员真实姓名带到用户界面。
    const threadName = `${team.displayName.zh} · ${member.profession.zh || "成员"}`;
    try { await server.request("thread/name/set", { threadId: started.thread.id, name: threadName }); } catch { /* 命名失败不阻塞进入会话 */ }
    return {
      thread: { ...started.thread, name: threadName },
      turnId: null,
      member: { id: member.id, name: member.name, profession: member.profession.zh },
      role: { kind: "member", prefix: systemPrefix, instruction: MEMBER_TASK_INSTRUCTION },
    };
  }
  const firstTask = String(input.task ?? "").trim();
  if (!firstTask) throw new Error(`请先在对话框描述你的需求`);
  const finalQuery = `${systemPrefix}[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n${firstTask}\n=== END ===\n\n${MEMBER_TASK_INSTRUCTION}`;
  const turn: any = await server.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: finalQuery, text_elements: [] }],
    model: effectiveModel,
    effort: input.effort || member.effort || "high",
  });
  return { thread: started.thread, turnId: turn.turn?.id ?? null, member: { id: member.id, name: member.name, profession: member.profession.zh } };
});
/** 调度一个团队成员在独立会话执行子任务并返回结构化结果（供 team_member_invoke 工具调用） */
ipcMain.handle("teams:invoke-member", async (_event, input: { teamId: string; memberId: string; query: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }) => {
  const list = await readExpertTeams();
  const team = list.find((entry) => entry.teamId === String(input.teamId ?? ""));
  if (!team) throw new Error(`专家团「${input.teamId}」不存在`);
  if (!team.enabled) throw new Error(`专家团「${team.displayName.zh}」已停用`);
  const memberKey = String(input.memberId ?? "").trim().toLowerCase();
  const member = team.members.find((m) => m.id.toLowerCase() === memberKey);
  if (!member) throw new Error(`成员「${input.memberId}」不存在于专家团「${team.displayName.zh}」`);
  const customModel = await readCustomModel();
  const provider = customModel?.provider ?? "openai";
  const baseUrl = customModel?.baseUrl;
  const name = customModel?.name ?? provider;
  const apiKey = customModel?.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(customModel.encryptedKey, "base64")) : "";
  if (apiKey) server.setApiKey(apiKey);
  const effectiveModel = input.model || member.model || customModel?.model;
  if (!effectiveModel) throw new Error("尚未配置自定义模型，无法调度团队成员");
  const started: any = await server.request("thread/start", {
    model: effectiveModel,
    cwd: input.cwd || process.cwd(),
    approvalPolicy: member.approvalPolicy || input.approvalPolicy || "never",
    sandbox: member.sandbox || input.sandbox || "workspace-write",
    modelProvider: provider,
    config: baseUrl ? { model_provider: provider, model_providers: { [provider]: { name, base_url: baseUrl, env_key: "CODEX_HARNESS_API_KEY", wire_api: "responses", requires_openai_auth: false, ...PROVIDER_RETRY_TUNING } } } : undefined,
  });
  const systemPrefix = `[专家团「${team.displayName.zh}」成员 ${member.name}（${member.profession.zh}）]\n${member.systemPrompt}\n\n`;
  const finalQuery = `${systemPrefix}主理人分配的子任务：${input.query}\n\n请按你的角色给出专业产出（关键结论 + 依据 + 建议）；完成后通过 SendMessage 将完整结果回传给主理人。不要发起破坏性操作。`;
  const turn: any = await server.request("turn/start", {
    threadId: started.thread.id,
    input: [{ type: "text", text: finalQuery, text_elements: [] }],
    model: effectiveModel,
    effort: input.effort || member.effort || "high",
  });
  const turnId = turn.turn?.id;
  if (!turnId) throw new Error("成员调度失败：未返回 turnId");
  const completed = await waitForTurnCompletion(started.thread.id, turnId);
  let output = turnOutputText(completed);
  if (!output) {
    const resumed: any = await server.request("thread/resume", { threadId: started.thread.id, excludeTurns: false }).catch(() => null);
    output = turnOutputText(resumed?.thread?.turns?.find((entry: any) => entry.id === turnId));
  }
  return { threadId: started.thread.id, turnId, teamId: team.teamId, memberId: member.id, name: member.name, profession: member.profession.zh, output: output || `（成员 ${member.name} 未返回文本内容）` };
});

ipcMain.handle("clipboard:image", async () => {
  // Electron 44：clipboard.readImage() 已移除，改 W3C 风格 read() → ClipboardItem[] → image/png Blob
  const items = await clipboard.read();
  const item = items.find((entry) => entry.types.includes("image/png"));
  if (!item) return null;
  const blob = await item.getType("image/png");
  if (!(blob instanceof Blob)) return null;
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (!buffer.length) return null;
  await fs.mkdir(imagesDir, { recursive: true });
  const file = path.join(imagesDir, `codex-harness-${Date.now()}.png`);
  await fs.writeFile(file, buffer);
  return file;
});
ipcMain.handle("external:open", async (_event, value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported URL");
  await shell.openExternal(url.toString());
});
ipcMain.handle("shell:reveal", async (_event, target: string) => {
  if (!target) return;
  // 目录用 openPath 在文件管理器打开；文件用 showItemInFolder 定位
  try {
    const st = await fs.stat(target);
    if (st.isDirectory()) await shell.openPath(target);
    else shell.showItemInFolder(target);
  } catch {
    shell.showItemInFolder(target);
  }
});
ipcMain.handle("custom-model:read", async () => publicCustomModel(await readCustomModel()));
ipcMain.handle("custom-model:probe", (_event, input: { provider?: string; baseUrl: string; apiKey?: string; model?: string; wireApi?: "responses" | "chat" | "auto" }) => probeCustomModel(input));
ipcMain.handle("custom-model:save", async (_event, input: { provider: string; name: string; model: string; baseUrl: string; contextWindow?: string | number; wireApi?: "responses" | "chat"; apiKey?: string; models?: ProviderModel[]; enabled?: boolean }) => {
  const provider = input.provider.trim();
  const name = input.name.trim();
  const requestedModel = input.model.trim();
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  const contextWindow = Number(input.contextWindow ?? 128000);
  if (!/^[a-zA-Z0-9_-]+$/.test(provider)) throw new Error("供应商 ID 只能包含字母、数字、下划线和短横线");
  if (!name) throw new Error("供应商名称不能为空");
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 1024) throw new Error("上下文额度必须是大于等于 1024 的整数");
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("Base URL 必须使用 http 或 https");
  const previous = await readCustomModel();
  let encryptedKey = previous?.encryptedKey;
  if (input.apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API Key");
    encryptedKey = safeStorage.encryptString(input.apiKey).toString("base64");
  }
  const wireApi = input.wireApi === "chat" ? "chat" : "responses"; // auto 已在前端探测时落定为实际协议；兜底 responses
  // 合并历史模型列表：前端传来的列表覆盖同 ID 旧项，其余保留，再并入本次生效 model；按 ID 去重保前端传入顺序
  const list = await readCustomModels();
  const existing = list.find((entry) => entry.provider === provider);
  const seen = new Set<string>();
  const mergedModels: ProviderModel[] = [];
  for (const m of input.models ?? []) {
    const id = typeof m === "string" ? m : m?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mergedModels.push(typeof m === "string" ? { id, contextWindow } : m);
  }
  for (const m of existing?.models ?? []) {
    const id = typeof m === "string" ? m : m?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mergedModels.push(typeof m === "string" ? { id, contextWindow: existing?.contextWindow } : m);
  }
  const enabledModels = mergedModels.filter((entry) => entry.enabled !== false);
  const model = requestedModel || enabledModels[0]?.id || "";
  if (!model) throw new Error("至少勾选一个生效模型");
  const saved = withModels({ provider, name, model, baseUrl, contextWindow, wireApi, encryptedKey, enabled: input.enabled ?? existing?.enabled ?? true, models: mergedModels }, model);
  await upsertCustomModel(saved);
  const current = await readCustomModel();
  if (saved.enabled === false && current?.provider !== provider) {
    // 禁用状态的供应商不抢生效位
    return publicCustomModel(saved);
  }
  await fs.writeFile(customModelFile, JSON.stringify(saved, null, 2), "utf8");
  await applyCustomModel(saved);
  return publicCustomModel(saved);
});
ipcMain.handle("custom-model:list", async () => {
  const list = await readCustomModels();
  const current = await readCustomModel();
  const providers = list.length ? list.map(publicCustomModel) : (current ? [publicCustomModel(current)] : []);
  return { providers, current: current?.provider ?? null };
});
ipcMain.handle("custom-model:select", async (_event, providerId: string) => {
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === providerId);
  if (!target) throw new Error("未找到该供应商");
  const next = withModels(target);
  if (next !== target) await upsertCustomModel(next);
  await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
  await applyCustomModel(next);
  return publicCustomModel(next);
});
/** 在同一供应商内切换生效模型：保留 models 列表，只改 model 字段 */
ipcMain.handle("custom-model:set-model", async (_event, input: { provider: string; model: string }) => {
  const model = input.model.trim();
  if (!model) throw new Error("模型 ID 不能为空");
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const next = withModels({ ...target, model }, model);
  await upsertCustomModel(next);
  await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
  await applyCustomModel(next);
  return publicCustomModel(next);
});
/** 添加或更新供应商下的一个模型（按模型 ID 匹配）；新模型不自动生效 */
ipcMain.handle("custom-model:upsert-model", async (_event, input: { provider: string; model: ProviderModel }) => {
  const id = input.model.id?.trim();
  if (!id) throw new Error("模型 ID 不能为空");
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const models = [...(target.models ?? [])];
  const index = models.findIndex((m) => m.id === id);
  if (index >= 0) models[index] = { ...models[index], ...input.model, id }; else models.push({ ...input.model, id });
  const next: CustomModelFile = { ...target, models };
  await upsertCustomModel(next);
  const current = await readCustomModel();
  // 改的是当前生效供应商：必须重写 model-catalog.json + 重启引擎，否则用户改的
  // contextWindow 不会进引擎链路 —— 引擎会继续用旧 catalog 的 fallback (~128K)，
  // 表现为「UI 显示 12.8 万，但模型配置里写的是 1M」。
  if (current?.provider === input.provider) {
    await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
    await applyCustomModel(next);
  }
  return publicCustomModel(next);
});
/** 从供应商的模型列表里删掉一个；允许删空，删的是当前模型时自动切到剩余模型 */
ipcMain.handle("custom-model:remove-model", async (_event, input: { provider: string; modelId: string }) => {
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const models = (target.models ?? []).filter((m) => m.id !== input.modelId);
  const next: CustomModelFile = { ...target, models, model: target.model === input.modelId ? (models[0]?.id ?? "") : target.model };
  await upsertCustomModel(next);
  const current = await readCustomModel();
  if (current?.provider === input.provider) {
    await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
    await applyCustomModel(next);
  }
  return publicCustomModel(next);
});
/** 启用/禁用供应商；禁用当前供应商时清空生效配置并重启 Codex */
ipcMain.handle("custom-model:set-enabled", async (_event, input: { provider: string; enabled: boolean }) => {
  const list = await readCustomModels();
  const target = list.find((entry) => entry.provider === input.provider);
  if (!target) throw new Error("未找到该供应商");
  const next: CustomModelFile = { ...target, enabled: input.enabled };
  await upsertCustomModel(next);
  const current = await readCustomModel();
  const isCurrent = current?.provider === input.provider;
  if (!input.enabled && isCurrent) {
    await fs.writeFile(customModelFile, "null", "utf8");
    await server.restart();
    return publicCustomModel(next);
  }
  if (input.enabled && !current) {
    // 没有生效供应商时，启用即生效
    await fs.writeFile(customModelFile, JSON.stringify(next, null, 2), "utf8");
    await applyCustomModel(next);
    return publicCustomModel(next);
  }
  return publicCustomModel(next);
});
ipcMain.handle("custom-model:remove", async (_event, providerId: string) => {
  const list = await readCustomModels();
  const next = list.filter((entry) => entry.provider !== providerId);
  await writeCustomModels(next);
  const current = await readCustomModel();
  if (current?.provider === providerId) {
    // 删除当前供应商只改变模型配置，绝不能触碰 codex-home/sessions。
    // 还有可用供应商时直接切到下一家，避免引擎短暂进入“无模型”状态；没有时
    // 才清空当前模型。两条路径都会保留同一个 CODEX_HOME，因此本地会话仍可列出。
    const fallback = next.find((entry) => entry.enabled !== false) ?? null;
    if (fallback) {
      const normalized = withModels(fallback);
      await fs.writeFile(customModelFile, JSON.stringify(normalized, null, 2), "utf8");
      await applyCustomModel(normalized);
      return { ok: true, current: publicCustomModel(normalized) };
    }
    await fs.writeFile(customModelFile, "null", "utf8");
    await server.restart();
    return { ok: true, current: null };
  }
  return { ok: true, current: current ? publicCustomModel(current) : null };
});
ipcMain.handle("channel-bot:read", async () => publicChannelBot(await readChannelBot()));
ipcMain.handle("channel-bot:save", (_event, input: unknown) => saveChannelBot(input));
ipcMain.handle("channel-bot:test", async (_event, input: unknown) => {
  const config = await normalizeChannelBot(input);
  if (!config.appId || !config.appSecret) throw new Error("测试连接需要 App ID 和 App Secret");
  return channelBot.test(config);
});
ipcMain.handle("memory:list", (_event, category?: string) => memoryStore.list(category));
ipcMain.handle("memory:search", (_event, query: string, workspace?: string) => memoryStore.search(query, 8, { workspace }));
ipcMain.handle("memory:recall", (_event, query: string, workspace?: string) => memoryStore.recall(query, { workspace }));
ipcMain.handle("memory:mode-read", async () => readMemoryMode());
ipcMain.handle("memory:mode-set", async (_event, mode: MemoryMode) => {
  if (mode === "cloud" && !(await readMemoryGateway())?.endpoint) throw new Error("请先配置云端 Gateway 地址，再切到云端记忆");
  return applyMemoryMode(mode === "cloud" ? "cloud" : "local");
});
ipcMain.handle("memory:save", (_event, input: unknown) => memoryStore.upsert(input as { content: string; category: MemoryCategory; sourceThreadId?: string; sourceTurnId?: string; confidence?: number }));
ipcMain.handle("memory:delete", (_event, id: string) => memoryStore.remove(id));
ipcMain.handle("memory:reset", () => memoryStore.reset());
ipcMain.handle("memory:gateway:read", async () => { const value = await readMemoryGateway(); return { ...memoryStore.remoteStatus(), sessionKey: value?.sessionKey ?? "", userId: value?.userId ?? "codex-harness", hasApiKey: Boolean(value?.apiKey) }; });
ipcMain.handle("memory:gateway:save", (_event, input: unknown) => saveMemoryGateway(input));
ipcMain.handle("memory:layers:read", (_event, workspace?: string) => memoryLayers.snapshot(workspace));
ipcMain.handle("memory:layers:context", (_event, workspace?: string, includeWorkspace = true) => memoryLayers.context(workspace, includeWorkspace));
ipcMain.handle("memory:workspace-enabled:read", (_event, workspace?: string) => workspaceMemoryEnabled(workspace));
ipcMain.handle("memory:workspace-enabled:set", (_event, input: { workspace?: string; enabled?: boolean }) => {
  if (!input?.workspace) throw new Error("尚未选择工作区");
  return setWorkspaceMemoryEnabled(input.workspace, Boolean(input.enabled));
});
ipcMain.handle("memory:layers:write", async (_event, input: { scope: "user" | "background" | "project"; content: string; workspace?: string }) => {
  if (input.scope === "user") await memoryLayers.writeUser(input.content ?? "");
  else if (input.scope === "background") {
    if (!input.workspace) throw new Error("尚未选择工作区，无法保存项目背景");
    await memoryLayers.writeBackground(input.workspace, input.content ?? "");
  }
  else {
    if (!input.workspace) throw new Error("尚未选择工作区，无法保存项目记忆");
    await memoryLayers.writeProject(input.workspace, input.content ?? "");
  }
  return memoryLayers.snapshot(input.workspace);
});
ipcMain.handle("memory:distill", async (_event, workspace?: string) => {
  if (!workspace) throw new Error("尚未选择工作区，无法蒸馏项目记忆");
  const result = await memoryLayers.distill(workspace, distillSummarize, true);
  if (!result.ok) throw new Error(result.reason ?? "没有需要蒸馏的日志");
  return result;
});
ipcMain.handle("rpa:list", () => rpaStore.listRecipes());
ipcMain.handle("rpa:save", (_e, input: unknown) => rpaStore.saveRecipe(input as Parameters<RpaStore["saveRecipe"]>[0]));
ipcMain.handle("rpa:delete", (_e, id: string) => rpaStore.deleteRecipe(id));
ipcMain.handle("rpa:record", (_e, input: { id: string; ok: boolean; error?: string }) => rpaStore.recordRun(input.id, input.ok, input.error));
ipcMain.handle("tasks:list", () => rpaStore.listTasks());
ipcMain.handle("tasks:add", (_e, input: unknown) => rpaStore.addTask(input as { text: string; priority?: "low" | "medium" | "high" }));
ipcMain.handle("tasks:update", (_e, input: { id: string; patch: unknown }) => rpaStore.updateTask(input.id, input.patch as any));
ipcMain.handle("tasks:delete", (_e, id: string) => rpaStore.deleteTask(id));
ipcMain.handle("memory:gateway:test", async (_event, input: any) => {
  const endpoint = String(input.endpoint ?? "").trim().replace(/\/$/, "");
  if (!endpoint) throw new Error("请填写 Memory Gateway 地址");
  const startedAt = Date.now();
  const response = await fetch(`${endpoint}/health`, { headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
  return { ok: true, latencyMs: Date.now() - startedAt, health: await response.json() };
});
ipcMain.handle("scheduler:list", () => scheduler.list());
ipcMain.handle("scheduler:save", (_event, input: unknown) => scheduler.save(input as any));
ipcMain.handle("scheduler:delete", (_event, id: string) => scheduler.remove(id));
ipcMain.handle("scheduler:run", (_event, id: string) => scheduler.runNow(id));

// ── 退出统一清理：确保所有子进程/服务都被终止，应用「退得干净」 ──
// 覆盖：引擎(codex.exe)、node-pty 终端、CloakBrowser 助手、远程隧道+HTTP 服务、
// 频道机器人 HTTP、调度器、微信/Telegram 网关轮询。
let cleanupDone = false;
function cleanupAll() {
  if (cleanupDone) return;
  cleanupDone = true;
  // node-pty 终端：逐个 kill（intentionalKill 置位，不弹「进程已退出」）
  for (const terminal of terminals.values()) { try { terminal.kill(); } catch { /* 已退出 */ } }
  terminals.clear();
  // CloakBrowser 常驻助手
  try { cloakProc?.kill(); } catch { /* 已退出 */ }
  cloakProc = null;
  // 远程控制：隧道(cloudflared) + HTTP 服务
  remote.stop();
  // 频道机器人 HTTP 服务、调度器、引擎子进程
  void channelBot.stop();
  scheduler.stop();
  server.stop();
  // 微信/Telegram 网关：停止轮询循环
  weixinGateway?.stop();
  telegramGateway.stop();
}

app.on("window-all-closed", () => {
  cleanupAll();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  // 兜底：无论窗口事件如何，退出前都清理一次（幂等，cleanupDone 去重）
  cleanupAll();
  // SSH 会话持有 ssh2 连接，不主动断开会让退出流程挂住
  sshSessions.closeAll();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
