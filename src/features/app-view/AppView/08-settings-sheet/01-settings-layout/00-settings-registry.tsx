/**
 * 设置页注册表 —— **「页 id → 渲染」的唯一映射**（09-22 从 02-settings-content.tsx 抽出，纯搬迁）。
 *
 * 为什么要有它（架构体检 #2）：02-settings-content 里原先有 32 处
 * `settingsPage === "x" && <XSection/>` 硬编码分支 —— 加一个设置页要改 JSX 树、还要和 settingsNav 对齐两遍。
 * 现在一行一页：
 *   · 渲染 = 由 02-settings-content 一次派发（`settingsPagesOf(app)[settingsPage]`）；
 *   · 二级入口页（browser / computer / rpa / agents / teams / expert-center）的「返回条」
 *     从写死的三元表达式收敛为 `back: { to, label }` 元数据；
 *   · **导航仍是 settingsNav（catalogs.ts）**：本文件不 import 它，避免
 *     helpers → registry → sections → helpers 的循环依赖；两边一致性由预检守卫【101】卡死。
 *
 * ⛔ 行为等价性：每条 `render` 的 JSX 与搬迁前**逐字一致**（只换外层包装），解构的绑定名照搬同一份 app 字段面。
 *    改这里 = 改用户看到的设置页 ⇒ 按红线（可见交互）先问用户。
 */
import { lazy } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { SettingsPage } from "../../../../app-view/types";
import type { HarnessAppApi } from "../../../../app-state/useHarnessApp";
import UsagePanel from "../../../../../components/UsagePanel";
import VoiceSettingsSection from "../../../../../components/VoiceSettingsSection";
import { storeCodexAvatar, setCodexIdentity } from "../../../../../lib/codex-identity.mjs";
import VoiceDevToolsSection from "../../../../../components/VoiceDevToolsSection";
import ArchivePage from "../../../../../components/ArchivePage";
import { readUsageStats, resetUsageStats } from "../../../../../lib/usage-stats";
import { ArchiveSettingsSection } from "../../../../settings-archive/ArchiveSettingsSection";
import { BrowserSettingsSection } from "../../../../settings-browser/BrowserSettingsSection";
import { AgentTeamSettingsSection } from "../../../../settings-agentteam/AgentTeamSettingsSection";
import { AutomationSettingsSection } from "../../../../settings-automation/AutomationSettingsSection";
import { PersonalizationSettingsSection } from "../../../../settings-personalization/PersonalizationSettingsSection";
import { EXPERT_CATEGORY_DEFS, LOCAL_MODEL_PRESETS, SHORTCUT_GROUPS } from "../../../constants";
import { ToolCard, builtinCommandCatalog, categoryLabel, cronTemplates, describeSchedule, displayPath, idleTemplates, modelName, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, sandboxPolicy, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, uniqueModelCount } from "../../../helpers";

