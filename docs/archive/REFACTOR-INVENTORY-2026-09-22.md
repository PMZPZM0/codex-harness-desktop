# Codex Harness Desktop · 架构改造**功能级**明细清单

基线＝公开主仓库 `75a192d`（改造前）｜现状＝改造副本 `6c4f2f7`｜行数口径 `wc -l`｜生成于 2026-09-22（**16:50 复核更新**：§0/§10/§11 数字已对齐实测，原数字为当日午后快照）

**改造总纲**：把巨型文件按**功能域**切小 —— 纯搬迁、零行为改动。所有内容均有原文件对应物，验证判据见 §9。

## 0. 总览

| # | 入口文件 | 改造前 | 改造后 | 降幅 | 内容去向 |
|---|---|---:|---:|---:|---|
| 1 | `src/App.tsx` | 22215 | **21** | 99.9% | 组件体 → `AppView.tsx` + `src/features/app-*/`（底部 60 行 re-export 死面已删） |
| 2 | `electron/main.ts` | 8970 | **1223** | 86% | IPC 域 → `electron/features/`（余 5 handler + 启动链 + 单例） |
| 3 | `src/styles.css` | 25453 | **31** | 100% | 界面区域 → `src/styles/` |
| 4 | `src/features/app-state/useHarnessApp.tsx` | 11190 | **39** | 99.7% | `src/features/app-state/parts/`（9 part → 30 子 hook） |
| 5 | `src/features/app-view/helpers.tsx` | 1636 | **36** | 97.8% | `src/features/app-view/helpers/`（9 模块）+ 死导入已清 |

**拆分产物规模**

| 产物 | 文件数 | 行数 |
|---|---:|---:|
| `electron/features/` | 35 | 8300 |
| `src/features/app-state/parts/`（含 9 组合根 + types + bag-types） | 41 | 17803 |
| `src/features/app-view/helpers/` | 9 | 1410 |
| `src/styles/` | 19 | 25568 |
| **合计** | **104** | **53081** |

## 1. 主进程（Electron）—— 35 个 IPC 域，按功能分组

> `electron/features/` **整个目录都是本次改造产物**（公开仓库里不存在；文件创建分布在 17 个提交里）。
>
> **通道**＝该文件注册的 IPC；**活绑定**＝从 `../main` 取的跨域符号（⛔ 必须只在 handler 体内使用，否则模块顶层求值会踩【91】路径漂移）。

### 1.1 引擎与会话运行时

**6 文件 / 1398 行 / 22 个 IPC 通道**

#### `features/engine-ipc.ts` — 705 行
> 域：thread-runtime(6) / threads(5) / codex(3) / engine(4) / runtime(3) / bridge(1)
- **IPC 通道 22**：`thread-runtime:get`, `thread-runtime:list`, `thread-runtime:seed`, `thread-runtime:patch`, `thread-runtime:dispatch-owner`, `thread-runtime:release-dispatch`, `codex:request`, `codex:respond`, `codex:set-active-thread`, `engine:restart-log`, `engine:active-turns`, `engine:check-update`, `engine:perform-update`, `runtime:list`, `runtime:uninstall`, `runtime:install`, `threads:export`, `threads:export-markdown`, `threads:preview-conversation`, `threads:import`, `threads:import-conversation`, `bridge:status`
- **活绑定 `../main` 10**：`bridgeDial`, `codexHome`, `engineActiveTurnIds`, `mainWindow`, `readCustomModel`, `responsesBridge`, `restrictedThreadRole`, `server`, `threadCwd`, `threadRuntimeStore`
- **顶层符号 10**：`let rendererActiveThreadId`, `fn bridgeRewriteProviderConfig`, `let engineUpdateRunning`, `fn specFor`, `fn runtimeInstalledBySystem`, `fn runtimeList`, `fn runtimeUninstallPath`, `fn npmShimPaths`, `fn runBrowserDownload`, `fn runNpmInstall`

#### `features/dispatch-core.ts` — 160 行
> 域：调度能力的**常驻核心** —— 令牌持久化、内置调度 MCP 服务器的工具面（schema）、
- **活绑定 `../main` 3**：`delegateRegistry`, `readSubAgents`, `teamRunStore`
- **顶层符号 14**：`fn restrictedThreadRole`, `const DISPATCH_FIXED_PORT`, `let dispatchToken`, `let dispatchHttpPort`, `type DispatchProbe`, `const dispatchProbes`, `fn ensureDispatchToken`, `fn stableKey`, `fn dispatchMcpTools`, `let dispatchHttpReady`, `fn buildDispatchCatalog`, `export fn setDispatchHttpPort`, `export fn setDispatchHttpReady`, `export {DISPATCH_FIXED_PORT,buildDispatchCatalog,dispatchHttpPort,dispatchHttpReady,dispatchMcpTools,dispatchProbes,dispatchToken,ensureDispatchToken,restrictedThreadRole,stableKey,DispatchProbe}`

#### `features/dispatch-rpc.ts` — 158 行
> 搬出符号：ensureDispatchHttp / dispatchRpcCall
- **活绑定 `../main` 11**：`DISPATCH_FIXED_PORT`, `delegateRegistry`, `dispatchMcpTools`, `dispatchProbes`, `dispatchToken`, `ensureDispatchToken`, `restrictedThreadRole`, `runDelegatedTask`, `server`, `stableKey`, `threadRuntimeStore`
- **顶层符号 2**：`export fn dispatchRpcCall`, `export fn ensureDispatchHttp`

#### `features/provider-sessions.ts` — 62 行
> 搬出符号：collectSessionProviderIds
- **活绑定 `../main` 2**：`codexHome`, `server`
- **顶层符号 1**：`export fn collectSessionProviderIds`

#### `features/thread-deletion.ts` — 156 行
> 域：永久删除会话的**本地收尾** —— 墓碑（deleted-threads.json）读写 + 磁盘 rollout 清理 +
- **活绑定 `../main` 1**：`codexHome`
- **顶层符号 11**：`fn deletedThreadsFile`, `const DELETED_THREADS_LIMIT`, `const deletedThreadIds`, `let deletedThreadOrder`, `let deletedThreadsLoaded`, `fn loadDeletedThreads`, `fn rememberDeletedThread`, `fn purgeDeletedThread`, `fn healRolloutLineage`, `fn forgetDeletedThreads`, `export {DELETED_THREADS_LIMIT,deletedThreadIds,forgetDeletedThreads,healRolloutLineage,loadDeletedThreads,purgeDeletedThread,rememberDeletedThread}`

#### `features/delegation.ts` — 157 行
> 搬出符号：runDelegatedTask
- **活绑定 `../main` 10**：`bridgeDial`, `buildDispatchCatalog`, `delegateRegistry`, `readCustomModel`, `readSubAgents`, `restrictedThreadRole`, `server`, `threadRuntimeStore`, `turnOutputText`, `waitForTurnCompletion`
- **顶层符号 1**：`export fn runDelegatedTask`

### 1.2 模型与供应商

**7 文件 / 1966 行 / 37 个 IPC 通道**

#### `features/model-custom-ipc.ts` — 644 行
> 域：custom-model(12) / model-specs(1) / openai(12)
- **IPC 通道 25**：`openai:login-start`, `openai:login-status`, `openai:login-cancel`, `openai:usage`, `openai:set-proxy`, `openai:models`, `openai:capture-login`, `openai:import-file`, `openai:accounts`, `openai:toggle-account`, `openai:account-remove`, `openai:account-switch`, `model-specs:read`, `custom-model:read`, `custom-model:probe`, `custom-model:save`, `custom-model:list`, `custom-model:select`, `custom-model:set-model`, `custom-model:set-effort`, `custom-model:apply`, `custom-model:upsert-model`, `custom-model:remove-model`, `custom-model:set-enabled`, `custom-model:remove`
- **活绑定 `../main` 10**：`applyCustomModel`, `codexHome`, `customModelFile`, `normalizeProvider`, `normalizeUpstreamProtocol`, `readCustomModel`, `readCustomModels`, `server`, `upsertCustomModel`, `writeCustomModels`
- **顶层符号 13**：`fn withModels`, `fn isLocalEndpoint`, `fn publicCustomModel`, `type OpenaiLoginState`, `const openaiLogin`, `type OpenaiVaultAccount`, `fn readOpenaiVault`, `fn writeOpenaiVault`, `fn openaiJwtClaims`, `fn openaiImportEntries`, `fn openaiImportPick`, `fn disableOtherCustomProviders`, `fn broadcastProviderActivated`

#### `features/custom-model-apply.ts` — 331 行
> 搬出符号：applyCustomModel
- **活绑定 `../main` 22**：`bridgeDial`, `codexHome`, `collectSessionProviderIds`, `connectorEnv`, `connectorToml`, `devInstructionsInput`, `dispatchHttpPort`, `dispatchToken`, `ensureDispatchHttp`, `escapeToml`, `mcpOverrideEnabled`, `mcpToolRulesOf`, `normalizeProvider`, `readConnectors`, `readCustomModels`, `readMcpOverrides`, `readUserConfigSplit`, `safeConnectorId`, `server`, `upsertCustomModel`, `writeMcpOverrides`, `writeModelCatalogToml`
- **顶层符号 1**：`export fn applyCustomModel`

#### `features/custom-model-probe.ts` — 262 行
> main.ts 通过 import 同名符号衔接 ⇒ 全文调用点一行未动。
- **顶层符号 11**：`let normalizeProvider`, `let readOpenaiAuth`, `let readCustomModel`, `let fetchOpenaiModels`, `let classifyProbeError`, `export fn bindCustomModelProbe`, `export fn buildModelCatalog`, `export fn probeCustomModel`, `export fn probeFetch`, `export const KNOWN_GATEWAY_MODELS`, `export fn describeHttpBody`

#### `features/custom-model-types.ts` — 51 行
- **顶层符号 2**：`export type CustomModelFile`, `export type ProviderModel`

#### `features/openai-auth.ts` — 125 行
> 域：OpenAI 官方订阅账号（auth.json / JWT 解析）/ 多账号 vault 与代理配置文件路径 /
- **活绑定 `../main` 1**：`codexHome`
- **顶层符号 13**：`fn openaiAuthFile`, `fn readOpenaiAuth`, `fn openaiVaultFile`, `fn openaiProxyFile`, `const OPENAI_FALLBACK_MODELS`, `fn readOpenaiProxy`, `let liveProxyCache`, `fn proxyAlive`, `fn resolveLiveProxy`, `fn openaiFetch`, `fn fetchOpenaiModels`, `export {OPENAI_FALLBACK_MODELS,fetchOpenaiModels,openaiAuthFile,openaiFetch,openaiProxyFile,openaiVaultFile,proxyAlive,readOpenaiAuth,readOpenaiProxy,resolveLiveProxy}`, `export fn resetLiveProxyCache`

#### `features/connector-templates.ts` — 127 行
> main.ts 通过 import 同名符号衔接 ⇒ 全文调用点一行未动。
- **顶层符号 5**：`export const BUILTIN_CONNECTOR_TEMPLATES`, `export type ConnectorTemplate`, `export type ConnectorTemplateField`, `export type ConnectorOAuthSpec`, `export type ConnectorOAuthKind`

#### `features/connectors-mcp-ipc.ts` — 426 行
> 域：connectors(7) / mcp-servers(4) / prompt(1)
- **IPC 通道 12**：`prompt:enhance`, `connectors:oauth-start`, `connectors:oauth-cancel`, `connectors:list`, `connectors:templates`, `connectors:save`, `connectors:remove`, `connectors:set-enabled`, `mcp-servers:overrides`, `mcp-servers:set-enabled`, `mcp-servers:permissions`, `mcp-servers:set-tool-permission`
- **活绑定 `../main` 13**：`applyCustomModel`, `codexHome`, `connectorEnv`, `connectorsFile`, `mcpOverrideEnabled`, `oauthSessions`, `readConnectors`, `readCustomModel`, `readMcpOverrides`, `refreshSkillDiscipline`, `safeConnectorId`, `server`, `writeMcpOverrides`
- **顶层符号 11**：`type PublicConnectorConfig`, `fn publicConnector`, `fn writeConnectors`, `const ENHANCE_SYSTEM_PROMPT`, `fn sendOAuthEvent`, `fn closeOAuthSession`, `fn startCallbackServer`, `fn spawnNpx`, `fn startFeishuLogin`, `fn exchangeOAuthToken`, `fn applyOAuthResult`

### 1.3 IM / 渠道接入

**3 文件 / 757 行 / 42 个 IPC 通道**

