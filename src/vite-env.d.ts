/// <reference types="vite/client" />

/** 与 electron/main.ts 的 ProviderModel 对应：供应商下的单个模型配置 */
type ProviderModelConfig = {
  id: string;
  /** 云账户目录的积分倍率（只用于下拉展示） */
  credits?: string;
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
  /** 云账户 / 中转站 / 自定义（登录自动生成的供应商才显示倍率） */
  source?: "cloud" | "relay" | "custom";
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

/** 一个「CLI 智能体」定义（10-29 新板块；真相源在 electron/cli-agents.ts 的内置表 + userData/cli-agents.json） */
type CliAgentEntry = {
  id: string;
  name: string;
  /** coding 编码 CLI / agent 通用智能体 CLI / custom 自建·其他（分类表由 cliagents:list 一起下发） */
  category: string;
  /** PATH 上的可执行名（检测与派活提示都用它） */
  bin: string;
  /** 官方安装命令；空串 = 没有可复制的一键命令，按官方文档装 */
  installCmd: string;
  docs: string;
  description: string;
  promptHint: string;
  enabled: boolean;
  builtin: boolean;
  createdAt: number;
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
  kind: "expert" | "team" | "member" | "subagent" | "cli";
  key: string;
  name: string;
  profession: string;
  description: string;
  teamId?: string;
  memberId?: string;
  /** 专家团目标的成员数（不含主理人）：面板「专家总数」用它 +1（主理人）求和。 */
  memberCount?: number;
  /** CLI 智能体：本机是否已安装（主进程检测；false ⇒ @ 列表里置灰不可选，不隐藏） */
  installed?: boolean;
  /** 置灰原因（@ 面板）：kind-off = 本会话没开这一类；cli-missing = 没装 */
  disabledReason?: "kind-off" | "cli-missing";
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
/**
 * Codex 官方插件市场（GitHub `openai/plugins`，10-03 立；与 Gitee 镜像源并存的**第二个源**，两个板块）。
 * 字段口径见 `electron/codex-official-market.ts`：auth/apiCurated 决定卡片的「还要配什么」提示，
 * installable=false 是源指向外部仓库的那 3 条（不给一键安装，只给查看来源）。
 */
type OfficialMarketPluginEntry = {
  slug: string; name: string; displayName: string; description: string; category: string; categoryZh: string;
  /** 上游 policy.authentication：ON_INSTALL / ON_USE */
  auth: string;
  /** 是否在 api_marketplace.json（ChatGPT 精选 50 条）里 —— 不在的 15 条依赖 ChatGPT 应用连接器 */
  apiCurated: boolean;
  pluginPath: string; version: string; license: string; author: string; homepage: string; sourceUrl: string;
  installable: boolean; unavailableReason?: string; authNote: string;
  installed?: boolean; installedVersion?: string;
};
type OfficialMarketListResult = { items: OfficialMarketPluginEntry[]; installedIds: string[]; live: boolean; catalogGeneratedAt: string; total: number; page: number; pageSize: number };
type OfficialMarketInstallResult = { id: string; name: string; path: string; version: string; description: string; marketId: string; manifestPath: string; engineRegistered?: boolean; engineCheckMessage?: string };
type LocalSkillEntry = { name: string; folder?: string; path: string; description: string; descriptionZh?: string; marketId?: string; pluginId?: string; sourceUrl?: string; installedAt?: string; engineRegistered?: boolean; engineCheckMessage?: string; source?: "cocoloop" | "skillhub" | "local"; enabled?: boolean; allowedTools?: string[]; icon?: string; category?: string; /** 专家市场包元技能（.skillhub.json kind=skillset） */ skillset?: boolean; /** 专家包子技能：所属包 slug（.skillhub.json kind=skillset-child） */ skillsetSlug?: string };
type PersonalizationConfig = { nickname?: string; customInstructions?: string; assistantName?: string; about?: string; occupation?: string; replyStyle?: string; tone?: string; interests?: string; habits?: string; userContext?: string; persona?: string; soulSlug?: string; onboarded?: boolean; profileGuideSeen?: boolean; greeted?: boolean };

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

/* 输入框竖条 / 密码本 / 开发日记 / 扩展目录的类型统一定义在 src/lib/rail-ipc-types.d.ts（跨进程单一来源）。 */
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
  /** 30fps 动画包：每态一对动画 WebP + 静帧（存在时不使用 spritesheet） */
  animationSet?: Record<string, { animatedSrc: string; stillSrc: string }>;
  /** 16 向看帧（动画包专用；绝对路径） */
  lookFrameSet?: string[];
  supportsLookTracking?: boolean;
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
    archiveDelegates(input: { threadIds?: string[]; originThreadId?: string }): Promise<{ archived: number; failed: string[] }>;
    listDispatchCatalog(): Promise<{ targets: DispatchTargetEntry[] }>;
    listDelegates(): Promise<{ records: DelegateRecordEntry[] }>;
    listDelegatesOf(originThreadId: string): Promise<{ records: DelegateRecordEntry[] }>;
    /* 10-05 能力网关：把引擎 0.157 后对模型不可见的内置 MCP 工具面接回来（name=工具名，name="list" 取清单）；10-09 起图像四件套已搬去 image-lab 域自己的通道，本网关只剩其余 25 个能力 */
    callDispatchTool(input: { name: string; args?: Record<string, unknown>; callerThreadId: string }): Promise<{ ok: boolean; output: string; error?: string }>;
    invokeAgent(input: { kind: "expert" | "team" | "member" | "subagent"; name: string; query: string; originThreadId: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }): Promise<{ ok: boolean; threadId?: string; name?: string; output: string; error?: string }>;
    /* 10-29 收敛：总开关删除后只剩「逐类许可变化」一种事件 —— 传 before/next 三类许可，主进程按差集生成**一条**按类分段的通知（新开启的类附对象名单）；未开启的类显式否定 */
    dispatchNotice(before?: { expert?: boolean; team?: boolean; subagent?: boolean }, next?: { expert?: boolean; team?: boolean; subagent?: boolean }): Promise<{ text: string }>;
    threadRole(threadId: string): Promise<{ restricted: boolean; label?: string }>;
    dispatchToolDescription(threadId: string): Promise<{ description: string }>;
    /* 取消尚未确认的开启流程（不落盘） */
    appLockCancel(setupId: string): Promise<{ ok: boolean }>;
    /* 关闭应用锁需当前密码；错误同样计数 */
    appLockDisable(password: string): Promise<{ ok: boolean; remaining: number; reset?: boolean; error?: string }>;
    /* 用户确认已备份密码后提交开启 */
    appLockEnable(setupId: string): Promise<{ ok: boolean; error?: string }>;
    /* 生成一次性密码（随机或自定义）：确认 enable 前不落盘，明文只在这次返回 */
    appLockPrepare(input: { mode?: string; password?: string }): Promise<{ ok: boolean; setupId?: string; password?: string; kind?: "random" | "custom"; error?: string }>;
    /* 应用锁状态（不含密码/哈希）；resetRequired=true 时主进程会写重置标记并重启 */
    appLockStatus(): Promise<{ enabled: boolean; attempts: number; remaining: number; resetRequired: boolean; kind?: "random" | "custom"; createdAt?: number }>;
    /* 锁屏验证；错误次数落盘，第 10 次返回 reset=true */
    appLockVerify(password: string): Promise<{ ok: boolean; remaining: number; reset?: boolean; error?: string }>;
    /* 10-25：在软件所在盘根新建指挥中枢专属项目目录，返回绝对路径 */
    createBossProjectDir(): Promise<string>;
    doctor(cwd?: string): Promise<{ checks: { label: string; ok: boolean; detail: string }[]; at: number }>;
    engineInfo(): Promise<any>;
    homeDir(): Promise<string>;
    perfCounters(): Promise<{ rolloutFallbackScans: number; droppedForInactiveSession: number; threadListRequests: number }>;
    relaunchApp(): Promise<void>;
    /* 缓存清理：仅支持安全目标（引擎日志 / 本地图片缓存），绝不删会话历史 */
    storageClear(target: "engine-log" | "images"): Promise<{ ok: boolean; target: string; error?: string }>;
    storageInfo(): Promise<any>;
    getUserData(): Promise<string>;
    /* 应用级运行时开关（联网搜索等） */
    readAppSettings(): Promise<{ webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; autoCompactRatio?: number; engineProxyUrl?: string; hardwareAcceleration?: "auto" | "force" | "off"; adaptiveTone?: boolean; downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy"; skillAutoUpdate?: boolean; pluginAutoUpdate?: boolean; modelCatalogRepairNotice?: string; functionMenu?: { location?: "top" | "bottom"; order?: string[]; overflow?: string[] }; sidebarOptionsCollapsed?: boolean; composerRailOpen?: boolean; composerRailOrder?: string[] }>;
    saveAppSettings(patch: { webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; autoCompactRatio?: number; engineProxyUrl?: string; hardwareAcceleration?: "auto" | "force" | "off"; adaptiveTone?: boolean; downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy"; skillAutoUpdate?: boolean; pluginAutoUpdate?: boolean; modelCatalogRepairNotice?: string; functionMenu?: { location?: "top" | "bottom"; order?: string[]; overflow?: string[] }; sidebarOptionsCollapsed?: boolean; composerRailOpen?: boolean; composerRailOrder?: string[] }): Promise<{ webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; adaptiveTone?: boolean; skillAutoUpdate?: boolean; pluginAutoUpdate?: boolean; modelCatalogRepairNotice?: string; functionMenu?: { location?: "top" | "bottom"; order?: string[]; overflow?: string[] }; sidebarOptionsCollapsed?: boolean; composerRailOpen?: boolean; composerRailOrder?: string[] }>;
    /* 10-13 统一更新体系：按行 id 更新指定组件。幂等（内容一致 ⇒ unchanged，不重装）；有目标目录的一律先快照、失败自动回滚（electron/update-safety.ts）。更新源一律国内镜像：npm→npmmirror、pip→清华、GitHub→gh-mirror 通道 */
    runAutoUpdateComponent(id: string): Promise<{ id: string; label: string; action: "updated" | "unchanged" | "failed" | "skipped"; before: string; after: string; message: string }>;
    /* 10-13 统一更新体系：一键更新全部组件（手动入口，不按开关过滤 —— 用户点了就是授权）。逐项返回结��，单项失败不影响其余 */
    runAllAutoUpdateComponents(): Promise<{ id: string; label: string; action: "updated" | "unchanged" | "failed" | "skipped"; before: string; after: string; message: string }>[];
    /* 10-13 统一更新体系：全量组件清单与版本状态（工具 / 引擎 / 技能 / 插件 / ponytail / 钩子等）。清单单一真相源在 electron/update-registry.ts（含「不支持更新」的条目及其原因）；动态类目（市场技能/插件/专家包/人格包）按已装实例展开成多行。传 id 可只扫某一類 */
    scanAutoUpdateComponents(id?: string): Promise<{ id: string; specId: string; label: string; group: string; pkg: string; mirror: boolean; reason: string; installed: boolean; enabled: boolean; current: string; latest: string; hasUpdate: boolean; detectable: boolean; unsupported: string; error: string }[]>;
    /* 10-13 新增：单独开关某一类自动更新（四个开关互相独立，patch 只写对应那一个 AppSettings 字段）；缺省值判据统一走 autoUpdateEnabled（!== false ⇒ 默认开） */
    setAutoUpdate(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }>;
    /* 10-13 新增：主要组件的自动更新开关与版本号（技能 / 桌面 / 浏览器 / Mac 电脑操作 / 引擎）。⛔ 版本数据与 autoUpdate:scan 同源（都走 scanRows），两个端点不可能给出矛盾的结论 */
    readAutoUpdateStatus(): Promise<{ id: string; kind: "tool" | "engine" | "skill"; label: string; pkg: string; enabled: boolean; current: string; latest: string; hasUpdate: boolean; error: string }[]>;
    setAwake(on: boolean): Promise<boolean>;
    /* 清空备份（⚠ 不可恢复，渲染层须先确认） */
    backupClear(): Promise<{ ok: boolean; error?: string; summary?: any }>;
    /* 读改动备份配置（enabled/目录/是否被回退/目录是否存在） */
    backupConfigGet(): Promise<{ ok: boolean; error?: string; config?: any }>;
    /* 写改动备份配置；启用时才创建目录 */
    backupConfigSet(input: { enabled?: boolean; dir?: string }): Promise<{ ok: boolean; error?: string; config?: any; dirReady?: boolean }>;
    /* 读某会话的备份索引（回合级） */
    backupList(conversationId?: string): Promise<{ ok: boolean; error?: string; changes?: any[] }>;
    /* agent 工具：列出全部会话的备份概览（会话id/条数/最新最旧/总字节）+ 容量上限 */
    backupListAll(): Promise<{ ok: boolean; error?: string; list?: any; maxBytes?: number }>;
    /* agent 工具：手动触发容量裁剪（超上限把最旧的移进回收站，不硬删） */
    backupPrune(input: { maxBytes?: number }): Promise<{ ok: boolean; error?: string; prunedConversations?: number; freedBytes?: number; skipped?: number; bytes?: number; maxBytes?: number }>;
    /* agent 工具：读某条备份全文（索引 + 明细 hunks），用来回答「当时到底改了什么」 */
    backupReadChange(input: { conversationId?: string; requestId?: string }): Promise<{ ok: boolean; error?: string; change?: any }>;
    /* agent 工具：把某文件回滚到备份那一版；⛔ 明细只存 hunks 时回 needs_full_content（如实说，不假装成功）；目标须在工作区内 */
    backupRestoreFile(input: { conversationId?: string; requestId?: string; filePath?: string; workspace?: string }): Promise<{ ok: boolean; error?: string; note?: string }>;
    /* 备份产物概览（会话数/条数/字节数） */
    backupSummary(): Promise<{ ok: boolean; error?: string; summary?: any }>;
    /* 创世 boss：加任务并派活（异步，turn/start 立刻返回；结果靠后台回调） */
    assignBossTask(input: any): Promise<any>;
    /* 创世 boss：成员浏览器能力（ego lite 是否可用；每人独立 TaskSpace） */
    bossBrowserStatus(): Promise<{ installed: boolean; cli: string; hint: string }>;
    /* 创世 boss：建群 + 声明成员岗位（成员会话在建会话那刻定工具面） */
    createBossGroup(input: any): Promise<any>;
    /* 删群（先往中枢回投 [群事件] 再清群/任务/事件账本；会话与产出文件保留） */
    deleteBossGroup(input: any): Promise<any>;
    /* 创世 boss：用户三选一（换模型重做 / 放宽标准 / 自己接手） */
    escalateBossTask(input: any): Promise<any>;
    /* 创世 boss：所有群（看板列表） */
    listBossGroups(): Promise<any[]>;
    /* 创世 boss：拉人/移人（移人不删会话、不打断在跑任务） */
    bossGroupMember(input: any): Promise<any>;
    /* 清空某个 BOSS 会话的专属记忆目录（⛔ 只清记忆，不删会话） */
    clearBossMemory(input: any): Promise<any>;
    /* 创世 boss：置顶/取消置顶群事件（群视图卡带，最多 3 条） */
    bossGroupPin(input: any): Promise<any>;
    /* 创世 boss：可拉名单（专家/专家团 + 本机 CLI agent，带探测结果） */
    bossGroupPool(): Promise<any>;
    /* 10-25：把群账本的 bossThreadId 重绑到重建后的会话（rollout 丢失自愈） */
    bossGroupRebind(input: any): Promise<any>;
    /* 创世 boss：人工给审查结论（打回必须带理由，空理由会被拒） */
    reviewBossTask(input: any): Promise<any>;
    /* 创世 boss：你在群对话框里说话 → boss 线程（回复镜像回群流） */
    bossGroupSay(input: any): Promise<any>;
    /* BOSS 会话身份登记（add/remove/rename/list）—— 记忆路由的唯一真相源 */
    bossGroupSession(input: any): Promise<any>;
    /* 创世 boss：某群的账本快照（成员/任务/事件/打回） */
    bossGroupStatus(groupId: string): Promise<any>;
    botBindingGet(): Promise<{ wechat: { threadId: string; title: string; updatedAt: number } | null; telegram: { threadId: string; title: string; updatedAt: number } | null }>;
    botBindingSet(input: { channel: string; threadId: string | null; title?: string }): Promise<{ threadId: string; title: string; updatedAt: number } | null>;
    botStreamGet(): Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>;
    botStreamSet(input: { enabled: boolean; thinking: boolean; tools: boolean }): Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>;
    botApprove(rid: string): Promise<{ ok: boolean }>;
    botBindConsume(code: string): Promise<{ botId: string; deviceName?: string } | null>;
    botBindQrcode(botId: string, botName: string): Promise<{ qr: string; url: string; code: string }>;
    botBindStatus(code: string): Promise<"waiting" | "confirmed" | "expired">;
    botDeny(rid: string): Promise<{ ok: boolean }>;
    botPairState(): Promise<{ code: string; pending: { rid: string; channel: string; chatId: string; name: string; createdAt: number }[]; approved: { key: string; channel: string; chatId: string; name: string; approvedAt: number }[] }>;
    botRevoke(key: string): Promise<{ ok: boolean }>;
    botsGet(): Promise<any[]>;
    botsSet(list: any[]): Promise<{ ok: boolean; count: number }>;
    bridgeStatus(): Promise<{ running: boolean; port: number; targets: number; requests: number; converted: number; forwarded: number; failures: number; modes: Record<string, "responses" | "chat"> }>;
    /* 归档会话时回收 codex-<threadId> TaskSpace；不传 threadId 则清全部 codex-* */
    egoCleanup(threadId?: string): Promise<{ ok: boolean; cleaned: number; detail: string }>;
    /* 打开 ego lite 官方下载页（不静默安装系统软件） */
    egoInstall(): Promise<{ ok: boolean; detail: string }>;
    /* 打开 ego lite GUI；找不到启动器时回落官方下载页 */
    egoOpen(): Promise<{ ok: boolean; detail: string }>;
    /* ego lite 安装态：CLI 路径/版本/双平台下载页；不内置浏览器本体 */
    egoStatus(): Promise<{ installed: boolean; cliPath: string; version: string; appPath: string; platform: string; downloadUrl: string }>;
    /* 手动升级：运行官方 ego-browser upgrade（可能下载数百 MB） */
    egoUpgrade(): Promise<{ ok: boolean; output: string; before: string; after: string; changed: boolean }>;
    browserPopout(url: string): Promise<{ ok: boolean }>;
    /* ⛔ `path` 是落盘后的本地路径（网关只回 b64_json 时也有值）；`url` **仅在网关给了 * 真托管地址时**才有值 —— data URL 绝不会回传（会把 3 MB base64 带进对话历史）。 */
    generateImage(input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }): Promise<{ path: string; url: string }>;
    probeBuiltinModels(input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }): Promise<{ models: string[] }>;
    readBuiltinPlugins(): Promise<{ image?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string }; vision?: { enabled?: boolean; baseUrl: string; apiKey: string; model: string } }>;
    saveBuiltinPlugins(cfg: unknown): Promise<unknown>;
    capabilitiesSnapshot(): Promise<{ capabilities: { id: string; label: string; purpose: string; activeId: string | null; activeLabel: string; activeWhy: string; alternatives: { id: string; label: string; available: boolean; why: string }[]; note: string; }[]; at: number; }>;
    getChannelBot(): Promise<any>;
    saveChannelBot(config: unknown): Promise<any>;
    testChannelBot(config: unknown): Promise<{ ok: boolean; latencyMs: number }>;
    channelsStatus(): Promise<{ weixin: boolean; telegram: boolean; feishu?: boolean; dingtalk?: boolean; qq?: boolean; "wecom-webhook"?: boolean }>;
    readClipboardImage(): Promise<string | null>;
    readClipboardFiles(): Promise<string[]>;
    writeClipboard(text: string): Promise<boolean>;
    writeClipboardImage(filePath: string): Promise<boolean>;
    /* 10-29 CLI 智能体板块：分类表跟着列表下发（渲染层不复制第二份分类字面量） */
    listCliAgents(): Promise<{ items: CliAgentEntry[]; categories: { key: string; label: string; hint: string }[] }>;
    /* 只在用户点「检测」时调：有子进程（where/which + --version） */
    detectCliAgent(input?: { id?: string; bin?: string }): Promise<{ installed: boolean; path: string; version: string; error: string }>;
    /* 新增/更新；内置项不可删只能关停 */
    saveCliAgent(input?: { id?: string; name?: string; category?: string; bin?: string; installCmd?: string; docs?: string; description?: string; promptHint?: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string; item?: CliAgentEntry }>;
    removeCliAgent(id: string): Promise<{ ok: boolean; error?: string }>;
    /* 10-30 一键安装：执行端 electron/cli-install.ts（唯一实现，面板只调 IPC）；装完真复核 PATH */
    installCliAgent(id: string): Promise<{ ok: boolean; error?: string; detail?: string }>;
    /* 配套卸载：只动应用自己的工具目录，系统里用户自装的另一份不越界 */
    uninstallCliAgent(id: string): Promise<{ ok: boolean; error?: string; detail?: string }>;
    /* 10-13 关闭确认弹窗的回包：tray=隐藏主窗口 / quit=置 closeConfirmed 后二次 close / cancel=不动。remember=true 写 closeToTray（动作）+ closePromptSeen（不再弹）。⛔ ask 方向是推送类手写桥（preload onCloseConfirmAsk），不在本清单 */
    respondCloseConfirm(action: "tray" | "quit" | "cancel", remember: boolean): Promise<{ ok: boolean; error?: string }>;
    /* 云账号登录（10-16）：账号密码换云端 Bearer 会话令牌，safeStorage 加密后落 userData/cloud/auth.json。⛔ 不是配对流程 —— 服务端 accountWho() 同时认会话令牌与设备令牌 */
    cloudAuthLogin(input: { baseUrl?: string; username?: string; password?: string }): Promise<{ ok: boolean; account?: { id: string; username: string; role: string; baseUrl: string; active: boolean; savedAt: number }; error?: string }>;
    /* 退出云账号（缺省 = 当前生效那个）。⛔ 最后一个账号被删时才收摊（停用云供应商行与两个 MCP 连接器，都只停用不删除） */
    cloudAuthLogout(id?: string): Promise<{ ok: boolean; loggedIn: boolean; baseUrl: string; active: { id: string; username: string; role: string; baseUrl: string; active: boolean; savedAt: number } | null }>;
    /* 云账号积分（服务端 /points/me）：余额 + 最近 30 条变动明细。⛔ 账户级数据，故挂在 cloud-auth 域而不是另开板块 */
    cloudAuthPoints(): Promise<{ ok: boolean; balance: number; signupGrant: number; txns: Array<{ id?: string; at?: number; delta?: number; kind?: string; note?: string; after?: number }>; error?: string }>;
    /* 云账号登录态（⛔ 只回账号与「有没有」，不回任何令牌） */
    cloudAuthStatus(): Promise<{ loggedIn: boolean; baseUrl: string; active: { id: string; username: string; role: string; baseUrl: string; active: boolean; savedAt: number } | null; accounts: Array<{ id: string; username: string; role: string; baseUrl: string; active: boolean; savedAt: number }>; defaultBaseUrl: string }>;
    /* 切换生效云账号（多账号并存时用） */
    cloudAuthSwitch(id: string): Promise<{ ok: boolean; loggedIn: boolean; baseUrl: string; active: { id: string; username: string; role: string; baseUrl: string; active: boolean; savedAt: number } | null }>;
    /* 云端知识库连接器状态（只读本地，不联网） */
    cloudKbStatus(): Promise<{ exists: boolean; enabled: boolean; url: string; hasToken: boolean } & { connectorId: string; tool: string }>;
    /* 把云端知识库接成 MCP 连接器 cloud-kb（streamable_http + 令牌走环境变量，⛔ 不落 config.toml）。未开通权益时只停用连接器并回报原因 */
    cloudKbSync(): Promise<{ ok: boolean; action: string; url?: string; kbName?: string; error?: string }>;
    /* 云端记忆状态（只读本地，不联网） */
    cloudMemoryStatus(): Promise<{ connectorId: string; connector: { exists: boolean; enabled: boolean; url: string; hasToken: boolean }; hasCredentials: boolean; mode: string; note: string; upstream?: "memory" | "model"; activation: { state: "active" | "inactive" | "unknown"; reason: string; entitled: boolean; applied: boolean; checkedAt: number; reasonText: string } }>;
    /* 取云端记忆凭据（加密缓存）。⛔ 记忆中枢当前**没有 MCP 端点**（实测 /mcp、/v1/mcp、/sse 全 404），故 mode 恒为 rest-only 且不建连接器 —— 等本地 stdio 适配器 */
    cloudMemorySync(): Promise<{ ok: boolean; mode: string; action?: string; error?: string; upstream?: "memory" | "model"; upstreamChanged?: boolean; activation?: { state: "active" | "inactive" | "unknown"; reason: string; entitled: boolean; applied: boolean; checkedAt: number; reasonText: string } }>;
    /* 把「云端模型」设为当前生效供应商（用户显式点击）。⛔ 自动同步绝不抢生效位，只有这条会；切换会重启引擎以让新 Key/地址生效 */
    cloudModelsActivate(): Promise<{ ok: boolean; model: string; error?: string }>;
    /* 云端模型目录（服务端 /models 原样透传）：含逐模型勾选状态 enabled 与积分倍率 credits（creditsLocked=管理员已钉住、upstreamCredits=上游原值），以及闲时倍率快照 offPeak（时段按服务端本地时间，tzOffsetMinutes 供客户端换算）。⛔ 不返回任何密钥与上游地址 */
    cloudModelsCatalog(): Promise<{ ok?: boolean; provider?: { id?: string; name?: string; baseUrl?: string; ready?: boolean; hasProxyToken?: boolean }; models?: Array<{ id: string; name?: string; credits?: string; enabled?: boolean; contextLength?: number; maxOutputTokens?: number; supportsImages?: boolean; supportsReasoning?: boolean; creditsLocked?: boolean; upstreamCredits?: string }>; offPeak?: { enabled?: boolean; windows?: Array<{ id?: string; label?: string; start?: number; end?: number; rate?: number }>; active?: { label?: string; start?: number; end?: number; rate?: number } | null; tzOffsetMinutes?: number }; error?: string }>;
    /* 勾选云端模型（写**服务端** /models/enabled，权威在云端）→ 写完后立刻同步到本机下拉框。勾选语义：勾上 = 下拉框可见 */
    cloudModelsSetEnabled(input: { ids: string[] }): Promise<{ ok: boolean; enabledCount?: number; sync?: { ok: boolean; models: number; changed: boolean; promoted: boolean; error?: string }; error?: string }>;
    /* 本机云供应商状态（只读本地，不联网）：是否已注册 / 模型数 / 是否已有 Key / 上次同步时间 */
    cloudModelsStatus(): Promise<{ loggedIn: boolean; baseUrl: string; registered: boolean; enabled: boolean; models: number; hasToken: boolean; lastSyncAt: number }>;
    /* 把云端目录同步成本机供应商行（登录成功后 / 手动刷新 / 定时轮询都调它）。⛔ 同时写复数列表与单数生效档案（10-16「勾 5 个下拉 15 个」事故的防线）；force=true 会重签代理令牌 */
    cloudModelsSync(input?: { force?: boolean }): Promise<{ ok: boolean; models: number; changed: boolean; promoted: boolean; error?: string }>;
    /* 云端模型连通测试（10-19）：探**引擎实际会用的那条路**（本地桥 + 云供应商行合成后的 baseUrl/key，记忆开启时即 memapi + 记忆 userKey）。401/403 自动重签一次并重探；forceHeal=true = 界面「重签密钥并重试」。成功由界面提示保存并重启应用 */
    cloudModelsTest(input?: { forceHeal?: boolean }): Promise<{ ok: boolean; code?: string; error?: string; originalError?: string; healed?: boolean; model?: string; status?: number; latencyMs?: number; models?: number }>;
    /* 取云代理令牌（/proxy/token，明文**仅此一次**）。⛔ 供「Key 掉了」的修复入口用；落盘一律加密 */
    cloudModelsToken(input?: { force?: boolean }): Promise<{ ok: boolean; token: string; reused: boolean; error?: string }>;
    /* 云版预留：同步冲突解决（resolution = local|cloud|merge；未开通前为预留桩） */
    cloudSyncConflictResolve(key: string, resolution: string): Promise<{ ok: boolean; reserved?: boolean; code?: string; error?: string }>;
    /* 10-18：列出本地会话供勾选上传（只读，不写游标） */
    cloudSyncList(): Promise<{ ok: boolean; error?: string; sessions: Array<{ id: string; title: string; project: string; lines: number; sizeBytes: number; updatedAt: number; path: string }> }>;
    /* 云版预留：按 key 从云端拉回数据（未开通前为预留桩） */
    cloudSyncPull(input?: { keys: string[] }): Promise<{ ok: boolean; reserved?: boolean; code?: string; error?: string }>;
    /* 云版预留：把指定本地路径推到云端（云端存储未开通时返回预留桩形状 {ok:false,reserved:true,code}） */
    cloudSyncPush(input?: { paths: string[] }): Promise<{ ok: boolean; reserved?: boolean; code?: string; error?: string }>;
    /* 云版预留（10-11）：云端存储开通状态（enabled=false = 未开通，配额/最近同步时间一并给出） */
    cloudSyncStatus(): Promise<{ enabled: boolean; reserved: boolean; quotaBytes: number; usedBytes: number; lastSyncAt: number }>;
    /* 官方源的 10 个分类（含每类数量）。⛔ 与 Gitee 镜像源的分类各算各的，tab 按源切换 */
    listOfficialMarketCategories(): Promise<{ key: string; displayName: string; count: number }[]>;
    /* 镜像下载 plugins/<slug> 子树 → 写本地市场目录 → 注册 [marketplaces.codex-official-market] → 引擎 plugin/install + 重启 → plugin/list 确认；进度走 harness:event 的 official-plugin-install（⛔ 不与 plugin-install 共用 type，上游 slug 有重名） */
    installOfficialMarketPlugin(plugin: OfficialMarketPluginEntry): Promise<OfficialMarketInstallResult>;
    /* 本地已装官方插件（**只扫本地目录、零网络**）：补齐「引擎没认领、但文件已落盘」的那批，不能走 list（那条要拉上游 65 条） */
    listInstalledOfficialMarketPlugins(): Promise<{ slug: string; version: string; description: string }[]>;
    /* 10-03：Codex 官方插件市场（GitHub openai/plugins，gh-proxy 镜像优先）。installedDir 由主进程注入 —— 「装没装」的真相源是本地 marker；live=false 表示上游没连通、这次读的是内置快照 */
    listOfficialMarketPlugins(input?: { category?: string; query?: string; page?: number; pageSize?: number }): Promise<OfficialMarketListResult>;
    /* 先请引擎 plugin/uninstall（认领时才生效），再删落盘目录 + 摘本地 marketplace 清单；删除目标经 safeFolder 归一 + 目录内校验 */
    uninstallOfficialMarketPlugin(slug: string): Promise<{ ok: boolean; reason?: string; engineRemoved?: boolean }>;
    /* 10-12 新增：按 slug 取官方市场最新对象、重跑**同一条安装链**覆盖更新（含引擎注册与重启）。已下架时明确报错 */
    updateOfficialPlugin(slug: string): Promise<{ from: string; to: string; engineRegistered: boolean; engineCheckMessage: string }>;
    /* 10-12 新增：Codex 官方插件市场（GitHub openai/plugins 国内镜像）的更新检查。与 plugins 域同构：**有版本号** ⇒ 真版本比对；只读零副作用；版本缺失标 comparable:false */
    checkOfficialPluginUpdates(): Promise<{ slug: string; name: string; current: string; latest: string; hasUpdate: boolean; comparable: boolean }[]>;
    request(method: string, params?: unknown): Promise<any>;
    respond(id: string | number, result: unknown): Promise<void>;
    /* 上报当前正在查看的会话：主进程据此只转发该会话的高频事件（多会话性能） */
    setActiveThread(threadId: string | null): Promise<{ ok: boolean }>;
    deleteCommand(filePath: string): Promise<{ ok: boolean }>;
    expandCommand(input: { filePath: string; argument?: string; cwd?: string }): Promise<{ text: string }>;
    listCommands(input?: { cwd?: string }): Promise<CustomCommandEntry[]>;
    readCommand(filePath: string): Promise<CustomCommandEntry | null>;
    saveCommand(input: SaveCommandInput): Promise<CustomCommandEntry>;
    listConnectors(): Promise<ConnectorEntry[]>;
    cancelConnectorOAuth(templateId: string): Promise<{ ok: boolean }>;
    startConnectorOAuth(input: { templateId: string; values: Record<string, string> }): Promise<{ ok: boolean; authorizeUrl?: string; message?: string }>;
    removeConnector(id: string): Promise<{ ok: boolean }>;
    saveConnector(input: ConnectorDraft): Promise<ConnectorEntry>;
    setConnectorsEnabled(ids: string[], enabled: boolean): Promise<{ ok: boolean; updated: number }>;
    listConnectorTemplates(): Promise<ConnectorTemplate[]>;
    applyCustomModel(): Promise<CustomModelState>;
    listCustomModels(): Promise<{ providers: ProviderSummary[]; current: string | null }>;
    probeCustomModel(config: unknown): Promise<{ status: number; latencyMs: number; models: string[]; model?: string; ok?: boolean; via?: "models" | "stream" | "builtin" | "official" | "official-fallback"; wireUsed?: "responses" | "chat" }>;
    getCustomModel(): Promise<CustomModelState | null>;
    removeCustomModel(providerId: string): Promise<{ ok: boolean; current: CustomModelState | null }>;
    removeProviderModel(input: { provider: string; modelId: string }): Promise<CustomModelState>;
    saveCustomModel(config: unknown): Promise<CustomModelState>;
    selectCustomModel(providerId: string): Promise<CustomModelState>;
    setProviderEffort(input: { provider: string; model: string; effort: string }): Promise<CustomModelState>;
    setProviderEnabled(input: { provider: string; enabled: boolean }): Promise<CustomModelState>;
    setProviderModel(input: { provider: string; model: string; apply?: boolean; restart?: boolean }): Promise<CustomModelState>;
    upsertProviderModel(input: { provider: string; model: ProviderModelConfig }): Promise<CustomModelState>;
    /* 写指路牌并就地完成基础迁移（异步分批 + 进度）；重启后只做秒级增量同步。重启复用既有 app:relaunch */
    prepareDataDir(dir: string): Promise<{ ok: boolean; restoreDefault: boolean; needRestart: boolean; target: string; migrate?: boolean; hasExistingData?: boolean; migrated?: { files: number; bytes: number }; note?: string }>;
    /* 数据目录（userData）现状：生效值 / 默认锚点 / 自定义值 / 待迁移标记 / 迁移进度 */
    readDataDir(): Promise<{ current: string; defaultDir: string; custom: string | null; migratePending: boolean; progress: { running: boolean; done: number; total: number; bytes: number; totalBytes: number; error: string | null } | null }>;
    /* 10-04 B档 声明式插件清单（外部 JSON，含无效条目报告与两个目录路径） */
    declaredPluginsList(): Promise<any>;
    /* 10-04 打开用户插件目录（不存在则创建） */
    declaredPluginsOpenDirs(): Promise<{ ok: boolean; error?: string; userDir?: string; builtinDir?: string }>;
    /* 10-04 启停声明式插件（插槽即时生效，无需重启） */
    declaredPluginsToggle(input: { id: string; enabled: boolean }): Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>;
    chooseDirectory(): Promise<string | null>;
    chooseDirectoryAt(startPath: string): Promise<string | null>;
    chooseFiles(): Promise<string[]>;
    chooseImages(): Promise<string[]>;
    /* 10-25 新建项目弹窗（ZCode 式三选一）：{ parent, name } = 在父目录下建文件夹；{ path } = 校验已有目录（存在才放行）。建出的目录登记进可信根（与 dialog:directory 同口径）。 */
    projectDir(input: { parent?: string; name?: string; path?: string }): Promise<{ ok: boolean; dir?: string; error?: string }>;
    saveFileAs(sourcePath: string): Promise<{ ok: boolean; savedTo?: string }>;
    chooseSshKey(startPath?: string): Promise<string | null>;
    dingtalkConnect(clientId: string, clientSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    dingtalkLogout(): Promise<{ ok: boolean }>;
    /* 10-04 阶段 6 宿主域清单（启用/停用状态 + 是否 essential） */
    domainsList(): Promise<{ domains: Array<{ id: string; mounted: boolean; disabled: boolean; essential: boolean }>; essentialDomains: string[]; requiresRestart: boolean }>;
    /* 10-04 「重启才生效」的话术由主进程出，禁在前端硬编码 */
    domainsReloadHint(): Promise<{ requiresRestart: boolean; text: string }>;
    /* 10-04 阶段 6 停用/启用宿主域（下次启动生效，essential 域拒绝） */
    domainsSetEnabled(input: { id: string; enabled: boolean }): Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>;
    /* 把二进制素材（配音 WAV / 生成图）按字节写进工作区 .drama-canvas/assets/；工作区掉出可信根（会话已关/重启）时回退应用数据目录并置 fallback=true（09-29 修「参考图传不了」）。⛔ 渲染层唯一的写入通道 fs:write 是 utf8 字符串写，写不了二进制，WAV 必须走这里 */
    dramaCanvasAssetWrite(input: { workspace: string; name: string; base64: string; subdir?: string }): Promise<{ path: string; fallback?: boolean }>;
    /* 画布快照镜像（09-29「打通」）：渲染层把当前画布（名称/工作流类型/节点/连线）防抖推给主进程，存 userData/drama-canvas/boards.json —— workflow_read 工具的数据源 */
    dramaCanvasBoardSync(input: { name: string; flow: string; nodes: unknown[]; edges: unknown[] }): Promise<{ ok: boolean }>;
    /* 锁主体（09-29 电商出图工作流）：用已配置的**视觉模型**把商品参考图反推成一段固定主体描述，六类图（主图/SKU/详情/场景/白底/买家秀）共用，保证一套图是同一件商品。⛔ 当前生图通道 builtin:generate-image 是纯文生图（无图输入）⇒ 这是「参考图锁主体」的可行替代，不是图生图；模型须支持视觉输入，否则如实报错 */
    dramaCanvasDescribeImage(input: { image: string; context?: string }): Promise<{ text: string }>;
    /* 产物目录（09-29 用户要求「在 codexharness 目录下面新增一个存的目录，也可以选择和修改目录」）：默认 <userData>/outputs，首次读取自动创建；返回当前目录与「是否为默认」。 */
    dramaCanvasOutputDir(): Promise<{ dir: string; isDefault: boolean }>;
    /* 设置产物目录：pick=true 弹系统目录选择框；dir 给绝对路径直接设；dir 为空串 = 恢复默认。目录不可用会明确报错（不静默回退）。 */
    dramaCanvasOutputDirSet(input: { dir?: string; pick?: boolean }): Promise<{ dir: string; isDefault: boolean }>;
    /* 把一段生图提示词交给**用户已配置的模型**润色（一次性短请求，非流式，不开会话）：补主体细节/环境/光线/构图/风格，只回一行可直接用的提示词。⛔ 只支持 chat 协议供应商；官方订阅与 responses-only 网关明确报错 */
    dramaCanvasPolishPrompt(input: { text: string; context?: string }): Promise<{ text: string }>;
    /* 删分镜表的工作区文件（只删 .drama-canvas/storyboards/<name>.json 这一个文件；不存在时幂等返回 removed:false） */
    dramaCanvasStoryboardFileRemove(input: { workspace: string; name: string }): Promise<{ removed: boolean }>;
    engineActiveTurns(): Promise<{ count: number; threadIds: string[] }>;
    engineCheckUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }>;
    enginePerformUpdate(): Promise<{ ok: boolean; version: string; message: string }>;
    engineRestartLog(): Promise<{ t: number; reason: string; busy: boolean; activeTurns: number; action: "now" | "defer" | "flush" | "force" }[]>;
    /* 装包 = 元技能 + 子技能 + 专家中心新增对应专家卡片 */
    installExpertMarketPackage(input: { slug: string }): Promise<{ slug: string; teamId: string; displayName: string; installedChildren: string[]; childFailures: string[]; expertCreated: boolean; expertUpdated: boolean }>;
    /* SkillHub 专家市场包（skillhub.cn/skillspackage，总 55 包） */
    listExpertMarketPackages(input?: { page?: number; pageSize?: number; query?: string }): Promise<{ items: { slug: string; displayName: string; summary: string; scene: string; subScene: string; children: string[] }[]; total: number; page: number; pageSize: number }>;
    openExternal(url: string): Promise<void>;
    addFavorite(input: Partial<FavoriteItem>): Promise<{ items: FavoriteItem[]; item: FavoriteItem }>;
    clearFavorites(): Promise<{ items: FavoriteItem[]; removed: number }>;
    /* 批量删除只认显式 id 列表（不提供隐式删全部） */
    deleteFavorites(ids: string[]): Promise<{ items: FavoriteItem[]; removed: number }>;
    listFavorites(): Promise<FavoriteItem[]>;
    /* 只追加到记忆层（先读后写，不抹既有内容）；单行限长 300 字 */
    favoritesToMemory(input: { ids: string[]; scope?: "user" | "project" | "background" | "lessons"; workspace?: string }): Promise<{ ok: boolean; written: number; error?: string }>;
    /* 记一次使用（useCount/lastUsedAt），失败不阻断发送 */
    touchFavorite(id: string): Promise<FavoriteItem[]>;
    updateFavorite(input: { id: string; patch: Partial<FavoriteItem> }): Promise<FavoriteItem[]>;
    feishuConnect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    feishuLogout(): Promise<{ ok: boolean }>;
    feishuQrCancel(): Promise<{ ok: boolean }>;
    feishuQrStart(): Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>;
    feishuQrStatus(): Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>;
    fileExists(path: string): Promise<{ exists: boolean }>;
    /* 10-30 用户令「只要电脑上有的文件都能打开」：给定路径不存在时**按文件名在磁盘上找回**（同名 + 尾段打分 + 有界预算，判定全在 electron/file-locate.ts）。只回路径，不读不写 */
    locateFile(path: string, threadId?: string): Promise<{ path: string }>;
    readFile(path: string, threadId?: string): Promise<{ dataBase64: string; size: number }>;
    /* 在系统资源管理器中定位文件（可信根校验同 fs:read）；画布生成产物「打开文件夹」 */
    revealInFolder(path: string): Promise<{ ok: boolean }>;
    writeFile(path: string, content: string, root: string): Promise<void>;
    /* 10-18 实修：unstaged=git diff / staged=--cached / head=分支起点 merge-base diff（含已提交+未提交，找不到基准才退回 HEAD 并说明）/ last 由渲染层展示；Git 缺失/非仓库/无 HEAD 都回中文原因 */
    gitDiff(cwd: string, scope: string): Promise<{ code: number | null; output: string; error?: string }>;
    /* 09-24 新增：顶栏 🔍 历史会话搜索。扫 codex-home rollout 原档（sessions/** + archived_sessions/**）搜对话内容；先 indexOf 快速否决再解析，>32MB 跳过并计数 */
    searchHistory(input?: { query?: string; limit?: number }): Promise<{ threads: { threadId: string; title: string; archived: boolean; updatedAt: number; matchCount: number; matches: { role: string; ts: string; snippet: string }[] }[]; scannedFiles: number; skippedLarge: number; elapsedMs: number }>;
    setHookEnabled(input: { hookKeys: string[]; enabled: boolean }): Promise<{ changed: number; failures: string[] }>;
    trustHooks(cwds?: string[]): Promise<{ total: number; trusted: number; alreadyTrusted: number; failures: string[] }>;
    /* HTML 实时预览：停止当前监听 */
    htmlPreviewUnwatch(): Promise<{ ok: boolean }>;
    /* HTML 实时预览：开始监听一个 HTML 文件（可信目录 + 扩展名白名单；120ms 防抖；变更推 harness 事件 html-preview:changed） */
    htmlPreviewWatch(input: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
    /* P1（10-11）：把本地 HTML/URL 动画在本地渲成 MP4 —— Chromium 抓帧 + 运行时自带 MP4 编码器，零 ffmpeg 依赖；源须为 http(s) 或可信根内 .html */
    htmlVideoRender(input: { source?: string; seconds?: number; fps?: number; width?: number; height?: number; outPath?: string }): Promise<any>;
    /* 修图执行端（10-09 从 agents:dispatch-call 拆出）：**零凭证**，纯本地 jimp（20 种 ops）。先亮源图 → 换产物 → 自动收起。⛔ 输出不覆盖原图（产出 <名字>-edit.<ext>），天然可回退 */
    imageEdit(input: { path?: string; paths?: string[]; ops: unknown[]; output?: string; format?: string; quality?: number }): Promise<{ ok: boolean; output: string; error?: string }>;
    /* 生图执行端（10-09 从 agents:dispatch-call 拆出）：**唯一需要生图插件凭证的**通道（读 builtin-plugins.json 的 image 段 → 打外部网关）。调用时弹「图像工坊」浮层，完成自动收起。⛔ 与 image-lab:edit 分属两条通道 —— 用户明确要求「生成和编辑的 IPC 彻底分开」 */
    imageGenerate(input: { prompt: string; count?: number; model?: string; size?: string; negative?: string; workspace?: string; name?: string; threadId?: string }): Promise<{ ok: boolean; output: string; error?: string }>;
    /* 读图片元信息（尺寸/格式/透明通道/字节数）。只读，不弹浮层。零凭证 */
    imageInfo(input: { path?: string; paths?: string[] }): Promise<{ ok: boolean; output: string; error?: string }>;
    /* 图像工坊读通道（image-lab 域，10-09）：渲染层浮层预览拉图片字节；路径闸 = resolveImagePath（可信根 + 图片扩展名 + 128MB），与修图通道共用同一道闸 */
    readImage(path: string): Promise<{ data: Uint8Array; size: number }>;
    /* 在应用内弹「图像工坊」浮层给用户看一张图。只读展示、**不自动收起**（由用户自己关）。零凭证 */
    imageView(input: { path: string; title?: string }): Promise<{ ok: boolean; output: string; error?: string }>;
    /* 追加一条（## HH:mm 标题 + 正文） */
    journalAppend(date: string, title: string, body: string): Promise<{ days: JournalDay[]; date: string }>;
    journalList(): Promise<{ days: JournalDay[]; dir: string; today: string }>;
    journalRead(date: string): Promise<{ date: string; content: string }>;
    journalRemove(date: string): Promise<{ days: JournalDay[] }>;
    /* 整篇覆盖（编辑器保存） */
    journalSave(date: string, content: string): Promise<{ days: JournalDay[]; date: string }>;
    journalSearch(query: string): Promise<{ hits: { date: string; lines: string[] }[] }>;
    addKnowledgeFiles(input: { workspace?: string; paths?: string[] }): Promise<{ imported: { title: string; id: string }[]; failures: string[] }>;
    addKnowledgeText(input: { workspace?: string; title?: string; text?: string; source?: string }): Promise<KbDocMeta>;
    /* 读取知识库后端：local=项目本地库 / cloud=云端 weknora（MCP） */
    kbBackendGet(): Promise<{ backend: "local" | "cloud" }>;
    /* 切换知识库后端并回传生效值 + 连接器联动结果（connector.applied=false ⇒ 只存了设置、工具面没跟上，note 说明原因） */
    kbBackendSet(backend: "local" | "cloud"): Promise<{ backend: "local" | "cloud"; connector?: { applied: boolean; note?: string } }>;
    /* npm(npmmirror)+模型(hf-mirror)；进度经 runtime:progress(id=kb-embedding) 推送 */
    installKbEmbedBackend(): Promise<{ installed: boolean; dir: string }>;
    /* 10-04：本地语义后端改按需下载 —— 知识库页卡片据此显示安装入口 */
    getKbEmbedStatus(): Promise<{ installed: boolean; dir: string }>;
    uninstallKbEmbedBackend(): Promise<{ installed: boolean; dir: string }>;
    /* 10-01 新增：项目级本地知识库（<项目>/.codex-harness/knowledge/） */
    listKnowledgeDocs(input?: { workspace?: string }): Promise<KbDocMeta[]>;
    readKnowledgeDoc(input: { workspace?: string; docId?: string }): Promise<{ meta: KbDocMeta; text: string } | null>;
    removeKnowledgeDoc(input: { workspace?: string; docId?: string }): Promise<{ ok: boolean }>;
    searchKnowledge(input: { workspace?: string; query?: string; limit?: number }): Promise<{ docId: string; title: string; chunkIndex: number; score: number; snippet: string }[]>;
    /* 思考等级自动判断（choice: low/medium/high/xhigh + 校准置信度；置信 <0.45 弃权返回 null，调用方回落手选档） */
    layaDecideEffort(text: string): Promise<{ effort: string; confidence: number } | null>;
    /* 安装/更新 laya[serve]（pip 清华镜像；torch 大，20 分钟超时）；权重由服务首启时经 hf-mirror 拉取 */
    layaInstall(): Promise<{ ok: boolean; log: string }>;
    /* 模型工具 laya_judge 的执行端：只有装了 Laya 才注册进模型工具面；短文本多选一判断（知识价值 / 重复 / 自定义 2~6 项），低置信弃权、不自动安装（10-18） */
    layaJudge(input: { preset?: "knowledge_gate" | "duplicate" | "custom"; state: string; reference?: string; instructions?: string; criteria?: Record<string, string>; minConfidence?: number; timeoutMs?: number }): Promise<{ ok: boolean; output?: string; error?: string }>;
    /* Laya 智能判断：服务/安装状态（pip 包 + laya-serve 进程 + 权重就绪） */
    layaStatus(): Promise<{ installed: boolean; version: string; running: boolean; ready: boolean; port: number; installing: boolean; starting: boolean; lastError: string; installProgress: { phase: string; current: string; percent: number; speed: string; detail: string } | null; startProgress: { phase: string; current: string; percent: number; speed: string; detail: string } | null }>;
    /* 卸载 Laya（先停服务进程，再 pip uninstall -y laya）；模型权重缓存在用户 HF 缓存目录，不随卸载删除（其他工具可能共用） */
    layaUninstall(): Promise<{ ok: boolean; log: string }>;
    /* app-server 直管 MCP 的启用覆盖表；没记过的一律视为启用 */
    readMcpServerOverrides(): Promise<Record<string, boolean>>;
    /* 各 MCP 服务器的按工具权限档位：{ 服务器: { 工具: "deny"|"ask"|"allow" } } */
    readMcpToolPermissions(): Promise<Record<string, Record<string, "deny" | "ask" | "allow">>>;
    /* 统一入口：名字能匹配连接器的走连接器，其余走覆盖表；每次改动都会重启引擎 */
    setMcpServersEnabled(ids: string[], enabled: boolean): Promise<{ ok: boolean; updated: number }>;
    /* 设置/清除某个 MCP 工具的权限档位；mode 传 null 清除。改动后引擎重启生效 */
    setMcpToolPermission(server: string, tool: string, mode: "deny" | "ask" | "allow" | null): Promise<{ ok: boolean; updated: boolean; reason?: string }>;
    /* 记忆后端二选一：用户选的值 + 实际生效值（装了 MCP 服务才让位；云端未开通则回退内置）+ 云端开通状态 + 安装命令 */
    readMemoryBackend(): Promise<{ backend: "builtin" | "mcp" | "cloud"; effective: "builtin" | "mcp" | "cloud"; installed: boolean; serverPath: string; installRoot: string; installCommand: string; fallbackReason: string | null; cloudActivation: { state: "active" | "inactive" | "unknown"; reason: string; entitled: boolean; applied: boolean; checkedAt: number; reasonText: string } }>;
    /* 切换记忆后端并回传新状态；选云端但未开通/未接通 ⇒ 不落盘，回执带 refused 原因 */
    setMemoryBackend(backend: "builtin" | "mcp" | "cloud"): Promise<{ backend: "builtin" | "mcp" | "cloud"; effective: "builtin" | "mcp" | "cloud"; installed: boolean; serverPath: string; installRoot: string; installCommand: string; fallbackReason: string | null; cloudActivation: { state: "active" | "inactive" | "unknown"; reason: string; entitled: boolean; applied: boolean; checkedAt: number; reasonText: string }; refused?: string }>;
    deleteMemory(id: string): Promise<void>;
    distillMemory(workspace?: string): Promise<{ ok: boolean; dates: string[]; added: number; reason?: string }>;
    /* 10-05 统一记忆只读：某命名空间的条目（含来源智能体/权重/归档态） */
    listFabricEntries(input: { workspace?: string; namespace?: string; includeArchived?: boolean }): Promise<any[]>;
    /* 10-05 统一记忆只读：命名空间概览（两种作用域 + 条数）—— 前端分区渲染用 */
    listFabricNamespaces(workspace?: string): Promise<{ namespace: string; scope: string; entries: number; chars: number }[]>;
    /* 10-05 统一记忆（写）：主会话的 memory_write 走这里；session=本会话私有 / project=全项目共享 */
    writeFabricMemory(input: { threadId?: string; workspace?: string; scope?: string; category?: string; content: string; weight?: number; pinned?: boolean }): Promise<{ ok: boolean; text: string }>;
    getMemoryGateway(): Promise<any>;
    saveMemoryGateway(config: unknown): Promise<any>;
    testMemoryGateway(config: unknown): Promise<{ ok: boolean; latencyMs: number; health: any }>;
    /* 执行清理动作：⛔ 必须 confirm: true（UI 二次确认后才置位） */
    applyMemoryHygiene(input: { action: "purge-archive" | "prune-pool" | "tidy-lessons"; workspace?: string; confirm: true }): Promise<{ action: string; result: any }>;
    planMemoryHygiene(workspace?: string): Promise<{ rules: { layer: string; name: string; when: string; action: string; protect: string; trace: string }[]; labels: Record<string, { title: string; danger: string }>; actions: string[]; issues: { severity: "info" | "warn"; layer: string; code: string; message: string; count?: number }[]; archive: { files: number; bytes: number }; pool: { total: number; pinned: number; expiring: number; max: number; ttlDays: number }; }>;
    /* 常驻记忆（L 层）；threadId 仅供注入审计（隔离仍按工作区） */
    readMemoryContext(workspace?: string, includeWorkspace?: boolean, threadId?: string): Promise<{ text: string; stats: { chars: number; over: boolean } }>;
    readMemoryLayers(workspace?: string): Promise<MemoryLayersSnapshot>;
    writeMemoryLayer(input: { scope: "user" | "background" | "project" | "lessons"; content: string; workspace?: string }): Promise<MemoryLayersSnapshot>;
    listMemory(category?: string): Promise<any[]>;
    /* 一键安装 MCP 记忆服务（主进程用应用自带 node 跑安装器；新电脑无需预装 Node） */
    installMemoryMcp(): Promise<{ code: number | null; result: any; log: string; status: any }>;
    /* 卸载 MCP 记忆服务（删 <userData>/memory-mcp） */
    uninstallMemoryMcp(): Promise<{ code: number | null; result: any; log: string; status: any }>;
    /* 真跑一次 MCP 握手校验（不是只判文件存在） */
    verifyMemoryMcp(): Promise<{ code: number | null; result: any; log: string; status: any }>;
    readMemoryMode(): Promise<"local" | "cloud">;
    setMemoryMode(mode: "local" | "cloud"): Promise<"local" | "cloud">;
    /* 碎片池召回（strictWorkspace：只回本工作区）；threadId 仅供审计 */
    recallMemory(query: string, workspace?: string, threadId?: string): Promise<{ context: string; remote: boolean; memoryCount?: number }>;
    /* 清空全部碎片记忆（不可恢复）；confirm !== true 一律拒（10-29 审查） */
    resetMemory(confirm: boolean): Promise<void>;
    /* 10-05 统一记忆（读）：session 段按 threadId 硬隔离 + project 段全项目共享 + 上一版角色记忆兼容段。主会话与被调度角色走同一个 handler */
    readRoleMemoryContext(input: { threadId?: string; workspace?: string; query?: string }): Promise<{ text: string; key: string; counts: { project: number; session: number; legacy: number } }>;
    /* 10-05 记忆前端：会话↔角色归属表（fabric 命名空间只带 threadId，靠它归到人） */
    listRoleSessions(): Promise<{ threadId: string; ref: any; workspace: string; at: number }[]>;
    saveMemory(input: unknown): Promise<any>;
    /* 记忆容量倍率（×1 基准，可选 1/2/4/8/10/16）：返回当前倍率、可选项与放大后的预算 */
    readMemoryScale(): Promise<{ scale: number; options: number[]; budget: { user: number; background: number; project: number; lessons: number; logs: number; total: number } }>;
    /* 设置记忆容量倍率（当场生效 + 落 app-settings；非法值归一化回基准） */
    setMemoryScale(scale: number): Promise<{ scale: number; options: number[]; budget: { user: number; background: number; project: number; lessons: number; logs: number; total: number } }>;
    /* 碎片池检索；带 workspace 时只回本工作区（strictWorkspace） */
    searchMemory(query: string, workspace?: string): Promise<any[]>;
    readWorkspaceMemoryEnabled(workspace?: string): Promise<boolean>;
    setWorkspaceMemoryEnabled(input: { workspace: string; enabled: boolean }): Promise<boolean>;
    readModelSpecs(): Promise<unknown[] | null>;
    readModel(path: string): Promise<{ data: Uint8Array; size: number }>;
    showNotification(title: string, body: string): Promise<boolean>;
    openaiAccountRemove(id: string): Promise<{ ok: boolean; total: number }>;
    openaiAccountSwitch(id: string): Promise<{ ok: boolean; email: string }>;
    openaiAccounts(): Promise<{ id: string; email: string; savedAt: number; active: boolean; disabled: boolean; planType: string; subscriptionUntil: string }[]>;
    openaiCaptureLogin(): Promise<{ id: string; email: string; total: number }>;
    openaiImportFile(input: { contents: string[] }): Promise<{ total: number; imported: number; updated: number; failed: number; items: { index: number; name: string; id?: string; email?: string; loginable?: boolean; action: "imported" | "updated" | "failed"; message?: string }[] }>;
    openaiLoginCancel(): Promise<{ ok: boolean }>;
    openaiLoginStart(input?: { proxy?: string }): Promise<{ started: boolean }>;
    openaiLoginStatus(): Promise<{ loggedIn: boolean; email: string; url: string; code: string; childAlive: boolean; error: string; lines: string }>;
    openaiModels(): Promise<string[]>;
    openaiSetProxy(proxy: string): Promise<{ ok: boolean }>;
    openaiToggleAccount(input: { id: string; disabled: boolean }): Promise<{ ok: boolean; disabled: boolean; deactivated?: boolean }>;
    openaiUsage(input?: { email?: string }): Promise<any>;
    /* 下载并校验官方安装包（走 updates.downloadUpdate：镜像候选 + 302 + 强制 https + asset.digest 的 sha256；校验不过换下一档并删半截文件）。进度事件 {type:openfilm, phase:desktop} */
    openfilmDesktopDownload(): Promise<{ ok: boolean; path?: string; error?: string; version?: string }>;
    /* 桌面端状态：能不能装 / 已装在哪 / 上游最新版 / 本地安装包。⛔ 不代跑它的 electron-updater（App 更新归 App） */
    openfilmDesktopInfo(): Promise<{ supported: boolean; reason: string; platform: string; installed: { installed: boolean; path: string; version: string }; version: string; error: string; asset: { name: string; size: number } | null; local: { path: string; size: number } | null; localOutdated: boolean; runningApp: boolean }>;
    /* 运行安装器（Win 带界面 / /S 静默；macOS hdiutil 挂载 + cp + xattr 清 quarantine）/ 打开安装包所在目录 / 卸载引导（⛔ 我们绝不代删 /Applications 或 Program Files） */
    openfilmDesktopRun(action?: "install" | "silent" | "reveal" | "uninstall"): Promise<{ ok: boolean; action: string; error?: string; note?: string }>;
    /* 按需安装（三步可单步重试；npm 走 npmmirror、chromium 走 cdn.npmmirror，失败回官方） */
    openfilmInstall(step?: "cli" | "chromium" | "verify"): Promise<{ ok: boolean; code?: string; error?: string; status: OpenfilmStatus }>;
    /* 单步重试（缺省 verify） */
    openfilmRetry(step?: "cli" | "chromium" | "verify"): Promise<{ ok: boolean; code?: string; error?: string; status: OpenfilmStatus }>;
    /* 读 OpenFilm 组件设置（自动更新三档 + 镜像策略） */
    openfilmSettingsGet(): Promise<OpenfilmSettings>;
    /* 写设置（取值归一化后落盘） */
    openfilmSettingsSet(patch: Partial<OpenfilmSettings>): Promise<OpenfilmSettings>;
    /* 扫描安装状态（CLI 版本 / 内置 node / chromium 缓存 / ffmpeg / 设置 / 开源声明） */
    openfilmStatus(): Promise<OpenfilmStatus>;
    /* 打开（或切到）某部影片的 Studio 页面：跑 open <dir>（OPENFILM_NO_BROWSER=1），从 stdout 抓 Studio 行，写 session.json 并广播 openfilm/studio 事件（渲染层据此开进内置浏览器）。⛔ 不提供「关闭」——实例可能被桌面 App 或别的 agent 用着 */
    openfilmStudioOpen(filmDir?: string): Promise<{ ok: boolean; code?: string; error?: string; url: string; origin: string; projectPath: string; pid: number; version: string; note: string }>;
    /* Studio 探活（~/.openfilm/run.json + GET /api/health；⛔ 不看 HTTP 200，认 product=openfilm-studio） */
    openfilmStudioStatus(): Promise<{ alive: boolean; url: string; origin: string; projectPath: string; pid: number; version: string; app: boolean; startedAt: number; checkedAt: number }>;
    /* 卸载运行时（只删 runtime，绝不碰用户 film 目录） */
    openfilmUninstall(): Promise<{ ok: boolean; removed: number; error?: string }>;
    /* 查最新版（npm dist-tag，镜像优先；比较只认 compareVersions） */
    openfilmUpdateCheck(): Promise<{ current: string; latest: string; source: string; hasUpdate: boolean; error?: string }>;
    readPastedText(path: string): Promise<{ editable: boolean; content?: string | null }>;
    savePastedText(text: string): Promise<string | null>;
    updatePastedText(path: string, content: string): Promise<{ ok: boolean; size: number }>;
    markIdentityGreeted(): Promise<PersonalizationConfig>;
    readPersonalization(): Promise<PersonalizationConfig>;
    savePersonalization(input: { nickname?: string; customInstructions?: string; assistantName?: string; userContext?: string; onboarded?: boolean; greeted?: boolean }): Promise<PersonalizationConfig>;
    /* ⛔ d.ts 历史上本有两处声明（宽口径 Record<string,string> 与窄口径 3 字段），提取去重保留宽口径 —— identity_onboard 调用点传 8 个字段，窄口径会爆 excess-property。 */
    saveIdentity(input: Record<string, unknown>): Promise<unknown>;
    /* 仅更新称呼：写 personalization.json + AGENTS.md，不重启引擎 */
    setNickname(nickname: string): Promise<PersonalizationConfig>;
    verifyPersonalization(): Promise<any>;
    /* 活动气泡「打开」：标记已看 → 聚焦主窗口 → 让渲染层切到该会话 */
    petActivityOpen(threadId: string): Promise<{ ok: boolean; error?: string }>;
    /* 活动气泡「回复」：对运行中的回合发 turn/steer（把一句话补进当前任务，不新起回合） */
    petActivityReply(threadId: string, text: string): Promise<{ ok: boolean; error?: string }>;
    /* 活动气泡「停止」：对运行中的回合发 turn/interrupt（主进程侧，不依赖主窗口是否打开） */
    petActivityStop(threadId: string): Promise<{ ok: boolean; error?: string }>;
    /* 桌面宠物工具栏：收起/展开活动气泡（状态在主进程，两个浮窗同步） */
    petActivityToggle(): Promise<{ collapsed: boolean }>;
    /* 宠物手动拖动结束：夹回工作区，moved 事件负责落盘坐标 */
    petDragEnd(): Promise<{ ok: boolean }>;
    /* 宠物手动拖动中（屏幕坐标）；主进程按增量 setBounds，实现「拖着走」 */
    petDragMove(pos: { screenX: number; screenY: number }): Promise<{ ok: boolean }>;
    /* 宠物手动拖动开始（屏幕坐标）；主进程记下窗口原点，之后由 pet:drag-move 移动窗口 */
    petDragStart(pos: { screenX: number; screenY: number }): Promise<{ ok: boolean }>;
    /* 渲染层报告当前打开的会话；活动气泡跟随会话排序（10-22） */
    petFocusThread(threadId: string): Promise<{ ok: boolean }>;
    /* 隐藏宠物（置 enabled=false；下次启动不自动恢复） */
    petHide(): Promise<{ settings: PetSettings; open: boolean }>;
    /* 把外部宠物包**复制**进 userData/pets（只允许从已登记的宠物目录导入；不移动、不覆盖同名） */
    petImport(dir: string): Promise<{ ok: boolean; error?: string; id?: string }>;
    /* 上报「宠物本体」矩形（相对窗口内容左上角，CSS 像素；null = 无可交互区）——主进程按 screen.getCursorScreenPoint 轮询比对决定整块穿透/可交互。⛔ 翻转判据刻意不依赖页面鼠标事件：窗口整块是 app-region drag，drag 区属非客户区，Chromium 不派发 DOM mousemove（第一版挂在 mousemove 上 ⇒ 宠物直接拖不动） */
    petInteractiveRect(rect: { x: number; y: number; width: number; height: number } | null): Promise<{ ok: boolean }>;
    /* 扫描宠物目录（内置 dist/pets + userData/pets + ~/.codex/pets + ~/.petdex/pets）；同名 id 先到先得，内置优先 */
    petList(): Promise<PetPackage[]>;
    /* 在系统文件管理器打开宠物目录（缺省 = 用户目录；不存在则先建，否则 Windows 上静默无反应） */
    petOpenDir(which?: string): Promise<{ ok: boolean; error?: string; dir: string }>;
    /* 桌面宠物双击/工具栏「打开」：聚焦主窗口 */
    petOpenMain(): Promise<{ ok: boolean }>;
    /* 宠物目录清单：设置页显示「官方宠物包放哪儿」，writable 只对用户目录为真 */
    petRoots(): Promise<PetRootInfo[]>;
    /* 宠物设置 + 当前生效的宠物包（active 无效时回落第一只可用的） */
    petSettingsGet(): Promise<PetStatus>;
    /* 改完立刻应用（显隐 / 位置 / 缩放 / 透明度）；取值一律归一化后再落盘 */
    petSettingsSet(patch: Partial<PetSettings>): Promise<PetStatus>;
    /* 显示宠物（置 enabled=true） */
    petShow(): Promise<{ settings: PetSettings; open: boolean }>;
    /* 浮窗首帧补水（推送可能发生在窗口创建之前）+ 诊断 */
    petState(): Promise<{ signal: PetSignal; open: boolean; bounds: PetBounds | null }>;
    /* 显示/隐藏切换（走独立通道，避免为了开关宠物而整份重写设置） */
    petToggle(): Promise<{ settings: PetSettings; open: boolean }>;
    /* 跑上游 --doctor 体检 */
    phoneHarnessDoctor(): Promise<{ok:boolean;log:string}>;
    /* 按平台返回权限引导步骤 */
    phoneHarnessGuides(): Promise<{id:string;title:string;steps:string[]}[]>;
    /* 装 phone-harness + 关遥测 + 注册技能 */
    phoneHarnessInstall(): Promise<{ok:boolean;log:string}>;
    /* 打开系统权限设置页 */
    phoneHarnessOpenSettings(): Promise<void>;
    /* 手机控制状态（平台/pip 包/adb/技能/遥测） */
    phoneHarnessStatus(): Promise<{platform:string;python:string;pythonOk:boolean;installed:boolean;version:string;adb:boolean;skill:boolean;telemetryOff:boolean;iphoneEligible:boolean}>;
    /* 卸载 phone-harness 与技能 */
    phoneHarnessUninstall(): Promise<{ok:boolean;log:string}>;
    /* 把工具链里的 adb 写进 phone-harness 配置（android.adb，不改系统 PATH） */
    phoneHarnessWireAdb(): Promise<{adb:string}>;
    validatePlugin(target: string): Promise<{ ok: boolean; root: string; manifestPath?: string; issues: string[]; inventory: { skills: number; commands: number; agents: number; hooks: number }; name?: string }>;
    installMarketPlugin(plugin: PluginMarketEntry): Promise<PluginMarketInstallResult>;
    /* 10-03：本地已装市场插件清单（**只扫本地目录、零网络**；供「已安装」列表补齐引擎没认领的那批 —— 不能走 market-list，那条会拉远端 48 个插件） */
    listInstalledMarketPlugins(): Promise<{ slug: string; version: string; description: string }[]>;
    /* 10-03：逐项 installed 之外另给**全量已装 slug 清单**（不分页），供渲染层把「引擎没认领但文件已落盘」的插件补进「已安装」列表 */
    listMarketPlugins(input?: { category?: string; query?: string; page?: number; pageSize?: number }): Promise<{ items: PluginMarketEntry[]; installedIds: string[]; total: number; page: number; pageSize: number }>;
    /* 10-03：本地市场插件卸载（先请引擎 plugin/uninstall，再删落盘目录 + 摘 marketplace 清单；删除目标经 safeFolder 归一 + 目录内校验） */
    uninstallMarketPlugin(slug: string): Promise<{ ok: boolean; reason?: string; engineRemoved?: boolean }>;
    setPluginEnabled(input: { pluginIds: string[]; enabled: boolean }): Promise<{ changed: number; failures: string[] }>;
    setPluginLinkedEnabled(input: { pluginId: string; enabled: boolean }): Promise<{ ok: boolean; failures: string[] }>;
    /* 10-12 新增：按 slug 取市场最新对象、重跑**同一条安装链**覆盖更新（含引擎注册与重启）。市场已下架时明确报错，不静默跳过 */
    updatePlugin(slug: string): Promise<{ ok?: boolean; from: string; to: string; engineRegistered: boolean; engineCheckMessage: string }>;
    /* 10-12 新增：插件**有版本号**（marketplace.json 的 version vs 本地 .codex-market.json）⇒ 走真版本比对。⛔ 只读、零副作用；版本缺失的一律 comparable:false 交给界面如实显示，不许演成「已是最新」 */
    checkPluginUpdates(): Promise<{ slug: string; name: string; current: string; latest: string; hasUpdate: boolean; comparable: boolean }[]>;
    /* 10-09 用户在界面上按「中止」→ 主进程的 wait 循环停下（任务本身不会被撤销） */
    pollAbort(input: { taskId: string }): Promise<{ ok: boolean; aborted: boolean }>;
    /* 10-09 轮询板块：读「间隔 / 超时上限 / 失败重试次数」（真相源在 userData/poll-settings.json） */
    pollConfigRead(): Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>;
    /* 10-09 保存轮询配置（会先过钳制：超时≥间隔×2）—— 返回**钳制后**的真值，渲染层照它回显 */
    pollConfigSave(input: { intervalMs?: number; timeoutMs?: number; maxRetry?: number }): Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>;
    ponytailModeGet(): Promise<string>;
    ponytailModeSet(mode: string): Promise<{ mode: string }>;
    enhancePrompt(text: string): Promise<{ ok: boolean; text?: string; error?: string }>;
    qqConnect(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    qqLogout(): Promise<{ ok: boolean }>;
    qqQrCancel(): Promise<{ ok: boolean }>;
    qqQrStart(): Promise<{ state: string; qr?: string; name?: string; error?: string }>;
    qqQrStatus(): Promise<{ state: string; qr?: string; name?: string; error?: string }>;
    /* 取消排队消息定时（删除消息/取消定时/到点清理时调） */
    queueTimerCancel(input: { queuedSubmissionId: string }): Promise<{ ok: boolean }>;
    /* 排队消息定时发送：主进程登记定时器（不受渲染层隐藏节流），到点广播 queue-timer:due */
    queueTimerSet(input: { threadId: string; queuedSubmissionId: string; runAt: number }): Promise<{ ok: boolean; scheduled: boolean }>;
    relayAccounts(): Promise<{ id: string; baseUrl: string; email: string; loggedIn: boolean; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyName: string | null; active: boolean; disabled: boolean }[]>;
    relayCreateKey(input: { name: string; groupId?: number | null; accountId?: string }): Promise<{ id: number; key: string; name: string; group_id: number | null; status: string }>;
    /* 删除密钥（上游 DELETE /api/v1/keys/:id）。⛔ 正在使用的密钥（selectedKeyId）拒绝删除 —— 删掉后当前供应商拿着死 key 全部 401，先切再删 */
    relayDeleteKey(input: { id: number; accountId?: string }): Promise<{ ok: boolean }>;
    relayKeyBilling(input: { baseUrl: string; apiKey: string }): Promise<any>;
    relayKeysAll(): Promise<{ id: string; email: string; baseUrl: string; active: boolean; selectedKeyId: number | null; keys: any[]; error?: string }[]>;
    relayLoadAccount(): Promise<{ baseUrl: string; email: string; loggedIn: boolean; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyName: string | null } | null>;
    relayLogin(input: { baseUrl: string; email: string; password: string }): Promise<{ email: string; baseUrl: string; balance: number }>;
    relayOpenPurchase(): Promise<{ ok: boolean; url: string }>;
    relayOverview(id?: string): Promise<{ baseUrl: string; email: string; balance: number; subscriptions: any[]; keys: any[]; groups: any[]; selectedMode: "balance" | "plan" | null; selectedGroupId: number | null; selectedKeyId: number | null; selectedKeyName: string | null }>;
    relayPaymentPlans(): Promise<any[]>;
    relayRegister(input: { baseUrl: string; email: string; password: string; affCode?: string }): Promise<{ email: string; baseUrl: string; balance: number }>;
    relayRemoveAccount(id: string): Promise<{ ok: boolean; activeId: string | null; removed?: boolean; deactivated?: boolean }>;
    relaySelect(input: { mode: "balance" | "plan"; groupId: number | null; keyId?: number; keyName?: string }): Promise<{ ok: boolean }>;
    relaySwitchAccount(id: string): Promise<{ ok: boolean; baseUrl: string; email: string }>;
    relayToggleAccount(input: { id: string; disabled: boolean }): Promise<{ ok: boolean; disabled: boolean; deactivated?: boolean }>;
    /* 改已有密钥的分组（上游 PUT /api/v1/keys/:id）。⛔ 上游对 group_id=null 是「不修改」⇒ 解绑成无分组做不到，UI 只提供分组间切换；改当前生效密钥时同步 selectedGroupId */
    relayUpdateKeyGroup(input: { id: number; groupId: number; accountId?: string }): Promise<any>;
    remoteApprove(rid: string): Promise<{ ok: boolean }>;
    remoteDeny(rid: string): Promise<{ ok: boolean }>;
    remoteDevices(): Promise<any[]>;
    remotePairRotate(): Promise<{ code: string }>;
    remotePairState(): Promise<{ code: string; pending: { rid: string; deviceId: string; name: string; createdAt: number }[]; approved: { deviceId: string; name: string; approvedAt: number; lastSeen: number }[] }>;
    remoteQrcode(botId?: string): Promise<string>;
    remoteRevoke(deviceId: string): Promise<{ ok: boolean }>;
    remoteSend(cmd: string): Promise<{ ok: boolean }>;
    remoteStart(): Promise<{ port: number; url: string }>;
    remoteStatus(): Promise<{ status: string; devices: any[]; url: string; relay: { state: string; id: string; base: string; publicBase: string; error: string; since: number } }>;
    remoteStop(): Promise<{ ok: boolean }>;
    deleteRpaRecipe(id: string): Promise<void>;
    listRpaRecipes(): Promise<any[]>;
    recordRpaRun(input: { id: string; ok: boolean; error?: string }): Promise<void>;
    saveRpaRecipe(input: unknown): Promise<any>;
    /* 10-07 取消安装：杀子进程 + 清临时文件；reason=not-running 表示该工具没有在跑的安装 */
    cancelRuntime(id: string): Promise<{ ok: boolean; reason?: string; killed?: number }>;
    /* 工具自检（10-02 用户要的「检查」）：逐个探测已装工具**能不能真跑**（跑一次版本命令/可执行性），返回逐项结果，界面直接列给人看 */
    runtimeHealth(): Promise<{ id: string; name: string; installed: boolean; ok: boolean; detail: string }[]>;
    installRuntime(id: string): Promise<{ ok: boolean; runtimes: DevRuntimeEntry[] }>;
    listRuntimes(): Promise<DevRuntimeEntry[]>;
    uninstallRuntime(id: string): Promise<{ ok: boolean; runtimes: DevRuntimeEntry[] }>;
    /* 10-12 新增：从 npm 国内镜像装 <pkg>@latest 到 tools/npm-global（进度走 runtime:progress），装完**复核磁盘版本**、再按闸门重启引擎。⛔ 与「修复安装」不同：后者从随包 zip 重解压（版本回到包内版本，属降级） */
    updateRuntime(id: string): Promise<{ ok: boolean; joined?: boolean; cancelled?: boolean; from?: string; to?: string; runtimes: DevRuntimeEntry[] }>;
    /* 10-12 新增（用户要求「nuphus 和 browser 留国内镜像源更新入口」）：查 npm 最新版（国内镜像优先、回落官方源）并读磁盘已装版，给出 hasUpdate。传 id 返回单条、不传返回全部可更新工具 —— 包名与落位的真相源在主进程 UPDATEABLE_TOOLS / npmGlobalRootCandidates */
    checkRuntimeUpdate(id?: string): Promise<{ id: string; name: string; pkg: string; current: string; latest: string; registry: string; hasUpdate: boolean; error: string } | { id: string; name: string; pkg: string; current: string; latest: string; registry: string; hasUpdate: boolean; error: string }[]>;
    deleteScheduledTask(id: string): Promise<void>;
    listScheduledTasks(): Promise<any[]>;
    runScheduledTask(id: string): Promise<void>;
    saveScheduledTask(input: unknown): Promise<any>;
    createScratchDir(): Promise<string>;
    /* 成功时另推 screenshot:captured 事件给主窗口（渲染层只认事件，避免插两份） */
    screenshotCapture(mode: "full" | "region"): Promise<ShotCaptureResult>;
    /* 先注册成功才落盘；冲突时保留原设置 */
    screenshotHotkeySet(input: { mode: "full" | "region"; accelerator?: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string; settings?: ScreenshotSettings }>;
    screenshotPickDir(): Promise<string | null>;
    /* 在系统文件管理器里定位截图 */
    screenshotReveal(file: string): Promise<boolean>;
    /* 截图设置 + 实际注册成功的快捷键 + 冲突说明 */
    screenshotSettingsGet(): Promise<ScreenshotSettingsSnapshot>;
    /* 改完立刻重挂快捷键（不重启即生效） */
    screenshotSettingsSet(patch: Partial<ScreenshotSettings>): Promise<ScreenshotSettingsSnapshot>;
    shellOpen(target: string): Promise<void>;
    shellReveal(target: string): Promise<void>;
    windowClose(): Promise<{ ok: boolean }>;
    /* 窗口控制（无边框窗自定义按钮；只作用于调用者自己的窗口） */
    windowMinimize(): Promise<{ ok: boolean }>;
    windowState(): Promise<{ maximized: boolean }>;
    windowToggleMaximize(): Promise<{ maximized: boolean }>;
    skillDisciplineGet(): Promise<{ present: boolean; section: string }>;
    /* 内置技能的独立开关（10-06）：读某内置技能**全局**是否生效（设置 → 控制台用；与 skill-pool 同一真相源） */
    getBuiltinSkillSwitch(input: { name: string }): Promise<{ name: string; enabled: boolean; available: boolean; error?: string }>;
    /* 开关内置技能的**全局**生效态并立即投影磁盘（cwd 可空；只动全局集，不改项目集） */
    setBuiltinSkillSwitch(input: { name: string; enabled: boolean; cwd?: string }): Promise<{ name: string; enabled: boolean; available: boolean; error?: string }>;
    importSkill(): Promise<{ name: string; path: string; source: string; content: string } | null>;
    /* 精选技能包（10-30）：三个第三方技能包的安装状态（已装技能名来自本板块自己写的 marker） */
    listSkillPacks(): Promise<{ id: string; name: string; repo: string; license: string; licenseUrl: string; size: string; description: string; companion: string; installed: boolean; installedSkills: string[]; installedAt: string; skillsRoot: string }[]>;
    /* 下载仓库 skills/ 子树 → 逐个 auditSkill → 落 codex-home/skills → 重启引擎；同名目录跳过、不覆盖 */
    installSkillPack(input: { id: string }): Promise<{ installed: string[]; skipped: string[]; rejected: string[]; bytes: number }>;
    /* 只删本板块 marker 记下的技能目录（⛔ 用户自建的目录不动） */
    uninstallSkillPack(input: { id: string }): Promise<{ removed: string[]; remaining: string[]; kept: string[] }>;
    listLocalSkills(): Promise<LocalSkillEntry[]>;
    removeLocalSkill(input: { folder: string; name?: string }): Promise<{ ok: boolean; engineRemoved?: boolean; engineCheckMessage?: string }>;
    installMarketSkill(skill: MarketSkillEntry): Promise<LocalSkillEntry>;
    installMarketSkillLight(skill: unknown): Promise<{ name: string; discovered: boolean; engineCheckMessage: string }>;
    listMarketSkills(input?: { category?: string; page?: number; pageSize?: number; query?: string }): Promise<{ items: MarketSkillEntry[]; total: number; page: number; pageSize: number }>;
    /* 共享技能池（09-27）：按项目查看/管理全局技能生效集 */
    describeSkillPool(input: { cwd: string }): Promise<{ skills: { name: string; globalDisabled: boolean; projectDisabled: boolean; active: boolean }[] }>;
    /* 设置全局停用/本项目禁用并立即投影 */
    setSkillPoolState(input: { cwd: string; name: string; globalDisabled?: boolean; projectDisabled?: boolean }): Promise<{ ok: boolean }>;
    setEnabledSkill(input: { folder: string; enabled: boolean }): Promise<{ ok: boolean }>;
    setEnabledSkillBatch(input: { folders: string[]; enabled: boolean }): Promise<{ ok: boolean; changed: number; failures: string[] }>;
    /* 10-12 新增：把某个已装的市场技能重新拉取覆盖（复用市场安装链：下载/安检/解压/落盘/来源清单），再刷新 skills/list。folder = 技能目录名 */
    updateSkill(folder: string): Promise<{ ok: boolean; name: string; folder: string; discovered: boolean }>;
    /* 10-12 新增（用户要求「技能和插件加一个更新功能」）：技能市场**没有版本号** ⇒ 判据是**内容比对**（把市场当前的包下下来，与磁盘上已装的逐文件对齐，相对路径 + 内容 sha256，两侧同一函数）。三态：update / current / unresolved（市场搜不到、比对失败、或本地导入无市场来源）——⛔ unresolved 绝不演成 current */
    checkSkillUpdates(): Promise<{ folder: string; name: string; marketId?: string; marketSource?: "cocoloop" | "skillhub"; state: "update" | "current" | "unresolved"; detail: string }[]>;
    /* 应用人格（slug=null 还原默认）：写 personalization.persona + 同步 $CODEX_HOME/AGENTS.md，新会话即生效 */
    applySoulMarket(input: { slug: string | null }): Promise<{ slug: string; displayName: string }>;
    /* 当前生效人格（soulSlug 空 = 默认人格） */
    currentSoulMarket(): Promise<{ soulSlug: string; persona: string }>;
    /* 人格详情（content = 完整中文人设） */
    getSoulMarket(input: { slug: string }): Promise<{ slug: string; displayName: string; summary: string; version: string; content: string }>;
    /* SkillHub 人格市场（skillhub.cn/soul，16 套全量） */
    listSoulMarket(): Promise<{ items: { slug: string; displayName: string; summary: string; version: string }[]; total: number }>;
    deleteSshServers(ids: string[]): Promise<SshServer[]>;
    execSshCommand(server: SshServer, command: string): Promise<SshExecResult>;
    exportSshServers(servers: SshServer[], includeSecrets: boolean): Promise<string | null>;
    importSshServers(): Promise<SshServer[] | null>;
    /* SSH 服务器连接管理：列表 CRUD、批量启停、连接测试、命令执行、交互式会话、导入导出 */
    listSshServers(): Promise<SshServer[]>;
    saveSshServer(server: SshServer): Promise<SshServer[]>;
    sshSessionClose(sessionId: string): Promise<void>;
    sshSessionOpen(server: SshServer, cols: number, rows: number): Promise<{ sessionId: string } | { error: string }>;
    sshSessionResize(sessionId: string, cols: number, rows: number): Promise<void>;
    sshSessionWrite(sessionId: string, data: string): Promise<void>;
    setSshServersEnabled(ids: string[], enabled: boolean): Promise<SshServer[]>;
    testSshServer(server: SshServer): Promise<SshTestResult>;
    listSubAgents(): Promise<SubAgentEntry[]>;
    removeSubAgent(id: string): Promise<{ ok: boolean }>;
    saveSubAgent(input: unknown): Promise<SubAgentEntry>;
    addTask(input: { text: string; priority?: string }): Promise<any>;
    clearTasks(): Promise<void>;
    deleteTask(id: string): Promise<void>;
    listTasks(): Promise<any[]>;
    updateTask(input: { id: string; patch: unknown }): Promise<any>;
    /* 专家团历史委托记录（成员历史工作记录面板；主进程落盘，跨窗口一致） */
    listTeamRuns(threadId: string): Promise<TeamMemberRunRecord[]>;
    teamThreadsMap(): Promise<{ threads: Record<string, string>; members: Record<string, string> }>;
    teamOfThread(threadId: string): Promise<string>;
    /* 进入团队模式（切团队记忆上游 + 接团队知识库） */
    teamEnter(input?: { teamId?: string }): Promise<any>;
    /* 退出团队模式（恢复个人知识库连接器） */
    teamExit(): Promise<any>;
    /* 团队工作模式：我加入的团队 */
    teamList(): Promise<any>;
    /* 团队模式当前生效状态 */
    teamStatus(): Promise<any>;
    /* 上传本机文件到团队知识库（走云端计费与权限闸） */
    teamUpload(input?: { paths?: string[] }): Promise<any>;
    invokeTeamMember(input: { teamId: string; memberId: string; query: string; leadThreadId?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string }): Promise<{ threadId: string; turnId?: string; teamId: string; memberId: string; name: string; profession: string; output: string; runId?: string; reused?: boolean }>;
    listExpertTeams(): Promise<ExpertTeamConfig[]>;
    startTeamMemberSession(input: { teamId: string; memberId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }): Promise<{ thread: any; turnId: string | null; member: { id: string; name: string; profession: string }; role?: ExpertPendingRole | null }>;
    removeExpertTeam(teamId: string): Promise<{ ok: boolean }>;
    resetExpertTeams(): Promise<ExpertTeamConfig[]>;
    saveExpertTeam(input: unknown): Promise<ExpertTeamConfig>;
    getTeamSessionConfig(teamId: string): Promise<{ team: ExpertTeamConfig; systemPrompt: string; teamTool: any }>;
    startTeamSession(input: { teamId: string; task?: string; cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null; defer?: boolean }): Promise<{ thread: any; turnId: string | null; role?: ExpertPendingRole | null }>;
    getTeamTools(teamId: string): Promise<{ tools: { id: string; name: string; profession: string; description: string }[]; teamSystemPrompt: string; teamTool: any }>;
    telegramConnect(token: string): Promise<{ ok: boolean; username?: string; error?: string }>;
    telegramLogout(): Promise<{ ok: boolean }>;
    telegramStatus(): Promise<{ bound: boolean }>;
    terminalInput(id: string, data: string): Promise<void>;
    listTerminals(): Promise<{ id: string; alive: boolean; cwd: string }[]>;
    terminalReady(): Promise<void>;
    terminalResize(id: string, cols: number, rows: number): Promise<void>;
    restartTerminal(id: string, cwd?: string): Promise<void>;
    themeApply(theme: string): Promise<{ ok: boolean }>;
    getThreadRuntime(threadId: string): Promise<{ model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number } | null>;
    listThreadRuntimes(): Promise<Record<string, { model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number }>>;
    /* 10-29 起不再有 takeover / 独占锁：写的就是本会话的模型/档位/权限/调度许可 */
    patchThreadRuntime(input: { threadId: string; patch: unknown; baseRev?: number; takeover?: boolean }): Promise<{ runtime: { model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number }; conflict: boolean; changed: boolean; blockedBy?: string; tookOverFrom?: string; restrictedBy?: string }>;
    seedThreadRuntime(input: { threadId: string; runtime: unknown }): Promise<{ model: string; effort: string; sandbox: string; approval: string; rev: number; updatedAt: number }>;
    /* 会话备份：导出 = 打包引擎 rollout 原档 + 元信息为 .json；threadIds 缺省/空数组 = 全部 */
    exportThreadsBackup(threadIds?: string[]): Promise<{ path: string; count: number } | null>;
    /* 会话记录导出为通用 Markdown（主流 AI 可直接读取/带入）；threadIds 缺省/空数组 = 全部 */
    exportThreadsMarkdown(threadIds?: string[]): Promise<{ path: string; count: number; totalMessages: number } | null>;
    importThreadsBackup(): Promise<{ path: string; imported: number; skipped: number; threads: { id: string; name: string; status: string }[] } | null>;
    importConversationMarkdown(input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }): Promise<{ thread: any; imported: { title: string; fileName: string; turns: number; text: string; at: string } } | null>;
    /* ⛔ 09-23 补：以下方法 preload 里早就有、渲染层也在用，但这里一直没有签名 —— 渲染层从不跑 tsc ⇒ 静默漏网（gen-ipc-bridge 提取时暴露）。返回形状没把握的先 any。 */
    previewConversation(threadId: string): Promise<any>;
    toolStatus(): Promise<{ id: string; name: string; scope: "computer" | "browser"; version: string; installed: boolean; binaryReady: boolean; detail: string; command: string }[]>;
    updateCheck(): Promise<{ ok: boolean; info?: { hasUpdate: boolean; reason: string; version?: string; filename?: string; size?: number; sha256?: string; changelog?: string; mandatory?: boolean; downloadUrl?: string }; currentVersion?: string; source?: string; error?: string }>;
    updateDownload(input: { downloadUrl: string; filename?: string; mode?: "differential" | "full" }): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
    /* 10-12 后台静默下载：地址只认主进程自己的检查结果，绝不接受渲染层指定；10-25 可选 mode 只决定补丁/完整包 */
    updateDownloadSilent(input?: { mode?: "differential" | "full" }): Promise<{ ok: boolean; error?: string; version?: string; path?: string; alreadyDone?: boolean }>;
    updateInstall(filePath: string): Promise<{ ok: boolean; error?: string }>;
    /* 10-12 重启安装：零参数（先 spawn 已校验的安装包、再 quit 自己，顺序反了会被文件锁挡住） */
    updateRestartInstall(): Promise<{ ok: boolean; error?: string }>;
    updateReveal(filePath: string): Promise<{ ok: boolean }>;
    getUsername(): Promise<string>;
    /* 主进程解密后直写剪贴板（明文不返回渲染层） */
    vaultCopy(id: string): Promise<{ ok: boolean; reason?: string }>;
    /* 密码本列表（不含明文，只有 hasSecret） */
    vaultList(): Promise<{ items: VaultItem[]; encrypted: boolean }>;
    vaultRemove(id: string): Promise<{ items: VaultItem[] }>;
    /* 保存/更新一条；password 省略=保留原密码 */
    vaultSave(input: { id?: string; title?: string; username?: string; url?: string; note?: string; password?: string }): Promise<{ items: VaultItem[] }>;
    /* 按顺序合并视频片段成一条成片（整片导出）：先 -c copy，失败回落统一重编码；输出 <workspace>/.drama-canvas/export/ */
    videoConcat(input: { workspace: string; name: string; files: string[]; width?: number; height?: number; fps?: number }): Promise<{ path: string; bytes: number; mode: "copy" | "reencode"; parts: number }>;
    /* 各厂商凭证（userData/video-providers.json） */
    videoConfigRead(): Promise<Record<string, Record<string,string>>>;
    /* 保存某厂商的 API 凭证 */
    videoConfigSave(input: { providerId: string; values: Record<string,string> }): Promise<{ ok: boolean; configured: boolean }>;
    /* 把产物视频拉回本地落 <workspace>/.drama-canvas/assets/（可信根校验） */
    videoDownload(input: { url: string; workspace: string; name: string; subdir?: string; outputDir?: string }): Promise<{ path: string; bytes: number }>;
    /* 轮询任务状态（MiniMax 成功后自动两段式换下载地址） */
    videoPoll(input: { providerId: string; jobId: string }): Promise<{ status: string; url?: string; error?: string }>;
    /* 内置视频生成接口：国内外 8 家厂商清单 + 是否已配凭证（可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo） */
    videoProviders(): Promise<{id:string;name:string;region:string;modes:string[];imageInput:string;fields:string[];models:string[];defaultModel:string;configured:boolean}[]>;
    /* 提交视频生成异步任务（i2v 时 image 可为本地路径/URL，主进程转 base64） */
    videoSubmit(input: { providerId: string; mode: string; prompt: string; image?: string; model?: string; duration?: number; aspect?: string }): Promise<{ jobId: string }>;
    /* 我是播报窗口吗 + 当前会话静音态（按 threadId 分开，别的会话停止不影响当前会话；取不到 owner 时保底 true） */
    announceOwner(threadId?: string): Promise<{ owner: boolean; ownerWebContentsId: number | null; reason: string; muted: boolean; callActive: boolean }>;
    /* 会话级静音闩锁（同一 threadId 的窗口一起安静；别的会话不受影响） */
    announceSetMuted(input?: { muted?: boolean; threadId?: string }): Promise<{ muted: boolean; threadId: string }>;
    voiceBarge(): Promise<{ ok: boolean }>;
    voiceDictationFinish(): Promise<{ ok: boolean; text?: string; error?: string }>;
    voiceEndpointNow(): Promise<{ ok: boolean; text?: string }>;
    voiceHotkeyGet(): Promise<{ registered: string }>;
    voiceHotkeySet(input: { accelerator: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string }>;
    voiceKwsCancel(): Promise<{ ok: boolean }>;
    voiceKwsInstall(): Promise<{ ok: boolean; error?: string }>;
    voiceKwsStatus(): Promise<{ ready: boolean }>;
    voiceMicPermission(): Promise<{ status: string; error?: string }>;
    voiceModelsCancel(): Promise<{ ok: boolean }>;
    voiceModelsImport(input: { sourceDir: string }): Promise<{ ok: boolean; failures: string[] }>;
    voiceModelsInstall(): Promise<{ ok: boolean; error?: string }>;
    voiceModelsReveal(): Promise<string>;
    /* 10-03：新增 baseEnabled / 各资源 enabled —— 启用与已下载正交，UI 靠它们组合出四态 */
    voiceModelsStatus(): Promise<{ ready: boolean; missing: string[]; readyFiles: number; totalFiles: number; bytes: number; root: string; repos: { id: string; lastSegment: string }[]; baseEnabled?: boolean; zipvoice?: { ready: boolean; enabled?: boolean; bytes: number; dir: string }; kws?: { ready: boolean; enabled?: boolean; bytes: number; dir: string }; resources?: Record<string, { enabled: boolean; label: string }>; }>;
    voiceModelsUninstall(): Promise<{ ok: boolean }>;
    voicePlaybackDone(): Promise<{ ok: boolean }>;
    voicePresetApply(presetId: string): Promise<{ ok: boolean; profile?: any; existed?: boolean; error?: string }>;
    voicePresetList(): Promise<{ presets: { id: string; name: string; desc: string; lang: string; applied: boolean }[] }>;
    voicePreviewVoice(input?: { sid?: number; speed?: number; text?: string; profileId?: string; warm?: boolean; numSteps?: number }): Promise<{ ok: boolean; sampleRate?: number; audioBase64?: string; error?: string }>;
    /* 10-08 音色上传接口：source=base64/file 已实现；pack（音色包）**预留**、明确返回未开放。走与导入同一条草稿链（落盘→ASR 转写参考文本→用户校对） */
    voiceProfileUpload(input?: { source?: "base64" | "file" | "pack"; name?: string; refText?: string; audioBase64?: string; sampleRate?: number }): Promise<any>;
    voiceProfilesDelete(id: string): Promise<{ ok: boolean }>;
    voiceProfilesImport(): Promise<any>;
    voiceProfilesList(): Promise<{ profiles: any[]; zipvoiceReady: boolean }>;
    voiceProfilesPreview(input: { id?: string; text?: string }): Promise<any>;
    voiceProfilesRecord(input: { samples: number[]; sampleRate: number }): Promise<any>;
    voiceProfilesSave(input: { draftFile: string; name: string; refText: string }): Promise<any>;
    voiceProfilesSelect(id: string): Promise<{ ok: boolean; profileId: string; ttsError?: string }>;
    /* 10-03 按资源删除（物理删文件，渲染层二次确认） */
    voiceResourceDelete(input: { kind: string }): Promise<{ ok: boolean; error?: string }>;
    /* 10-03 资源停用/启用（不删文件，可逆） */
    voiceResourceSetEnabled(input: { kind: string; enabled: boolean }): Promise<{ ok: boolean; error?: string; enabled?: boolean }>;
    /* 10-03 单个资源的启用状态与占用 */
    voiceResourceStatus(input: { kind: string }): Promise<any>;
    voiceSettingsGet(): Promise<{ settings: { tts: { sid: number; speed: number; volume: number; engine?: "vits" | "kokoro" | "emotivoice"; profileId?: string; numSteps: number }; asr: { rule1: number; rule2: number; rule3: number; numThreads: number }; mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean }; barge: { gateDb: number; mode: "auto" | "manual" }; aec?: { mode: "auto" | "on" | "off" }; modelHost: "auto" | "huggingface" | "hf-mirror"; hotkey: { enabled: boolean; accelerator: string }; dictationHotkey: { enabled: boolean; accelerator: string }; wake: { enabled: boolean; phrase: string }; announce: { enabled: boolean }; ball: { visible: boolean; hints: boolean; style: string }; resources?: Partial<Record<"base" | "zipvoice" | "kws" | "kokoro" | "emotivoice", boolean>>; version?: number }; ttsVoices: Record<number, string>; modelHosts: Record<string, string>; modelHostOptions: string[]; }>;
    voiceSettingsSet(patch: any): Promise<{ tts: { sid: number; speed: number; volume: number; engine?: "vits" | "kokoro" | "emotivoice"; profileId?: string; numSteps: number }; asr: { rule1: number; rule2: number; rule3: number; numThreads: number }; mic: { deviceId: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean }; barge: { gateDb: number; mode: "auto" | "manual" }; aec?: { mode: "auto" | "on" | "off" }; modelHost: "auto" | "huggingface" | "hf-mirror"; hotkey: { enabled: boolean; accelerator: string }; dictationHotkey: { enabled: boolean; accelerator: string }; wake: { enabled: boolean; phrase: string }; announce: { enabled: boolean }; ball: { visible: boolean; hints: boolean; style: string }; resources?: Partial<Record<"base" | "zipvoice" | "kws" | "kokoro" | "emotivoice", boolean>>; version?: number }>;
    voiceSpeak(text: string, options?: { sid?: number; speed?: number }): Promise<{ ok: boolean; sampleRate?: number; audioBase64?: string; error?: string }>;
    voiceStart(threadId: string, options?: { mode?: "conversation" | "dictation" }): Promise<{ ok: boolean; error?: string; status: unknown }>;
    voiceStatus(): Promise<{ active: boolean; state: string; runtimeReady: boolean; modelsReady: boolean; threadId: string; lastError: string }>;
    voiceStop(): Promise<{ ok: boolean }>;
    /* 10-26 取消当前引擎包下载 */
    voiceTtsPackCancel(): Promise<any>;
    /* 10-26 可选合成引擎包（kokoro / emotivoice）按需下载；进度事件 voice:event 带 target=pack */
    voiceTtsPackInstall(pack: string): Promise<any>;
    voiceWakeAudio(samples: Float32Array): Promise<{ ok: boolean; matched: boolean }>;
    voiceWakeReset(): Promise<{ ok: boolean }>;
    voiceWakeStart(): Promise<{ ok: boolean; error?: string; phrase?: string; hint?: string }>;
    voiceWakeStop(): Promise<{ ok: boolean }>;
    voiceZipvoiceCancel(): Promise<{ ok: boolean }>;
    voiceZipvoiceInstall(): Promise<{ ok: boolean; error?: string }>;
    wecomWebhookConnect(url: string): Promise<{ ok: boolean; name?: string; error?: string }>;
    wecomWebhookLogout(): Promise<{ ok: boolean }>;
    wecomWebhookTest(text?: string): Promise<{ ok: boolean; error?: string }>;
    weixinCancelLogin(): Promise<{ ok: boolean }>;
    weixinLogout(): Promise<{ ok: boolean }>;
    weixinPollLogin(): Promise<{ status: string; verifyCodeRequired?: boolean; connected?: boolean } | null | undefined>;
    /* 主动推送一条微信消息给用户（to 缺省=最近对话用户）。⛔ 正文气泡依赖 context_token，对方近期发过消息才最可靠；机器人未登录时抛错 */
    weixinSend(input: { to?: string; text: string }): Promise<{ ok: boolean }>;
    weixinStartLogin(): Promise<{ qrcodeImg: string; qrcode: string } | null | undefined>;
    weixinStatus(): Promise<{ bound: boolean }>;
    /* 「知道了」：记下「当前版本已看过」（⛔ 只接受当前版本号 —— 权威值在主进程，渲染层传别的值会被拒） */
    whatsNewAck(version: string): Promise<{ ok: boolean; error?: string }>;
    /* 全量版本要点（新手引导 → 版本更新日志用）：数据同 whats-new-notes.ts 单一真相源；GitHub Release 链接在主进程拼好 */
    whatsNewHistory(): Promise<{ ok: boolean; entries: { version: string; date: string; items: { t: string; d?: string }[]; releaseUrl: string }[] }>;
    /* 更新后首次启动的「新功能介绍」—— 该不该弹、弹什么由主进程判定（要点在 electron/whats-new-notes.ts，看过记录在 userData/whats-new.json） */
    whatsNewState(): Promise<{ ok: boolean; version: string; entry: { version: string; date: string; items: { t: string; d?: string }[] } | null; shouldShow: boolean; reason: string; seen: boolean; releaseUrl: string }>;
    popoutClose(threadId: string | null): Promise<{ ok: boolean }>;
    popoutThreadId(): Promise<string | null>;
    popoutList(): Promise<string[]>;
    popoutThread(threadId: string): Promise<{ ok: boolean; focused?: boolean }>;
    /* 删工作日志文件（销毁性，不会重建）：只删 .codex-harness/memory 之下的普通文件；目录、越界路径一律拒绝 */
    workLogsDelete(input: { paths: string[] }): Promise<{ deleted: number; bytes: number; failed: string[] }>;
    /* 读一份工作日志/记忆文件的正文（UI 内查看）。路径必须落在某个项目的 .codex-harness/memory 之下；>512KB 拒绝（提示去文件管理器打开） */
    workLogsRead(input: { path: string }): Promise<{ path: string; text: string; bytes: number; mtime: number }>;
    /* 扫各项目的**工作日志与项目记忆**（<项目>/.codex-harness/memory/**：长期记忆 / 坑与纪律 / logs 日报 / archive / project）。项目清单来自 rollout 扫出的 cwd 集合。⛔ 这是项目里的工作记录，与会话本身的归档 / 删除（「归档管理」页）不是一回事 */
    workLogsScan(): Promise<{ projects: Array<{ cwd: string; name: string; memoryDir: string; exists: boolean; bytes: number; files: Array<{ path: string; rel: string; kind: string; bytes: number; mtime: number }> }> }>;
    /* 输入框竖条 + 功能入口菜单的可扩展目录（内置 + userData/extensions.json） */
    extensionsCatalog(): Promise<{ rail: RailPanelSpec[]; menu: MenuEntrySpec[]; file: string }>;
    /* 10-29 保存功能入口的自定义设置页条目（整表覆盖 menu 字段，rail 保留；url/settings 白名单，40 条上限） */
    extensionsMenuSet(input: { entries: MenuEntrySpec[] }): Promise<{ ok: boolean; menu: MenuEntrySpec[] }>;
    /* 聚合读取：应用内键（shortcuts.json）+ 截图/语音键（各自真存储） */
    shortcutsRead(): Promise<{ bindings: Record<string, string[]>; overrides: Record<string, string[]>; defaults: Record<string, string[]>; conflicts: string[][] }>;
    /* 只写应用内键；截图/语音由各自通道写（先注册成功再落盘） */
    shortcutsSave(input?: { bindings?: Record<string, string[]> }): Promise<{ ok: boolean; error?: string; bindings?: Record<string, string[]>; conflicts?: string[][] }>;
    /* 恢复默认：删 shortcuts.json（截图/语音不动） */
    shortcutsReset(): Promise<{ ok: boolean; bindings: Record<string, string[]>; conflicts: string[][] }>;
    /* 读某会话的授权（默认全关） */
    dataaccessState(threadId: string): Promise<{ threadId: string; grants: Record<string, { read: boolean; write: boolean }> }>;
    /* 设一个三元组（会话+模块+读/写）；只在内存，退出即失效 */
    dataaccessGrant(input: { threadId: string; module: string; level: string; on: boolean }): Promise<{ threadId: string; grants: Record<string, { read: boolean; write: boolean }> }>;
    /* 撤销某会话的全部授权 */
    dataaccessRevokeAll(threadId: string): Promise<{ threadId: string; grants: Record<string, { read: boolean; write: boolean }> }>;
    /* 模型工具：读收藏夹（需 favorites/read） */
    dataaccessFavoritesList(input: { threadId: string; query?: string; limit?: number }): Promise<{ total: number; matched: number; items: { id: string; title: string; kind: string; content: string; tags: string[]; createdAt: string }[] }>;
    /* 模型工具：追加一条收藏（需 favorites/write；⛔ 不能改/删已有） */
    dataaccessFavoritesAppend(input: { threadId: string; title?: string; content: string; kind?: string; note?: string; tags?: string[] }): Promise<{ ok: boolean; id: string; title: string; total: number }>;
    /* 模型工具：读某天日记全文（需 journal/read） */
    dataaccessJournalRead(input: { threadId: string; date?: string }): Promise<{ date: string; content: string; truncated: boolean }>;
    /* 模型工具：全文检索日记（需 journal/read） */
    dataaccessJournalSearch(input: { threadId: string; query: string }): Promise<{ hits: { date: string; lines: string[] }[] }>;
    /* 模型工具：追加一条日记（需 journal/write；⛔ 只追加不改历史） */
    dataaccessJournalAppend(input: { threadId: string; date?: string; title?: string; body: string }): Promise<{ ok: boolean; date: string; days: number }>;
    /* 模型工具：密码本存在性查询（需 vault/read；⛔ 永不回明文） */
    dataaccessVaultFind(input: { threadId: string; query?: string }): Promise<{ total: number; items: { id: string; title: string; username: string; url: string; hasSecret: boolean }[] }>;
    /* 模型工具：把密码复制到剪贴板（需 vault/read；⛔ 返回体无明文） */
    dataaccessVaultCopy(input: { threadId: string; id: string }): Promise<{ ok: boolean; title?: string; note?: string; reason?: string }>;
    /* 模型工具：写入密码本（需 vault/write + 渲染层一次性确认） */
    dataaccessVaultSave(input: { threadId: string; item: Record<string, unknown> }): Promise<{ ok: boolean; total: number }>;
    /* 清内置浏览器（persist:harness-browser）的登录态/缓存；kind=all 连缓存一起清 */
    browserClearData(kind?: string): Promise<{ ok: boolean; partition: string; cleared: string }>;
    /* 为会话建专属工作区 <project>/.codex-harness/sessions/<threadId>（幂等） */
    sessionspaceEnsure(threadId: string, projectRoot: string): Promise<{ ok: boolean; dir?: string; reason?: string }>;
    /* 查某会话的工作区记录 */
    sessionspaceState(threadId: string): Promise<SessionWorkspaceRecord | null>;
    /* 列全部会话工作区记录 */
    sessionspaceList(): Promise<SessionWorkspaceRecord[]>;
    /* 改状态 active/archived（删除走 remove） */
    sessionspaceSetState(threadId: string, state: string): Promise<{ ok: boolean; record?: SessionWorkspaceRecord; reason?: string }>;
    /* 删会话工作区（目录+记录）；有安全闸，只删 sessions 下本进程算出的路径 */
    sessionspaceRemove(threadId: string): Promise<{ ok: boolean; removed: boolean; reason?: string }>;
    /* 收口孤儿：记录在目录不在 / orphan 重试 / 目录在记录不在（后者超 maxAgeDays 才删） */
    sessionspaceGc(options?: { maxAgeDays?: number; dryRun?: boolean }): Promise<{ recordsRemoved: number; dirsRemoved: number; orphanRetried: number; scanned: number }>;
    /* 10-29 飞书官方 CLI（@larksuite/cli）状态：是否安装 / 是否配置应用 / 是否已登录 */
    feishuCliStatus(): Promise<{ installed: boolean; path: string; version: string; configured: boolean; loggedIn: boolean; appId: string; user: string; detail: string; error: string }>;
    /* 10-30 Filee 文件转换（KnifeLemon/Filee，MIT）状态：是否安装 / 版本号（--version 缓存 60s）/ 开源声明（仓库与官网地址单一真相源在主进程，前端零字面量 —— 10-31 补审查修正） */
    fileeStatus(): Promise<{ installed: boolean; path: string; version: string; detail: string; attribution: { license: string; home: string; site: string } }>;
    /* 10-30 Filee 转换：spawn filee-cli.exe convert … --json（参数数组不进 shell）；exit 0=无失败 1=有文件失败（report.failed 给明细）2=参数错 3=无内容 */
    fileeConvert(input: { inputs: string[]; to: string; outputDir?: string; quality?: number; overwrite?: boolean; recursive?: boolean; keepDates?: boolean; timeoutMs?: number }): Promise<{ ok: boolean; code: number; report: { preset?: string; target?: string; converted?: number; skipped?: number; failed?: number; files?: { source?: string; state?: string; outputs?: string[]; error?: string }[] } | null; error: string; raw: string }>;
    /* 创建/绑定飞书应用：后台跑 lark-cli config init --new，返回授权链接 */
    feishuCliSetupStart(): Promise<{ ok: boolean; url?: string; error?: string }>;
    /* 用户登录 device flow：auth login --recommend --no-wait --json 拿链接，后台用 --device-code 完成 */
    feishuCliLoginStart(): Promise<{ ok: boolean; url?: string; deviceCode?: string; error?: string }>;
    feishuCliLogout(): Promise<{ ok: boolean; error: string }>;
    /* 取消本次授权：杀掉挂在后台的 config init / device-code 轮询进程 */
    feishuCliCancel(): Promise<{ ok: boolean }>;
    /* Codex 工具 feishu_cli 的执行端：参数数组直传 lark-cli（⛔ 不过 shell） */
    feishuCliRun(input: { args: string[]; cwd?: string }): Promise<{ ok: boolean; code: number; stdout: string; stderr: string; error?: string }>;
    /* 10-30 任务监控：按会话读每轮技能/MCP/插件/产物与自我改进建议（⛔ 只认传入的 threadId）；suggestion 是**建议文件的全文**（Codex 往里写，新的覆盖旧的） */
    readTaskMonitor(threadId?: string): Promise<{ threadId: string; turns: any[]; ongoingTurnId: string; suggestion: string; suggestionAt: number; suggestionPath: string }>;
    /* 10-30 任务监控：用户编辑后的自我改进建议落盘 */
    saveMonitorSuggestion(input: { threadId?: string; turnId?: string; text?: string }): Promise<{ ok: boolean; error?: string }>;
    /* 10-30 任务监控：重跑一次模型生成（复用一次性内部会话） */
    regenerateMonitorSuggestion(input: { threadId?: string; turnId?: string }): Promise<{ ok: boolean; error?: string }>;
    /* 10-30 任务监控：采纳一条自我改进建议 —— 落盘 adoptedAt，并往本会话投一条 [群事件]（与群聊同通道），由 Codex 自己沉淀成经验 */
    adoptMonitorSuggestion(input: { threadId?: string; turnId?: string; text?: string }): Promise<{ ok: boolean; delivered?: boolean; error?: string }>;
/* ═══ gen:end ═══ */


    /* 10-03 资源停用/启用（不删文件，可逆） */
    voiceResourceSetEnabled(input: { kind: string; enabled: boolean }): Promise<{ ok: boolean; error?: string; enabled?: boolean }>;

    /* 10-03 按资源删除（物理删文件，渲染层二次确认） */
    voiceResourceDelete(input: { kind: string }): Promise<{ ok: boolean; error?: string }>;

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

    /* 产物目录（09-29 用户要求「在 codexharness 目录下面新增一个存的目录，也可以选择和修改目录」）：默认 <userData>/outputs，首次读取自动创建；返回当前目录与「是否为默认」。 */
    dramaCanvasOutputDir(): Promise<{ dir: string; isDefault: boolean }>;

    /* 设置产物目录：pick=true 弹系统目录选择框；dir 给绝对路径直接设；dir 为空串 = 恢复默认。目录不可用会明确报错（不静默回退）。 */
    dramaCanvasOutputDirSet(input: { dir?: string; pick?: boolean }): Promise<{ dir: string; isDefault: boolean }>;

    /* 把二进制素材（配音 WAV / 生成图）按字节写进工作区 .drama-canvas/assets/；工作区掉出可信根（会话已关/重启）时回退应用数据目录并置 fallback=true（09-29 修「参考图传不了」）。⛔ 渲染层唯一的写入通道 fs:write 是 utf8 字符串写，写不了二进制，WAV 必须走这里 */
    dramaCanvasAssetWrite(input: { workspace: string; name: string; base64: string; subdir?: string }): Promise<{ path: string; fallback?: boolean }>;

    /* 内置视频生成接口：国内外 8 家厂商清单 + 是否已配凭证（可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo） */
    videoProviders(): Promise<{id:string;name:string;region:string;modes:string[];imageInput:string;fields:string[];models:string[];defaultModel:string;configured:boolean}[]>;

    /* 保存某厂商的 API 凭证 */
    videoConfigSave(input: { providerId: string; values: Record<string,string> }): Promise<{ ok: boolean; configured: boolean }>;

    /* 轮询任务状态（MiniMax 成功后自动两段式换下载地址） */
    videoPoll(input: { providerId: string; jobId: string }): Promise<{ status: string; url?: string; error?: string }>;

    /* 把产物视频拉回本地落 <workspace>/.drama-canvas/assets/（可信根校验） */
    videoDownload(input: { url: string; workspace: string; name: string; subdir?: string; outputDir?: string }): Promise<{ path: string; bytes: number }>;

    /* 排队消息定时发送：主进程登记定时器（不受渲染层隐藏节流），到点广播 queue-timer:due */
    queueTimerSet(input: { threadId: string; queuedSubmissionId: string; runAt: number }): Promise<{ ok: boolean; scheduled: boolean }>;

    /* 按顺序合并视频片段成一条成片（整片导出）：先 -c copy，失败回落统一重编码；输出 <workspace>/.drama-canvas/export/ */
    videoConcat(input: { workspace: string; name: string; files: string[]; width?: number; height?: number; fps?: number }): Promise<{ path: string; bytes: number; mode: "copy" | "reencode"; parts: number }>;

    /* 10-04 阶段 6 宿主域清单（启用/停用状态 + 是否 essential） */
    domainsList(): Promise<{ domains: Array<{ id: string; mounted: boolean; disabled: boolean; essential: boolean }>; essentialDomains: string[]; requiresRestart: boolean }>;

    /* 10-04 阶段 6 停用/启用宿主域（下次启动生效，essential 域拒绝） */
    domainsSetEnabled(input: { id: string; enabled: boolean }): Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>;

    /* 10-04 「重启才生效」的话术由主进程出，禁在前端硬编码 */
    domainsReloadHint(): Promise<{ requiresRestart: boolean; text: string }>;

    /* 10-04 启停声明式插件（插槽即时生效，无需重启） */
    declaredPluginsToggle(input: { id: string; enabled: boolean }): Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>;

    /* 10-04 打开用户插件目录（不存在则创建） */
    declaredPluginsOpenDirs(): Promise<{ ok: boolean; error?: string; userDir?: string; builtinDir?: string }>;

    /* 10-09 轮询板块：读「间隔 / 超时上限 / 失败重试次数」（真相源在 userData/poll-settings.json） */
    pollConfigRead(): Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>;

    /* 10-09 保存轮询配置（会先过钳制：超时≥间隔×2）—— 返回**钳制后**的真值，渲染层照它回显 */
    pollConfigSave(input: { intervalMs?: number; timeoutMs?: number; maxRetry?: number }): Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>;

    /* 10-09 用户在界面上按「中止」→ 主进程的 wait 循环停下（任务本身不会被撤销） */
    pollAbort(input: { taskId: string }): Promise<{ ok: boolean; aborted: boolean }>;

/* ═══ gen:end ═══ */

    /** 桌面宠物状态推送（主进程归约九态 → 浮窗；浮窗首帧另用 petState() 补水） */
    onPetSignal(listener: (signal: PetSignal) => void): () => void;


    /** 桌面宠物配置推送（当前宠物包 + 设置）：换宠物 / 改缩放时用它让已开着的浮窗立刻跟上 */
    onPetConfig(listener: (config: PetStatus) => void): () => void;
    onPetHover(listener: (inside: boolean) => void): () => void;


    onQueueTimerDue(listener: (event: { threadId: string; queuedSubmissionId: string }) => void): () => void;


    onRemotePairRequest(handler: (request: { rid: string; deviceId: string; name: string }) => void): () => void;


    onBotPairRequest(handler: (request: { rid: string; channel: string; chatId: string; name: string }) => void): () => void;
    /* 关闭确认弹窗（10-13）：主进程拦截 X 后推「要不要关」，渲染层画应用内卡片并回包 */
    onCloseConfirmAsk(handler: (payload: { busy: number; appName: string }) => void): () => void;

    /* 10-16 主题变更广播：主进程 theme:apply 后推给所有窗口 ——
       独立会话弹窗的界面主题实时跟随主界面（preload 手写桥，不在 manifest 清单） */
    onThemeChanged(listener: (theme: string) => void): () => void;
















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



    onRuntimeProgress(listener: (event: { id: string; message?: string; percent?: number; stage?: string; speed?: string; done?: boolean; failed?: boolean; auto?: boolean; /** 已取消（10-07）：主进程杀完子进程清完临时文件后推来的收尾事件，≠ failed */ cancelled?: boolean }) => void): () => void;

    /** 记忆后端 / 云端开通状态变化推送（10-20）：手写桥（非 gen 段）。主进程在变化点广播，
     *  界面订阅后重新读一次状态：切后端、确认开通、登录 / 登出 / 换账号。 */
    onMemoryBackendChanged(listener: (status: { backend: "builtin" | "mcp" | "cloud"; effective: "builtin" | "mcp" | "cloud"; installed: boolean; serverPath: string; installRoot: string; installCommand: string; fallbackReason: string | null; cloudActivation: { state: "active" | "inactive" | "unknown"; reason: string; entitled: boolean; applied: boolean; checkedAt: number; reasonText: string } }) => void): () => void;

    /** 播报归属推送（voice 域，10-21）：多窗口时逐窗口定制发送 —— `owner` 已是「本窗口是不是播报窗口」。 */
    onAnnounceOwnerChanged(listener: (state: { owner: boolean; reason: string }) => void): () => void;

    /** 全局静音闩锁推送（10-21）：任一窗口按停 ⇒ 全窗口静默（一个扬声器一个用户）。 */
    onAnnounceMuted(listener: (state: { muted: boolean }) => void): () => void;

    /** 通话状态推送（10-21，所有窗口）：弹窗据此避让主窗口的通话 TTS（`voice:event` 只发主窗口）。 */
    onVoiceCallState(listener: (state: { state: string; active: boolean }) => void): () => void;


    /** 3D 预览弹窗打开推送（model-viewer 域，10-05）：手写桥（非 gen 段），引擎 preview_3d 触发 */
    onModelViewerOpen(listener: (event: { path: string; title: string }) => void): () => void;


    /** 壁纸应用推送（wallpaper 域，10-06）：手写桥，引擎 wallpaper_set 触发 */
    onWallpaperApply(listener: (event: { mode: string; pattern: string; opacity: number; image: string }) => void): () => void;


    /** 图像工坊浮层推送（image-lab 域，10-09）：手写桥（非 gen 段），单通道三态
     *  open（弹出）/ update（换状态与图）/ close（收起）。引擎 image_generate / image_edit / image_view 触发。 */
    onImageLabEvent(listener: (event: { phase: "open" | "update" | "close"; taskId: string; mode?: "generate" | "edit"; title?: string; status?: "running" | "done" | "error"; images?: string[]; note?: string }) => void): () => void;


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


    /**
     * 订阅「更新包已就绪」（10-12 后台静默下载完成）。
     * ⛔ 与设置页无关 —— 用户可能压根没打开设置页，只能靠事件弹窗。
     */
    updateOnReady(callback: (info: { version?: string; path?: string }) => void): () => void;
  };
}

/** 构建期注入的构建指纹（`YYYYMMDD-HHmm`，见 vite.config.ts 的 define）。
 *  用途：界面自证「正在运行的是哪一份产物」——运行时读 dist/ 只能说明磁盘上有什么。 */
declare const __BUILD_STAMP__: string;
