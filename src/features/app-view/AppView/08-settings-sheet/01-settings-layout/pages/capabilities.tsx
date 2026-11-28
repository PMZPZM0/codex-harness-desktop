/**
 * 设置页 · 能力与内容（10-28 P1-2：从 00-settings-registry 的 366 行统一解构里拆出）。
 *
 * 每页只解构自己真正用到的 app 字段 —— 原注册表让 39 个页面共用一份 366 行的解构块，
 * 读一页要跨 300 行找绑定；拆完后本文件自包含。
 * ⛔ JSX 与搬迁前逐字一致（只换了外层包装与解构来源），行为等价性由预检【101】+ 设置页验收守着。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";
import { ToolCard, builtinCommandCatalog, categoryLabel, cronTemplates, describeSchedule, displayPath, idleTemplates, modelName, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, sandboxPolicy, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, uniqueModelCount } from "../../../../helpers";
const McpSettingsSection = lazy(() => import("../../../../../settings-mcp/McpSettingsSection").then((m) => ({ default: m.McpSettingsSection })));
const SkillsCenterSection = lazy(() => import("../../../../../settings-skills/SkillsCenterSection").then((m) => ({ default: m.SkillsCenterSection })));
const PluginsMarketSection = lazy(() => import("../../../../../settings-plugins/PluginsMarketSection").then((m) => ({ default: m.PluginsMarketSection })));
const CommandsSettingsSection = lazy(() => import("../../../../../settings-commands/CommandsSettingsSection").then((m) => ({ default: m.CommandsSettingsSection })));
const BuiltinPluginCards = lazy(() => import("../../../../../../components/BuiltinPlugins").then((m) => ({ default: m.BuiltinPluginCards })));
const DesignLibrarySection = lazy(() => import("../../../../../design-library").then((m) => ({ default: m.DesignLibraryPage })));

/** 设置页分组：能力（MCP 服务、插件、技能、连接器）。 */
export function capabilitiesPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    batchSetConnectorsEnabled,
    batchSetMcpServersEnabled,
    batchSetPluginEnabled,
    batchSetSkillEnabled,
    changePlugin,
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
    customCommands,
    importSkill,
    installMarketPlugin,
    installMarketSkill,
    installMcpServer,
    installedTotalCount,
    installingMarketPlugin,
    installingMarketSkill,
    localSkills,
    marketLoading,
    marketPage,
    marketPageSize,
    marketSkills,
    mcpMarketCategory,
    mcpMarketSearch,
    mcpOverrides,
    mcpServerBatchBusy,
    mcpServerChecked,
    mcpServerSearch,
    mcpServerStatusBusy,
    mcpToolPermissions,
    openAppConfirm,
    persistCommand,
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
    projectGroups,
    refreshCommands,
    refreshMarketSkills,
    refreshPluginsPage,
    refreshSettingsResources,
    removeConnector,
    removeLocalSkill,
    resourceLoading,
    saveConnector,
    saveConnectorFromTemplate,
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
    setMarketPage,
    setMarketPreview,
    setMcpMarketCategory,
    setMcpMarketSearch,
    setMcpServerChecked,
    setMcpServerEnabled,
    setMcpServerSearch,
    setMcpToolPermission,
    setNotice,
    setPluginChecked,
    setPluginEnabled,
    setPluginInstalledOnly,
    setPluginMarketCategory,
    setPluginMarketPage,
    setPluginMarketSearch,
    setPluginSearch,
    setSelectedSkills,
    setSettingsOpen,
    setSkillChecked,
    setSkillHubCategory,
    setSkillHubFilterCategory,
    setSkillHubSearch,
    setSkillManageSearch,
    setSkillsManageOnly,
    setPrompt,
    settingsResources,
    skillBatchBusy,
    skillChecked,
    skillHubCategory,
    skillHubFilterCategory,
    skillHubSearch,
    skillManageSearch,
    skillsManageOnly,
    startConnectorOAuth,
    toggleSkillEnabled,
    useCommand,
    userDataPath,
    workspace,
  } = app;
  return {
    skills: { render: () => <>{<SkillsCenterSection openAppConfirm={openAppConfirm} userDataPath={userDataPath} displayPath={displayPath} projects={projectGroups} skillsManageOnly={skillsManageOnly} setSkillsManageOnly={setSkillsManageOnly} installedTotalCount={installedTotalCount} importSkill={importSkill} refreshMarketSkills={refreshMarketSkills} skillHubCategory={skillHubCategory} skillHubSearch={skillHubSearch} marketPage={marketPage} marketLoading={marketLoading} skillHubCategories={skillHubCategories} setSkillHubCategory={setSkillHubCategory} setMarketPage={setMarketPage} skillManageSearch={skillManageSearch} setSkillManageSearch={setSkillManageSearch} setSkillHubSearch={setSkillHubSearch} skillHubCategoryTabs={skillHubCategoryTabs} skillHubFilterCategory={skillHubFilterCategory} setSkillHubFilterCategory={setSkillHubFilterCategory} marketSkills={marketSkills} skillHubCategoryName={skillHubCategoryName} localSkills={localSkills} settingsResources={settingsResources} skillChecked={skillChecked} setSkillChecked={setSkillChecked} skillZhNote={skillZhNote} toggleSkillEnabled={toggleSkillEnabled} setSelectedSkills={setSelectedSkills} setSettingsOpen={setSettingsOpen} removeLocalSkill={removeLocalSkill} skillBatchBusy={skillBatchBusy} batchSetSkillEnabled={batchSetSkillEnabled} marketPageSize={marketPageSize} setMarketPreview={setMarketPreview} setNotice={setNotice} installMarketSkill={installMarketSkill} installingMarketSkill={installingMarketSkill} />}</> },
    plugins: { render: () => <PluginsMarketSection builtinSlot={<BuiltinPluginCards onNotice={(m) => setNotice(m)} />} openAppConfirm={openAppConfirm} settingsResources={settingsResources} pluginSearch={pluginSearch} pluginInstalledOnly={pluginInstalledOnly} pluginDisplayName={pluginDisplayName} pluginDescription={pluginDescription} pluginChecked={pluginChecked} setPluginChecked={setPluginChecked} refreshPluginsPage={refreshPluginsPage} resourceLoading={resourceLoading} pluginMarketLoading={pluginMarketLoading} pluginMarketCategoryTabs={pluginMarketCategoryTabs} pluginMarketCategory={pluginMarketCategory} setPluginMarketCategory={setPluginMarketCategory} setPluginMarketPage={setPluginMarketPage} pluginMarketSearch={pluginMarketSearch} setPluginMarketSearch={setPluginMarketSearch} pluginMarketItems={pluginMarketItems} installingMarketPlugin={installingMarketPlugin} setMarketPreview={setMarketPreview} installMarketPlugin={installMarketPlugin} pluginMarketTotal={pluginMarketTotal} pluginMarketPage={pluginMarketPage} pluginMarketPageSize={pluginMarketPageSize} setPluginInstalledOnly={setPluginInstalledOnly} setPluginSearch={setPluginSearch} pluginBatchBusy={pluginBatchBusy} batchSetPluginEnabled={batchSetPluginEnabled} pluginBusy={pluginBusy} setPluginEnabled={setPluginEnabled} changePlugin={changePlugin} setNotice={setNotice} /> },
    /* ⛔ 11-28 用户令（拍板「组件库只留右栏」）：这里不再渲染整份组件库（两套入口必然各自漂移），
       只留一句说明 + 直达按钮；真正的库在右栏「组件库」标签页。 */
    "component-library": { render: () => (
      <div className="settings-card">
        <p className="settings-hint">组件库已并入右侧边栏的「组件库」标签页：3,800+ 现成组件、分类与搜索、「交给 Codex」都在那里，不用在设置里翻。</p>
        <button type="button" className="secondary-setting" onClick={() => { setSettingsOpen(false); app.openPanelTab("library", "组件库"); }}>在右栏打开组件库</button>
      </div>
    ) },
    "design-library": { render: () => <DesignLibrarySection workspace={workspace} projects={projectGroups.map(([path]) => path)} onHandoff={(text) => setPrompt(text)} onCloseSettings={() => setSettingsOpen(false)} /> },
    mcp: { render: () => <McpSettingsSection openAppConfirm={openAppConfirm} connectors={connectors} connectorsManageOnly={connectorsManageOnly} settingsResources={settingsResources} connectorSearch={connectorSearch} connectorChecked={connectorChecked} setConnectorChecked={setConnectorChecked} mcpOverrides={mcpOverrides} mcpServerSearch={mcpServerSearch} mcpServerChecked={mcpServerChecked} setMcpServerChecked={setMcpServerChecked} setConnectorSecret={setConnectorSecret} setConnectorDraft={setConnectorDraft} setConnectorEditorOpen={setConnectorEditorOpen} refreshSettingsResources={refreshSettingsResources} resourceLoading={resourceLoading} mcpMarketCategory={mcpMarketCategory} setMcpMarketCategory={setMcpMarketCategory} setMcpMarketSearch={setMcpMarketSearch} mcpMarketSearch={mcpMarketSearch} setMarketPreview={setMarketPreview} installMcpServer={installMcpServer} connectorTemplates={connectorTemplates} setConnectorTemplateValues={setConnectorTemplateValues} setConnectorTemplateModal={setConnectorTemplateModal} setConnectorOAuth={setConnectorOAuth} connectorTemplateModal={connectorTemplateModal} connectorTemplateValues={connectorTemplateValues} connectorTemplateSaving={connectorTemplateSaving} connectorOAuth={connectorOAuth} saveConnectorFromTemplate={saveConnectorFromTemplate} startConnectorOAuth={startConnectorOAuth} setConnectorsManageOnly={setConnectorsManageOnly} setConnectorSearch={setConnectorSearch} connectorBatchBusy={connectorBatchBusy} batchSetConnectorsEnabled={batchSetConnectorsEnabled} connectorStatusBusy={connectorStatusBusy} setConnectorEnabled={setConnectorEnabled} removeConnector={removeConnector} connectorEditorOpen={connectorEditorOpen} connectorDraft={connectorDraft} connectorSecret={connectorSecret} connectorSaving={connectorSaving} saveConnector={saveConnector} setMcpServerSearch={setMcpServerSearch} mcpServerBatchBusy={mcpServerBatchBusy} batchSetMcpServersEnabled={batchSetMcpServersEnabled} mcpServerStatusBusy={mcpServerStatusBusy} setMcpServerEnabled={setMcpServerEnabled} mcpToolPermissions={mcpToolPermissions} setMcpToolPermission={setMcpToolPermission} setNotice={setNotice} /> },
    commands: { render: () => <CommandsSettingsSection settingsResources={settingsResources} customCommands={customCommands} commandSearch={commandSearch} builtinCommandCatalog={builtinCommandCatalog} commandFilter={commandFilter} setNotice={setNotice} setCommandEditor={setCommandEditor} workspace={workspace} refreshCommands={refreshCommands} commandBusy={commandBusy} setCommandSearch={setCommandSearch} setCommandFilter={setCommandFilter} setCommandDelete={setCommandDelete} useCommand={useCommand} commandEditor={commandEditor} commandBusyKey={commandBusyKey} persistCommand={persistCommand} commandDelete={commandDelete} confirmDeleteCommand={confirmDeleteCommand} /> },
  };
}
