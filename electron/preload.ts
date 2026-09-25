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
  listMarketPlugins: (input: unknown = {}) => __ipc("plugins:market-list", 0, [input]),
  installMarketPlugin: (plugin: unknown) => __ipc("plugins:market-install", 1, [plugin]),
  listLocalSkills: () => __ipc("skills:local-list", 0, []),
  setEnabledSkill: (input: { folder: string; enabled: boolean }) => __ipc("skills:set-enabled", 1, [input]),
  setEnabledSkillBatch: (input: { folders: string[]; enabled: boolean }) => __ipc("skills:set-enabled-batch", 1, [input]),
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
  saveMemory: (input: unknown) => __ipc("memory:save", 1, [input]),
  listRpaRecipes: () => __ipc("rpa:list", 0, []),
  saveRpaRecipe: (input: unknown) => __ipc("rpa:save", 1, [input]),
  deleteRpaRecipe: (id: string) => __ipc("rpa:delete", 1, [id]),
  recordRpaRun: (input: { id: string; ok: boolean; error?: string }) => __ipc("rpa:record", 0, [input]),
  listTasks: () => __ipc("tasks:list", 0, []),
  addTask: (input: { text: string; priority?: string }) => __ipc("tasks:add", 0, [input]),
  updateTask: (input: { id: string; patch: unknown }) => __ipc("tasks:update", 1, [input]),
  deleteTask: (id: string) => __ipc("tasks:delete", 1, [id]),
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
  invokeSubAgent: (input: unknown) => __ipc("subagents:invoke", 1, [input]),
  dispatchToolDescription: () => __ipc("agents:tool-description", 0, []),
  dispatchNotice: () => __ipc("agents:notice", 0, []),
  dispatchOffNotice: () => __ipc("agents:off-notice", 0, []),
  listDelegates: () => __ipc("agents:delegated", 0, []),
  listDelegatesOf: (originThreadId: string) => __ipc("agents:delegated-of", 1, [originThreadId]),
  invokeAgent: (input: unknown) => __ipc("agents:invoke", 1, [input]),
  archiveDelegates: (input: unknown) => __ipc("agents:archive", 1, [input]),
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
  generateImage: (input: { baseUrl: string; apiKey: string; model: string; prompt: string }) => __ipc("builtin:generate-image", 1, [input]),
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
  voiceStop: () => __ipc("voice:stop", 0, []) as Promise<{ ok: boolean }>,
  voiceProfilesImport: () => __ipc("voice:profiles-import", 0, []) as Promise<any>,
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
  /* ═══ gen:end ═══ */

  // ⛔ mac 适配（09-16）：渲染层此前完全不知道自己跑在什么平台——窗口控制键让位、
  // 平台差异 UI 全靠这个字段。sandboxed preload 里 process.platform 可用。
  platform: process.platform,
onRuntimeProgress: (listener: (event: unknown) => void) =>
    __on("runtime:progress", listener, (listener) => (_e: unknown, payload: unknown) => listener(payload)),
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
  // TTS 音频走 Base64 字符串跨 Electron IPC；避免 native/external ArrayBuffer 被 structured clone 拒绝。
onVoiceEvent: (listener: (event: unknown) => void) =>
    __on("voice:event", listener, (listener) => (_event: Electron.IpcRendererEvent, value: unknown) => listener(value)),
  // 语音通话「按键启动」：全局快捷键（即便应用没聚焦也能唤起）
onVoiceHotkey: (listener: (event: { accelerator: string }) => void) =>
    __on("voice:hotkey", listener, (listener) => (_event: Electron.IpcRendererEvent, value: { accelerator: string }) => listener(value)),
  // 语音唤醒：持续聆听 + 文本匹配唤醒词（会持续占用 CPU）
});
