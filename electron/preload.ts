import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("codex", {
  request: (method: string, params: unknown = {}) => ipcRenderer.invoke("codex:request", method, params),
  respond: (id: string | number, result: unknown) => ipcRenderer.invoke("codex:respond", id, result),
  getUsername: () => ipcRenderer.invoke("user:name"),
  getUserData: () => ipcRenderer.invoke("app:userData"),
  setAwake: (on: boolean) => ipcRenderer.invoke("awake:set", on),
  showNotification: (title: string, body: string) => ipcRenderer.invoke("notify:show", title, body),
  toolStatus: () => ipcRenderer.invoke("tools:status"),
  listRuntimes: () => ipcRenderer.invoke("runtime:list"),
  installRuntime: (id: string) => ipcRenderer.invoke("runtime:install", id),
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
  botBindQrcode: (botId: string, botName: string) => ipcRenderer.invoke("bot:bind-qrcode", botId, botName),
  botBindStatus: (code: string) => ipcRenderer.invoke("bot:bind-status", code),
  botBindConsume: (code: string) => ipcRenderer.invoke("bot:bind-consume", code),
  weixinStartLogin: () => ipcRenderer.invoke("weixin:start-login") as Promise<{ qrcodeImg: string; qrcode: string } | null | undefined>,
  weixinPollLogin: () => ipcRenderer.invoke("weixin:poll-login") as Promise<{ status: string; verifyCodeRequired?: boolean; connected?: boolean } | null | undefined>,
  weixinStatus: () => ipcRenderer.invoke("weixin:status") as Promise<{ bound: boolean }>,
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
  listLocalSkills: () => ipcRenderer.invoke("skills:local-list"),
  setEnabledSkill: (input: { folder: string; enabled: boolean }) => ipcRenderer.invoke("skills:set-enabled", input),
  setEnabledSkillBatch: (input: { folders: string[]; enabled: boolean }) => ipcRenderer.invoke("skills:set-enabled-batch", input),
  setPluginEnabled: (input: { pluginIds: string[]; enabled: boolean }) => ipcRenderer.invoke("plugins:set-enabled", input),
  removeLocalSkill: (name: string) => ipcRenderer.invoke("skills:local-remove", name),
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
  readMcpServerOverrides: () => ipcRenderer.invoke("mcp-servers:overrides"),
  setMcpServersEnabled: (ids: string[], enabled: boolean) => ipcRenderer.invoke("mcp-servers:set-enabled", { ids, enabled }),
  readMcpToolPermissions: () => ipcRenderer.invoke("mcp-servers:permissions"),
  setMcpToolPermission: (server: string, tool: string, mode: "deny" | "ask" | "allow" | null) => ipcRenderer.invoke("mcp-servers:set-tool-permission", { server, tool, mode }),
  readPersonalization: () => ipcRenderer.invoke("personalization:read"),
  savePersonalization: (input: { nickname?: string; customInstructions?: string }) => ipcRenderer.invoke("personalization:save", input),
  readAppSettings: () => ipcRenderer.invoke("appSettings:read"),
  saveAppSettings: (patch: { webSearch?: boolean; desktopAutomation?: boolean; browserAutomation?: boolean; engineWatchdog?: boolean }) => ipcRenderer.invoke("appSettings:save", patch),
  // 自更新：网页源（https://www.jvszzp.ltd 发布站）/ GitHub Releases 双源可切换，stable 通道
  updateCheck: (input?: { source?: "web" | "github" }) => ipcRenderer.invoke("updates:check", input) as Promise<{ ok: boolean; info?: { hasUpdate: boolean; version?: string; filename?: string; size?: number; sha256?: string; changelog?: string; mandatory?: boolean; downloadUrl?: string; reason?: string }; currentVersion?: string; serverUrl?: string; source?: string; error?: string }>,
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
  probeCustomModel: (config: unknown) => ipcRenderer.invoke("custom-model:probe", config),
  saveCustomModel: (config: unknown) => ipcRenderer.invoke("custom-model:save", config),
  listCustomModels: () => ipcRenderer.invoke("custom-model:list"),
  selectCustomModel: (providerId: string) => ipcRenderer.invoke("custom-model:select", providerId),
  setProviderModel: (input: { provider: string; model: string }) => ipcRenderer.invoke("custom-model:set-model", input),
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
  readMemoryContext: (workspace?: string) => ipcRenderer.invoke("memory:layers:context", workspace),
  writeMemoryLayer: (input: { scope: "user" | "project"; content: string; workspace?: string }) => ipcRenderer.invoke("memory:layers:write", input),
  distillMemory: (workspace?: string) => ipcRenderer.invoke("memory:distill", workspace),
  listScheduledTasks: () => ipcRenderer.invoke("scheduler:list"),
  saveScheduledTask: (input: unknown) => ipcRenderer.invoke("scheduler:save", input),
  deleteScheduledTask: (id: string) => ipcRenderer.invoke("scheduler:delete", id),
  runScheduledTask: (id: string) => ipcRenderer.invoke("scheduler:run", id),
  listSubAgents: () => ipcRenderer.invoke("subagents:list"),
  saveSubAgent: (input: unknown) => ipcRenderer.invoke("subagents:save", input),
  removeSubAgent: (id: string) => ipcRenderer.invoke("subagents:remove", id),
  invokeSubAgent: (input: unknown) => ipcRenderer.invoke("subagents:invoke", input),
  listExpertTeams: () => ipcRenderer.invoke("teams:list"),
  saveExpertTeam: (input: unknown) => ipcRenderer.invoke("teams:save", input),
  removeExpertTeam: (teamId: string) => ipcRenderer.invoke("teams:remove", teamId),
  resetExpertTeams: () => ipcRenderer.invoke("teams:reset-defaults"),
  getTeamTools: (teamId: string) => ipcRenderer.invoke("teams:tools", teamId),
  getTeamSessionConfig: (teamId: string) => ipcRenderer.invoke("teams:session-config", teamId),
  startTeamSession: (input: unknown) => ipcRenderer.invoke("teams:start-session", input),  startTeamMemberSession: (input: unknown) => ipcRenderer.invoke("teams:member-session", input),
  invokeTeamMember: (input: unknown) => ipcRenderer.invoke("teams:invoke-member", input),
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
  shellReveal: (target: string) => ipcRenderer.invoke("shell:reveal", target),
  doctor: (cwd?: string) => ipcRenderer.invoke("app:doctor", { cwd }),
  engineInfo: () => ipcRenderer.invoke("app:engine-info"),
  engineCheckUpdate: () => ipcRenderer.invoke("engine:check-update"),
  enginePerformUpdate: () => ipcRenderer.invoke("engine:perform-update"),
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
  onHarnessEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on("harness:event", handler);
    return () => ipcRenderer.removeListener("harness:event", handler);
  },
});
