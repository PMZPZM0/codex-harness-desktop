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
  /** 用户为该模型选定的思考档位（档案持久化；切供应商/切模型时自动应用） */
  effort?: string;
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
  /** 当前生效模型的思考档位（档案同步；config.toml 顶层 model_reasoning_effort 同源） */
  effort?: string;
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

/** 记忆分层快照（L1.5 坑与纪律 / L0 用户档案 / L1 项目记忆 / L2 每日日志） */
type MemoryLayersSnapshot = {
  user: string;
  background: string;
  project: string;
  /** L1.5 踩坑与纪律（LESSONS.md 全文；注入时排在最前） */
  lessons: string;
  hasWorkspace: boolean;
  paths: { user: string; projectDir: string; background: string; project: string; lessons: string; logDir: string };
  logs: { date: string; chars: number }[];
  budget: { user: number; background: number; project: number; lessons: number; logs: number; total: number; over: boolean };
  /** 记忆金字塔八层水位（L0–L7；needDistill = 已达 90% 蒸馏线） */
  layers?: {
    id: string;
    name: string;
    where: string;
    budget: number;
    used: number;
    ratio: number | null;
    needDistill: boolean;
    writer: string;
    sink: string;
  }[];
  pendingDistill: { dates: string[]; chars: number };
  /** L2 纪律与记忆的分类计数（用户纠错 / 用户偏好 / 工作流-SOP / 任务经验） */
  lessonGroups?: { category: string; count: number; chars: number }[];
  lastDistillAt?: number;
  /** L3 碎片池健康度（09-22 补）：生命周期与淘汰对用户可见 */
  entries?: {
    total: number;
    byCategory: Record<string, number>;
    pinned: number;
    expiring: number;
    expiringSoon: number;
    prunedTotal: number;
    lastPruneAt: number;
    max: number;
    ttlDays: number;
  };
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

/** 专家团一次成员委托的运行记录（主进程落盘，见 electron/team-runs.ts）。 */
type TeamMemberRunRecord = {
  runId: string;
  leadThreadId: string;
  teamId: string;
  memberId: string;
  memberName: string;
  profession: string;
  role: "lead" | "member";
  memberThreadId: string;
  query: string;
  output: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  endedAt?: number;
  error?: string;
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

/** 可被 Codex 调度的对象（专家 / 专家团 / 团队成员 / 子智能体） */
type DispatchTargetEntry = {
  kind: "expert" | "team" | "member" | "subagent";
  key: string;
  name: string;
  profession: string;
  description: string;
  teamId?: string;
  memberId?: string;
};

/** 被调度产生的临时会话登记记录（侧栏标记 / 归档都读它） */
type DelegateRecordEntry = {
  threadId: string;
  originThreadId: string;
  kind: "expert" | "team" | "member" | "subagent";
  name: string;
  depth: number;
  status: "running" | "done" | "failed";
  startedAt: number;
  endedAt?: number;
  archived?: boolean;
  error?: string;
  /** 实时产出（调度头像弹窗用；跑完是完整产出） */
  output?: string;
};

type MarketSkillEntry = {
  id: string; name: string; description: string; category: string; subCategory?: string; icon: string; author: string;
  securityLevel: string; sourceCredibility: string; downloads: string; favorites: string; downloadUrl: string; detailUrl: string;
};
type PluginMarketEntry = {
  slug: string; name: string; displayName: string; description: string; category: string; logo: string;
  author: string; repository: string; pluginPath: string; version: string; githubStars: number;
  installs: number; homepage: string; source: string; featured: boolean; hasSkills: boolean; hasMcpServers: boolean;
  /** SkillHub 源（2026-10-01 换源）：分类中文名 + GitHub 定位（安装时主进程探 .claude-plugin 入口） */
  categoryZh?: string; fullName?: string; owner?: string; defaultBranch?: string; license?: string; installability?: string;
};
type PluginMarketInstallResult = { id: string; name: string; path: string; version: string; description: string; marketId: string; sourceUrl: string; engineRegistered?: boolean; engineCheckMessage?: string };
type LocalSkillEntry = { name: string; folder?: string; path: string; description: string; descriptionZh?: string; marketId?: string; pluginId?: string; sourceUrl?: string; installedAt?: string; engineRegistered?: boolean; engineCheckMessage?: string; source?: "cocoloop" | "skillhub" | "local"; enabled?: boolean; allowedTools?: string[]; icon?: string; category?: string; /** 专家市场包元技能（.skillhub.json kind=skillset） */ skillset?: boolean };
type PersonalizationConfig = { nickname?: string; customInstructions?: string; assistantName?: string; userContext?: string; onboarded?: boolean; greeted?: boolean };

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
type DevRuntimeEntry = { id: string; name: string; description: string; size: string; marker: string; builtIn?: boolean; kind?: "download" | "browsers" | "guide" | "plugin"; noUninstall?: boolean; installed: boolean; installedBySystem?: boolean; installing: boolean };

/**
 * 归一化后的 IPC 错误（09-24，preload 的 `__ipc` 包装产出）。
 * ⛔⛔ **跨 contextBridge 时自定义字段会丢**：真机验证渲染层 `catch (e) => e.code` 是
 * `undefined`（结构化克隆只保留 message/stack）⇒ **渲染层请用 `src/lib/ipc-error.mjs` 的
 * `ipcErrorCodeOf(e)` / `ipcErrorChannelOf(e)` 解析**（错误码同时写在消息前缀
 * `[ERR_XXX] <channel>: …` 里，正是为了跨进程后仍可读）。本类型用于主进程/preload 同进程场景。
 * 码表：ERR_MISSING_ARGS 参数个数不足（渲染层前置拦下）· ERR_NO_HANDLER 主进程没注册该通道
 *   · ERR_UNCLONABLE 返回值不可结构化克隆 · ERR_BAD_ARGS 参数非法 · ERR_TIMEOUT 超时 · ERR_INVOKE_FAILED 其它
 * ⛔ 超时只有登记进 preload 的 `IPC_TIMEOUT_MS` 的通道才会触发（默认不超时，与历史行为一致）。
 */
type IpcErrorCode = "ERR_MISSING_ARGS" | "ERR_NO_HANDLER" | "ERR_UNCLONABLE" | "ERR_BAD_ARGS" | "ERR_TIMEOUT" | "ERR_INVOKE_FAILED";
interface IpcError extends Error {
  code: IpcErrorCode;
  /** 出错的通道名（如 "ssh:delete"），便于日志聚合与按接口定位 */
  channel: string;
  /** 原始错误（Electron 包装前） */
  cause?: unknown;
}

/* ── 截图与收藏夹（09-24）────────────────────────────────────────────
   截图：full = 隐藏窗口截整屏；region = 冻结帧框选。两种模式各绑一条全局快捷键。
   收藏：跨会话/跨项目的用户素材（对话片段 / 截图 / 文件 / 链接），
        真相源 = 主进程 userData/favorites.json（渲染层只做展示与增删，不自己存）。 */
type ShotMode = "full" | "region";
type ShotHotkey = { enabled: boolean; accelerator: string };
type ScreenshotSettings = { full: ShotHotkey; region: ShotHotkey; hideWindow: boolean; saveDir: string };
type ScreenshotSettingsSnapshot = {
  settings: ScreenshotSettings;
  /** 实际注册成功的加速键（空串 = 该模式当前没挂上） */
  registered: Record<ShotMode, string>;
  /** 注册失败原因（被占用 / 与另一模式重复）；有键即表示失败，设置页照实显示 */
  errors: Partial<Record<ShotMode, string>>;
  defaultDir: string;
  /** 主进程的默认值（「恢复默认」用它，渲染层不另抄一份常量） */
  defaults: ScreenshotSettings;
  platform: string;
};
type ShotCaptureResult =
  | { ok: true; path: string; width: number; height: number; mode: ShotMode }
  | { ok: false; canceled?: boolean; error?: string };
/** `screenshot:captured` 事件的载荷（成功才有；渲染层据此把截图放进输入框） */
type ScreenshotCapturedPayload = { ok: true; path: string; width: number; height: number; mode: ShotMode; at: number };
type FavoriteKind = "text" | "image" | "file" | "link";
type FavoriteSource = { threadId?: string; threadName?: string; turnId?: string; messageId?: string; role?: string };
type FavoriteItem = {
  id: string;
  kind: FavoriteKind;
  title: string;
  content: string;
  note?: string;
  tags: string[];
  source?: FavoriteSource;
  createdAt: string;
  updatedAt: string;
  useCount: number;
  lastUsedAt?: string;
};
type FavoriteDeleteResult = { items: FavoriteItem[]; removed: number };
/** 写入记忆金字塔的层：user=L0 用户档案 · project=L1 项目记忆 · background=L3 项目背景 · lessons=L2 纪律 */
type MemoryLayerScope = "user" | "project" | "background" | "lessons";
type FavoritesToMemoryResult = { ok: boolean; written: number; error?: string };

/* ── 桌面宠物（09-30）：官方 Codex 宠物格式 ────────────────────────────────────
   宠物包 = pet.json + 图集（8 列 × N 行、默认每帧 192×208）；
   九态行名（顺序即行序）：idle / running-right / running-left / waving / jumping /
   failed / waiting / running / review。⛔ 行名与行序是**官方格式**，别重排。 */
type PetStateName = "idle" | "running-right" | "running-left" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";
type PetPackage = {
  id: string;
  name: string;
  description: string;
  /** 宠物包目录（内置的在 dist/pets 下，用户的在 userData/pets 下） */
  dir: string;
  /** 图集绝对路径（渲染层经 pet:// 协议取用；校验失败时为空串） */
  spritesheet: string;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  states: string[];
  source: "builtin" | "user" | "codex" | "petdex";
  /** 校验不通过的原因（渲染层灰显并照实显示） */
  problem?: string;
};
type PetSettings = {
  /** 是否在桌面显示宠物 */
  enabled: boolean;
  /** 当前生效的宠物 id（null = 第一只可用的） */
  active: string | null;
  scale: number;
  opacity: number;
  x: number | null;
  y: number | null;
};
type PetSignal = {
  state: PetStateName;
  bubble: string;
  busy: number;
  tool: string | null;
  ts: number;
};
type PetRootInfo = { dir: string; source: string; exists: boolean; writable: boolean };
type PetBounds = { x: number; y: number; width: number; height: number };
type PetStatus = { settings: PetSettings; active: PetPackage | null };

interface Window {
  codex: {
    /* ⛔ invoke 方法签名由 scripts/gen-ipc-bridge.mjs 生成（两标记之间勿手改）。 */
/* ═══ gen:begin（由 scripts/gen-ipc-bridge.mjs 生成，源 ipc-channels.manifest.json，勿手改）═══ */
    request(method: string, params?: unknown): Promise<any>;
    respond(id: string | number, result: unknown): Promise<void>;
    getUsername(): Promise<string>;
    getUserData(): Promise<string>;
    setAwake(on: boolean): Promise<boolean>;
    showNotification(title: string, body: string): Promise<boolean>;
    toolStatus(): Promise<{ id: string; name: string; scope: "computer" | "browser"; version: string; installed: boolean; binaryReady: boolean; detail: string; command: string }[]>;
    listRuntimes(): Promise<DevRuntimeEntry[]>;
    openInCloakBrowser(url: string): Promise<{ ok: boolean; detail: string }>;
    cloakBrowserStatus(): Promise<{ event?: string; message?: string; url?: string; title?: string }>;
    remoteStart(): Promise<{ port: number; url: string }>;
    remoteStatus(): Promise<{ status: string; devices: any[]; url: string }>;
    remoteDevices(): Promise<any[]>;
    remoteSend(cmd: string): Promise<{ ok: boolean }>;
    remoteStop(): Promise<{ ok: boolean }>;
    remoteQrcode(botId?: string): Promise<string>;
    remotePairState(): Promise<{ code: string; pending: { rid: string; deviceId: string; name: string; createdAt: number }[]; approved: { deviceId: string; name: string; approvedAt: number; lastSeen: number }[] }>;
    remotePairRotate(): Promise<{ code: string }>;
    remoteApprove(rid: string): Promise<{ ok: boolean }>;
    remoteDeny(rid: string): Promise<{ ok: boolean }>;
    remoteRevoke(deviceId: string): Promise<{ ok: boolean }>;
    botPairState(): Promise<{ code: string; pending: { rid: string; channel: string; chatId: string; name: string; createdAt: number }[]; approved: { key: string; channel: string; chatId: string; name: string; approvedAt: number }[] }>;
    botApprove(rid: string): Promise<{ ok: boolean }>;
    botDeny(rid: string): Promise<{ ok: boolean }>;
    botRevoke(key: string): Promise<{ ok: boolean }>;
    botBindQrcode(botId: string, botName: string): Promise<{ qr: string; url: string; code: string }>;
    botBindStatus(code: string): Promise<"waiting" | "confirmed" | "expired">;
    botBindConsume(code: string): Promise<{ botId: string; deviceName?: string } | null>;
    weixinStatus(): Promise<{ bound: boolean }>;
    weixinCancelLogin(): Promise<{ ok: boolean }>;
    weixinLogout(): Promise<{ ok: boolean }>;
    telegramLogout(): Promise<{ ok: boolean }>;
    feishuLogout(): Promise<{ ok: boolean }>;
    dingtalkLogout(): Promise<{ ok: boolean }>;
    qqQrCancel(): Promise<{ ok: boolean }>;
    qqLogout(): Promise<{ ok: boolean }>;
    feishuQrCancel(): Promise<{ ok: boolean }>;
    wecomWebhookLogout(): Promise<{ ok: boolean }>;
    botsGet(): Promise<any[]>;
    homeDir(): Promise<string>;
    telegramStatus(): Promise<{ bound: boolean }>;
    ponytailModeGet(): Promise<string>;
    ponytailModeSet(mode: string): Promise<{ mode: string }>;
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
    /* 共享技能池（09-27）：按项目查看/管理全局技能生效集 */
    describeSkillPool(input: { cwd: string }): Promise<{ skills: { name: string; globalDisabled: boolean; projectDisabled: boolean; active: boolean }[] }>;
    /* 设置全局停用/本项目禁用并立即投影 */
    setSkillPoolState(input: { cwd: string; name: string; globalDisabled?: boolean; projectDisabled?: boolean }): Promise<{ ok: boolean }>;
    setPluginEnabled(input: { pluginIds: string[]; enabled: boolean }): Promise<{ changed: number; failures: string[] }>;
    removeLocalSkill(input: { folder: string; name?: string }): Promise<{ ok: boolean; engineRemoved?: boolean; engineCheckMessage?: string }>;
    trustHooks(cwds?: string[]): Promise<{ total: number; trusted: number; alreadyTrusted: number; failures: string[] }>;
    setHookEnabled(input: { hookKeys: string[]; enabled: boolean }): Promise<{ changed: number; failures: string[] }>;
    /* 09-24 新增：顶栏 🔍 历史会话搜索。扫 codex-home rollout 原档（sessions/** + archived_sessions/**）搜对话内容；先 indexOf 快速否决再解析，>32MB 跳过并计数 */
    searchHistory(input?: { query?: string; limit?: number }): Promise<{ threads: { threadId: string; title: string; archived: boolean; updatedAt: number; matchCount: number; matches: { role: string; ts: string; snippet: string }[] }[]; scannedFiles: number; skippedLarge: number; elapsedMs: number }>;
    setPluginLinkedEnabled(input: { pluginId: string; enabled: boolean }): Promise<{ ok: boolean; failures: string[] }>;
    listConnectors(): Promise<ConnectorEntry[]>;
    listConnectorTemplates(): Promise<ConnectorTemplate[]>;
    saveConnector(input: ConnectorDraft): Promise<ConnectorEntry>;
    removeConnector(id: string): Promise<{ ok: boolean }>;
    setConnectorsEnabled(ids: string[], enabled: boolean): Promise<{ ok: boolean; updated: number }>;
    startConnectorOAuth(input: { templateId: string; values: Record<string, string> }): Promise<{ ok: boolean; authorizeUrl?: string; message?: string }>;
    cancelConnectorOAuth(templateId: string): Promise<{ ok: boolean }>;
    readClipboardImage(): Promise<string | null>;
    /* app-server 直管 MCP 的启用覆盖表；没记过的一律视为启用 */
    readMcpServerOverrides(): Promise<Record<string, boolean>>;
    /* 统一入口：名字能匹配连接器的走连接器，其余走覆盖表；每次改动都会重启引擎 */
    setMcpServersEnabled(ids: string[], enabled: boolean): Promise<{ ok: boolean; updated: number }>;
    /* 各 MCP 服务器的按工具权限档位：{ 服务器: { 工具: "deny"|"ask"|"allow" } } */
    readMcpToolPermissions(): Promise<Record<string, Record<string, "deny" | "ask" | "allow">>>;
    /* 设置/清除某个 MCP 工具的权限档位；mode 传 null 清除。改动后引擎重启生效 */
    setMcpToolPermission(server: string, tool: string, mode: "deny" | "ask" | "allow" | null): Promise<{ ok: boolean; updated: boolean; reason?: string }>;
    readPersonalization(): Promise<PersonalizationConfig>;
    savePersonalization(input: { nickname?: string; customInstructions?: string; assistantName?: string; userContext?: string; onboarded?: boolean; greeted?: boolean }): Promise<PersonalizationConfig>;
    /* 数据目录（userData）现状：生效值 / 默认锚点 / 自定义值 / 待迁移标记 / 迁移进度 */
    readDataDir(): Promise<{ current: string; defaultDir: string; custom: string | null; migratePending: boolean; progress: { running: boolean; done: number; total: number; bytes: number; totalBytes: number; error: string | null } | null }>;
    /* 写指路牌并就地完成基础迁移（异步分批 + 进度）；重启后只做秒级增量同步。重启复用既有 app:relaunch */
    prepareDataDir(dir: string): Promise<{ ok: boolean; restoreDefault: boolean; needRestart: boolean; target: string; migrate?: boolean; hasExistingData?: boolean; migrated?: { files: number; bytes: number }; note?: string }>;
    /* 应用级运行时开关（联网搜索等） */
    readAppSettings(): Promise<{ webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; autoCompactRatio?: number; engineProxyUrl?: string; hardwareAcceleration?: "auto" | "force" | "off"; adaptiveTone?: boolean; downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy" }>;
    saveAppSettings(patch: { webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; autoCompactRatio?: number; engineProxyUrl?: string; hardwareAcceleration?: "auto" | "force" | "off"; adaptiveTone?: boolean; downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy" }): Promise<{ webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; adaptiveTone?: boolean }>;
    themeApply(theme: string): Promise<{ ok: boolean }>;
    updateReveal(filePath: string): Promise<{ ok: boolean }>;
    /* SSH 服务器连接管理：列表 CRUD、批量启停、连接测试、命令执行、交互式会话、导入导出 */
    listSshServers(): Promise<SshServer[]>;
    saveSshServer(server: SshServer): Promise<SshServer[]>;
    testSshServer(server: SshServer): Promise<SshTestResult>;
    execSshCommand(server: SshServer, command: string): Promise<SshExecResult>;
    deleteSshServers(ids: string[]): Promise<SshServer[]>;
    setSshServersEnabled(ids: string[], enabled: boolean): Promise<SshServer[]>;
    sshSessionOpen(server: SshServer, cols: number, rows: number): Promise<{ sessionId: string } | { error: string }>;
    sshSessionWrite(sessionId: string, data: string): Promise<void>;
    sshSessionResize(sessionId: string, cols: number, rows: number): Promise<void>;
    sshSessionClose(sessionId: string): Promise<void>;
    exportSshServers(servers: SshServer[], includeSecrets: boolean): Promise<string | null>;
    importSshServers(): Promise<SshServer[] | null>;
    /* 会话备份：导出 = 打包引擎 rollout 原档 + 元信息为 .json；threadIds 缺省/空数组 = 全部 */
    exportThreadsBackup(threadIds?: string[]): Promise<{ path: string; count: number } | null>;
    /* 会话记录导出为通用 Markdown（主流 AI 可直接读取/带入）；threadIds 缺省/空数组 = 全部 */
    exportThreadsMarkdown(threadIds?: string[]): Promise<{ path: string; count: number; totalMessages: number } | null>;
    /* ⛔ 09-23 补：以下方法 preload 里早就有、渲染层也在用，但这里一直没有签名 —— 渲染层从不跑 tsc ⇒ 静默漏网（gen-ipc-bridge 提取时暴露）。返回形状没把握的先 any。 */
    previewConversation(threadId: string): Promise<any>;
    importThreadsBackup(): Promise<{ path: string; imported: number; skipped: number; threads: { id: string; name: string; status: string }[] } | null>;
    importConversationMarkdown(input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }): Promise<{ thread: any; imported: { title: string; fileName: string; turns: number; text: string; at: string } } | null>;
    chooseSshKey(startPath?: string): Promise<string | null>;
    saveFileAs(sourcePath: string): Promise<{ ok: boolean; savedTo?: string }>;
    /* 仅更新称呼：写 personalization.json + AGENTS.md，不重启引擎 */
    setNickname(nickname: string): Promise<PersonalizationConfig>;
    verifyPersonalization(): Promise<any>;
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
    setProviderModel(input: { provider: string; model: string; apply?: boolean; restart?: boolean }): Promise<CustomModelState>;
    setProviderEffort(input: { provider: string; model: string; effort: string }): Promise<CustomModelState>;
    listThreadRuntimes(): Promise<Record<string, { model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number }>>;
    seedThreadRuntime(input: { threadId: string; runtime: unknown }): Promise<{ model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number }>;
    patchThreadRuntime(input: { threadId: string; patch: unknown; baseRev?: number; takeover?: boolean }): Promise<{ runtime: { model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number }; conflict: boolean; changed: boolean; blockedBy?: string; tookOverFrom?: string; restrictedBy?: string }>;
    dispatchOwner(): Promise<{ threadId: string | null }>;
    releaseDispatch(threadId: string): Promise<{ released: boolean }>;
    threadRole(threadId: string): Promise<{ restricted: boolean; label?: string }>;
    writeClipboard(text: string): Promise<boolean>;
    createScratchDir(): Promise<string>;
    /* ⛔ d.ts 历史上本有两处声明（宽口径 Record<string,string> 与窄口径 3 字段），提取去重保留宽口径 —— identity_onboard 调用点传 8 个字段，窄口径会爆 excess-property。 */
    saveIdentity(input: Record<string, string>): Promise<unknown>;
    applyCustomModel(): Promise<CustomModelState>;
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
    /* 记忆后端二选一：用户选的值 + 实际生效值（装了 MCP 服务才让位）+ 安装命令 */
    readMemoryBackend(): Promise<{ backend: "builtin" | "mcp"; effective: "builtin" | "mcp"; installed: boolean; serverPath: string; installRoot: string; installCommand: string; fallbackReason: string | null }>;
    /* 切换记忆后端并回传新状态 */
    setMemoryBackend(backend: "builtin" | "mcp"): Promise<{ backend: "builtin" | "mcp"; effective: "builtin" | "mcp"; installed: boolean; serverPath: string; installRoot: string; installCommand: string; fallbackReason: string | null }>;
    /* 一键安装 MCP 记忆服务（主进程用应用自带 node 跑安装器；新电脑无需预装 Node） */
    installMemoryMcp(): Promise<{ code: number | null; result: any; log: string; status: any }>;
    /* 卸载 MCP 记忆服务（删 <userData>/memory-mcp） */
    uninstallMemoryMcp(): Promise<{ code: number | null; result: any; log: string; status: any }>;
    /* 真跑一次 MCP 握手校验（不是只判文件存在） */
    verifyMemoryMcp(): Promise<{ code: number | null; result: any; log: string; status: any }>;
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
    /* 执行清理动作：⛔ 必须 confirm: true（UI 二次确认后才置位） */
    applyMemoryHygiene(input: { action: "purge-archive" | "prune-pool" | "tidy-lessons"; workspace?: string; confirm: true }): Promise<{ action: string; result: any }>;
    readMemoryContext(workspace?: string, includeWorkspace?: boolean): Promise<{ text: string; stats: { chars: number; over: boolean } }>;
    writeMemoryLayer(input: { scope: "user" | "background" | "project" | "lessons"; content: string; workspace?: string }): Promise<MemoryLayersSnapshot>;
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
    dispatchToolDescription(): Promise<{ description: string }>;
    dispatchNotice(): Promise<{ text: string }>;
    dispatchOffNotice(): Promise<{ text: string }>;
    listDelegates(): Promise<{ records: DelegateRecordEntry[] }>;
    listDelegatesOf(originThreadId: string): Promise<{ records: DelegateRecordEntry[] }>;
    invokeAgent(input: { kind: "expert" | "team" | "member" | "subagent"; name: string; query: string; originThreadId: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }): Promise<{ ok: boolean; threadId?: string; name?: string; output: string; error?: string }>;
    archiveDelegates(input: { threadIds?: string[]; originThreadId?: string }): Promise<{ archived: number; failed: string[] }>;
    listExpertTeams(): Promise<ExpertTeamConfig[]>;
    saveExpertTeam(input: unknown): Promise<ExpertTeamConfig>;
    removeExpertTeam(teamId: string): Promise<{ ok: boolean }>;
    resetExpertTeams(): Promise<ExpertTeamConfig[]>;
    getTeamTools(teamId: string): Promise<{ tools: { id: string; name: string; profession: string; description: string }[]; teamSystemPrompt: string; teamTool: any }>;
    getTeamSessionConfig(teamId: string): Promise<{ team: ExpertTeamConfig; systemPrompt: string; teamTool: any }>;
    startTeamSession(input: { teamId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }): Promise<{ thread: any; turnId: string | null; role?: ExpertPendingRole | null }>;
    startTeamMemberSession(input: { teamId: string; memberId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }): Promise<{ thread: any; turnId: string | null; member: { id: string; name: string; profession: string }; role?: ExpertPendingRole | null }>;
    invokeTeamMember(input: { teamId: string; memberId: string; query: string; leadThreadId?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }): Promise<{ threadId: string; turnId?: string; teamId: string; memberId: string; name: string; profession: string; output: string; runId?: string; reused?: boolean }>;
    /* 专家团历史委托记录（成员历史工作记录面板；主进程落盘，跨窗口一致） */
    listTeamRuns(threadId: string): Promise<TeamMemberRunRecord[]>;
    teamThreadsMap(): Promise<{ threads: Record<string, string>; members: Record<string, string> }>;
    teamOfThread(threadId: string): Promise<string>;
    terminalInput(id: string, data: string): Promise<void>;
    terminalResize(id: string, cols: number, rows: number): Promise<void>;
    restartTerminal(id: string, cwd?: string): Promise<void>;
    terminalReady(): Promise<void>;
    gitDiff(cwd: string, scope: string): Promise<{ code: number | null; output: string }>;
    openExternal(url: string): Promise<void>;
    browserPopout(url: string): Promise<{ ok: boolean }>;
    shellReveal(target: string): Promise<void>;
    writeClipboardImage(filePath: string): Promise<boolean>;
    readClipboardFiles(): Promise<string[]>;
    doctor(cwd?: string): Promise<{ checks: { label: string; ok: boolean; detail: string }[]; at: number }>;
    engineInfo(): Promise<any>;
    /* 上报当前正在查看的会话：主进程据此只转发该会话的高频事件（多会话性能） */
    setActiveThread(threadId: string | null): Promise<{ ok: boolean }>;
    storageInfo(): Promise<any>;
    /* 缓存清理：仅支持安全目标（引擎日志 / 本地图片缓存），绝不删会话历史 */
    storageClear(target: "engine-log" | "images"): Promise<{ ok: boolean; target: string; error?: string }>;
    engineCheckUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }>;
    enginePerformUpdate(): Promise<{ ok: boolean; version: string; message: string }>;
    relaunchApp(): Promise<void>;
    readBuiltinPlugins(): Promise<{ image?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string }; vision?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string } }>;
    saveBuiltinPlugins(cfg: unknown): Promise<unknown>;
    probeBuiltinModels(input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }): Promise<{ models: string[] }>;
    /* ⛔ `path` 是落盘后的本地路径（网关只回 b64_json 时也有值）；`url` **仅在网关给了 * 真托管地址时**才有值 —— data URL 绝不会回传（会把 3 MB base64 带进对话历史）。 */
    generateImage(input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }): Promise<{ path: string; url: string }>;
    describeImage(input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }): Promise<{ text: string }>;
    relayLogin(input: { baseUrl: string; email: string; password: string }): Promise<{ email: string; baseUrl: string; balance: number }>;
    relayLoadAccount(): Promise<{ baseUrl: string; email: string; loggedIn: boolean; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyName: string | null } | null>;
    relayAccounts(): Promise<{ id: string; baseUrl: string; email: string; loggedIn: boolean; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyName: string | null; active: boolean; disabled: boolean }[]>;
    relaySwitchAccount(id: string): Promise<{ ok: boolean; baseUrl: string; email: string }>;
    relayRemoveAccount(id: string): Promise<{ ok: boolean; activeId: string | null; removed?: boolean; deactivated?: boolean }>;
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
    openaiImportFile(input: { contents: string[] }): Promise<{ total: number; imported: number; updated: number; failed: number; items: { index: number; name: string; id?: string; email?: string; loginable?: boolean; action: "imported" | "updated" | "failed"; message?: string }[] }>;
    relayKeysAll(): Promise<{ id: string; email: string; baseUrl: string; active: boolean; selectedKeyId: number | null; keys: any[]; error?: string }[]>;
    relayOverview(id?: string): Promise<{ baseUrl: string; email: string; balance: number; subscriptions: any[]; keys: any[]; groups: any[]; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyId: number | null; selectedKeyName: string | null }>;
    relayCreateKey(input: { name: string; groupId?: number | null; accountId?: string }): Promise<{ id: number; key: string; name: string; group_id: number | null; status: string }>;
    relaySelect(input: { mode: "balance" | "plan"; groupId: number | null; keyId?: number; keyName?: string }): Promise<{ ok: boolean }>;
    relayKeyBilling(input: { baseUrl: string; apiKey: string }): Promise<any>;
    relayRegister(input: { baseUrl: string; email: string; password: string; affCode?: string }): Promise<{ email: string; baseUrl: string; balance: number }>;
    relayPaymentPlans(): Promise<any[]>;
    relayOpenPurchase(): Promise<{ ok: boolean; url: string }>;
    enhancePrompt(text: string): Promise<{ ok: boolean; text?: string; error?: string }>;
    listTerminals(): Promise<{ id: string; alive: boolean; cwd: string }[]>;
    validatePlugin(target: string): Promise<{ ok: boolean; root: string; manifestPath?: string; issues: string[]; inventory: { skills: number; commands: number; agents: number; hooks: number }; name?: string }>;
    chooseDirectoryAt(startPath: string): Promise<string | null>;
    voiceStop(): Promise<{ ok: boolean }>;
    voiceProfilesImport(): Promise<any>;
    voiceProfilesRecord(input: { samples: number[]; sampleRate: number }): Promise<any>;
    voiceProfilesSave(input: { draftFile: string; name: string; refText: string }): Promise<any>;
    voiceProfilesDelete(id: string): Promise<{ ok: boolean }>;
    voiceProfilesPreview(input: { id?: string; text?: string }): Promise<any>;
    voiceBarge(): Promise<{ ok: boolean }>;
    voicePlaybackDone(): Promise<{ ok: boolean }>;
    voiceZipvoiceCancel(): Promise<{ ok: boolean }>;
    voiceModelsCancel(): Promise<{ ok: boolean }>;
    voiceModelsReveal(): Promise<string>;
    voiceModelsUninstall(): Promise<{ ok: boolean }>;
    voiceHotkeyGet(): Promise<{ registered: string }>;
    voiceWakeReset(): Promise<{ ok: boolean }>;
    voiceWakeStop(): Promise<{ ok: boolean }>;
    voiceKwsCancel(): Promise<{ ok: boolean }>;
    voiceKwsStatus(): Promise<{ ready: boolean }>;
    installRuntime(id: string): Promise<{ ok: boolean; runtimes: DevRuntimeEntry[] }>;
    uninstallRuntime(id: string): Promise<{ ok: boolean; runtimes: DevRuntimeEntry[] }>;
    weixinStartLogin(): Promise<{ qrcodeImg: string; qrcode: string } | null | undefined>;
    weixinPollLogin(): Promise<{ status: string; verifyCodeRequired?: boolean; connected?: boolean } | null | undefined>;
    feishuConnect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    dingtalkConnect(clientId: string, clientSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    qqConnect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    qqQrStart(): Promise<{ state: string; qr?: string; name?: string; error?: string }>;
    qqQrStatus(): Promise<{ state: string; qr?: string; name?: string; error?: string }>;
    feishuQrStart(): Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>;
    feishuQrStatus(): Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>;
    wecomWebhookConnect(url: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    wecomWebhookTest(text?: string): Promise<{ ok: boolean; error?: string }>;
    botBindingGet(): Promise<{ wechat: { threadId: string; title: string; updatedAt: number } | null; telegram: { threadId: string; title: string; updatedAt: number } | null }>;
    botsSet(list: any[]): Promise<{ ok: boolean; count: number }>;
    botBindingSet(input: { channel: string; threadId: string | null; title?: string }): Promise<{ threadId: string; title: string; updatedAt: number } | null>;
    botStreamGet(): Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>;
    botStreamSet(input: { enabled: boolean; thinking: boolean; tools: boolean }): Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>;
    relayToggleAccount(input: { id: string; disabled: boolean }): Promise<{ ok: boolean; disabled: boolean; deactivated?: boolean }>;
    openaiToggleAccount(input: { id: string; disabled: boolean }): Promise<{ ok: boolean; disabled: boolean; deactivated?: boolean }>;
    channelsStatus(): Promise<{ weixin: boolean; telegram: boolean; feishu?: boolean; dingtalk?: boolean; qq?: boolean; "wecom-webhook"?: boolean }>;
    telegramConnect(token: string): Promise<{ ok: boolean; username?: string; error?: string }>;
    installMarketSkillLight(skill: unknown): Promise<{ name: string; discovered: boolean; engineCheckMessage: string }>;
    skillDisciplineGet(): Promise<{ present: boolean; section: string }>;
    savePastedText(text: string): Promise<string | null>;
    readPastedText(path: string): Promise<{ editable: boolean; content?: string | null }>;
    updatePastedText(path: string, content: string): Promise<{ ok: boolean; size: number }>;
    updateCheck(): Promise<{ ok: boolean; info?: { hasUpdate: boolean; reason: string; version?: string; filename?: string; size?: number; sha256?: string; changelog?: string; mandatory?: boolean; downloadUrl?: string }; currentVersion?: string; source?: string; error?: string }>;
    updateDownload(input: { downloadUrl: string; filename?: string }): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
    updateInstall(filePath: string): Promise<{ ok: boolean; error?: string }>;
    bridgeStatus(): Promise<{ running: boolean; port: number; targets: number; requests: number; converted: number; forwarded: number; failures: number; modes: Record<string, "responses" | "chat"> }>;
    getThreadRuntime(threadId: string): Promise<{ model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number } | null>;
    planMemoryHygiene(workspace?: string): Promise<{ rules: { layer: string; name: string; when: string; action: string; protect: string; trace: string }[]; labels: Record<string, { title: string; danger: string }>; actions: string[]; issues: { severity: "info" | "warn"; layer: string; code: string; message: string; count?: number }[]; archive: { files: number; bytes: number }; pool: { total: number; pinned: number; expiring: number; max: number; ttlDays: number }; }>;
    listDispatchCatalog(): Promise<{ targets: DispatchTargetEntry[] }>;
    capabilitiesSnapshot(): Promise<{ capabilities: { id: string; label: string; purpose: string; activeId: string | null; activeLabel: string; activeWhy: string; alternatives: { id: string; label: string; available: boolean; why: string }[]; note: string; }[]; at: number; }>;
    perfCounters(): Promise<{ rolloutFallbackScans: number; droppedForInactiveSession: number; threadListRequests: number }>;
    markIdentityGreeted(): Promise<PersonalizationConfig>;
    popoutThread(threadId: string): Promise<{ ok: boolean; focused?: boolean }>;
    popoutClose(threadId: string | null): Promise<{ ok: boolean }>;
    popoutThreadId(): Promise<string | null>;
    popoutList(): Promise<string[]>;
    engineRestartLog(): Promise<{ t: number; reason: string; busy: boolean; activeTurns: number; action: "now" | "defer" | "flush" | "force" }[]>;
    engineActiveTurns(): Promise<{ count: number; threadIds: string[] }>;
    voiceStatus(): Promise<{ active: boolean; state: string; runtimeReady: boolean; modelsReady: boolean; threadId: string; lastError: string }>;
    voiceStart(threadId: string, options?: { mode?: "conversation" | "dictation" }): Promise<{ ok: boolean; error?: string; status: unknown }>;
    voiceDictationFinish(): Promise<{ ok: boolean; text?: string; error?: string }>;
    voiceEndpointNow(): Promise<{ ok: boolean; text?: string }>;
    voiceSpeak(text: string, options?: { sid?: number; speed?: number }): Promise<{ ok: boolean; sampleRate?: number; audioBase64?: string; error?: string }>;
    voicePreviewVoice(input?: { sid?: number; speed?: number; text?: string }): Promise<{ ok: boolean; sampleRate?: number; audioBase64?: string; error?: string }>;
    voiceProfilesList(): Promise<{ profiles: any[]; zipvoiceReady: boolean }>;
    voicePresetList(): Promise<{ presets: { id: string; name: string; desc: string; lang: string; applied: boolean }[] }>;
    voicePresetApply(presetId: string): Promise<{ ok: boolean; profile?: any; existed?: boolean; error?: string }>;
    voiceProfilesSelect(id: string): Promise<{ ok: boolean; profileId: string }>;
    voiceModelsStatus(): Promise<{ ready: boolean; missing: string[]; readyFiles: number; totalFiles: number; bytes: number; root: string; repos: { id: string; lastSegment: string }[]; zipvoice?: { ready: boolean; bytes: number; dir: string }; kws?: { ready: boolean; bytes: number; dir: string }; }>;
    voiceModelsInstall(): Promise<{ ok: boolean; error?: string }>;
    voiceZipvoiceInstall(): Promise<{ ok: boolean; error?: string }>;
    voiceModelsImport(input: { sourceDir: string }): Promise<{ ok: boolean; failures: string[] }>;
    voiceMicPermission(): Promise<{ status: string; error?: string }>;
    voiceSettingsGet(): Promise<{ settings: { tts: { sid: number; speed: number; volume: number }; asr: { rule1: number; rule2: number; rule3: number; numThreads: number }; mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean }; barge: { gateDb: number; mode: "auto" | "manual" }; aec?: { mode: "auto" | "on" | "off" }; modelHost: "auto" | "huggingface" | "hf-mirror"; hotkey: { enabled: boolean; accelerator: string }; dictationHotkey: { enabled: boolean; accelerator: string }; wake: { enabled: boolean; phrase: string }; }; ttsVoices: Record<number, string>; modelHosts: Record<string, string>; modelHostOptions: string[]; }>;
    voiceSettingsSet(patch: any): Promise<{ tts: { sid: number; speed: number; volume: number }; asr: { rule1: number; rule2: number; rule3: number; numThreads: number }; mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean }; barge: { gateDb: number; mode: "auto" | "manual" }; aec?: { mode: "auto" | "on" | "off" }; modelHost: "auto" | "huggingface" | "hf-mirror"; hotkey: { enabled: boolean; accelerator: string }; dictationHotkey: { enabled: boolean; accelerator: string }; wake: { enabled: boolean; phrase: string }; }>;
    voiceHotkeySet(input: { accelerator: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string }>;
    voiceWakeStart(): Promise<{ ok: boolean; error?: string; phrase?: string; hint?: string }>;
    voiceWakeAudio(samples: Float32Array): Promise<{ ok: boolean; matched: boolean }>;
    voiceKwsInstall(): Promise<{ ok: boolean; error?: string }>;
    /* 截图设置 + 实际注册成功的快捷键 + 冲突说明 */
    screenshotSettingsGet(): Promise<ScreenshotSettingsSnapshot>;
    /* 改完立刻重挂快捷键（不重启即生效） */
    screenshotSettingsSet(patch: Partial<ScreenshotSettings>): Promise<ScreenshotSettingsSnapshot>;
    /* 先注册成功才落盘；冲突时保留原设置 */
    screenshotHotkeySet(input: { mode: "full" | "region"; accelerator?: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string; settings?: ScreenshotSettings }>;
    /* 成功时另推 screenshot:captured 事件给主窗口（渲染层只认事件，避免插两份） */
    screenshotCapture(mode: "full" | "region"): Promise<ShotCaptureResult>;
    screenshotPickDir(): Promise<string | null>;
    /* 在系统文件管理器里定位截图 */
    screenshotReveal(file: string): Promise<boolean>;
    listFavorites(): Promise<FavoriteItem[]>;
    addFavorite(input: Partial<FavoriteItem>): Promise<{ items: FavoriteItem[]; item: FavoriteItem }>;
    updateFavorite(input: { id: string; patch: Partial<FavoriteItem> }): Promise<FavoriteItem[]>;
    /* 批量删除只认显式 id 列表（不提供隐式删全部） */
    deleteFavorites(ids: string[]): Promise<{ items: FavoriteItem[]; removed: number }>;
    clearFavorites(): Promise<{ items: FavoriteItem[]; removed: number }>;
    /* 记一次使用（useCount/lastUsedAt），失败不阻断发送 */
    touchFavorite(id: string): Promise<FavoriteItem[]>;
    /* 只追加到记忆层（先读后写，不抹既有内容）；单行限长 300 字 */
    favoritesToMemory(input: { ids: string[]; scope?: "user" | "project" | "background" | "lessons"; workspace?: string }): Promise<{ ok: boolean; written: number; error?: string }>;
    /* 手机控制状态（平台/pip 包/adb/技能/遥测） */
    phoneHarnessStatus(): Promise<{platform:string;python:string;pythonOk:boolean;installed:boolean;version:string;adb:boolean;skill:boolean;telemetryOff:boolean;iphoneEligible:boolean}>;
    /* 装 phone-harness + 关遥测 + 注册技能 */
    phoneHarnessInstall(): Promise<{ok:boolean;log:string}>;
    /* 卸载 phone-harness 与技能 */
    phoneHarnessUninstall(): Promise<{ok:boolean;log:string}>;
    /* 跑上游 --doctor 体检 */
    phoneHarnessDoctor(): Promise<{ok:boolean;log:string}>;
    /* 按平台返回权限引导步骤 */
    phoneHarnessGuides(): Promise<{id:string;title:string;steps:string[]}[]>;
    /* 打开系统权限设置页 */
    phoneHarnessOpenSettings(): Promise<void>;
    /* 把工具链里的 adb 写进 phone-harness 配置（android.adb，不改系统 PATH） */
    phoneHarnessWireAdb(): Promise<{adb:string}>;
    /* 把一段生图提示词交给**用户已配置的模型**润色（一次性短请求，非流式，不开会话）：补主体细节/环境/光线/构图/风格，只回一行可直接用的提示词。⛔ 只支持 chat 协议供应商；官方订阅与 responses-only 网关明确报错 */
    dramaCanvasPolishPrompt(input: { text: string; context?: string }): Promise<{ text: string }>;
    /* 锁主体（09-29 电商出图工作流）：用已配置的**视觉模型**把商品参考图反推成一段固定主体描述，六类图（主图/SKU/详情/场景/白底/买家秀）共用，保证一套图是同一件商品。⛔ 当前生图通道 builtin:generate-image 是纯文生图（无图输入）⇒ 这是「参考图锁主体」的可行替代，不是图生图；模型须支持视觉输入，否则如实报错 */
    dramaCanvasDescribeImage(input: { image: string; context?: string }): Promise<{ text: string }>;
    /* 产物目录（09-29 用户要求「在 codexharness 目录下面新增一个存的目录，也可以选择和修改目录」）：默认 <userData>/outputs，首次读取自动创建；返回当前目录与「是否为默认」。 */
    dramaCanvasOutputDir(): Promise<{ dir: string; isDefault: boolean }>;
    /* 设置产物目录：pick=true 弹系统目录选择框；dir 给绝对路径直接设；dir 为空串 = 恢复默认。目录不可用会明确报错（不静默回退）。 */
    dramaCanvasOutputDirSet(input: { dir?: string; pick?: boolean }): Promise<{ dir: string; isDefault: boolean }>;
    /* 画布快照镜像（09-29「打通」）：渲染层把当前画布（名称/工作流类型/节点/连线）防抖推给主进程，存 userData/drama-canvas/boards.json —— workflow_read 工具的数据源 */
    dramaCanvasBoardSync(input: { name: string; flow: string; nodes: unknown[]; edges: unknown[] }): Promise<{ ok: boolean }>;
    /* 把二进制素材（配音 WAV / 生成图）按字节写进工作区 .drama-canvas/assets/；工作区掉出可信根（会话已关/重启）时回退应用数据目录并置 fallback=true（09-29 修「参考图传不了」）。⛔ 渲染层唯一的写入通道 fs:write 是 utf8 字符串写，写不了二进制，WAV 必须走这里 */
    dramaCanvasAssetWrite(input: { workspace: string; name: string; base64: string; subdir?: string }): Promise<{ path: string; fallback?: boolean }>;
    /* 主动推送一条微信消息给用户（to 缺省=最近对话用户）。⛔ 正文气泡依赖 context_token，对方近期发过消息才最可靠；机器人未登录时抛错 */
    weixinSend(input: { to?: string; text: string }): Promise<{ ok: boolean }>;
    /* 内置视频生成接口：国内外 8 家厂商清单 + 是否已配凭证（可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo） */
    videoProviders(): Promise<{id:string;name:string;region:string;modes:string[];imageInput:string;fields:string[];models:string[];defaultModel:string;configured:boolean}[]>;
    /* 各厂商凭证（userData/video-providers.json） */
    videoConfigRead(): Promise<Record<string, Record<string,string>>>;
    /* 保存某厂商的 API 凭证 */
    videoConfigSave(input: { providerId: string; values: Record<string,string> }): Promise<{ ok: boolean; configured: boolean }>;
    /* 提交视频生成异步任务（i2v 时 image 可为本地路径/URL，主进程转 base64） */
    videoSubmit(input: { providerId: string; mode: string; prompt: string; image?: string; model?: string; duration?: number; aspect?: string }): Promise<{ jobId: string }>;
    /* 轮询任务状态（MiniMax 成功后自动两段式换下载地址） */
    videoPoll(input: { providerId: string; jobId: string }): Promise<{ status: string; url?: string; error?: string }>;
    /* 把产物视频拉回本地落 <workspace>/.drama-canvas/assets/（可信根校验） */
    videoDownload(input: { url: string; workspace: string; name: string; subdir?: string; outputDir?: string }): Promise<{ path: string; bytes: number }>;
    /* 排队消息定时发送：主进程登记定时器（不受渲染层隐藏节流），到点广播 queue-timer:due */
    queueTimerSet(input: { threadId: string; queuedSubmissionId: string; runAt: number }): Promise<{ ok: boolean; scheduled: boolean }>;
    /* 取消排队消息定时（删除消息/取消定时/到点清理时调） */
    queueTimerCancel(input: { queuedSubmissionId: string }): Promise<{ ok: boolean }>;
    /* 在系统资源管理器中定位文件（可信根校验同 fs:read）；画布生成产物「打开文件夹」 */
    revealInFolder(path: string): Promise<{ ok: boolean }>;
    /* 删分镜表的工作区文件（只删 .drama-canvas/storyboards/<name>.json 这一个文件；不存在时幂等返回 removed:false） */
    dramaCanvasStoryboardFileRemove(input: { workspace: string; name: string }): Promise<{ removed: boolean }>;
    /* 扫各项目的**工作日志与项目记忆**（<项目>/.codex-harness/memory/**：长期记忆 / 坑与纪律 / logs 日报 / archive / project）。项目清单来自 rollout 扫出的 cwd 集合。⛔ 这是项目里的工作记录，与会话本身的归档 / 删除（「归档管理」页）不是一回事 */
    workLogsScan(): Promise<{ projects: Array<{ cwd: string; name: string; memoryDir: string; exists: boolean; bytes: number; files: Array<{ path: string; rel: string; kind: string; bytes: number; mtime: number }> }> }>;
    /* 读一份工作日志/记忆文件的正文（UI 内查看）。路径必须落在某个项目的 .codex-harness/memory 之下；>512KB 拒绝（提示去文件管理器打开） */
    workLogsRead(input: { path: string }): Promise<{ path: string; text: string; bytes: number; mtime: number }>;
    /* 删工作日志文件（销毁性，不会重建）：只删 .codex-harness/memory 之下的普通文件；目录、越界路径一律拒绝 */
    workLogsDelete(input: { paths: string[] }): Promise<{ deleted: number; bytes: number; failed: string[] }>;
    /* 按顺序合并视频片段成一条成片（整片导出）：先 -c copy，失败回落统一重编码；输出 <workspace>/.drama-canvas/export/ */
    videoConcat(input: { workspace: string; name: string; files: string[]; width?: number; height?: number; fps?: number }): Promise<{ path: string; bytes: number; mode: "copy" | "reencode"; parts: number }>;
    /* 扫描宠物目录（内置 dist/pets + userData/pets + ~/.codex/pets + ~/.petdex/pets）；同名 id 先到先得，内置优先 */
    petList(): Promise<PetPackage[]>;
    /* 宠物设置 + 当前生效的宠物包（active 无效时回落第一只可用的） */
    petSettingsGet(): Promise<PetStatus>;
    /* 改完立刻应用（显隐 / 位置 / 缩放 / 透明度）；取值一律归一化后再落盘 */
    petSettingsSet(patch: Partial<PetSettings>): Promise<PetStatus>;
    /* 浮窗首帧补水（推送可能发生在窗口创建之前）+ 诊断 */
    petState(): Promise<{ signal: PetSignal; open: boolean; bounds: PetBounds | null }>;
    /* 宠物目录清单：设置页显示「官方宠物包放哪儿」，writable 只对用户目录为真 */
    petRoots(): Promise<PetRootInfo[]>;
    /* 在系统文件管理器打开宠物目录（缺省 = 用户目录；不存在则先建，否则 Windows 上静默无反应） */
    petOpenDir(which?: string): Promise<{ ok: boolean; error?: string; dir: string }>;
    /* 把外部宠物包**复制**进 userData/pets（只允许从已登记的宠物目录导入；不移动、不覆盖同名） */
    petImport(dir: string): Promise<{ ok: boolean; error?: string; id?: string }>;
    /* 显示/隐藏切换（走独立通道，避免为了开关宠物而整份重写设置） */
    petToggle(): Promise<{ settings: PetSettings; open: boolean }>;
    /* 显示宠物（置 enabled=true） */
    petShow(): Promise<{ settings: PetSettings; open: boolean }>;
    /* 隐藏宠物（置 enabled=false；下次启动不自动恢复） */
    petHide(): Promise<{ settings: PetSettings; open: boolean }>;
    /* SkillHub 专家市场包（skillhub.cn/skillspackage，总 55 包） */
    listExpertMarketPackages(input?: { page?: number; pageSize?: number; query?: string }): Promise<{ items: { slug: string; displayName: string; summary: string; scene: string; subScene: string; children: string[] }[]; total: number; page: number; pageSize: number }>;
    /* 装包 = 元技能 + 子技能 + 专家中心新增对应专家卡片 */
    installExpertMarketPackage(input: { slug: string }): Promise<{ slug: string; teamId: string; displayName: string; installedChildren: string[]; childFailures: string[]; expertCreated: boolean; expertUpdated: boolean }>;
    /* SkillHub 人格市场（skillhub.cn/soul，16 套全量） */
    listSoulMarket(): Promise<{ items: { slug: string; displayName: string; summary: string; version: string }[]; total: number }>;
    /* 人格详情（content = 完整中文人设） */
    getSoulMarket(input: { slug: string }): Promise<{ slug: string; displayName: string; summary: string; version: string; content: string }>;
    /* 当前生效人格（soulSlug 空 = 默认人格） */
    currentSoulMarket(): Promise<{ soulSlug: string; persona: string }>;
    /* 应用人格（slug=null 还原默认）：写 personalization.persona + 同步 $CODEX_HOME/AGENTS.md，新会话即生效 */
    applySoulMarket(input: { slug: string | null }): Promise<{ slug: string; displayName: string }>;
    /* Laya 智能判断：服务/安装状态（pip 包 + laya-serve 进程 + 权重就绪） */
    layaStatus(): Promise<{ installed: boolean; version: string; running: boolean; ready: boolean; port: number; installing: boolean; starting: boolean; lastError: string }>;
    /* 安装/更新 laya[serve]（pip 清华镜像；torch 大，20 分钟超时）；权重由服务首启时经 hf-mirror 拉取 */
    layaInstall(): Promise<{ ok: boolean; log: string }>;
    /* 思考等级自动判断（choice: low/medium/high/xhigh + 校准置信度；置信 <0.45 弃权返回 null，调用方回落手选档） */
    layaDecideEffort(text: string): Promise<{ effort: string; confidence: number } | null>;
/* ═══ gen:end ═══ */

    /** 桌面宠物状态推送（主进程归约九态 → 浮窗；浮窗首帧另用 petState() 补水） */
    onPetSignal(listener: (signal: PetSignal) => void): () => void;

    /** 桌面宠物配置推送（当前宠物包 + 设置）：换宠物 / 改缩放时用它让已开着的浮窗立刻跟上 */
    onPetConfig(listener: (config: PetStatus) => void): () => void;

    onQueueTimerDue(listener: (event: { threadId: string; queuedSubmissionId: string }) => void): () => void;

    onRemotePairRequest(handler: (request: { rid: string; deviceId: string; name: string }) => void): () => void;

    onBotPairRequest(handler: (request: { rid: string; channel: string; chatId: string; name: string }) => void): () => void;















    onBotBindingChanged(handler: (bindings: unknown) => void): () => void;





    onRemoteCommand(listener: (payload: { command: string; device: { id: string; name: string } }) => void): () => void;

    onRemoteDevice(listener: (device: { id: string; name: string }) => void): () => void;



    onConnectorOAuth(listener: (event: ConnectorOAuthEvent) => void): () => void;

    /** 粘贴的长文本（超过阈值）落盘成 .txt，返回绝对路径；空文本返回 null。按内容哈希去重。 */

    /** 读粘贴文本；editable=false 表示不是应用保存的粘贴文本（回退普通文件预览）。
     *  content=null 表示文件已不存在。 */

    /** 保存编辑后的粘贴文本（仅限应用自己的粘贴文本目录，越界会抛错） */

    /** 标记身份引导已打过招呼（此后新会话不再引导、直接干活） */

    onSshData(listener: (payload: { data: string }) => void): () => void;

    onSshExit(listener: (payload: { code?: number; signal?: string; error?: string }) => void): () => void;

    /** 本地协议桥状态：引擎只发 Responses，上游只支持 Chat 时由桥转换（port/running/各 provider 实际协议） */


    /** 记忆整洁报告（只读）：清理规则表 + 待办 + 八层水位 + 分类计数 */

    /** 调度（09-15）：可被 Codex 调度的对象目录 */



    onRuntimeProgress(listener: (event: { id: string; message?: string; percent?: number; stage?: string; speed?: string; done?: boolean; failed?: boolean; auto?: boolean }) => void): () => void;

    onTerminalData(listener: (id: string, data: string) => void): () => void;

    /** 「当前能力链路」：同一件事有多个后端时，现在实际走哪条（唯一来源见 electron/capability-registry.ts） */

    /** 多会话性能诊断计数：rollout 兜底扫描次数（应为 0）与被按会话过滤掉的事件数 */

    /** 独立会话弹窗：把会话开到新窗口（focused=true 表示该会话已有弹窗，聚焦了旧窗口） */

    /** 弹窗返回主应用：关闭本弹窗并把主窗口带到指定会话 */

    /** 当前窗口是否为独立会话弹窗（返回弹窗锁定的会话 id，非弹窗返回 null） */

    /** 所有弹窗锁定的会话 id 列表（主窗口侧栏据此隐藏，避免重复渲染） */

    /** 重启台账（诊断"任务莫名断了"）：谁触发的重启、当时是否有任务在跑、立即还是推迟。 */

    /** 当前活跃回合数（0 = 引擎可安全重启；验收/诊断用）。 */
    /** 引擎侧"谁在跑"的真相：count = 活跃回合数，threadIds = 这些回合分别属于哪个会话
     *（渲染层收到快照式的 status/changed {idle} 时据此核实，而不是无条件熄灭运行指示器）。 */

    /** 引擎重启被闸门推迟/已补做：渲染层提示「改动将在当前任务结束后生效」。 */
    onEngineRestartDeferred(listener: (event: { waiting: boolean; reason?: string; activeTurns?: number }) => void): () => void;

    onEngineUpdateProgress(listener: (event: { stage: string; detail?: string; percent?: number }) => void): () => void;

    /** 截图完成（快捷键或设置页「试试截图」触发）。**渲染层唯一插入路径**：
     *  成功截图一定会走这里 ⇒ 输入框把图放进草稿；不要再按 invoke 的返回值各插一次。 */
    onScreenshotCaptured(listener: (payload: ScreenshotCapturedPayload) => void): () => void;



    onEvent(listener: (event: CodexEvent) => void): () => void;

    onChannelBotEvent(listener: (event: any) => void): () => void;

    onHarnessEvent(listener: (event: any) => void): () => void;

    // ---- 语音通话（本机离线识别与合成，旁挂新增） ----



    /** 提前端点：识别文本已收尾 + 停口 ~0.5s 时调用，立即提交这一句（不等 rule2 静音） */

    voiceAudio(samples: Float32Array): void;














    onVoiceEvent(listener: (event: any) => void): () => void;


    onVoiceHotkey(listener: (event: { accelerator: string }) => void): () => void;


    /** 只回「命中没命中」：识别文本与匹配都在主进程做 */

    /** 关键词唤醒模型（KWS，31MB 归档）：装完唤醒自动切到「读音匹配」引擎 */

    // 自更新：网页源（发布站）/ GitHub Releases 双源可切换



    /** 订阅下载进度（0~1），返回取消订阅函数 */
    updateOnProgress(callback: (percent: number) => void): () => void;


  };
}

/** 构建期注入的构建指纹（`YYYYMMDD-HHmm`，见 vite.config.ts 的 define）。
 *  用途：界面自证「正在运行的是哪一份产物」——运行时读 dist/ 只能说明磁盘上有什么。 */
declare const __BUILD_STAMP__: string;