const ModelSettingsSection = lazy(() => import("../../../../settings-model/ModelSettingsSection").then((m) => ({ default: m.ModelSettingsSection })));
const McpSettingsSection = lazy(() => import("../../../../settings-mcp/McpSettingsSection").then((m) => ({ default: m.McpSettingsSection })));
const SkillsCenterSection = lazy(() => import("../../../../settings-skills/SkillsCenterSection").then((m) => ({ default: m.SkillsCenterSection })));
const GeneralSettingsSection = lazy(() => import("../../../../settings-general/GeneralSettingsSection").then((m) => ({ default: m.GeneralSettingsSection })));
const UserCenterSection = lazy(() => import("../../../../../components/UserCenter").then((m) => ({ default: m.UserCenterSection })));
const PluginsMarketSection = lazy(() => import("../../../../settings-plugins/PluginsMarketSection").then((m) => ({ default: m.PluginsMarketSection })));
const DevtoolsSettingsSection = lazy(() => import("../../../../settings-devtools/DevtoolsSettingsSection").then((m) => ({ default: m.DevtoolsSettingsSection })));
const SshSettingsSection = lazy(() => import("../../../../settings-ssh/SshSettingsSection").then((m) => ({ default: m.SshSettingsSection })));
const CommandsSettingsSection = lazy(() => import("../../../../settings-commands/CommandsSettingsSection").then((m) => ({ default: m.CommandsSettingsSection })));
const PersonalizationPage = lazy(() => import("../../../../../components/PersonalizationPage").then((m) => ({ default: m.PersonalizationPage })));
const BuiltinPluginsSection = lazy(() => import("../../../../../components/BuiltinPlugins").then((m) => ({ default: m.BuiltinPluginsSection })));
const TeamsSettingsSection = lazy(() => import("../../../../settings-teams/TeamsSettingsSection").then((m) => ({ default: m.TeamsSettingsSection })));
const HooksSettingsSection = lazy(() => import("../../../../settings-hooks/HooksSettingsSection").then((m) => ({ default: m.HooksSettingsSection })));
const RpaSettingsSection = lazy(() => import("../../../../settings-rpa/RpaSettingsSection").then((m) => ({ default: m.RpaSettingsSection })));
const ScheduleSettingsSection = lazy(() => import("../../../../settings-schedule/ScheduleSettingsSection").then((m) => ({ default: m.ScheduleSettingsSection })));
const MemoryCenterSection = lazy(() => import("../../../../settings-memory/MemoryCenterSection").then((m) => ({ default: m.MemoryCenterSection })));
const AgentsSettingsSection = lazy(() => import("../../../../settings-agents/AgentsSettingsSection").then((m) => ({ default: m.AgentsSettingsSection })));
const BackupSettingsSection = lazy(() => import("../../../../settings-backup/BackupSettingsSection").then((m) => ({ default: m.BackupSettingsSection })));
const AppearanceSettingsSection = lazy(() => import("../../../../settings-appearance/AppearanceSettingsSection").then((m) => ({ default: m.AppearanceSettingsSection })));
const ExpertCenterSection = lazy(() => import("../../../../settings-expert-center/ExpertCenterSection").then((m) => ({ default: m.ExpertCenterSection })));
const ComputerSettingsSection = lazy(() => import("../../../../settings-computer/ComputerSettingsSection").then((m) => ({ default: m.ComputerSettingsSection })));
const RelayCenterPage = lazy(() => import("../../../../relay").then((m) => ({ default: m.RelayCenterPage })));
const OpenaiSubscriptionPage = lazy(() => import("../../../../openai").then((m) => ({ default: m.OpenaiSubscriptionPage })));
const SshTerminalModal = lazy(() => import("../../../../ssh").then((m) => ({ default: m.SshTerminalModal })));
const SshExecModal = lazy(() => import("../../../../ssh").then((m) => ({ default: m.SshExecModal })));
const StorageSection = lazy(() => import("../../../../storage-settings").then((m) => ({ default: m.StorageSection })));
/* 拓展接口页：按需加载（清单在 src/lib/extensibility-catalog.mjs，页面只做渲染） */
const ExtensibilitySettingsSection = lazy(() => import("../../../../settings-extensibility").then((m) => ({ default: m.ExtensibilitySettingsSection })));
/* 截图页：快捷键绑定 + 截图行为（入口只有快捷键与「试试截图」，输入框不另加图标按钮） */
const ScreenshotSettingsSection = lazy(() => import("../../../../settings-screenshot").then((m) => ({ default: m.ScreenshotSettingsSection })));
/* 收藏夹页：批量管理 + 加入 Agent 记忆（与输入框加号菜单共用 app 层同一对动作） */
const FavoritesSettingsSection = lazy(() => import("../../../../settings-favorites").then((m) => ({ default: m.FavoritesSettingsSection })));

export interface SettingsPageEntry {
  /** 二级入口页的「返回条」（一级页不填） */
  back?: { to: SettingsPage; label: string };
  render: () => ReactNode;
}

