/// <reference types="vite/client" />

/** 与 electron/main.ts 的 ProviderModel 对应：供应商下的单个模型配置 */
type ProviderModelConfig = {
  id: string;
  enabled?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputTypes?: ("text" | "image" | "video")[];
  outputTypes?: ("text" | "image" | "video")[];
  /** 该模型支持的思考档位（按声明顺序）；缺省 low/medium/high */
  efforts?: string[];
};

/** 与 electron/main.ts 的 CustomModelFile 对应（不含 encryptedKey，改为 hasKey） */
type CustomModelState = {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  contextWindow: number;
  wireApi?: "responses" | "chat";
  hasKey?: boolean;
  models?: ProviderModelConfig[];
  enabled?: boolean;
};

type ProviderSummary = CustomModelState;

type SubAgentEntry = {
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

/** 记忆分层快照（L0 用户档案 / L1 项目记忆 / L2 每日日志） */
type MemoryLayersSnapshot = {
  user: string;
  background: string;
  project: string;
  hasWorkspace: boolean;
  paths: { user: string; projectDir: string; background: string; project: string; logDir: string };
  logs: { date: string; chars: number }[];
  budget: { user: number; background: number; project: number; logs: number; total: number; over: boolean };
  pendingDistill: { dates: string[]; chars: number };
  lastDistillAt?: number;
};

type ExpertTeamMember = {
  id: string;
  name: string;
  profession: { zh: string; en: string };
  description: string;
  systemPrompt: string;
  effort?: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
};

/** defer 预建空会话的「首条待注入角色」：用户在空会话发出第一条消息时，
 *  发送管线把它包装成 SYSTEM TASK 段（渲染折叠为「需求已发起」，只展示用户原文）。 */
type ExpertPendingRole = {
  kind: "team" | "member";
  /** 角色系统提示（以 \n\n 结尾，拼在 [SYSTEM TASK 之前） */
  prefix: string;
  /** === END === 之后追加的编排/执行指令 */
  instruction: string;
};

/** 待附上的外部导入对话记录：用户在导入新建的空会话发出首条消息时，整段记录随消息发给引擎 */
type PendingImportPayload = {
  title: string;
  fileName: string;
  turns: number;
  text: string;
  /** 导入时间 ISO 字符串 */
  at: string;
};

type ExpertTeamConfig = {
  teamId: string;
  displayName: { zh: string; en: string };
  profession: { zh: string; en: string };
  description: { zh: string; en: string };
  category: string;
  tags: { zh: string; en: string }[];
  quickPrompts: { zh: string; en: string }[];
  lead: ExpertTeamMember;
  members: ExpertTeamMember[];
  sop: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type MarketSkillEntry = {
  id: string; name: string; description: string; category: string; subCategory?: string; icon: string; author: string;
  securityLevel: string; sourceCredibility: string; downloads: string; favorites: string; downloadUrl: string; detailUrl: string;
};
type PluginMarketEntry = {
  slug: string; name: string; displayName: string; description: string; category: string; logo: string;
  author: string; repository: string; pluginPath: string; version: string; githubStars: number;
  installs: number; homepage: string; source: string; featured: boolean; hasSkills: boolean; hasMcpServers: boolean;
};
type PluginMarketInstallResult = { id: string; name: string; path: string; version: string; description: string; marketId: string; sourceUrl: string; engineRegistered?: boolean; engineCheckMessage?: string };
type LocalSkillEntry = { name: string; folder?: string; path: string; description: string; marketId?: string; pluginId?: string; sourceUrl?: string; installedAt?: string; engineRegistered?: boolean; engineCheckMessage?: string; source?: "cocoloop" | "skillhub" | "local"; enabled?: boolean; allowedTools?: string[]; icon?: string; category?: string };
type PersonalizationConfig = { nickname?: string; customInstructions?: string };

/** SSH 跳板机（ProxyJump）配置 */
type SshJumpHost = {
  host: string;
  port?: number;
  username: string;
  authType?: "password" | "key";
  password?: string;
  privateKey?: string;
  keyPath?: string;
  passphrase?: string;
};
/** SSH 服务器连接配置（与 electron/ssh-servers.ts 的 SshServer 对应） */
type SshServer = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
  keyPath?: string;
  passphrase?: string;
  enabled: boolean;
  createdAt: string;
  group?: string;
  tags?: string[];
  notes?: string;
  favorite?: boolean;
  startupCommand?: string;
  remotePath?: string;
  keepaliveInterval?: number;
  connectTimeout?: number;
  termType?: string;
  jumpHost?: SshJumpHost | null;
  lastConnectedAt?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestError?: string;
  lastTestLatencyMs?: number;
  lastFingerprint?: string;
  lastServerInfo?: { hostname?: string; uname?: string; user?: string; uptime?: string; os?: string };
};
type SshTestResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  fingerprint?: string;
  serverInfo?: { hostname?: string; uname?: string; user?: string; uptime?: string; os?: string };
  authMethods?: string[];
};
type SshExecResult = { ok: boolean; stdout?: string; stderr?: string; code?: number; latencyMs?: number; error?: string };
type CommandSource = "global" | "project";
type CustomCommandEntry = {
  name: string;
  filePath: string;
  source: CommandSource;
  relativePath: string;
  description: string;
  argumentHint: string;
  allowedTools: string;
  model: string;
  disableModelInvocation: boolean;
  body: string;
  raw: string;
  updatedAt: number;
};
type SaveCommandInput = {
  name: string;
  source: CommandSource;
  description?: string;
  argumentHint?: string;
  allowedTools?: string;
  model?: string;
  body: string;
  prevFilePath?: string;
  cwd?: string;
};
type ConnectorEntry = { id: string; name: string; transport: "stdio" | "streamable_http"; command?: string; args?: string[]; url?: string; createdAt: string; updatedAt: string; hasSecrets: boolean; headerKeys: string[]; envKeys: string[]; envHttpHeaderKeys: string[]; enabled?: boolean; oauth?: { status: "connected"; provider: string; authorizedAt: number; accountHint?: string } };
type ConnectorDraft = { id?: string; name: string; transport: "stdio" | "streamable_http"; command?: string; args?: string[]; url?: string; headers?: Record<string, string>; env?: Record<string, string>; envHttpHeaders?: Record<string, string>; secrets?: Record<string, string> };
type ConnectorTemplateField = { key: string; label: string; placeholder: string; secret?: boolean; hint?: string; envVar?: string; tokenFor?: string; optional?: boolean };
type ConnectorOAuthKind = "lark-login" | "http-code";
type ConnectorOAuthSpec = { kind: ConnectorOAuthKind; port: number; credentialKeys: string[]; redirectUri?: string; authorizeUrl?: string; tokenUrl?: string; tokenMethod?: "GET" | "POST"; tokenParams?: Record<string, string>; tokenResult?: { accessToken: string; refreshToken?: string; userId?: string }; scopes?: string; note?: string };
type ConnectorOAuthEvent = { templateId: string; phase: "waiting" | "authorized" | "failed"; message: string; authorizeUrl?: string };
type ConnectorTemplate = { id: string; name: string; vendor: string; summary: string; helpUrl: string; transport: "stdio" | "streamable_http"; command?: string; args?: string[]; url?: string; envHttpHeaders?: Record<string, string>; env: Record<string, string>; fields: ConnectorTemplateField[]; oauth?: ConnectorOAuthSpec; oauthNote?: string };