#### `features/im-channels-ipc.ts` — 205 行
> 域：bot-binding(2) / bots(2) / bot-stream(2) / bot(7) / channel-bot(3) / weixin(5) / telegram(3) / channels(1) / feishu(5) / dingtalk(2) / qq(5) / wecom-webhook(3
- **IPC 通道 42**：`bot-binding:get`, `bots:get`, `bots:set`, `bot-binding:set`, `bot-stream:get`, `bot-stream:set`, `weixin:start-login`, `weixin:poll-login`, `weixin:cancel-login`, `weixin:status`, `weixin:logout`, `telegram:logout`, `channels:status`, `telegram:connect`, `telegram:status`, `feishu:connect`, `feishu:logout`, `dingtalk:connect`, `dingtalk:logout`, `qq:connect`, `qq:qr-start`, `qq:qr-status`, `qq:qr-cancel`, `qq:logout`, `feishu:qr-start`, `feishu:qr-status`, `feishu:qr-cancel`, `wecom-webhook:connect`, `wecom-webhook:logout`, `wecom-webhook:test`, `ponytail:mode:get`, `ponytail:mode:set`, `bot:pair-state`, `bot:approve`, `bot:deny`, `bot:revoke`, `bot:bind-qrcode`, `bot:bind-status`, `bot:bind-consume`, `channel-bot:read`, `channel-bot:save`, `channel-bot:test`
- **活绑定 `../main` 21**：`botPairing`, `botStreamFile`, `botsFile`, `channelBot`, `channelBotBindings`, `channelBotFile`, `channelLogs`, `dingtalkGateway`, `feishuGateway`, `loadBotBindings`, `qqGateway`, `qrSvg`, `readChannelBot`, `remote`, `server`, `telegramBindings`, `telegramGateway`, `wecomWebhookGateway`, `weixinBindings`, `weixinGateway`, `writeBotBindings`
- **顶层符号 4**：`fn publicChannelBot`, `fn normalizeChannelBot`, `fn saveChannelBot`, `let lastBindSession`

#### `features/im-gateways.ts` — 365 行
> 搬出符号：微信/Telegram/飞书/钉钉/QQ/企微 Webhook 六个渠道网关的实例与流式 sink、
- **活绑定 `../main` 4**：`appSourceRoot`, `channelBot`, `channelLogs`, `voiceService`
- **顶层符号 43**：`let weixinGateway`, `const weixinBindings`, `const botStreamSessions`, `const WEIXIN_STREAM_BUDGET`, `const TELEGRAM_STREAM_BUDGET`, `const FEISHU_STREAM_BUDGET`, `const DINGTALK_STREAM_BUDGET`, `const QQ_STREAM_BUDGET`, `fn weixinStreamSink`, `const weixinTypingStops`, `fn startWeixinTyping`, `fn stopWeixinTyping`, `fn feishuStreamSink`, `fn dingtalkStreamSink`, `fn qqStreamSink`, `fn telegramStreamSink`, `fn botStreamPlanFor`, `type BotChannelBinding`, `fn botBindingsFile`, `const channelBotBindings`, `let botBindingsLoaded`, `fn loadBotBindings`, `fn writeBotBindings`, `fn botsFile`, `const telegramGateway`, `const telegramBindings`, `fn channelLog`, `fn persistChannelLog`, `const feishuGateway`, `fn resolveFfmpegPath`, `fn transcodeToWav16k`, `fn handleChannelAudioMessage`, `const dingtalkGateway`, `const qqGateway`, `const wecomWebhookGateway`, `const channelThreadChat`, `const qqReplyContexts`, `const qqLastMsgId`, `const qqLastScene`, `fn recordQqContext`, `export {WEIXIN_STREAM_BUDGET,TELEGRAM_STREAM_BUDGET,FEISHU_STREAM_BUDGET,DINGTALK_STREAM_BUDGET,QQ_STREAM_BUDGET,weixinStreamSink,weixinTypingStops,startWeixinTyping,stopWeixinTyping,feishuStreamSink,dingtalkStreamSink,qqStreamSink,telegramStreamSink,botStreamSessions,botStreamPlanFor,weixinBindings,telegramBindings,botBindingsFile,botBindingsLoaded,loadBotBindings,writeBotBindings,botsFile,channelBotBindings,channelLog,persistChannelLog,channelThreadChat,qqReplyContexts,qqLastMsgId,qqLastScene,recordQqContext,handleChannelAudioMessage,transcodeToWav16k,resolveFfmpegPath,weixinGateway,telegramGateway,feishuGateway,dingtalkGateway,qqGateway,wecomWebhookGateway}`, `export {BotChannelBinding}`, `export fn setWeixinGateway`

#### `features/im-inbound.ts` — 187 行
> 搬出符号：handleChannelMessage / handleWeixinMessage / handleTelegramMessage
- **活绑定 `../main` 18**：`botPairing`, `botStreamSessions`, `channelBotBindings`, `channelLog`, `channelThreadChat`, `dingtalkGateway`, `feishuGateway`, `loadBotBindings`, `qqGateway`, `qqReplyContexts`, `readChannelBot`, `readCustomModel`, `server`, `telegramBindings`, `telegramGateway`, `weixinBindings`, `weixinGateway`, `writeBotBindings`
- **顶层符号 3**：`export fn handleWeixinMessage`, `export fn handleTelegramMessage`, `export fn handleChannelMessage`

### 1.4 设置 / 账户 / 语音 / 记忆

**6 文件 / 1336 行 / 128 个 IPC 通道**

#### `features/settings-app-ipc.ts` — 310 行
> 域：ssh(12) / terminal(5) / browser(3) / git(1) / scratch(1) / pasted-text(3) / appSettings(2) / personalization(6)
- **IPC 通道 33**：`terminal:list`, `browser:open-cloak`, `browser:cloak-status`, `terminal:input`, `terminal:resize`, `terminal:restart`, `terminal:ready`, `git:diff`, `personalization:read`, `personalization:save`, `personalization:save-identity`, `personalization:mark-greeted`, `appSettings:read`, `appSettings:save`, `ssh:list`, `ssh:save`, `ssh:delete`, `ssh:set-enabled`, `ssh:test`, `ssh:exec`, `ssh:session-open`, `ssh:session-write`, `ssh:session-resize`, `ssh:session-close`, `ssh:export`, `ssh:import`, `personalization:setNickname`, `personalization:verify`, `pasted-text:save`, `pasted-text:read`, `pasted-text:update`, `browser:popout`, `scratch:create`
- **活绑定 `../main` 12**：`applyCustomModel`, `codexHome`, `filePreviewAllowed`, `fileStat`, `mainWindow`, `pastedTextDir`, `readCustomModel`, `refreshSkillDiscipline`, `server`, `sshSessions`, `syncEngineWatchdog`, `terminals`
- **顶层符号 3**：`fn terminalFor`, `let cloakStatus`, `fn isInsidePastedTextDir`

#### `features/user-ipc.ts` — 51 行
> 域：user(1) / capabilities(1)
- **IPC 通道 2**：`user:name`, `capabilities:snapshot`
- **活绑定 `../main` 3**：`devInstructionsInput`, `mcpOverrideEnabled`, `readMcpOverrides`
- **顶层符号 1**：`fn collectCapabilityProbe`

#### `features/relay-ipc.ts` — 406 行
> （仅整体缩进 2 空格；跨域符号经 deps 注入：模型域 readCustomModels/upsertCustomModel/
- **IPC 通道 14**：`relay:login`, `relay:load-account`, `relay:accounts`, `relay:toggle-account`, `relay:switch-account`, `relay:remove-account`, `relay:overview`, `relay:create-key`, `relay:select`, `relay:key-billing`, `relay:register`, `relay:payment-plans`, `relay:open-purchase`, `relay:keys-all`
- **顶层符号 5**：`export iface RelayIpcDeps`, `let relayStoreApi`, `export fn readRelayStore`, `export fn writeRelayStore`, `export fn registerRelayIpc`

#### `features/remote-ipc.ts` — 28 行
> 域：remote(11)
- **IPC 通道 11**：`remote:start`, `remote:status`, `remote:devices`, `remote:send`, `remote:stop`, `remote:pair-state`, `remote:pair-rotate`, `remote:approve`, `remote:deny`, `remote:revoke`, `remote:qrcode`
- **活绑定 `../main` 3**：`mainWindow`, `qrSvg`, `remote`

#### `features/voice-ipc.ts` — 440 行
> （仅整体缩进 2 空格；段内 `require("./x")` 改为 `../x`，因为本文件深了一层）。
- **IPC 通道 39**：`voice:status`, `voice:settings-get`, `voice:settings-set`, `voice:start`, `voice:dictation-finish`, `voice:endpoint-now`, `voice:stop`, `voice:audio`, `voice:speak`, `voice:preview-voice`, `voice:hotkey-set`, `voice:hotkey-get`, `voice:wake-start`, `voice:wake-audio`, `voice:wake-reset`, `voice:wake-stop`, `voice:barge`, `voice:playback-done`, `voice:models-status`, `voice:zipvoice-install`, `voice:zipvoice-cancel`, `voice:kws-install`, `voice:kws-cancel`, `voice:kws-status`, `voice:profiles-list`, `voice:preset-list`, `voice:preset-apply`, `voice:profiles-import`, `voice:profiles-record`, `voice:profiles-save`, `voice:profiles-delete`, `voice:profiles-select`, `voice:profiles-preview`, `voice:models-install`, `voice:models-cancel`, `voice:models-import`, `voice:models-reveal`, `voice:models-uninstall`, `voice:mic-permission`
- **顶层符号 1**：`export fn registerVoiceIpc`

#### `features/memory-rpa-ipc.ts` — 101 行
> 域：memory(17) / rpa(4) / tasks(4) / scheduler(4)
- **IPC 通道 29**：`memory:list`, `memory:search`, `memory:recall`, `memory:mode-read`, `memory:mode-set`, `memory:save`, `memory:delete`, `memory:reset`, `memory:gateway:read`, `memory:gateway:save`, `memory:layers:read`, `memory:layers:context`, `memory:workspace-enabled:read`, `memory:workspace-enabled:set`, `memory:layers:write`, `memory:distill`, `rpa:list`, `rpa:save`, `rpa:delete`, `rpa:record`, `tasks:list`, `tasks:add`, `tasks:update`, `tasks:delete`, `memory:gateway:test`, `scheduler:list`, `scheduler:save`, `scheduler:delete`, `scheduler:run`
- **活绑定 `../main` 12**：`applyMemoryMode`, `distillSummarize`, `memoryGatewayFile`, `memoryLayers`, `memoryStore`, `memoryWorkspaceFile`, `readMemoryGateway`, `readMemoryMode`, `readWorkspaceMemorySettings`, `rpaStore`, `scheduler`, `workspaceMemoryEnabled`
- **顶层符号 2**：`fn setWorkspaceMemoryEnabled`, `fn saveMemoryGateway`

### 1.5 技能 / 插件 / 子代理

**2 文件 / 973 行 / 52 个 IPC 通道**

#### `features/builtin-skills-ipc.ts` — 585 行
> 域：builtin(5) / skills(8) / skill-discipline(1) / plugins(4) / plugin(1) / hooks(2) / tools(1)
- **IPC 通道 22**：`builtin:read`, `builtin:save`, `builtin:probe`, `builtin:generate-image`, `builtin:describe-image`, `plugin:validate`, `tools:status`, `skills:import`, `skills:market-list`, `skills:market-install`, `skills:market-install-light`, `skill-discipline:get`, `plugins:market-list`, `plugins:market-install`, `skills:local-list`, `skills:set-enabled`, `skills:set-enabled-batch`, `skills:local-remove`, `hooks:trust`, `hooks:set-enabled`, `plugins:set-linked-enabled`, `plugins:set-enabled`
- **活绑定 `../main` 12**：`applyCustomModel`, `builtinPluginsFile`, `codexHome`, `describeNetworkError`, `dirEntries`, `mainWindow`, `readBuiltinPlugins`, `readCustomModel`, `refreshSkillDiscipline`, `server`, `skillsRegistryFile`, `userSkillsDir`
- **顶层符号 16**：`fn writeBuiltinPlugins`, `fn probeBuiltinModels`, `fn persistGeneratedImage`, `fn generateImageWith`, `fn toImageSource`, `fn describeImageWith`, `type SkillRegistryRecord`, `fn readSkillRegistry`, `fn updateSkillRegistry`, `fn removeFromSkillRegistry`, `fn skillFolderName`, `const skillHubSectionMap`, `fn parseSkillAllowedTools`, `fn setSkillEnabledSilent`, `fn escapeHookKey`, `fn writeHookEnabled`

#### `features/teams-agents-ipc.ts` — 388 行
> 域：team-runs(1) / team-threads(2) / teams(9) / subagents(4) / agents(9) / commands(5)
- **IPC 通道 30**：`team-runs:list`, `team-threads:map`, `team-threads:team-of`, `agents:thread-role`, `commands:list`, `commands:read`, `commands:save`, `commands:delete`, `commands:expand`, `subagents:list`, `subagents:save`, `subagents:remove`, `subagents:invoke`, `teams:list`, `teams:save`, `teams:remove`, `teams:reset-defaults`, `teams:tools`, `teams:session-config`, `teams:start-session`, `teams:member-session`, `teams:invoke-member`, `agents:catalog`, `agents:tool-description`, `agents:notice`, `agents:off-notice`, `agents:delegated`, `agents:delegated-of`, `agents:invoke`, `agents:archive`
- **活绑定 `../main` 14**：`bridgeDial`, `buildDispatchCatalog`, `codexHome`, `delegateRegistry`, `readCustomModel`, `readSubAgents`, `restrictedThreadRole`, `runDelegatedTask`, `server`, `teamRunStore`, `threadCwd`, `turnOutputText`, `waitForTurnCompletion`, `writeSubAgents`
- **顶层符号 3**：`fn safeAgentId`, `const TEAM_TASK_INSTRUCTION`, `const MEMBER_TASK_INSTRUCTION`

### 1.6 工具类 IPC（文件 / 对话框 / 剪贴板 / 系统 / 更新）

**5 文件 / 334 行 / 20 个 IPC 通道**

#### `features/fs-ipc.ts` — 56 行
> 域：**受信任根约束的本地文件读写**（写 / 读预览 / 存在性探测）。
- **IPC 通道 3**：`fs:write`, `fs:read`, `fs:exists`
- **活绑定 `../main` 1**：`isInsideTrustedRoots`

#### `features/dialog-ipc.ts` — 57 行
> 域：**系统文件选择对话框**（渲染层「浏览 / 添加目录 / 选图片 / 选文件 / 选私钥」的入口）。
- **IPC 通道 5**：`dialog:directory`, `dialog:directory-at`, `dialog:images`, `dialog:files`, `dialog:ssh-key`
- **活绑定 `../main` 2**：`mainWindow`, `trustPicked`

#### `features/clipboard-ipc.ts` — 83 行
> 域：**剪贴板读写**（复制截图 / 写文本 / 写图片 / 读文件列表）。
- **IPC 通道 4**：`clipboard:image`, `clipboard:write`, `clipboard:write-image`, `clipboard:read-files`

#### `features/shell-misc-ipc.ts` — 53 行
> 域：**壳族杂项通道** —— 系统通知 / 防休眠 / 外链打开 / 在文件管理器定位。
- **IPC 通道 4**：`notify:show`, `awake:set`, `external:open`, `shell:reveal`
- **活绑定 `../main` 3**：`filePreviewAllowed`, `isInsideOrEqualTrustedRoots`, `mainWindow`
- **顶层符号 1**：`let awakeId`

#### `features/updates-ipc.ts` — 85 行
> 域：**应用更新链**（检查更新 / 下载 / 定位安装包 / 运行安装）。
- **IPC 通道 4**：`updates:check`, `updates:download`, `updates:reveal`, `updates:install`
- **顶层符号 2**：`let lastUpdateInfo`, `let lastVerifiedUpdatePath`

### 1.7 启动与窗口基建

**6 文件 / 1536 行 / 8 个 IPC 通道**

#### `features/boot.ts` — 624 行
> 块内引用的 main 顶层单例/函数走 bindBoot() 注入（boot.ts 里同名声明 ⇒ 调用处一字不改）。
- **顶层符号 70**：`let codexHome`, `let loadDeletedThreads`, `let responsesBridge`, `let userSkillsDir`, `let ensureBuiltinReviewer`, `let refreshSkillDiscipline`, `let readCustomModel`, `let server`, `let isInsideTrustedRoots`, `let placeholderPngResponse`, `let createWindow`, `let filterForRenderer`, `let channelBot`, `let voiceService`, `let syncEngineWatchdog`, `let eventThreadId`, `let purgeDeletedThread`, `let threadRuntimeStore`, `let teamRunStore`, `let delegateRegistry`, `let dispatchProbes`, `let stableKey`, `let engineActiveTurnIds`, `let botStreamSessions`, `let stopWeixinTyping`, `let botStreamPlanFor`, `let botStreamFile`, `let startWeixinTyping`, `let captureBuffers`, `let threadCwd`, `let remoteEventForwarders`, `let internalThreads`, `let workspaceMemoryEnabled`, `let memoryStore`, `let memoryLayers`, `let distillSummarize`, `let resolveLiveProxy`, `let connectorEnv`, `let readConnectors`, `let migrateLegacyRolloutHome`, `let healRolloutLineage`, `let readCustomModels`, `let ensureDispatchHttp`, `let writeModelCatalogToml`, `let devInstructionsInput`, `let ensureDispatchToken`, `let getDispatchToken`, `let applyMemoryMode`, `let scheduler`, `let remote`, `let DISPATCH_FIXED_PORT`, `let mcpOverrideEnabled`, `let readMcpOverrides`, `let escapeToml`, `let applyCustomModel`, `let readMemoryMode`, `let autoInstallGitIfNeeded`, `let healReservedProviderConfig`, `let handleWeixinMessage`, `let channelLogs`, `let persistChannelLog`, `let telegramGateway`, `let feishuGateway`, `let dingtalkGateway`, `let qqGateway`, `let wecomWebhookGateway`, `let readChannelBot`, `let setWeixinGateway`, `export fn bindBoot`, `export fn bootApp`

#### `features/window-factory.ts` — 192 行
> 搬出符号：createWindow / createPopoutWindow
- **活绑定 `../main` 5**：`engineActiveTurnIds`, `installContextMenu`, `notifyPopoutClosed`, `popoutThreadIds`, `titleBarOverlayOptions`
- **顶层符号 2**：`export fn createWindow`, `export fn createPopoutWindow`

#### `features/window-bus.ts` — 89 行
> 为什么独立成模块：`codex:event` / `harness:event` 以及各域自己的进度事件
- **顶层符号 13**：`type BusWindow`, `const primaryWindows`, `const extraWindows`, `export fn registerBusWindow`, `export fn unregisterBusWindow`, `export fn allBusWindows`, `export fn hasBusWindow`, `export fn popoutBusWindows`, `export fn isPopoutWindow`, `export fn broadcastToAll`, `export fn sendToWindow`, `export fn broadcastCodexEvent`, `export fn broadcastHarnessEvent`

#### `features/renderer-fuse.ts` — 103 行
- **活绑定 `../main` 1**：`popoutThreadIds`
- **顶层符号 8**：`export let rendererDroppedEventCount`, `const RENDERER_CROSS_SESSION_METHODS`, `export fn eventThreadId`, `export const rendererActiveByWindow`, `const ACTIVE_THREAD_FRESH_MS`, `export const EVENT_FILTER_ENABLED`, `fn watchedThreadIds`, `export fn filterForRenderer`

#### `features/app-diagnostics.ts` — 236 行
> 域：**应用级诊断与数据管理** —— 环境自检（/doctor）、引擎信息（/debug）、
- **IPC 通道 8**：`app:userData`, `app:home-dir`, `app:doctor`, `app:storage-info`, `app:storage-clear`, `app:perf-counters`, `app:engine-info`, `app:relaunch`
- **活绑定 `../main` 5**：`codexHome`, `customModelFile`, `customModelsFile`, `enrichScanCountSnapshot`, `server`
- **顶层符号 7**：`fn commandOutput`, `fn sizeLabel`, `fn fileStat`, `fn dirEntries`, `fn engineLogFile`, `fn dirSize`, `export {commandOutput,dirEntries,dirSize,engineLogFile,fileStat,sizeLabel}`

#### `features/dev-runtimes.ts` — 292 行
> 搬出符号：DevRuntimeId / DevRuntimeSpec（类型）、devRuntimeSpecs、runtimeInstalls、IS_MAC、
- **活绑定 `../main` 3**：`codexHome`, `engineActiveTurnIds`, `server`
- **顶层符号 21**：`type DevRuntimeId`, `type DevRuntimeSpec`, `const devRuntimeSpecs`, `const runtimeInstalls`, `const IS_MAC`, `const DARWIN_MARKERS`, `const DARWIN_HIDDEN`, `const DARWIN_SPEC_TEXT`, `fn markerRel`, `fn pythonSiteDir`, `fn runtimeInstalled`, `fn runtimeInstaller`, `fn readDownloadSource`, `fn emitRuntimeProgress`, `fn runRuntimeInstaller`, `fn restartServerWhenIdle`, `let toolsWatchDebounce`, `let gitAutoInstallStarted`, `fn autoInstallGitIfNeeded`, `export {DARWIN_HIDDEN,DARWIN_MARKERS,DARWIN_SPEC_TEXT,IS_MAC,autoInstallGitIfNeeded,devRuntimeSpecs,emitRuntimeProgress,markerRel,pythonSiteDir,readDownloadSource,restartServerWhenIdle,runRuntimeInstaller,runtimeInstalled,runtimeInstaller,runtimeInstalls,toolsWatchDebounce}`, `export {DevRuntimeId,DevRuntimeSpec}`

## 2. 渲染层 `app-state/parts/` —— 巨型 hook 按**语句序**切分

原 `useHarnessApp.tsx` 是**一个函数**（11,191 行），无法按符号搬 ⇒ 改用**按序切分**：

```
useHarnessApp.tsx (374 行组合根)
  └─ partNN.tsx (16–25 行组合根)   ← 只能按文件名前缀顺序 import / 调用 / 展开
       └─ partNN/NN-*.tsx (子 hook)  ← 段内含 hook 调用，顺序即 React 契约
```

### `part01.tsx` — 组合根 24 行
原 **1,995 行 / 630 条体内语句** → 6 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart01a()` → `usePart01b()` → `usePart01c()` → `usePart01d()` → `usePart01e()` → `usePart01f()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-session-drafts-voice.tsx` | 374 | 31 | 46 | 会话/线程(23) · 消息/回合(7) · 输入区/草稿(5) |
| `02-composer-attachments-marketplace.tsx` | 312 | 35 | 50 | 技能/插件/市场(61) · 引擎/更新/运行时(6) · 输入区/草稿(5) |
| `03-accounts-connectors-rate-limit.tsx` | 563 | 17 | 50 | 限流/重试/错误(34) · MCP/连接器(22) · 消息/回合(7) |
| `04-optimistic-turn-approval-e2e.tsx` | 353 | 27 | 42 | SSH/终端(28) · 账号/登录/中转(6) · 消息/回合(4) |
| `05-engine-ssh-connectors.tsx` | 384 | 13 | 35 | 引擎/更新/运行时(26) · SSH/终端(18) · 输入区/草稿(4) |
| `06-goals-palette-commands.tsx` | 75 | 12 | 15 | MCP/连接器(10) · 技能/插件/市场(8) · 目标/计划/待办(2) |

- **`part01/01-session-drafts-voice.tsx`** → 子 hook `usePart01a(bag)`；声明 46 个绑定：
  - `[serverStatus, setServerStatus]`, `[popoutThreadId, setPopoutThreadId]`, `[poppedOutThreadIds, setPoppedOutThreadIds]`, `refreshPoppedOut`, `[showLogin, setShowLogin]`, `accountSwitchThreadRef`, `[modelId, setModelId]`, `[effort, setEffort]`, `[bootReady, setBootReady]`, `[threadsLoading, setThreadsLoading]`, `[threads, setThreads]`, `[thread, setThread]`, `switchStartRef`, `switchModeRef`, `switchTurnsRef`, `scrollMemoRef`, `threadRef`, `popoutThreadIdRef`, `threadsRef`, `engineRestartedRef`, `sendingRef`, `activeTurnIdRef`, `[activeTurnId, setActiveTurnId]`, `[runningThreadIds, setRunningThreadIds]`, `runningThreadIdsRef`, `runningTurnIdsRef`, `runningStartedAtRef`, `markThreadRunning`, `markThreadStopped`, `clearRunningThreads`, `finishedTurnIdsRef`, `rememberFinishedTurn`, `needsFullReloadRef`, `[unreadDoneIds, setUnreadDoneIds]`, `unreadDoneIdsRef`, `markThreadDoneUnread`, `clearThreadDoneUnread`, `[workspace, setWorkspace]`, `workspaceRef`, `[prompt, setPrompt]`, `promptRef`, `draftThreadRef`, `draftJustRestoredRef`, `[voiceDictating, setVoiceDictating]`, `dictationBaseRef`, `[attachmentMenuOpen, setAttachmentMenuOpen]`
- **`part01/02-composer-attachments-marketplace.tsx`** → 子 hook `usePart01b(bag)`；声明 50 个绑定：
  - `[attachSubmenu, setAttachSubmenu]`, `[threadFileQuery, setThreadFileQuery]`, `[expertQuery, setExpertQuery]`, `quickMenuRef`, `quickMenuPanelRef`, `[quickMenuFlipUp, setQuickMenuFlipUp]`, `[submenuFlip, setSubmenuFlip]`, `[submenuTop, setSubmenuTop]`, `[quickMenuViewport, setQuickMenuViewport]`, `submenuHoverTimer`, `submenuCloseTimer`, `scheduleSubmenu`, `scheduleSubmenuClose`, `[plusSpinTick, setPlusSpinTick]`, `[enhanceBusy, setEnhanceBusy]`, `enhanceBackupRef`, `enhanceRunIdRef`, `[hasEnhanceBackup, setHasEnhanceBackup]`, `[enhanceHint, setEnhanceHint]`, `enhanceHintTimerRef`, `lastEnhanceHintRef`, `enhanceSendCountRef`, `enhanceHintAfterSendRef`, `enhanceLongFiredRef`, `enhanceHintFiredAtRef`, `attachedFiles`, `[skillMenuOpen, setSkillMenuOpen]`, `[skillQuery, setSkillQuery]`, `[selectedSkills, setSelectedSkills]`, `[localSkills, setLocalSkills]`, `[marketSkills, setMarketSkills]`, `[marketLoading, setMarketLoading]`, `[marketTotal, setMarketTotal]`, `[marketPage, setMarketPage]`, `[marketPageSize]`, `[installingMarketSkill, setInstallingMarketSkill]`, `[pluginInstall, setPluginInstall]`, `[pluginMarketItems, setPluginMarketItems]`, `[pluginMarketLoading, setPluginMarketLoading]`, `[pluginMarketTotal, setPluginMarketTotal]`, `[pluginMarketPage, setPluginMarketPage]`, `[pluginMarketPageSize]`, `[installingMarketPlugin, setInstallingMarketPlugin]`, `[pluginMarketCategory, setPluginMarketCategory]`, `[pluginMarketSearch, setPluginMarketSearch]`, `[mcpMarketCategory, setMcpMarketCategory]`, `[mcpMarketSearch, setMcpMarketSearch]`, `[marketPreview, setMarketPreview]`, `[browserOpenReq, setBrowserOpenReq]`, `openInBrowserPane`
- **`part01/03-accounts-connectors-rate-limit.tsx`** → 子 hook `usePart01c(bag)`；声明 50 个绑定：
  - `[relayBusy, setRelayBusy]`, `[relayActive, setRelayActive]`, `[openaiActiveAcct, setOpenaiActiveAcct]`, `[skillInstall, setSkillInstall]`, `[skillRemove, setSkillRemove]`, `[connectorMenuOpen, setConnectorMenuOpen]`, `[connectors, setConnectors]`, `[connectorDraft, setConnectorDraft]`, `[connectorEditorOpen, setConnectorEditorOpen]`, `[connectorSaving, setConnectorSaving]`, `[connectorSecret, setConnectorSecret]`, `[connectorTemplates, setConnectorTemplates]`, `[connectorTemplateModal, setConnectorTemplateModal]`, `[connectorOAuth, setConnectorOAuth]`, `[connectorTemplateValues, setConnectorTemplateValues]`, `[connectorTemplateSaving, setConnectorTemplateSaving]`, `[memoryConfigOpen, setMemoryConfigOpen]`, `[contextOpen, setContextOpen]`, `[contextQuery, setContextQuery]`, `[contextItems, setContextItems]`, `[quoteItem, setQuoteItem]`, `[images, setImages]`, `[loading, setLoading]`, `[sending, setSending]`, `sendInFlightRef`, `[rateLimitRetries, setRateLimitRetries]`, `[upstreamRetries, setUpstreamRetries]`, `setRetryEntry()`, `retryContextsRef`, `rateLimitAttemptsRef`, `rateLimitTimersRef`, `retryGatesRef`, `effortFallbackRef`, `autoContinueLogRef`, `[, setRateLimitTick]`, `clearRateLimitTimer()`, `armRateLimitRetry()`, `recoverRateLimitCtx()`, `ensureRateLimitCtx()`, `armRetryForQueueRelease()`, `resetSessionRetryState()`, `cancelRateLimitRetry()`, `executeRateLimitRetry()`, `executeEffortFallbackRetry()`, `scheduleRateLimitRetry()`, `compactPendingRef`, `[interrupting, setInterrupting]`, `[optimisticInput, setOptimisticInput]`, `optimisticTurnIdRef`, `optimisticBaselineRef`
- **`part01/04-optimistic-turn-approval-e2e.tsx`** → 子 hook `usePart01d(bag)`；声明 42 个绑定：
  - `sawRunningTurnRef`, `optimisticConfirmed`, `[openingThread, setOpeningThread]`, `[pending, setPending]`, `[diff, setDiff]`, `[tokenUsage, setTokenUsage]`, `tokenUsageRef`, `tokenUsageTotalsRef`, `derivedTokenUsageRef`, `normalizeTokenUsage`, `turnStartedAtRef`, `activeModelRef`, `[usageStats, setUsageStats]`, `streamRafRef`, `pendingDeltaRef`, `lastFlushAtRef`, `[rightOpen, setRightOpen]`, `[desktopAuto, setDesktopAuto]`, `[browserAuto, setBrowserAuto]`, `[autoCompactRatio, setAutoCompactRatio]`, `[hardwareAccel, setHardwareAccel]`, `[downloadSource, setDownloadSource]`, `[adaptiveTone, setAdaptiveTone]`, `[restartPending, setRestartPending]`, `[sshServers, setSshServers]`, `[sshLoaded, setSshLoaded]`, `[sshBusyId, setSshBusyId]`, `[sshTestingId, setSshTestingId]`, `[sshDraft, setSshDraft]`, `[sshSaving, setSshSaving]`, `[sshQuery, setSshQuery]`, `[sshFilter, setSshFilter]`, `[sshChecked, setSshChecked]`, `[sshBatchBusy, setSshBatchBusy]`, `[sshTerminal, setSshTerminal]`, `[sshExecTarget, setSshExecTarget]`, `[sshEditorTest, setSshEditorTest]`, `toggleDesktopAuto`, `toggleBrowserAuto`, `changeAdaptiveTone`, `changeHardwareAccel`, `changeDownloadSource`
- **`part01/05-engine-ssh-connectors.tsx`** → 子 hook `usePart01e(bag)`；声明 35 个绑定：
  - `[engineVersion, setEngineVersion]`, `[engineCheck, setEngineCheck]`, `[engineUpdating, setEngineUpdating]`, `[engineUpdateLog, setEngineUpdateLog]`, `[engineUpdatePercent, setEngineUpdatePercent]`, `[engineUpdateStageText, setEngineUpdateStageText]`, `[engineUpdateResult, setEngineUpdateResult]`, `[relaunchCountdown, setRelaunchCountdown]`, `checkEngineUpdateNow`, `performEngineUpdateNow`, `emptySshJump`, `emptySshDraft`, `sshDraftIssues`, `sshDraftValid`, `sshVisible`, `sshCheckedSet`, `sshToggleChecked`, `saveSshEntry()`, `testSshDraft()`, `toggleSshEntry()`, `toggleSshBatch()`, `testSshEntry()`, `testSshBatch()`, `removeSshEntries()`, `duplicateSshEntry()`, `toggleSshFavorite()`, `exportSshEntries()`, `importSshEntries()`, `[sidebarCollapsed, setSidebarCollapsed]`, `[rightTab, setRightTab]`, `[openTabs, setOpenTabs]`, `[recentlyClosed, setRecentlyClosed]`, `[switcherOpen, setSwitcherOpen]`, `[switcherQuery, setSwitcherQuery]`, `[goalsExpanded, setGoalsExpanded]`
- **`part01/06-goals-palette-commands.tsx`** → 子 hook `usePart01f(bag)`；声明 15 个绑定：
  - `[goalsDocked, setGoalsDocked]`, `[paletteOpen, setPaletteOpen]`, `[paletteQuery, setPaletteQuery]`, `[paletteTab, setPaletteTab]`, `[keepAwake, setKeepAwake]`, `[ctxMenuOpen, setCtxMenuOpen]`, `[skillHubCategory, setSkillHubCategory]`, `[skillHubSearch, setSkillHubSearch]`, `[skillHubFilterCategory, setSkillHubFilterCategory]`, `[skillsManageOnly, setSkillsManageOnly]`, `[connectorSearch, setConnectorSearch]`, `[connectorsManageOnly, setConnectorsManageOnly]`, `[connectorChecked, setConnectorChecked]`, `[connectorStatusBusy, setConnectorStatusBusy]`, `[connectorBatchBusy, setConnectorBatchBusy]`

### `part02.tsx` — 组合根 19 行
原 **2,139 行 / 690 条体内语句** → 4 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart02a()` → `usePart02b()` → `usePart02c()` → `usePart02d()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-mcp-teams-plan.tsx` | 496 | 29 | 69 | 调度/子代理(38) · 目标/计划/待办(16) · 记忆/知识(13) |
| `02-goal-browser-notice.tsx` | 678 | 35 | 56 | 目标/计划/待办(6) · 项目/文件/路径(6) · 会话/线程(4) |
| `03-thread-switch-update.tsx` | 636 | 47 | 62 | 引擎/更新/运行时(33) · 账号/登录/中转(11) · 限流/重试/错误(7) |
| `04-runtime-commands-account.tsx` | 506 | 33 | 54 | 技能/插件/市场(20) · SSH/终端(18) · 引擎/更新/运行时(15) |

- **`part02/01-mcp-teams-plan.tsx`** → 子 hook `usePart02a(bag)`；声明 69 个绑定：
  - `[mcpOverrides, setMcpOverrides]`, `[mcpToolPermissions, setMcpToolPermissions]`, `[mcpServerChecked, setMcpServerChecked]`, `[mcpServerStatusBusy, setMcpServerStatusBusy]`, `[mcpServerBatchBusy, setMcpServerBatchBusy]`, `[mcpServerSearch, setMcpServerSearch]`, `[subAgents, setSubAgents]`, `[subAgentDraft, setSubAgentDraft]`, `[subAgentEditorOpen, setSubAgentEditorOpen]`, `[subAgentRunning, setSubAgentRunning]`, `[rpaRunning, setRpaRunning]`, `[agentAsk, setAgentAsk]`, `[rpaRecipes, setRpaRecipes]`, `[taskList, setTaskList]`, `threadPermPushAtRef`, `appPromptInputRef`, `[appConfirm, setAppConfirm]`, `[appPrompt, setAppPrompt]`, `[memoryPreview, setMemoryPreview]`, `[searchPreview, setSearchPreview]`, `[memoryCenterOpen, setMemoryCenterOpen]`, `[memoryCenterTab, setMemoryCenterTab]`, `[memoryProjectWorkspace, setMemoryProjectWorkspace]`, `[memoryProjectEnabled, setMemoryProjectEnabled]`, `[memoryProjectMenuOpen, setMemoryProjectMenuOpen]`, `memoryProjectPickerRef`, `openAppPrompt()`, `openAppConfirm()`, `[expertTeams, setExpertTeams]`, `[expertTeamDraft, setExpertTeamDraft]`, `[expertTeamEditorOpen, setExpertTeamEditorOpen]`, `[expertTeamRunning, setExpertTeamRunning]`, `[expertTeamMemberRunning, setExpertTeamMemberRunning]`, `[teamRuns, setTeamRuns]`, `[teamPopupRunId, setTeamPopupRunId]`, `[teamHistoryMember, setTeamHistoryMember]`, `[threadTeamId, setThreadTeamId]`, `[teamHistoryRuns, setTeamHistoryRuns]`, `teamRunsRef`, `teamDeltaRef`, `teamFlushRef`, `teamRunningCountRef`, `[teamCwdMap, setTeamCwdMap]`, `[expertTeamMemberDirect, setExpertTeamMemberDirect]`, `teamThreadMapRef`, `teamThreadConfigRef`, `pendingExpertRoleRef`, `EXPERT_ROLE_STORE_KEY`, `rememberExpertRole`, `forgetExpertRole`, `readStoredExpertRole`, `[pendingImportThreads, setPendingImportThreads]`, `rememberPendingImport`, `forgetPendingImport`, `readStoredPendingImport`, `[panelWidth, setPanelWidth]`, `dragWidthRef`, `shellRef`, `startPanelDrag()`, `[planSteps, setPlanSteps]`, `[goalText, setGoalText]`, `[goalsOpen, setGoalsOpen]`, `[doneExpanded, setDoneExpanded]`, `planOnceRef`, `planTurnRef`, `[planArmed, setPlanArmed]`, `[planRunning, setPlanRunning]`, `[planConfirm, setPlanConfirm]`, `[planFeedback, setPlanFeedback]`
- **`part02/02-goal-browser-notice.tsx`** → 子 hook `usePart02b(bag)`；声明 56 个绑定：
  - `[goalStatus, setGoalStatus]`, `[goalsAutoGone, setGoalsAutoGone]`, `goalsPrevRunningRef`, `goalsTaskRunning`, `[reviewBusy, setReviewBusy]`, `[reviewReport, setReviewReport]`, `reviewTurnRef`, `[treePath, setTreePath]`, `[treeEntries, setTreeEntries]`, `[treeChildren, setTreeChildren]`, `[treeExpanded, setTreeExpanded]`, `[treeLoading, setTreeLoading]`, `[browserHome, setBrowserHome]`, `[browserUrl, setBrowserUrl]`, `[browserDraft, setBrowserDraft]`, `[browserMode]`, `[cloakPage, setCloakPage]`, `[cloakStatus, setCloakStatus]`, `[browserBookmarks, setBrowserBookmarks]`, `[browserHistory, setBrowserHistory]`, `[browserDrawer, setBrowserDrawer]`, `[browserMenuOpen, setBrowserMenuOpen]`, `[backupBusy, setBackupBusy]`, `homeSites`, `iframeRef`, `[queue, setQueue]`, `[queueDragIndex, setQueueDragIndex]`, `[mobileNav, setMobileNav]`, `[sidebarFlyout, setSidebarFlyout]`, `[threadRowMenu, setThreadRowMenu]`, `[collapsedSections, setCollapsedSections]`, `toggleSection`, `threadAttention`, `renderThreadRow`, `clusterSplit`, `renderClusterRow`, `renderClusterList`, `[narrow, setNarrow]`, `[approvalPolicy, setApprovalPolicy]`, `[sandbox, setSandbox]`, `[personality, setPersonality]`, `[notices, setNotices]`, `[noticeCenter, setNoticeCenter]`, `[noticeCenterOpen, setNoticeCenterOpen]`, `noticeCenterBtnRef`, `[noticeChecked, setNoticeChecked]`, `noticeCenterUnread`, `noticeSeqRef`, `noticeTimersRef`, `settingsOpenRef`, `[noticeAnchorTick, setNoticeAnchorTick]`, `dismissNotice`, `setNotice`, `[compactToast, setCompactToast]`, `[infoModal, setInfoModal]`, `[highlightedFilePath, setHighlightedFilePath]`
- **`part02/03-thread-switch-update.tsx`** → 子 hook `usePart02c(bag)`；声明 62 个绑定：
  - `buildStamp`, `[lightbox, setLightbox]`, `[pastedText, setPastedText]`, `[systemEvents, setSystemEvents]`, `[hookPulse, setHookPulse]`, `[welcomeScratchDir, setWelcomeScratchDir]`, `[welcomeCwdMenuOpen, setWelcomeCwdMenuOpen]`, `[identityGreeted, setIdentityGreeted]`, `[ponytailOn, setPonytailOn]`, `[channelOnline, setChannelOnline]`, `switchJumpRef`, `switchJumpPending`, `threadCacheRef`, `threadProviderRef`, `autoMigratedRef`, `[switchingThreadId, setSwitchingThreadId]`, `switchSeqRef`, `recentResumeAtRef`, `turnsCursorRef`, `[switchingFading, setSwitchingFading]`, `fadeOutTimerRef`, `switchHardTimerRef`, `[theme, setTheme]`, `[accountMenuOpen, setAccountMenuOpen]`, `[accountMenuSub, setAccountMenuSub]`, `[updateInfo, setUpdateInfo]`, `[updateCurrentVersion, setUpdateCurrentVersion]`, `[updateChecking, setUpdateChecking]`, `[updateError, setUpdateError]`, `[updateDownloading, setUpdateDownloading]`, `[updateProgress, setUpdateProgress]`, `[updateNotice, setUpdateNotice]`, `accountMenuRef`, `runUpdateCheck`, `runUpdateDownload`, `openFeedbackPage`, `[uiLang, setUiLang]`, `[uiZoom, setUiZoom]`, `[uiFont, setUiFont]`, `[settingsOpen, setSettingsOpen]`, `[pptokenCardOff, setPptokenCardOff]`, `[settingsPage, setSettingsPage]`, `[shortcutsOpen, setShortcutsOpen]`, `[helpKey, setHelpKey]`, `[archiveToast, setArchiveToast]`, `[showModelGuide, setShowModelGuide]`, `[quickSetupBusy, setQuickSetupBusy]`, `[quickSetupError, setQuickSetupError]`, `[relaySetupBusy, setRelaySetupBusy]`, `[relaySetupError, setRelaySetupError]`, `modelGuideDoneRef`, `[envCheckOpen, setEnvCheckOpen]`, `[envInstalling, setEnvInstalling]`, `envCheckDoneRef`, `codexIdentity`, `[toolsStatus, setToolsStatus]`, `refreshToolsStatus`, `[devRuntimes, setDevRuntimes]`, `[runtimeInstalling, setRuntimeInstalling]`, `[runtimeProgress, setRuntimeProgress]`, `[runtimePercent, setRuntimePercent]`, `[runtimeStage, setRuntimeStage]`
- **`part02/04-runtime-commands-account.tsx`** → 子 hook `usePart02d(bag)`；声明 54 个绑定：
  - `[runtimeSpeed, setRuntimeSpeed]`, `[runtimeActiveId, setRuntimeActiveId]`, `[runtimeModal, setRuntimeModal]`, `refreshDevRuntimes`, `[capabilityRows, setCapabilityRows]`, `[capabilityError, setCapabilityError]`, `refreshCapabilities`, `installDevRuntime()`, `uninstallDevRuntime()`, `[settingsResources, setSettingsResources]`, `installedTotalCount`, `[resourceLoading, setResourceLoading]`, `[resourceError, setResourceError]`, `[pluginSearch, setPluginSearch]`, `[pluginInstalledOnly, setPluginInstalledOnly]`, `[pluginBusy, setPluginBusy]`, `[pluginBatchBusy, setPluginBatchBusy]`, `[skillBatchBusy, setSkillBatchBusy]`, `[pluginChecked, setPluginChecked]`, `[skillChecked, setSkillChecked]`, `[skillManageSearch, setSkillManageSearch]`, `[customCommands, setCustomCommands]`, `[commandSearch, setCommandSearch]`, `[commandFilter, setCommandFilter]`, `[commandBusy, setCommandBusy]`, `[commandEditor, setCommandEditor]`, `[commandDelete, setCommandDelete]`, `[commandBusyKey, setCommandBusyKey]`, `refreshCommands`, `persistCommand()`, `confirmDeleteCommand()`, `useCommand()`, `[hookTrusting, setHookTrusting]`, `[hookBusy, setHookBusy]`, `[linkedBusy, setLinkedBusy]`, `[projectFilter, setProjectFilter]`, `[username, setUsername]`, `[userAvatar, setUserAvatar]`, `[accountEditing, setAccountEditing]`, `[accountDraft, setAccountDraft]`, `accountNameRef`, `saveAccountName`, `startAccountEdit`, `[greeting, greetSub]`, `[mobileRemoteOpen, setMobileRemoteOpen]`, `[botManagerOpen, setBotManagerOpen]`, `botManagerOpenRef`, `[botStream, setBotStream]`, `updateBotStream`, `[botBindings, setBotBindings]`, `setBotBinding`, `[bots, setBots]`, `[activeBotId, setActiveBotId]`, `setBotsPersist`

### `part03.tsx` — 组合根 23 行
原 **1,914 行 / 410 条体内语句** → 4 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart03a()` → `usePart03b()` → `usePart03c()` → `usePart03d()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-remote-bot-pin.tsx` | 714 | 32 | 46 | MCP/连接器(10) · 消息/回合(4) · 输入区/草稿(2) |
| `02-composer-memory-models.tsx` | 557 | 22 | 33 | 记忆/知识(24) · 输入区/草稿(12) · MCP/连接器(6) |
| `03-restart-file-model-editor.tsx` | 540 | 18 | 25 | 模型/供应商(16) · 项目/文件/路径(5) · 弹窗/浮层/卡片(2) |
| `04-project-groups-cwd-names.tsx` | 289 | 18 | 28 | 项目/文件/路径(15) · 会话/线程(12) · 调度/子代理(4) |

- **`part03/01-remote-bot-pin.tsx`** → 子 hook `usePart03a(bag)`；声明 46 个绑定：
  - `[botChannelPick, setBotChannelPick]`, `[botQr, setBotQr]`, `[remoteUrl, setRemoteUrl]`, `[remoteDevices, setRemoteDevices]`, `[remoteStatus, setRemoteStatus]`, `[remoteCmd, setRemoteCmd]`, `[remoteLog, setRemoteLog]`, `[remoteQr, setRemoteQr]`, `[pairCode, setPairCode]`, `[pairPending, setPairPending]`, `[pairApproved, setPairApproved]`, `loadPairStates`, `[userDataPath, setUserDataPath]`, `[taskMenuOpen, setTaskMenuOpen]`, `[renameDraft, setRenameDraft]`, `[inlineRename, setInlineRename]`, `inlineRenameRef`, `[interruptedTurns, setInterruptedTurns]`, `[stoppedElapsed, setStoppedElapsed]`, `closeTaskMenu`, `[awayFromBottom, setAwayFromBottom]`, `stickToBottomRef`, `anchorTopRef`, `dbg`, `selfScrollUntilRef`, `anchorElRef`, `anchorTurnIdRef`, `contentAnchorTopRef`, `anchorTopOffsetRef`, `anchorHeightBaselineRef`, `anchorSpacerRef`, `anchorPadAppliedRef`, `clearAnchorPad`, `compactSpacerRef`, `contentBottomOf`, `contentTailTarget`, `pinSentMessage`, `pinnedScrollTopRef`, `pinGapLockedRef`, `pinThreadIdRef`, `pinDormantSeenRef`, `pinFixRef`, `pinnedAnchorKeyRef`, `anchorGlideRef`, `glideTo`, `[workStartedAt, setWorkStartedAt]`
- **`part03/02-composer-memory-models.tsx`** → 子 hook `usePart03b(bag)`；声明 33 个绑定：
  - `scrollRef`, `timelineWrapRef`, `searchRef`, `composerInputRef`, `composerWrapRef`, `composerDomValueRef`, `makeComposerChip`, `syncComposerFromDom()`, `messageHandlersRef`, `messageHandlers`, `{ memoryEnabled, memories, setMemories, memoryCategory, …`, `memoryProjectOptions`, `memoryManagementWorkspace`, `memoryEntryBelongsToProject`, `memoryVisibleRecords`, `memoryTitleById`, `memoryGroups`, `memoryGroupsFiltered`, `[memoryLayers, setMemoryLayers]`, `[memoryLayerScope, setMemoryLayerScope]`, `[memoryLayerDraft, setMemoryLayerDraft]`, `[memoryLayerSavedAt, setMemoryLayerSavedAt]`, `[memoryDistilling, setMemoryDistilling]`, `applyMemoryLayers`, `memoryLayerDirty`, `saveMemoryLayer()`, `runMemoryDistill()`, `togglePinned()`, `clearSelectedMemory()`, `{ scheduledTasks, setScheduledTasks, scheduleDraft, setS…`, `{ channelBot, setChannelBot, channelDraft, setChannelDra…`, `{ customModel, setCustomModel, customDraft, setCustomDra…`, `activeProviderRef`
- **`part03/03-restart-file-model-editor.tsx`** → 子 hook `usePart03c(bag, ibB)`；声明 25 个绑定：
  - `{ providerModels }`, `providerAutoOpenRef`, `[pendingRestart, setPendingRestart]`, `pendingRestartRef`, `relayActivate`, `activateOfficialProvider`, `{ filePreview, setFilePreview, fileTabs, closeTab, fileE…`, `openFile`, `customModelEfforts`, `customModelOption`, `allModels`, `archiveSyncRef`, `modelSuggestions`, `maxConcurrencyRef`, `maxConcurrency`, `runningCountExcept()`, `atConcurrencyLimit()`, `notifyConcurrencyLimit()`, `[modelEditor, setModelEditor]`, `[showApiKey, setShowApiKey]`, `applyModelIdInput`, `openModelEditor`, `targetProviderHint`, `saveModelEditor`, `selectedModel`
- **`part03/04-project-groups-cwd-names.tsx`** → 子 hook `usePart03d(bag)`；声明 28 个绑定：
  - `currentModelId`, `usingCustomModel`, `providerConfig`, `listThreads`, `[viewTab, setViewTab]`, `[expandedProjects, setExpandedProjects]`, `toggleProjectExpanded`, `[cwdOverrides, setCwdOverrides]`, `cwdOverridesRef`, `rememberThreadCwd`, `effectiveCwd`, `withCwdOverride`, `[nameOverrides, setNameOverrides]`, `nameOverridesRef`, `rememberThreadName`, `effectiveThreadName`, `withNameOverride`, `[projectMenu, setProjectMenu]`, `[pinnedThreads, setPinnedThreads]`, `togglePinThread()`, `projectGroups`, `allProjectsCollapsed`, `toggleAllProjects`, `projectAutoExpandRef`, `groupedThreads`, `allGroupsCollapsed`, `[teamThreadsIndex, setTeamThreadsIndex]`, `[teamMemberThreadIds, setTeamMemberThreadIds]`

### `part04.tsx` — 组合根 18 行
原 **1,778 行 / 169 条体内语句** → 3 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart04a()` → `usePart04b()` → `usePart04c()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-seg.tsx` | 561 | 12 | 26 | 消息/回合(5) · 会话/线程(3) · SSH/终端(3) |
| `02-seg.tsx` | 596 | 18 | 13 | 消息/回合(1) · 技能/插件/市场(1) · MCP/连接器(1) |
| `03-seg.tsx` | 919 | 18 | 28 | 技能/插件/市场(2) · 项目/文件/路径(2) · 会话/线程(1) |

- **`part04/01-seg.tsx`** → 子 hook `usePart04a(bag)`；声明 26 个绑定：
  - `[expandedTeamClusters, setExpandedTeamClusters]`, `toggleTeamCluster`, `clusteredSidebar`, `toggleAllGroups`, `sidebarAllCollapsed`, `toggleAllSidebarSections`, `TURN_WINDOW`, `TURNS_PAGE`, `TURN_WINDOW_MEMORY_KEEP`, `touchTurnWindow()`, `ANCHOR_TOP_OFFSET_PX`, `CONTENT_TAIL_GAP_PX`, `COMMON_COMMAND_ORDER`, `commandMatches`, `mergedSkillCatalog`, `skillCommandMatches`, `threadMemoKey`, `availableContextItems`, `threadFileCandidates`, `addSystemEvent()`, `setCompactEventState()`, `pruneSupersededCompactions()`, `threadNameOf()`, `scopedNotice()`, `showToast()`, `contextUsageText()`
- **`part04/02-seg.tsx`** → 子 hook `usePart04b(bag)`；声明 13 个绑定：
  - `addHookEvent()`, `pendingCommandTextRef`, `updateBottomStateRef`, `turnResizeObserverRef`, `releaseToUserRef`, `[chatSearchOpen, setChatSearchOpen]`, `[chatSearchQuery, setChatSearchQuery]`, `[chatSearchIndex, setChatSearchIndex]`, `[chatSearchHistoryOpen, setChatSearchHistoryOpen]`, `[chatSearchHistory, setChatSearchHistory]`, `chatSearchRef`, `chatSearchHistoryRef`, `chatSearchResults`
- **`part04/03-seg.tsx`** → 子 hook `usePart04c(bag)`；声明 28 个绑定：
  - `chatSearchGo`, `pushChatSearchHistory`, `removeChatSearchHistory`, `clearChatSearchHistory`, `knownFilesRef`, `refreshThreads()`, `sidebarRefreshTimerRef`, `scheduleSidebarRefresh()`, `refreshQueue()`, `fetchChildren()`, `toggleTreeDir()`, `loadTree()`, `describeCloakEvent()`, `openInCloak()`, `openBrowser()`, `toggleBookmark()`, `deleteQueued()`, `reorderQueued()`, `editQueued()`, `saveQueued()`, `armPinForReleasedQueue()`, `disarmPinIntent()`, `maybeAutoContinueTruncated()`, `startQueued()`, `refreshSettingsResources()`, `trustAllHooks()`, `setHookEnabled()`, `setLinkedEnabled()`

### `part05.tsx` — 组合根 16 行
原 **1,690 行 / 59 条体内语句** → 2 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart05a()` → `usePart05b()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-seg.tsx` | 1508 | 9 | 17 | 技能/插件/市场(9) · MCP/连接器(1) · 项目/文件/路径(1) |
| `02-seg.tsx` | 192 | 7 | 9 | 弹窗/浮层/卡片(2) · 消息/回合(1) · 引擎/更新/运行时(1) |

- **`part05/01-seg.tsx`** → 子 hook `usePart05a(bag)`；声明 17 个绑定：
  - `changePlugin()`, `setPluginEnabled()`, `ponytailPluginEntry`, `ponytailPluginOn`, `ponytailSkillsSnap`, `desktopSkillSnap`, `browserSkillsSnap`, `nuphusMcpOn`, `capabilitySnapshot`, `[groupBusy, setGroupBusy]`, `groupIpc`, `applyGroup()`, `bootHealRef`, `guardGroupOff()`, `capabilityHint`, `batchSetPluginEnabled()`, `batchSetSkillEnabled()`
- **`part05/02-seg.tsx`** → 子 hook `usePart05b(bag)`；声明 9 个绑定：
  - `popoutFromQuery`, `envSpecs`, `envItems`, `installEnvMissing()`, `envProgress`, `envPercent`, `envStage`, `envSpeed`, `healImageModalityIfUnsupported()`

### `part06.tsx` — 组合根 18 行
原 **1,791 行 / 201 条体内语句** → 3 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart06a()` → `usePart06b()` → `usePart06c()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-seg.tsx` | 441 | 33 | 32 | 调度/子代理(22) · 技能/插件/市场(6) · 会话/线程(4) |
| `02-seg.tsx` | 710 | 11 | 25 | 会话/线程(9) · 模型/供应商(6) · 引擎/更新/运行时(3) |
| `03-seg.tsx` | 669 | 2 | 25 | 会话/线程(9) · 消息/回合(5) · 审批/权限/沙箱(4) |

- **`part06/01-seg.tsx`** → 子 hook `usePart06a(bag)`；声明 32 个绑定：
  - `[settingsContentReady, setSettingsContentReady]`, `mcpDetailLoadedRef`, `[skillHubSearchDebounced, setSkillHubSearchDebounced]`, `[pluginMarketSearchDebounced, setPluginMarketSearchDebou…`, `lastStreamTsRef`, `baseInstructionsRef`, `scopeSigRef`, `adaptiveToneRef`, `moodKeyOf`, `readMood()`, `writeMood()`, `forgetThreadMood()`, `bumpMood()`, `runtimeStateRef`, `adoptedRevRef`, `[dispatchInfo, setDispatchInfo]`, `[delegateRecords, setDelegateRecords]`, `[dispatchOwnerId, setDispatchOwnerId]`, `refreshDispatchOwner`, `[threadRole, setThreadRole]`, `refreshThreadRole`, `delegateRecordsRef`, `dispatchInfoRef`, `refreshDispatchInfo`, `refreshDelegateRecords`, `[dispatchBusy, setDispatchBusy]`, `[delegateLiveRuns, setDelegateLiveRuns]`, `[delegatedPopupId, setDelegatedPopupId]`, `delegateRailTimersRef`, `[dispatchTick, setDispatchTick]`, `activeDispatch`, `dispatchHolderName`
- **`part06/02-seg.tsx`** → 子 hook `usePart06b(bag)`；声明 25 个绑定：
  - `taskRunning`, `lastTurnOfThread`, `turnFinalizing`, `runActivity`, `[runPhrase, setRunPhrase]`, `runActivityRef`, `finalizePhraseRef`, `applyDispatch()`, `admitThreadRuntime()`, `syncThreadRuntimeWithMain()`, `loadBaseInstructions()`, `buildSessionScope()`, `pushSessionScope()`, `applyGlobalModelChoice()`, `savedEffortFor()`, `rememberEffortFor()`, `chooseModel()`, `migrateThreadToProvider()`, `alignThreadToProvider()`, `applyPendingRestart()`, `cancelPendingRestart()`, `updateThreadSettings()`, `pushThreadPermissions()`, `changeApproval()`, `changePermissionMode()`
- **`part06/03-seg.tsx`** → 子 hook `usePart06c(bag)`；声明 25 个绑定：
  - `[globalPermApproval, setGlobalPermApproval]`, `applyGlobalPermissionMode()`, `changeSandbox()`, `applyEffort()`, `changeEffort()`, `changePersonality()`, `copyMessage()`, `copyThreadReferenceId()`, `loadThreadReference()`, `resolveThreadReferences()`, `editResend()`, `copyImage()`, `quoteMessage()`, `cancelQuote()`, `addContextItem()`, `removeContextItem()`, `addSkillReference()`, `onPromptChange()`, `forkFromTurn()`, `exportThreadsBackup()`, `importThreadsBackup()`, `exportThreadsMarkdown()`, `forkThreadFromSidebar()`, `importConversationMarkdown()`, `startNewThread()`

### `part07.tsx` — 组合根 18 行
原 **1,290 行 / 124 条体内语句** → 3 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart07a()` → `usePart07b()` → `usePart07c()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-seg.tsx` | 470 | 1 | 16 | 技能/插件/市场(10) · MCP/连接器(5) · 引擎/更新/运行时(3) |
| `02-seg.tsx` | 467 | 1 | 30 | 调度/子代理(19) · MCP/连接器(5) · 项目/文件/路径(3) |
| `03-seg.tsx` | 377 | 5 | 14 | 输入区/草稿(4) · 会话/线程(2) · 消息/回合(2) |

- **`part07/01-seg.tsx`** → 子 hook `usePart07a(bag)`；声明 16 个绑定：
  - `runSlashCommand()`, `startReview()`, `chooseWorkspace()`, `chooseImages()`, `chooseFiles()`, `refreshMarketSkills()`, `refreshMarketPlugins()`, `refreshPluginsPage()`, `installMarketPlugin()`, `installMarketSkill()`, `toggleSkillEnabled()`, `saveConnector()`, `installMcpServer`, `startConnectorOAuth()`, `saveConnectorFromTemplate()`, `removeConnector()`
- **`part07/02-seg.tsx`** → 子 hook `usePart07b(bag)`；声明 30 个绑定：
  - `setConnectorEnabled()`, `batchSetConnectorsEnabled()`, `setMcpServerEnabled()`, `batchSetMcpServersEnabled()`, `setMcpToolPermission()`, `refreshSubAgents()`, `saveSubAgent()`, `toggleSubAgentEnabled()`, `deleteSubAgent()`, `openNewSubAgent()`, `openEditSubAgent()`, `refreshExpertTeams()`, `saveExpertTeam()`, `toggleExpertTeamEnabled()`, `deleteExpertTeam()`, `resetExpertTeams()`, `openNewExpertTeam()`, `openEditExpertTeam()`, `chooseTeamCwd()`, `clearTeamCwd()`, `startMemberDirectSession()`, `startTeamSession()`, `runTeamMember()`, `invokeTeamMember()`, `invokeTeamPhase()`, `importSkill()`, `removeLocalSkill()`, `pasteImage()`, `showEnhanceHint()`, `dismissEnhanceHint()`
- **`part07/03-seg.tsx`** → 子 hook `usePart07c(bag)`；声明 14 个绑定：
  - `runPromptEnhance()`, `cancelPromptEnhance()`, `promptIncludesBackup()`, `insertComposerAttachments()`, `insertComposerImages()`, `insertComposerFiles()`, `pasteLongText()`, `resumeThreadLight()`, `loadEarlierTurns()`, `onTimelineScroll()`, `jumpToTurnInWindow`, `popoutCurrentThread()`, `rememberScrollPosition()`, `recallScrollOffset()`

### `part08.tsx` — 组合根 18 行
原 **1,696 行 / 54 条体内语句** → 3 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart08a()` → `usePart08b()` → `usePart08c()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-seg.tsx` | 778 | 2 | 12 | 会话/线程(9) · 调度/子代理(2) · 语音/通话(1) |
| `02-seg.tsx` | 711 | 2 | 9 | 模型/供应商(3) · 账号/登录/中转(3) · 输入区/草稿(1) |
| `03-seg.tsx` | 237 | 1 | 5 | 目标/计划/待办(4) |

- **`part08/01-seg.tsx`** → 子 hook `usePart08a(bag)`；声明 12 个绑定：
  - `openThread()`, `cascadeTeamCluster`, `archiveThread()`, `renameThread()`, `clearCurrentConversation()`, `unarchiveThread()`, `deleteThreadCore()`, `deleteThread()`, `releaseDispatchHolder()`, `deleteThreadsByCwd()`, `buildDynamicTools`, `createEmptyThread()`
- **`part08/02-seg.tsx`** → 子 hook `usePart08b(bag)`；声明 9 个绑定：
  - `send()`, `handleLogin()`, `handleSkip()`, `MODEL_CONFIGURED_KEY`, `markModelConfigured()`, `hadModelConfigured()`, `quickSetup()`, `relayQuickLogin()`, `handleLogout()`
- **`part08/03-seg.tsx`** → 子 hook `usePart08c(bag)`；声明 5 个绑定：
  - `confirmPlanExecution()`, `cancelPlanExecution()`, `submitPlanFeedback()`, `stopGoalLoop()`, `interrupt()`

### `part09.tsx` — 组合根 16 行
原 **670 行 / 96 条体内语句** → 2 段，段间**零入参**（只收 `bag`）

组装顺序：`usePart09a()` → `usePart09b()` ⇒ `return { ...a, ...b }`

| 子 hook | 行 | hook 调用 | 声明符号 | 功能标签（按绑定名统计） |
|---|---:|---:|---:|---|
| `01-seg.tsx` | 398 | 9 | 26 | 消息/回合(8) · 输入区/草稿(2) · 弹窗/浮层/卡片(2) |
| `02-seg.tsx` | 419 | 2 | 17 | 调度/子代理(5) · 会话/线程(1) |

- **`part09/01-seg.tsx`** → 子 hook `usePart09a(bag)`；声明 26 个绑定：
  - `onComposerKeyDown()`, `closePanelTab()`, `openPanelTab()`, `[turnWindow, setTurnWindow]`, `turnWindowRef`, `loadingEarlierRef`, `[earlierLoadingId, setEarlierLoadingId]`, `userScrolledRef`, `expandTurnWindow()`, `collapseTurnWindow()`, `allItems`, `isEmpty`, `switchingMeta`, `paletteHandlersRef`, `paletteSections`, `fileTruncated`, `usage`, `lastUsage`, `completedTurns`, `latestCompletedTurn`, `stats`, `activeFlags`, `waitingForApproval`, `waitingForInput`, `activeThreadRunning`, `enhanceAnchorVisible`
- **`part09/02-seg.tsx`** → 子 hook `usePart09b(bag)`；声明 17 个绑定：
  - `activeThreadMemberRunning`, `activeMemberTeam`, `activeMember`, `activityLabel`, `railTeamId`, `railTeam`, `railRuns`, `railRunningByMember`, `railLastByMember`, `popupRun`, `historyMemberRuns`, `delegatedRailRuns`, `delegatedPopupRun`, `recentCompaction`, `saveInlineRename`, `earlyView`, `topbarActionsNode`

### 切分成本核算

| 层 | 规模 | 说明 |
|---|---:|---|
| 原 `useHarnessApp.tsx` | 11190 行 | 单个函数，不可按符号搬 |
| 第一层：9 个 part | **14963 行** / 2433 条体内语句 | 膨胀 3773 行（+34%）：每段重复的文件头/import + 跨段引用的 `bag.X = X;` 镜像语句 |
| 第二层：30 个子 hook + 9 组合根 + types + bag-types | **17803 行** | 再膨胀 2840 行：同样的原因再来一遍（每段独立 import） |

⚠️ **按序切分的固有代价**：总行数会随层数增长。换来的是**可读性**与**单文件规模下降**，不是行数下降 —— 这与按符号搬迁（如 `electron/features/`）的性质不同。

**`types.ts`（343 行）**：切分过程中从各段抽出的共享类型。

**`bag-types.ts`（1360 行）**：⚠️ **自动生成**，由 TS `createProgram + TypeChecker` 对切分前的原文件逐个顶层声明取类型字符串（`typeToString` + `UseFullyQualifiedType`）而得的 `interface Bag`（1348 个属性）。它是跨 part 引用的类型真相源，**不要手改**。

## 3. 渲染层 `app-view/helpers/` —— 原 `helpers.tsx` 1636 行按依赖图切分

| 模块 | 行 | 导出符号 |
|---|---:|---|
| `catalogs.ts` | 115 | `builtinCommandCatalog`, `slashCommands`, `idleTemplates`, `cronTemplates`, `settingsNav`, `imageExts`, `approvalMenuOptions`, `skillHubCategories`, `skillHubCategoryTabs`, `skillHubCategoryName`, `pluginMarketCategoryTabs` |
| `components.tsx` | 174 | `ToolCard`, `RequestCard`, `VoiceSettingsBridge` |
| `paths.ts` | 146 | `collectKnownPaths`, `usageCounterSnapshot`, `toFileUrl` |
| `runtime.ts` | 162 | `loadThreadRuntimeRaw`, `loadThreadRuntime`, `writeThreadRuntimeMirror`, `saveThreadRuntime`, `admitThreadRuntimeRef`, `ownRuntimeWrites`, `loadThreadPermissions`, `threadSandboxOf`, `threadApprovalOf`, `saveThreadPermissions`, `loadThreadModel`, `saveThreadModel`, `resolveThreadModel`, `loadThreadEffort`, `saveThreadEffort`, `sandboxPolicy`, `sandboxMode`, `displayPath` |
| `skills.ts` | 78 | `normSkillName`, `shortSkillName`, `skillZhNote`, `matchSkillCatalog`, `categoryLabel`, `subAgentTools` |
| `stream.ts` | 308 | `reasoningStart`, `deltaMethods`, `isDeltaMethod`, `mergeItem`, `threadContentChanged`, `mergeLongerStreams`, `mergeTurn`, `markBufferedAgentReveal`, `markBufferedTurnReveal`, `stableItem`, `hydrateTurnUserMessage`, `appendDelta`, `appendIndexedDelta`, `threadStreamMethods`, `applyThreadEvent` |
| `text.ts` | 200 | `fmtImportTime`, `prettifyHookLabel`, `noticeTone`, `modelName`, `botChannelName`, `botOnlineOf`, `localFormatDurationMs`, `isActivityItem`, `formatTimestamp`, `timeAgo`, `ago`, `uniqueModelCount`, `clampRruleNum`, `describeRrule`, `describeSchedule`, `greetingForHour`, `modelBadges`, `pickRunPhrase`, `pickRunPhraseExact`, `pluginDisplayName`, `pluginDescription` |
| `thread-list.ts` | 126 | `parseTeamMemberTitle`, `groupThreadsByTime`, `collectMessageTexts`, `locateMatchEl`, `resumeThreadWithTurns` |
| `view-dom.ts` | 101 | `createInlineAttachmentChip`, `armSendAnimationClaim`, `jumpToTurn`, `revealStepFor` |

切分口径：**86 个符号按依赖图分簇**，跨模块边 0（`helpers/` 内部互不 import）；`helpers.tsx` 退化为 209 行 barrel（只做 re-export），调用方 0 改动。

## 4. 渲染层 `src/features/` 其余功能域 —— `App.tsx` 模块级声明的去处

> ⛔ **基线已逐字节验证**：公开仓库 `HEAD:src/App.tsx` 与副本在首个 `src/features/` 提交（`dbfe32b`，09-21）**父提交**的 `src/App.tsx` **blob 哈希完全相同**（`843a0760b488eb57d7a2615d21b33b7f185472ed`）⇒ 公开仓库确实是有效基线，**整个 `src/features/` 树都是本次改造产出**（公开仓库里不存在该目录）。

| 功能域 | 文件 | 行 | 创建提交（改造批次） | 主要文件（按行数） |
|---|---:|---:|---|---|
| `app-state` | 42 | 18176 | f1462db 09-21 · 17d2ab9 09-22 | `parts/part05/01-seg.tsx`(1508), `parts/bag-types.ts`(1360), `parts/part04/03-seg.tsx`(919), `parts/part08/01-seg.tsx`(778) … |
| `app-view` | 12 | 2673 | 14a9696 09-21 · d3226df 09-22 | `constants.tsx`(678), `types.ts`(376), `helpers/stream.ts`(308), `helpers.tsx`(209) … |
| `auth` | 2 | 300 | c64f725 09-21 14:31 | `LoginScreen.tsx`(296), `index.ts`(4) |
| `bot` | 2 | 354 | 641a032 09-21 15:45 | `BotBindCard.tsx`(353), `index.ts`(1) |
| `commands` | 2 | 59 | c752a88 09-21 15:53 | `Commands.tsx`(57), `index.ts`(2) |
| `composer` | 2 | 198 | a2cd043 09-21 15:49 | `Composer.tsx`(196), `index.ts`(2) |
| `connectors` | 2 | 34 | 83cca16 09-21 15:52 | `Connectors.tsx`(33), `index.ts`(1) |
| `dispatch` | 2 | 175 | 4c114b0 09-21 14:27 | `DispatchMenu.tsx`(171), `index.ts`(4) |
| `experts-teams` | 2 | 429 | 071811c 09-21 15:51 | `ExpertsTeams.tsx`(428), `index.ts`(1) |
| `import-records` | 2 | 56 | cd2775b 09-21 16:01 | `ImportRecords.tsx`(55), `index.ts`(1) |
| `inline-cards` | 2 | 182 | 342a214 09-21 16:16 | `InlineCards.tsx`(181), `index.ts`(1) |
| `markdown` | 2 | 205 | 0bf653b 09-21 16:25 | `Markdown.tsx`(204), `index.ts`(1) |
| `memory` | 2 | 238 | e08044f 09-21 14:26 | `MemoryPanels.tsx`(234), `index.ts`(4) |
| `openai` | 2 | 537 | 58be4a3 09-21 14:25 | `OpenaiSubscriptionPage.tsx`(533), `index.ts`(4) |
| `preview` | 2 | 261 | 40f637a 09-21 16:15 | `Preview.tsx`(260), `index.ts`(1) |
| `relay` | 2 | 796 | dbfe32b 09-21 13:57 | `RelayCenterPage.tsx`(792), `index.ts`(4) |
| `session-cards` | 2 | 124 | eeb3977 09-21 16:28 | `SessionCards.tsx`(122), `index.ts`(2) |
| `session-queue` | 2 | 362 | 32248aa 09-21 16:34 | `SessionQueue.tsx`(360), `index.ts`(2) |
| `session-turn` | 2 | 660 | 35bfd7a 09-21 16:37 | `SessionTurn.tsx`(658), `index.ts`(2) |
| `settings-agents` | 1 | 44 | d1f1e7e 09-21 18:06 | `AgentsSettingsSection.tsx`(44) |
| `settings-agentteam` | 1 | 40 | d1f1e7e 09-21 18:06 | `AgentTeamSettingsSection.tsx`(40) |
| `settings-appearance` | 1 | 51 | d1f1e7e 09-21 18:06 | `AppearanceSettingsSection.tsx`(51) |
| `settings-archive` | 1 | 30 | d1f1e7e 09-21 18:06 | `ArchiveSettingsSection.tsx`(30) |
| `settings-automation` | 1 | 39 | d1f1e7e 09-21 18:06 | `AutomationSettingsSection.tsx`(39) |
| `settings-backup` | 1 | 50 | d1f1e7e 09-21 18:06 | `BackupSettingsSection.tsx`(50) |
| `settings-browser` | 1 | 30 | d1f1e7e 09-21 18:06 | `BrowserSettingsSection.tsx`(30) |
| `settings-commands` | 1 | 74 | 51cccee 09-21 18:43 | `CommandsSettingsSection.tsx`(74) |
| `settings-computer` | 1 | 33 | d1f1e7e 09-21 18:06 | `ComputerSettingsSection.tsx`(33) |
| `settings-devtools` | 1 | 133 | d1f1e7e 09-21 18:06 | `DevtoolsSettingsSection.tsx`(133) |
| `settings-expert-center` | 1 | 59 | 51cccee 09-21 18:43 | `ExpertCenterSection.tsx`(59) |
| `settings-general` | 1 | 169 | d1f1e7e 09-21 18:06 | `GeneralSettingsSection.tsx`(169) |
| `settings-hooks` | 1 | 119 | 51cccee 09-21 18:43 | `HooksSettingsSection.tsx`(119) |
| `settings-mcp` | 1 | 189 | 51cccee 09-21 18:43 | `McpSettingsSection.tsx`(189) |
| `settings-memory` | 1 | 52 | d1f1e7e 09-21 18:06 | `MemoryCenterSection.tsx`(52) |
| `settings-model` | 1 | 386 | d1f1e7e 09-21 18:06 | `ModelSettingsSection.tsx`(386) |
| `settings-personalization` | 1 | 27 | 51cccee 09-21 18:43 | `PersonalizationSettingsSection.tsx`(27) |
| `settings-plugins` | 1 | 145 | 51cccee 09-21 18:43 | `PluginsMarketSection.tsx`(145) |
| `settings-rpa` | 1 | 65 | d1f1e7e 09-21 18:06 | `RpaSettingsSection.tsx`(65) |
| `settings-schedule` | 1 | 61 | d1f1e7e 09-21 18:06 | `ScheduleSettingsSection.tsx`(61) |
| `settings-skills` | 1 | 141 | 51cccee 09-21 18:43 | `SkillsCenterSection.tsx`(141) |
| `settings-ssh` | 1 | 123 | d1f1e7e 09-21 18:06 | `SshSettingsSection.tsx`(123) |
| `settings-teams` | 1 | 70 | d1f1e7e 09-21 18:06 | `TeamsSettingsSection.tsx`(70) |
| `shared` | 8 | 908 | 32248aa 09-21 16:34 | `ItemView.tsx`(338), `UserMessageView.tsx`(240), `use-packet-reveal-text.ts`(138), `ToolCodeBlock.tsx`(109) … |
| `skills-market` | 2 | 118 | a7fed6f 09-21 15:50 | `SkillsMarket.tsx`(117), `index.ts`(1) |
| `ssh` | 2 | 171 | 18ea173 09-21 14:30 | `SshModals.tsx`(167), `index.ts`(4) |
| `status` | 2 | 136 | 50a16c0 09-21 16:00 | `Status.tsx`(134), `index.ts`(2) |
| `storage-settings` | 2 | 134 | 339ca6a 09-21 16:26 | `StorageSettings.tsx`(133), `index.ts`(1) |
| `terminal` | 2 | 142 | 0757f7c 09-21 16:24 | `TerminalPanel.tsx`(141), `index.ts`(1) |
| **合计** | **129** | **29558** | | （含 `app-state` 与 `app-view`，已在上两节展开） |

### 4.1 逐域明细（导出符号）

#### `auth`（2 文件 / 300 行）

- `LoginScreen.tsx`（296 行）：`FieldHelp`, `LoginScreen`
- `index.ts`（4 行）：`export {FieldHelp,LoginScreen}`

#### `bot`（2 文件 / 354 行）

- `BotBindCard.tsx`（353 行）：`BotBindCard`
- `index.ts`（1 行）：`export {BotBindCard}`

- **`commands`** （2 文件 / 59 行）：`Commands.tsx`(57) → `BuiltinCommandDef`, `CommandEditorDraft`, `CommandEditorModal`；`index.ts`(2) → `export {CommandEditorModal}`, `export {BuiltinCommandDef,CommandEditorDraft}`
#### `composer`（2 文件 / 198 行）

- `Composer.tsx`（196 行）：`ThreadFilePicker`, `ComposerEditor`, `ComposerMenuOption`, `ComposerMenu`
- `index.ts`（2 行）：`export {ComposerEditor,ComposerMenu,ThreadFilePicker}`, `export {ComposerMenuOption}`

- **`connectors`** （2 文件 / 34 行）：`Connectors.tsx`(33) → `ConnectorSetupModal`, `ConnectorTemplateModal`；`index.ts`(1) → `export {ConnectorSetupModal,ConnectorTemplateModal}`
#### `dispatch`（2 文件 / 175 行）

- `DispatchMenu.tsx`（171 行）：`DispatchMenu`, `DispatchBadge`
- `index.ts`（4 行）：`export {DispatchMenu,DispatchBadge}`

#### `experts-teams`（2 文件 / 429 行）

- `ExpertsTeams.tsx`（428 行）：`SubAgentEditorModal`, `TeamMemberRail`, `TeamRunPopup`, `TeamMemberHistory`, `DelegatedRail`, `DelegatedRunPopup`, `ExpertTeamEditorModal`
- `index.ts`（1 行）：`export {ExpertTeamEditorModal,SubAgentEditorModal,TeamMemberRail,TeamMemberHistory,DelegatedRail,DelegatedRunPopup,TeamRunPopup}`

- **`import-records`** （2 文件 / 56 行）：`ImportRecords.tsx`(55) → `ImportedRecordCard`, `PendingImportSlot`；`index.ts`(1) → `export {ImportedRecordCard,PendingImportSlot}`
#### `inline-cards`（2 文件 / 182 行）

- `InlineCards.tsx`（181 行）：`InlineFileCards`, `UserRefsRow`
- `index.ts`（1 行）：`export {InlineFileCards,UserRefsRow}`

#### `markdown`（2 文件 / 205 行）

- `Markdown.tsx`（204 行）：`MdCode`, `FilePreviewCode`, `MD_COMPONENTS`, `MdBlock`, `Markdown`
- `index.ts`（1 行）：`export {Markdown,MD_COMPONENTS,MdCode,MdBlock,FilePreviewCode}`

#### `memory`（2 文件 / 238 行）

- `MemoryPanels.tsx`（234 行）：`MemoryFunnel`, `MemoryLayersEditor`, `MemoryConfigModal`
- `index.ts`（4 行）：`export {MemoryFunnel,MemoryLayersEditor,MemoryConfigModal}`

#### `openai`（2 文件 / 537 行）

- `OpenaiSubscriptionPage.tsx`（533 行）：`OpenaiBalanceBadge`, `OpenaiSubscriptionPage`
- `index.ts`（4 行）：`export {OpenaiBalanceBadge,OpenaiSubscriptionPage}`

#### `preview`（2 文件 / 261 行）

- `Preview.tsx`（260 行）：`PastedTextEditor`, `ImagePreview`, `ImageLightbox`, `SearchPreviewModal`
- `index.ts`（1 行）：`export {ImagePreview,ImageLightbox,SearchPreviewModal,PastedTextEditor}`

#### `relay`（2 文件 / 796 行）

- `RelayCenterPage.tsx`（792 行）：`RelayBalanceBadge`, `RelayAccountEntryBanner`, `RelayCenterPage`
- `index.ts`（4 行）：`export {RelayBalanceBadge,RelayCenterPage,RelayAccountEntryBanner}`

#### `session-cards`（2 文件 / 124 行）

- `SessionCards.tsx`（122 行）：`HookBadge`, `ToolStatusEntry`, `ActionCard`, `VirtualDiffLines`, `CappedToolRun`, `CappedToolSequence`
- `index.ts`（2 行）：`export {ActionCard,VirtualDiffLines,CappedToolRun,CappedToolSequence,HookBadge}`, `export {ToolStatusEntry}`

#### `session-queue`（2 文件 / 362 行）

- `SessionQueue.tsx`（360 行）：`QueuedMessageList`, `QueuedMessageItem`, `FoldHandlers`, `FoldGroup`, `TurnFoldStream`, `ProgressiveAgentBody`, `ProgressiveToolPayload`
- `index.ts`（2 行）：`export {QueuedMessageList,QueuedMessageItem,FoldGroup,TurnFoldStream,ProgressiveAgentBody,ProgressiveToolPayload}`, `export {FoldHandlers}`

#### `session-turn`（2 文件 / 660 行）

- `SessionTurn.tsx`（658 行）：`UserMessageEditor`, `MessageAttachChip`, `RulerMark`, `MessageRuler`, `MemoMessageRuler`, `ReasoningCard`, `TurnView`, `MemoTurnView`, `MemoUserMessageView`
- `index.ts`（2 行）：`export {TurnView,MemoTurnView,MemoUserMessageView,UserMessageEditor,MessageAttachChip,ReasoningCard,MessageRuler,MemoMessageRuler}`, `export {RulerMark}`

- **`settings-agents`** （1 文件 / 44 行）：`AgentsSettingsSection.tsx`(44) → `AgentsSettingsSectionProps`, `AgentsSettingsSection`
- **`settings-agentteam`** （1 文件 / 40 行）：`AgentTeamSettingsSection.tsx`(40) → `AgentTeamSettingsSectionProps`, `AgentTeamSettingsSection`
- **`settings-appearance`** （1 文件 / 51 行）：`AppearanceSettingsSection.tsx`(51) → `AppearanceSettingsSectionProps`, `AppearanceSettingsSection`
- **`settings-archive`** （1 文件 / 30 行）：`ArchiveSettingsSection.tsx`(30) → `ArchiveSettingsSectionProps`, `ArchiveSettingsSection`
- **`settings-automation`** （1 文件 / 39 行）：`AutomationSettingsSection.tsx`(39) → `AutomationSettingsSectionProps`, `AutomationSettingsSection`
- **`settings-backup`** （1 文件 / 50 行）：`BackupSettingsSection.tsx`(50) → `BackupSettingsSectionProps`, `BackupSettingsSection`
- **`settings-browser`** （1 文件 / 30 行）：`BrowserSettingsSection.tsx`(30) → `BrowserSettingsSectionProps`, `BrowserSettingsSection`
#### `settings-commands`（1 文件 / 74 行）

- `CommandsSettingsSection.tsx`（74 行）：`CommandsSettingsSectionProps`, `CommandsSettingsSection`

- **`settings-computer`** （1 文件 / 33 行）：`ComputerSettingsSection.tsx`(33) → `ComputerSettingsSectionProps`, `ComputerSettingsSection`
#### `settings-devtools`（1 文件 / 133 行）

- `DevtoolsSettingsSection.tsx`（133 行）：`DevtoolsSettingsSectionProps`, `DevtoolsSettingsSection`

- **`settings-expert-center`** （1 文件 / 59 行）：`ExpertCenterSection.tsx`(59) → `ExpertCenterSectionProps`, `ExpertCenterSection`
#### `settings-general`（1 文件 / 169 行）

- `GeneralSettingsSection.tsx`（169 行）：`GeneralSettingsSectionProps`, `GeneralSettingsSection`

#### `settings-hooks`（1 文件 / 119 行）

- `HooksSettingsSection.tsx`（119 行）：`HooksSettingsSectionProps`, `HooksSettingsSection`

#### `settings-mcp`（1 文件 / 189 行）

- `McpSettingsSection.tsx`（189 行）：`McpSettingsSectionProps`, `McpSettingsSection`

- **`settings-memory`** （1 文件 / 52 行）：`MemoryCenterSection.tsx`(52) → `MemoryCenterSectionProps`, `MemoryCenterSection`
#### `settings-model`（1 文件 / 386 行）

- `ModelSettingsSection.tsx`（386 行）：`ModelSettingsSectionProps`, `ModelSettingsSection`

- **`settings-personalization`** （1 文件 / 27 行）：`PersonalizationSettingsSection.tsx`(27) → `PersonalizationSettingsSectionProps`, `PersonalizationSettingsSection`
#### `settings-plugins`（1 文件 / 145 行）

- `PluginsMarketSection.tsx`（145 行）：`PluginsMarketSectionProps`, `PluginsMarketSection`

#### `settings-rpa`（1 文件 / 65 行）

- `RpaSettingsSection.tsx`（65 行）：`RpaSettingsSectionProps`, `RpaSettingsSection`

#### `settings-schedule`（1 文件 / 61 行）

- `ScheduleSettingsSection.tsx`（61 行）：`ScheduleSettingsSectionProps`, `ScheduleSettingsSection`

#### `settings-skills`（1 文件 / 141 行）

- `SkillsCenterSection.tsx`（141 行）：`SkillsCenterSectionProps`, `SkillsCenterSection`

#### `settings-ssh`（1 文件 / 123 行）

- `SshSettingsSection.tsx`（123 行）：`SshSettingsSectionProps`, `SshSettingsSection`

#### `settings-teams`（1 文件 / 70 行）

- `TeamsSettingsSection.tsx`（70 行）：`TeamsSettingsSectionProps`, `TeamsSettingsSection`

#### `shared`（8 文件 / 908 行）

- `ItemView.tsx`（338 行）：`ItemView`
- `UserMessageView.tsx`（240 行）：`UserMessageView`
- `use-packet-reveal-text.ts`（138 行）：`usePacketRevealText`
- `ToolCodeBlock.tsx`（109 行）：`ToolCodeBlock`
- `MessageFooter.tsx`（50 行）：`MessageFooter`
- `use-near-viewport.ts`（21 行）：`useNearViewport`
- `Fold.tsx`（7 行）：`Fold`
- `COMPOSER_CHIP_ICON.tsx`（5 行）：`COMPOSER_CHIP_ICON`

#### `skills-market`（2 文件 / 118 行）

- `SkillsMarket.tsx`（117 行）：`MarketLogo`, `MarketPreviewModal`, `SkillAvatar`, `SkillAvatarImg`, `SkillInstallModal`, `SkillRemoveModal`, `PluginInstallModal`
- `index.ts`（1 行）：`export {MarketLogo,MarketPreviewModal,SkillAvatar,SkillAvatarImg,SkillInstallModal,SkillRemoveModal,PluginInstallModal}`

#### `ssh`（2 文件 / 171 行）

- `SshModals.tsx`（167 行）：`SshTerminalModal`, `SshExecModal`
- `index.ts`（4 行）：`export {SshTerminalModal,SshExecModal}`

#### `status`（2 文件 / 136 行）

- `Status.tsx`（134 行）：`StatusDot`, `CompletedChanges`, `RunningProcessTime`, `ContextRing`, `UsageCounterSnapshot`, `ContextUsageBadge`
- `index.ts`（2 行）：`export {RunningProcessTime,StatusDot,CompletedChanges,ContextRing,ContextUsageBadge}`, `export {UsageCounterSnapshot}`

#### `storage-settings`（2 文件 / 134 行）

- `StorageSettings.tsx`（133 行）：`StorageSection`, `ReviewPanel`
- `index.ts`（1 行）：`export {StorageSection,ReviewPanel}`

#### `terminal`（2 文件 / 142 行）

- `TerminalPanel.tsx`（141 行）：`CommandExecutionCard`, `TerminalPanel`
- `index.ts`（1 行）：`export {CommandExecutionCard,TerminalPanel}`


## 5. `src/styles/` —— 原 `styles.css` 25453 行按**界面区域**切分（19 分节）

入口 `src/styles.css` 现为 31 行（19 行 `@import`）。**重复 `@import` 同一文件**的 CSS 去重判据落在**产物**：`dist/assets/*.css` 里数选择器出现次数，不靠「Vite 应该会去重」的推理。

| 分节 | 行 | 原 styles.css 区间 | 承载界面 |
|---|---:|---|---|
| `01-base-and-chrome.css` | 870 | L1–L864（864 行） | 基础 / 顶层外壳（reset、顶栏、侧栏骨架、窗口钮避让） |
| `02-sidebar-threads.css` | 1227 | L865–L2085（1221 行） | 侧栏：会话列表 / 分组 / 置顶 / 运行指示 |
| `03-messages-turns.css` | 1326 | L2086–L3405（1320 行） | 消息流与回合（回合卡片、停止标记、窗口化续载） |
| `04-cards-tools.css` | 1312 | L3406–L4711（1306 行） | 工具 / 命令 / 理由 / diff / 计划等卡片 |
| `05-composer-input.css` | 1526 | L4712–L6231（1520 行） | 输入区（编辑器、菜单、状态条、发送钮） |
| `06-market-icons.css` | 875 | L6232–L7100（869 行） | 技能 / 插件市场图标与列表 |
| `07-settings-mcp-connectors.css` | 1783 | L7101–L8877（1777 行） | 设置 · 连接器中心 / MCP 状态卡 |
| `08-settings-engine-update.css` | 1410 | L8878–L10281（1404 行） | 设置 · Codex 引擎更新 |
| `09-settings-workspace-memory.css` | 1650 | L10282–L11925（1644 行） | 设置 · 工作区与记忆 |
| `10-settings-providers.css` | 1238 | L11926–L13157（1232 行） | 设置 · 供应商 / 模型目录表单 |
| `11-settings-secrets.css` | 1392 | L13158–L14543（1386 行） | 设置 · 密钥管理 |
| `12-settings-skills.css` | 1333 | L14544–L15870（1327 行） | 设置 · 技能管理 |
| `13-subagents-page.css` | 1457 | L15871–L17321（1451 行） | 子智能体页 |
| `14-model-onboarding.css` | 1417 | L17322–L18732（1411 行） | 模型配置引导弹窗 |
| `15-queued-messages.css` | 1383 | L18733–L20109（1377 行） | 排队消息内联气泡 |
| `16-settings-ssh.css` | 1383 | L20110–L21486（1377 行） | 设置 · SSH 服务器连接管理 |
| `17-visual-cards.css` | 1406 | L21487–L22886（1400 行） | 可视化卡片（show_widget） |
| `18-openai-dialog.css` | 1422 | L22887–L24302（1416 行） | OpenAI 管理弹窗 |
| `19-misc-hints.css` | 1158 | L24303–L25454（1152 行） | 随机短提示气泡 / 其它 |

分节行数合计 25568 行（原 25453 行，差额为分节头注释与 `@import` 入口）。

## 6. `electron/main.ts` **剩余** 1825 行的内容构成

- **残留 IPC handler 5 个**：`theme`(1)=theme:apply, `window`(4)=window:popout-id/window:popout-list/window:popout-thread/window:popout-close
- **顶层函数 52 个**（基础设施：路径解析 / 配置读写 / 生命周期）；
- **模块级单例与常量 73 个**（`server` / `mainWindow` / `threadRuntimeStore` / `scheduler` … 它们被 `features/*` 以**活绑定**方式取用）；
- **批量导出块 21 个**（`export { … }`，`features/*` 的跨域引用的来源）⚠️ 补 export 前必须先扫这里，否则 TS2323。

<details><summary>顶层函数清单（52）</summary>

- `fn qrSvg`
- `fn enrichScanCountSnapshot`
- `fn logCrash`
- `fn appSourceRoot`
- `fn gitBin`
- `fn gitExec`
- `fn placeholderPngResponse`
- `fn normalizeUpstreamProtocol`
- `fn syncUpstreamProtocols`
- `fn bridgeDial`
- `fn readCustomModel`
- `fn readCustomModels`
- `fn writeCustomModels`
- `fn upsertCustomModel`
- `fn healReservedProviderConfig`
- `fn normalizeProvider`
- `fn readUserConfigSplit`
- `fn syncEngineWatchdog`
- `fn writeModelCatalogToml`
- `fn devInstructionsInput`
- `fn readStoredChannelBot`
- `fn readMemoryGateway`
- `fn readMemoryMode`
- `fn applyMemoryMode`
- `fn readWorkspaceMemorySettings`
- `fn workspaceMemoryEnabled`
- `fn decryptSecret`
- `fn safeConnectorId`
- `fn readConnectors`
- `fn readMcpOverrides`
- `fn writeMcpOverrides`
- `fn mcpOverrideEnabled`
- `fn mcpToolRulesOf`
- `fn connectorEnv`
- `fn connectorToml`
- `fn readChannelBot`
- `fn classifyProbeError`
- `fn installContextMenu`
- `fn titleBarOverlayOptions`
- `fn applyWindowChrome`
- `fn migrateLegacyRolloutHome`
- `fn notifyPopoutClosed`
- `fn readBuiltinPlugins`
- `fn describeNetworkError`
- `fn refreshSkillDiscipline`
- `fn readSubAgents`
- `fn writeSubAgents`
- `fn ensureBuiltinReviewer`
- `fn waitForTurnCompletion`
- `fn turnOutputText`
- `fn distillSummarize`
- `fn cleanupAll`

</details>

<details><summary>模块级单例 / 常量清单（73）</summary>

- `let rolloutFallbackScanCount`
- `let resumeTotalMs`
- `let resumeCount`
- `let resumeEnrichMs`
- `let resumeMaxMs`
- `let threadListRequestCount`
- `const codexHome`
- `const customModelFile`
- `const customModelsFile`
- `const channelBotFile`
- `const botStreamFile`
- `let gitBinCache`
- `const memoryFile`
- `const memoryGatewayFile`
- `const scheduleFile`
- `const connectorsFile`
- `const expertTeamsFile`
- `const mcpOverridesFile`
- `const pastedTextDir`
- `const PLACEHOLDER_PNG_B64`
- `const server`
- `const responsesBridge`
- `const upstreamProtocols`
- `const engineActiveTurnIds`
- `let closeConfirmed`
- `const captureBuffers`
- `const threadCwd`
- `let mainWindow`
- `const popoutThreadIds`
- `const teamRunStore`
- `const delegateRegistry`
- `const threadRuntimeFile`
- `const threadRuntimeStore`
- `const terminals`
- `const remoteEventForwarders`
- `const remote`
- `const rpaFile`
- `const taskListFile`
- `const rpaStore`
- `const memoryStore`
- `const memoryLayers`
- `const internalThreads`
- `const scheduler`
- `const channelLogs`
- `const channelBot`
- `const voiceModelsRoot`
- `const voiceLogs`
- `const voiceService`
- `const modelCatalogFile`
- `let sessionProviderIdsCache`
- `const memoryModeFile`
- `const memoryWorkspaceFile`
- `const escapeToml`
- `const CHROME_SYMBOL_DARK`
- `const CHROME_SYMBOL_LIGHT`
- `let appThemeDark`
- `const gotSingleLock`
- `const builtinPluginsFile`
- `const botPairing`
- `let cloakProc`
- `const userSkillsDir`
- `const skillsRegistryFile`
- `const oauthSessions`
- `const sshSessions`
- `const subAgentsFile`
- `const filePreviewAllowed`
- `const userPickedPaths`
- `export const trustPicked`
- `const trustedRoots`
- `export const isInsideTrustedRoots`
- `export const isInsideOrEqualTrustedRoots`
- `let cleanupDone`
- `export const mutableState`

</details>

## 7. `src/App.tsx` **剩余** 2543 行的内容构成

**`App()` 声明在 L500，函数体只有 4 条语句** —— 这是停手的直接原因：

| # | 语句 | 行区间 | 行数 | 内容 |
|---|---|---|---:|---|
| 1 | 声明 | L501–501 | 1 | `const app = useHarnessApp();` |
| 2 | if | L506–506 | 1 | 条件提前返回 |
| 3 | 解构 | L509–698 | 190 | 从 `app` 取 **751 个绑定** |
| 4 | return | L699–2538 | 1840 | **JSX 主体** |

- 文件顶层：**203 条语句**，其中 import 200 条，非 import 顶层声明仅 **3 条**（模块级内容早已搬去 `src/features/app-view/`）
- 状态与逻辑实体**全部**在 `useHarnessApp()` 与它的 9 个 part 里；`App()` 只剩「取 751 个绑定 → 渲染 1,840 行 JSX」

⛔ **为什么停在这里**：`App()` 体已无独立声明可搬 —— 剩下的是**一条 190 行的解构 + 一条 1,840 行的 JSX return**。要拆它必须**重新划分「谁持有哪份状态」**（把 751 个绑定按界面区域重新分组、给新组件设计 props 契约）⇒ 属**行为语义改动**，不是纯搬迁，**须用户确认**后才动。

## 8. 改造提交时间线

| 提交 | 时间 | 说明 |
|---|---|---|
| `8f8065d` | 09-22 08:51 | refactor(main): 搬出壳族杂项 4 通道到 features/shell-misc-ipc.ts（main.ts 1859 到 1826） |
| `bab10ff` | 09-22 08:34 | fix(updates/fs): 修回跨域引用（../updates 路径 + main.ts 导出 isInsideTrustedRoots） |
| `5c76e23` | 09-22 08:30 | refactor(main): 收尾 fs/updates 两域搬迁（main.ts 1978 到 1859）+ 账本同步 |
| `d8ea8b2` | 09-22 08:11 | chore(main): 收掉 dialog/nativeImage/ClipboardItem 三个死导入 + 记下 imagesDir 真相源重复 |
| `17d2ab9` | 09-22 08:07 | refactor: part04–09 全部切成组合根 + 子 hook；main.ts 再搬 dialog/clipboard；预检【92】口径修正 |
| `72974ae` | 09-22 07:13 | refactor(app-state): part03.tsx 1,915 行 → 组合根 20 行 + parts/part03/ 4 个子 hook（纯搬迁、零标识符改写） |
| `fbb7ee5` | 09-22 06:54 | refactor(app-state): part01.tsx 1,995 行 → 组合根 24 行 + parts/part01/ 6 个子 hook（纯搬迁、零标识符改写） |
| `8f06d2c` | 09-22 05:44 | refactor(app-state): part02.tsx 2,139 行 → 组合根 19 行 + parts/part02/ 4 个子 hook（纯搬迁、零标识符改写） |
| `d3226df` | 09-22 04:25 | refactor(app-view): helpers.tsx（1,636 行 / 86 符号）按功能域切成 ./helpers/ 9 个模块 + barrel |
| `5e37b36` | 09-22 03:11 | refactor(main): 应用诊断与数据管理域（210 行 / 14 符号）搬出 → features/app-diagnostics.ts |
| `29e1756` | 09-22 02:01 | refactor(main): 调度核心域（124 行 / 11 符号）搬出 → features/dispatch-core.ts |
| `270e6a6` | 09-22 00:52 | fix(refactor): 搬进 features 的 userData 路径必须惰性求值（顶层求值落在 app.setPath 之前） |
| `5117221` | 09-22 00:47 | refactor(main): 永久删除会话的本地收尾域（113 行）搬出 → features/thread-deletion.ts |
| `f3a90ff` | 09-22 00:45 | refactor(main): OpenAI 账号/代理/官方模型目录域（90 行）搬出 → features/openai-auth.ts |
| `117b0c3` | 09-21 23:38 | refactor(main): 渲染层事件裁剪域（98 行）搬出 → features/renderer-fuse.ts |
| `e830995` | 09-21 23:27 | fix(features): 修回 window-factory 被搬进 features/ 后失效的三个资源路径 |
| `343115d` | 09-21 23:27 | fix(refactor): 补回第 2 批切分漏搬的 ipc-registry 域账本日志（切片边界 off-by-one） |
| `ff30834` | 09-21 23:22 | refactor(main): IM 渠道机器人网关域（319 行）搬出 → features/im-gateways.ts |
| `d699498` | 09-21 23:19 | refactor(main): 自动化工具链域（288 行）搬出 → features/dev-runtimes.ts |
| `f1462db` | 09-21 22:29 | refactor(state): useHarnessApp 11,191 行按序切分为 9 个 part hook + 类型化 bag（组合根 374 行） |
| `aa80808` | 09-21 21:38 | refactor(state): 打破 App.tsx ⇄ useHarnessApp 循环 import |
| `14a9696` | 09-21 21:23 | refactor(App): 模块级（66 辅助函数 / 23 常量 / 6 类型，1,546 行）搬出 → src/features/app-view/{helpers,constants,types} |
| `bce22e0` | 09-21 20:50 | refactor(main): 组合根 6 个大块外移（990 行）→ features/{custom-model-apply,delegation,window-factory,dispatch-rpc,im-inbound,provi |
| `84e1d66` | 09-21 20:50 | fix(composer): 剪贴板 URI 路径按平台解析（Windows→C:\foo，mac/Linux 保持 /Users/foo） |
| `9427ef1` | 09-21 20:29 | refactor(App): App 组件体（return 前 10,646 行）抽成 useHarnessApp —— App.tsx 14530→4087（-72%） |
| `bed2a12` | 09-21 20:08 | refactor(main): 剩余 53 个域 / 228 个 IPC handler 按域批量拆出（main.ts 7381→4258） |
| `2b4af80` | 09-21 19:11 | refactor(main): 中转站账户域(14 handler)拆到 features/relay-ipc.ts；main.ts 8971→7381 |
| `51cccee` | 09-21 18:43 | refactor(App): 最后 7 个内联设置块抽成子组件（expert-center/plugins/skills/commands/hooks/mcp/personalization；含 IIFE 形态支持）—— App 15,15 |
| `d54033a` | 09-21 18:23 | refactor(main): 建 electron/ipc-registry.ts 域账本（66 域/314 handler）+ main.ts 启动日志 + 预检【90】账本一致性守卫 |
| `d1f1e7e` | 09-21 18:06 | refactor(App): 16 个内联设置块抽成子组件（src/features/settings-*/）—— App.tsx 16,185→15,151；保真度逐行一致；预检 0 红 |

## 9. 每个域都过同一套闸门

| 闸门 | 命令 / 脚本 | 判据 |
|---|---|---|
| 前端类型 | `.workbuddy/tmp/check-types.cjs`（`tsconfig.app.json`） | 0 错。⚠️ **只覆盖 `src/`，验不到 `electron/`** |
| 主进程类型 | `npm run build`（内含 `tsc -p electron/tsconfig.json` + `vite build`） | 0 错。⛔ 只能**在副本**跑；⛔ **不许用管道**（`\| tail` 退出码恒 0 会把失败伪装成通过） |
| 结构保真 | `fidelity-partNN.cjs` | ①hook 调用顺序逐位一致 ②return 键逐项相同 ③旧文件非空行 0 缺失 |
| 账本一致 | 预检【90】 | `ipc-registry.ts` 的 `status`/`channels` 与实现一致 |
| 惰性求值 | 预检【91】 | 非 `main.ts` 模块的模块体不得求值 `app.getPath` |
| 组合根结构 | 预检【92】 | 子模块 return 的名字必须是**本文件声明**的（防组合根展开时静默覆盖） |
| 离线预检 | `scripts/check-preflight.mjs` | **1674 ✓ / 0 ✗**（3 条既有告警） |
| 启动冒烟 | 隔离 profile 起真实实例 | `[ipc-registry] 66 个 IPC 域，0 个仍在 main.ts 待拆` + MCP ready + 无未捕获异常 |

## 10. 遗留与未完成（16:50 复核：原 4 条已修，状态已标注）

| 项 | 规模 | 判断 |
|---|---|---|
| ~~`App.tsx` 组件体~~ | ~~2543 行~~ | ✅ **已完成**（AppView 抽取 + Suspense 懒加载；`App.tsx` 现 21 行，底部 re-export 死面已删） |
| ~~`parts/part05/01-seg.tsx`~~ | ~~1508 行~~ | ✅ **已拆**：现 **587 行**（原 1,070 行 useEffect 已解） |
| `electron/main.ts` 余量 | **1223 行** | 剩 5 个 handler（theme + popout×4，已证与作用域内私有函数耦合搬不动）+ 启动链 + 模块级单例 |
| ~~`helpers.tsx` 存量死导入~~ | ~~170 条 / 369 绑定~~ | ✅ **已清**（现 36 行 barrel） |
| ~~`<userData>/images` 真相源重复~~ | ~~2 处~~ | ✅ **已收口**（守卫【95】实测派生路径唯一真相源，0 处违规） |
| `src/styles/` 最大分节 | 1783 行 | 已是合理粒度，再切收益低 |
| 渲染层运行时验证 | — | ✅ **09-22 已做**（CDP 冒烟：.app-shell 渲染 / 无未捕获异常；懒加载改造后又复验一轮），见 §11.7 |
| `electron/features/` ↔ `main.ts` 双向依赖 | 22 个文件取 `../main` 活绑定 | ⛔ **真残留（架构层）**：现靠「只在 handler 体内取用」纪律 + 【91】加载级守卫，非结构保证；修法见 §11.8（待用户点单） |

## 11. 硬骨头评估（09-22 实测数字，非印象）

按「能不能啃」分四类。所有数字均由脚本从当前源码量得，口径写在每段里。

### 11.1 ~~App() 的 1,840 行 JSX~~ —— ✅ 已完成（09-22 AppView 抽取落地；以下为当时的评估存档）

**`App()` 的 1,840 行 JSX**（L699–2538）

| 指标 | 实测 |
|---|---:|
| 解构绑定总数 | 751 |
| **JSX 里直接引用的绑定** | **713（95%）** |
| JSX 内出现过的不同标识符 | 1,096 |
| JSX 里是否有 `bag.` 通道 | **无**（App 拿的是扁平解构绑定） |

⇒ 拆它只能走两条路：给子组件划 props 契约（数百个 props 横跨整棵树），或把绑定塞进 context（**语义改动**）。
两条路都是**重新划分状态归属**，不是搬迁。这是全仓唯一必须用户点头的一块。

### 11.2 能啃，但要专门一轮（拆法已知 + 陷阱已知）

**`parts/part05/01-seg.tsx` 里那一条 1,070 行的 `useEffect`**（L437–1506）—— ✅ 已拆（现 587 行；以下拆法存档）

- 该文件 **1,508 行 / 38 条体语句**，其中**1 条占 1,070 行**（另外 37 条合计仅 438 行）
  ⇒ 切分脚本按「语句」切，遇到「一条语句内部」就无能为力 —— 这是它没被拆开的**唯一原因**。
- 结构解剖：

| 层 | 内容 |
|---|---|
| `useEffect` 回调体 | 5 条语句；核心是 `window.codex.onEvent(cb)`，末尾 `return () => { off(); offChannel(); offHarness(); }` |
| `cb`（onEvent 回调）体 | 13 条语句，**11 个 `if` 分支**按 `event.kind` / `params.method` 分派 |
| `cb` 内声明的绑定 | 132 个 |
| 分支内访问的 `bag.*` 属性 | 105 个 |

- **决定性数字：跨分支共享的「本段局部绑定」= 0 个** ⇒ 11 个分支**互为独立单元**，
  每个只用「自己的局部 + `bag`」⇒ 可整体提成 11 个具名 handler（**纯搬迁，不需传额外参数，只需 `bag` 与 `params`**）。
- ⛔ **已知陷阱：7 / 11 个分支内含 `return`**。若那是「跳过后续分支」的提前退出，
  提成函数后语义会变成「只退出子函数」⇒ **必须改写为「返回处置标记 + 调用处判断」，属语义级改动**，
  要单独一轮、逐个核对这 7 处。**这就是它至今没拆的真正原因。**

### 11.3 已用实测排除（别再试）

**`main.ts` 的 `window:popout-id` / `-list` / `-thread` / `-close`（4 通道）与 `theme:apply`**
依赖 `isPopoutWindow` / `createPopoutWindow`，**二者都不是 `main.ts` 顶层声明**（在某个作用域内部）
⇒ 补不了 `export`（TS2459 / TS2304）。上一轮已为此整域回滚过一次，属**已证伪**。

### 11.4 顺手能清 —— 前提条件**本轮已证明**

**`helpers.tsx` 的存量死导入** —— ✅ 已清（现 36 行 barrel；以下证明过程存档）

| 指标 | 实测 |
|---|---:|
| import 语句 | 170 条 |
| 导入绑定 | 369 个 |
| export 声明 | 9 条 → re-export **86 个**名字（全部直接来自 `./helpers/*`） |
| 导入但从未被 re-export 的绑定 | **369（全部）** |
| 文件内其它语句类型 | 无（只剩 import / export） |

**可达性证明（这是「能不能删」的唯一硬判据，本轮做完）**：
把 170 条 import 的模块按**解析后的绝对路径**在全仓 `src/**` 反查引用者 ⇒
**0 条是孤儿**（163 条仍有其它引用者，7 条为外部包）
⇒ **删除不会让任何模块失去可达路径，被打包的模块集合不变**。
剩余验证：`npm run build` + 预检 + `dist/assets` 产物比对。

### 11.5 本次改造**新引入**的负债（不是历史遗留）

- ~~**`parts/bag-types.ts`（1,360 行）没有守卫。**~~ ✅ 已补（守卫【93】在跑） 它是自动生成的跨 part **类型真相源**
  （由 TS `createProgram + TypeChecker` 对切分前的原文件导出）。⛔ 已 grep 全量预检：
  **没有任何断言盯着它**。风险：原文件或依赖类型一变，这份 1,360 行的类型快照会**静默过期**
  ⇒ 跨 part 引用的类型悄悄失真，而 tsc 仍全绿。
  **该补的守卫**：重新生成并与现有文件逐字节比对（有差异即红）。
- ~~**`<userData>/images` 双真相源。**~~ ✅ 已收口（守卫【95】，实测 0 处违规；原描述存档）—— 两处各自推导：

| 位置 | 写法 |
|---|---|
| `electron/features/app-diagnostics.ts:164` | `path.join(ud, "images")` |
| `electron/features/clipboard-ipc.ts:30` | `path.join(app.getPath("userData"), "images")` |

  两处都**惰性求值**（所以预检【91】不红）。今天同值，**改一处即静默分叉**：
  设置页量到 / 删掉的目录 ≠ 剪贴板真正写入的目录。

### 11.6 低收益（不碰也不影响可维护性）

- `src/styles/` 最大分节 1,783 行 —— 纯 CSS，19 分节已是合理粒度。
- `docs/ARCHITECTURE.md` 写的是**目标形态**；`docs/REFACTOR-COMPARE*` 仍是改造前基线（本文档只对齐了「现状」这一侧）。

### 11.7 ✅ 渲染层运行时验证（09-22 已补齐，此前是唯一空缺）

静态闸门（tsc 0 错 / 预检 1,674 ✓ 0 ✗ / 保真 LCS 全等 / 启动冒烟 `66 个 IPC 域，0 个待拆`）此前
**全部只覆盖主进程侧**；渲染层以下三条只有静态推断，本轮用 CDP 冒烟实补：

| # | 风险 | 本轮运行时证据 |
|---|---|---|
| 1 | `bag` 惰性访问：跨 part 引用会不会在首帧读到 `undefined` 并炸 | ✓ 首帧渲染成功（`#root` 有子元素 / body 5,518 字节）且**无未捕获异常** |
| 2 | 713 个绑定参与的 1,840 行 JSX 真实渲染（是否白屏 / 有无 `console.error`） | ✓ 主壳渲染成功：**.app-shell ✓ / .sidebar ✓ / .composer-wrap ✓ / 260 个 DOM 节点 / body 18,499 字节**；截图见 `.workbuddy/tmp/renderer-smoke.png`（侧栏导航、输入区、空态问候、快捷卡、状态栏齐备） |
| 3 | hook 调用顺序在真实 render 中的表现 | ✓ `App()` 的**首条语句就是无条件调用 `useHarnessApp()`** ⇒ 只要渲染过一帧，9 个 part / 30 个子 hook / **734 次 hook 调用**就都在真实浏览器里按序执行过；React 对 hook 数量/顺序变化会报错，**未报** |

**怎么进到主壳的**（关键，否则冒烟只会停在登录页）：
`showLogin` 的初值只读 `localStorage["login-skipped"]`（`part01/01-session-drafts-voice.tsx` L45–48：
`null`/`"logout"` ⇒ 显示登录页）。在**一次性隔离 profile** 里把它置成 `"true"` 再 `Page.reload`，
即进主壳。⛔ 夹具只是一个 localStorage 标记 —— **不碰任何真实 userData / 会话历史**。

**仍未覆盖**：真实网络往返（连上游供应商）、长回合运行中的滚动/钉顶几何、跨窗口 popout。
这些要真机交互，属下一层级的验收。

## 12. 「还有哪些功能没拆分」（09-22 实测，按功能域列全）

口径：副本里所有 **≥400 行** 的 `src/**` + `electron/**` 文件（**70 个**），逐个判定它的来历 ——
「公开仓库（本次改造的基线）里是否已存在」+「本仓首次提交」。据此分三类：

- **① 搬出来了但内部仍是一整块 = 真正的「没拆分」**（30 个）
- **② 改造前就存在、本次完全没碰的独立大文件**（16 个）—— 这才是"还没拆的功能"主体
- **③ 不该拆**（24 个）

### 12.1 搬出来了、但内部仍是一整块（30 个）

#### A. 两块最大的硬骨头

| 文件 | 行 | 现状 |
|---|---:|---|
| `src/App.tsx` | **2,322** | `App()` 只剩 4 条语句：无条件调用 hook + 1 个 `if` 提前返回 + **190 行解构取 751 个绑定** + **1 条 1,840 行 JSX**。⛔ 拆它必须重划状态归属（props 契约 / context）⇒ 属语义改动，**须用户拍板** |
| `electron/main.ts` | **1,825** | 启动链 + **73 个模块级单例/常量** + **52 个顶层函数** + **21 个批量导出块** + 残留 5 个 handler（`theme:apply` 与 `window:popout-*`×4，**已实测搬不动**：依赖作用域内私有函数） |

#### B. 引擎事件总路由（单条语句 1,070 行）

| 文件 | 行 | 现状 |
|---|---:|---|
| `parts/part05/01-seg.tsx` | **1,344** | 38 条体语句里**1 条 `useEffect` 占 1,070 行**。拆法已知（11 个分支按 `event.kind` 分派、**跨分支共享的本段局部绑定 = 0**），但 **7/11 分支内含 `return`** ⇒ 提成具名函数会改提前退出语义，**属语义级改动，须单独一轮** |

#### C. `app-state` 的其余子 hook：还有 17 个 ≥400 行

这些是「按序切分」的段，**段内还能再切**（同一套脚本即可，前提是段内无跨段裸引用）：

| 子 hook | 行 | 功能标签（按绑定名统计） |
|---|---:|---|
| `part08/01-seg.tsx` | 756 | — |
| `part04/03-seg.tsx` | 725 | 技能/插件·项目文件·会话 |
| `part06/02-seg.tsx` | 710 | — |
| `part08/02-seg.tsx` | 692 | — |
| `part02/02-goal-browser-notice.tsx` | 615 | 目标/浏览器/通知 |
| `part01/03-accounts-connectors-rate-limit.tsx` | 563 | 账号/连接器/限流 |
| `part03/01-remote-bot-pin.tsx` | 529 | 远端/机器人/钉顶 |
| `part02/04-runtime-commands-account.tsx` | 506 | 运行时/命令/账号 |
| `part03/03-restart-file-model-editor.tsx` | 502 | 重启/文件/模型/编辑器 |
| `part06/03-seg.tsx` | 487 | — |
| `part07/01-seg.tsx` | 470 | — |
| `part06/01-seg.tsx` | 441 | — |
| `part04/02-seg.tsx` | 434 | — |
| `part07/02-seg.tsx` | 423 | — |
| `part02/01-mcp-teams-plan.tsx` | 421 | MCP/团队/计划 |
| `part02/03-thread-switch-update.tsx` | 420 | 会话切换/更新 |
| `part09/02-seg.tsx` | 419 | 调度/子代理 |

#### D. 整域搬出、但域内未再拆的功能页（5 个）

| 文件 | 行 | 说明 |
|---|---:|---|
| `features/relay/RelayCenterPage.tsx` | 792 | 中转站中心（09-21 第 1 批搬出，整页未拆） |
| `features/session-turn/SessionTurn.tsx` | 658 | 会话回合渲染 |
| `features/openai/OpenaiSubscriptionPage.tsx` | 533 | OpenAI 订阅页 |
| `features/app-view/constants.tsx` | 480 | App 的模块级常量（23 条声明） |
| `features/experts-teams/ExpertsTeams.tsx` | 428 | 专家/专家团页 |

#### E. 主进程 IPC 域里 ≥400 行的（7 个）

| 文件 | 行 | 说明 |
|---|---:|---|
| `electron/features/engine-ipc.ts` | 705 | 引擎/会话运行时（22 通道） |
| `electron/features/model-custom-ipc.ts` | 644 | 模型与供应商（25 通道） |
| `electron/features/boot.ts` | 624 | 启动编排 |
| `electron/features/builtin-skills-ipc.ts` | 585 | 内置技能/插件（22 通道） |
| `electron/features/voice-ipc.ts` | 440 | 语音通话（39 通道 + 热键/模型下载） |
| `electron/features/connectors-mcp-ipc.ts` | 426 | 连接器 MCP（12 通道） |
| `electron/features/relay-ipc.ts` | 406 | 中转站账户（14 通道） |

### 12.2 改造前就存在、本次完全没碰（16 个）—— 「还没拆的功能」主体

⛔ 注意：这些**不是本次改造的遗留**，它们从 09-10～09-17 就在独立文件里，本次从未列入范围。
按功能归类（合计约 13,000 行）：

| 功能域 | 文件 | 行 |
|---|---|---:|
| **语音（最大的一块）** | `src/components/VoiceCallFloat.tsx` | 1,350 |
| | `src/components/VoiceSettingsSection.tsx` | 1,067 |
| | `electron/voice/voice-service.ts` | 1,028 |
| | `electron/voice/model-store.ts` | 923 |
| | `electron/voice/workers.ts` | 482 |
| **专家团 / 子代理** | `electron/expert-teams.ts` | 1,286 |
| **供应商响应桥（本地协作）** | `electron/responses-bridge.ts` | 1,101 |
| **内置技能 / 插件** | `electron/builtin-skills.ts` | 1,049 |
| **远程 / 中转** | `electron/remote.ts` | 992 |
| **harness 服务** | `electron/harness-services.ts` | 973 |
| **SSH 服务端** | `electron/ssh-servers.ts` | 504 |
| **会话备份** | `electron/thread-backup.ts` | 488 |
| **模型供应商（前端 hook）** | `src/hooks/useModelProviders.ts` | 478 |
| **IPC 桥 / 引擎服务器** | `electron/preload.ts` 456 · `electron/codex-server.ts` 428 | 884 |
| **帮助对话框** | `src/components/HelpDialog.tsx` | 411 |

### 12.3 不该拆（24 个）

| 类别 | 文件 | 行 | 理由 |
|---|---|---:|---|
| 样式分节 | `src/styles/*.css` ×19 | 870–1,783 | 已按**界面区域**拆分；CSS 无「函数」可拆，再切收益低 |
| 自动生成 | `parts/bag-types.ts` | 1,360 | 由 TypeChecker 生成，**已加【93】守卫防漂移**；手改即违规 |
| 类型声明 | `src/vite-env.d.ts` | 710 | IPC 桥类型面（预检与三件套一起来管） |
| 生成物 | `electron/rollout-worker-source.ts` | 549 | 由 `scripts/gen-rollout-worker.mjs` 生成且 **gitignore** |

### 12.4 结论与建议顺序

**本次改造范围内还剩下的**（按性价比）：

1. **`app-state` 那 17 个子 hook**（400–760 行）—— 同一套按序切分脚本即可，风险最低、收益直接
2. **5 个整域搬出未拆的功能页**（relay 792 / session-turn 658 / openai 533 / constants 480 / experts-teams 428）—— 内部按组件或按函数分簇，属常规搬迁
3. **7 个 ≥400 行的 IPC 域**（engine-ipc 705 最大）—— 按通道组再分一层
4. **`main.ts` 1,825** —— 只剩启动链与模块级单例，再拆要重划 `deps` 契约，收益/风险比开始变差
5. ⛔ **`App.tsx` 2,322** —— **须用户拍板**（状态归属重划）
6. ⛔ **`part05/01-seg.tsx` 那条 1,070 行 useEffect** —— **属语义级改动**（7/11 分支含 `return`），须单独一轮

**本次改造范围外的**（12.2 那 16 个，约 13,000 行）：要不要拆是**独立的立项决定** ——
它们不是遗留，而是从未列入范围；其中「语音」一块（5 文件 / ~4,850 行）体量最大，最值得单独立项。

### 12.5 完成度口径（09-22 补：上一版 §12 的表会放大观感，这里给可比的数字）

§12.1 的 30 个文件是**用「≥400 行」这个自定阈值数出来的**，它同时混进了三类不同性质的东西：

| §12.1 里的组 | 数量 | 真实性质 |
|---|---:|---|
| A 两块硬骨头 + B 引擎事件总路由 | 3 | ⛔ **真正的硬骨头**：单条语句就 1,070–1,840 行，拆它属语义级 |
| C 的 2 个（`part08/01-seg` 的 `openThread()` 415 行、`part08/02-seg` 的 `send()` 508 行） | 2 | ⚠️ 中等：**单个大函数**，可整体提成模块（须先量它除 `bag` 外还闭包了哪些局部名） |
| C 的其余 15 个 | 15 | ✅ **只是"可以更细"**：**25–193 条小语句**（最大一条 25–83 行），同一套按序切分脚本即可批量处理 |
| D/E（5 个功能页 + 7 个 IPC 域 = 12 个，与 C 有重叠计数） | — | 常规搬迁：按组件/按函数分簇 |

其中 **13 个处在 400–500 行**（`part02/01` 421、`part09/02` 419 ……）—— 一个 419 行**只干一件事**的模块，
本来就属于「已拆好」，不该计成"没拆"。

**两个可比硬指标**：

| 指标 | 改造基线 | 现在 |
|---|---|---|
| 三个巨型文件合计（App.tsx + main.ts + styles.css） | 56,638 行 | **4,178 行（已外移 93%）** |
| **业务代码**（.ts/.tsx）中 >1000 行的文件 | **8 个 / 38,066 行** | **9 个 / 13,388 行** |

后者的 9 个里：**6 个是改造前就存在、本次从未列入范围**（`VoiceCallFloat` 1,350 · `expert-teams` 1,286 ·
`responses-bridge` 1,101 · `VoiceSettingsSection` 1,067 · `builtin-skills` 1,049 · `voice-service` 1,028 = 6,881 行）
+ 1 个自动生成物（`bag-types` 1,360）
⇒ **本次改造范围内、仍 >1000 行的业务文件只剩 2 个：`src/App.tsx`（2,322）与 `electron/main.ts`（1,825），合计 4,147 行。**

**一句话**：巨型文件的问题已经解决（-93%）；剩下的 30 个不是"30 份工作"，
而是 **3 个硬骨头 + 2 个中等 + 15 个可批量 + 若干已合格**。

## 13. 第 79 轮（09-22 上午）：一次性收尾 —— 二次切分 / 整函数外提 / 路径收口

上一轮列出的候选（§12.1 的 30 个）本轮处理到「能自动切的都切完」。
**≥400 行的业务文件 70 → 55 个**；仍属本次范围内、且尚不能自动切的只剩 3 个（见 §13.8）。

### 13.1 二次切分（app-state 子 hook，>500 行）

| 文件 | 原 | 现 | 子段 |
|---|---:|---:|---|
| `part04/03-seg.tsx` | 726 | **17** | 01-chat-search-file-tree(373) / 02-browser-queue-settings(364) |
| `part06/02-seg.tsx` | 711 | **17** | 01-turn-runtime-activity(353) / 02-model-thread-settings(367) |
| `part02/02-goal-browser-notice.tsx` | 616 | **17** | 01-goal-review-file-browser(454) / 02-approval-notice-center(175) |
| `part01/03-accounts-connectors-rate-limit.tsx` | 564 | **17** | 01-accounts-connectors-skills(260) / 02-rate-limit-retry-optimistic(274) |
| `part03/01-remote-bot-pin.tsx` | 530 | **17** | 01-bot-remote-channel(240) / 02-pin-scroll-anchor(301) |
| `part02/04-runtime-commands-account.tsx` | 507 | **17** | 01-dev-runtimes-capability(259) / 02-commands-hooks-account(258) |
| `part03/03-restart-file-model-editor.tsx` | 503 | **20** | 01-restart-file-preview(287) / 02-concurrency-model-editor(227) |

做法与 part01–09 一致（零标识符改写：子段 `return` 自己的绑定 → 组合根展开；跨段名字走**入参**，不是 bag）。
工具 `split-seg.cjs`（把 `split-partNN.cjs` 参数化）。

### 13.2 其它批量

**React 功能页**（工具 `move-decls.cjs`，按顶层声明分组）

| 文件 | 原 | 现 |
|---|---:|---:|
| `session-turn/SessionTurn.tsx` | 659 | **16**（barrel）+ message-ruler / reasoning-card / turn-view / message-chips |
| `experts-teams/ExpertsTeams.tsx` | 429 | **13**（纯 barrel）+ modals / rails / popups / avatar-anchor |
| `openai/OpenaiSubscriptionPage.tsx` | 534 | **344** + usage-parsers(58) / official-cards(146) |
| `app-view/constants.tsx` | 481 | **14**（纯 barrel）+ notices-labels / identity-onboarding / ui-options / run-phrases-thresholds |
| `relay/RelayCenterPage.tsx` | 793 | **707** + balance-badge(88) —— 余下是 693 行页面组件本体（见 §13.8） |

**IPC 域**（`--mode side-effect`：源文件变 `import "./x"` 的副作用 barrel，main.ts 侧不动）

| 文件 | 原 | 现 | 子模块 |
|---|---:|---:|---|
| `electron/features/engine-ipc.ts` | 706 | **10** | 6 个（thread-runtime-codex-bridge 230 / dev-runtime-install 219 / threads-backup 132 / dev-runtime 126 / engine-update 52 / bridge 13） |
| `electron/features/model-custom-ipc.ts` | 645 | **9** | 5 个（custom-model-write 221 / openai-login 180 / custom-model-read 124 / openai-vault-import 122 / openai-accounts 66） |
| `electron/features/builtin-skills-ipc.ts` | 586 | **9** | 4 个（209 / 201 / 117 / 117） |
| `electron/features/connectors-mcp-ipc.ts` | 427 | **9** | 4 个（216 / 107 / 80 / 65） |
| `electron/features/voice-ipc.ts` | 441 | **17** | 3 个（226 / 171 / 74）—— 用 `split-seg --no-return`（注册函数没有顶层 return） |

### 13.3 整函数外提（工具 `extract-fn.cjs`）：两个最大的「单条巨型语句」

| 函数 | 行 | 结果 |
|---|---:|---|
| `openThread`（part08/01-seg） | 415 | → `01-seg/open-thread.tsx` 432 行；宿主 757 → **339** |
| `send`（part08/02-seg） | 508 | → `02-seg/send.tsx` 532 行；宿主 693 → **173** |

**为什么能整函数搬**：先量「该函数对宿主局部绑定的闭包」—— 两个都是 **0 个**
（跨段依赖全走 `bag`，分别用了 74 / 85 个 bag 属性）。于是做法最小：impl 补一个 `bag: Bag` 首参，
**函数体逐字照搬**；宿主留同名薄壳转调。保真用**函数体逐字节比对**：23545 / 28023 字节，两边完全相同。
导出名保持原名、宿主侧 `import { send as sendImpl }` 别名 —— 既不自递归，也让「按函数名归属」的断言【29】无需改口径。

### 13.4 路径收口：`<userData>` 派生子路径的唯一真相源

`<userData>/images` 曾在**三处**各自推导（`app-diagnostics.ts` 两处 + `clipboard-ipc.ts` 一处）。
今天同值，但改一处即**静默分叉**。新增 `electron/user-data-paths.ts`（只暴露函数内惰性求值的
`imagesDir()` / `engineDebugLogPath()`），三处调用点改为调它；新增守卫【95】防复发。

### 13.5 预检/守卫的读取口径跟进（本次改 4 处，全是「口径没跟上重构」而非代码 bug）

| 处 | 症状 | 修法 |
|---|---|---|
| `readMainSource()` | 只扫 `electron/features/*.ts` 一层 ⇒ 域文件切进子目录后 **73 项假红** | 改递归 |
| 【90】通道计数 | 按单文件数通道，域文件变 barrel 后 **19 项假红** | 改「域文件 + 同名子目录（递归）」 |
| 【93】bag 守卫 | ① 只扫一层 ⇒ 419 个名字假「无人声明」② 组合根的 `const a = …` 单字母局部名漏进 Bag（2 条假 extra）③ 联合类型成员顺序随 program 构造顺序变（5 条假差异） | 改递归 + 跳过组合根（判据：函数体每条语句是 `const <id> = <useXxx 调用>` 或唯一一条全展开 return）+ 归一化时对 `\|` 切段排序 |
| 【93】非 hook 文件 | 整函数外提产物（`open-thread.tsx` 只导出 `openThread`）被判「找不到 useXxx」 | 改为跳过并计数 |

### 13.6 本轮新增工具（都在 `.workbuddy/tmp/`）

| 工具 | 用途 |
|---|---|
| `split-seg.cjs` | 通用「按序切分器」（参数化；支持 `--no-return` / `--parent-import` / `--ext` / `--keep-name`） |
| `move-decls.cjs` | 顶层声明搬迁（`keep` / `barrel` / `side-effect` 三模式，自动接 import/export） |
| `extract-fn.cjs` | 整函数外提（前提硬断言：对宿主局部闭包 = 0） |
| `fidelity-leaf.cjs` | 叶子级保真：体内语句序列逐字符 + hook 调用逐位 + return 键逐项 |
| `fidelity-move.cjs` | 搬迁保真：语句多重集逐字符比对 |

### 13.7 本轮闸门

tsc 0 错 · build EXIT=0 · 预检 **1677 ✓ / 0 ✗** · 【93】【94】【95】全绿 ·
运行时冒烟通过（`[ipc-registry] 66 个 IPC 域，0 个仍在 main.ts 待拆` + 主壳 260 DOM 节点 / 18.5KB body + 无未捕获异常）。

### 13.8 **仍然不能自动切的**（逐条给理由，别重复试）

| 目标 | 行 | 为什么 |
|---|---:|---|
| `src/App.tsx` | 2,322 | `App()` 只剩 4 条语句（190 行解构 751 绑定 + **1 条 1,840 行 JSX**）。要拆只能划 props 契约或引入 context ⇒ **状态归属重划，须用户拍板** |
| `part05/01-seg.tsx` | 1,344 | 38 条语句里**一条 `useEffect` 占 1,070 行**（引擎事件总路由）。拆法已知：11 个分支、**跨分支共享的本段局部绑定 = 0**（全走 bag，105 个属性）；但 **7/11 分支含 `return`**，提前退出语义会变 ⇒ **须单独一轮逐个核对那 7 处** |
| `electron/main.ts` | 1,825 | 余启动链 + 73 模块级单例 + 52 顶层函数；popout/theme 依赖作用域内私有函数（已证伪） |
| `electron/features/boot.ts` | 624 | `bootApp` 453 行闭包了 **68 个「由 main.ts 注入」的模块级 `let` 依赖** ⇒ 外提要重做注入契约（设计改动） |
| `electron/features/relay-ipc.ts` | 406 | 体内有 **2 处跨组前向引用**（`relayBase` 先使用后声明）⇒ 按序切分前提不成立 |
| `src/features/relay/RelayCenterPage.tsx` | 707 | 余 693 行**页面组件本体** ⇒ 拆它是划子组件 + props 契约（设计改动，非搬迁） |
| `parts/part*/*.tsx` 14 个 | 419–487 | 都在 400–490 且是单一职责段；再切属「更细」而非「必要」 |
| `src/styles/*.css` 18 个 | 406–1,783 | 已按界面区域分节，纯 CSS、再切收益低 |
| `src/vite-env.d.ts` / `rollout-worker-source.ts` | 710 / 549 | 类型声明 / 生成物（被 gitignore） |
| **范围外**（改造前既有、从未列入）16 个 | ~13,000 | 语音 5 文件 ~4,850（VoiceCallFloat 1,350 / VoiceSettingsSection 1,067 / voice-service 1,028 / model-store 923 / workers 482）+ expert-teams 1,286 / responses-bridge 1,101 / builtin-skills 1,049 / remote 992 / harness-services 973 / ssh-servers 504 / thread-backup 488 / useModelProviders 478 / preload 456 / codex-server 428 / HelpDialog 411 |

## 14. 第 79~85 轮：「继续拆 100%」阶段（09-22 上午）

目标是从「剩下几个硬骨头」推进到**把能自动切的全部切完**。本轮完成 5 个提交（`a346c80` → `09e13f3`）。

### 14.1 App.tsx：22,215 → **21 行**（两个提交）

| 步骤 | 做法 | 结果 |
|---|---|---|
| ① App → AppView | 把 190 行解构 + 1,840 行 JSX **整体**搬进 `features/app-view/AppView.tsx`；`App()` 只剩「取 hook → earlyView 短路 → `<AppView app={app} />`」 | 2,323 → 22 |
| ② AppView 的 JSX 两级切分 | 17 个文件（9 个一级子组件，其中 2 个再下钻一层） | 2,260 → 472（+ 17 文件 6,197 行） |

关键设计——**app-prop 模式**（子组件收一个 `app`，再按需解构它用到的名字）：
`02-main-stage` 那段用 240 个绑定、`settings-content` 用 350 个 ⇒ 逐个当 props 传会生成几百个**类型快照**属性
（与 `bag-types` 同一类漂移风险）；收 `app`（类型 `HarnessAppApi` = hook 的返回类型）则类型始终是活的。

判据：解构块 13,127 字节 / JSX **168,979 字节逐字节一致**；barrel 两行 61+6 个名字逐字节一致；
17 个文件 / 1,642 行正文 / 18 个文本块**全部可溯源**到 JSX 切分前的 AppView（按行归一后作连续子序列）。

### 14.2 electron/main.ts：1,826 → **1,563**（再搬出 4 个函数簇）

`electron/main/` 下新增：`01-model-catalog`(153) / `02-git-bin`(46) / `03-turn-summary`(78) / `04-connector-config`(81)。
保真：main.ts 顶层语句 **171 = 保留 155 + 外移 16**，多重集逐字符一致。

### 14.3 parts/：再切 8 个（7 个 ≥400 的子 hook + goal-browser）

保真：语句序列逐字符一致、hook 调用逐位一致（42/67/72 项…）、return 键逐项一致（43/18/30/114/105…）。

### 14.4 规模变化（口径：`src/**` + `electron/**` 的 .ts/.tsx，排除生成物目录）

| 指标 | 改造基线 | 现在 |
|---|---|---|
| **>1000 行**业务文件 | **8 个 / 38,066 行** | **8 个 / 9,804 行** |
| >700 行 | 12 个 / 41,664 行 | 13 个 / 14,175 行 |
| >400 行 | 20 个 / 45,460 行 | 32 个 / 23,447 行 |
| `src/App.tsx` | 22,215 | **21** |
| `electron/main.ts` | 8,970 | **1,563** |
| `src/styles.css` | 25,453 | **31**（入口 + `styles/` 19 分节） |

现在仍 >700 行的 13 个文件里：**6 个是改造前就存在、从未列入范围的**（VoiceCallFloat 1,350 /
expert-teams 1,286 / responses-bridge 1,101 / VoiceSettingsSection 1,067 / builtin-skills 1,049 /
voice-service 1,028）+ **1 个自动生成物**（bag-types 1,360）+ **1 个类型声明**（vite-env.d.ts 710）
⇒ **本次范围内只剩 5 个**：`electron/main.ts` 1,563 · `AppView/.../02-settings-content` 773 ·
`parts/part05/01-seg` 587 · `parts/part08/02-seg/send` 532 · `parts/part08/01-seg/open-thread` 432 ·
`parts/part09/02-seg` 419。

### 14.5 仍然切不动的（附理由，别重复试）

| 目标 | 行 | 为什么 |
|---|---:|---|
| `02-settings-content.tsx` | 773 | 350 个绑定的解构清单本身就占 ~360 行 —— 这是 app-prop 模式的**结构性下限**，再切只会把同一份清单复制到两个子文件 |
| `part05/01-seg.tsx` | 587 | 切分器判定**没有可用切点**（任何边界都会产生跨组前向引用） |
| `part09/02-seg.tsx` | 419 | 同上 |
| `send.tsx` 532 / `open-thread.tsx` 432 | — | 都是**单个具名函数**（508 / 415 行体），要拆得按分支提取并逐处核对 return 语义 |
| `electron/main.ts` 1,563 | — | 余 190 条顶层语句，多数是 5–10 行的启动链/单例；再搬要逐簇验 `【90】【91】` 与账本 |
| 18 个 CSS 分节 1,300–1,800 | — | 已按界面区域分节，再切是"为切而切" |
| 16 个范围外既有文件 | — | 从未列入本次范围（语音 ~4,850 行最值得单独立项） |

---

## 15. 第 86~91 轮：继续拆「范围外」巨型文件（09-22 下午）

前三轮把本次**立项目标**（五个巨型入口）做到 97.7% 外移。本节记录接着往下拆
**改造前既有**的大文件（§12.2 那 16 个）——它们体量大、但**与改造主线零耦合**，
风险独立可控。

### 15.1 本轮三个提交

| 提交 | 目标 | 前 → 后 | 产物 |
|---|---|---|---|
| `be2f6de` | `electron/expert-teams.ts` | 1,287 → **13**（纯 barrel） | `expert-teams/` **14 文件**（最大 157） |
| `cd3dc30` | `src/components/VoiceCallFloat.tsx` | 1,351 → **313** | `VoiceCallFloat/` 1 hook（1,036 行） |
| `8b9d708` | `src/components/VoiceSettingsSection.tsx` | 1,068 → **275** | `VoiceSettingsSection/` 1 hook（482）+ **9 子组件** |

**expert-teams 的难点**：24 条顶层声明好切，但 `buildDefaultExpertTeams` 体内只有 3 条语句，
其中 **`return` 一条占 831 行** —— 返回 6 个 `mk({…})` 组成的数组（每个 134–147 行）。
新工具 `split-array-elements.cjs` 把**每个数组元素**提成子模块：
元素文本逐字搬走，只在外层套 `(mk: (partial: any) => ExpertTeamConfig) => ExpertTeamConfig =>`，
宿主变成 `return [ softwareDevTeam(mk), … ];`。

**两个语音组件的共性**：都是「一个 1000+ 行组件」，用既有的
`extract-state-hook.cjs`（提状态 hook）+ `split-jsx.cjs`（切 JSX）两步拆。

### 15.2 判据（都是硬判据，不是"看起来没问题"）

| 目标 | 判据 | 结果 |
|---|---|---|
| expert-teams | A 数组元素逐字 / B 顶层语句多重集 / C 公共面 | 22,382 字节 + 24=24 + 保留 |
| VoiceCallFloat | A 模块级声明逐字 / B 体语句逐字 / C hook 顺序 / D 解构↔返回键 | 2,103 + 39,294 字节 + 85 项 + 双向无缺 |
| VoiceSettingsSection | 同上 5 层（多一层「子组件行溯源」） | 2,037 + 17,784 字节 + 352 行 + 48 项 + 双向无缺 |

三个目标都是：tsc 0 错 / `npm run check` EXIT=0（预检 1687 ✓ 0 ✗）/ 运行时冒烟通过。

### 15.3 ⛔ 本轮抓到的 5 个「会静默出事」的工具缺陷

1. **`extract-state-hook.cjs` 把组件的模块级声明整个丢了** —— 组件侧只生成
   「挑过的 import + 组件函数」，于是 hook 引用的 `CAPTURE_RATE` / `VoicePhase` /
   `pickHint`… 全成 TS2304（24 条），组件里用到的 `formatBytes` 也一起没。
   ⇒ 已修：组件侧**原样保留**全部模块级声明；hook 侧只对引用到的名字从组件文件 import。
2. **含 JSX 的「提前返回」不能进 hook** —— `if (!settings || !meta) { return (<section>…</section>); }`
   被当普通语句搬进 hook ⇒ hook 推导出的返回类型变 `Element | {…}`，
   组件侧 60 个解构名全报 TS2339。⇒ 已修：含 JSX + 含 return 的语句留在组件侧。
3. **`checker.getTypeAtLocation` 不给流敏感类型** ⇒ 父组件提前返回建立的收窄带不进子组件，
   props 被推成 `Settings | null`（33 条 TS18047）。⇒ 新增 `--narrow "settings:Settings,meta:Meta"`。
4. **子组件 import 探测漏了 props 类型文本** ⇒ `--narrow` 指定的类型名（`Settings`）
   只出现在 `type Props = { settings: Settings }` 里，不扫它就漏 import（9 条 TS2304）。
5. **批量替换把 helper 自己内部那行也替换了** ⇒ `readVoiceSettingsSrc()` 自递归爆栈
   （预检跑到 135 项后 `Maximum call stack size exceeded`）。
   ⇒ 记入技能：批量替换前先把 helper 内的读取行改成**不匹配替换模式**的写法。

### 15.4 同一类问题第 5、6 次复发：守卫的「读取范围」

`check-preflight.mjs` 里 4 处直读 `VoiceCallFloat.tsx` + 6 处直读 `VoiceSettingsSection.tsx`，
逻辑搬进同名子目录后 **13 + 5 条断言集体假红**（文案形如 `capture=-1 voiceStart=-1`）。
已各加一个递归聚合函数替换。**判定顺序仍是：先看是不是"读取口径没跟上"，再看代码。**

### 15.5 进度（口径与阈值都写在这里）

| 口径 | 基线 | 现在 | 完成度 |
|---|---|---|---|
| **五个巨型入口**（App / main / styles.css / useHarnessApp / helpers） | 56,638 行 | **1,275 行** | **已外移 97.7%（剩 2.3%）** |
| 业务代码中 **>1000 行**的文件（阈值自定） | 8 个 / 38,066 行 | **4 个 / 4,646 行** | 行数降幅 **87.8%** |
| 业务代码中 **>700 行**的文件 | 12 个 / 41,664 行 | 9 个 / 9,017 行 | 降幅 **78.4%** |
| 业务代码中 **>400 行**的文件 | 20 个 / 45,460 行 | 30 个 / 19,212 行 | 降幅 **57.7%** |

> ⚠️ `>400` 一行**文件数反而变多**（20 → 30）：切分把 1 个 22,000 行的文件变成几十个
> 200–800 行的模块，**这是目的不是退步**。所以"文件个数"不能当进度口径，
> 只能看**行数降幅**与**超阈值文件的规模**。

现在 `>1000` 行的 4 个：`bag-types.ts`（自动生成，有【93】守卫）· `main.ts`（**范围内**）·
`use-voice-call-float-state.tsx`（本轮新造的 hook，1,035）· `voice-service.ts`（范围外）。
⇒ **本次范围内仍 >1000 行的只剩 `main.ts`。**

### 15.6 还能继续的与确实切不动的

**还能继续**（同类做法，风险可控）：
`electron/remote.ts` 992 · `harness-services.ts` 973 · `voice/model-store.ts` 923 ·
`voice-service.ts`（1,028，一个 917 行的 class，需按方法簇拆）·
`main.ts` 1,223（按域继续搬，但要逐簇验【90】【91】）。

**已实测切不动**：
- `use-voice-call-float-state.tsx` 1,035：`split-seg` 试 `--parts 3/4/5` 全部报
  **前段引用后段**（`i=61` 那 94 行 `useEffect` 引用后面定义的 4 个回调）——
  段序机制（后段收前段入参）解决不了反向引用，除非引入 `bag` 式延迟解析。
  收益（1,035 → 3×350）与风险不匹配 ⇒ 停。
- `02-settings-content.tsx` 773：176 import + **352 行解构** + 238 JSX；
  JSX 子节点只有 2 个 ⇒ 解构长度 = JSX 用到多少名字，是 app-prop 模式的**结构性下限**。
