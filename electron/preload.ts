import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("codex", {
  // ⛔ mac 适配（09-16）：渲染层此前完全不知道自己跑在什么平台——窗口控制键让位、
  // 平台差异 UI 全靠这个字段。sandboxed preload 里 process.platform 可用。
  platform: process.platform,
  request: (method: string, params: unknown = {}) => ipcRenderer.invoke("codex:request", method, params),
  respond: (id: string | number, result: unknown) => ipcRenderer.invoke("codex:respond", id, result),
  getUsername: () => ipcRenderer.invoke("user:name"),
  getUserData: () => ipcRenderer.invoke("app:userData"),
  setAwake: (on: boolean) => ipcRenderer.invoke("awake:set", on),
  showNotification: (title: string, body: string) => ipcRenderer.invoke("notify:show", title, body),
  toolStatus: () => ipcRenderer.invoke("tools:status"),
  listRuntimes: () => ipcRenderer.invoke("runtime:list"),
  installRuntime: (id: string) => ipcRenderer.invoke("runtime:install", id) as Promise<{ ok: boolean; guide?: string; runtimes?: unknown[] }>,
  uninstallRuntime: (id: string) => ipcRenderer.invoke("runtime:uninstall", id) as Promise<{ ok: boolean; runtimes?: unknown[] }>,
  onRuntimeProgress: (listener: (event: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on("runtime:progress", handler);
    return () => ipcRenderer.removeListener("runtime:progress", handler);
  },
  openInCloakBrowser: (url: string) => ipcRenderer.invoke("browser:open-cloak", url),
  cloakBrowserStatus: () => ipcRenderer.invoke("browser:cloak-status"),
  remoteStart: () => ipcRenderer.invoke("remote:start"),
  remoteStatus: () => ipcRenderer.invoke("remote:status"),
  remoteDevices: () => ipcRenderer.invoke("remote:devices"),
  remoteSend: (cmd: string) => ipcRenderer.invoke("remote:send", cmd),
  remoteStop: () => ipcRenderer.invoke("remote:stop"),
  remoteQrcode: (botId?: string) => ipcRenderer.invoke("remote:qrcode", botId),
  remotePairState: () => ipcRenderer.invoke("remote:pair-state"),
  remotePairRotate: () => ipcRenderer.invoke("remote:pair-rotate"),
  remoteApprove: (rid: string) => ipcRenderer.invoke("remote:approve", rid),
  remoteDeny: (rid: string) => ipcRenderer.invoke("remote:deny", rid),
  remoteRevoke: (deviceId: string) => ipcRenderer.invoke("remote:revoke", deviceId),
  onRemotePairRequest: (handler: (request: { rid: string; deviceId: string; name: string }) => void) => {
    ipcRenderer.on("remote:pair-request", (_event, request) => handler(request));
    return () => ipcRenderer.removeAllListeners("remote:pair-request");
  },
  botPairState: () => ipcRenderer.invoke("bot:pair-state"),
  botApprove: (rid: string) => ipcRenderer.invoke("bot:approve", rid),
  botDeny: (rid: string) => ipcRenderer.invoke("bot:deny", rid),
  botRevoke: (key: string) => ipcRenderer.invoke("bot:revoke", key),
  onBotPairRequest: (handler: (request: { rid: string; channel: string; chatId: string; name: string }) => void) => {
    ipcRenderer.on("bot:pair-request", (_event, request) => handler(request));
    return () => ipcRenderer.removeAllListeners("bot:pair-request");
  },
  botBindQrcode: (botId: string, botName: string) => ipcRenderer.invoke("bot:bind-qrcode", botId, botName),
  botBindStatus: (code: string) => ipcRenderer.invoke("bot:bind-status", code),
  botBindConsume: (code: string) => ipcRenderer.invoke("bot:bind-consume", code),
  weixinStartLogin: () => ipcRenderer.invoke("weixin:start-login") as Promise<{ qrcodeImg: string; qrcode: string } | null | undefined>,
  weixinPollLogin: () => ipcRenderer.invoke("weixin:poll-login") as Promise<{ status: string; verifyCodeRequired?: boolean; connected?: boolean } | null | undefined>,
  weixinStatus: () => ipcRenderer.invoke("weixin:status") as Promise<{ bound: boolean }>,
  weixinCancelLogin: () => ipcRenderer.invoke("weixin:cancel-login") as Promise<{ ok: boolean }>,
  weixinLogout: () => ipcRenderer.invoke("weixin:logout") as Promise<{ ok: boolean }>,
  telegramLogout: () => ipcRenderer.invoke("telegram:logout") as Promise<{ ok: boolean }>,
  feishuConnect: (appId: string, appSecret: string) => ipcRenderer.invoke("feishu:connect", appId, appSecret) as Promise<{ ok: boolean; name?: string; error?: string }>,
  feishuLogout: () => ipcRenderer.invoke("feishu:logout") as Promise<{ ok: boolean }>,
  dingtalkConnect: (clientId: string, clientSecret: string) => ipcRenderer.invoke("dingtalk:connect", clientId, clientSecret) as Promise<{ ok: boolean; name?: string; error?: string }>,
  dingtalkLogout: () => ipcRenderer.invoke("dingtalk:logout") as Promise<{ ok: boolean }>,
  qqConnect: (appId: string, appSecret: string) => ipcRenderer.invoke("qq:connect", appId, appSecret) as Promise<{ ok: boolean; name?: string; error?: string }>,
  qqQrStart: () => ipcRenderer.invoke("qq:qr-start") as Promise<{ state: string; qr?: string; name?: string; error?: string }>,
  qqQrStatus: () => ipcRenderer.invoke("qq:qr-status") as Promise<{ state: string; qr?: string; name?: string; error?: string }>,
  qqQrCancel: () => ipcRenderer.invoke("qq:qr-cancel") as Promise<{ ok: boolean }>,
  qqLogout: () => ipcRenderer.invoke("qq:logout") as Promise<{ ok: boolean }>,
  feishuQrStart: () => ipcRenderer.invoke("feishu:qr-start") as Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>,
  feishuQrStatus: () => ipcRenderer.invoke("feishu:qr-status") as Promise<{ state: string; qr?: string; userCode?: string; name?: string; error?: string }>,
  feishuQrCancel: () => ipcRenderer.invoke("feishu:qr-cancel") as Promise<{ ok: boolean }>,
  wecomWebhookConnect: (url: string) => ipcRenderer.invoke("wecom-webhook:connect", url) as Promise<{ ok: boolean; name?: string; error?: string }>,
  wecomWebhookLogout: () => ipcRenderer.invoke("wecom-webhook:logout") as Promise<{ ok: boolean }>,
  wecomWebhookTest: (text?: string) => ipcRenderer.invoke("wecom-webhook:test", text) as Promise<{ ok: boolean; error?: string }>,
  botBindingGet: () => ipcRenderer.invoke("bot-binding:get") as Promise<{ wechat: { threadId: string; title: string; updatedAt: number } | null; telegram: { threadId: string; title: string; updatedAt: number } | null }>,
  botsGet: () => ipcRenderer.invoke("bots:get") as Promise<any[]>,
  botsSet: (list: any[]) => ipcRenderer.invoke("bots:set", list) as Promise<{ ok: boolean; count: number }>,
  botBindingSet: (input: { channel: string; threadId: string | null; title?: string }) => ipcRenderer.invoke("bot-binding:set", input) as Promise<{ threadId: string; title: string; updatedAt: number } | null>,
  homeDir: () => ipcRenderer.invoke("app:home-dir") as Promise<string>,
  botStreamGet: () => ipcRenderer.invoke("bot-stream:get") as Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>,
  botStreamSet: (input: { enabled: boolean; thinking: boolean; tools: boolean }) => ipcRenderer.invoke("bot-stream:set", input) as Promise<{ enabled: boolean; thinking: boolean; tools: boolean }>,
  relayToggleAccount: (input: { id: string; disabled: boolean }) => ipcRenderer.invoke("relay:toggle-account", input) as Promise<{ ok: boolean; disabled: boolean }>,
  openaiToggleAccount: (input: { id: string; disabled: boolean }) => ipcRenderer.invoke("openai:toggle-account", input) as Promise<{ ok: boolean; disabled: boolean }>,
  channelsStatus: () => ipcRenderer.invoke("channels:status") as Promise<{ weixin: boolean; telegram: boolean }>,
  telegramConnect: (token: string) => ipcRenderer.invoke("telegram:connect", token) as Promise<{ ok: boolean; username?: string; error?: string }>,
  telegramStatus: () => ipcRenderer.invoke("telegram:status") as Promise<{ bound: boolean }>, 
  ponytailModeGet: () => ipcRenderer.invoke("ponytail:mode:get") as Promise<string>,
  ponytailModeSet: (mode: string) => ipcRenderer.invoke("ponytail:mode:set", mode) as Promise<{ mode: string }>, 
  onRemoteCommand: (listener: (cmd: string) => void) => {
    const handler = (_e: any, cmd: string) => listener(cmd);
    ipcRenderer.on("remote:command", handler);
    return () => ipcRenderer.removeListener("remote:command", handler);
  },
  onRemoteDevice: (listener: (device: { id: string; name: string }) => void) => {
    const handler = (_e: any, device: { id: string; name: string }) => listener(device);
    ipcRenderer.on("remote:device", handler);
    return () => ipcRenderer.removeListener("remote:device", handler);
  },
  writeFile: (path: string, content: string, root: string) => ipcRenderer.invoke("fs:write", { path, content, root }),
  readFile: (path: string) => ipcRenderer.invoke("fs:read", { path }),
  fileExists: (path: string) => ipcRenderer.invoke("fs:exists", { path }),
  chooseDirectory: () => ipcRenderer.invoke("dialog:directory"),
  chooseImages: () => ipcRenderer.invoke("dialog:images"),
  chooseFiles: () => ipcRenderer.invoke("dialog:files"),
  importSkill: () => ipcRenderer.invoke("skills:import"),
  listMarketSkills: (input: unknown = {}) => ipcRenderer.invoke("skills:market-list", input),
  installMarketSkill: (skill: unknown) => ipcRenderer.invoke("skills:market-install", skill),
  installMarketSkillLight: (skill: unknown) => ipcRenderer.invoke("skills:market-install-light", skill) as Promise<{ name: string; discovered: boolean; engineCheckMessage: string }>,
  skillDisciplineGet: () => ipcRenderer.invoke("skill-discipline:get") as Promise<{ present: boolean; section: string }>,
  listMarketPlugins: (input: unknown = {}) => ipcRenderer.invoke("plugins:market-list", input),
  installMarketPlugin: (plugin: unknown) => ipcRenderer.invoke("plugins:market-install", plugin),
  listLocalSkills: () => ipcRenderer.invoke("skills:local-list"),
  setEnabledSkill: (input: { folder: string; enabled: boolean }) => ipcRenderer.invoke("skills:set-enabled", input),
  setEnabledSkillBatch: (input: { folders: string[]; enabled: boolean }) => ipcRenderer.invoke("skills:set-enabled-batch", input),
  setPluginEnabled: (input: { pluginIds: string[]; enabled: boolean }) => ipcRenderer.invoke("plugins:set-enabled", input),
  removeLocalSkill: (input: { folder: string; name?: string }) => ipcRenderer.invoke("skills:local-remove", input),
  trustHooks: (cwds?: string[]) => ipcRenderer.invoke("hooks:trust", { cwds }),
  setHookEnabled: (input: { hookKeys: string[]; enabled: boolean }) => ipcRenderer.invoke("hooks:set-enabled", input),
  setPluginLinkedEnabled: (input: { pluginId: string; enabled: boolean }) => ipcRenderer.invoke("plugins:set-linked-enabled", input),
  listConnectors: () => ipcRenderer.invoke("connectors:list"),
  listConnectorTemplates: () => ipcRenderer.invoke("connectors:templates"),
  saveConnector: (input: unknown) => ipcRenderer.invoke("connectors:save", input),
  removeConnector: (id: string) => ipcRenderer.invoke("connectors:remove", id),
  setConnectorsEnabled: (ids: string[], enabled: boolean) => ipcRenderer.invoke("connectors:set-enabled", { ids, enabled }),
  startConnectorOAuth: (input: unknown) => ipcRenderer.invoke("connectors:oauth-start", input),
  cancelConnectorOAuth: (templateId: string) => ipcRenderer.invoke("connectors:oauth-cancel", templateId),
  onConnectorOAuth: (listener: (event: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on("connectors:oauth-event", handler);
    return () => ipcRenderer.removeListener("connectors:oauth-event", handler);
  },
  readClipboardImage: () => ipcRenderer.invoke("clipboard:image"),
  // 粘贴的长文本落盘成 .txt（超过阈值时输入框显示为文件 chip，见 composer-attachments.mjs）
  savePastedText: (text: string) => ipcRenderer.invoke("pasted-text:save", text),
  /** 读粘贴文本：`editable:false` 表示不是应用保存的粘贴文本（渲染层回退普通文件预览） */
  readPastedText: (path: string) => ipcRenderer.invoke("pasted-text:read", path),
  /** 保存编辑后的粘贴文本（仅限应用自己的粘贴文本目录） */
  updatePastedText: (path: string, content: string) => ipcRenderer.invoke("pasted-text:update", { path, content }),
  readMcpServerOverrides: () => ipcRenderer.invoke("mcp-servers:overrides"),
  setMcpServersEnabled: (ids: string[], enabled: boolean) => ipcRenderer.invoke("mcp-servers:set-enabled", { ids, enabled }),
  readMcpToolPermissions: () => ipcRenderer.invoke("mcp-servers:permissions"),
  setMcpToolPermission: (server: string, tool: string, mode: "deny" | "ask" | "allow" | null) => ipcRenderer.invoke("mcp-servers:set-tool-permission", { server, tool, mode }),
  readPersonalization: () => ipcRenderer.invoke("personalization:read"),
  savePersonalization: (input: { nickname?: string; customInstructions?: string }) => ipcRenderer.invoke("personalization:save", input),
  readAppSettings: () => ipcRenderer.invoke("appSettings:read"),  saveAppSettings: (patch: { webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean; downloadSource?: "auto" | "mirror" | "ghproxy" | "ghfast" | "direct" | "proxy" }) => ipcRenderer.invoke("appSettings:save", patch),
  themeApply: (theme: string) => ipcRenderer.invoke("theme:apply", theme),
  // 自更新：网页源（https://www.jvszzp.ltd 发布站）/ GitHub Releases 双源可切换，stable 通道
  updateCheck: () => ipcRenderer.invoke("updates:check") as Promise<{ ok: boolean; info?: { hasUpdate: boolean; version?: string; filename?: string; size?: number; sha256?: string; changelog?: string; mandatory?: boolean; downloadUrl?: string; reason?: string }; currentVersion?: string; source?: string; error?: string }>,
  updateDownload: (input: { downloadUrl: string; filename?: string }) => ipcRenderer.invoke("updates:download", input) as Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>,
  updateInstall: (filePath: string) => ipcRenderer.invoke("updates:install", filePath) as Promise<{ ok: boolean; error?: string }>,
  updateReveal: (filePath: string) => ipcRenderer.invoke("updates:reveal", filePath) as Promise<{ ok: boolean }>,
  /** 订阅下载进度（0~1），返回取消订阅函数 */
  updateOnProgress: (callback: (percent: number) => void) => {
    const listener = (_event: unknown, percent: number) => callback(percent);
    ipcRenderer.on("updates:download-progress", listener);
    return () => { ipcRenderer.removeListener("updates:download-progress", listener); };
  },
  listSshServers: () => ipcRenderer.invoke("ssh:list"),
  saveSshServer: (server: unknown) => ipcRenderer.invoke("ssh:save", server),
  deleteSshServer: (id: string) => ipcRenderer.invoke("ssh:delete", id),
  setSshServerEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("ssh:set-enabled", { id, enabled }),
  testSshServer: (server: unknown) => ipcRenderer.invoke("ssh:test", server),
  execSshCommand: (server: unknown, command: string) => ipcRenderer.invoke("ssh:exec", { server, command }),
  deleteSshServers: (ids: string[]) => ipcRenderer.invoke("ssh:delete", ids),
  setSshServersEnabled: (ids: string[], enabled: boolean) => ipcRenderer.invoke("ssh:set-enabled", { ids, enabled }),
  sshSessionOpen: (server: unknown, cols: number, rows: number) => ipcRenderer.invoke("ssh:session-open", { server, cols, rows }),
  sshSessionWrite: (sessionId: string, data: string) => ipcRenderer.invoke("ssh:session-write", { sessionId, data }),
  sshSessionResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke("ssh:session-resize", { sessionId, cols, rows }),
  sshSessionClose: (sessionId: string) => ipcRenderer.invoke("ssh:session-close", sessionId),
  exportSshServers: (servers: unknown[], includeSecrets: boolean) => ipcRenderer.invoke("ssh:export", { servers, includeSecrets }),
  importSshServers: () => ipcRenderer.invoke("ssh:import"),
  exportThreadsBackup: (threadIds?: string[]) => ipcRenderer.invoke("threads:export", threadIds ? { threadIds } : undefined),
  exportThreadsMarkdown: (threadIds?: string[]) => ipcRenderer.invoke("threads:export-markdown", threadIds ? { threadIds } : undefined),
  previewConversation: (threadId: string) => ipcRenderer.invoke("threads:preview-conversation", threadId),
  importThreadsBackup: () => ipcRenderer.invoke("threads:import"),
  importConversationMarkdown: (input?: { cwd?: string; model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; personality?: string | null }) => ipcRenderer.invoke("threads:import-conversation", input),
  chooseSshKey: (startPath?: string) => ipcRenderer.invoke("dialog:ssh-key", startPath),
  onSshData: (listener: (payload: { data: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { data: string }) => listener(payload);
    ipcRenderer.on("ssh:data", handler);
    return () => ipcRenderer.removeListener("ssh:data", handler);
  },
  onSshExit: (listener: (payload: { code?: number; signal?: string; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { code?: number; signal?: string; error?: string }) => listener(payload);
    ipcRenderer.on("ssh:exit", handler);
    return () => ipcRenderer.removeListener("ssh:exit", handler);
  },
  setNickname: (nickname: string) => ipcRenderer.invoke("personalization:setNickname", nickname),
  verifyPersonalization: () => ipcRenderer.invoke("personalization:verify"),
  listCommands: (input: { cwd?: string } = {}) => ipcRenderer.invoke("commands:list", input),
  readCommand: (filePath: string) => ipcRenderer.invoke("commands:read", filePath),
  saveCommand: (input: unknown) => ipcRenderer.invoke("commands:save", input),
  deleteCommand: (filePath: string) => ipcRenderer.invoke("commands:delete", filePath),
  expandCommand: (input: { filePath: string; argument?: string; cwd?: string }) => ipcRenderer.invoke("commands:expand", input),
  getCustomModel: () => ipcRenderer.invoke("custom-model:read"),
  // 协议桥状态：引擎只发 Responses，若上游只支持 Chat Completions 则由桥本地转换（详见 electron/responses-bridge.ts）
  bridgeStatus: () => ipcRenderer.invoke("bridge:status"),
  probeCustomModel: (config: unknown) => ipcRenderer.invoke("custom-model:probe", config),
  readModelSpecs: () => ipcRenderer.invoke("model-specs:read"),
  saveCustomModel: (config: unknown) => ipcRenderer.invoke("custom-model:save", config),
  listCustomModels: () => ipcRenderer.invoke("custom-model:list"),
  selectCustomModel: (providerId: string) => ipcRenderer.invoke("custom-model:select", providerId),
  setProviderModel: (input: { provider: string; model: string; apply?: boolean; restart?: boolean }) => ipcRenderer.invoke("custom-model:set-model", input),
  setProviderEffort: (input: { provider: string; model: string; effort: string }) => ipcRenderer.invoke("custom-model:set-effort", input),
  // 会话运行时配置（模型/档位/权限）：主进程权威存放处 + 多窗口并发保护（09-14）
  getThreadRuntime: (threadId: string) => ipcRenderer.invoke("thread-runtime:get", threadId),
  listThreadRuntimes: () => ipcRenderer.invoke("thread-runtime:list"),
  seedThreadRuntime: (input: { threadId: string; runtime: unknown }) => ipcRenderer.invoke("thread-runtime:seed", input),
  patchThreadRuntime: (input: { threadId: string; patch: unknown; baseRev?: number; takeover?: boolean }) => ipcRenderer.invoke("thread-runtime:patch", input),
  dispatchOwner: () => ipcRenderer.invoke("thread-runtime:dispatch-owner"),
  releaseDispatch: (threadId: string) => ipcRenderer.invoke("thread-runtime:release-dispatch", threadId),
  threadRole: (threadId: string) => ipcRenderer.invoke("agents:thread-role", threadId),
  writeClipboard: (text: string) => ipcRenderer.invoke("clipboard:write", text),
  createScratchDir: () => ipcRenderer.invoke("scratch:create"),
  saveIdentity: (input: Record<string, string>) => ipcRenderer.invoke("personalization:save-identity", input),
  applyCustomModel: () => ipcRenderer.invoke("custom-model:apply"),
  upsertProviderModel: (input: { provider: string; model: unknown }) => ipcRenderer.invoke("custom-model:upsert-model", input),
  removeProviderModel: (input: { provider: string; modelId: string }) => ipcRenderer.invoke("custom-model:remove-model", input),
  setProviderEnabled: (input: { provider: string; enabled: boolean }) => ipcRenderer.invoke("custom-model:set-enabled", input),
  removeCustomModel: (providerId: string) => ipcRenderer.invoke("custom-model:remove", providerId),
  getChannelBot: () => ipcRenderer.invoke("channel-bot:read"),
  saveChannelBot: (config: unknown) => ipcRenderer.invoke("channel-bot:save", config),
  testChannelBot: (config: unknown) => ipcRenderer.invoke("channel-bot:test", config),
  listMemory: (category?: string) => ipcRenderer.invoke("memory:list", category),
  searchMemory: (query: string) => ipcRenderer.invoke("memory:search", query),
  recallMemory: (query: string, workspace?: string) => ipcRenderer.invoke("memory:recall", query, workspace),
  readMemoryMode: () => ipcRenderer.invoke("memory:mode-read"),
  setMemoryMode: (mode: "local" | "cloud") => ipcRenderer.invoke("memory:mode-set", mode),
  saveMemory: (input: unknown) => ipcRenderer.invoke("memory:save", input),
  listRpaRecipes: () => ipcRenderer.invoke("rpa:list"),
  saveRpaRecipe: (input: unknown) => ipcRenderer.invoke("rpa:save", input),
  deleteRpaRecipe: (id: string) => ipcRenderer.invoke("rpa:delete", id),
  recordRpaRun: (input: { id: string; ok: boolean; error?: string }) => ipcRenderer.invoke("rpa:record", input),
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  addTask: (input: { text: string; priority?: string }) => ipcRenderer.invoke("tasks:add", input),
  updateTask: (input: { id: string; patch: unknown }) => ipcRenderer.invoke("tasks:update", input),
  deleteTask: (id: string) => ipcRenderer.invoke("tasks:delete", id),
  deleteMemory: (id: string) => ipcRenderer.invoke("memory:delete", id),
  resetMemory: () => ipcRenderer.invoke("memory:reset"),
  getMemoryGateway: () => ipcRenderer.invoke("memory:gateway:read"),
  saveMemoryGateway: (config: unknown) => ipcRenderer.invoke("memory:gateway:save", config),
  testMemoryGateway: (config: unknown) => ipcRenderer.invoke("memory:gateway:test", config),
  readMemoryLayers: (workspace?: string) => ipcRenderer.invoke("memory:layers:read", workspace),
  readMemoryContext: (workspace?: string, includeWorkspace = true) => ipcRenderer.invoke("memory:layers:context", workspace, includeWorkspace),
  writeMemoryLayer: (input: { scope: "user" | "background" | "project"; content: string; workspace?: string }) => ipcRenderer.invoke("memory:layers:write", input),
  readWorkspaceMemoryEnabled: (workspace?: string) => ipcRenderer.invoke("memory:workspace-enabled:read", workspace),
  setWorkspaceMemoryEnabled: (input: { workspace: string; enabled: boolean }) => ipcRenderer.invoke("memory:workspace-enabled:set", input),
  distillMemory: (workspace?: string) => ipcRenderer.invoke("memory:distill", workspace),
  listScheduledTasks: () => ipcRenderer.invoke("scheduler:list"),
  saveScheduledTask: (input: unknown) => ipcRenderer.invoke("scheduler:save", input),
  deleteScheduledTask: (id: string) => ipcRenderer.invoke("scheduler:delete", id),
  runScheduledTask: (id: string) => ipcRenderer.invoke("scheduler:run", id),
  listSubAgents: () => ipcRenderer.invoke("subagents:list"),
  saveSubAgent: (input: unknown) => ipcRenderer.invoke("subagents:save", input),
  removeSubAgent: (id: string) => ipcRenderer.invoke("subagents:remove", id),
  invokeSubAgent: (input: unknown) => ipcRenderer.invoke("subagents:invoke", input),
  // 调度（09-15）：Codex 在会话里调度 专家/专家团/子智能体
  listDispatchCatalog: () => ipcRenderer.invoke("agents:catalog"),
  dispatchToolDescription: () => ipcRenderer.invoke("agents:tool-description"),
  dispatchNotice: () => ipcRenderer.invoke("agents:notice"),
  dispatchOffNotice: () => ipcRenderer.invoke("agents:off-notice"),
  listDelegates: () => ipcRenderer.invoke("agents:delegated"),
  listDelegatesOf: (originThreadId: string) => ipcRenderer.invoke("agents:delegated-of", originThreadId),
  invokeAgent: (input: unknown) => ipcRenderer.invoke("agents:invoke", input),
  archiveDelegates: (input: unknown) => ipcRenderer.invoke("agents:archive", input),
  listExpertTeams: () => ipcRenderer.invoke("teams:list"),
  saveExpertTeam: (input: unknown) => ipcRenderer.invoke("teams:save", input),
  removeExpertTeam: (teamId: string) => ipcRenderer.invoke("teams:remove", teamId),
  resetExpertTeams: () => ipcRenderer.invoke("teams:reset-defaults"),
  getTeamTools: (teamId: string) => ipcRenderer.invoke("teams:tools", teamId),
  getTeamSessionConfig: (teamId: string) => ipcRenderer.invoke("teams:session-config", teamId),
  startTeamSession: (input: unknown) => ipcRenderer.invoke("teams:start-session", input),  startTeamMemberSession: (input: unknown) => ipcRenderer.invoke("teams:member-session", input),
  invokeTeamMember: (input: unknown) => ipcRenderer.invoke("teams:invoke-member", input),
  listTeamRuns: (threadId: string) => ipcRenderer.invoke("team-runs:list", threadId),
  teamThreadsMap: () => ipcRenderer.invoke("team-threads:map"),
  teamOfThread: (threadId: string) => ipcRenderer.invoke("team-threads:team-of", threadId),
  terminalInput: (id: string, data: string) => ipcRenderer.invoke("terminal:input", id, data),
  terminalResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", id, cols, rows),
  restartTerminal: (id: string, cwd?: string) => ipcRenderer.invoke("terminal:restart", id, cwd),
  terminalReady: () => ipcRenderer.invoke("terminal:ready"),
  gitDiff: (cwd: string, scope: string) => ipcRenderer.invoke("git:diff", { cwd, scope }),
  onTerminalData: (listener: (id: string, data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => listener(payload.id, payload.data);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },
  openExternal: (url: string) => ipcRenderer.invoke("external:open", url),
  browserPopout: (url: string) => ipcRenderer.invoke("browser:popout", url),
  shellReveal: (target: string) => ipcRenderer.invoke("shell:reveal", target),
  writeClipboardImage: (filePath: string) => ipcRenderer.invoke("clipboard:write-image", filePath),
  readClipboardFiles: () => ipcRenderer.invoke("clipboard:read-files"),
  doctor: (cwd?: string) => ipcRenderer.invoke("app:doctor", { cwd }),
  /** 「当前能力链路」快照：同一件事多个后端时现在实际走哪条、其余为什么没走 */
  capabilitiesSnapshot: () => ipcRenderer.invoke("capabilities:snapshot"),
  engineInfo: () => ipcRenderer.invoke("app:engine-info"),
  perfCounters: () => ipcRenderer.invoke("app:perf-counters") as Promise<{ rolloutFallbackScans: number; droppedForInactiveSession: number; threadListRequests: number }>,
  /** 标记身份引导已打过招呼（此后新会话不再引导、直接干活） */
  markIdentityGreeted: () => ipcRenderer.invoke("personalization:mark-greeted"),
  setActiveThread: (threadId: string | null) => ipcRenderer.invoke("codex:set-active-thread", threadId) as Promise<{ ok: boolean }>,
  /** 独立会话弹窗：把会话开到新窗口（返回已聚焦=true 表示该会话已有弹窗） */
  popoutThread: (threadId: string) => ipcRenderer.invoke("window:popout-thread", threadId) as Promise<{ ok: boolean; focused?: boolean }>,
  /** 弹窗返回主应用：关闭本弹窗并把主窗口带到指定会话 */
  popoutClose: (threadId: string | null) => ipcRenderer.invoke("window:popout-close", threadId) as Promise<{ ok: boolean }>,
  /** 当前窗口是否是独立会话弹窗（主进程按 URL query 判定） */
  popoutThreadId: () => ipcRenderer.invoke("window:popout-id"),
  /** 所有弹窗锁定的会话 id（主窗口据此隐藏侧栏会话，避免重复渲染） */
  popoutList: () => ipcRenderer.invoke("window:popout-list") as Promise<string[]>,
  storageInfo: () => ipcRenderer.invoke("app:storage-info"),
  storageClear: (target: "engine-log" | "images") => ipcRenderer.invoke("app:storage-clear", target),
  engineCheckUpdate: () => ipcRenderer.invoke("engine:check-update"),
  enginePerformUpdate: () => ipcRenderer.invoke("engine:perform-update"),
  /** 重启台账：查「是谁触发了引擎重启、当时有没有任务在跑」（诊断"莫名断了"用）。 */
  engineRestartLog: () => ipcRenderer.invoke("engine:restart-log"),
  /** 当前活跃回合数（0 = 引擎可安全重启；验收/诊断用）。 */
  engineActiveTurns: () => ipcRenderer.invoke("engine:active-turns"),
  /** 引擎重启被闸门推迟 / 已补做（渲染层据此提示：改动将在当前任务结束后生效）。 */
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
  relaunchApp: () => ipcRenderer.invoke("app:relaunch"),
  onEngineUpdateProgress: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on("engine:update:progress", handler);
    return () => ipcRenderer.removeListener("engine:update:progress", handler);
  },
  readBuiltinPlugins: () => ipcRenderer.invoke("builtin:read"),
  saveBuiltinPlugins: (cfg: unknown) => ipcRenderer.invoke("builtin:save", cfg),
  probeBuiltinModels: (input: { kind: "image" | "vision"; baseUrl: string; apiKey: string }) => ipcRenderer.invoke("builtin:probe", input),
  generateImage: (input: { baseUrl: string; apiKey: string; model: string; prompt: string }) => ipcRenderer.invoke("builtin:generate-image", input),
  describeImage: (input: { baseUrl: string; apiKey: string; model: string; imageUrl: string; prompt?: string }) => ipcRenderer.invoke("builtin:describe-image", input),
  relayLogin: (input: { baseUrl: string; email: string; password: string }) => ipcRenderer.invoke("relay:login", input),
  relayLoadAccount: () => ipcRenderer.invoke("relay:load-account"),
  relayLogout: () => ipcRenderer.invoke("relay:logout"),
  relayAccounts: () => ipcRenderer.invoke("relay:accounts"),
  relaySwitchAccount: (id: string) => ipcRenderer.invoke("relay:switch-account", id),
  relayRemoveAccount: (id: string) => ipcRenderer.invoke("relay:remove-account", id),
  openaiLoginStart: (input?: { proxy?: string }) => ipcRenderer.invoke("openai:login-start", input ?? {}),
  openaiLoginStatus: () => ipcRenderer.invoke("openai:login-status"),
  openaiLoginCancel: () => ipcRenderer.invoke("openai:login-cancel"),
  openaiUsage: (input?: { email?: string }) => ipcRenderer.invoke("openai:usage", input ?? {}),
  openaiSetProxy: (proxy: string) => ipcRenderer.invoke("openai:set-proxy", proxy),
  openaiModels: () => ipcRenderer.invoke("openai:models"),
  openaiCaptureLogin: () => ipcRenderer.invoke("openai:capture-login"),
  openaiAccounts: () => ipcRenderer.invoke("openai:accounts"),
  openaiAccountRemove: (id: string) => ipcRenderer.invoke("openai:account-remove", id),
  openaiAccountSwitch: (id: string) => ipcRenderer.invoke("openai:account-switch", id),
  openaiImportFile: (input: { contents: string[] }) => ipcRenderer.invoke("openai:import-file", input),
  relayKeysAll: () => ipcRenderer.invoke("relay:keys-all"),
  relayOverview: () => ipcRenderer.invoke("relay:overview"),
  relayCreateKey: (input: { name: string; groupId?: number | null }) => ipcRenderer.invoke("relay:create-key", input),
  relaySelect: (input: { mode: "balance" | "plan"; groupId: number | null; keyId?: number; keyName?: string }) => ipcRenderer.invoke("relay:select", input),
  relayKeyBilling: (input: { baseUrl: string; apiKey: string }) => ipcRenderer.invoke("relay:key-billing", input),
  relayRegister: (input: { baseUrl: string; email: string; password: string; affCode?: string }) => ipcRenderer.invoke("relay:register", input),
  relayPaymentPlans: () => ipcRenderer.invoke("relay:payment-plans"),
  relayOpenPurchase: () => ipcRenderer.invoke("relay:open-purchase"),
  enhancePrompt: (text: string) => ipcRenderer.invoke("prompt:enhance", { text }),
  listTerminals: () => ipcRenderer.invoke("terminal:list"),
  validatePlugin: (target: string) => ipcRenderer.invoke("plugin:validate", { path: target }),
  chooseDirectoryAt: (startPath: string) => ipcRenderer.invoke("dialog:directory-at", startPath),
  onEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on("codex:event", handler);
    return () => ipcRenderer.removeListener("codex:event", handler);
  },
  onChannelBotEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on("channel-bot:event", handler);
    return () => ipcRenderer.removeListener("channel-bot:event", handler);
  },
  onBotBindingChanged: (handler: (bindings: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => handler(value);
    ipcRenderer.on("bot-binding:changed", listener);
    return () => ipcRenderer.removeListener("bot-binding:changed", listener);
  },
  onHarnessEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on("harness:event", handler);
    return () => ipcRenderer.removeListener("harness:event", handler);
  },
  // ---- 语音通话（旁挂新增，不影响任何既有方法） ----
  voiceStatus: () => ipcRenderer.invoke("voice:status") as Promise<{ active: boolean; state: string; runtimeReady: boolean; modelsReady: boolean; threadId: string; lastError: string }>,
  voiceStart: (threadId: string, options?: { mode?: "conversation" | "dictation" }) => ipcRenderer.invoke("voice:start", threadId, options) as Promise<{ ok: boolean; error?: string; status: unknown }>, 
  voiceDictationFinish: () => ipcRenderer.invoke("voice:dictation-finish") as Promise<{ ok: boolean; text?: string; error?: string }>,
  /** 提前端点：识别文本已收尾 + 用户停口 ~0.5s 时调用，立即提交这一句（不等 rule2 静音） */
  voiceEndpointNow: () => ipcRenderer.invoke("voice:endpoint-now") as Promise<{ ok: boolean; text?: string }>,
  voiceStop: () => ipcRenderer.invoke("voice:stop") as Promise<{ ok: boolean }>,
  voiceAudio: (samples: Float32Array) => ipcRenderer.send("voice:audio", samples),
  // TTS 音频走 Base64 字符串跨 Electron IPC；避免 native/external ArrayBuffer 被 structured clone 拒绝。
  voiceSpeak: (text: string, options?: { sid?: number; speed?: number }) => ipcRenderer.invoke("voice:speak", text, options) as Promise<{ ok: boolean; sampleRate?: number; audioBase64?: string; error?: string }>,
  voicePreviewVoice: (input?: { sid?: number; speed?: number; text?: string }) => ipcRenderer.invoke("voice:preview-voice", input) as Promise<{ ok: boolean; sampleRate?: number; audioBase64?: string; error?: string }>, 
  voiceProfilesList: () => ipcRenderer.invoke("voice:profiles-list") as Promise<{ profiles: any[]; zipvoiceReady: boolean }>,
  voiceProfilesImport: () => ipcRenderer.invoke("voice:profiles-import") as Promise<any>,
  voiceProfilesRecord: (input: { samples: number[]; sampleRate: number }) => ipcRenderer.invoke("voice:profiles-record", input) as Promise<any>,
  voiceProfilesSave: (input: { draftFile: string; name: string; refText: string }) => ipcRenderer.invoke("voice:profiles-save", input) as Promise<any>,
  voiceProfilesDelete: (id: string) => ipcRenderer.invoke("voice:profiles-delete", id) as Promise<{ ok: boolean }>,
  voicePresetList: () => ipcRenderer.invoke("voice:preset-list") as Promise<{ presets: { id: string; name: string; desc: string; lang: string; applied: boolean }[] }>,
  voicePresetApply: (presetId: string) => ipcRenderer.invoke("voice:preset-apply", presetId) as Promise<{ ok: boolean; profile?: any; existed?: boolean; error?: string }>,
  voiceProfilesSelect: (id: string) => ipcRenderer.invoke("voice:profiles-select", id) as Promise<{ ok: boolean; profileId: string }>,
  voiceProfilesPreview: (input: { id?: string; text?: string }) => ipcRenderer.invoke("voice:profiles-preview", input) as Promise<any>,
  voiceBarge: () => ipcRenderer.invoke("voice:barge") as Promise<{ ok: boolean }>,
  voicePlaybackDone: () => ipcRenderer.invoke("voice:playback-done") as Promise<{ ok: boolean }>,
  voiceModelsStatus: () => ipcRenderer.invoke("voice:models-status") as Promise<{
    ready: boolean; missing: string[]; readyFiles: number; totalFiles: number;
    bytes: number; root: string;
    repos: { id: string; lastSegment: string }[];
    zipvoice?: { ready: boolean; bytes: number; dir: string };
  }>,
  voiceModelsInstall: () => ipcRenderer.invoke("voice:models-install") as Promise<{ ok: boolean; error?: string }>,
  voiceZipvoiceInstall: () => ipcRenderer.invoke("voice:zipvoice-install") as Promise<{ ok: boolean; error?: string }>,
  voiceZipvoiceCancel: () => ipcRenderer.invoke("voice:zipvoice-cancel") as Promise<{ ok: boolean }>,
  voiceModelsCancel: () => ipcRenderer.invoke("voice:models-cancel") as Promise<{ ok: boolean }>,
  voiceModelsImport: (input: { sourceDir: string }) => ipcRenderer.invoke("voice:models-import", input) as Promise<{ ok: boolean; failures: string[] }>,
  voiceModelsReveal: () => ipcRenderer.invoke("voice:models-reveal") as Promise<string>,
  voiceModelsUninstall: () => ipcRenderer.invoke("voice:models-uninstall") as Promise<{ ok: boolean }>,
  voiceMicPermission: () => ipcRenderer.invoke("voice:mic-permission") as Promise<{ status: string; error?: string }>,
  voiceSettingsGet: () => ipcRenderer.invoke("voice:settings-get") as Promise<{
    settings: {
      tts: { sid: number; speed: number };
      barge: { gateDb: number; mode: "auto" | "manual" };
      modelHost: "auto" | "huggingface" | "hf-mirror";
    };
    ttsVoices: Record<number, string>;
    modelHosts: Record<string, string>;
    modelHostOptions: string[];
  }>,
  voiceSettingsSet: (patch: any) => ipcRenderer.invoke("voice:settings-set", patch) as Promise<{
    tts: { sid: number; speed: number };
    barge: { gateDb: number; mode: "auto" | "manual" };
    modelHost: "auto" | "huggingface" | "hf-mirror";
  }>,
  onVoiceEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on("voice:event", handler);
    return () => ipcRenderer.removeListener("voice:event", handler);
  },
  // 语音通话「按键启动」：全局快捷键（即便应用没聚焦也能唤起）
  voiceHotkeySet: (input: { accelerator: string; enabled?: boolean }) => ipcRenderer.invoke("voice:hotkey-set", input) as Promise<{ ok: boolean; error?: string }>,
  voiceHotkeyGet: () => ipcRenderer.invoke("voice:hotkey-get") as Promise<{ registered: string }>,
  onVoiceHotkey: (listener: (event: { accelerator: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: { accelerator: string }) => listener(value);
    ipcRenderer.on("voice:hotkey", handler);
    return () => ipcRenderer.removeListener("voice:hotkey", handler);
  },
  // 语音唤醒：持续聆听 + 文本匹配唤醒词（会持续占用 CPU）
  voiceWakeStart: () => ipcRenderer.invoke("voice:wake-start") as Promise<{ ok: boolean; error?: string; phrase?: string; hint?: string }>,
  /** 只回「命中没命中」：文本与匹配都留在主进程（旧实现每块回传整坨累积文本 = O(n²) IPC） */
  voiceWakeAudio: (samples: Float32Array) => ipcRenderer.invoke("voice:wake-audio", samples) as Promise<{ ok: boolean; matched: boolean }>,
  voiceWakeReset: () => ipcRenderer.invoke("voice:wake-reset") as Promise<{ ok: boolean }>,
  voiceWakeStop: () => ipcRenderer.invoke("voice:wake-stop") as Promise<{ ok: boolean }>,
  /** 关键词唤醒模型（KWS）：安装/取消/状态（31MB 归档，服务「语音唤醒」） */
  voiceKwsInstall: () => ipcRenderer.invoke("voice:kws-install") as Promise<{ ok: boolean; error?: string }>,
  voiceKwsCancel: () => ipcRenderer.invoke("voice:kws-cancel") as Promise<{ ok: boolean }>,
  voiceKwsStatus: () => ipcRenderer.invoke("voice:kws-status") as Promise<{ ready: boolean }>,
});
