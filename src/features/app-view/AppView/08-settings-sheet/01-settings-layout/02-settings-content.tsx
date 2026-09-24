/**
 * SettingsLayoutSettingsContent —— SettingsSheetSettingsLayout 的 JSX 第 2 段（09-22 从 01-settings-layout.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { createPortal } from "react-dom";
import { lazy, Suspense } from "react";
import { settingsPagesOf } from "./00-settings-registry";
// ssh 门户（createPortal 到 body）仍在本文件渲染 ⇒ 这两个 lazy 声明留在 content，不随设置页分节搬走
const SshTerminalModal = lazy(() => import("../../../../ssh").then((m) => ({ default: m.SshTerminalModal })));
const SshExecModal = lazy(() => import("../../../../ssh").then((m) => ({ default: m.SshExecModal })));
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Brain,
  QrCode,
  Star,
  Check,
  ChevronDown,
  CircleGauge,
  Clock3,
  CircleStop,
  Cloud,
  CloudOff,
  Code2,
  Copy,
  Eye,
  EyeOff,
  Edit3,
  FileCode2,
  FileText,
  FileWarning,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ImagePlus,
  Image,
  GitBranch,
  Globe2,
  GripVertical,
  Hash,
  Info,
  KeyRound,
  LayoutGrid,
  Layers3,
  Link2,
  ListFilter,
  Maximize2,
  Megaphone,
  Menu,
  BarChart3,
  PenTool,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Quote,
  Paperclip,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Play,
  PowerOff,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Download,
  Upload,
  Search,
  Send,
  Settings2,
  Shield,
  Smartphone,
  ShieldCheck,
  Sparkles,
  Store,
  TerminalSquare,
  Target,
  Trash2,
  Type,
  Sun,
  User,
  Wrench,
  Wifi,
  X,
  ChevronUp,
  FileUp,
  Minimize2,
  Zap,
  MonitorUp,
  BookOpen,
  BookmarkPlus,
  Home,
  Lock,
  CircleCheck,
  CircleX,
  ZoomIn,
  ZoomOut,
  ListRestart,
  Keyboard,
  Server,
  WifiOff,
  UserRound,
  Rocket,
  BookMarked,
  Users,
  ListChecks,
  LoaderCircle,
  GitPullRequest,
  ShieldAlert,
  RotateCcw,
  Briefcase,
  Tag,
  Workflow,
  LogOut,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Pin,
  Wallet,
  LogIn,
  Database,
  Headphones,
  Mic,
  Pause,
  FileQuestion,
  ClipboardList,
  DraftingCompass,
  FlaskConical,
  Crown,
  TrendingUp,
  Microscope,
  Calculator,
  Telescope,
  CircleHelp,
  Video,
  Bell,
  CheckCheck,
} from "lucide-react";
import { Spinner } from "../../../../../components/CardShell";
import { HarnessAppApi } from "../../../../app-state/useHarnessApp";

/* ⛔ 懒加载（09-22）：以下组件全部只在 settingsPage === "…" 分支渲染（02-settings-content 内），
   且除本文件外无任何静态引用（已全量核查）⇒ 每页一个 chunk、首次进该页才加载。
   fallback 复用 settings-boot 骨架；ssh 门户（portal）留在 Suspense 包外。 */

