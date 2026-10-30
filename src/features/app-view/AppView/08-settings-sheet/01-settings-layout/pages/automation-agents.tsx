/**
 * 设置页 · 自动化与智能体（10-28 P1-2：从 00-settings-registry 的 366 行统一解构里拆出）。
 *
 * 每页只解构自己真正用到的 app 字段 —— 原注册表让 39 个页面共用一份 366 行的解构块，
 * 读一页要跨 300 行找绑定；拆完后本文件自包含。
 * ⛔ JSX 与搬迁前逐字一致（只换了外层包装与解构来源），行为等价性由预检【101】+ 设置页验收守着。
 */
import type { HarnessAppApi } from "../../../../../app-state/useHarnessApp";
import type { SettingsPage, SettingsPageEntry } from "../types";
import { lazy } from "react";
import { BrowserSettingsSection } from "../../../../../settings-browser/BrowserSettingsSection";
import { AgentTeamSettingsSection } from "../../../../../settings-agentteam/AgentTeamSettingsSection";
import { AutomationSettingsSection } from "../../../../../settings-automation/AutomationSettingsSection";
import { EXPERT_CATEGORY_DEFS, LOCAL_MODEL_PRESETS, SHORTCUT_GROUPS } from "../../../../constants";
import { ToolCard, builtinCommandCatalog, categoryLabel, cronTemplates, describeSchedule, displayPath, idleTemplates, modelName, pluginDescription, pluginDisplayName, pluginMarketCategoryTabs, sandboxPolicy, skillHubCategories, skillHubCategoryName, skillHubCategoryTabs, skillZhNote, uniqueModelCount } from "../../../../helpers";
const SshSettingsSection = lazy(() => import("../../../../../settings-ssh/SshSettingsSection").then((m) => ({ default: m.SshSettingsSection })));
const TeamsSettingsSection = lazy(() => import("../../../../../settings-teams/TeamsSettingsSection").then((m) => ({ default: m.TeamsSettingsSection })));
const HooksSettingsSection = lazy(() => import("../../../../../settings-hooks/HooksSettingsSection").then((m) => ({ default: m.HooksSettingsSection })));
const RpaSettingsSection = lazy(() => import("../../../../../settings-rpa/RpaSettingsSection").then((m) => ({ default: m.RpaSettingsSection })));
const ScheduleSettingsSection = lazy(() => import("../../../../../settings-schedule/ScheduleSettingsSection").then((m) => ({ default: m.ScheduleSettingsSection })));
const AgentsSettingsSection = lazy(() => import("../../../../../settings-agents/AgentsSettingsSection").then((m) => ({ default: m.AgentsSettingsSection })));
const ExpertCenterSection = lazy(() => import("../../../../../settings-expert-center/ExpertCenterSection").then((m) => ({ default: m.ExpertCenterSection })));
const CliAgentsSettingsSection = lazy(() => import("../../../../../settings-cli-agents/CliAgentsSettingsSection").then((m) => ({ default: m.CliAgentsSettingsSection })));
const ComputerSettingsSection = lazy(() => import("../../../../../settings-computer/ComputerSettingsSection").then((m) => ({ default: m.ComputerSettingsSection })));
const BossGroupsSection = lazy(() => import("../../../../../settings-boss-groups/BossGroupsSection").then((m) => ({ default: m.BossGroupsSection })));
const ExpertMarketSection = lazy(() => import("../../../../../expert-market/ExpertMarketSection").then((m) => ({ default: m.ExpertMarketSection })));

