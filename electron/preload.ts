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
  request: (method: string, params: unknown = {}) => __ipc("codex:request", 1, [method, params]),
  respond: (id: string | number, result: unknown) => __ipc("codex:respond", 2, [id, result]),
  getUsername: () => __ipc("user:name", 0, []),
  getUserData: () => __ipc("app:userData", 0, []),
  setAwake: (on: boolean) => __ipc("awake:set", 1, [on]),
  showNotification: (title: string, body: string) => __ipc("notify:show", 2, [title, body]),
  toolStatus: () => __ipc("tools:status", 0, []),
  listRuntimes: () => __ipc("runtime:list", 0, []),
  openInCloakBrowser: (url: string) => __ipc("browser:open-cloak", 1, [url]),
  cloakBrowserStatus: () => __ipc("browser:cloak-status", 0, []),
  remoteStart: () => __ipc("remote:start", 0, []),
  remoteStatus: () => __ipc("remote:status", 0, []),
  remoteDevices: () => __ipc("remote:devices", 0, []),
  remoteSend: (cmd: string) => __ipc("remote:send", 1, [cmd]),
  remoteStop: () => __ipc("remote:stop", 0, []),
  remoteQrcode: (botId?: string) => __ipc("remote:qrcode", 0, [botId]),
  remotePairState: () => __ipc("remote:pair-state", 0, []),
  remotePairRotate: () => __ipc("remote:pair-rotate", 0, []),
  remoteApprove: (rid: string) => __ipc("remote:approve", 1, [rid]),
  remoteDeny: (rid: string) => __ipc("remote:deny", 1, [rid]),
  remoteRevoke: (deviceId: string) => __ipc("remote:revoke", 1, [deviceId]),
  botPairState: () => __ipc("bot:pair-state", 0, []),
  botApprove: (rid: string) => __ipc("bot:approve", 1, [rid]),
  botDeny: (rid: string) => __ipc("bot:deny", 1, [rid]),
  botRevoke: (key: string) => __ipc("bot:revoke", 1, [key]),
  botBindQrcode: (botId: string, botName: string) => __ipc("bot:bind-qrcode", 2, [botId, botName]),
  botBindStatus: (code: string) => __ipc("bot:bind-status", 1, [code]),
  botBindConsume: (code: string) => __ipc("bot:bind-consume", 1, [code]),
  weixinStatus: () => __ipc("weixin:status", 0, []) as Promise<{ bound: boolean }>,
  weixinCancelLogin: () => __ipc("weixin:cancel-login", 0, []) as Promise<{ ok: boolean }>,
  weixinLogout: () => __ipc("weixin:logout", 0, []) as Promise<{ ok: boolean }>,
  telegramLogout: () => __ipc("telegram:logout", 0, []) as Promise<{ ok: boolean }>,
  feishuLogout: () => __ipc("feishu:logout", 0, []) as Promise<{ ok: boolean }>,
  dingtalkLogout: () => __ipc("dingtalk:logout", 0, []) as Promise<{ ok: boolean }>,
  qqQrCancel: () => __ipc("qq:qr-cancel", 0, []) as Promise<{ ok: boolean }>,
  qqLogout: () => __ipc("qq:logout", 0, []) as Promise<{ ok: boolean }>,
  feishuQrCancel: () => __ipc("feishu:qr-cancel", 0, []) as Promise<{ ok: boolean }>,
  wecomWebhookLogout: () => __ipc("wecom-webhook:logout", 0, []) as Promise<{ ok: boolean }>,
  botsGet: () => __ipc("bots:get", 0, []) as Promise<any[]>,
  homeDir: () => __ipc("app:home-dir", 0, []) as Promise<string>,
  telegramStatus: () => __ipc("telegram:status", 0, []) as Promise<{ bound: boolean }>,
  ponytailModeGet: () => __ipc("ponytail:mode:get", 0, []) as Promise<string>,
  ponytailModeSet: (mode: string) => __ipc("ponytail:mode:set", 1, [mode]) as Promise<{ mode: string }>,
  writeFile: (path: string, content: string, root: string) => __ipc("fs:write", 3, [{ path, content, root }]),
  readFile: (path: string) => __ipc("fs:read", 1, [{ path }]),
  fileExists: (path: string) => __ipc("fs:exists", 1, [{ path }]),
  chooseDirectory: () => __ipc("dialog:directory", 0, []),
  chooseImages: () => __ipc("dialog:images", 0, []),
  chooseFiles: () => __ipc("dialog:files", 0, []),
  importSkill: () => __ipc("skills:import", 0, []),
  listMarketSkills: (input: unknown = {}) => __ipc("skills:market-list", 0, [input]),
  installMarketSkill: (skill: unknown) => __ipc("skills:market-install", 1, [skill]),
  /* 10-03：逐项 installed 之外另给**全量已装 slug 清单**（不分页），供渲染层把「引擎没认领但文件已落盘」的插件补进「已安装」列表 */
  listMarketPlugins: (input: unknown = {}) => __ipc("plugins:market-list", 0, [input]),
  installMarketPlugin: (plugin: unknown) => __ipc("plugins:market-install", 1, [plugin]),
  /* 10-03：本地市场插件卸载（先请引擎 plugin/uninstall，再删落盘目录 + 摘 marketplace 清单；删除目标经 safeFolder 归一 + 目录内校验） */
  uninstallMarketPlugin: (slug: unknown) => __ipc("plugins:market-uninstall", 1, [slug]),
  /* 10-03：本地已装市场插件清单（**只扫本地目录、零网络**；供「已安装」列表补齐引擎没认领的那批 —— 不能走 market-list，那条会拉远端 48 个插件） */
  listInstalledMarketPlugins: () => __ipc("plugins:market-installed", 0, []),
  listLocalSkills: () => __ipc("skills:local-list", 0, []),
  setEnabledSkill: (input: { folder: string; enabled: boolean }) => __ipc("skills:set-enabled", 1, [input]),
  setEnabledSkillBatch: (input: { folders: string[]; enabled: boolean }) => __ipc("skills:set-enabled-batch", 1, [input]),
  /* 共享技能池（09-27）：按项目查看/管理全局技能生效集 */
  describeSkillPool: (input: { cwd: string }) => __ipc("skills:pool-describe", 1, [input]),
  /* 设置全局停用/本项目禁用并立即投影 */
  setSkillPoolState: (input: { cwd: string; name: string; globalDisabled?: boolean; projectDisabled?: boolean }) => __ipc("skills:pool-set", 0, [input]),
  /* 内置技能的独立开关（10-06）：读某内置技能**全局**是否生效（设置 → 控制台用；与 skill-pool 同一真相源） */
  getBuiltinSkillSwitch: (input: { name: string }) => __ipc("skills:builtin-switch-get", 1, [input]),
  /* 开关内置技能的**全局**生效态并立即投影磁盘（cwd 可空；只动全局集，不改项目集） */
  setBuiltinSkillSwitch: (input: { name: string; enabled: boolean; cwd?: string }) => __ipc("skills:builtin-switch-set", 0, [input]),
  setPluginEnabled: (input: { pluginIds: string[]; enabled: boolean }) => __ipc("plugins:set-enabled", 1, [input]),
  removeLocalSkill: (input: { folder: string; name?: string }) => __ipc("skills:local-remove", 0, [input]),
  trustHooks: (cwds?: string[]) => __ipc("hooks:trust", 0, [{ cwds }]),
  setHookEnabled: (input: { hookKeys: string[]; enabled: boolean }) => __ipc("hooks:set-enabled", 1, [input]),
  /* 09-24 新增：顶栏 🔍 历史会话搜索。扫 codex-home rollout 原档（sessions/** + archived_sessions/**）搜对话内容；先 indexOf 快速否决再解析，>32MB 跳过并计数 */
  searchHistory: (input?: { query?: string; limit?: number }) => __ipc("history:search", 0, [input]),
  setPluginLinkedEnabled: (input: { pluginId: string; enabled: boolean }) => __ipc("plugins:set-linked-enabled", 1, [input]),
  listConnectors: () => __ipc("connectors:list", 0, []),
  listConnectorTemplates: () => __ipc("connectors:templates", 0, []),
  saveConnector: (input: unknown) => __ipc("connectors:save", 1, [input]),
  removeConnector: (id: string) => __ipc("connectors:remove", 1, [id]),
  setConnectorsEnabled: (ids: string[], enabled: boolean) => __ipc("connectors:set-enabled", 2, [{ ids, enabled }]),
  startConnectorOAuth: (input: unknown) => __ipc("connectors:oauth-start", 1, [input]),
  cancelConnectorOAuth: (templateId: string) => __ipc("connectors:oauth-cancel", 1, [templateId]),
  readClipboardImage: () => __ipc("clipboard:image", 0, []),
  /* app-server 直管 MCP 的启用覆盖表；没记过的一律视为启用 */
  readMcpServerOverrides: () => __ipc("mcp-servers:overrides", 0, []),
  /* 统一入口：名字能匹配连接器的走连接器，其余走覆盖表；每次改动都会重启引擎 */
  setMcpServersEnabled: (ids: string[], enabled: boolean) => __ipc("mcp-servers:set-enabled", 2, [{ ids, enabled }]),
  /* 各 MCP 服务器的按工具权限档位：{ 服务器: { 工具: "deny"|"ask"|"allow" } } */
  readMcpToolPermissions: () => __ipc("mcp-servers:permissions", 0, []),
  /* 设置/清除某个 MCP 工具的权限档位；mode 传 null 清除。改动后引擎重启生效 */
  setMcpToolPermission: (server: string, tool: string, mode: "deny" | "ask" | "allow" | null) => __ipc("mcp-servers:set-tool-permission", 3, [{ server, tool, mode }]),
  readPersonalization: () => __ipc("personalization:read", 0, []),
  savePersonalization: (input: { nickname?: string; customInstructions?: string }) => __ipc("personalization:save", 0, [input]),
  /* 数据目录（userData）现状：生效值 / 默认锚点 / 自定义值 / 待迁移标记 / 迁移进度 */
  readDataDir: () => __ipc("dataDir:read", 0, []),
  /* 写指路牌并就地完成基础迁移（异步分批 + 进度）；重启后只做秒级增量同步。重启复用既有 app:relaunch */
  prepareDataDir: (dir: string) => __ipc("dataDir:prepare", 1, [dir]),
  /* 应用级运行时开关（联网搜索等） */
  readAppSettings: () => __ipc("appSettings:read", 0, []),
  saveAppSettings: (patch: { webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy" }) => __ipc("appSettings:save", 0, [patch]),
  themeApply: (theme: string) => __ipc("theme:apply", 1, [theme]),
  updateReveal: (filePath: string) => __ipc("updates:reveal", 1, [filePath]) as Promise<{ ok: boolean }>,
  /* SSH 服务器连接管理：列表 CRUD、批量启停、连接测试、命令执行、交互式会话、导入导出 */
  listSshServers: () => __ipc("ssh:list", 0, []),
  saveSshServer: (server: unknown) => __ipc("ssh:save", 1, [server]),
  testSshServer: (server: unknown) => __ipc("ssh:test", 1, [server]),
  execSshCommand: (server: unknown, command: string) => __ipc("ssh:exec", 2, [{ server, command }]),
  deleteSshServers: (ids: string[]) => __ipc("ssh:delete", 1, [ids]),
  setSshServersEnabled: (ids: string[], enabled: boolean) => __ipc("ssh:set-enabled", 2, [{ ids, enabled }]),
  sshSessionOpen: (server: unknown, cols: number, rows: number) => __ipc("ssh:session-open", 3, [{ server, cols, rows }]),
  sshSessionWrite: (sessionId: string, data: string) => __ipc("ssh:session-write", 2, [{ sessionId, data }]),
  sshSessionResize: (sessionId: string, cols: number, rows: number) => __ipc("ssh:session-resize", 3, [{ sessionId, cols, rows }]),
  sshSessionClose: (sessionId: string) => __ipc("ssh:session-close", 1, [sessionId]),
  exportSshServers: (servers: unknown[], includeSecrets: boolean) => __ipc("ssh:export", 2, [{ servers, includeSecrets }]),
  importSshServers: () => __ipc("ssh:import", 0, []),
  /* 会话备份：导出 = 打包引擎 rollout 原档 + 元信息为 .json；threadIds 缺省/空数组 = 全部 */
  exportThreadsBackup: (threadIds?: string[]) => __ipc("threads:export", 0, [threadIds ? { threadIds } : undefined]),
  /* 会话记录导出为通用 Markdown（主流 AI 可直接读取/带入）；threadIds 缺省/空数组 = 全部 */
  exportThreadsMarkdown: (threadIds?: string[]) => __ipc("threads:export-markdown", 0, [threadIds ? { threadIds } : undefined]),
  /* ⛔ 09-23 补：以下方法 preload 里早就有、渲染层也在用，但这里一直没有签名 —— 渲染层从不跑 tsc ⇒ 静默漏网（gen-ipc-bridge 提取时暴露）。返回形状没把握的先 any。 */
  previewConversation: (threadId: string) => __ipc("threads:preview-conversation", 1, [threadId]),
  importThreadsBackup: () => __ipc("threads:import", 0, []),
  importConversationMarkdown: (input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }) => __ipc("threads:import-conversation", 0, [input]),
  chooseSshKey: (startPath?: string) => __ipc("dialog:ssh-key", 0, [startPath]),
  saveFileAs: (sourcePath: string) => __ipc("dialog:save-as", 1, [sourcePath]),
  /* 仅更新称呼：写 personalization.json + AGENTS.md，不重启引擎 */
  setNickname: (nickname: string) => __ipc("personalization:setNickname", 1, [nickname]),
  verifyPersonalization: () => __ipc("personalization:verify", 0, []),
  listCommands: (input: { cwd?: string } = {}) => __ipc("commands:list", 0, [input]),
  readCommand: (filePath: string) => __ipc("commands:read", 1, [filePath]),
  saveCommand: (input: unknown) => __ipc("commands:save", 1, [input]),
  deleteCommand: (filePath: string) => __ipc("commands:delete", 1, [filePath]),
  expandCommand: (input: { filePath: string; argument?: string; cwd?: string }) => __ipc("commands:expand", 0, [input]),
  getCustomModel: () => __ipc("custom-model:read", 0, []),
  probeCustomModel: (config: unknown) => __ipc("custom-model:probe", 1, [config]),
  readModelSpecs: () => __ipc("model-specs:read", 0, []),
  saveCustomModel: (config: unknown) => __ipc("custom-model:save", 1, [config]),
  listCustomModels: () => __ipc("custom-model:list", 0, []),
  selectCustomModel: (providerId: string) => __ipc("custom-model:select", 1, [providerId]),
  setProviderModel: (input: { provider: string; model: string; apply?: boolean; restart?: boolean }) => __ipc("custom-model:set-model", 0, [input]),
  setProviderEffort: (input: { provider: string; model: string; effort: string }) => __ipc("custom-model:set-effort", 1, [input]),
  listThreadRuntimes: () => __ipc("thread-runtime:list", 0, []),
  seedThreadRuntime: (input: { threadId: string; runtime: unknown }) => __ipc("thread-runtime:seed", 1, [input]),
  patchThreadRuntime: (input: { threadId: string; patch: unknown; baseRev?: number; takeover?: boolean }) => __ipc("thread-runtime:patch", 0, [input]),
  dispatchOwner: () => __ipc("thread-runtime:dispatch-owner", 0, []),
  releaseDispatch: (threadId: string) => __ipc("thread-runtime:release-dispatch", 1, [threadId]),
  threadRole: (threadId: string) => __ipc("agents:thread-role", 1, [threadId]),
  writeClipboard: (text: string) => __ipc("clipboard:write", 1, [text]),
  createScratchDir: () => __ipc("scratch:create", 0, []),
  /* ⛔ d.ts 历史上本有两处声明（宽口径 Record<string,string> 与窄口径 3 字段），提取去重保留宽口径 —— identity_onboard 调用点传 8 个字段，窄口径会爆 excess-property。 */
  saveIdentity: (input: Record<string, string>) => __ipc("personalization:save-identity", 1, [input]),
  applyCustomModel: () => __ipc("custom-model:apply", 0, []),
  upsertProviderModel: (input: { provider: string; model: unknown }) => __ipc("custom-model:upsert-model", 1, [input]),
  removeProviderModel: (input: { provider: string; modelId: string }) => __ipc("custom-model:remove-model", 1, [input]),
  setProviderEnabled: (input: { provider: string; enabled: boolean }) => __ipc("custom-model:set-enabled", 1, [input]),
  removeCustomModel: (providerId: string) => __ipc("custom-model:remove", 1, [providerId]),
  getChannelBot: () => __ipc("channel-bot:read", 0, []),
  saveChannelBot: (config: unknown) => __ipc("channel-bot:save", 1, [config]),
  testChannelBot: (config: unknown) => __ipc("channel-bot:test", 1, [config]),
  listMemory: (category?: string) => __ipc("memory:list", 0, [category]),
  searchMemory: (query: string) => __ipc("memory:search", 1, [query]),
  recallMemory: (query: string, workspace?: string) => __ipc("memory:recall", 1, [query, workspace]),
  readMemoryMode: () => __ipc("memory:mode-read", 0, []),
  setMemoryMode: (mode: "local" | "cloud") => __ipc("memory:mode-set", 1, [mode]),
  /* 记忆后端二选一：用户选的值 + 实际生效值（装了 MCP 服务才让位）+ 安装命令 */
  readMemoryBackend: () => __ipc("memory:backend:read", 0, []),
  /* 切换记忆后端并回传新状态 */
  setMemoryBackend: (backend: "builtin" | "mcp") => __ipc("memory:backend:set", 1, [backend]),
  /* 一键安装 MCP 记忆服务（主进程用应用自带 node 跑安装器；新电脑无需预装 Node） */
  installMemoryMcp: () => __ipc("memory:mcp:install", 0, []),
  /* 卸载 MCP 记忆服务（删 <userData>/memory-mcp） */
  uninstallMemoryMcp: () => __ipc("memory:mcp:uninstall", 0, []),
  /* 真跑一次 MCP 握手校验（不是只判文件存在） */
  verifyMemoryMcp: () => __ipc("memory:mcp:verify", 0, []),
  /* 10-05 统一记忆（读）：session 段按 threadId 硬隔离 + project 段全项目共享 + 上一版角色记忆兼容段。主会话与被调度角色走同一个 handler */
  readRoleMemoryContext: (input: unknown) => __ipc("memory:role-context", 1, [input]),
  /* 10-05 记忆前端：会话↔角色归属表（fabric 命名空间只带 threadId，靠它归到人） */
  listRoleSessions: () => __ipc("memory:role-sessions", 0, []),
  /* 10-05 统一记忆只读：命名空间概览（两种作用域 + 条数）—— 前端分区渲染用 */
  listFabricNamespaces: (workspace?: string) => __ipc("memory:fabric-namespaces", 0, [workspace]),
  /* 10-05 统一记忆只读：某命名空间的条目（含来源智能体/权重/归档态） */
  listFabricEntries: (input: unknown) => __ipc("memory:fabric-entries", 1, [input]),
  /* 10-05 统一记忆（写）：主会话的 memory_write 走这里；session=本会话私有 / project=全项目共享 */
  writeFabricMemory: (input: unknown) => __ipc("memory:fabric-write", 1, [input]),
  saveMemory: (input: unknown) => __ipc("memory:save", 1, [input]),
  listRpaRecipes: () => __ipc("rpa:list", 0, []),
  saveRpaRecipe: (input: unknown) => __ipc("rpa:save", 1, [input]),
  deleteRpaRecipe: (id: string) => __ipc("rpa:delete", 1, [id]),
  recordRpaRun: (input: { id: string; ok: boolean; error?: string }) => __ipc("rpa:record", 0, [input]),
  listTasks: () => __ipc("tasks:list", 0, []),
  addTask: (input: { text: string; priority?: string }) => __ipc("tasks:add", 0, [input]),
  updateTask: (input: { id: string; patch: unknown }) => __ipc("tasks:update", 1, [input]),
  deleteTask: (id: string) => __ipc("tasks:delete", 1, [id]),
  clearTasks: () => __ipc("tasks:clear", 0, []),
  deleteMemory: (id: string) => __ipc("memory:delete", 1, [id]),
  resetMemory: () => __ipc("memory:reset", 0, []),
  getMemoryGateway: () => __ipc("memory:gateway:read", 0, []),
  saveMemoryGateway: (config: unknown) => __ipc("memory:gateway:save", 1, [config]),
  testMemoryGateway: (config: unknown) => __ipc("memory:gateway:test", 1, [config]),
  readMemoryLayers: (workspace?: string) => __ipc("memory:layers:read", 0, [workspace]),
  /* 执行清理动作：⛔ 必须 confirm: true（UI 二次确认后才置位） */
  applyMemoryHygiene: (input: { action: "purge-archive" | "prune-pool" | "tidy-lessons"; workspace?: string; confirm: true }) => __ipc("memory:hygiene:apply", 0, [input]),
  readMemoryContext: (workspace?: string, includeWorkspace = true) => __ipc("memory:layers:context", 0, [workspace, includeWorkspace]),
  writeMemoryLayer: (input: { scope: "user" | "background" | "project" | "lessons"; content: string; workspace?: string }) => __ipc("memory:layers:write", 0, [input]),
  readWorkspaceMemoryEnabled: (workspace?: string) => __ipc("memory:workspace-enabled:read", 0, [workspace]),
  setWorkspaceMemoryEnabled: (input: { workspace: string; enabled: boolean }) => __ipc("memory:workspace-enabled:set", 1, [input]),
  distillMemory: (workspace?: string) => __ipc("memory:distill", 0, [workspace]),
  listScheduledTasks: () => __ipc("scheduler:list", 0, []),
  saveScheduledTask: (input: unknown) => __ipc("scheduler:save", 1, [input]),
  deleteScheduledTask: (id: string) => __ipc("scheduler:delete", 1, [id]),
  runScheduledTask: (id: string) => __ipc("scheduler:run", 1, [id]),
  listSubAgents: () => __ipc("subagents:list", 0, []),
  saveSubAgent: (input: unknown) => __ipc("subagents:save", 1, [input]),
  removeSubAgent: (id: string) => __ipc("subagents:remove", 1, [id]),
  dispatchToolDescription: (threadId: string) => __ipc("agents:tool-description", 1, [threadId]),
  /* 10-04 逐类通知：传 before/next 勾选 ⇒ 主进程按差集生成一条按类分段的通知；不传退化为全开通知 */
  dispatchNotice: (before?: { expert?: boolean; team?: boolean; subagent?: boolean }, next?: { expert?: boolean; team?: boolean; subagent?: boolean }) => __ipc("agents:notice", 0, [before, next]),
  /* 总开关开启时的完整告知：按勾选类别逐段列（勾 1 类 1 段、3 类 3 段），未开启的明确否定 */
  dispatchEnabledNotice: (next?: { expert?: boolean; team?: boolean; subagent?: boolean }) => __ipc("agents:enabled-notice", 0, [next]),
  dispatchOffNotice: () => __ipc("agents:off-notice", 0, []),
  listDelegates: () => __ipc("agents:delegated", 0, []),
  listDelegatesOf: (originThreadId: string) => __ipc("agents:delegated-of", 1, [originThreadId]),
  invokeAgent: (input: unknown) => __ipc("agents:invoke", 1, [input]),
  archiveDelegates: (input: unknown) => __ipc("agents:archive", 1, [input]),
  /* 10-05 能力网关：把引擎 0.157 后对模型不可见的内置 MCP 工具面接回来（name=工具名，name="list" 取清单） */
  callDispatchTool: (input: unknown) => __ipc("agents:dispatch-call", 1, [input]),
  listExpertTeams: () => __ipc("teams:list", 0, []),
  saveExpertTeam: (input: unknown) => __ipc("teams:save", 1, [input]),
  removeExpertTeam: (teamId: string) => __ipc("teams:remove", 1, [teamId]),
  resetExpertTeams: () => __ipc("teams:reset-defaults", 0, []),
  getTeamTools: (teamId: string) => __ipc("teams:tools", 1, [teamId]),
  getTeamSessionConfig: (teamId: string) => __ipc("teams:session-config", 1, [teamId]),
  startTeamSession: (input: unknown) => __ipc("teams:start-session", 1, [input]),
  startTeamMemberSession: (input: unknown) => __ipc("teams:member-session", 1, [input]),
  invokeTeamMember: (input: unknown) => __ipc("teams:invoke-member", 1, [input]),
  /* 专家团历史委托记录（成员历史工作记录面板；主进程落盘，跨窗口一致） */
  listTeamRuns: (threadId: string) => __ipc("team-runs:list", 1, [threadId]),
  teamThreadsMap: () => __ipc("team-threads:map", 0, []),
  teamOfThread: (threadId: string) => __ipc("team-threads:team-of", 1, [threadId]),
  terminalInput: (id: string, data: string) => __ipc("terminal:input", 2, [id, data]),
  terminalResize: (id: string, cols: number, rows: number) => __ipc("terminal:resize", 3, [id, cols, rows]),
  restartTerminal: (id: string, cwd?: string) => __ipc("terminal:restart", 1, [id, cwd]),
  terminalReady: () => __ipc("terminal:ready", 0, []),
  gitDiff: (cwd: string, scope: string) => __ipc("git:diff", 2, [{ cwd, scope }]),
  openExternal: (url: string) => __ipc("external:open", 1, [url]),
  browserPopout: (url: string) => __ipc("browser:popout", 1, [url]),
  shellReveal: (target: string) => __ipc("shell:reveal", 1, [target]),
  writeClipboardImage: (filePath: string) => __ipc("clipboard:write-image", 1, [filePath]),
  readClipboardFiles: () => __ipc("clipboard:read-files", 0, []),
  doctor: (cwd?: string) => __ipc("app:doctor", 0, [{ cwd }]),
  engineInfo: () => __ipc("app:engine-info", 0, []),
  /* 上报当前正在查看的会话：主进程据此只转发该会话的高频事件（多会话性能） */
  setActiveThread: (threadId: string | null) => __ipc("codex:set-active-thread", 1, [threadId]) as Promise<{ ok: boolean }>,
  storageInfo: () => __ipc("app:storage-info", 0, []),
  /* 缓存清理：仅支持安全目标（引擎日志 / 本地图片缓存），绝不删会话历史 */
  storageClear: (target: "engine-log" | "images") => __ipc("app:storage-clear", 1, [target]),
  engineCheckUpdate: () => __ipc("engine:check-update", 0, []),
  enginePerformUpdate: () => __ipc("engine:perform-update", 0, []),
  relaunchApp: () => __ipc("app:relaunch", 0, []),
  readBuiltinPlugins: () => __ipc("builtin:read", 0, []),
  saveBuiltinPlugins: (cfg: unknown) => __ipc("builtin:save", 1, [cfg]),
  probeBuiltinModels: (input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) => __ipc("builtin:probe", 1, [input]),
  /* ⛔ `path` 是落盘后的本地路径（网关只回 b64_json 时也有值）；`url` **仅在网关给了 * 真托管地址时**才有值 —— data URL 绝不会回传（会把 3 MB base64 带进对话历史）。 */
  generateImage: (input: { baseUrl: string; apiKey: string; model: string; prompt: string; size?: string; negative?: string; outputDir?: string }) => __ipc("builtin:generate-image", 0, [input]),
  describeImage: (input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) => __ipc("builtin:describe-image", 0, [input]),
  relayLogin: (input: { baseUrl: string; email: string; password: string }) => __ipc("relay:login", 1, [input]),
  relayLoadAccount: () => __ipc("relay:load-account", 0, []),
  relayAccounts: () => __ipc("relay:accounts", 0, []),
  relaySwitchAccount: (id: string) => __ipc("relay:switch-account", 1, [id]),
  relayRemoveAccount: (id: string) => __ipc("relay:remove-account", 1, [id]),
  openaiLoginStart: (input?: { proxy?: string }) => __ipc("openai:login-start", 0, [input ?? {}]),
  openaiLoginStatus: () => __ipc("openai:login-status", 0, []),
  openaiLoginCancel: () => __ipc("openai:login-cancel", 0, []),
  openaiUsage: (input?: { email?: string }) => __ipc("openai:usage", 0, [input ?? {}]),
  openaiSetProxy: (proxy: string) => __ipc("openai:set-proxy", 1, [proxy]),
  openaiModels: () => __ipc("openai:models", 0, []),
  openaiCaptureLogin: () => __ipc("openai:capture-login", 0, []),
  openaiAccounts: () => __ipc("openai:accounts", 0, []),
  openaiAccountRemove: (id: string) => __ipc("openai:account-remove", 1, [id]),
  openaiAccountSwitch: (id: string) => __ipc("openai:account-switch", 1, [id]),
  openaiImportFile: (input: { contents: string[] }) => __ipc("openai:import-file", 1, [input]),
  relayKeysAll: () => __ipc("relay:keys-all", 0, []),
  relayOverview: (id?: string) => __ipc("relay:overview", 0, [id]),
  relayCreateKey: (input: { name: string; groupId?: number | null; accountId?: string }) => __ipc("relay:create-key", 0, [input]),
  relaySelect: (input: { mode: "balance" | "plan"; groupId: number | null; keyId?: number; keyName?: string }) => __ipc("relay:select", 0, [input]),
  relayKeyBilling: (input: { baseUrl: string; apiKey: string }) => __ipc("relay:key-billing", 1, [input]),
  relayRegister: (input: { baseUrl: string; email: string; password: string; affCode?: string }) => __ipc("relay:register", 0, [input]),
  relayPaymentPlans: () => __ipc("relay:payment-plans", 0, []),
  relayOpenPurchase: () => __ipc("relay:open-purchase", 0, []),
  enhancePrompt: (text: string) => __ipc("prompt:enhance", 1, [{ text }]),
  listTerminals: () => __ipc("terminal:list", 0, []),
  validatePlugin: (target: string) => __ipc("plugin:validate", 1, [{ path: target }]),
  chooseDirectoryAt: (startPath: string) => __ipc("dialog:directory-at", 1, [startPath]),
  /* 10-03 资源停用/启用（不删文件，可逆） */
  voiceResourceSetEnabled: (input: { kind: string; enabled: boolean }) => __ipc("voice:resource-set-enabled", 1, [input]) as Promise<{ ok: boolean; error?: string; enabled?: boolean }>,
  /* 10-03 按资源删除（物理删文件，渲染层二次确认） */
  voiceResourceDelete: (input: { kind: string }) => __ipc("voice:resource-delete", 1, [input]) as Promise<{ ok: boolean; error?: string }>,
  /* 10-03 单个资源的启用状态与占用 */
  voiceResourceStatus: (input: { kind: string }) => __ipc("voice:resource-status", 1, [input]) as Promise<any>,
  voiceStop: () => __ipc("voice:stop", 0, []) as Promise<{ ok: boolean }>,
  voiceProfilesImport: () => __ipc("voice:profiles-import", 0, []) as Promise<any>,
  /* 10-08 音色上传接口：source=base64/file 已实现；pack（音色包）**预留**、明确返回未开放。走与导入同一条草稿链（落盘→ASR 转写参考文本→用户校对） */
  voiceProfileUpload: (input?: { source?: "base64" | "file" | "pack"; name?: string; refText?: string; audioBase64?: string; sampleRate?: number }) => __ipc("voice:profile-upload", 0, [input]) as Promise<any>,
  voiceProfilesRecord: (input: { samples: number[]; sampleRate: number }) => __ipc("voice:profiles-record", 1, [input]) as Promise<any>,
  voiceProfilesSave: (input: { draftFile: string; name: string; refText: string }) => __ipc("voice:profiles-save", 1, [input]) as Promise<any>,
  voiceProfilesDelete: (id: string) => __ipc("voice:profiles-delete", 1, [id]) as Promise<{ ok: boolean }>,
  voiceProfilesPreview: (input: { id?: string; text?: string }) => __ipc("voice:profiles-preview", 0, [input]) as Promise<any>,
  voiceBarge: () => __ipc("voice:barge", 0, []) as Promise<{ ok: boolean }>,
  voicePlaybackDone: () => __ipc("voice:playback-done", 0, []) as Promise<{ ok: boolean }>,
  voiceZipvoiceCancel: () => __ipc("voice:zipvoice-cancel", 0, []) as Promise<{ ok: boolean }>,
  voiceModelsCancel: () => __ipc("voice:models-cancel", 0, []) as Promise<{ ok: boolean }>,
  voiceModelsReveal: () => __ipc("voice:models-reveal", 0, []) as Promise<string>,
  voiceModelsUninstall: () => __ipc("voice:models-uninstall", 0, []) as Promise<{ ok: boolean }>,
  voiceHotkeyGet: () => __ipc("voice:hotkey-get", 0, []) as Promise<{ registered: string }>,
  voiceWakeReset: () => __ipc("voice:wake-reset", 0, []) as Promise<{ ok: boolean }>,
  voiceWakeStop: () => __ipc("voice:wake-stop", 0, []) as Promise<{ ok: boolean }>,
  voiceKwsCancel: () => __ipc("voice:kws-cancel", 0, []) as Promise<{ ok: boolean }>,
  voiceKwsStatus: () => __ipc("voice:kws-status", 0, []) as Promise<{ ready: boolean }>,
  installRuntime: (id: string) => __ipc("runtime:install", 1, [id]),
  uninstallRuntime: (id: string) => __ipc("runtime:uninstall", 1, [id]),
  /* 10-07 取消安装：杀子进程 + 清临时文件；reason=not-running 表示该工具没有在跑的安装 */
  cancelRuntime: (id: string) => __ipc("runtime:cancel", 1, [id]),
  /* 工具自检（10-02 用户要的「检查」）：逐个探测已装工具**能不能真跑**（跑一次版本命令/可执行性），返回逐项结果，界面直接列给人看 */
  runtimeHealth: () => __ipc("runtime:health", 0, []),
  weixinStartLogin: () => __ipc("weixin:start-login", 0, []),
  weixinPollLogin: () => __ipc("weixin:poll-login", 0, []),
  feishuConnect: (appId: string, appSecret: string) => __ipc("feishu:connect", 2, [appId, appSecret]),
  dingtalkConnect: (clientId: string, clientSecret: string) => __ipc("dingtalk:connect", 2, [clientId, clientSecret]),
  qqConnect: (appId: string, appSecret: string) => __ipc("qq:connect", 2, [appId, appSecret]),
  qqQrStart: () => __ipc("qq:qr-start", 0, []),
  qqQrStatus: () => __ipc("qq:qr-status", 0, []),
  feishuQrStart: () => __ipc("feishu:qr-start", 0, []),
  feishuQrStatus: () => __ipc("feishu:qr-status", 0, []),
  wecomWebhookConnect: (url: string) => __ipc("wecom-webhook:connect", 1, [url]),
  wecomWebhookTest: (text?: string) => __ipc("wecom-webhook:test", 0, [text]),
  botBindingGet: () => __ipc("bot-binding:get", 0, []),
  botsSet: (list: any[]) => __ipc("bots:set", 1, [list]),
  botBindingSet: (input: { channel: string; threadId: string | null; title?: string }) => __ipc("bot-binding:set", 0, [input]),
  botStreamGet: () => __ipc("bot-stream:get", 0, []),
  botStreamSet: (input: { enabled: boolean; thinking: boolean; tools: boolean }) => __ipc("bot-stream:set", 1, [input]),
  relayToggleAccount: (input: { id: string; disabled: boolean }) => __ipc("relay:toggle-account", 1, [input]),
  openaiToggleAccount: (input: { id: string; disabled: boolean }) => __ipc("openai:toggle-account", 1, [input]),
  channelsStatus: () => __ipc("channels:status", 0, []),
  telegramConnect: (token: string) => __ipc("telegram:connect", 1, [token]),
  installMarketSkillLight: (skill: unknown) => __ipc("skills:market-install-light", 1, [skill]),
  skillDisciplineGet: () => __ipc("skill-discipline:get", 0, []),
  savePastedText: (text: string) => __ipc("pasted-text:save", 1, [text]),
  readPastedText: (path: string) => __ipc("pasted-text:read", 1, [path]),
  updatePastedText: (path: string, content: string) => __ipc("pasted-text:update", 2, [{ path, content }]),
  updateCheck: () => __ipc("updates:check", 0, []),
  updateDownload: (input: { downloadUrl: string; filename?: string }) => __ipc("updates:download", 0, [input]),
  updateInstall: (filePath: string) => __ipc("updates:install", 1, [filePath]),
  bridgeStatus: () => __ipc("bridge:status", 0, []),
  getThreadRuntime: (threadId: string) => __ipc("thread-runtime:get", 1, [threadId]),
  planMemoryHygiene: (workspace?: string) => __ipc("memory:hygiene:plan", 0, [workspace]),
  listDispatchCatalog: () => __ipc("agents:catalog", 0, []),
  capabilitiesSnapshot: () => __ipc("capabilities:snapshot", 0, []),
  perfCounters: () => __ipc("app:perf-counters", 0, []),
  markIdentityGreeted: () => __ipc("personalization:mark-greeted", 0, []),
  popoutThread: (threadId: string) => __ipc("window:popout-thread", 1, [threadId]),
  popoutClose: (threadId: string | null) => __ipc("window:popout-close", 1, [threadId]),
  popoutThreadId: () => __ipc("window:popout-id", 0, []),
  popoutList: () => __ipc("window:popout-list", 0, []),
  engineRestartLog: () => __ipc("engine:restart-log", 0, []),
  engineActiveTurns: () => __ipc("engine:active-turns", 0, []),
  voiceStatus: () => __ipc("voice:status", 0, []),
  voiceStart: (threadId: string, options?: { mode?: "conversation" | "dictation" }) => __ipc("voice:start", 1, [threadId, options]),
  voiceDictationFinish: () => __ipc("voice:dictation-finish", 0, []),
  voiceEndpointNow: () => __ipc("voice:endpoint-now", 0, []),
  voiceSpeak: (text: string, options?: { sid?: number; speed?: number }) => __ipc("voice:speak", 1, [text, options]),
  voicePreviewVoice: (input?: { sid?: number; speed?: number; text?: string }) => __ipc("voice:preview-voice", 0, [input]),
  voiceProfilesList: () => __ipc("voice:profiles-list", 0, []),
  voicePresetList: () => __ipc("voice:preset-list", 0, []),
  voicePresetApply: (presetId: string) => __ipc("voice:preset-apply", 1, [presetId]),
  voiceProfilesSelect: (id: string) => __ipc("voice:profiles-select", 1, [id]),
  /* 10-03：新增 baseEnabled / 各资源 enabled —— 启用与已下载正交，UI 靠它们组合出四态 */
  voiceModelsStatus: () => __ipc("voice:models-status", 0, []),
  voiceModelsInstall: () => __ipc("voice:models-install", 0, []),
  voiceZipvoiceInstall: () => __ipc("voice:zipvoice-install", 0, []),
  voiceModelsImport: (input: { sourceDir: string }) => __ipc("voice:models-import", 1, [input]),
  voiceMicPermission: () => __ipc("voice:mic-permission", 0, []),
  voiceSettingsGet: () => __ipc("voice:settings-get", 0, []),
  voiceSettingsSet: (patch: any) => __ipc("voice:settings-set", 1, [patch]),
  voiceHotkeySet: (input: { accelerator: string; enabled?: boolean }) => __ipc("voice:hotkey-set", 0, [input]),
  voiceWakeStart: () => __ipc("voice:wake-start", 0, []),
  voiceWakeAudio: (samples: Float32Array) => __ipc("voice:wake-audio", 1, [samples]),
  voiceKwsInstall: () => __ipc("voice:kws-install", 0, []),
  /* 截图设置 + 实际注册成功的快捷键 + 冲突说明 */
  screenshotSettingsGet: () => __ipc("screenshot:settings-get", 0, []),
  /* 改完立刻重挂快捷键（不重启即生效） */
  screenshotSettingsSet: (patch: unknown) => __ipc("screenshot:settings-set", 1, [patch]),
  /* 先注册成功才落盘；冲突时保留原设置 */
  screenshotHotkeySet: (input: { mode: "full" | "region"; accelerator?: string; enabled?: boolean }) => __ipc("screenshot:hotkey-set", 0, [input]),
  /* 成功时另推 screenshot:captured 事件给主窗口（渲染层只认事件，避免插两份） */
  screenshotCapture: (mode: "full" | "region") => __ipc("screenshot:capture", 1, [mode]),
  screenshotPickDir: () => __ipc("screenshot:pick-dir", 0, []),
  /* 在系统文件管理器里定位截图 */
  screenshotReveal: (file: string) => __ipc("screenshot:reveal", 1, [file]),
  listFavorites: () => __ipc("favorites:list", 0, []),
  addFavorite: (input: unknown) => __ipc("favorites:add", 1, [input]),
  updateFavorite: (input: unknown) => __ipc("favorites:update", 1, [input]),
  /* 批量删除只认显式 id 列表（不提供隐式删全部） */
  deleteFavorites: (ids: string[]) => __ipc("favorites:delete", 1, [ids]),
  clearFavorites: () => __ipc("favorites:clear", 0, []),
  /* 记一次使用（useCount/lastUsedAt），失败不阻断发送 */
  touchFavorite: (id: string) => __ipc("favorites:touch", 1, [id]),
  /* 只追加到记忆层（先读后写，不抹既有内容）；单行限长 300 字 */
  favoritesToMemory: (input: { ids: string[]; scope?: "user" | "project" | "background" | "lessons"; workspace?: string }) => __ipc("favorites:to-memory", 0, [input]),
  /* 手机控制状态（平台/pip 包/adb/技能/遥测） */
  phoneHarnessStatus: () => __ipc("phone:harness:status", 0, []) as Promise<{platform:string;python:string;pythonOk:boolean;installed:boolean;version:string;adb:boolean;skill:boolean;telemetryOff:boolean;iphoneEligible:boolean}>,
  /* 装 phone-harness + 关遥测 + 注册技能 */
  phoneHarnessInstall: () => __ipc("phone:harness:install", 0, []) as Promise<{ok:boolean;log:string}>,
  /* 卸载 phone-harness 与技能 */
  phoneHarnessUninstall: () => __ipc("phone:harness:uninstall", 0, []) as Promise<{ok:boolean;log:string}>,
  /* 跑上游 --doctor 体检 */
  phoneHarnessDoctor: () => __ipc("phone:harness:doctor", 0, []) as Promise<{ok:boolean;log:string}>,
  /* 按平台返回权限引导步骤 */
  phoneHarnessGuides: () => __ipc("phone:harness:guides", 0, []) as Promise<{id:string;title:string;steps:string[]}[]>,
  /* 打开系统权限设置页 */
  phoneHarnessOpenSettings: () => __ipc("phone:harness:open-settings", 0, []) as Promise<void>,
  /* 把工具链里的 adb 写进 phone-harness 配置（android.adb，不改系统 PATH） */
  phoneHarnessWireAdb: () => __ipc("phone:harness:wire-adb", 0, []) as Promise<{adb:string}>,
  /* 把一段生图提示词交给**用户已配置的模型**润色（一次性短请求，非流式，不开会话）：补主体细节/环境/光线/构图/风格，只回一行可直接用的提示词。⛔ 只支持 chat 协议供应商；官方订阅与 responses-only 网关明确报错 */
  dramaCanvasPolishPrompt: (input: { text: string; context?: string }) => __ipc("drama-canvas:polish-prompt", 0, [input]) as Promise<{ text: string }>,
  /* 锁主体（09-29 电商出图工作流）：用已配置的**视觉模型**把商品参考图反推成一段固定主体描述，六类图（主图/SKU/详情/场景/白底/买家秀）共用，保证一套图是同一件商品。⛔ 当前生图通道 builtin:generate-image 是纯文生图（无图输入）⇒ 这是「参考图锁主体」的可行替代，不是图生图；模型须支持视觉输入，否则如实报错 */
  dramaCanvasDescribeImage: (input: { image: string; context?: string }) => __ipc("drama-canvas:describe-image", 0, [input]) as Promise<{ text: string }>,
  /* 产物目录（09-29 用户要求「在 codexharness 目录下面新增一个存的目录，也可以选择和修改目录」）：默认 <userData>/outputs，首次读取自动创建；返回当前目录与「是否为默认」。 */
  dramaCanvasOutputDir: () => __ipc("drama-canvas:output-dir", 0, []) as Promise<{ dir: string; isDefault: boolean }>,
  /* 设置产物目录：pick=true 弹系统目录选择框；dir 给绝对路径直接设；dir 为空串 = 恢复默认。目录不可用会明确报错（不静默回退）。 */
  dramaCanvasOutputDirSet: (input: { dir?: string; pick?: boolean }) => __ipc("drama-canvas:output-dir-set", 0, [input]) as Promise<{ dir: string; isDefault: boolean }>,
  /* 画布快照镜像（09-29「打通」）：渲染层把当前画布（名称/工作流类型/节点/连线）防抖推给主进程，存 userData/drama-canvas/boards.json —— workflow_read 工具的数据源 */
  dramaCanvasBoardSync: (input: { name: string; flow: string; nodes: unknown[]; edges: unknown[] }) => __ipc("drama-canvas:board-sync", 1, [input]) as Promise<{ ok: boolean }>,
  /* 把二进制素材（配音 WAV / 生成图）按字节写进工作区 .drama-canvas/assets/；工作区掉出可信根（会话已关/重启）时回退应用数据目录并置 fallback=true（09-29 修「参考图传不了」）。⛔ 渲染层唯一的写入通道 fs:write 是 utf8 字符串写，写不了二进制，WAV 必须走这里 */
  dramaCanvasAssetWrite: (input: { workspace: string; name: string; base64: string; subdir?: string }) => __ipc("drama-canvas:asset-write", 0, [input]) as Promise<{ path: string; fallback?: boolean }>,
  /* 主动推送一条微信消息给用户（to 缺省=最近对话用户）。⛔ 正文气泡依赖 context_token，对方近期发过消息才最可靠；机器人未登录时抛错 */
  weixinSend: (input: { to?: string; text: string }) => __ipc("weixin:send", 0, [input]) as Promise<{ ok: boolean }>,
  /* 内置视频生成接口：国内外 8 家厂商清单 + 是否已配凭证（可灵/万相/Seedance/CogVideoX/MiniMax/Runway/Luma/Veo） */
  videoProviders: () => __ipc("video:providers", 0, []) as Promise<{id:string;name:string;region:string;modes:string[];imageInput:string;fields:string[];models:string[];defaultModel:string;configured:boolean}[]>,
  /* 各厂商凭证（userData/video-providers.json） */
  videoConfigRead: () => __ipc("video:config-read", 0, []) as Promise<Record<string, Record<string,string>>>,
  /* 保存某厂商的 API 凭证 */
  videoConfigSave: (input: { providerId: string; values: Record<string,string> }) => __ipc("video:config-save", 1, [input]) as Promise<{ ok: boolean; configured: boolean }>,
  /* 提交视频生成异步任务（i2v 时 image 可为本地路径/URL，主进程转 base64） */
  videoSubmit: (input: { providerId: string; mode: string; prompt: string; image?: string; model?: string; duration?: number; aspect?: string }) => __ipc("video:submit", 0, [input]) as Promise<{ jobId: string }>,
  /* 轮询任务状态（MiniMax 成功后自动两段式换下载地址） */
  videoPoll: (input: { providerId: string; jobId: string }) => __ipc("video:poll", 1, [input]) as Promise<{ status: string; url?: string; error?: string }>,
  /* 把产物视频拉回本地落 <workspace>/.drama-canvas/assets/（可信根校验） */
  videoDownload: (input: { url: string; workspace: string; name: string; subdir?: string; outputDir?: string }) => __ipc("video:download", 0, [input]) as Promise<{ path: string; bytes: number }>,
  /* 排队消息定时发送：主进程登记定时器（不受渲染层隐藏节流），到点广播 queue-timer:due */
  queueTimerSet: (input: { threadId: string; queuedSubmissionId: string; runAt: number }) => __ipc("queue-timer:set", 1, [input]) as Promise<{ ok: boolean; scheduled: boolean }>,
  /* 取消排队消息定时（删除消息/取消定时/到点清理时调） */
  queueTimerCancel: (input: { queuedSubmissionId: string }) => __ipc("queue-timer:cancel", 1, [input]) as Promise<{ ok: boolean }>,
  /* 在系统资源管理器中定位文件（可信根校验同 fs:read）；画布生成产物「打开文件夹」 */
  revealInFolder: (path: string) => __ipc("fs:reveal", 1, [{ path }]),
  readModel: (path: string) => __ipc("model-viewer:read", 1, [{ path }]),
  /* 删分镜表的工作区文件（只删 .drama-canvas/storyboards/<name>.json 这一个文件；不存在时幂等返回 removed:false） */
  dramaCanvasStoryboardFileRemove: (input: { workspace: string; name: string }) => __ipc("drama-canvas:storyboard-file-remove", 1, [input]),
  /* 扫各项目的**工作日志与项目记忆**（<项目>/.codex-harness/memory/**：长期记忆 / 坑与纪律 / logs 日报 / archive / project）。项目清单来自 rollout 扫出的 cwd 集合。⛔ 这是项目里的工作记录，与会话本身的归档 / 删除（「归档管理」页）不是一回事 */
  workLogsScan: () => __ipc("work-logs:scan", 0, []),
  /* 读一份工作日志/记忆文件的正文（UI 内查看）。路径必须落在某个项目的 .codex-harness/memory 之下；>512KB 拒绝（提示去文件管理器打开） */
  workLogsRead: (input: { path: string }) => __ipc("work-logs:read", 1, [input]),
  /* 删工作日志文件（销毁性，不会重建）：只删 .codex-harness/memory 之下的普通文件；目录、越界路径一律拒绝 */
  workLogsDelete: (input: { paths: string[] }) => __ipc("work-logs:delete", 1, [input]),
  /* 按顺序合并视频片段成一条成片（整片导出）：先 -c copy，失败回落统一重编码；输出 <workspace>/.drama-canvas/export/ */
  videoConcat: (input: { workspace: string; name: string; files: string[]; width?: number; height?: number; fps?: number }) => __ipc("video:concat", 0, [input]) as Promise<{ path: string; bytes: number; mode: "copy" | "reencode"; parts: number }>,
  /* 扫描宠物目录（内置 dist/pets + userData/pets + ~/.codex/pets + ~/.petdex/pets）；同名 id 先到先得，内置优先 */
  petList: () => __ipc("pet:list", 0, []),
  /* 宠物设置 + 当前生效的宠物包（active 无效时回落第一只可用的） */
  petSettingsGet: () => __ipc("pet:settings-get", 0, []),
  /* 改完立刻应用（显隐 / 位置 / 缩放 / 透明度）；取值一律归一化后再落盘 */
  petSettingsSet: (patch: unknown) => __ipc("pet:settings-set", 1, [patch]),
  /* 浮窗首帧补水（推送可能发生在窗口创建之前）+ 诊断 */
  petState: () => __ipc("pet:state", 0, []),
  /* 宠物目录清单：设置页显示「官方宠物包放哪儿」，writable 只对用户目录为真 */
  petRoots: () => __ipc("pet:roots", 0, []),
  /* 在系统文件管理器打开宠物目录（缺省 = 用户目录；不存在则先建，否则 Windows 上静默无反应） */
  petOpenDir: (which?: string) => __ipc("pet:open-dir", 0, [which]),
  /* 把外部宠物包**复制**进 userData/pets（只允许从已登记的宠物目录导入；不移动、不覆盖同名） */
  petImport: (dir: string) => __ipc("pet:import", 1, [dir]),
  /* 显示/隐藏切换（走独立通道，避免为了开关宠物而整份重写设置） */
  petToggle: () => __ipc("pet:toggle", 0, []),
  /* 显示宠物（置 enabled=true） */
  petShow: () => __ipc("pet:show", 0, []),
  /* 隐藏宠物（置 enabled=false；下次启动不自动恢复） */
  petHide: () => __ipc("pet:hide", 0, []),
  /* 透明区域鼠标穿透开关：渲染层按「指针是否在宠物本体上」动态翻转；forward 让页面在穿透时仍收到 mousemove（仅 Windows 有 forward，mac 保持整块可点） */
  petIgnoreMouse: (ignore: boolean) => __ipc("pet:ignore-mouse", 1, [ignore]),
  /* SkillHub 专家市场包（skillhub.cn/skillspackage，总 55 包） */
  listExpertMarketPackages: (input: { page?: number; pageSize?: number; query?: string } = {}) => __ipc("expert-market:list", 0, [input]),
  /* 装包 = 元技能 + 子技能 + 专家中心新增对应专家卡片 */
  installExpertMarketPackage: (input: { slug: string }) => __ipc("expert-market:install", 1, [input]),
  /* SkillHub 人格市场（skillhub.cn/soul，16 套全量） */
  listSoulMarket: () => __ipc("soul-market:list", 0, []),
  /* 人格详情（content = 完整中文人设） */
  getSoulMarket: (input: { slug: string }) => __ipc("soul-market:get", 1, [input]),
  /* 当前生效人格（soulSlug 空 = 默认人格） */
  currentSoulMarket: () => __ipc("soul-market:current", 0, []),
  /* 应用人格（slug=null 还原默认）：写 personalization.persona + 同步 $CODEX_HOME/AGENTS.md，新会话即生效 */
  applySoulMarket: (input: { slug: string | null }) => __ipc("soul-market:apply", 1, [input]),
  /* Laya 智能判断：服务/安装状态（pip 包 + laya-serve 进程 + 权重就绪） */
  layaStatus: () => __ipc("laya:status", 0, []),
  /* 安装/更新 laya[serve]（pip 清华镜像；torch 大，20 分钟超时）；权重由服务首启时经 hf-mirror 拉取 */
  layaInstall: () => __ipc("laya:install", 0, []),
  /* 卸载 Laya（先停服务进程，再 pip uninstall -y laya）；模型权重缓存在用户 HF 缓存目录，不随卸载删除（其他工具可能共用） */
  layaUninstall: () => __ipc("laya:uninstall", 0, []),
  /* 思考等级自动判断（choice: low/medium/high/xhigh + 校准置信度；置信 <0.45 弃权返回 null，调用方回落手选档） */
  layaDecideEffort: (text: string) => __ipc("laya:decide-effort", 1, [text]),
  /* 10-03：Codex 官方插件市场（GitHub openai/plugins，gh-proxy 镜像优先）。installedDir 由主进程注入 —— 「装没装」的真相源是本地 marker；live=false 表示上游没连通、这次读的是内置快照 */
  listOfficialMarketPlugins: (input: unknown = {}) => __ipc("codex-official-market:list", 0, [input]),
  /* 官方源的 10 个分类（含每类数量）。⛔ 与 Gitee 镜像源的分类各算各的，tab 按源切换 */
  listOfficialMarketCategories: () => __ipc("codex-official-market:categories", 0, []),
  /* 镜像下载 plugins/<slug> 子树 → 写本地市场目录 → 注册 [marketplaces.codex-official-market] → 引擎 plugin/install + 重启 → plugin/list 确认；进度走 harness:event 的 official-plugin-install（⛔ 不与 plugin-install 共用 type，上游 slug 有重名） */
  installOfficialMarketPlugin: (plugin: unknown) => __ipc("codex-official-market:install", 1, [plugin]),
  /* 先请引擎 plugin/uninstall（认领时才生效），再删落盘目录 + 摘本地 marketplace 清单；删除目标经 safeFolder 归一 + 目录内校验 */
  uninstallOfficialMarketPlugin: (slug: unknown) => __ipc("codex-official-market:uninstall", 1, [slug]),
  /* 本地已装官方插件（**只扫本地目录、零网络**）：补齐「引擎没认领、但文件已落盘」的那批，不能走 list（那条要拉上游 65 条） */
  listInstalledOfficialMarketPlugins: () => __ipc("codex-official-market:installed", 0, []),
  /* 10-04 阶段 6 宿主域清单（启用/停用状态 + 是否 essential） */
  domainsList: () => __ipc("domains:list", 0, []) as Promise<{ domains: Array<{ id: string; mounted: boolean; disabled: boolean; essential: boolean }>; essentialDomains: string[]; requiresRestart: boolean }>,
  /* 10-04 阶段 6 停用/启用宿主域（下次启动生效，essential 域拒绝） */
  domainsSetEnabled: (input: { id: string; enabled: boolean }) => __ipc("domains:set-enabled", 1, [input]) as Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>,
  /* 10-04 「重启才生效」的话术由主进程出，禁在前端硬编码 */
  domainsReloadHint: () => __ipc("domains:reload-hint", 0, []) as Promise<{ requiresRestart: boolean; text: string }>,
  /* 10-04 B档 声明式插件清单（外部 JSON，含无效条目报告与两个目录路径） */
  declaredPluginsList: () => __ipc("declared-plugins:list", 0, []) as Promise<any>,
  /* 10-04 启停声明式插件（插槽即时生效，无需重启） */
  declaredPluginsToggle: (input: { id: string; enabled: boolean }) => __ipc("declared-plugins:toggle", 1, [input]) as Promise<{ ok: boolean; error?: string; id?: string; enabled?: boolean; requiresRestart?: boolean }>,
  /* 10-04 打开用户插件目录（不存在则创建） */
  declaredPluginsOpenDirs: () => __ipc("declared-plugins:open-dirs", 0, []) as Promise<{ ok: boolean; error?: string; userDir?: string; builtinDir?: string }>,
  /* 10-01 新增：项目级本地知识库（<项目>/.codex-harness/knowledge/） */
  listKnowledgeDocs: (input?: { workspace?: string }) => __ipc("kb:list", 0, [input]),
  addKnowledgeText: (input: { workspace?: string; title?: string; text?: string; source?: string }) => __ipc("kb:add-text", 0, [input]),
  addKnowledgeFiles: (input: { workspace?: string; paths?: string[] }) => __ipc("kb:add-files", 0, [input]),
  removeKnowledgeDoc: (input: { workspace?: string; docId?: string }) => __ipc("kb:remove", 0, [input]),
  searchKnowledge: (input: { workspace?: string; query?: string; limit?: number }) => __ipc("kb:search", 0, [input]),
  readKnowledgeDoc: (input: { workspace?: string; docId?: string }) => __ipc("kb:read", 0, [input]),
  /* 10-04：本地语义后端改按需下载 —— 知识库页卡片据此显示安装入口 */
  getKbEmbedStatus: () => __ipc("kb:embed-status", 0, []),
  /* npm(npmmirror)+模型(hf-mirror)；进度经 runtime:progress(id=kb-embedding) 推送 */
  installKbEmbedBackend: () => __ipc("kb:embed-install", 0, []),
  uninstallKbEmbedBackend: () => __ipc("kb:embed-uninstall", 0, []),
  /* 更新后首次启动的「新功能介绍」—— 该不该弹、弹什么由主进程判定（要点在 electron/whats-new-notes.ts，看过记录在 userData/whats-new.json） */
  whatsNewState: () => __ipc("whatsnew:state", 0, []),
  /* 「知道了」：记下「当前版本已看过」（⛔ 只接受当前版本号 —— 权威值在主进程，渲染层传别的值会被拒） */
  whatsNewAck: (version: string) => __ipc("whatsnew:ack", 1, [version]),
  /* 全量版本要点（新手引导 → 版本更新日志用）：数据同 whats-new-notes.ts 单一真相源；GitHub Release 链接在主进程拼好 */
  whatsNewHistory: () => __ipc("whatsnew:history", 0, []),
  /* 10-09 轮询板块：读「间隔 / 超时上限 / 失败重试次数」（真相源在 userData/poll-settings.json） */
  pollConfigRead: () => __ipc("poll:config-read", 0, []) as Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>,
  /* 10-09 保存轮询配置（会先过钳制：超时≥间隔×2）—— 返回**钳制后**的真值，渲染层照它回显 */
  pollConfigSave: (input: { intervalMs?: number; timeoutMs?: number; maxRetry?: number }) => __ipc("poll:config-save", 0, [input]) as Promise<{ intervalMs: number; timeoutMs: number; maxRetry: number }>,
  /* 10-09 用户在界面上按「中止」→ 主进程的 wait 循环停下（任务本身不会被撤销） */
  pollAbort: (input: { taskId: string }) => __ipc("poll:abort", 1, [input]) as Promise<{ ok: boolean; aborted: boolean }>,
  /* ═══ gen:end ═══ */

  /* 桌面宠物：主进程归约好的九态推送（浮窗订阅它驱动动画；首帧另用 petState() 补水）。
     ⛔ 走 __on 而不是裸 ipcRenderer.on：退订按函数引用精确移除，重复挂载幂等。 */
  onPetSignal: (listener: (signal: unknown) => void) =>
    __on("pet:signal", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
  /* 桌面宠物：**配置**推送（当前宠物包 + 设置）。换宠物 / 改缩放时主进程推它，
     否则已开着的浮窗还画着旧宠物（它只在挂载时读一次设置）。 */
  onPetConfig: (listener: (config: unknown) => void) =>
    __on("pet:config", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),

  // ⛔ mac 适配（09-16）：渲染层此前完全不知道自己跑在什么平台——窗口控制键让位、
  // 平台差异 UI 全靠这个字段。sandboxed preload 里 process.platform 可用。
  platform: process.platform,
onRuntimeProgress: (listener: (event: unknown) => void) =>
    __on("runtime:progress", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
  /* 3D 预览弹窗打开推送（model-viewer 域，10-05）：引擎 harness_tools preview_3d → 主进程
     sendToWindow("model-viewer:open") → 渲染层 ModelViewerBridge 弹窗。推送类手写桥，不在 gen 段。 */
  onModelViewerOpen: (listener: (event: { path: string; title: string }) => void) =>
    __on("model-viewer:open", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload as { path: string; title: string })),
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