export function SettingsLayoutSettingsContent({ app }: { app: HarnessAppApi }) {
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
  } = app;
  return (
    <div className="settings-content">
                        {/* 骨架先行：弹窗框架先绘制一帧，分区内容延后挂载（详见 settingsContentReady 注释） */}
                        {!settingsContentReady ? <div className="settings-boot" role="status"><Spinner /><span>正在载入…</span></div> : <>
                        {resourceError && <div className="resource-error"><AlertTriangle size={14} /><span>{resourceError}</span><button className="secondary-setting" onClick={() => void refreshSettingsResources()}>重试</button></div>}
                        <Suspense fallback={<div className="settings-boot" role="status"><Spinner /><span>正在载入…</span></div>}>
                        {/* 二级入口页：自动化（浏览器/桌面/RPA）与智能体团队（子智能体/专家团）。
                            点卡片进入真实页面；进入的是二级成员页时顶部提供「返回」。 */}
                        {(() => {
                          const page = settingsPagesOf(app)[settingsPage];
                          if (!page) return null;
                          const back = page.back;
                          return <>{back && <button className="settings-back-row" onClick={() => setSettingsPage(back.to)}><ArrowLeft size={14} />{back.label}</button>}{page.render()}</>;
                        })()}
                        {sshDraft && createPortal(
                          <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSshDraft(null); }}>
                            <section className="connector-setup-modal ssh-editor-modal" role="dialog" aria-modal="true" aria-label={sshDraft.id ? "编辑 SSH 连接" : "新建 SSH 连接"}>
                              <header>
                                <div className="connector-setup-title">
                                  <span><Server size={17} /></span>
                                  <div><strong>{sshDraft.id ? `编辑「${sshDraft.name}」` : "新建 SSH 连接"}</strong><p>填好基本信息与认证方式即可保存；左下角「测试连接」可以在保存前先验证是否连得上。</p></div>
                                </div>
                                <button className="icon-button relay-modal-close" title="关闭" onClick={() => setSshDraft(null)}><X size={16} /></button>
                              </header>
                              <div className="connector-form ssh-form">
                                <div className="ssh-form-section">
                                  <h4>基本信息</h4>
                                  <div className="settings-grid two">
                                    <label><span>连接名称 <em>必填</em></span><input autoFocus value={sshDraft.name} onChange={(event) => setSshDraft({ ...sshDraft, name: event.target.value })} placeholder="例如：公司测试机 / GPU 服务器" /></label>
                                    <label><span>分组 <small>可选，用于归类</small></span><input value={sshDraft.group ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, group: event.target.value })} placeholder="例如：生产 / 测试 / 客户 A" /></label>
                                  </div>
                                  <div className="settings-grid three">
                                    <label><span>主机地址 <em>必填</em></span><input value={sshDraft.host} onChange={(event) => setSshDraft({ ...sshDraft, host: event.target.value })} placeholder="192.168.1.100 或 ssh.example.com" /></label>
                                    <label><span>端口</span><input type="number" min={1} max={65535} value={sshDraft.port} onChange={(event) => setSshDraft({ ...sshDraft, port: Number(event.target.value) || 22 })} /></label>
                                    <label><span>用户名 <em>必填</em></span><input value={sshDraft.username} onChange={(event) => setSshDraft({ ...sshDraft, username: event.target.value })} placeholder="root / ubuntu" /></label>
                                  </div>
                                </div>
            
                                <div className="ssh-form-section">
                                  <h4>认证方式</h4>
                                  <div className="ssh-auth-switch">
                                    <button className={`ssh-auth-option ${sshDraft.authType === "password" ? "on" : ""}`} onClick={() => setSshDraft({ ...sshDraft, authType: "password" })}><KeyRound size={13} />密码认证</button>
                                    <button className={`ssh-auth-option ${sshDraft.authType === "key" ? "on" : ""}`} onClick={() => setSshDraft({ ...sshDraft, authType: "key" })}><KeyRound size={13} />私钥认证</button>
                                  </div>
                                  {sshDraft.authType === "password"
                                    ? <label><span>登录密码</span><input type="password" value={sshDraft.password ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, password: event.target.value })} placeholder="登录密码" /></label>
                                    : <>
                                        <label><span>私钥内容 <small>粘贴 OpenSSH / PEM 私钥，与下方路径二选一</small></span><textarea rows={4} value={sshDraft.privateKey ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, privateKey: event.target.value })} placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."} /></label>
                                        <div className="ssh-key-row">
                                          <label className="ssh-key-path"><span>私钥文件路径 <small>例如 C:\Users\you\.ssh\id_ed25519</small></span><input value={sshDraft.keyPath ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, keyPath: event.target.value })} placeholder="留空则仅使用上方私钥内容" /></label>
                                          <button className="secondary-setting ssh-key-browse" title="从磁盘选择私钥文件" onClick={() => void window.codex.chooseSshKey(sshDraft.keyPath || undefined).then((file: string | null) => { if (file) setSshDraft((current) => (current ? { ...current, keyPath: file } : current)); })}><FolderOpen size={14} />浏览…</button>
                                        </div>
                                        <label><span>私钥口令 <small>私钥设置了 passphrase 时填写</small></span><input type="password" value={sshDraft.passphrase ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, passphrase: event.target.value })} placeholder="可选" /></label>
                                      </>}
                                </div>
            
                                <div className="ssh-form-section">
                                  <h4>会话与网络</h4>
                                  <div className="settings-grid three">
                                    <label><span>初始工作目录 <small>连接后自动 cd</small></span><input value={sshDraft.remotePath ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, remotePath: event.target.value })} placeholder="/root 或 /home/ubuntu/project" /></label>
                                    <label><span>连接超时（秒）</span><input type="number" min={1} max={120} value={sshDraft.connectTimeout ?? 10} onChange={(event) => setSshDraft({ ...sshDraft, connectTimeout: Number(event.target.value) || 10 })} /></label>
                                    <label><span>心跳间隔（秒） <small>0 = 关闭</small></span><input type="number" min={0} max={600} value={sshDraft.keepaliveInterval ?? 30} onChange={(event) => setSshDraft({ ...sshDraft, keepaliveInterval: Number(event.target.value) || 0 })} /></label>
                                  </div>
                                  <div className="settings-grid two">
                                    <label><span>登录后自动执行 <small>开终端时自动运行</small></span><input value={sshDraft.startupCommand ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, startupCommand: event.target.value })} placeholder="例如：tmux a 或 export PATH=$PATH:/opt/bin" /></label>
                                    <label><span>终端类型</span><input value={sshDraft.termType ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, termType: event.target.value })} placeholder="xterm-256color" /></label>
                                  </div>
                                </div>
            
                                <div className="ssh-form-section">
                                  <h4>跳板机（ProxyJump）</h4>
                                  <label className="ssh-inline-check">
                                    <input type="checkbox" checked={Boolean(sshDraft.jumpHost?.host)} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: event.target.checked ? (sshDraft.jumpHost ?? emptySshJump()) : { ...emptySshJump(), host: "" } })} />
                                    <span>通过跳板机中继连接目标主机</span>
                                  </label>
                                  {Boolean(sshDraft.jumpHost?.host) && <>
                                    <div className="settings-grid three">
                                      <label><span>跳板机地址</span><input value={sshDraft.jumpHost?.host ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), host: event.target.value } })} placeholder="bastion.example.com" /></label>
                                      <label><span>端口</span><input type="number" min={1} max={65535} value={sshDraft.jumpHost?.port ?? 22} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), port: Number(event.target.value) || 22 } })} /></label>
                                      <label><span>用户名</span><input value={sshDraft.jumpHost?.username ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), username: event.target.value } })} placeholder="跳板机登录用户" /></label>
                                    </div>
                                    <div className="settings-grid two">
                                      <label><span>跳板机认证</span>
                                        <select value={sshDraft.jumpHost?.authType ?? "password"} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), authType: event.target.value as "password" | "key" } })}>
                                          <option value="password">密码认证</option>
                                          <option value="key">私钥认证</option>
                                        </select>
                                      </label>
                                      {(sshDraft.jumpHost?.authType ?? "password") === "password"
                                        ? <label><span>跳板机密码</span><input type="password" value={sshDraft.jumpHost?.password ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), password: event.target.value } })} placeholder="跳板机登录密码" /></label>
                                        : <div className="ssh-key-row">
                                            <label className="ssh-key-path"><span>跳板机私钥路径</span><input value={sshDraft.jumpHost?.keyPath ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, jumpHost: { ...(sshDraft.jumpHost ?? emptySshJump()), keyPath: event.target.value } })} placeholder="本地私钥文件路径" /></label>
                                            <button className="secondary-setting ssh-key-browse" onClick={() => void window.codex.chooseSshKey(sshDraft.jumpHost?.keyPath || undefined).then((file: string | null) => { if (file) setSshDraft((current) => current ? { ...current, jumpHost: { ...(current.jumpHost ?? emptySshJump()), keyPath: file } } : current); })}><FolderOpen size={14} />浏览…</button>
                                          </div>}
                                    </div>
                                  </>}
                                </div>
            
                                <div className="ssh-form-section">
                                  <h4>标签与备注</h4>
                                  <div className="settings-grid two">
                                    <label><span>标签 <small>英文逗号分隔</small></span><input value={(sshDraft.tags ?? []).join(", ")} onChange={(event) => setSshDraft({ ...sshDraft, tags: event.target.value.split(",").map((tag) => tag.trim()) })} placeholder="gpu, 内网, 客户A" /></label>
                                    <label className="ssh-inline-check ssh-inline-check-top">
                                      <input type="checkbox" checked={sshDraft.enabled} onChange={(event) => setSshDraft({ ...sshDraft, enabled: event.target.checked })} />
                                      <span>保存后立即启用这台服务器</span>
                                    </label>
                                  </div>
                                  <label><span>备注</span><textarea rows={2} value={sshDraft.notes ?? ""} onChange={(event) => setSshDraft({ ...sshDraft, notes: event.target.value })} placeholder="用途、负责人、注意事项…" /></label>
                                </div>
            
                                {sshEditorTest && <div className={`ssh-editor-test ${sshEditorTest.ok ? "ok" : "fail"}`}>
                                  {sshEditorTest.ok ? <CircleCheck size={14} /> : <X size={14} />}
                                  <span>{sshEditorTest.message}</span>
                                </div>}
                                <div className="connector-example"><Info size={14} /><span>凭据明文保存在本机配置目录，不会上传；连接仅由本机发起。停用只是不参与自动连接，配置会完整保留。</span></div>
                              </div>
                              <footer>
                                <button className="secondary-setting" disabled={!sshDraftValid(sshDraft)} onClick={() => void testSshDraft()}>{sshTestingId === "draft" ? <Spinner /> : <Wifi size={14} />}测试连接</button>
                                <span className="ssh-footer-spacer" />
                                <button className="secondary-setting" onClick={() => setSshDraft(null)}>取消</button>
                                <button className="primary-setting" disabled={!sshDraftValid(sshDraft) || sshSaving} onClick={() => void saveSshEntry()}>{sshSaving ? <Spinner /> : <CircleCheck size={15} />}保存</button>
                              </footer>
                            </section>
                          </div>,
                          document.body,
                        )}
                        </Suspense>
                        {sshTerminal && createPortal(<SshTerminalModal server={sshTerminal} onClose={() => setSshTerminal(null)} />, document.body)}
                        {sshExecTarget && createPortal(<SshExecModal server={sshExecTarget} onClose={() => setSshExecTarget(null)} />, document.body)}
                        </>}
                        </div>
  );
}