export function automationAgentsPages(app: HarnessAppApi): Partial<Record<SettingsPage, SettingsPageEntry>> {
  const {
    approvalPolicy,
    browserHome,
    changeApproval,
    changePersonality,
    changeSandbox,
    chooseTeamCwd,
    clearTeamCwd,
    deleteExpertTeam,
    deleteSchedule,
    deleteSubAgent,
    duplicateSshEntry,
    editSchedule,
    emptySshDraft,
    expertTeamDraft,
    expertTeamEditorOpen,
    expertTeamMemberDirect,
    expertTeamMemberRunning,
    expertTeamRunning,
    expertTeams,
    exportSshEntries,
    hookBusy,
    hookTrusting,
    importSshEntries,
    keepAwake,
    linkedBusy,
    localSkills,
    modelId,
    openAppConfirm,
    openEditExpertTeam,
    openEditSubAgent,
    openNewExpertTeam,
    openNewSubAgent,
    personality,
    expertMarketOpen,
    setExpertMarketOpen,
    refreshExpertCenterData,
    refreshExpertTeams,
    refreshSettingsResources,
    refreshSubAgents,
    removeSshEntries,
    resetExpertTeams,
    resourceLoading,
    rpaRecipes,
    rpaRunning,
    runSchedule,
    sandbox,
    saveExpertTeam,
    saveSubAgent,
    scheduledTasks,
    selectedModel,
    setAutoFormVisible,
    setBrowserDraft,
    setBrowserHome,
    setExpertTeamDraft,
    setExpertTeamEditorOpen,
    setHookEnabled,
    setKeepAwake,
    setLinkedEnabled,
    setNotice,
    setRpaRecipes,
    setRpaRunning,
    setScheduleDraft,
    setScheduledTasks,
    setSettingsPage,
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
    settingsResources,
    sshBatchBusy,
    sshBusyId,
    sshChecked,
    sshCheckedSet,
    sshFilter,
    sshQuery,
    sshServers,
    sshTestingId,
    sshToggleChecked,
    sshVisible,
    startMemberDirectSession,
    startTeamSession,
    subAgentDraft,
    subAgentEditorOpen,
    subAgents,
    taskList,
    teamCwdMap,
    testSshBatch,
    testSshEntry,
    thread,
    toggleExpertTeamEnabled,
    toggleSchedule,
    toggleSshBatch,
    toggleSshEntry,
    toggleSshFavorite,
    toggleSubAgentEnabled,
    toolsStatus,
    trustAllHooks,
    workspace,
  } = app;
  return {
    automation: { render: () => <AutomationSettingsSection setSettingsPage={setSettingsPage} setNotice={setNotice} /> },
    schedule: { render: () => <ScheduleSettingsSection setScheduleDraft={setScheduleDraft} workspace={workspace} setAutoFormVisible={setAutoFormVisible} scheduledTasks={scheduledTasks} toggleSchedule={toggleSchedule} describeSchedule={describeSchedule} runSchedule={runSchedule} editSchedule={editSchedule} deleteSchedule={deleteSchedule} keepAwake={keepAwake} setKeepAwake={setKeepAwake} idleTemplates={idleTemplates} cronTemplates={cronTemplates} setScheduledTasks={setScheduledTasks} setNotice={setNotice} /> },
    hooks: { render: () => <HooksSettingsSection settingsResources={settingsResources} pluginDisplayName={pluginDisplayName} localSkills={localSkills} hookTrusting={hookTrusting} trustAllHooks={trustAllHooks} refreshSettingsResources={refreshSettingsResources} resourceLoading={resourceLoading} linkedBusy={linkedBusy} setLinkedEnabled={setLinkedEnabled} hookBusy={hookBusy} setHookEnabled={setHookEnabled} setNotice={setNotice} /> },
    /* 10-27 用户令：「返智能体团队按键，跟新建子智能体放一排，靠左」⇒ 不挂壳层的 `back`（那是独立一行），
       改由页面自己渲染进页头操作行。 */
    ssh: { render: () => <SshSettingsSection setSshEditorTest={setSshEditorTest} setSshDraft={setSshDraft} emptySshDraft={emptySshDraft} sshQuery={sshQuery} setSshQuery={setSshQuery} sshFilter={sshFilter} setSshFilter={setSshFilter} sshServers={sshServers} exportSshEntries={exportSshEntries} sshBatchBusy={sshBatchBusy} importSshEntries={importSshEntries} sshVisible={sshVisible} sshChecked={sshChecked} setSshChecked={setSshChecked} toggleSshBatch={toggleSshBatch} testSshBatch={testSshBatch} removeSshEntries={removeSshEntries} sshBusyId={sshBusyId} sshTestingId={sshTestingId} sshCheckedSet={sshCheckedSet} sshToggleChecked={sshToggleChecked} toggleSshFavorite={toggleSshFavorite} toggleSshEntry={toggleSshEntry} setSshTerminal={setSshTerminal} testSshEntry={testSshEntry} setSshExecTarget={setSshExecTarget} duplicateSshEntry={duplicateSshEntry} /> },
    agentteam: { render: () => <AgentTeamSettingsSection setSettingsPage={setSettingsPage} /> },
    "boss-groups": { render: () => <BossGroupsSection openAppConfirm={openAppConfirm} onNotice={setNotice} /> },
    browser: { back: { to: "automation", label: "返回自动化" }, render: () => <BrowserSettingsSection browserHome={browserHome} setBrowserHome={setBrowserHome} setBrowserDraft={setBrowserDraft} setNotice={setNotice} toolsStatus={toolsStatus} ToolCard={ToolCard} /> },
    computer: { back: { to: "automation", label: "返回自动化" }, render: () => <ComputerSettingsSection approvalPolicy={approvalPolicy} sandbox={sandbox} changeApproval={changeApproval} changeSandbox={changeSandbox} personality={personality} changePersonality={changePersonality} toolsStatus={toolsStatus} ToolCard={ToolCard} /> },
    rpa: { back: { to: "automation", label: "返回自动化" }, render: () => <RpaSettingsSection rpaRecipes={rpaRecipes} rpaRunning={rpaRunning} thread={thread} setNotice={setNotice} setRpaRunning={setRpaRunning} selectedModel={selectedModel} modelName={modelName} modelId={modelId} sandboxPolicy={sandboxPolicy} sandbox={sandbox} workspace={workspace} openAppConfirm={openAppConfirm} setRpaRecipes={setRpaRecipes} taskList={taskList} setTaskList={setTaskList} /> },
    /* 10-27 用户令：「把上面三个插件放到已安装里面」⇒ 内置三件不再单独占一段，
   作为 builtinSlot 传进插件页，只在「已安装」视图里出现。 */
    agents: { render: () => <AgentsSettingsSection openNewSubAgent={openNewSubAgent} refreshSubAgents={refreshSubAgents} resourceLoading={resourceLoading} subAgents={subAgents} toggleSubAgentEnabled={toggleSubAgentEnabled} openEditSubAgent={openEditSubAgent} deleteSubAgent={deleteSubAgent} subAgentEditorOpen={subAgentEditorOpen} subAgentDraft={subAgentDraft} setSubAgentDraft={setSubAgentDraft} setSubAgentEditorOpen={setSubAgentEditorOpen} saveSubAgent={saveSubAgent} setNotice={setNotice} onBack={() => setSettingsPage("agentteam")} /> },
    teams: { render: () => <TeamsSettingsSection openNewExpertTeam={openNewExpertTeam} resetExpertTeams={resetExpertTeams} refreshExpertTeams={refreshExpertTeams} resourceLoading={resourceLoading} expertTeams={expertTeams} toggleExpertTeamEnabled={toggleExpertTeamEnabled} categoryLabel={categoryLabel} expertTeamMemberRunning={expertTeamMemberRunning} expertTeamMemberDirect={expertTeamMemberDirect} startMemberDirectSession={startMemberDirectSession} teamCwdMap={teamCwdMap} workspace={workspace} chooseTeamCwd={chooseTeamCwd} clearTeamCwd={clearTeamCwd} startTeamSession={startTeamSession} expertTeamRunning={expertTeamRunning} openEditExpertTeam={openEditExpertTeam} deleteExpertTeam={deleteExpertTeam} expertTeamEditorOpen={expertTeamEditorOpen} expertTeamDraft={expertTeamDraft} setExpertTeamDraft={setExpertTeamDraft} setExpertTeamEditorOpen={setExpertTeamEditorOpen}saveExpertTeam={saveExpertTeam} setNotice={setNotice} onBack={() => setSettingsPage("agentteam")} /> },
    "expert-center": { render: () => expertMarketOpen ? <ExpertMarketSection localSkills={localSkills} onBack={() => setExpertMarketOpen(false)} onInstalled={() => void refreshExpertCenterData()} onNotice={(m) => setNotice(m)} /> : <><ExpertCenterSection expertTeams={expertTeams} EXPERT_CATEGORY_DEFS={EXPERT_CATEGORY_DEFS} expertTeamMemberDirect={expertTeamMemberDirect} startMemberDirectSession={startMemberDirectSession} onOpenMarket={() => setExpertMarketOpen(true)} onBack={() => setSettingsPage("agentteam")} /></> },
    /* 10-31 用户令：CLI 智能体入口从「开发工具」挪到「专家/专家团」（它是调度对象，不是开发工具）。 */
    "cli-agents": { render: () => <CliAgentsSettingsSection setNotice={setNotice} onBack={() => setSettingsPage("agentteam")} /> },
  };
}