type CodexEvent = {
  kind: "notification" | "request" | "status" | "log";
  method?: string;
  id?: string | number;
  params?: any;
  status?: "starting" | "ready" | "stopped" | "error";
  message?: string;
};
type DevRuntimeEntry = { id: string; name: string; description: string; size: string; marker: string; builtIn?: boolean; kind?: "download" | "browsers" | "guide"; installed: boolean; installedBySystem?: boolean; installing: boolean };

interface Window {
  codex: {
    request(method: string, params?: unknown): Promise<any>;
    respond(id: string | number, result: unknown): Promise<void>;
    getUsername(): Promise<string>;
    getUserData(): Promise<string>;
    setAwake(on: boolean): Promise<boolean>;
    showNotification(title: string, body: string): Promise<boolean>;
    remoteStart(): Promise<{ port: number; url: string }>;
    remoteStatus(): Promise<{ status: string; devices: any[]; url: string }>;
    remoteDevices(): Promise<any[]>;
    remoteSend(cmd: string): Promise<{ ok: boolean }>;
    remoteStop(): Promise<{ ok: boolean }>;
    remoteQrcode(botId?: string): Promise<string>;
    botBindQrcode(botId: string, botName: string): Promise<{ qr: string; url: string; code: string }>;
    botBindStatus(code: string): Promise<"waiting" | "confirmed" | "expired">;
    botBindConsume(code: string): Promise<{ botId: string; deviceName?: string } | null>;
    weixinStartLogin(): Promise<{ qrcodeImg: string; qrcode: string } | null | undefined>;
    weixinCancelLogin(): Promise<{ ok: boolean }>;
    weixinPollLogin(): Promise<{ status: string; verifyCodeRequired?: boolean; connected?: boolean } | null | undefined>;
    weixinStatus(): Promise<{ bound: boolean }>;
    weixinLogout(): Promise<{ ok: boolean }>;
    telegramLogout(): Promise<{ ok: boolean }>;
    feishuConnect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    feishuLogout(): Promise<{ ok: boolean }>;
    dingtalkConnect(clientId: string, clientSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    dingtalkLogout(): Promise<{ ok: boolean }>;
    qqConnect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    qqQrStart(): Promise<{ state: string; qr?: string; name?: string; error?: string }>;
    qqQrStatus(): Promise<{ state: string; qr?: string; name?: string; error?: string }>;
    qqQrCancel(): Promise<{ ok: boolean }>;
    feishuQrStart(): Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>;
    feishuQrStatus(): Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>;
    feishuQrCancel(): Promise<{ ok: boolean }>;
    qqLogout(): Promise<{ ok: boolean }>;
    wecomWebhookConnect(url: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    wecomWebhookLogout(): Promise<{ ok: boolean }>;
    wecomWebhookTest(text?: string): Promise<{ ok: boolean; error?: string }>;
    botBindingGet(): Promise<{ wechat: { threadId: string; title: string; updatedAt: number } | null; telegram: { threadId: string; title: string; updatedAt: number } | null }>;
    botBindingSet(input: { channel: string; threadId: string | null; title?: string }): Promise<{ threadId: string; title: string; updatedAt: number } | null>;
    homeDir(): Promise<string>;
    onBotBindingChanged(handler: (bindings: unknown) => void): () => void;
    botStreamGet(): Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>;
    botStreamSet(input: { enabled: boolean; thinking: boolean; tools: boolean }): Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>;
    channelsStatus(): Promise<{ weixin: boolean; telegram: boolean; feishu?: boolean; dingtalk?: boolean; qq?: boolean; "wecom-webhook"?: boolean }>;
    telegramConnect(token: string): Promise<{ ok: boolean; username?: string; error?: string }>;
    telegramStatus(): Promise<{ bound: boolean }>;
    ponytailModeGet(): Promise<string>;
    ponytailModeSet(mode: string): Promise<{ mode: string }>;
    onRemoteCommand(listener: (payload: { command: string; device: { id: string; name: string } }) => void): () => void;
    onRemoteDevice(listener: (device: { id: string; name: string }) => void): () => void;
    writeFile(path: string, content: string, root: string): Promise<void>;
    readFile(path: string): Promise<{ dataBase64: string; size: number }>;
    fileExists(path: string): Promise<{ exists: boolean }>;
    chooseDirectory(): Promise<string | null>;
    chooseImages(): Promise<string[]>;
    chooseFiles(): Promise<string[]>;
    importSkill(): Promise<{ name: string; path: string; source: string; content: string } | null>;
    listMarketSkills(input?: { category?: string; page?: number; pageSize?: number; query?: string }): Promise<{ items: MarketSkillEntry[]; total: number; page: number; pageSize: number }>;
    installMarketSkill(skill: MarketSkillEntry): Promise<LocalSkillEntry>;
    listMarketPlugins(input?: { category?: string; query?: string; page?: number; pageSize?: number }): Promise<{ items: PluginMarketEntry[]; total: number; page: number; pageSize: number }>;
    installMarketPlugin(plugin: PluginMarketEntry): Promise<PluginMarketInstallResult>;
    listLocalSkills(): Promise<LocalSkillEntry[]>;
    setEnabledSkill(input: { folder: string; enabled: boolean }): Promise<{ ok: boolean }>;
    setEnabledSkillBatch(input: { folders: string[]; enabled: boolean }): Promise<{ ok: boolean; changed: number; failures: string[] }>;
    setPluginEnabled(input: { pluginIds: string[]; enabled: boolean }): Promise<{ changed: number; failures: string[] }>;
    removeLocalSkill(name: string): Promise<{ ok: boolean }>;
    trustHooks(cwds?: string[]): Promise<{ total: number; trusted: number; alreadyTrusted: number; failures: string[] }>;
    setHookEnabled(input: { hookKeys: string[]; enabled: boolean }): Promise<{ changed: number; failures: string[] }>;
    setPluginLinkedEnabled(input: { pluginId: string; enabled: boolean }): Promise<{ ok: boolean; failures: string[] }>;
    listConnectors(): Promise<ConnectorEntry[]>;
    listConnectorTemplates(): Promise<ConnectorTemplate[]>;
    saveConnector(input: ConnectorDraft): Promise<ConnectorEntry>;
    removeConnector(id: string): Promise<{ ok: boolean }>;
    setConnectorsEnabled(ids: string[], enabled: boolean): Promise<{ ok: boolean; updated: number }>;
    startConnectorOAuth(input: { templateId: string; values: Record<string, string> }): Promise<{ ok: boolean; authorizeUrl?: string; message?: string }>;
    cancelConnectorOAuth(templateId: string): Promise<{ ok: boolean }>;
    onConnectorOAuth(listener: (event: ConnectorOAuthEvent) => void): () => void;
    readClipboardImage(): Promise<string | null>;
    /** app-server 直管 MCP 的启用覆盖表；没记过的一律视为启用 */
    readMcpServerOverrides(): Promise<Record<string, boolean>>;
    /** 统一入口：名字能匹配连接器的走连接器，其余走覆盖表；每次改动都会重启引擎 */
    setMcpServersEnabled(ids: string[], enabled: boolean): Promise<{ ok: boolean; updated: number }>;
    /** 各 MCP 服务器的按工具权限档位：{ 服务器: { 工具: "deny"|"ask"|"allow" } } */
    readMcpToolPermissions(): Promise<Record<string, Record<string, "deny" | "ask" | "allow">>>;
    /** 设置/清除某个 MCP 工具的权限档位；mode 传 null 清除。改动后引擎重启生效 */
    setMcpToolPermission(server: string, tool: string, mode: "deny" | "ask" | "allow" | null): Promise<{ ok: boolean; updated: boolean; reason?: string }>;
    readPersonalization(): Promise<PersonalizationConfig>;
    savePersonalization(input: { nickname?: string; customInstructions?: string }): Promise<PersonalizationConfig>;
    /** 应用级运行时开关（联网搜索等） */
    readAppSettings(): Promise<{ webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; autoCompactRatio?: number; engineProxyUrl?: string; hardwareAcceleration?: "auto" | "force" | "off" }>;
    saveAppSettings(patch: { webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; autoCompactRatio?: number; engineProxyUrl?: string; hardwareAcceleration?: "auto" | "force" | "off" }): Promise<{ webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean }>;
    themeApply(theme: string): Promise<{ ok: boolean }>;
    /** SSH 服务器连接管理：列表 CRUD、批量启停、连接测试、命令执行、交互式会话、导入导出 */
    listSshServers(): Promise<SshServer[]>;
    saveSshServer(server: SshServer): Promise<SshServer[]>;
    deleteSshServers(ids: string[]): Promise<SshServer[]>;
    setSshServersEnabled(ids: string[], enabled: boolean): Promise<SshServer[]>;
    testSshServer(server: SshServer): Promise<SshTestResult>;
    execSshCommand(server: SshServer, command: string): Promise<SshExecResult>;
    sshSessionOpen(server: SshServer, cols: number, rows: number): Promise<{ sessionId: string } | { error: string }>;
    sshSessionWrite(sessionId: string, data: string): Promise<void>;
    sshSessionResize(sessionId: string, cols: number, rows: number): Promise<void>;
    sshSessionClose(sessionId: string): Promise<void>;
    exportSshServers(servers: SshServer[], includeSecrets: boolean): Promise<string | null>;
    importSshServers(): Promise<SshServer[] | null>;
    /** 会话备份：导出 = 打包引擎 rollout 原档 + 元信息为 .json；threadIds 缺省/空数组 = 全部 */
    exportThreadsBackup(threadIds?: string[]): Promise<{ path: string; count: number } | null>;
    /** 会话记录导出为通用 Markdown（主流 AI 可直接读取/带入）；threadIds 缺省/空数组 = 全部 */
    exportThreadsMarkdown(threadIds?: string[]): Promise<{ path: string; count: number; totalMessages: number } | null>;
    /** 单会话只读全文预览（读 rollout 原档，不动引擎焦点）；无此会话返回 null */
    previewConversation(threadId: string): Promise<{
      id: string;
      name: string;
      updatedAt: number;
      cwd: string;
      archived: boolean;
      messages: { role: "user" | "assistant"; text: string }[];
      truncated: number;
      truncatedMessages: number;
    } | null>;
    importThreadsBackup(): Promise<{ path: string; imported: number; skipped: number; threads: { id: string; name: string; status: string }[] } | null>;
    /** 导入外部对话记录（主流 AI / 官方 Codex 导出的 .md/.txt）→ 自动新建命名会话并返回；会话留空，首条消息由渲染层附上记录全文 */
    importConversationMarkdown(input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }): Promise<{
      thread: Thread;
      imported: { title: string; fileName: string; turns: number; text: string; at: string };
    } | null>;
    chooseSshKey(startPath?: string): Promise<string | null>;
    onSshData(listener: (payload: { data: string }) => void): () => void;
    onSshExit(listener: (payload: { code?: number; signal?: string; error?: string }) => void): () => void;
    /** 仅更新称呼：写 personalization.json + AGENTS.md，不重启引擎 */
    setNickname(nickname: string): Promise<PersonalizationConfig>;
    /** 回读真实落盘的 AGENTS.md，确认个性化确实写进了引擎会读取的位置 */
    verifyPersonalization(): Promise<{
      exists: boolean;
      expects: boolean;
      applied: boolean;
      inSync: boolean;
      preview: string;
      agentsPath: string;
    }>;
    listCommands(input?: { cwd?: string }): Promise<CustomCommandEntry[]>;
    readCommand(filePath: string): Promise<CustomCommandEntry | null>;
    saveCommand(input: SaveCommandInput): Promise<CustomCommandEntry>;
    deleteCommand(filePath: string): Promise<{ ok: boolean }>;
    expandCommand(input: { filePath: string; argument?: string; cwd?: string }): Promise<{ text: string }>;
    getCustomModel(): Promise<CustomModelState | null>;
    probeCustomModel(config: unknown): Promise<{ status: number; latencyMs: number; models: string[]; model?: string; ok?: boolean; via?: "models" | "stream" | "builtin" | "official" | "official-fallback"; wireUsed?: "responses" | "chat" }>;
    readModelSpecs(): Promise<unknown[] | null>;
    saveCustomModel(config: unknown): Promise<CustomModelState>;
    listCustomModels(): Promise<{ providers: ProviderSummary[]; current: string | null }>;
    selectCustomModel(providerId: string): Promise<CustomModelState>;
    setProviderModel(input: { provider: string; model: string }): Promise<CustomModelState>;
    upsertProviderModel(input: { provider: string; model: ProviderModelConfig }): Promise<CustomModelState>;
    removeProviderModel(input: { provider: string; modelId: string }): Promise<CustomModelState>;
    setProviderEnabled(input: { provider: string; enabled: boolean }): Promise<CustomModelState>;
    removeCustomModel(providerId: string): Promise<{ ok: boolean; current: CustomModelState | null }>;
    getChannelBot(): Promise<any>;
    saveChannelBot(config: unknown): Promise<any>;
    testChannelBot(config: unknown): Promise<{ ok: boolean; latencyMs: number }>;
    listMemory(category?: string): Promise<any[]>;
    searchMemory(query: string): Promise<any[]>;
    recallMemory(query: string, workspace?: string): Promise<{ context: string; remote: boolean; memoryCount?: number }>;
    readMemoryMode(): Promise<"local" | "cloud">;
    setMemoryMode(mode: "local" | "cloud"): Promise<"local" | "cloud">;
    saveMemory(input: unknown): Promise<any>;
    listRpaRecipes(): Promise<any[]>;
    saveRpaRecipe(input: unknown): Promise<any>;
    deleteRpaRecipe(id: string): Promise<void>;
    recordRpaRun(input: { id: string; ok: boolean; error?: string }): Promise<void>;
    listTasks(): Promise<any[]>;
    addTask(input: { text: string; priority?: string }): Promise<any>;
    updateTask(input: { id: string; patch: unknown }): Promise<any>;
    deleteTask(id: string): Promise<void>;
    deleteMemory(id: string): Promise<void>;
    resetMemory(): Promise<void>;
    getMemoryGateway(): Promise<any>;
    saveMemoryGateway(config: unknown): Promise<any>;
    testMemoryGateway(config: unknown): Promise<{ ok: boolean; latencyMs: number; health: any }>;
    readMemoryLayers(workspace?: string): Promise<MemoryLayersSnapshot>;
    readMemoryContext(workspace?: string, includeWorkspace?: boolean): Promise<{ text: string; stats: { chars: number; over: boolean } }>;
    writeMemoryLayer(input: { scope: "user" | "background" | "project"; content: string; workspace?: string }): Promise<MemoryLayersSnapshot>;
    readWorkspaceMemoryEnabled(workspace?: string): Promise<boolean>;
    setWorkspaceMemoryEnabled(input: { workspace: string; enabled: boolean }): Promise<boolean>;
    distillMemory(workspace?: string): Promise<{ ok: boolean; dates: string[]; added: number; reason?: string }>;
    listScheduledTasks(): Promise<any[]>;
    saveScheduledTask(input: unknown): Promise<any>;
    deleteScheduledTask(id: string): Promise<void>;
    runScheduledTask(id: string): Promise<void>;
    listSubAgents(): Promise<SubAgentEntry[]>;
    saveSubAgent(input: unknown): Promise<SubAgentEntry>;
    removeSubAgent(id: string): Promise<{ ok: boolean }>;
    invokeSubAgent(input: { id?: string; name?: string; query: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }): Promise<{ threadId: string; turnId?: string; name: string; output: string }>;
    listExpertTeams(): Promise<ExpertTeamConfig[]>;
    saveExpertTeam(input: unknown): Promise<ExpertTeamConfig>;
    removeExpertTeam(teamId: string): Promise<{ ok: boolean }>;
    resetExpertTeams(): Promise<ExpertTeamConfig[]>;
    getTeamTools(teamId: string): Promise<{ tools: { id: string; name: string; profession: string; description: string }[]; teamSystemPrompt: string; teamTool: any }>;
    getTeamSessionConfig(teamId: string): Promise<{ team: ExpertTeamConfig; systemPrompt: string; teamTool: any }>;
    startTeamSession(input: { teamId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }): Promise<{ thread: any; turnId: string | null; role?: ExpertPendingRole | null }>;    startTeamMemberSession(input: { teamId: string; memberId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }): Promise<{ thread: any; turnId: string | null; member: { id: string; name: string; profession: string }; role?: ExpertPendingRole | null }>;
    invokeTeamMember(input: { teamId: string; memberId: string; query: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }): Promise<{ threadId: string; turnId?: string; teamId: string; memberId: string; name: string; profession: string; output: string }>;
    terminalInput(id: string, data: string): Promise<void>;
    terminalResize(id: string, cols: number, rows: number): Promise<void>;
    restartTerminal(id: string, cwd?: string): Promise<void>;
    terminalReady(): Promise<void>;
    gitDiff(cwd: string, scope: string): Promise<{ code: number | null; output: string }>;
    toolStatus(): Promise<{ id: string; name: string; scope: "computer" | "browser"; version: string; installed: boolean; binaryReady: boolean; detail: string; command: string }[]>;
    listRuntimes(): Promise<DevRuntimeEntry[]>;
    installRuntime(id: string): Promise<{ ok: boolean; runtimes: DevRuntimeEntry[] }>;
    onRuntimeProgress(listener: (event: { id: string; message: string; done?: boolean; failed?: boolean; auto?: boolean }) => void): () => void;
    openInCloakBrowser(url: string): Promise<{ ok: boolean; detail: string }>;
    cloakBrowserStatus(): Promise<{ event?: string; message?: string; url?: string; title?: string }>;
    onTerminalData(listener: (id: string, data: string) => void): () => void;
    openExternal(url: string): Promise<void>;
    browserPopout(url: string): Promise<{ ok: boolean }>;
    shellReveal(target: string): Promise<void>;
    doctor(cwd?: string): Promise<{ checks: { label: string; ok: boolean; detail: string }[]; at: number }>;
    engineInfo(): Promise<{
      codexHome: string; binary: string; binaryExists: boolean; version: string; running: boolean;
      userData: string; agentsMd: boolean; configToml: boolean;
      logFile: { path: string; size: number; modifiedAt: number } | null;
      databases: { name: string; size: number }[]; sessions: number; archived: number;
    }>;
    /** 数据管理：各数据目录占用（bytes）与是否可清理 */
    storageInfo(): Promise<{
      items: { key: string; label: string; bytes: number; deletable: boolean }[];
      userData: string; engineLog: string; imagesDir: string;
    }>;
    /** 缓存清理：仅支持安全目标（引擎日志 / 本地图片缓存），绝不删会话历史 */
    storageClear(target: "engine-log" | "images"): Promise<{ ok: boolean; target: string; error?: string }>;
    readBuiltinPlugins(): Promise<{ image?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string }; vision?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string } }>;
    engineCheckUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }>;
    enginePerformUpdate(): Promise<{ ok: boolean; version: string; message: string }>;
    relaunchApp(): Promise<void>;
    onEngineUpdateProgress(listener: (event: { stage: string; detail?: string; percent?: number }) => void): () => void;
    saveBuiltinPlugins(cfg: unknown): Promise<unknown>;
    probeBuiltinModels(input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }): Promise<{ models: string[] }>;
    generateImage(input: { baseUrl: string; apiKey: string; model: string; prompt: string }): Promise<{ url: string }>;
    describeImage(input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }): Promise<{ text: string }>;
    relayLogin(input: { baseUrl: string; email: string; password: string }): Promise<{ email: string; baseUrl: string; balance: number }>;
    relayLoadAccount(): Promise<{ baseUrl: string; email: string; loggedIn: boolean; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyName: string | null } | null>;
    relayLogout(): Promise<{ ok: boolean; remaining: number }>;
    relayAccounts(): Promise<{ id: string; baseUrl: string; email: string; loggedIn: boolean; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyName: string | null; active: boolean; disabled: boolean }[]>;
    relayToggleAccount(input: { id: string; disabled: boolean }): Promise<{ ok: boolean; disabled: boolean; deactivated?: boolean }>;
    openaiToggleAccount(input: { id: string; disabled: boolean }): Promise<{ ok: boolean; disabled: boolean; deactivated?: boolean }>;
    relaySwitchAccount(id: string): Promise<{ ok: boolean; baseUrl: string; email: string }>;
    relayRemoveAccount(id: string): Promise<{ ok: boolean; activeId: string | null }>;
    openaiLoginStart(input?: { proxy?: string }): Promise<{ started: boolean }>;
    openaiLoginStatus(): Promise<{ loggedIn: boolean; email: string; url: string; code: string; childAlive: boolean; error: string; lines: string }>;
    openaiLoginCancel(): Promise<{ ok: boolean }>;
    openaiUsage(input?: { email?: string }): Promise<any>;
    openaiSetProxy(proxy: string): Promise<{ ok: boolean }>;
    openaiModels(): Promise<string[]>;
    openaiCaptureLogin(): Promise<{ id: string; email: string; total: number }>;
    openaiAccounts(): Promise<{ id: string; email: string; savedAt: number; active: boolean; disabled: boolean; planType: string; subscriptionUntil: string }[]>;
    openaiAccountRemove(id: string): Promise<{ ok: boolean; total: number }>;
    openaiAccountSwitch(id: string): Promise<{ ok: boolean; email: string }>;
    relayKeysAll(): Promise<{ id: string; email: string; baseUrl: string; active: boolean; selectedKeyId: number | null; keys: any[]; error?: string }[]>;
    relayOverview(): Promise<{ baseUrl: string; email: string; balance: number; subscriptions: any[]; keys: any[]; groups: any[]; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyId: number | null; selectedKeyName: string | null }>;
    relayCreateKey(input: { name: string; groupId?: number | null }): Promise<{ id: number; key: string; name: string; group_id: number | null; status: string }>;
    relaySelect(input: { mode: "balance" | "plan"; groupId: number | null; keyId?: number; keyName?: string }): Promise<{ ok: boolean }>;
    relayKeyBilling(input: { baseUrl: string; apiKey: string }): Promise<any>;
    enhancePrompt(text: string): Promise<{ ok: boolean; text?: string; error?: string }>;
    listTerminals(): Promise<{ id: string; alive: boolean; cwd: string }[]>;
    validatePlugin(target: string): Promise<{ ok: boolean; root: string; manifestPath?: string; issues: string[]; inventory: { skills: number; commands: number; agents: number; hooks: number }; name?: string }>;
    chooseDirectoryAt(startPath: string): Promise<string | null>;
    onEvent(listener: (event: CodexEvent) => void): () => void;
    onChannelBotEvent(listener: (event: any) => void): () => void;
    onHarnessEvent(listener: (event: any) => void): () => void;
    // 自更新：网页源（发布站）/ GitHub Releases 双源可切换
    updateCheck(input?: { source?: "web" | "github" }): Promise<{ ok: boolean; info?: { hasUpdate: boolean; reason: string; version?: string; filename?: string; size?: number; sha256?: string; changelog?: string; mandatory?: boolean; downloadUrl?: string }; currentVersion?: string; serverUrl?: string; source?: string; error?: string }>;
    updateDownload(input: { downloadUrl: string; filename?: string }): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
    updateInstall(filePath: string): Promise<{ ok: boolean; error?: string }>;
    updateReveal(filePath: string): Promise<{ ok: boolean }>;
    /** 订阅下载进度（0~1），返回取消订阅函数 */
    updateOnProgress(callback: (percent: number) => void): () => void;
  };
}