export function settingsPagesOf(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  /* ↓↓↓ 与搬迁前 02-settings-content 的同名解构逐字一致 ↓↓↓ */
  const {
    activateOfficialProvider,
    adaptiveTone,
    applyGlobalPermissionMode,
    applyGroup,
    applyModelIdInput,
    approvalPolicy,
    autoCompactRatio,
    backupBusy,
    batchSetConnectorsEnabled,
    batchSetMcpServersEnabled,
    batchSetPluginEnabled,
    batchSetSkillEnabled,
    browserAuto,
    browserHome,
    capabilityError,
    capabilityHint,
    capabilityRows,
    changeAdaptiveTone,
    changeApproval,
    changeDownloadSource,
    changeHardwareAccel,
    changePersonality,
    changePlugin,
    changeSandbox,
    checkEngineUpdateNow,
    chooseTeamCwd,
    chooseWorkspace,
    clearTeamCwd,
    codexIdentity,
    commandBusy,
    commandBusyKey,
    commandDelete,
    commandEditor,
    commandFilter,
    commandSearch,
    confirmDeleteCommand,
    connectorBatchBusy,
    connectorChecked,
    connectorDraft,
    connectorEditorOpen,
    connectorOAuth,
    connectorSaving,
    connectorSearch,
    connectorSecret,
    connectorStatusBusy,
    connectorTemplateModal,
    connectorTemplateSaving,
    connectorTemplateValues,
    connectorTemplates,
    connectors,
    connectorsManageOnly,
    currentProvider,
    customCommands,
    customDraft,
    customModel,
    deleteExpertTeam,
    deleteSchedule,
    deleteSubAgent,
    desktopAuto,
    devRuntimes,
    downloadSource,
    duplicateSshEntry,
    editSchedule,
    editingProvider,
    emptySshDraft,
    emptySshJump,
    engineCheck,
    engineUpdateLog,
    engineUpdatePercent,
    engineUpdateResult,
    engineUpdateStageText,
    engineUpdating,
    engineVersion,
    expertTeamDraft,
    expertTeamEditorOpen,
    expertTeamMemberDirect,
    expertTeamMemberRunning,
    expertTeamRunning,
    expertTeams,
    exportSshEntries,
    exportThreadsBackup,
    exportThreadsMarkdown,
    globalPermApproval,
    groupBusy,
    handleLogout,
    hardwareAccel,
    hookBusy,
    hookTrusting,
    importConversationMarkdown,
    importSkill,
    importSshEntries,
    importThreadsBackup,
    installDevRuntime,
    installMarketPlugin,
    installMarketSkill,
    installMcpServer,
    installedTotalCount,
    installingMarketPlugin,
    installingMarketSkill,
    keepAwake,
    linkedBusy,
    localSkills,
    marketLoading,
    marketPage,
    marketPageSize,
    marketSkills,
    marketTotal,
    mcpMarketCategory,
    mcpMarketSearch,
    mcpOverrides,
    mcpServerBatchBusy,
    mcpServerChecked,
    mcpServerSearch,
    mcpServerStatusBusy,
    mcpToolPermissions,
    memories,
    memoryConfigOpen,
    memoryEnabled,
    memoryGateway,
    memoryGatewayAction,
    memoryGroups,
    memoryLayers,
    memoryMode,
    memoryStatus,
    modelEditor,
    modelId,
    modelSuggestions,
    openAppConfirm,
    openEditExpertTeam,
    openEditSubAgent,
    openModelEditor,
    openNewExpertTeam,
    openNewSubAgent,
    openThread,
    performEngineUpdateNow,
    persistCommand,
    personality,
    pluginBatchBusy,
    pluginBusy,
    pluginChecked,
    pluginInstalledOnly,
    pluginMarketCategory,
    pluginMarketItems,
    pluginMarketLoading,
    pluginMarketPage,
    pluginMarketPageSize,
    pluginMarketSearch,
    pluginMarketTotal,
    pluginSearch,
    ponytailOn,
    pptokenCardOff,
    probeActiveProvider,
    probeOneModel,
    probeProvider,
    probingProvider,
    providerAutoOpenRef,
    providerStatus,
    providersList,
    readMood,
    refreshActive,
    refreshCommands,
    refreshExpertTeams,
    refreshMarketSkills,
    refreshPluginsPage,
    refreshSettingsResources,
    refreshSubAgents,
    refreshThreads,
    relaunchCountdown,
    relayActivate,
    relayBusy,
    removeConnector,
    removeLocalSkill,
    removeProvider,
    removeSshEntries,
    resetExpertTeams,
    resourceError,
    resourceLoading,
    restartPending,
    rightOpen,
    rpaRecipes,
    rpaRunning,
    runSchedule,
    runtimeInstalling,
    runtimeModal,
    runtimePercent,
    runtimeProgress,
    runtimeSpeed,
    runtimeStage,
    sandbox,
    saveConnector,
    saveConnectorFromTemplate,
    saveCustomDraft,
    saveCustomModel,
    saveExpertTeam,
    saveMemoryGateway,
    saveModelEditor,
    saveSshEntry,
    saveSubAgent,
    savingSettings,
    scheduledTasks,
    selectedModel,
    setAutoCompactRatio,
    setAutoFormVisible,
    setBrowserDraft,
    setBrowserHome,
    setCommandDelete,
    setCommandEditor,
    setCommandFilter,
    setCommandSearch,
    setConnectorChecked,
    setConnectorDraft,
    setConnectorEditorOpen,
    setConnectorEnabled,
    setConnectorOAuth,
    setConnectorSearch,
    setConnectorSecret,
    setConnectorTemplateModal,
    setConnectorTemplateValues,
    setConnectorsManageOnly,
    setCustomDraft,
    setEditingProvider,
    setExpertTeamDraft,
    setExpertTeamEditorOpen,
    setHookEnabled,
    setKeepAwake,
    setLinkedEnabled,
    setMarketPage,
    setMarketPreview,
    setMcpMarketCategory,
    setMcpMarketSearch,
    setMcpServerChecked,
    setMcpServerEnabled,
    setMcpServerSearch,
    setMcpToolPermission,
    setMemoryCenterOpen,
    setMemoryCenterTab,
    setMemoryConfigOpen,
    setMemoryEnabled,
    setMemoryGateway,
    setModelEditor,
    setNotice,
    setOpenaiActiveAcct,
    setPluginChecked,
    setPluginEnabled,
    setPluginInstalledOnly,
    setPluginMarketCategory,
    setPluginMarketPage,
    setPluginMarketSearch,
    setPluginSearch,
    setPptokenCardOff,
    setProviderEnabled,
    setRightOpen,
    setRpaRecipes,
    setRpaRunning,
    setRuntimeModal,
    setScheduleDraft,
    setScheduledTasks,
    setSelectedSkills,
    setSettingsOpen,
    setSettingsPage,
    setShortcutsOpen,
    setShowApiKey,
    setSkillChecked,
    setSkillHubCategory,
    setSkillHubFilterCategory,
    setSkillHubSearch,
    setSkillManageSearch,
    setSkillsManageOnly,
    setSshChecked,
    setSshDraft,
    setSshEditorTest,
    setSshExecTarget,
    setSshFilter,
    setSshQuery,
    setSshTerminal,
    setSubAgentDraft,
    setSubAgentEditorOpen,
    setTaskList,
    setTheme,
    setUiFont,
    setUsageStats,
    setUserAvatar,
    setUsername,
    settingsContentReady,
    settingsPage,
    settingsResources,
    showApiKey,
    showToast,
    skillBatchBusy,
    skillChecked,
    skillHubCategory,
    skillHubFilterCategory,
    skillHubSearch,
    skillManageSearch,
    skillsManageOnly,
    sshBatchBusy,
    sshBusyId,
    sshChecked,
    sshCheckedSet,
    sshDraft,
    sshDraftValid,
    sshEditorTest,
    sshExecTarget,
    sshFilter,
    sshQuery,
    sshSaving,
    sshServers,
    sshTerminal,
    sshTestingId,
    sshToggleChecked,
    sshVisible,
    startConnectorOAuth,
    startMemberDirectSession,
    startTeamSession,
    stats,
    subAgentDraft,
    subAgentEditorOpen,
    subAgents,
    switchingModel,
    targetProviderHint,
    taskList,
    teamCwdMap,
    testMemoryGateway,
    testSshBatch,
    testSshDraft,
    testSshEntry,
    theme,
    thread,
    threadCacheRef,
    threads,
    toggleBrowserAuto,
    toggleDesktopAuto,
    toggleExpertTeamEnabled,
    toggleSchedule,
    toggleSkillEnabled,
    toggleSshBatch,
    toggleSshEntry,
    toggleSshFavorite,
    toggleSubAgentEnabled,
    tokenUsage,
    toolsStatus,
    trustAllHooks,
    uiFont,
    uninstallDevRuntime,
    usage,
    useCommand,
    userDataPath,
    username,
    workspace,
    workspaceMemoryEnabled,
    addFavoriteItem,
    favorites,
    favoritesBusy,
    favoriteToMemory,
    insertFavorite,
    refreshFavorites,
    removeFavoriteItems,
    sendFavorite,
    updateFavoriteItem,
  } = app;

  return {
    automation: { render: () => <AutomationSettingsSection setSettingsPage={setSettingsPage} /> },
    agentteam: { render: () => <AgentTeamSettingsSection setSettingsPage={setSettingsPage} /> },
    "expert-center": { back: { to: "agentteam", label: "返回智能体团队" }, render: () => <ExpertCenterSection expertTeams={expertTeams} EXPERT_CATEGORY_DEFS={EXPERT_CATEGORY_DEFS} expertTeamMemberDirect={expertTeamMemberDirect} startMemberDirectSession={startMemberDirectSession} /> },
    user: { render: () => <UserCenterSection
                          username={username}
                          onUsernameChange={(name) => { setUsername(name); }}
                          personality={personality}
                          onPersonalityChange={(v) => changePersonality(v)}
                          onNotice={(m) => setNotice(m)}
                          onProfileChange={(p) => setUserAvatar(p.avatarType && p.avatar ? { type: p.avatarType, value: p.avatar } : null)}
                          onLogout={handleLogout}
                          assistantName={codexIdentity.name}
                          onAssistantNameChange={(name) => {
                            // 名字落 personalization（引擎侧也会知道自己叫什么：applyPersonalizationToAgentsMd 会写进 AGENTS.md）
                            setCodexIdentity({ name });
                            void window.codex.saveIdentity({ assistantName: name }).catch(() => undefined);
                          }}
                          codexAvatar={codexIdentity.avatar}
                          onCodexAvatarChange={(spec) => { storeCodexAvatar(spec); setCodexIdentity({ avatar: spec }); }}
                        /> },
    general: { render: () => <GeneralSettingsSection globalPermApproval={globalPermApproval} applyGlobalPermissionMode={applyGlobalPermissionMode} workspace={workspace} chooseWorkspace={chooseWorkspace} userDataPath={userDataPath} setNotice={setNotice} rightOpen={rightOpen} setRightOpen={setRightOpen} capabilityHint={capabilityHint} desktopAuto={desktopAuto} groupBusy={groupBusy} toggleDesktopAuto={toggleDesktopAuto} browserAuto={browserAuto} toggleBrowserAuto={toggleBrowserAuto} ponytailOn={ponytailOn} applyGroup={applyGroup} hardwareAccel={hardwareAccel} changeHardwareAccel={changeHardwareAccel} restartPending={restartPending} SHORTCUT_GROUPS={SHORTCUT_GROUPS} setShortcutsOpen={setShortcutsOpen} engineVersion={engineVersion} engineCheck={engineCheck} engineUpdating={engineUpdating} checkEngineUpdateNow={checkEngineUpdateNow} performEngineUpdateNow={performEngineUpdateNow} engineUpdatePercent={engineUpdatePercent} engineUpdateStageText={engineUpdateStageText} engineUpdateLog={engineUpdateLog} engineUpdateResult={engineUpdateResult} relaunchCountdown={relaunchCountdown} /> },
    devtools: { render: () => <DevtoolsSettingsSection downloadSource={downloadSource} changeDownloadSource={changeDownloadSource} capabilityRows={capabilityRows} capabilityError={capabilityError} VoiceDevToolsSection={VoiceDevToolsSection} setNotice={setNotice} devRuntimes={devRuntimes} runtimeInstalling={runtimeInstalling} runtimePercent={runtimePercent} runtimeStage={runtimeStage} runtimeSpeed={runtimeSpeed} runtimeProgress={runtimeProgress} installDevRuntime={installDevRuntime} uninstallDevRuntime={uninstallDevRuntime} /> },
    extensibility: { render: () => <ExtensibilitySettingsSection onNotice={setNotice} /> },
    screenshot: { render: () => <ScreenshotSettingsSection onNotice={setNotice} /> },
    favorites: { render: () => <FavoritesSettingsSection
      favorites={favorites}
      busy={favoritesBusy}
      workspace={workspace}
      onInsert={insertFavorite}
      onSend={(item) => void sendFavorite(item)}
      onAdd={addFavoriteItem}
      onUpdate={updateFavoriteItem}
      onRemove={removeFavoriteItems}
      onRefresh={refreshFavorites}
      onToMemory={favoriteToMemory}
      onNotice={setNotice}
      onToast={showToast}
    /> },
    browser: { back: { to: "automation", label: "返回自动化" }, render: () => <BrowserSettingsSection browserHome={browserHome} setBrowserHome={setBrowserHome} setBrowserDraft={setBrowserDraft} setNotice={setNotice} toolsStatus={toolsStatus} ToolCard={ToolCard} /> },
    appearance: { render: () => <AppearanceSettingsSection theme={theme} setTheme={setTheme} uiFont={uiFont} setUiFont={setUiFont} /> },
    personalization: { render: () => <>{<PersonalizationPage personality={personality} onPersonalityChange={changePersonality} onNotice={setNotice} />}{<PersonalizationSettingsSection adaptiveTone={adaptiveTone} changeAdaptiveTone={changeAdaptiveTone} thread={thread} readMood={readMood} />}</> },
    voice: { render: () => <VoiceSettingsSection onNotice={setNotice} /> },
    relay: { render: () => <RelayCenterPage busy={relayBusy} activeProvider={customModel?.provider} onActivate={relayActivate} onNotice={setNotice} onOpenModelSettings={() => { setSettingsPage("model"); }} openAppConfirm={openAppConfirm} /> },
    openai: { render: () => <OpenaiSubscriptionPage activeProvider={customModel?.provider} onActivate={(models) => activateOfficialProvider(models)} onNotice={setNotice} onActiveChange={setOpenaiActiveAcct} onRefreshActive={() => refreshActive()} openAppConfirm={openAppConfirm} /> },
    model: { render: () => <ModelSettingsSection autoCompactRatio={autoCompactRatio} setAutoCompactRatio={setAutoCompactRatio} setNotice={setNotice} providersList={providersList} pptokenCardOff={pptokenCardOff} editingProvider={editingProvider} setCustomDraft={setCustomDraft} setEditingProvider={setEditingProvider} uniqueModelCount={uniqueModelCount} customModel={customModel} setPptokenCardOff={setPptokenCardOff} setProviderEnabled={setProviderEnabled} currentProvider={currentProvider} probingProvider={probingProvider} probeActiveProvider={probeActiveProvider} providerAutoOpenRef={providerAutoOpenRef} customDraft={customDraft} savingSettings={savingSettings} openAppConfirm={openAppConfirm} removeProvider={removeProvider} LOCAL_MODEL_PRESETS={LOCAL_MODEL_PRESETS} showApiKey={showApiKey} setShowApiKey={setShowApiKey} probeProvider={probeProvider} saveCustomDraft={saveCustomDraft} switchingModel={switchingModel} probeOneModel={probeOneModel} openModelEditor={openModelEditor} providerStatus={providerStatus} showToast={showToast} saveCustomModel={saveCustomModel} modelEditor={modelEditor} setModelEditor={setModelEditor} targetProviderHint={targetProviderHint} applyModelIdInput={applyModelIdInput} modelSuggestions={modelSuggestions} saveModelEditor={saveModelEditor} /> },
    memory: { render: () => <MemoryCenterSection memoryEnabled={memoryEnabled} setMemoryEnabled={setMemoryEnabled} setMemoryCenterTab={setMemoryCenterTab} setMemoryCenterOpen={setMemoryCenterOpen} memories={memories} memoryGroups={memoryGroups} memoryLayers={memoryLayers} memoryMode={memoryMode} workspaceMemoryEnabled={workspaceMemoryEnabled} threads={threads} scheduledTasks={scheduledTasks} localSkills={localSkills} memoryStatus={memoryStatus} memoryConfigOpen={memoryConfigOpen} memoryGateway={memoryGateway} setMemoryGateway={setMemoryGateway} memoryGatewayAction={memoryGatewayAction} setMemoryConfigOpen={setMemoryConfigOpen} testMemoryGateway={testMemoryGateway} saveMemoryGateway={saveMemoryGateway} /> },
    schedule: { render: () => <ScheduleSettingsSection setScheduleDraft={setScheduleDraft} workspace={workspace} setAutoFormVisible={setAutoFormVisible} scheduledTasks={scheduledTasks} toggleSchedule={toggleSchedule} describeSchedule={describeSchedule} runSchedule={runSchedule} editSchedule={editSchedule} deleteSchedule={deleteSchedule} keepAwake={keepAwake} setKeepAwake={setKeepAwake} idleTemplates={idleTemplates} cronTemplates={cronTemplates} setScheduledTasks={setScheduledTasks} setNotice={setNotice} /> },
    rpa: { back: { to: "automation", label: "返回自动化" }, render: () => <RpaSettingsSection rpaRecipes={rpaRecipes} rpaRunning={rpaRunning} thread={thread} setNotice={setNotice} setRpaRunning={setRpaRunning} selectedModel={selectedModel} modelName={modelName} modelId={modelId} sandboxPolicy={sandboxPolicy} sandbox={sandbox} workspace={workspace} openAppConfirm={openAppConfirm} setRpaRecipes={setRpaRecipes} taskList={taskList} setTaskList={setTaskList} /> },
    plugins: { render: () => <>{<BuiltinPluginsSection onNotice={(m) => setNotice(m)} />}{<PluginsMarketSection settingsResources={settingsResources} pluginSearch={pluginSearch} pluginInstalledOnly={pluginInstalledOnly} pluginDisplayName={pluginDisplayName} pluginDescription={pluginDescription} pluginChecked={pluginChecked} setPluginChecked={setPluginChecked} refreshPluginsPage={refreshPluginsPage} resourceLoading={resourceLoading} pluginMarketLoading={pluginMarketLoading} pluginMarketCategoryTabs={pluginMarketCategoryTabs} pluginMarketCategory={pluginMarketCategory} setPluginMarketCategory={setPluginMarketCategory} setPluginMarketPage={setPluginMarketPage} pluginMarketSearch={pluginMarketSearch} setPluginMarketSearch={setPluginMarketSearch} pluginMarketItems={pluginMarketItems} installingMarketPlugin={installingMarketPlugin} setMarketPreview={setMarketPreview} installMarketPlugin={installMarketPlugin} pluginMarketTotal={pluginMarketTotal} pluginMarketPage={pluginMarketPage} pluginMarketPageSize={pluginMarketPageSize} setPluginInstalledOnly={setPluginInstalledOnly} setPluginSearch={setPluginSearch} pluginBatchBusy={pluginBatchBusy} batchSetPluginEnabled={batchSetPluginEnabled} pluginBusy={pluginBusy} setPluginEnabled={setPluginEnabled} changePlugin={changePlugin} />}</> },
    skills: { render: () => <>{<SkillsCenterSection userDataPath={userDataPath} displayPath={displayPath} skillsManageOnly={skillsManageOnly} setSkillsManageOnly={setSkillsManageOnly} installedTotalCount={installedTotalCount} importSkill={importSkill} refreshMarketSkills={refreshMarketSkills} skillHubCategory={skillHubCategory} skillHubSearch={skillHubSearch} marketPage={marketPage} marketLoading={marketLoading} skillHubCategories={skillHubCategories} setSkillHubCategory={setSkillHubCategory} setMarketPage={setMarketPage} skillManageSearch={skillManageSearch} setSkillManageSearch={setSkillManageSearch} setSkillHubSearch={setSkillHubSearch} skillHubCategoryTabs={skillHubCategoryTabs} skillHubFilterCategory={skillHubFilterCategory} setSkillHubFilterCategory={setSkillHubFilterCategory} marketSkills={marketSkills} skillHubCategoryName={skillHubCategoryName} localSkills={localSkills} settingsResources={settingsResources} skillChecked={skillChecked} setSkillChecked={setSkillChecked} skillZhNote={skillZhNote} toggleSkillEnabled={toggleSkillEnabled} setSelectedSkills={setSelectedSkills} setSettingsOpen={setSettingsOpen} removeLocalSkill={removeLocalSkill} skillBatchBusy={skillBatchBusy} batchSetSkillEnabled={batchSetSkillEnabled} marketPageSize={marketPageSize} setMarketPreview={setMarketPreview} setNotice={setNotice} installMarketSkill={installMarketSkill} installingMarketSkill={installingMarketSkill} />}{!skillsManageOnly && <div className="skill-market-pagination"><span>共 {marketTotal} 个技能 · 第 {marketPage} / {Math.max(1, Math.ceil(marketTotal / marketPageSize))} 页</span><div><button className="secondary-setting" disabled={marketLoading || marketPage <= 1} onClick={() => setMarketPage((page) => Math.max(1, page - 1))}><ArrowLeft size={14} />上一页</button><button className="secondary-setting" disabled={marketLoading || marketPage >= Math.max(1, Math.ceil(marketTotal / marketPageSize))} onClick={() => setMarketPage((page) => page + 1)}>下一页<ArrowRight size={14} /></button></div></div>}</> },
    commands: { render: () => <CommandsSettingsSection settingsResources={settingsResources} customCommands={customCommands} commandSearch={commandSearch} builtinCommandCatalog={builtinCommandCatalog} commandFilter={commandFilter} setNotice={setNotice} setCommandEditor={setCommandEditor} workspace={workspace} refreshCommands={refreshCommands} commandBusy={commandBusy} setCommandSearch={setCommandSearch} setCommandFilter={setCommandFilter} setCommandDelete={setCommandDelete} useCommand={useCommand} commandEditor={commandEditor} commandBusyKey={commandBusyKey} persistCommand={persistCommand} commandDelete={commandDelete} confirmDeleteCommand={confirmDeleteCommand} /> },
    hooks: { render: () => <HooksSettingsSection settingsResources={settingsResources} pluginDisplayName={pluginDisplayName} localSkills={localSkills} hookTrusting={hookTrusting} trustAllHooks={trustAllHooks} refreshSettingsResources={refreshSettingsResources} resourceLoading={resourceLoading} linkedBusy={linkedBusy} setLinkedEnabled={setLinkedEnabled} hookBusy={hookBusy} setHookEnabled={setHookEnabled} /> },
    agents: { back: { to: "agentteam", label: "返回智能体团队" }, render: () => <AgentsSettingsSection openNewSubAgent={openNewSubAgent} refreshSubAgents={refreshSubAgents} resourceLoading={resourceLoading} subAgents={subAgents} toggleSubAgentEnabled={toggleSubAgentEnabled} openEditSubAgent={openEditSubAgent} deleteSubAgent={deleteSubAgent} subAgentEditorOpen={subAgentEditorOpen} subAgentDraft={subAgentDraft} setSubAgentDraft={setSubAgentDraft} setSubAgentEditorOpen={setSubAgentEditorOpen} saveSubAgent={saveSubAgent} /> },
    teams: { back: { to: "agentteam", label: "返回智能体团队" }, render: () => <TeamsSettingsSection openNewExpertTeam={openNewExpertTeam} resetExpertTeams={resetExpertTeams} refreshExpertTeams={refreshExpertTeams} resourceLoading={resourceLoading} expertTeams={expertTeams} toggleExpertTeamEnabled={toggleExpertTeamEnabled} categoryLabel={categoryLabel} expertTeamMemberRunning={expertTeamMemberRunning} expertTeamMemberDirect={expertTeamMemberDirect} startMemberDirectSession={startMemberDirectSession} teamCwdMap={teamCwdMap} workspace={workspace} chooseTeamCwd={chooseTeamCwd} clearTeamCwd={clearTeamCwd} startTeamSession={startTeamSession} expertTeamRunning={expertTeamRunning} openEditExpertTeam={openEditExpertTeam} deleteExpertTeam={deleteExpertTeam} expertTeamEditorOpen={expertTeamEditorOpen} expertTeamDraft={expertTeamDraft} setExpertTeamDraft={setExpertTeamDraft} setExpertTeamEditorOpen={setExpertTeamEditorOpen} saveExpertTeam={saveExpertTeam} openTeamOfficePreview={(teamId: string) => app.setCompanyPreviewTeamId(teamId)} /> },
    mcp: { render: () => <McpSettingsSection  connectors={connectors} connectorsManageOnly={connectorsManageOnly} settingsResources={settingsResources} connectorSearch={connectorSearch} connectorChecked={connectorChecked} setConnectorChecked={setConnectorChecked} mcpOverrides={mcpOverrides} mcpServerSearch={mcpServerSearch} mcpServerChecked={mcpServerChecked} setMcpServerChecked={setMcpServerChecked} setConnectorSecret={setConnectorSecret} setConnectorDraft={setConnectorDraft} setConnectorEditorOpen={setConnectorEditorOpen} refreshSettingsResources={refreshSettingsResources} resourceLoading={resourceLoading} mcpMarketCategory={mcpMarketCategory} setMcpMarketCategory={setMcpMarketCategory} setMcpMarketSearch={setMcpMarketSearch} mcpMarketSearch={mcpMarketSearch} setMarketPreview={setMarketPreview} installMcpServer={installMcpServer} connectorTemplates={connectorTemplates} setConnectorTemplateValues={setConnectorTemplateValues} setConnectorTemplateModal={setConnectorTemplateModal} setConnectorOAuth={setConnectorOAuth} connectorTemplateModal={connectorTemplateModal} connectorTemplateValues={connectorTemplateValues} connectorTemplateSaving={connectorTemplateSaving} connectorOAuth={connectorOAuth} saveConnectorFromTemplate={saveConnectorFromTemplate} startConnectorOAuth={startConnectorOAuth} setConnectorsManageOnly={setConnectorsManageOnly} setConnectorSearch={setConnectorSearch} connectorBatchBusy={connectorBatchBusy} batchSetConnectorsEnabled={batchSetConnectorsEnabled} connectorStatusBusy={connectorStatusBusy} setConnectorEnabled={setConnectorEnabled} removeConnector={removeConnector} connectorEditorOpen={connectorEditorOpen} connectorDraft={connectorDraft} connectorSecret={connectorSecret} connectorSaving={connectorSaving} saveConnector={saveConnector} setMcpServerSearch={setMcpServerSearch} mcpServerBatchBusy={mcpServerBatchBusy} batchSetMcpServersEnabled={batchSetMcpServersEnabled} mcpServerStatusBusy={mcpServerStatusBusy} setMcpServerEnabled={setMcpServerEnabled} mcpToolPermissions={mcpToolPermissions} setMcpToolPermission={setMcpToolPermission} /> },
    ssh: { render: () => <SshSettingsSection setSshEditorTest={setSshEditorTest} setSshDraft={setSshDraft} emptySshDraft={emptySshDraft} sshQuery={sshQuery} setSshQuery={setSshQuery} sshFilter={sshFilter} setSshFilter={setSshFilter} sshServers={sshServers} exportSshEntries={exportSshEntries} sshBatchBusy={sshBatchBusy} importSshEntries={importSshEntries} sshVisible={sshVisible} sshChecked={sshChecked} setSshChecked={setSshChecked} toggleSshBatch={toggleSshBatch} testSshBatch={testSshBatch} removeSshEntries={removeSshEntries} sshBusyId={sshBusyId} sshTestingId={sshTestingId} sshCheckedSet={sshCheckedSet} sshToggleChecked={sshToggleChecked} toggleSshFavorite={toggleSshFavorite} toggleSshEntry={toggleSshEntry} setSshTerminal={setSshTerminal} testSshEntry={testSshEntry} setSshExecTarget={setSshExecTarget} duplicateSshEntry={duplicateSshEntry} /> },
    usage: { render: () => <UsagePanel
                          stats={stats}
                          currentInput={usage?.inputTokens ?? usage?.input_tokens ?? 0}
                          currentOutput={usage?.outputTokens ?? usage?.output_tokens ?? 0}
                          contextWindow={tokenUsage?.modelContextWindow ?? 0}
                          onReset={() => { resetUsageStats(); setUsageStats(readUsageStats()); setNotice("使用统计已清空"); }}
                        /> },
    backup: { render: () => <BackupSettingsSection thread={thread} backupBusy={backupBusy} exportThreadsMarkdown={exportThreadsMarkdown} exportThreadsBackup={exportThreadsBackup} threads={threads} importThreadsBackup={importThreadsBackup} importConversationMarkdown={importConversationMarkdown} /> },
    archive: { render: () => <ArchiveSettingsSection ArchivePage={ArchivePage} setNotice={setNotice} setSettingsOpen={setSettingsOpen} openThread={openThread} openAppConfirm={openAppConfirm} refreshThreads={refreshThreads} /> },
    storage: { render: () => <StorageSection
                          onNotice={setNotice}
                          openAppConfirm={openAppConfirm}
                          onClearMemoryCache={() => { threadCacheRef.current.clear(); void refreshThreads().catch(() => undefined); }}
                        /> },
    computer: { back: { to: "automation", label: "返回自动化" }, render: () => <ComputerSettingsSection approvalPolicy={approvalPolicy} sandbox={sandbox} changeApproval={changeApproval} changeSandbox={changeSandbox} personality={personality} changePersonality={changePersonality} toolsStatus={toolsStatus} ToolCard={ToolCard} /> },
  };
}
