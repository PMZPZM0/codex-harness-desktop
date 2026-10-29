import { contextBridge, ipcRenderer } from "electron";

/* ═══ IPC 强化层（09-24）══════════════════════════════════════════════════════
 * 所有 gen:begin 区生成的 invoke 都走 __ipc，获得三件事：
 *   ① 参数个数前置校验（minArgs 由生成器从 manifest.paramsImpl 算出，缺参在渲染层早失败，
 *      不再打到主进程报一句含糊的 "Error invoking remote method"）；
 *   ② 错误归一化：Electron 包装的错误文本被解析成结构化 code（见 normalizeIpcError），
 *      调用方 catch 到的 error 带 .code / .channel，可编程分支而不是字符串匹配；
 *   ③ 通道级超时表 IPC_TIMEOUT_MS（默认空 = 永不超时，**零行为变化**）—— 需要超时的
 *      通道在这里加一行 `"channel": ms` 即可；不默认加是因为部分 invoke 等用户交互
 *      （对话框 / 审批），盲目全局超时会打断它们。
 * ⛔ __on：事件订阅的幂等封装 —— 同一 (通道, 监听函数引用) 重复注册只生效一次、
 *    退订精确移除（替代 removeAllListeners 的"误伤别人"做法）。 */

/** 通道 → 超时毫秒。默认空：所有 invoke 不设超时（与历史行为一致）。 */
const IPC_TIMEOUT_MS: Record<string, number> = {};

/** Electron invoke 报错文本 → 结构化错误码。 */
function normalizeIpcError(error: unknown, channel: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  let code = "ERR_INVOKE_FAILED";
  if (/No handler registered/i.test(message)) code = "ERR_NO_HANDLER";
  else if (/An object could not be cloned/i.test(message)) code = "ERR_UNCLONABLE";
  else if (/Error processing argument at index/i.test(message)) code = "ERR_BAD_ARGS";
  else if (/\bETIMEDOUT\b|timed? ?out/i.test(message)) code = "ERR_TIMEOUT";
  const wrapped = new Error(`[${code}] ${channel}: ${message}`);
  (wrapped as Error & { code?: string; channel?: string; cause?: unknown }).code = code;
  (wrapped as Error & { code?: string; channel?: string; cause?: unknown }).channel = channel;
  (wrapped as Error & { code?: string; channel?: string; cause?: unknown }).cause = error;
  return wrapped;
}

function __ipc(channel: string, minArgs: number, args: unknown[]): Promise<unknown> {
  /* TS 编译挡不住 JS 层调用：`f()` 会把缺的参数记成 undefined 占位而非"没传"。
     尾部的 undefined 一律视为缺参（与"显式传 undefined"语义等价 —— 主进程侧两者都拿不到值）。 */
  const trimmed = [...args];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === undefined) trimmed.pop();
  if (trimmed.length < minArgs) {
    const err = new Error(`[ERR_MISSING_ARGS] ${channel}: 需要 ${minArgs} 个参数，实得 ${trimmed.length} 个`);
    (err as Error & { code?: string; channel?: string }).code = "ERR_MISSING_ARGS";
    (err as Error & { code?: string; channel?: string }).channel = channel;
    return Promise.reject(err);
  }
  const timeoutMs = IPC_TIMEOUT_MS[channel] ?? 0;
  const invokePromise = ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    throw normalizeIpcError(error, channel);
  });
  if (!timeoutMs) return invokePromise;
  return Promise.race([
    invokePromise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`[ERR_TIMEOUT] ${channel}: ${timeoutMs}ms 无响应`);
        (err as Error & { code?: string; channel?: string }).code = "ERR_TIMEOUT";
        (err as Error & { code?: string; channel?: string }).channel = channel;
        reject(err);
      }, timeoutMs);
      // 谁先落定都清掉定时器，避免句柄挂着（finally 无论 resolve/reject 都会跑）
      invokePromise.finally(() => clearTimeout(timer));
    }),
  ]);
}

/** 事件订阅注册表：通道 → (监听函数引用 → 退订)。同引用重复注册幂等，退订精确。 */
const __subs = new Map<string, Map<unknown, () => void>>();

function __on<T>(channel: string, listener: T, adapt: (listener: T) => (...args: never[]) => void): () => void {
  let perChannel = __subs.get(channel);
  if (!perChannel) { perChannel = new Map(); __subs.set(channel, perChannel); }
  const existing = perChannel.get(listener);
  if (existing) return existing;
  const handler = adapt(listener) as (...args: unknown[]) => void;
  ipcRenderer.on(channel, handler as never);
  const off = () => {
    ipcRenderer.removeListener(channel, handler as never);
    perChannel!.delete(listener);
  };
  perChannel.set(listener, off);
  return off;
}

contextBridge.exposeInMainWorld("codex", {
  /* ═══ gen:begin（由 scripts/gen-ipc-bridge.mjs 生成，源 ipc-channels.manifest.json，勿手改）═══ */
  archiveDelegates: (input: unknown) => __ipc("agents:archive", 1, [input]),
  listDispatchCatalog: () => __ipc("agents:catalog", 0, []),
  listDelegates: () => __ipc("agents:delegated", 0, []),
  listDelegatesOf: (originThreadId: string) => __ipc("agents:delegated-of", 1, [originThreadId]),
  /* 10-05 能力网关：把引擎 0.157 后对模型不可见的内置 MCP 工具面接回来（name=工具名，name="list" 取清单）；10-09 起图像四件套已搬去 image-lab 域自己的通道，本网关只剩其余 25 个能力 */
  callDispatchTool: (input: unknown) => __ipc("agents:dispatch-call", 1, [input]),
  invokeAgent: (input: unknown) => __ipc("agents:invoke", 1, [input]),
  /* 10-29 收敛：总开关删除后只剩「逐类许可变化」一种事件 —— 传 before/next 三类许可，主进程按差集生成**一条**按类分段的通知（新开启的类附对象名单）；未开启的类显式否定 */
  dispatchNotice: (before?: { expert?: boolean; team?: boolean; subagent?: boolean }, next?: { expert?: boolean; team?: boolean; subagent?: boolean }) => __ipc("agents:notice", 0, [before, next]),
  threadRole: (threadId: string) => __ipc("agents:thread-role", 1, [threadId]),
  dispatchToolDescription: (threadId: string) => __ipc("agents:tool-description", 1, [threadId]),
  /* 取消尚未确认的开启流程（不落盘） */
  appLockCancel: (setupId: string) => __ipc("app-lock:cancel", 1, [setupId]),
  /* 关闭应用锁需当前密码；错误同样计数 */
  appLockDisable: (password: string) => __ipc("app-lock:disable", 1, [password]),
  /* 用户确认已备份密码后提交开启 */
  appLockEnable: (setupId: string) => __ipc("app-lock:enable", 1, [setupId]),
  /* 生成一次性密码（随机或自定义）：确认 enable 前不落盘，明文只在这次返回 */
  appLockPrepare: (input: { mode?: string; password?: string }) => __ipc("app-lock:prepare", 1, [input]),
  /* 应用锁状态（不含密码/哈希）；resetRequired=true 时主进程会写重置标记并重启 */
  appLockStatus: () => __ipc("app-lock:status", 0, []),
  /* 锁屏验证；错误次数落盘，第 10 次返回 reset=true */
  appLockVerify: (password: string) => __ipc("app-lock:verify", 1, [password]),
  /* 10-25：在软件所在盘根新建指挥中枢专属项目目录，返回绝对路径 */
  createBossProjectDir: () => __ipc("app:boss-project-dir", 0, []),
  doctor: (cwd?: string) => __ipc("app:doctor", 0, [{ cwd }]),
  engineInfo: () => __ipc("app:engine-info", 0, []),
  homeDir: () => __ipc("app:home-dir", 0, []) as Promise<string>,
  perfCounters: () => __ipc("app:perf-counters", 0, []),
  relaunchApp: () => __ipc("app:relaunch", 0, []),
  /* 缓存清理：仅支持安全目标（引擎日志 / 本地图片缓存），绝不删会话历史 */
  storageClear: (target: "engine-log" | "images") => __ipc("app:storage-clear", 1, [target]),
  storageInfo: () => __ipc("app:storage-info", 0, []),
  getUserData: () => __ipc("app:userData", 0, []),
  /* 应用级运行时开关（联网搜索等） */
  readAppSettings: () => __ipc("appSettings:read", 0, []),
  saveAppSettings: (patch: { webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; autoCompactRatio?: number; engineProxyUrl?: string; hardwareAcceleration?: "auto" | "force" | "off"; adaptiveTone?: boolean; downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy"; skillAutoUpdate?: boolean; pluginAutoUpdate?: boolean; modelCatalogRepairNotice?: string; functionMenu?: { location?: "top" | "bottom"; order?: string[]; overflow?: string[] }; sidebarOptionsCollapsed?: boolean }) => __ipc("appSettings:save", 1, [patch]),
  /* 10-13 统一更新体系：按行 id 更新指定组件。幂等（内容一致 ⇒ unchanged，不重装）；有目标目录的一律先快照、失败自动回滚（electron/update-safety.ts）。更新源一律国内镜像：npm→npmmirror、pip→清华、GitHub→gh-mirror 通道 */
  runAutoUpdateComponent: (id: string) => __ipc("autoUpdate:run", 1, [id]),
  /* 10-13 统一更新体系：一键更新全部组件（手动入口，不按开关过滤 —— 用户点了就是授权）。逐项返回结��，单项失败不影响其余 */
  runAllAutoUpdateComponents: () => __ipc("autoUpdate:run-all", 0, []),
  /* 10-13 统一更新体系：全量组件清单与版本状态（工具 / 引擎 / 技能 / 插件 / ponytail / 钩子等）。清单单一真相源在 electron/update-registry.ts（含「不支持更新」的条目及其原因）；动态类目（市场技能/插件/专家包/人格包）按已装实例展开成多行。传 id 可只扫某一類 */
  scanAutoUpdateComponents: (id?: string) => __ipc("autoUpdate:scan", 0, [id]),
  /* 10-13 新增：单独开关某一类自动更新（四个开关互相独立，patch 只写对应那一个 AppSettings 字段）；缺省值判据统一走 autoUpdateEnabled（!== false ⇒ 默认开） */
  setAutoUpdate: (id: string, enabled: boolean) => __ipc("autoUpdate:set", 2, [id, enabled]),
  /* 10-13 新增：主要组件的自动更新开关与版本号（技能 / 桌面 / 浏览器 / Mac 电脑操作 / 引擎）。⛔ 版本数据与 autoUpdate:scan 同源（都走 scanRows），两个端点不可能给出矛盾的结论 */
  readAutoUpdateStatus: () => __ipc("autoUpdate:status", 0, []),
  setAwake: (on: boolean) => __ipc("awake:set", 1, [on]),
  /* 清空备份（⚠ 不可恢复，渲染层须先确认） */
  backupClear: () => __ipc("backup:clear", 0, []),
  /* 读改动备份配置（enabled/目录/是否被回退/目录是否存在） */
  backupConfigGet: () => __ipc("backup:config-get", 0, []),
  /* 写改动备份配置；启用时才创建目录 */
  backupConfigSet: (input: { enabled?: boolean; dir?: string }) => __ipc("backup:config-set", 1, [input]),
  /* 读某会话的备份索引（回合级） */
  backupList: (conversationId?: string) => __ipc("backup:list", 0, [conversationId]),
  /* agent 工具：列出全部会话的备份概览（会话id/条数/最新最旧/总字节）+ 容量上限 */
  backupListAll: () => __ipc("backup:list-all", 0, []),
  /* agent 工具：手动触发容量裁剪（超上限把最旧的移进回收站，不硬删） */
  backupPrune: (input: { maxBytes?: number }) => __ipc("backup:prune", 1, [input]),
  /* agent 工具：读某条备份全文（索引 + 明细 hunks），用来回答「当时到底改了什么」 */
  backupReadChange: (input: { conversationId?: string; requestId?: string }) => __ipc("backup:read-change", 1, [input]),
  /* agent 工具：把某文件回滚到备份那一版；⛔ 明细只存 hunks 时回 needs_full_content（如实说，不假装成功）；目标须在工作区内 */
  backupRestoreFile: (input: { conversationId?: string; requestId?: string; filePath?: string; workspace?: string }) => __ipc("backup:restore-file", 1, [input]),
  /* 备份产物概览（会话数/条数/字节数） */
  backupSummary: () => __ipc("backup:summary", 0, []),
  /* 创世 boss：加任务并派活（异步，turn/start 立刻返回；结果靠后台回调） */
  assignBossTask: (input: any) => __ipc("boss-groups:assign", 1, [input]),
  /* 创世 boss：成员浏览器能力（ego lite 是否可用；每人独立 TaskSpace） */
  bossBrowserStatus: () => __ipc("boss-groups:browser", 0, []),
  /* 创世 boss：建群 + 声明成员岗位（成员会话在建会话那刻定工具面） */
  createBossGroup: (input: any) => __ipc("boss-groups:create", 1, [input]),
  /* 删群（先往中枢回投 [群事件] 再清群/任务/事件账本；会话与产出文件保留） */
  deleteBossGroup: (input: any) => __ipc("boss-groups:delete", 1, [input]),
  /* 创世 boss：用户三选一（换模型重做 / 放宽标准 / 自己接手） */
  escalateBossTask: (input: any) => __ipc("boss-groups:escalate", 1, [input]),
  /* 创世 boss：所有群（看板列表） */
  listBossGroups: () => __ipc("boss-groups:list", 0, []),
  /* 创世 boss：拉人/移人（移人不删会话、不打断在跑任务） */
  bossGroupMember: (input: any) => __ipc("boss-groups:member", 1, [input]),
  /* 清空某个 BOSS 会话的专属记忆目录（⛔ 只清记忆，不删会话） */
  clearBossMemory: (input: any) => __ipc("boss-groups:memory", 1, [input]),
  /* 创世 boss：置顶/取消置顶群事件（群视图卡带，最多 3 条） */
  bossGroupPin: (input: any) => __ipc("boss-groups:pin", 1, [input]),
  /* 创世 boss：可拉名单（专家/专家团 + 本机 CLI agent，带探测结果） */
  bossGroupPool: () => __ipc("boss-groups:pool", 0, []),
  /* 10-25：把群账本的 bossThreadId 重绑到重建后的会话（rollout 丢失自愈） */
  bossGroupRebind: (input: any) => __ipc("boss-groups:rebind", 1, [input]),
  /* 创世 boss：人工给审查结论（打回必须带理由，空理由会被拒） */
  reviewBossTask: (input: any) => __ipc("boss-groups:review", 1, [input]),
  /* 创世 boss：你在群对话框里说话 → boss 线程（回复镜像回群流） */
  bossGroupSay: (input: any) => __ipc("boss-groups:say", 1, [input]),
  /* BOSS 会话身份登记（add/remove/rename/list）—— 记忆路由的唯一真相源 */
  bossGroupSession: (input: any) => __ipc("boss-groups:session", 1, [input]),
  /* 创世 boss：某群的账本快照（成员/任务/事件/打回） */
  bossGroupStatus: (groupId: string) => __ipc("boss-groups:status", 1, [groupId]),
  botBindingGet: () => __ipc("bot-binding:get", 0, []),
  botBindingSet: (input: { channel: string; threadId: string | null; title?: string }) => __ipc("bot-binding:set", 1, [input]),
  botStreamGet: () => __ipc("bot-stream:get", 0, []),
  botStreamSet: (input: { enabled: boolean; thinking: boolean; tools: boolean }) => __ipc("bot-stream:set", 1, [input]),
  botApprove: (rid: string) => __ipc("bot:approve", 1, [rid]),
  botBindConsume: (code: string) => __ipc("bot:bind-consume", 1, [code]),
  botBindQrcode: (botId: string, botName: string) => __ipc("bot:bind-qrcode", 2, [botId, botName]),
  botBindStatus: (code: string) => __ipc("bot:bind-status", 1, [code]),
  botDeny: (rid: string) => __ipc("bot:deny", 1, [rid]),
  botPairState: () => __ipc("bot:pair-state", 0, []),
  botRevoke: (key: string) => __ipc("bot:revoke", 1, [key]),
  botsGet: () => __ipc("bots:get", 0, []) as Promise<any[]>,
  botsSet: (list: any[]) => __ipc("bots:set", 1, [list]),
  bridgeStatus: () => __ipc("bridge:status", 0, []),
  /* 归档会话时回收 codex-<threadId> TaskSpace；不传 threadId 则清全部 codex-* */
  egoCleanup: (threadId?: string) => __ipc("browser:ego-cleanup", 0, [threadId]),
  /* 打开 ego lite 官方下载页（不静默安装系统软件） */
  egoInstall: () => __ipc("browser:ego-install", 0, []),
  /* 打开 ego lite GUI；找不到启动器时回落官方下载页 */
  egoOpen: () => __ipc("browser:ego-open", 0, []),
  /* ego lite 安装态：CLI 路径/版本/双平台下载页；不内置浏览器本体 */
  egoStatus: () => __ipc("browser:ego-status", 0, []),
  /* 手动升级：运行官方 ego-browser upgrade（可能下载数百 MB） */
  egoUpgrade: () => __ipc("browser:ego-upgrade", 0, []),
  browserPopout: (url: string) => __ipc("browser:popout", 1, [url]),
  describeImage: (input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) => __ipc("builtin:describe-image", 1, [input]),
  /* ⛔ `path` 是落盘后的本地路径（网关只回 b64_json 时也有值）；`url` **仅在网关给了 * 真托管地址时**才有值 —— data URL 绝不会回传（会把 3 MB base64 带进对话历史）。 */
  generateImage: (input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }) => __ipc("builtin:generate-image", 1, [input]),
  probeBuiltinModels: (input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) => __ipc("builtin:probe", 1, [input]),
  readBuiltinPlugins: () => __ipc("builtin:read", 0, []),
  saveBuiltinPlugins: (cfg: unknown) => __ipc("builtin:save", 1, [cfg]),
  capabilitiesSnapshot: () => __ipc("capabilities:snapshot", 0, []),
  getChannelBot: () => __ipc("channel-bot:read", 0, []),
  saveChannelBot: (config: unknown) => __ipc("channel-bot:save", 1, [config]),
  testChannelBot: (config: unknown) => __ipc("channel-bot:test", 1, [config]),
  channelsStatus: () => __ipc("channels:status", 0, []),
  readClipboardImage: () => __ipc("clipboard:image", 0, []),
  readClipboardFiles: () => __ipc("clipboard:read-files", 0, []),
  writeClipboard: (text: string) => __ipc("clipboard:write", 1, [text]),
  writeClipboardImage: (filePath: string) => __ipc("clipboard:write-image", 1, [filePath]),
  /* 10-29 CLI 智能体板块：分类表跟着列表下发（渲染层不复制第二份分类字面量） */
  listCliAgents: () => __ipc("cliagents:list", 0, []),
  /* 只在用户点「检测」时调：有子进程（where/which + --version） */
  detectCliAgent: (input?: { id?: string; bin?: string }) => __ipc("cliagents:detect", 0, [input]),
  /* 新增/更新；内置项不可删只能关停 */
  saveCliAgent: (input?: { id?: string; name?: string; category?: string; bin?: string; installCmd?: string; docs?: string; description?: string; promptHint?: string; enabled?: boolean }) => __ipc("cliagents:save", 0, [input]),
  removeCliAgent: (id: string) => __ipc("cliagents:remove", 1, [id]),
  /* 10-13 关闭确认弹窗的回包：tray=隐藏主窗口 / quit=置 closeConfirmed 后二次 close / cancel=不动。remember=true 写 closeToTray（动作）+ closePromptSeen（不再弹）。⛔ ask 方向是推送类手写桥（preload onCloseConfirmAsk），不在本清单 */
  respondCloseConfirm: (action: "tray" | "quit" | "cancel", remember: boolean) => __ipc("close-confirm:respond", 2, [action, remember]),
  /* 云账号登录（10-16）：账号密码换云端 Bearer 会话令牌，safeStorage 加密后落 userData/cloud/auth.json。⛔ 不是配对流程 —— 服务端 accountWho() 同时认会话令牌与设备令牌 */
  cloudAuthLogin: (input: { baseUrl?: string; username?: string; password?: string }) => __ipc("cloud-auth:login", 1, [input]),
  /* 退出云账号（缺省 = 当前生效那个）。⛔ 最后一个账号被删时才收摊（停用云供应商行与两个 MCP 连接器，都只停用不删除） */
  cloudAuthLogout: (id?: string) => __ipc("cloud-auth:logout", 0, [id]),
  /* 云账号积分（服务端 /points/me）：余额 + 最近 30 条变动明细。⛔ 账户级数据，故挂在 cloud-auth 域而不是另开板块 */
  cloudAuthPoints: () => __ipc("cloud-auth:points", 0, []),
  /* 云账号登录态（⛔ 只回账号与「有没有」，不回任何令牌） */
  cloudAuthStatus: () => __ipc("cloud-auth:status", 0, []),
  /* 切换生效云账号（多账号并存时用） */
  cloudAuthSwitch: (id: string) => __ipc("cloud-auth:switch", 1, [id]),
  /* 云端知识库连接器状态（只读本地，不联网） */
  cloudKbStatus: () => __ipc("cloud-kb:status", 0, []),
  /* 把云端知识库接成 MCP 连接器 cloud-kb（streamable_http + 令牌走环境变量，⛔ 不落 config.toml）。未开通权益时只停用连接器并回报原因 */
  cloudKbSync: () => __ipc("cloud-kb:sync", 0, []),
  /* 云端记忆状态（只读本地，不联网） */
  cloudMemoryStatus: () => __ipc("cloud-memory:status", 0, []),
  /* 取云端记忆凭据（加密缓存）。⛔ 记忆中枢当前**没有 MCP 端点**（实测 /mcp、/v1/mcp、/sse 全 404），故 mode 恒为 rest-only 且不建连接器 —— 等本地 stdio 适配器 */
  cloudMemorySync: () => __ipc("cloud-memory:sync", 0, []),
  /* 把「云端模型」设为当前生效供应商（用户显式点击）。⛔ 自动同步绝不抢生效位，只有这条会；切换会重启引擎以让新 Key/地址生效 */
  cloudModelsActivate: () => __ipc("cloud-models:activate", 0, []),
  /* 云端模型目录（服务端 /models 原样透传）：含逐模型勾选状态 enabled 与积分倍率 credits（creditsLocked=管理员已钉住、upstreamCredits=上游原值），以及闲时倍率快照 offPeak（时段按服务端本地时间，tzOffsetMinutes 供客户端换算）。⛔ 不返回任何密钥与上游地址 */
  cloudModelsCatalog: () => __ipc("cloud-models:catalog", 0, []),
  /* 勾选云端模型（写**服务端** /models/enabled，权威在云端）→ 写完后立刻同步到本机下拉框。勾选语义：勾上 = 下拉框可见 */
  cloudModelsSetEnabled: (input: { ids: string[] }) => __ipc("cloud-models:set-enabled", 1, [input]),
  /* 本机云供应商状态（只读本地，不联网）：是否已注册 / 模型数 / 是否已有 Key / 上次同步时间 */
  cloudModelsStatus: () => __ipc("cloud-models:status", 0, []),
  /* 把云端目录同步成本机供应商行（登录成功后 / 手动刷新 / 定时轮询都调它）。⛔ 同时写复数列表与单数生效档案（10-16「勾 5 个下拉 15 个」事故的防线）；force=true 会重签代理令牌 */
  cloudModelsSync: (input?: { force?: boolean }) => __ipc("cloud-models:sync", 0, [input]),
  /* 云端模型连通测试（10-19）：探**引擎实际会用的那条路**（本地桥 + 云供应商行合成后的 baseUrl/key，记忆开启时即 memapi + 记忆 userKey）。401/403 自动重签一次并重探；forceHeal=true = 界面「重签密钥并重试」。成功由界面提示保存并重启应用 */
  cloudModelsTest: (input?: { forceHeal?: boolean }) => __ipc("cloud-models:test", 0, [input]),
  /* 取云代理令牌（/proxy/token，明文**仅此一次**）。⛔ 供「Key 掉了」的修复入口用；落盘一律加密 */
  cloudModelsToken: (input?: { force?: boolean }) => __ipc("cloud-models:token", 0, [input]),
  /* 云版预留：同步冲突解决（resolution = local|cloud|merge；未开通前为预留桩） */
  cloudSyncConflictResolve: (key: string, resolution: string) => __ipc("cloud:sync/conflict/resolve", 2, [key, resolution]),
  /* 10-18：列出本地会话供勾选上传（只读，不写游标） */
  cloudSyncList: () => __ipc("cloud:sync/list", 0, []),
  /* 云版预留：按 key 从云端拉回数据（未开通前为预留桩） */
  cloudSyncPull: (input?: { keys: string[] }) => __ipc("cloud:sync/pull", 0, [input]),
  /* 云版预留：把指定本地路径推到云端（云端存储未开通时返回预留桩形状 {ok:false,reserved:true,code}） */
  cloudSyncPush: (input?: { paths: string[] }) => __ipc("cloud:sync/push", 0, [input]),
  /* 云版预留（10-11）：云端存储开通状态（enabled=false = 未开通，配额/最近同步时间一并给出） */
  cloudSyncStatus: () => __ipc("cloud:sync/status", 0, []),
  /* 官方源的 10 个分类（含每类数量）。⛔ 与 Gitee 镜像源的分类各算各的，tab 按源切换 */
  listOfficialMarketCategories: () => __ipc("codex-official-market:categories", 0, []),
  /* 镜像下载 plugins/<slug> 子树 → 写本地市场目录 → 注册 [marketplaces.codex-official-market] → 引擎 plugin/install + 重启 → plugin/list 确认；进度走 harness:event 的 official-plugin-install（⛔ 不与 plugin-install 共用 type，上游 slug 有重名） */
  installOfficialMarketPlugin: (plugin: unknown) => __ipc("codex-official-market:install", 1, [plugin]),
  /* 本地已装官方插件（**只扫本地目录、零网络**）：补齐「引擎没认领、但文件已落盘」的那批，不能走 list（那条要拉上游 65 条） */
  listInstalledOfficialMarketPlugins: () => __ipc("codex-official-market:installed", 0, []),
  /* 10-03：Codex 官方插件市场（GitHub openai/plugins，gh-proxy 镜像优先）。installedDir 由主进程注入 —— 「装没装」的真相源是本地 marker；live=false 表示上游没连通、这次读的是内置快照 */
  listOfficialMarketPlugins: (input: unknown = {}) => __ipc("codex-official-market:list", 0, [input]),
  /* 先请引擎 plugin/uninstall（认领时才生效），再删落盘目录 + 摘本地 marketplace 清单；删除目标经 safeFolder 归一 + 目录内校验 */
  uninstallOfficialMarketPlugin: (slug: unknown) => __ipc("codex-official-market:uninstall", 1, [slug]),
  /* 10-12 新增：按 slug 取官方市场最新对象、重跑**同一条安装链**覆盖更新（含引擎注册与重启）。已下架时明确报错 */
  updateOfficialPlugin: (slug: string) => __ipc("codex-official-market:update", 1, [slug]),
  /* 10-12 新增：Codex 官方插件市场（GitHub openai/plugins 国内镜像）的更新检查。与 plugins 域同构：**有版本号** ⇒ 真版本比对；只读零副作用；版本缺失标 comparable:false */
  checkOfficialPluginUpdates: () => __ipc("codex-official-market:update-check", 0, []),
  request: (method: string, params: unknown = {}) => __ipc("codex:request", 1, [method, params]),
  respond: (id: string | number, result: unknown) => __ipc("codex:respond", 2, [id, result]),
  /* 上报当前正在查看的会话：主进程据此只转发该会话的高频事件（多会话性能） */
  setActiveThread: (threadId: string | null) => __ipc("codex:set-active-thread", 1, [threadId]) as Promise<{ ok: boolean }>,
  deleteCommand: (filePath: string) => __ipc("commands:delete", 1, [filePath]),
  expandCommand: (input: { filePath: string; argument?: string; cwd?: string }) => __ipc("commands:expand", 1, [input]),
  listCommands: (input: { cwd?: string } = {}) => __ipc("commands:list", 0, [input]),
  readCommand: (filePath: string) => __ipc("commands:read", 1, [filePath]),
  saveCommand: (input: unknown) => __ipc("commands:save", 1, [input]),
  listConnectors: () => __ipc("connectors:list", 0, []),
  cancelConnectorOAuth: (templateId: string) => __ipc("connectors:oauth-cancel", 1, [templateId]),
  startConnectorOAuth: (input: unknown) => __ipc("connectors:oauth-start", 1, [input]),
  removeConnector: (id: string) => __ipc("connectors:remove", 1, [id]),
  saveConnector: (input: unknown) => __ipc("connectors:save", 1, [input]),
  setConnectorsEnabled: (ids: string[], enabled: boolean) => __ipc("connectors:set-enabled", 1, [{ ids, enabled }]),
  listConnectorTemplates: () => __ipc("connectors:templates", 0, []),
  applyCustomModel: () => __ipc("custom-model:apply", 0, []),
  listCustomModels: () => __ipc("custom-model:list", 0, []),
  probeCustomModel: (config: unknown) => __ipc("custom-model:probe", 1, [config]),
  getCustomModel: () => __ipc("custom-model:read", 0, []),
  removeCustomModel: (providerId: string) => __ipc("custom-model:remove", 1, [providerId]),
  removeProviderModel: (input: { provider: string; modelId: string }) => __ipc("custom-model:remove-model", 1, [input]),
  saveCustomModel: (config: unknown) => __ipc("custom-model:save", 1, [config]),
  selectCustomModel: (providerId: string) => __ipc("custom-model:select", 1, [providerId]),
  setProviderEffort: (input: { provider: string; model: string; effort: string }) => __ipc("custom-model:set-effort", 1, [input]),
  setProviderEnabled: (input: { provider: string; enabled: boolean }) => __ipc("custom-model:set-enabled", 1, [input]),
  setProviderModel: (input: { provider: string; model: string; apply?: boolean; restart?: boolean }) => __ipc("custom-model:set-model", 1, [input]),
  upsertProviderModel: (input: { provider: string; model: unknown }) => __ipc("custom-model:upsert-model", 1, [input]),
  /* 写指路牌并就地完成基础迁移（异步分批 + 进度）；重启后只做秒级增量同步。重启复用既有 app:relaunch */
  prepareDataDir: (dir: string) => __ipc("dataDir:prepare", 1, [dir]),
  /* 数据目录（userData）现状：生效值 / 默认锚点 / 自定义值 / 待迁移标记 / 迁移进度 */
  readDataDir: () => __ipc("dataDir:read", 0, []),
  /* 10-04 B档 声明式插件清单（外部 JSON，含无效条目报告与两个目录路径） */
  declaredPluginsList: () => __ipc("declared-plugins:list", 0, []) as Promise<any>,
  /* 10-04 打开用户插件目录（不存在则创建） */
  declaredPluginsOpenDirs: () => __ipc("declared-plugins:open-dirs", 0, []) as Promise<{ ok: boolean; error?: string; userDir?: string; builtinDir?: string }>,
  /* 10-04 启停声明式插件（插槽即时生效，无需重启） */
  declaredPluginsToggle: (input: { id: string; enabled: boolean }) => __ipc("declared-plugins:toggle", 1, [input]) as Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>,
  chooseDirectory: () => __ipc("dialog:directory", 0, []),
  chooseDirectoryAt: (startPath: string) => __ipc("dialog:directory-at", 1, [startPath]),
  chooseFiles: () => __ipc("dialog:files", 0, []),
  chooseImages: () => __ipc("dialog:images", 0, []),
  /* 10-25 新建项目弹窗（ZCode 式三选一）：{ parent, name } = 在父目录下建文件夹；{ path } = 校验已有目录（存在才放行）。建出的目录登记进可信根（与 dialog:directory 同口径）。 */
  projectDir: (input: { parent?: string; name?: string; path?: string }) => __ipc("dialog:project-dir", 1, [{ input }]),
  saveFileAs: (sourcePath: string) => __ipc("dialog:save-as", 1, [sourcePath]),
  chooseSshKey: (startPath?: string) => __ipc("dialog:ssh-key", 0, [startPath]),
  dingtalkConnect: (clientId: string, clientSecret: string) => __ipc("dingtalk:connect", 2, [clientId, clientSecret]),
  dingtalkLogout: () => __ipc("dingtalk:logout", 0, []) as Promise<{ ok: boolean }>,
  /* 10-04 阶段 6 宿主域清单（启用/停用状态 + 是否 essential） */
  domainsList: () => __ipc("domains:list", 0, []) as Promise<{ domains: Array<{ id: string; mounted: boolean; disabled: boolean; essential: boolean }>; essentialDomains: string[]; requiresRestart: boolean }>,
  /* 10-04 「重启才生效」的话术由主进程出，禁在前端硬编码 */
  domainsReloadHint: () => __ipc("domains:reload-hint", 0, []) as Promise<{ requiresRestart: boolean; text: string }>,
  /* 10-04 阶段 6 停用/启用宿主域（下次启动生效，essential 域拒绝） */
  domainsSetEnabled: (input: { id: string; enabled: boolean }) => __ipc("domains:set-enabled", 1, [input]) as Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>,
  /* 把二进制素材（配音 WAV / 生成图）按字节写进工作区 .drama-canvas/assets/；工作区掉出可信根（会话已关/重启）时回退应用数据目录并置 fallback=true（09-29 修「参考图传不了」）。⛔ 渲染层唯一的写入通道 fs:write 是 utf8 字符串写，写不了二进制，WAV 必须走这里 */
  dramaCanvasAssetWrite: (input: { workspace: string; name: string; base64: string; subdir?: string }) => __ipc("drama-canvas:asset-write", 1, [input]) as Promise<{ path: string; fallback?: boolean }>,
  /* 画布快照镜像（09-29「打通」）：渲染层把当前画布（名称/工作流类型/节点/连线）防抖推给主进程，存 userData/drama-canvas/boards.json —— workflow_read 工具的数据源 */
  dramaCanvasBoardSync: (input: { name: string; flow: string; nodes: unknown[]; edges: unknown[] }) => __ipc("drama-canvas:board-sync", 1, [input]) as Promise<{ ok: boolean }>,
  /* 锁主体（09-29 电商出图工作流）：用已配置的**视觉模型**把商品参考图反推成一段固定主体描述，六类图（主图/SKU/详情/场景/白底/买家秀）共用，保证一套图是同一件商品。⛔ 当前生图通道 builtin:generate-image 是纯文生图（无图输入）⇒ 这是「参考图锁主体」的可行替代，不是图生图；模型须支持视觉输入，否则如实报错 */
  dramaCanvasDescribeImage: (input: { image: string; context?: string }) => __ipc("drama-canvas:describe-image", 1, [input]) as Promise<{ text: string }>,
  /* 产物目录（09-29 用户要求「在 codexharness 目录下面新增一个存的目录，也可以选择和修改目录」）：默认 <userData>/outputs，首次读取自动创建；返回当前目录与「是否为默认」。 */
  dramaCanvasOutputDir: () => __ipc("drama-canvas:output-dir", 0, []) as Promise<{ dir: string; isDefault: boolean }>,
  /* 设置产物目录：pick=true 弹系统目录选择框；dir 给绝对路径直接设；dir 为空串 = 恢复默认。目录不可用会明确报错（不静默回退）。 */
  dramaCanvasOutputDirSet: (input: { dir?: string; pick?: boolean }) => __ipc("drama-canvas:output-dir-set", 1, [input]) as Promise<{ dir: string; isDefault: boolean }>,
  /* 把一段生图提示词交给**用户已配置的模型**润色（一次性短请求，非流式，不开会话）：补主体细节/环境/光线/构图/风格，只回一行可直接用的提示词。⛔ 只支持 chat 协议供应商；官方订阅与 responses-only 网关明确报错 */
  dramaCanvasPolishPrompt: (input: { text: string; context?: string }) => __ipc("drama-canvas:polish-prompt", 1, [input]) as Promise<{ text: string }>,
  /* 删分镜表的工作区文件（只删 .drama-canvas/storyboards/<name>.json 这一个文件；不存在时幂等返回 removed:false） */
  dramaCanvasStoryboardFileRemove: (input: { workspace: string; name: string }) => __ipc("drama-canvas:storyboard-file-remove", 1, [input]),
  engineActiveTurns: () => __ipc("engine:active-turns", 0, []),
  engineCheckUpdate: () => __ipc("engine:check-update", 0, []),
  enginePerformUpdate: () => __ipc("engine:perform-update", 0, []),
  engineRestartLog: () => __ipc("engine:restart-log", 0, []),
  /* 装包 = 元技能 + 子技能 + 专家中心新增对应专家卡片 */
  installExpertMarketPackage: (input: { slug: string }) => __ipc("expert-market:install", 1, [input]),
  /* SkillHub 专家市场包（skillhub.cn/skillspackage，总 55 包） */
  listExpertMarketPackages: (input: { page?: number; pageSize?: number; query?: string } = {}) => __ipc("expert-market:list", 0, [input]),
  openExternal: (url: string) => __ipc("external:open", 1, [url]),
  addFavorite: (input: unknown) => __ipc("favorites:add", 1, [input]),
  clearFavorites: () => __ipc("favorites:clear", 0, []),
  /* 批量删除只认显式 id 列表（不提供隐式删全部） */
  deleteFavorites: (ids: string[]) => __ipc("favorites:delete", 1, [ids]),
  listFavorites: () => __ipc("favorites:list", 0, []),
  /* 只追加到记忆层（先读后写，不抹既有内容）；单行限长 300 字 */
  favoritesToMemory: (input: { ids: string[]; scope?: "user" | "project" | "background" | "lessons"; workspace?: string }) => __ipc("favorites:to-memory", 1, [input]),
  /* 记一次使用（useCount/lastUsedAt），失败不阻断发送 */
  touchFavorite: (id: string) => __ipc("favorites:touch", 1, [id]),
  updateFavorite: (input: unknown) => __ipc("favorites:update", 1, [input]),
  feishuConnect: (appId: string, appSecret: string) => __ipc("feishu:connect", 2, [appId, appSecret]),
  feishuLogout: () => __ipc("feishu:logout", 0, []) as Promise<{ ok: boolean }>,
  feishuQrCancel: () => __ipc("feishu:qr-cancel", 0, []) as Promise<{ ok: boolean }>,
  feishuQrStart: () => __ipc("feishu:qr-start", 0, []),
  feishuQrStatus: () => __ipc("feishu:qr-status", 0, []),
  fileExists: (path: string) => __ipc("fs:exists", 1, [{ path }]),
  readFile: (path: string, threadId?: string) => __ipc("fs:read", 1, [{ path, threadId }]),
  /* 在系统资源管理器中定位文件（可信根校验同 fs:read）；画布生成产物「打开文件夹」 */
  revealInFolder: (path: string) => __ipc("fs:reveal", 1, [{ path }]),
  writeFile: (path: string, content: string, root: string) => __ipc("fs:write", 1, [{ path, content, root }]),
  /* 10-18 实修：unstaged=git diff / staged=--cached / head=分支起点 merge-base diff（含已提交+未提交，找不到基准才退回 HEAD 并说明）/ last 由渲染层展示；Git 缺失/非仓库/无 HEAD 都回中文原因 */
  gitDiff: (cwd: string, scope: string) => __ipc("git:diff", 1, [{ cwd, scope }]),
  /* 09-24 新增：顶栏 🔍 历史会话搜索。扫 codex-home rollout 原档（sessions/** + archived_sessions/**）搜对话内容；先 indexOf 快速否决再解析，>32MB 跳过并计数 */
  searchHistory: (input?: { query?: string; limit?: number }) => __ipc("history:search", 0, [input]),
  setHookEnabled: (input: { hookKeys: string[]; enabled: boolean }) => __ipc("hooks:set-enabled", 1, [input]),
  trustHooks: (cwds?: string[]) => __ipc("hooks:trust", 0, [{ cwds }]),
  /* HTML 实时预览：停止当前监听 */
  htmlPreviewUnwatch: () => __ipc("html-preview:unwatch", 0, []),
  /* HTML 实时预览：开始监听一个 HTML 文件（可信目录 + 扩展名白名单；120ms 防抖；变更推 harness 事件 html-preview:changed） */
  htmlPreviewWatch: (input: unknown) => __ipc("html-preview:watch", 1, [input]),
  /* P1（10-11）：把本地 HTML/URL 动画在本地渲成 MP4 —— Chromium 抓帧 + 运行时自带 MP4 编码器，零 ffmpeg 依赖；源须为 http(s) 或可信根内 .html */
  htmlVideoRender: (input: { source?: string; seconds?: number; fps?: number; width?: number; height?: number; outPath?: string }) => __ipc("html-video:render", 1, [input]) as Promise<any>,
  /* 修图执行端（10-09 从 agents:dispatch-call 拆出）：**零凭证**，纯本地 jimp（20 种 ops）。先亮源图 → 换产物 → 自动收起。⛔ 输出不覆盖原图（产出 <名字>-edit.<ext>），天然可回退 */
  imageEdit: (input: unknown) => __ipc("image-lab:edit", 1, [input]),
  /* 生图执行端（10-09 从 agents:dispatch-call 拆出）：**唯一需要生图插件凭证的**通道（读 builtin-plugins.json 的 image 段 → 打外部网关）。调用时弹「图像工坊」浮层，完成自动收起。⛔ 与 image-lab:edit 分属两条通道 —— 用户明确要求「生成和编辑的 IPC 彻底分开」 */
  imageGenerate: (input: unknown) => __ipc("image-lab:generate", 1, [input]),
  /* 读图片元信息（尺寸/格式/透明通道/字节数）。只读，不弹浮层。零凭证 */
  imageInfo: (input: unknown) => __ipc("image-lab:info", 1, [input]),
  /* 图像工坊读通道（image-lab 域，10-09）：渲染层浮层预览拉图片字节；路径闸 = resolveImagePath（可信根 + 图片扩展名 + 128MB），与修图通道共用同一道闸 */
  readImage: (path: string) => __ipc("image-lab:read", 1, [{ path }]),
  /* 在应用内弹「图像工坊」浮层给用户看一张图。只读展示、**不自动收起**（由用户自己关）。零凭证 */
  imageView: (input: unknown) => __ipc("image-lab:view", 1, [input]),
  /* 追加一条（## HH:mm 标题 + 正文） */
  journalAppend: (date: string, title: string, body: string) => __ipc("journal:append", 3, [date, title, body]),
  journalList: () => __ipc("journal:list", 0, []),
  journalRead: (date: string) => __ipc("journal:read", 1, [date]),
  journalRemove: (date: string) => __ipc("journal:remove", 1, [date]),
  /* 整篇覆盖（编辑器保存） */
  journalSave: (date: string, content: string) => __ipc("journal:save", 2, [date, content]),
  journalSearch: (query: string) => __ipc("journal:search", 1, [query]),
  addKnowledgeFiles: (input: { workspace?: string; paths?: string[] }) => __ipc("kb:add-files", 1, [input]),
  addKnowledgeText: (input: { workspace?: string; title?: string; text?: string; source?: string }) => __ipc("kb:add-text", 1, [input]),
  /* 读取知识库后端：local=项目本地库 / cloud=云端 weknora（MCP） */
  kbBackendGet: () => __ipc("kb:backend-get", 0, []),
  /* 切换知识库后端并回传生效值 + 连接器联动结果（connector.applied=false ⇒ 只存了设置、工具面没跟上，note 说明原因） */
  kbBackendSet: (backend: "local" | "cloud") => __ipc("kb:backend-set", 1, [backend]),
  /* npm(npmmirror)+模型(hf-mirror)；进度经 runtime:progress(id=kb-embedding) 推送 */
  installKbEmbedBackend: () => __ipc("kb:embed-install", 0, []),
  /* 10-04：本地语义后端改按需下载 —— 知识库页卡片据此显示安装入口 */
  getKbEmbedStatus: () => __ipc("kb:embed-status", 0, []),
  uninstallKbEmbedBackend: () => __ipc("kb:embed-uninstall", 0, []),
  /* 10-01 新增：项目级本地知识库（<项目>/.codex-harness/knowledge/） */
  listKnowledgeDocs: (input?: { workspace?: string }) => __ipc("kb:list", 0, [input]),
  readKnowledgeDoc: (input: { workspace?: string; docId?: string }) => __ipc("kb:read", 1, [input]),
  removeKnowledgeDoc: (input: { workspace?: string; docId?: string }) => __ipc("kb:remove", 1, [input]),
  searchKnowledge: (input: { workspace?: string; query?: string; limit?: number }) => __ipc("kb:search", 1, [input]),
  /* 思考等级自动判断（choice: low/medium/high/xhigh + 校准置信度；置信 <0.45 弃权返回 null，调用方回落手选档） */
  layaDecideEffort: (text: string) => __ipc("laya:decide-effort", 1, [text]),
  /* 安装/更新 laya[serve]（pip 清华镜像；torch 大，20 分钟超时）；权重由服务首启时经 hf-mirror 拉取 */
  layaInstall: () => __ipc("laya:install", 0, []),
  /* 模型工具 laya_judge 的执行端：只有装了 Laya 才注册进模型工具面；短文本多选一判断（知识价值 / 重复 / 自定义 2~6 项），低置信弃权、不自动安装（10-18） */
  layaJudge: (input: unknown) => __ipc("laya:judge", 1, [input]),
  /* Laya 智能判断：服务/安装状态（pip 包 + laya-serve 进程 + 权重就绪） */
  layaStatus: () => __ipc("laya:status", 0, []),
  /* 卸载 Laya（先停服务进程，再 pip uninstall -y laya）；模型权重缓存在用户 HF 缓存目录，不随卸载删除（其他工具可能共用） */
  layaUninstall: () => __ipc("laya:uninstall", 0, []),
  /* app-server 直管 MCP 的启用覆盖表；没记过的一律视为启用 */
  readMcpServerOverrides: () => __ipc("mcp-servers:overrides", 0, []),
  /* 各 MCP 服务器的按工具权限档位：{ 服务器: { 工具: "deny"|"ask"|"allow" } } */
  readMcpToolPermissions: () => __ipc("mcp-servers:permissions", 0, []),
  /* 统一入口：名字能匹配连接器的走连接器，其余走覆盖表；每次改动都会重启引擎 */
  setMcpServersEnabled: (ids: string[], enabled: boolean) => __ipc("mcp-servers:set-enabled", 1, [{ ids, enabled }]),
  /* 设置/清除某个 MCP 工具的权限档位；mode 传 null 清除。改动后引擎重启生效 */
  setMcpToolPermission: (server: string, tool: string, mode: "deny" | "ask" | "allow" | null) => __ipc("mcp-servers:set-tool-permission", 1, [{ server, tool, mode }]),
  /* 记忆后端二选一：用户选的值 + 实际生效值（装了 MCP 服务才让位；云端未开通则回退内置）+ 云端开通状态 + 安装命令 */
  readMemoryBackend: () => __ipc("memory:backend:read", 0, []),
  /* 切换记忆后端并回传新状态；选云端但未开通/未接通 ⇒ 不落盘，回执带 refused 原因 */
  setMemoryBackend: (backend: "builtin" | "mcp" | "cloud") => __ipc("memory:backend:set", 1, [backend]),
  deleteMemory: (id: string) => __ipc("memory:delete", 1, [id]),
  distillMemory: (workspace?: string) => __ipc("memory:distill", 0, [workspace]),
  /* 10-05 统一记忆只读：某命名空间的条目（含来源智能体/权重/归档态） */
  listFabricEntries: (input: unknown) => __ipc("memory:fabric-entries", 1, [input]),
  /* 10-05 统一记忆只读：命名空间概览（两种作用域 + 条数）—— 前端分区渲染用 */
  listFabricNamespaces: (workspace?: string) => __ipc("memory:fabric-namespaces", 0, [workspace]),
  /* 10-05 统一记忆（写）：主会话的 memory_write 走这里；session=本会话私有 / project=全项目共享 */
  writeFabricMemory: (input: unknown) => __ipc("memory:fabric-write", 1, [input]),
  getMemoryGateway: () => __ipc("memory:gateway:read", 0, []),
  saveMemoryGateway: (config: unknown) => __ipc("memory:gateway:save", 1, [config]),
  testMemoryGateway: (config: unknown) => __ipc("memory:gateway:test", 1, [config]),
  /* 执行清理动作：⛔ 必须 confirm: true（UI 二次确认后才置位） */
  applyMemoryHygiene: (input: { action: "purge-archive" | "prune-pool" | "tidy-lessons"; workspace?: string; confirm: true }) => __ipc("memory:hygiene:apply", 1, [input]),
  planMemoryHygiene: (workspace?: string) => __ipc("memory:hygiene:plan", 0, [workspace]),
  /* 常驻记忆（L 层）；threadId 仅供注入审计（隔离仍按工作区） */
  readMemoryContext: (workspace?: string, includeWorkspace = true, threadId?: string) => __ipc("memory:layers:context", 0, [workspace, includeWorkspace, threadId]),
  readMemoryLayers: (workspace?: string) => __ipc("memory:layers:read", 0, [workspace]),
  writeMemoryLayer: (input: { scope: "user" | "background" | "project" | "lessons"; content: string; workspace?: string }) => __ipc("memory:layers:write", 1, [input]),
  listMemory: (category?: string) => __ipc("memory:list", 0, [category]),
  /* 一键安装 MCP 记忆服务（主进程用应用自带 node 跑安装器；新电脑无需预装 Node） */
  installMemoryMcp: () => __ipc("memory:mcp:install", 0, []),
  /* 卸载 MCP 记忆服务（删 <userData>/memory-mcp） */
  uninstallMemoryMcp: () => __ipc("memory:mcp:uninstall", 0, []),
  /* 真跑一次 MCP 握手校验（不是只判文件存在） */
  verifyMemoryMcp: () => __ipc("memory:mcp:verify", 0, []),
  readMemoryMode: () => __ipc("memory:mode-read", 0, []),
  setMemoryMode: (mode: "local" | "cloud") => __ipc("memory:mode-set", 1, [mode]),
  /* 碎片池召回（strictWorkspace：只回本工作区）；threadId 仅供审计 */
  recallMemory: (query: string, workspace?: string, threadId?: string) => __ipc("memory:recall", 1, [query, workspace, threadId]),
  /* 清空全部碎片记忆（不可恢复）；confirm !== true 一律拒（10-29 审查） */
  resetMemory: (confirm: boolean) => __ipc("memory:reset", 1, [confirm]),
  /* 10-05 统一记忆（读）：session 段按 threadId 硬隔离 + project 段全项目共享 + 上一版角色记忆兼容段。主会话与被调度角色走同一个 handler */
  readRoleMemoryContext: (input: unknown) => __ipc("memory:role-context", 1, [input]),
  /* 10-05 记忆前端：会话↔角色归属表（fabric 命名空间只带 threadId，靠它归到人） */
  listRoleSessions: () => __ipc("memory:role-sessions", 0, []),
  saveMemory: (input: unknown) => __ipc("memory:save", 1, [input]),
  /* 记忆容量倍率（×1 基准，可选 1/2/4/8/10/16）：返回当前倍率、可选项与放大后的预算 */
  readMemoryScale: () => __ipc("memory:scale:read", 0, []),
  /* 设置记忆容量倍率（当场生效 + 落 app-settings；非法值归一化回基准） */
  setMemoryScale: (scale: number) => __ipc("memory:scale:set", 1, [scale]),
  /* 碎片池检索；带 workspace 时只回本工作区（strictWorkspace） */
  searchMemory: (query: string, workspace?: string) => __ipc("memory:search", 1, [query, workspace]),
  readWorkspaceMemoryEnabled: (workspace?: string) => __ipc("memory:workspace-enabled:read", 0, [workspace]),
  setWorkspaceMemoryEnabled: (input: { workspace: string; enabled: boolean }) => __ipc("memory:workspace-enabled:set", 1, [input]),
  readModelSpecs: () => __ipc("model-specs:read", 0, []),
  readModel: (path: string) => __ipc("model-viewer:read", 1, [{ path }]),
  showNotification: (title: string, body: string) => __ipc("notify:show", 2, [title, body]),
  openaiAccountRemove: (id: string) => __ipc("openai:account-remove", 1, [id]),
  openaiAccountSwitch: (id: string) => __ipc("openai:account-switch", 1, [id]),
  openaiAccounts: () => __ipc("openai:accounts", 0, []),
  openaiCaptureLogin: () => __ipc("openai:capture-login", 0, []),
  openaiImportFile: (input: { contents: string[] }) => __ipc("openai:import-file", 1, [input]),
  openaiLoginCancel: () => __ipc("openai:login-cancel", 0, []),
  openaiLoginStart: (input?: { proxy?: string }) => __ipc("openai:login-start", 0, [input ?? {}]),
  openaiLoginStatus: () => __ipc("openai:login-status", 0, []),
  openaiModels: () => __ipc("openai:models", 0, []),
  openaiSetProxy: (proxy: string) => __ipc("openai:set-proxy", 1, [proxy]),
  openaiToggleAccount: (input: { id: string; disabled: boolean }) => __ipc("openai:toggle-account", 1, [input]),
  openaiUsage: (input?: { email?: string }) => __ipc("openai:usage", 0, [input ?? {}]),
  /* 下载并校验官方安装包（走 updates.downloadUpdate：镜像候选 + 302 + 强制 https + asset.digest 的 sha256；校验不过换下一档并删半截文件）。进度事件 {type:openfilm, phase:desktop} */
  openfilmDesktopDownload: () => __ipc("openfilm:desktop-download", 0, []),
  /* 桌面端状态：能不能装 / 已装在哪 / 上游最新版 / 本地安装包。⛔ 不代跑它的 electron-updater（App 更新归 App） */
  openfilmDesktopInfo: () => __ipc("openfilm:desktop-info", 0, []),
  /* 运行安装器（Win 带界面 / /S 静默；macOS hdiutil 挂载 + cp + xattr 清 quarantine）/ 打开安装包所在目录 / 卸载引导（⛔ 我们绝不代删 /Applications 或 Program Files） */
  openfilmDesktopRun: (action?: unknown) => __ipc("openfilm:desktop-run", 0, [action]),
  /* 按需安装（三步可单步重试；npm 走 npmmirror、chromium 走 cdn.npmmirror，失败回官方） */
  openfilmInstall: (step?: unknown) => __ipc("openfilm:install", 0, [step]),
  /* 单步重试（缺省 verify） */
  openfilmRetry: (step?: unknown) => __ipc("openfilm:retry", 0, [step]),
  /* 读 OpenFilm 组件设置（自动更新三档 + 镜像策略） */
  openfilmSettingsGet: () => __ipc("openfilm:settings-get", 0, []),
  /* 写设置（取值归一化后落盘） */
  openfilmSettingsSet: (patch: unknown) => __ipc("openfilm:settings-set", 1, [patch]),
  /* 扫描安装状态（CLI 版本 / 内置 node / chromium 缓存 / ffmpeg / 设置 / 开源声明） */
  openfilmStatus: () => __ipc("openfilm:status", 0, []),
  /* 打开（或切到）某部影片的 Studio 页面：跑 open <dir>（OPENFILM_NO_BROWSER=1），从 stdout 抓 Studio 行，写 session.json 并广播 openfilm/studio 事件（渲染层据此开进内置浏览器）。⛔ 不提供「关闭」——实例可能被桌面 App 或别的 agent 用着 */
  openfilmStudioOpen: (filmDir?: unknown) => __ipc("openfilm:studio-open", 0, [filmDir]),
  /* Studio 探活（~/.openfilm/run.json + GET /api/health；⛔ 不看 HTTP 200，认 product=openfilm-studio） */
  openfilmStudioStatus: () => __ipc("openfilm:studio-status", 0, []),
  /* 卸载运行时（只删 runtime，绝不碰用户 film 目录） */
  openfilmUninstall: () => __ipc("openfilm:uninstall", 0, []),
  /* 查最新版（npm dist-tag，镜像优先；比较只认 compareVersions） */
  openfilmUpdateCheck: () => __ipc("openfilm:update-check", 0, []),
  readPastedText: (path: string) => __ipc("pasted-text:read", 1, [path]),
  savePastedText: (text: string) => __ipc("pasted-text:save", 1, [text]),
  updatePastedText: (path: string, content: string) => __ipc("pasted-text:update", 1, [{ path, content }]),
  markIdentityGreeted: () => __ipc("personalization:mark-greeted", 0, []),
  readPersonalization: () => __ipc("personalization:read", 0, []),
  savePersonalization: (input: { nickname?: string; customInstructions?: string }) => __ipc("personalization:save", 1, [input]),
  /* ⛔ d.ts 历史上本有两处声明（宽口径 Record<string,string> 与窄口径 3 字段），提取去重保留宽口径 —— identity_onboard 调用点传 8 个字段，窄口径会爆 excess-property。 */
  saveIdentity: (input: Record<string, unknown>) => __ipc("personalization:save-identity", 1, [input]),
  /* 仅更新称呼：写 personalization.json + AGENTS.md，不重启引擎 */
  setNickname: (nickname: string) => __ipc("personalization:setNickname", 1, [nickname]),
  verifyPersonalization: () => __ipc("personalization:verify", 0, []),
  /* 活动气泡「打开」：标记已看 → 聚焦主窗口 → 让渲染层切到该会话 */
  petActivityOpen: (threadId: string) => __ipc("pet:activity-open", 1, [threadId]),
  /* 活动气泡「回复」：对运行中的回合发 turn/steer（把一句话补进当前任务，不新起回合） */
  petActivityReply: (threadId: string, text: string) => __ipc("pet:activity-reply", 2, [threadId, text]),
  /* 活动气泡「停止」：对运行中的回合发 turn/interrupt（主进程侧，不依赖主窗口是否打开） */
  petActivityStop: (threadId: string) => __ipc("pet:activity-stop", 1, [threadId]),
  /* 桌面宠物工具栏：收起/展开活动气泡（状态在主进程，两个浮窗同步） */
  petActivityToggle: () => __ipc("pet:activity-toggle", 0, []),
  /* 宠物手动拖动结束：夹回工作区，moved 事件负责落盘坐标 */
  petDragEnd: () => __ipc("pet:drag-end", 0, []),
  /* 宠物手动拖动中（屏幕坐标）；主进程按增量 setBounds，实现「拖着走」 */
  petDragMove: (pos: { screenX: number; screenY: number }) => __ipc("pet:drag-move", 1, [pos]),
  /* 宠物手动拖动开始（屏幕坐标）；主进程记下窗口原点，之后由 pet:drag-move 移动窗口 */
  petDragStart: (pos: { screenX: number; screenY: number }) => __ipc("pet:drag-start", 1, [pos]),
  /* 渲染层报告当前打开的会话；活动气泡跟随会话排序（10-22） */
  petFocusThread: (threadId: string) => __ipc("pet:focus-thread", 1, [threadId]),
  /* 隐藏宠物（置 enabled=false；下次启动不自动恢复） */
  petHide: () => __ipc("pet:hide", 0, []),
  /* 把外部宠物包**复制**进 userData/pets（只允许从已登记的宠物目录导入；不移动、不覆盖同名） */
  petImport: (dir: string) => __ipc("pet:import", 1, [dir]),
  /* 上报「宠物本体」矩形（相对窗口内容左上角，CSS 像素；null = 无可交互区）——主进程按 screen.getCursorScreenPoint 轮询比对决定整块穿透/可交互。⛔ 翻转判据刻意不依赖页面鼠标事件：窗口整块是 app-region drag，drag 区属非客户区，Chromium 不派发 DOM mousemove（第一版挂在 mousemove 上 ⇒ 宠物直接拖不动） */
  petInteractiveRect: (rect: { x: number; y: number; width: number; height: number } | null) => __ipc("pet:interactive-rect", 1, [rect]),
  /* 扫描宠物目录（内置 dist/pets + userData/pets + ~/.codex/pets + ~/.petdex/pets）；同名 id 先到先得，内置优先 */
  petList: () => __ipc("pet:list", 0, []),
  /* 在系统文件管理器打开宠物目录（缺省 = 用户目录；不存在则先建，否则 Windows 上静默无反应） */
  petOpenDir: (which?: string) => __ipc("pet:open-dir", 0, [which]),
  /* 桌面宠物双击/工具栏「打开」：聚焦主窗口 */
  petOpenMain: () => __ipc("pet:open-main", 0, []),
  /* 宠物目录清单：设置页显示「官方宠物包放哪儿」，writable 只对用户目录为真 */
  petRoots: () => __ipc("pet:roots", 0, []),
  /* 宠物设置 + 当前生效的宠物包（active 无效时回落第一只可用的） */
  petSettingsGet: () => __ipc("pet:settings-get", 0, []),
  /* 改完立刻应用（显隐 / 位置 / 缩放 / 透明度）；取值一律归一化后再落盘 */
  petSettingsSet: (patch: unknown) => __ipc("pet:settings-set", 1, [patch]),
  /* 显示宠物（置 enabled=true） */
  petShow: () => __ipc("pet:show", 0, []),
  /* 浮窗首帧补水（推送可能发生在窗口创建之前）+ 诊断 */
  petState: () => __ipc("pet:state", 0, []),
  /* 显示/隐藏切换（走独立通道，避免为了开关宠物而整份重写设置） */
  petToggle: () => __ipc("pet:toggle", 0, []),
  /* 跑上游 --doctor 体检 */
  phoneHarnessDoctor: () => __ipc("phone:harness:doctor", 0, []) as Promise<{ok:boolean;log:string}>,
  /* 按平台返回权限引导步骤 */
  phoneHarnessGuides: () => __ipc("phone:harness:guides", 0, []) as Promise<{id:string;title:string;steps:string[]}[]>,
  /* 装 phone-harness + 关遥测 + 注册技能 */
  phoneHarnessInstall: () => __ipc("phone:harness:install", 0, []) as Promise<{ok:boolean;log:string}>,
  /* 打开系统权限设置页 */
  phoneHarnessOpenSettings: () => __ipc("phone:harness:open-settings", 0, []) as Promise<void>,
  /* 手机控制状态（平台/pip 包/adb/技能/遥测） */
  phoneHarnessStatus: () => __ipc("phone:harness:status", 0, []) as Promise<{platform:string;python:string;pythonOk:boolean;installed:boolean;version:string;adb:boolean;skill:boolean;telemetryOff:boolean;iphoneEligible:boolean}>,
  /* 卸载 phone-harness 与技能 */
  phoneHarnessUninstall: () => __ipc("phone:harness:uninstall", 0, []) as Promise<{ok:boolean;log:string}>,
  /* 把工具链里的 adb 写进 phone-harness 配置（android.adb，不改系统 PATH） */
  phoneHarnessWireAdb: () => __ipc("phone:harness:wire-adb", 0, []) as Promise<{adb:string}>,
  validatePlugin: (target: string) => __ipc("plugin:validate", 1, [{ path: target }]),
  installMarketPlugin: (plugin: unknown) => __ipc("plugins:market-install", 1, [plugin]),
  /* 10-03：本地已装市场插件清单（**只扫本地目录、零网络**；供「已安装」列表补齐引擎没认领的那批 —— 不能走 market-list，那条会拉远端 48 个插件） */
  listInstalledMarketPlugins: () => __ipc("plugins:market-installed", 0, []),
  /* 10-03：逐项 installed 之外另给**全量已装 slug 清单**（不分页），供渲染层把「引擎没认领但文件已落盘」的插件补进「已安装」列表 */
  listMarketPlugins: (input: unknown = {}) => __ipc("plugins:market-list", 0, [input]),
  /* 10-03：本地市场插件卸载（先请引擎 plugin/uninstall，再删落盘目录 + 摘 marketplace 清单；删除目标经 safeFolder 归一 + 目录内校验） */
  uninstallMarketPlugin: (slug: unknown) => __ipc("plugins:market-uninstall", 1, [slug]),
  setPluginEnabled: (input: { pluginIds: string[]; enabled: boolean }) => __ipc("plugins:set-enabled", 1, [input]),
  setPluginLinkedEnabled: (input: { pluginId: string; enabled: boolean }) => __ipc("plugins:set-linked-enabled", 1, [input]),
  /* 10-12 新增：按 slug 取市场最新对象、重跑**同一条安装链**覆盖更新（含引擎注册与重启）。市场已下架时明确报错，不静默跳过 */
  updatePlugin: (slug: string) => __ipc("plugins:update", 1, [slug]),
  /* 10-12 新增：插件**有版本号**（marketplace.json 的 version vs 本地 .codex-market.json）⇒ 走真版本比对。⛔ 只读、零副作用；版本缺失的一律 comparable:false 交给界面如实显示，不许演成「已是最新」 */
  checkPluginUpdates: () => __ipc("plugins:update-check", 0, []),
  /* 10-09 用户在界面上按「中止」→ 主进程的 wait 循环停下（任务本身不会被撤销） */
  pollAbort: (input: { taskId: string }) => __ipc("poll:abort", 1, [input]) as Promise<{ ok: boolean; aborted: boolean }>,
  /* 10-09 轮询板块：读「间隔 / 超时上限 / 失败重试次数」（真相源在 userData/poll-settings.json） */
  pollConfigRead: () => __ipc("poll:config-read", 0, []) as Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>,
  /* 10-09 保存轮询配置（会先过钳制：超时≥间隔×2）—— 返回**钳制后**的真值，渲染层照它回显 */
  pollConfigSave: (input: { intervalMs?: number; timeoutMs?: number; maxRetry?: number }) => __ipc("poll:config-save", 1, [input]) as Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>,
  ponytailModeGet: () => __ipc("ponytail:mode:get", 0, []) as Promise<string>,
  ponytailModeSet: (mode: string) => __ipc("ponytail:mode:set", 1, [mode]) as Promise<{ mode: string }>,
  enhancePrompt: (text: string) => __ipc("prompt:enhance", 1, [{ text }]),
  qqConnect: (appId: string, appSecret: string) => __ipc("qq:connect", 2, [appId, appSecret]),
  qqLogout: () => __ipc("qq:logout", 0, []) as Promise<{ ok: boolean }>,
  qqQrCancel: () => __ipc("qq:qr-cancel", 0, []) as Promise<{ ok: boolean }>,
  qqQrStart: () => __ipc("qq:qr-start", 0, []),
  qqQrStatus: () => __ipc("qq:qr-status", 0, []),
  /* 取消排队消息定时（删除消息/取消定时/到点清理时调） */
  queueTimerCancel: (input: { queuedSubmissionId: string }) => __ipc("queue-timer:cancel", 1, [input]) as Promise<{ ok: boolean }>,
  /* 排队消息定时发送：主进程登记定时器（不受渲染层隐藏节流），到点广播 queue-timer:due */
  queueTimerSet: (input: { threadId: string; queuedSubmissionId: string; runAt: number }) => __ipc("queue-timer:set", 1, [input]) as Promise<{ ok: boolean; scheduled: boolean }>,
  relayAccounts: () => __ipc("relay:accounts", 0, []),
  relayCreateKey: (input: { name: string; groupId?: number | null; accountId?: string }) => __ipc("relay:create-key", 1, [input]),
  /* 删除密钥（上游 DELETE /api/v1/keys/:id）。⛔ 正在使用的密钥（selectedKeyId）拒绝删除 —— 删掉后当前供应商拿着死 key 全部 401，先切再删 */
  relayDeleteKey: (input: { id: number; accountId?: string }) => __ipc("relay:delete-key", 1, [input]),
  relayKeyBilling: (input: { baseUrl: string; apiKey: string }) => __ipc("relay:key-billing", 1, [input]),
  relayKeysAll: () => __ipc("relay:keys-all", 0, []),
  relayLoadAccount: () => __ipc("relay:load-account", 0, []),
  relayLogin: (input: { baseUrl: string; email: string; password: string }) => __ipc("relay:login", 1, [input]),
  relayOpenPurchase: () => __ipc("relay:open-purchase", 0, []),
  relayOverview: (id?: string) => __ipc("relay:overview", 0, [id]),
  relayPaymentPlans: () => __ipc("relay:payment-plans", 0, []),
  relayRegister: (input: { baseUrl: string; email: string; password: string; affCode?: string }) => __ipc("relay:register", 1, [input]),
  relayRemoveAccount: (id: string) => __ipc("relay:remove-account", 1, [id]),
  relaySelect: (input: { mode: "balance" | "plan"; groupId: number | null; keyId?: number; keyName?: string }) => __ipc("relay:select", 1, [input]),
  relaySwitchAccount: (id: string) => __ipc("relay:switch-account", 1, [id]),
  relayToggleAccount: (input: { id: string; disabled: boolean }) => __ipc("relay:toggle-account", 1, [input]),
  /* 改已有密钥的分组（上游 PUT /api/v1/keys/:id）。⛔ 上游对 group_id=null 是「不修改」⇒ 解绑成无分组做不到，UI 只提供分组间切换；改当前生效密钥时同步 selectedGroupId */
  relayUpdateKeyGroup: (input: { id: number; groupId: number; accountId?: string }) => __ipc("relay:update-key-group", 1, [input]),
  remoteApprove: (rid: string) => __ipc("remote:approve", 1, [rid]),
  remoteDeny: (rid: string) => __ipc("remote:deny", 1, [rid]),
  remoteDevices: () => __ipc("remote:devices", 0, []),
  remotePairRotate: () => __ipc("remote:pair-rotate", 0, []),
  remotePairState: () => __ipc("remote:pair-state", 0, []),
  remoteQrcode: (botId?: string) => __ipc("remote:qrcode", 0, [botId]),
  remoteRevoke: (deviceId: string) => __ipc("remote:revoke", 1, [deviceId]),
  remoteSend: (cmd: string) => __ipc("remote:send", 1, [cmd]),
  remoteStart: () => __ipc("remote:start", 0, []),
  remoteStatus: () => __ipc("remote:status", 0, []),
  remoteStop: () => __ipc("remote:stop", 0, []),
  deleteRpaRecipe: (id: string) => __ipc("rpa:delete", 1, [id]),
  listRpaRecipes: () => __ipc("rpa:list", 0, []),
  recordRpaRun: (input: { id: string; ok: boolean; error?: string }) => __ipc("rpa:record", 1, [input]),
  saveRpaRecipe: (input: unknown) => __ipc("rpa:save", 1, [input]),
  /* 10-07 取消安装：杀子进程 + 清临时文件；reason=not-running 表示该工具没有在跑的安装 */
  cancelRuntime: (id: string) => __ipc("runtime:cancel", 1, [id]),
  /* 工具自检（10-02 用户要的「检查」）：逐个探测已装工具**能不能真跑**（跑一次版本命令/可执行性），返回逐项结果，界面直接列给人看 */
  runtimeHealth: () => __ipc("runtime:health", 0, []),
  installRuntime: (id: string) => __ipc("runtime:install", 1, [id]),
  listRuntimes: () => __ipc("runtime:list", 0, []),
  uninstallRuntime: (id: string) => __ipc("runtime:uninstall", 1, [id]),
  /* 10-12 新增：从 npm 国内镜像装 <pkg>@latest 到 tools/npm-global（进度走 runtime:progress），装完**复核磁盘版本**、再按闸门重启引擎。⛔ 与「修复安装」不同：后者从随包 zip 重解压（版本回到包内版本，属降级） */
  updateRuntime: (id: string) => __ipc("runtime:update", 1, [id]),
  /* 10-12 新增（用户要求「nuphus 和 browser 留国内镜像源更新入口」）：查 npm 最新版（国内镜像优先、回落官方源）并读磁盘已装版，给出 hasUpdate。传 id 返回单条、不传返回全部可更新工具 —— 包名与落位的真相源在主进程 UPDATEABLE_TOOLS / npmGlobalRootCandidates */
  checkRuntimeUpdate: (id?: string) => __ipc("runtime:update-check", 0, [id]),
  deleteScheduledTask: (id: string) => __ipc("scheduler:delete", 1, [id]),
  listScheduledTasks: () => __ipc("scheduler:list", 0, []),
  runScheduledTask: (id: string) => __ipc("scheduler:run", 1, [id]),
  saveScheduledTask: (input: unknown) => __ipc("scheduler:save", 1, [input]),
  createScratchDir: () => __ipc("scratch:create", 0, []),
  /* 成功时另推 screenshot:captured 事件给主窗口（渲染层只认事件，避免插两份） */
  screenshotCapture: (mode: "full" | "region") => __ipc("screenshot:capture", 1, [mode]),
  /* 先注册成功才落盘；冲突时保留原设置 */
  screenshotHotkeySet: (input: { mode: "full" | "region"; accelerator?: string; enabled?: boolean }) => __ipc("screenshot:hotkey-set", 1, [input]),
  screenshotPickDir: () => __ipc("screenshot:pick-dir", 0, []),
  /* 在系统文件管理器里定位截图 */
  screenshotReveal: (file: string) => __ipc("screenshot:reveal", 1, [file]),
  /* 截图设置 + 实际注册成功的快捷键 + 冲突说明 */
  screenshotSettingsGet: () => __ipc("screenshot:settings-get", 0, []),
  /* 改完立刻重挂快捷键（不重启即生效） */
  screenshotSettingsSet: (patch: unknown) => __ipc("screenshot:settings-set", 1, [patch]),
  shellOpen: (target: string) => __ipc("shell:open", 1, [target]),
  shellReveal: (target: string) => __ipc("shell:reveal", 1, [target]),
  windowClose: () => __ipc("shell:window-close", 0, []),
  /* 窗口控制（无边框窗自定义按钮；只作用于调用者自己的窗口） */
  windowMinimize: () => __ipc("shell:window-minimize", 0, []),
  windowState: () => __ipc("shell:window-state", 0, []),
  windowToggleMaximize: () => __ipc("shell:window-toggle-maximize", 0, []),
  skillDisciplineGet: () => __ipc("skill-discipline:get", 0, []),
  /* 内置技能的独立开关（10-06）：读某内置技能**全局**是否生效（设置 → 控制台用；与 skill-pool 同一真相源） */
  getBuiltinSkillSwitch: (input: { name: string }) => __ipc("skills:builtin-switch-get", 1, [input]),
  /* 开关内置技能的**全局**生效态并立即投影磁盘（cwd 可空；只动全局集，不改项目集） */
  setBuiltinSkillSwitch: (input: { name: string; enabled: boolean; cwd?: string }) => __ipc("skills:builtin-switch-set", 1, [input]),
  importSkill: () => __ipc("skills:import", 0, []),
  /* 精选技能包（10-30）：三个第三方技能包的安装状态（已装技能名来自本板块自己写的 marker） */
  listSkillPacks: () => __ipc("skill-packs:list", 0, []),
  /* 下载仓库 skills/ 子树 → 逐个 auditSkill → 落 codex-home/skills → 重启引擎；同名目录跳过、不覆盖 */
  installSkillPack: (input: { id: string }) => __ipc("skill-packs:install", 1, [input]),
  /* 只删本板块 marker 记下的技能目录（⛔ 用户自建的目录不动） */
  uninstallSkillPack: (input: { id: string }) => __ipc("skill-packs:uninstall", 1, [input]),
  listLocalSkills: () => __ipc("skills:local-list", 0, []),
  removeLocalSkill: (input: { folder: string; name?: string }) => __ipc("skills:local-remove", 1, [input]),
  installMarketSkill: (skill: unknown) => __ipc("skills:market-install", 1, [skill]),
  installMarketSkillLight: (skill: unknown) => __ipc("skills:market-install-light", 1, [skill]),
  listMarketSkills: (input: unknown = {}) => __ipc("skills:market-list", 0, [input]),
  /* 共享技能池（09-27）：按项目查看/管理全局技能生效集 */
  describeSkillPool: (input: { cwd: string }) => __ipc("skills:pool-describe", 1, [input]),
  /* 设置全局停用/本项目禁用并立即投影 */
  setSkillPoolState: (input: { cwd: string; name: string; globalDisabled?: boolean; projectDisabled?: boolean }) => __ipc("skills:pool-set", 1, [input]),
  setEnabledSkill: (input: { folder: string; enabled: boolean }) => __ipc("skills:set-enabled", 1, [input]),
  setEnabledSkillBatch: (input: { folders: string[]; enabled: boolean }) => __ipc("skills:set-enabled-batch", 1, [input]),
  /* 10-12 新增：把某个已装的市场技能重新拉取覆盖（复用市场安装链：下载/安检/解压/落盘/来源清单），再刷新 skills/list。folder = 技能目录名 */
  updateSkill: (folder: string) => __ipc("skills:update", 1, [folder]),
  /* 10-12 新增（用户要求「技能和插件加一个更新功能」）：技能市场**没有版本号** ⇒ 判据是**内容比对**（把市场当前的包下下来，与磁盘上已装的逐文件对齐，相对路径 + 内容 sha256，两侧同一函数）。三态：update / current / unresolved（市场搜不到、比对失败、或本地导入无市场来源）——⛔ unresolved 绝不演成 current */
  checkSkillUpdates: () => __ipc("skills:update-check", 0, []),
  /* 应用人格（slug=null 还原默认）：写 personalization.persona + 同步 $CODEX_HOME/AGENTS.md，新会话即生效 */
  applySoulMarket: (input: { slug: string | null }) => __ipc("soul-market:apply", 1, [input]),
  /* 当前生效人格（soulSlug 空 = 默认人格） */
  currentSoulMarket: () => __ipc("soul-market:current", 0, []),
  /* 人格详情（content = 完整中文人设） */
  getSoulMarket: (input: { slug: string }) => __ipc("soul-market:get", 1, [input]),
  /* SkillHub 人格市场（skillhub.cn/soul，16 套全量） */
  listSoulMarket: () => __ipc("soul-market:list", 0, []),
  deleteSshServers: (ids: string[]) => __ipc("ssh:delete", 1, [ids]),
  execSshCommand: (server: unknown, command: string) => __ipc("ssh:exec", 1, [{ server, command }]),
  exportSshServers: (servers: unknown[], includeSecrets: boolean) => __ipc("ssh:export", 1, [{ servers, includeSecrets }]),
  importSshServers: () => __ipc("ssh:import", 0, []),
  /* SSH 服务器连接管理：列表 CRUD、批量启停、连接测试、命令执行、交互式会话、导入导出 */
  listSshServers: () => __ipc("ssh:list", 0, []),
  saveSshServer: (server: unknown) => __ipc("ssh:save", 1, [server]),
  sshSessionClose: (sessionId: string) => __ipc("ssh:session-close", 1, [sessionId]),
  sshSessionOpen: (server: unknown, cols: number, rows: number) => __ipc("ssh:session-open", 1, [{ server, cols, rows }]),
  sshSessionResize: (sessionId: string, cols: number, rows: number) => __ipc("ssh:session-resize", 1, [{ sessionId, cols, rows }]),
  sshSessionWrite: (sessionId: string, data: string) => __ipc("ssh:session-write", 1, [{ sessionId, data }]),
  setSshServersEnabled: (ids: string[], enabled: boolean) => __ipc("ssh:set-enabled", 1, [{ ids, enabled }]),
  testSshServer: (server: unknown) => __ipc("ssh:test", 1, [server]),
  listSubAgents: () => __ipc("subagents:list", 0, []),
  removeSubAgent: (id: string) => __ipc("subagents:remove", 1, [id]),
  saveSubAgent: (input: unknown) => __ipc("subagents:save", 1, [input]),
  addTask: (input: { text: string; priority?: string }) => __ipc("tasks:add", 1, [input]),
  clearTasks: () => __ipc("tasks:clear", 0, []),
  deleteTask: (id: string) => __ipc("tasks:delete", 1, [id]),
  listTasks: () => __ipc("tasks:list", 0, []),
  updateTask: (input: { id: string; patch: unknown }) => __ipc("tasks:update", 1, [input]),
  /* 专家团历史委托记录（成员历史工作记录面板；主进程落盘，跨窗口一致） */
  listTeamRuns: (threadId: string) => __ipc("team-runs:list", 1, [threadId]),
  teamThreadsMap: () => __ipc("team-threads:map", 0, []),
  teamOfThread: (threadId: string) => __ipc("team-threads:team-of", 1, [threadId]),
  /* 进入团队模式（切团队记忆上游 + 接团队知识库） */
  teamEnter: (input?: { teamId?: string }) => __ipc("team:enter", 0, [input]),
  /* 退出团队模式（恢复个人知识库连接器） */
  teamExit: () => __ipc("team:exit", 0, []),
  /* 团队工作模式：我加入的团队 */
  teamList: () => __ipc("team:list", 0, []),
  /* 团队模式当前生效状态 */
  teamStatus: () => __ipc("team:status", 0, []),
  /* 上传本机文件到团队知识库（走云端计费与权限闸） */
  teamUpload: (input?: { paths?: string[] }) => __ipc("team:upload", 0, [input]),
  invokeTeamMember: (input: unknown) => __ipc("teams:invoke-member", 1, [input]),
  listExpertTeams: () => __ipc("teams:list", 0, []),
  startTeamMemberSession: (input: unknown) => __ipc("teams:member-session", 1, [input]),
  removeExpertTeam: (teamId: string) => __ipc("teams:remove", 1, [teamId]),
  resetExpertTeams: () => __ipc("teams:reset-defaults", 0, []),
  saveExpertTeam: (input: unknown) => __ipc("teams:save", 1, [input]),
  getTeamSessionConfig: (teamId: string) => __ipc("teams:session-config", 1, [teamId]),
  startTeamSession: (input: unknown) => __ipc("teams:start-session", 1, [input]),
  getTeamTools: (teamId: string) => __ipc("teams:tools", 1, [teamId]),
  telegramConnect: (token: string) => __ipc("telegram:connect", 1, [token]),
  telegramLogout: () => __ipc("telegram:logout", 0, []) as Promise<{ ok: boolean }>,
  telegramStatus: () => __ipc("telegram:status", 0, []) as Promise<{ bound: boolean }>,
  terminalInput: (id: string, data: string) => __ipc("terminal:input", 2, [id, data]),
  listTerminals: () => __ipc("terminal:list", 0, []),
  terminalReady: () => __ipc("terminal:ready", 0, []),
  terminalResize: (id: string, cols: number, rows: number) => __ipc("terminal:resize", 3, [id, cols, rows]),
  restartTerminal: (id: string, cwd?: string) => __ipc("terminal:restart", 1, [id, cwd]),
  themeApply: (theme: string) => __ipc("theme:apply", 1, [theme]),
  getThreadRuntime: (threadId: string) => __ipc("thread-runtime:get", 1, [threadId]),
  listThreadRuntimes: () => __ipc("thread-runtime:list", 0, []),
  /* 10-29 起不再有 takeover / 独占锁：写的就是本会话的模型/档位/权限/调度许可 */
  patchThreadRuntime: (input: { threadId: string; patch: unknown; baseRev?: number; takeover?: boolean }) => __ipc("thread-runtime:patch", 1, [input]),
  seedThreadRuntime: (input: { threadId: string; runtime: unknown }) => __ipc("thread-runtime:seed", 1, [input]),
  /* 会话备份：导出 = 打包引擎 rollout 原档 + 元信息为 .json；threadIds 缺省/空数组 = 全部 */
  exportThreadsBackup: (threadIds?: string[]) => __ipc("threads:export", 0, [threadIds ? { threadIds } : undefined]),
  /* 会话记录导出为通用 Markdown（主流 AI 可直接读取/带入）；threadIds 缺省/空数组 = 全部 */
  exportThreadsMarkdown: (threadIds?: string[]) => __ipc("threads:export-markdown", 0, [threadIds ? { threadIds } : undefined]),
  importThreadsBackup: () => __ipc("threads:import", 0, []),
  importConversationMarkdown: (input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }) => __ipc("threads:import-conversation", 0, [input]),
  /* ⛔ 09-23 补：以下方法 preload 里早就有、渲染层也在用，但这里一直没有签名 —— 渲染层从不跑 tsc ⇒ 静默漏网（gen-ipc-bridge 提取时暴露）。返回形状没把握的先 any。 */
  previewConversation: (threadId: string) => __ipc("threads:preview-conversation", 1, [threadId]),
  toolStatus: () => __ipc("tools:status", 0, []),
  updateCheck: () => __ipc("updates:check", 0, []),
  updateDownload: (input: { downloadUrl: string; filename?: string; mode?: "differential" | "full" }) => __ipc("updates:download", 1, [input]),
  /* 10-12 后台静默下载：地址只认主进程自己的检查结果，绝不接受渲染层指定；10-25 可选 mode 只决定补丁/完整包 */
  updateDownloadSilent: (input?: { mode?: "differential" | "full" }) => __ipc("updates:download-silent", 0, [input]),
  updateInstall: (filePath: string) => __ipc("updates:install", 1, [filePath]),
  /* 10-12 重启安装：零参数（先 spawn 已校验的安装包、再 quit 自己，顺序反了会被文件锁挡住） */
  updateRestartInstall: () => __ipc("updates:restart-install", 0, []),
  updateReveal: (filePath: string) => __ipc("updates:reveal", 1, [filePath]) as Promise<{ ok: boolean }>,
  getUsername: () => __ipc("user:name", 0, []),
  /* 主进程解密后直写剪贴板（明文不返回渲染层） */
  vaultCopy: (id: string) => __ipc("vault:copy", 1, [id]),
  /* 密码本列表（不含明文，只有 hasSecret） */
  vaultList: () => __ipc("vault:list", 0, []),
  vaultRemove: (id: string) => __ipc("vault:remove", 1, [id]),
  /* 保存/更新一条；password 省略=保留原密码 */
  vaultSave: (input: Record<string, unknown>) => __ipc("vault:save", 1, [input]),
  /* 按顺序合并视频片段成一条成片（整片导出）：先 -c copy，失败回落统一重编码；输出 <workspace>/.drama-canvas/export/ */
  videoConcat: (input: { workspace: string; name: string; files: string[]; width?: number; height?: number; fps?: number }) => __ipc("video:concat", 1, [input]) as Promise<{ path: string; bytes: number; mode: "copy" | "reencode"; parts: number }>,
  /* 各厂商凭证（userData/video-providers.json） */
  videoConfigRead: () => __ipc("video:config-read", 0, []) as Promise<Record<string, Record<string,string>>>,
  /* 保存某厂商的 API 凭证 */
  videoConfigSave: (input: { providerId: string; values: Record<string,string> }) => __ipc("video:config-save", 1, [input]) as Promise<{ ok: boolean; configured: boolean }>,
  /* 把产物视频拉回本地落 <workspace>/.drama-canvas/assets/（可信根校验） */
  videoDownload: (input: { url: string; workspace: string; name: string; subdir?: string; outputDir?: string }) => __ipc("video:download", 1, [input]) as Promise<{ path: string; bytes: number }>,
  /* 轮询任务状态（MiniMax 成功后自动两段式换下载地址） */
  videoPoll: (input: { providerId: string; jobId: string }) => __ipc("video:poll", 1, [input]) as Promise<{ status: string; url?: string; error?: string }>,
  /* 内置视频生成接口：国内外 8 家厂商清单 + 是否已配凭证（可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo） */
  videoProviders: () => __ipc("video:providers", 0, []) as Promise<{id:string;name:string;region:string;modes:string[];imageInput:string;fields:string[];models:string[];defaultModel:string;configured:boolean}[]>,
  /* 提交视频生成异步任务（i2v 时 image 可为本地路径/URL，主进程转 base64） */
  videoSubmit: (input: { providerId: string; mode: string; prompt: string; image?: string; model?: string; duration?: number; aspect?: string }) => __ipc("video:submit", 1, [input]) as Promise<{ jobId: string }>,
  /* 我是播报窗口吗 + 当前会话静音态（按 threadId 分开，别的会话停止不影响当前会话；取不到 owner 时保底 true） */
  announceOwner: (threadId?: string) => __ipc("voice:announce-owner", 0, [threadId]),
  /* 会话级静音闩锁（同一 threadId 的窗口一起安静；别的会话不受影响） */
  announceSetMuted: (input?: { muted?: boolean; threadId?: string }) => __ipc("voice:announce-set-muted", 0, [input]),
  voiceBarge: () => __ipc("voice:barge", 0, []) as Promise<{ ok: boolean }>,
  voiceDictationFinish: () => __ipc("voice:dictation-finish", 0, []),
  voiceEndpointNow: () => __ipc("voice:endpoint-now", 0, []),
  voiceHotkeyGet: () => __ipc("voice:hotkey-get", 0, []) as Promise<{ registered: string }>,
  voiceHotkeySet: (input: { accelerator: string; enabled?: boolean }) => __ipc("voice:hotkey-set", 1, [input]),
  voiceKwsCancel: () => __ipc("voice:kws-cancel", 0, []) as Promise<{ ok: boolean }>,
  voiceKwsInstall: () => __ipc("voice:kws-install", 0, []),
  voiceKwsStatus: () => __ipc("voice:kws-status", 0, []) as Promise<{ ready: boolean }>,
  voiceMicPermission: () => __ipc("voice:mic-permission", 0, []),
  voiceModelsCancel: () => __ipc("voice:models-cancel", 0, []) as Promise<{ ok: boolean }>,
  voiceModelsImport: (input: { sourceDir: string }) => __ipc("voice:models-import", 1, [input]),
  voiceModelsInstall: () => __ipc("voice:models-install", 0, []),
  voiceModelsReveal: () => __ipc("voice:models-reveal", 0, []) as Promise<string>,
  /* 10-03：新增 baseEnabled / 各资源 enabled —— 启用与已下载正交，UI 靠它们组合出四态 */
  voiceModelsStatus: () => __ipc("voice:models-status", 0, []),
  voiceModelsUninstall: () => __ipc("voice:models-uninstall", 0, []) as Promise<{ ok: boolean }>,
  voicePlaybackDone: () => __ipc("voice:playback-done", 0, []) as Promise<{ ok: boolean }>,
  voicePresetApply: (presetId: string) => __ipc("voice:preset-apply", 1, [presetId]),
  voicePresetList: () => __ipc("voice:preset-list", 0, []),
  voicePreviewVoice: (input?: { sid?: number; speed?: number; text?: string; profileId?: string; warm?: boolean; numSteps?: number }) => __ipc("voice:preview-voice", 0, [input]),
  /* 10-08 音色上传接口：source=base64/file 已实现；pack（音色包）**预留**、明确返回未开放。走与导入同一条草稿链（落盘→ASR 转写参考文本→用户校对） */
  voiceProfileUpload: (input?: { source?: "base64" | "file" | "pack"; name?: string; refText?: string; audioBase64?: string; sampleRate?: number }) => __ipc("voice:profile-upload", 0, [input]) as Promise<any>,
  voiceProfilesDelete: (id: string) => __ipc("voice:profiles-delete", 1, [id]) as Promise<{ ok: boolean }>,
  voiceProfilesImport: () => __ipc("voice:profiles-import", 0, []) as Promise<any>,
  voiceProfilesList: () => __ipc("voice:profiles-list", 0, []),
  voiceProfilesPreview: (input: { id?: string; text?: string }) => __ipc("voice:profiles-preview", 1, [input]) as Promise<any>,
  voiceProfilesRecord: (input: { samples: number[]; sampleRate: number }) => __ipc("voice:profiles-record", 1, [input]) as Promise<any>,
  voiceProfilesSave: (input: { draftFile: string; name: string; refText: string }) => __ipc("voice:profiles-save", 1, [input]) as Promise<any>,
  voiceProfilesSelect: (id: string) => __ipc("voice:profiles-select", 1, [id]),
  /* 10-03 按资源删除（物理删文件，渲染层二次确认） */
  voiceResourceDelete: (input: { kind: string }) => __ipc("voice:resource-delete", 1, [input]) as Promise<{ ok: boolean; error?: string }>,
  /* 10-03 资源停用/启用（不删文件，可逆） */
  voiceResourceSetEnabled: (input: { kind: string; enabled: boolean }) => __ipc("voice:resource-set-enabled", 1, [input]) as Promise<{ ok: boolean; error?: string; enabled?: boolean }>,
  /* 10-03 单个资源的启用状态与占用 */
  voiceResourceStatus: (input: { kind: string }) => __ipc("voice:resource-status", 1, [input]) as Promise<any>,
  voiceSettingsGet: () => __ipc("voice:settings-get", 0, []),
  voiceSettingsSet: (patch: any) => __ipc("voice:settings-set", 1, [patch]),
  voiceSpeak: (text: string, options?: { sid?: number; speed?: number }) => __ipc("voice:speak", 1, [text, options]),
  voiceStart: (threadId: string, options?: { mode?: "conversation" | "dictation" }) => __ipc("voice:start", 1, [threadId, options]),
  voiceStatus: () => __ipc("voice:status", 0, []),
  voiceStop: () => __ipc("voice:stop", 0, []) as Promise<{ ok: boolean }>,
  /* 10-26 取消当前引擎包下载 */
  voiceTtsPackCancel: () => __ipc("voice:tts-pack-cancel", 0, []) as Promise<any>,
  /* 10-26 可选合成引擎包（kokoro / emotivoice）按需下载；进度事件 voice:event 带 target=pack */
  voiceTtsPackInstall: (pack: string) => __ipc("voice:tts-pack-install", 1, [pack]) as Promise<any>,
  voiceWakeAudio: (samples: Float32Array) => __ipc("voice:wake-audio", 1, [samples]),
  voiceWakeReset: () => __ipc("voice:wake-reset", 0, []) as Promise<{ ok: boolean }>,
  voiceWakeStart: () => __ipc("voice:wake-start", 0, []),
  voiceWakeStop: () => __ipc("voice:wake-stop", 0, []) as Promise<{ ok: boolean }>,
  voiceZipvoiceCancel: () => __ipc("voice:zipvoice-cancel", 0, []) as Promise<{ ok: boolean }>,
  voiceZipvoiceInstall: () => __ipc("voice:zipvoice-install", 0, []),
  wecomWebhookConnect: (url: string) => __ipc("wecom-webhook:connect", 1, [url]),
  wecomWebhookLogout: () => __ipc("wecom-webhook:logout", 0, []) as Promise<{ ok: boolean }>,
  wecomWebhookTest: (text?: string) => __ipc("wecom-webhook:test", 0, [text]),
  weixinCancelLogin: () => __ipc("weixin:cancel-login", 0, []) as Promise<{ ok: boolean }>,
  weixinLogout: () => __ipc("weixin:logout", 0, []) as Promise<{ ok: boolean }>,
  weixinPollLogin: () => __ipc("weixin:poll-login", 0, []),
  /* 主动推送一条微信消息给用户（to 缺省=最近对话用户）。⛔ 正文气泡依赖 context_token，对方近期发过消息才最可靠；机器人未登录时抛错 */
  weixinSend: (input: { to?: string; text: string }) => __ipc("weixin:send", 1, [input]) as Promise<{ ok: boolean }>,
  weixinStartLogin: () => __ipc("weixin:start-login", 0, []),
  weixinStatus: () => __ipc("weixin:status", 0, []) as Promise<{ bound: boolean }>,
  /* 「知道了」：记下「当前版本已看过」（⛔ 只接受当前版本号 —— 权威值在主进程，渲染层传别的值会被拒） */
  whatsNewAck: (version: string) => __ipc("whatsnew:ack", 1, [version]),
  /* 全量版本要点（新手引导 → 版本更新日志用）：数据同 whats-new-notes.ts 单一真相源；GitHub Release 链接在主进程拼好 */
  whatsNewHistory: () => __ipc("whatsnew:history", 0, []),
  /* 更新后首次启动的「新功能介绍」—— 该不该弹、弹什么由主进程判定（要点在 electron/whats-new-notes.ts，看过记录在 userData/whats-new.json） */
  whatsNewState: () => __ipc("whatsnew:state", 0, []),
  popoutClose: (threadId: string | null) => __ipc("window:popout-close", 1, [threadId]),
  popoutThreadId: () => __ipc("window:popout-id", 0, []),
  popoutList: () => __ipc("window:popout-list", 0, []),
  popoutThread: (threadId: string) => __ipc("window:popout-thread", 1, [threadId]),
  /* 删工作日志文件（销毁性，不会重建）：只删 .codex-harness/memory 之下的普通文件；目录、越界路径一律拒绝 */
  workLogsDelete: (input: { paths: string[] }) => __ipc("work-logs:delete", 1, [input]),
  /* 读一份工作日志/记忆文件的正文（UI 内查看）。路径必须落在某个项目的 .codex-harness/memory 之下；>512KB 拒绝（提示去文件管理器打开） */
  workLogsRead: (input: { path: string }) => __ipc("work-logs:read", 1, [input]),
  /* 扫各项目的**工作日志与项目记忆**（<项目>/.codex-harness/memory/**：长期记忆 / 坑与纪律 / logs 日报 / archive / project）。项目清单来自 rollout 扫出的 cwd 集合。⛔ 这是项目里的工作记录，与会话本身的归档 / 删除（「归档管理」页）不是一回事 */
  workLogsScan: () => __ipc("work-logs:scan", 0, []),
  /* 输入框竖条 + 功能入口菜单的可扩展目录（内置 + userData/extensions.json） */
  extensionsCatalog: () => __ipc("extensions:catalog", 0, []),
  /* 聚合读取：应用内键（shortcuts.json）+ 截图/语音键（各自真存储） */
  shortcutsRead: () => __ipc("shortcuts:read", 0, []),
  /* 只写应用内键；截图/语音由各自通道写（先注册成功再落盘） */
  shortcutsSave: (input: { bindings?: Record<string, string[]> } = {}) => __ipc("shortcuts:save", 0, [input]),
  /* 恢复默认：删 shortcuts.json（截图/语音不动） */
  shortcutsReset: () => __ipc("shortcuts:reset", 0, []),
  /* 读某会话的授权（默认全关） */
  dataaccessState: (threadId: string) => __ipc("dataaccess:state", 1, [threadId]),
  /* 设一个三元组（会话+模块+读/写）；只在内存，退出即失效 */
  dataaccessGrant: (input: { threadId: string; module: string; level: string; on: boolean }) => __ipc("dataaccess:grant", 1, [input]),
  /* 撤销某会话的全部授权 */
  dataaccessRevokeAll: (threadId: string) => __ipc("dataaccess:revoke-all", 1, [threadId]),
  /* 模型工具：读收藏夹（需 favorites/read） */
  dataaccessFavoritesList: (input: { threadId: string; query?: string; limit?: number }) => __ipc("dataaccess:favorites-list", 1, [input]),
  /* 模型工具：追加一条收藏（需 favorites/write；⛔ 不能改/删已有） */
  dataaccessFavoritesAppend: (input: { threadId: string; title?: string; content: string; kind?: string; note?: string; tags?: string[] }) => __ipc("dataaccess:favorites-append", 1, [input]),
  /* 模型工具：读某天日记全文（需 journal/read） */
  dataaccessJournalRead: (input: { threadId: string; date?: string }) => __ipc("dataaccess:journal-read", 1, [input]),
  /* 模型工具：全文检索日记（需 journal/read） */
  dataaccessJournalSearch: (input: { threadId: string; query: string }) => __ipc("dataaccess:journal-search", 1, [input]),
  /* 模型工具：追加一条日记（需 journal/write；⛔ 只追加不改历史） */
  dataaccessJournalAppend: (input: { threadId: string; date?: string; title?: string; body: string }) => __ipc("dataaccess:journal-append", 1, [input]),
  /* 模型工具：密码本存在性查询（需 vault/read；⛔ 永不回明文） */
  dataaccessVaultFind: (input: { threadId: string; query?: string }) => __ipc("dataaccess:vault-find", 1, [input]),
  /* 模型工具：把密码复制到剪贴板（需 vault/read；⛔ 返回体无明文） */
  dataaccessVaultCopy: (input: { threadId: string; id: string }) => __ipc("dataaccess:vault-copy", 1, [input]),
  /* 模型工具：写入密码本（需 vault/write + 渲染层一次性确认） */
  dataaccessVaultSave: (input: { threadId: string; item: Record<string, unknown> }) => __ipc("dataaccess:vault-save", 1, [input]),
  /* 清内置浏览器（persist:harness-browser）的登录态/缓存；kind=all 连缓存一起清 */
  browserClearData: (kind?: string) => __ipc("browser:clear-data", 0, [kind]),
  /* 为会话建专属工作区 <project>/.codex-harness/sessions/<threadId>（幂等） */
  sessionspaceEnsure: (threadId: string, projectRoot: string) => __ipc("sessionspace:ensure", 2, [threadId, projectRoot]),
  /* 查某会话的工作区记录 */
  sessionspaceState: (threadId: string) => __ipc("sessionspace:state", 1, [threadId]),
  /* 列全部会话工作区记录 */
  sessionspaceList: () => __ipc("sessionspace:list", 0, []),
  /* 改状态 active/archived（删除走 remove） */
  sessionspaceSetState: (threadId: string, state: string) => __ipc("sessionspace:set-state", 2, [threadId, state]),
  /* 删会话工作区（目录+记录）；有安全闸，只删 sessions 下本进程算出的路径 */
  sessionspaceRemove: (threadId: string) => __ipc("sessionspace:remove", 1, [threadId]),
  /* 收口孤儿：记录在目录不在 / orphan 重试 / 目录在记录不在（后者超 maxAgeDays 才删） */
  sessionspaceGc: (options?: { maxAgeDays?: number; dryRun?: boolean }) => __ipc("sessionspace:gc", 0, [options]),
  /* 10-29 飞书官方 CLI（@larksuite/cli）状态：是否安装 / 是否配置应用 / 是否已登录 */
  feishuCliStatus: () => __ipc("feishu-cli:status", 0, []),
  /* 创建/绑定飞书应用：后台跑 lark-cli config init --new，返回授权链接 */
  feishuCliSetupStart: () => __ipc("feishu-cli:setup-start", 0, []),
  /* 用户登录 device flow：auth login --recommend --no-wait --json 拿链接，后台用 --device-code 完成 */
  feishuCliLoginStart: () => __ipc("feishu-cli:login-start", 0, []),
  feishuCliLogout: () => __ipc("feishu-cli:logout", 0, []),
  /* 取消本次授权：杀掉挂在后台的 config init / device-code 轮询进程 */
  feishuCliCancel: () => __ipc("feishu-cli:cancel", 0, []),
  /* Codex 工具 feishu_cli 的执行端：参数数组直传 lark-cli（⛔ 不过 shell） */
  feishuCliRun: (input: unknown) => __ipc("feishu-cli:run", 1, [input]),
  /* ═══ gen:end ═══ */

  /* 桌面宠物：主进程归约好的九态推送（浮窗订阅它驱动动画；首帧另用 petState() 补水）。
     ⛔ 走 __on 而不是裸 ipcRenderer.on：退订按函数引用精确移除，重复挂载幂等。 */
  onPetSignal: (listener: (signal: unknown) => void) =>
    __on("pet:signal", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
  /* 桌面宠物：**配置**推送（当前宠物包 + 设置）。换宠物 / 改缩放时主进程推它，
     否则已开着的浮窗还画着旧宠物（它只在挂载时读一次设置）。 */
  onPetConfig: (listener: (config: unknown) => void) =>
    __on("pet:config", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
  /* 桌面宠物：主进程按光标轮询推来的「指针是否在宠物本体/工具栏内」。
     ⛔ 不能只靠 pointerleave：移出可交互矩形后窗口切成穿透，页面收不到 leave（工具栏会永久挂着）。 */
  onPetHover: (listener: (inside: boolean) => void) =>
    __on("pet:hover", listener, (listener) => (_e: unknown, inside: unknown) => listener(Boolean(inside))),

  // ⛔ mac 适配（09-16）：渲染层此前完全不知道自己跑在什么平台——窗口控制键让位、
  // 平台差异 UI 全靠这个字段。sandboxed preload 里 process.platform 可用。
  platform: process.platform,
onRuntimeProgress: (listener: (event: unknown) => void) =>
    __on("runtime:progress", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
  /* 记忆后端 / 云端开通状态变化推送（10-20）：主进程在**变化点**广播
     （切后端、确认开通、登录/登出/换账号），界面订阅后重新读一次状态。
     ⛔ 不在这里判定任何东西 —— payload 就是 readMemoryBackend() 的同一份快照。 */
  onMemoryBackendChanged: (listener: (status: unknown) => void) =>
    __on("memory:backend-changed", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
  /* 播报归属推送（voice 域，10-21）：多窗口时**逐窗口定制**发送 —— payload 里的 `owner`
     已经是「本窗口是不是播报窗口」，渲染层不需要（也拿不到）自己的 webContents.id。
     触发点：焦点切换 / 窗口增减。推送类手写桥，不在 gen 段。 */
  onAnnounceOwnerChanged: (listener: (state: { owner: boolean; reason: string }) => void) =>
    __on("voice:announce-owner-changed", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { owner: boolean; reason: string })),
  /* 全局静音闩锁推送（10-21）：任一窗口按「停止播报」⇒ 全窗口静默（一个扬声器一个用户）。
     ⛔ 与本地 mutedRef 的区别：这条是**跨窗口事实**，收到就要真的拦，不能只当提示。 */
  onAnnounceMuted: (listener: (state: { muted: boolean }) => void) =>
    __on("voice:announce-muted", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { muted: boolean })),
  /* 通话状态推送（10-21，**所有窗口**）：`voice:event` 只发主窗口，弹窗靠这条知道
     「主窗口在通话」⇒ 非通话播报必须避让（否则两条音轨抢同一个扬声器）。 */
  onVoiceCallState: (listener: (state: { state: string; active: boolean }) => void) =>
    __on("voice:call-state", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { state: string; active: boolean })),
  /* 3D 预览弹窗打开推送（model-viewer 域，10-05）：引擎 harness_tools preview_3d → 主进程
     sendToWindow("model-viewer:open") → 渲染层 ModelViewerBridge 弹窗。推送类手写桥，不在 gen 段。 */
  onModelViewerOpen: (listener: (event: { path: string; title: string }) => void) =>
    __on("model-viewer:open", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { path: string; title: string })),
  /* 媒体预览推送（media 域，10-20）：引擎 harness_tools 的 media_source_open（m3u8）→ 主进程
     sendToWindow("media-preview:open") → 渲染层 MediaPreviewBridge。推送类手写桥，不在 gen 段。 */
  onMediaPreviewOpen: (listener: (event: { source: string; kind?: "video" | "audio" | "model"; title?: string; poster?: string; autoPlay?: boolean }) => void) =>
    __on("media-preview:open", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { source: string; kind?: "video" | "audio" | "model"; title?: string; poster?: string; autoPlay?: boolean })),
  /* 图像工坊浮层推送（image-lab 域，10-09）：引擎 harness_tools 的 image_generate / image_edit /
     image_view → 主进程 pushImageLabEvent（sendToWindow "image-lab:event"）→ 渲染层 ImageLabBridge。
     单通道三态（open 弹出 / update 换状态与图 / close 收起）。推送类手写桥，不在 gen 段。 */
  onImageLabEvent: (listener: (event: { phase: "open" | "update" | "close"; taskId: string; mode?: "generate" | "edit"; title?: string; status?: "running" | "done" | "error"; images?: string[]; note?: string }) => void) =>
    __on("image-lab:event", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { phase: "open" | "update" | "close"; taskId: string; mode?: "generate" | "edit"; title?: string; status?: "running" | "done" | "error"; images?: string[]; note?: string })),
  /* 壁纸应用推送（wallpaper 域，10-06）：引擎 harness_tools wallpaper_set → 主进程校验 →
     sendToWindow("wallpaper:apply") → 渲染层 saveWallpaper（与设置页同一条链路）。 */
  onWallpaperApply: (listener: (event: { mode: string; pattern: string; opacity: number; image: string }) => void) =>
    __on("wallpaper:apply", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { mode: string; pattern: string; opacity: number; image: string })),
  /* ⛔ 这两处原先用 `removeAllListeners(channel)` 退订 —— 会把**同一通道上别人的监听一起清掉**
     （多订阅者场景下的真 bug）。改走 __on：按监听函数引用精确退订，重复注册幂等。 */
onRemotePairRequest: (handler: (request: { rid: string; deviceId: string; name: string }) => void) =>
    __on("remote:pair-request", handler, (handler) => (_event, request) => handler(request)),
onBotPairRequest: (handler: (request: { rid: string; channel: string; chatId: string; name: string }) => void) =>
    __on("bot:pair-request", handler, (handler) => (_event, request) => handler(request)),
/* 关闭确认弹窗（10-13）：主进程拦截 X 后把「要不要关」推给渲染层（应用内卡片，替代原生系统框） */
onCloseConfirmAsk: (handler: (payload: { busy: number; appName: string }) => void) =>
    __on("close-confirm:ask", handler, (handler) => (_e: unknown, payload: { busy: number; appName: string }) => handler(payload)),
onRemoteCommand: (listener: (cmd: string) => void) =>
    __on("remote:command", listener, (listener) => (_e: any, cmd: string) => listener(cmd)),
onRemoteDevice: (listener: (device: { id: string; name: string }) => void) =>
    __on("remote:device", listener, (listener) => (_e: any, device: { id: string; name: string }) => listener(device)),
onConnectorOAuth: (listener: (event: unknown) => void) =>
    __on("connectors:oauth-event", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
  // 粘贴的长文本落盘成 .txt（超过阈值时输入框显示为文件 chip，见 composer-attachments.mjs）
  updateOnProgress: (callback: (percent: number) => void) => {
    __on("updates:download-progress", callback, (callback) => (_event: unknown, percent: number) => callback(percent));
  },
  // ⛔ 10-12：后台静默下载完成事件。渲染层可能压根没开设置页，只能靠事件弹窗。
  updateOnReady: (callback: (info: { version?: string; path?: string }) => void) => {
    __on("updates:ready", callback, (callback) => (_event: unknown, payload: { version?: string; path?: string }) => callback(payload ?? {}));
  },
onSshData: (listener: (payload: { data: string }) => void) =>
    __on("ssh:data", listener, (listener) => (_event: Electron.IpcRendererEvent, payload: { data: string }) => listener(payload)),
onSshExit: (listener: (payload: { code?: number; signal?: string; error?: string }) => void) =>
    __on("ssh:exit", listener, (listener) => (_event: Electron.IpcRendererEvent, payload: { code?: number; signal?: string; error?: string }) => listener(payload)),
  // 协议桥状态：引擎只发 Responses，若上游只支持 Chat Completions 则由桥本地转换（详见 electron/responses-bridge.ts）
onTerminalData: (listener: (id: string, data: string) => void) =>
    __on("terminal:data", listener, (listener) => (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => listener(payload.id, payload.data)),
  // 「当前能力链路」快照：同一件事多个后端时现在实际走哪条、其余为什么没走

  onEngineRestartDeferred: (listener: (event: { waiting: boolean; reason?: string; activeTurns?: number }) => void) => {
    const deferred = (_e: unknown, payload: any) => listener({ waiting: true, reason: payload?.reason, activeTurns: payload?.activeTurns });
    const flushed = (_e: unknown, payload: any) => listener({ waiting: false, reason: payload?.reason });
    ipcRenderer.on("engine:restart-deferred", deferred);
    ipcRenderer.on("engine:restart-flushed", flushed);
    return () => {
      ipcRenderer.removeListener("engine:restart-deferred", deferred);
      ipcRenderer.removeListener("engine:restart-flushed", flushed);
    };
  },
onEngineUpdateProgress: (listener: (event: unknown) => void) =>
    __on("engine:update:progress", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)),
  /* 截图完成：渲染层唯一插入路径（成功截图必走此事件，避免与 invoke 返回值双插） */
  onScreenshotCaptured: (listener: (event: unknown) => void) =>
    __on("screenshot:captured", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)),
onEvent: (listener: (event: unknown) => void) =>
    __on("codex:event", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)),
onChannelBotEvent: (listener: (event: unknown) => void) =>
    __on("channel-bot:event", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)),
onBotBindingChanged: (handler: (bindings: unknown) => void) =>
    __on("bot-binding:changed", handler, (handler) => (_event: Electron.IpcRendererEvent, value: unknown) => handler(value)),
onHarnessEvent: (listener: (event: unknown) => void) =>
    __on("harness:event", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)),
  /* 主题变更广播（10-16）：主进程 theme:apply 之后推给**所有窗口** ——
     独立会话弹窗的界面主题因此实时跟随主界面（用户令「独立窗口的主题色要跟着主界面变」）。
     渲染层在 01-thread-switch-system-events 里订阅。事件通道不进 manifest（见 manifest 顶部注释）。 */
  onThemeChanged: (listener: (theme: string) => void) =>
    __on("theme:changed", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(String(value ?? ""))),
  // ---- 语音通话（旁挂新增，不影响任何既有方法） ----
voiceAudio: (samples: Float32Array) => ipcRenderer.send("voice:audio", samples),
  // 排队消息定时发送到点：主进程定时器广播（不受渲染层隐藏节流），渲染层据此启动那条排队消息
onQueueTimerDue: (listener: (event: { threadId: string; queuedSubmissionId: string }) => void) =>
    __on("queue-timer:due", listener, (listener) => (_event: Electron.IpcRendererEvent, value: { threadId: string; queuedSubmissionId: string }) => listener(value)),
  // TTS 音频走 Base64 字符串跨 Electron IPC；避免 native/external ArrayBuffer 被 structured clone 拒绝。
onVoiceEvent: (listener: (event: unknown) => void) =>
    __on("voice:event", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)),
  // 语音通话「按键启动」：全局快捷键（即便应用没聚焦也能唤起）
onVoiceHotkey: (listener: (event: { accelerator: string }) => void) =>
    __on("voice:hotkey", listener, (listener) => (_event: Electron.IpcRendererEvent, value: { accelerator: string }) => listener(value)),
  // 语音唤醒：持续聆听 + 文本匹配唤醒词（会持续占用 CPU）
});
