/**
 * AppViewSidebarShell —— AppView 的 JSX 第 1 段（09-22 从 AppView.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { Fragment } from "react";
import { hk } from "../../../lib/hk";
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
  CornerDownRight,
  Layers,
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
import { basename } from "../../../lib/basename";
import { copyTextToClipboard } from "../../../lib/clipboard";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";

export function AppViewSidebarShell({ app }: { app: HarnessAppApi }) {
  const {
    accountDraft,
    accountEditing,
    accountMenuOpen,
    accountMenuRef,
    accountMenuSub,
    accountNameRef,
    collapsedSections,
    customModel,
    deleteThreadsByCwd,
    expandedProjects,
    handleLogout,
    listThreads,
    loadPairStates,
    loading,
    mobileNav,
    narrow,
    openFeedbackPage,
    pinnedThreads,
    popoutThreadId,
    projectFilter,
    projectGroups,
    projectMenu,
    refreshThreads,
    renderClusterList,
    runUpdateCheck,
    runUpdateDownload,
    saveAccountName,
    setAccountDraft,
    setAccountEditing,
    setAccountMenuOpen,
    setAccountMenuSub,
    setMobileNav,
    setMobileRemoteOpen,
    setPaletteOpen,
    setPaletteQuery,
    setPaletteTab,
    setProjectFilter,
    setProjectMenu,
    setRemoteDevices,
    setRemoteQr,
    setRemoteStatus,
    setRemoteUrl,
    setSettingsOpen,
    setSettingsPage,
    setSidebarCollapsed,
    setSidebarFlyout,
    setTheme,
    setUiLang,
    setUiZoom,
    setViewTab,
    showToast,
    buildStamp,
    bundleFile,
    sidebarAllCollapsed,
    sourcedThreads,
    sourcedChildrenOf,
    sourcedChildIds,
    expandedDispatchBlocks,
    toggleDispatchBlock,
    clusterSplit,
    renderClusterRow,
    expandedTeamClusters,
    renderThreadRow,
    sidebarCollapsed,
    sidebarFlyout,
    startNewThread,
    theme,
    threads,
    toggleAllSidebarSections,
    toggleProjectExpanded,
    toggleSection,
    uiLang,
    uiZoom,
    updateChecking,
    updateCurrentVersion,
    updateDownloading,
    updateError,
    updateInfo,
    updateProgress,
    userAvatar,
    username,
    viewTab,
  } = app;

  /** 复制「我正在跑的是哪一份构建」的诊断信息（09-23）。
   *  目的很具体：用户报「改了没生效」时，第一件要排除的就是**跑的产物不是最新构建**（09-23 真实事故，
   *  当时只能靠"请你重启一次"来猜）。把版本/构建/产物/引擎信息一次复制出来，双方都能对账。
   *  引擎信息取不到就退化（best-effort，不阻塞复制）。 */
  const copyBuildDiagnostics = async () => {
    let engine: string = "（未取到）";
    try {
      const info = await window.codex.engineInfo();
      engine = JSON.stringify(info);
      if (engine.length > 500) engine = engine.slice(0, 500) + "…";
    } catch { /* 引擎没起来时取不到属正常 */ }
    const text = [
      `应用版本：v${updateCurrentVersion || "—"}`,
      `构建指纹：${buildStamp}`,
      `渲染层产物：${bundleFile}`,
      `引擎信息：${engine}`,
      `平台：${navigator.platform} · UA：${navigator.userAgent}`,
    ].join("\n");
    await copyTextToClipboard(text);
    showToast("已复制诊断信息", "含构建指纹与产物名，可直接粘贴到反馈里");
  };

  /* 调度归属的统一渲染（09-25 用户：「项目里面也这样展示可以嘛」）：
     顶层会话渲染后，紧跟它**调度出去的会话**（缩进 + ↳ 标签），与「分类」视图完全一致。
     ⛔ 两个视图**共用这一份实现** —— 免得日后再分叉成「分类有、项目没有」。
     ⛔ 调用方必须先用 sourcedChildIds 把子会话从**顶层**剔除，否则同一会话会显示两遍。
     ⛔⛔ **必须先对整批做 expert 聚簇，再逐个挂子会话**（09-25 用户实测「专家团成员都在外面当成
        主代理重复展示」）：早先写成 `entries.map(e => renderClusterList([e]))` ⇒ 每个**成员会话**
        各自把本团那一簇再渲染一遍（成员都在 memberIds 里 ⇒ singles 为空、clusters 命中本团），
        于是 1 个团 4 个成员 = 4 行重复的主会话行。整批切分一次才对。
     ⛔ 默认**收起**（用户：「默认被调度和专家团会话都折叠状态」）：只显示「↳ 调度会话 · N」头，点开才展开。 */
  const renderDispatchedList = (entries: typeof listThreads) => {
    const { clusters, singles } = clusterSplit(entries);
    const childrenAfter = (threadId: string) => {
      const children = threadId ? (sourcedChildrenOf[threadId] ?? []) : [];
      if (!children.length) return null;
      const dispatchKey = `dispatch:${threadId}`;
      const collapsed = !expandedDispatchBlocks.has(dispatchKey);
      return (
        <div className={`dispatch-children ${collapsed ? "collapsed" : "expanded"}`}>
          <button type="button" className="dispatch-children-label" title={collapsed ? `展开 ${children.length} 个被调度会话` : "收起被调度会话"} onClick={() => toggleDispatchBlock(dispatchKey)}>
            <ChevronDown size={11} className={`conv-section-chevron ${collapsed ? "" : "open"}`} />
            <CornerDownRight size={11} />调度会话 · {children.length}
          </button>
          {!collapsed && children.map((child) => {
            const childThread = listThreads.find((t) => t.id === child.threadId);
            // ⛔ 子会话用聚类渲染：它本身可能就是某个**专家团的主会话**（成员已被顶层剔除，
            //    走 renderThreadRow 会把那一批成员会话整块漏掉）。
            return childThread ? <div className="dispatch-child" key={child.threadId}>{renderClusterList([childThread])}</div> : null;
          })}
        </div>
      );
    };
    return (
      <>
        {clusters.map((cluster) => {
          /* ⛔⛔ **簇里的成员也要挂子会话**（09-25 代码审查抓到「会话消失」）：
             `sourcedChildIds` 会把**所有**被调度会话从顶层剔除，而成员会话自己也可能调度出东西
             （成员 → 子智能体）。成员只渲染在簇体内、不在顶层 ⇒ 只对 lead 调 childrenAfter 的话，
             这些孙会话**一处都不渲染 = 从侧栏彻底消失**（已在纯模块取证：childrenOf 的键是成员 id）。
             成员只在簇**展开**时可见 ⇒ 它们的子块同样只在展开时渲染（收起时一并收起，符合直觉）。 */
          const clusterOpen = expandedTeamClusters.has(cluster.teamId);
          const memberChildren = clusterOpen ? cluster.members.filter((member) => (sourcedChildrenOf[member.id] ?? []).length > 0) : [];
          return (
            <div className="dispatch-parent" key={`cluster-${cluster.teamId}`}>
              {renderClusterRow(cluster)}
              {childrenAfter(cluster.lead?.id ?? "")}
              {memberChildren.map((member) => (
                <Fragment key={`member-children-${member.id}`}>{childrenAfter(member.id)}</Fragment>
              ))}
            </div>
          );
        })}
        {singles.map((entry) => (
          <div className="dispatch-parent" key={entry.id}>
            {renderThreadRow(entry)}
            {childrenAfter(entry.id)}
          </div>
        ))}
      </>
    );
  };

  return (
    !popoutThreadId && <aside className={`sidebar ${mobileNav ? "mobile-open" : ""} ${sidebarFlyout ? "flyout-open" : ""}`} onMouseEnter={() => sidebarCollapsed && setSidebarFlyout(true)} onMouseLeave={() => sidebarCollapsed && setSidebarFlyout(false)}>        <div className="brand-row">
              <button className={`brand-mark sidebar-toggle ${sidebarCollapsed ? "is-collapsed" : "is-expanded"}`} aria-label={narrow ? "Codex Harness" : sidebarCollapsed ? "展开侧栏" : "收起侧栏"} title={narrow ? "Codex Harness" : sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={() => { if (narrow) return; const next = !sidebarCollapsed; setSidebarCollapsed(next); localStorage.setItem("sidebar-collapsed", String(next)); }}>
                <img className="ch-logo ch-logo-img" src={`${import.meta.env.BASE_URL}icon.png`} alt="" aria-hidden="true" />
                <span className="sidebar-toggle-arrow"><ArrowLeft size={13} strokeWidth={2.4} /></span>
              </button>
              {!sidebarCollapsed && <div><strong>Codex Harness</strong><span>Desktop</span></div>}
            </div>
            <div className="sidebar-tabs" role="tablist" aria-label="导航">
              <button className="sidebar-tab" onClick={() => { startNewThread(); }}><MessageSquarePlus size={15} /><span>新建任务</span><kbd>{hk("Ctrl+N")}</kbd></button>
              {/* ⛔ 09-19 用户要求：「在左侧侧边栏加一个模型配置菜单跳转到模型配置入口的选项」
                  （配套：输入框里那个提示条已删）。未配模型时给一个醒目点，新手一眼能看到入口。 */}
              <button className={`sidebar-tab ${!customModel ? "needs-setup" : ""}`} title="模型配置（供应商 / API Key / 中转站）" onClick={() => { setSettingsPage("model"); setSettingsOpen(true); setMobileNav(false); }}>
                <Bot size={15} /><span>模型配置</span>{!customModel && <i className="sidebar-tab-dot" aria-label="尚未配置" />}
              </button>
              <button className="sidebar-tab" onClick={() => { setSettingsPage("schedule"); setSettingsOpen(true); setMobileNav(false); }}><Clock3 size={15} /><span>自动化</span></button>
              <button className="sidebar-tab" onClick={() => { setSettingsPage("skills"); setSettingsOpen(true); setMobileNav(false); }}><Zap size={15} /><span>技能中心</span></button>
              <button className="sidebar-tab" onClick={() => { setSettingsPage("plugins"); setSettingsOpen(true); setMobileNav(false); }}><Store size={15} /><span>插件市场</span></button>
              <button className="sidebar-tab" onClick={() => { setSettingsPage("agentteam"); setSettingsOpen(true); setMobileNav(false); }}><Users size={15} /><span>专家/专家团</span></button>
              <button className="sidebar-tab" onClick={() => { setSettingsPage("backup"); setSettingsOpen(true); setMobileNav(false); }}><Download size={15} /><span>会话备份</span></button>
            </div>
            <button className="search-box" title={`搜索任务与操作（${hk("Ctrl+K")}）`} onClick={() => { setPaletteOpen(true); setPaletteQuery(""); setPaletteTab("all"); }}><Search size={15} /><span>搜索任务</span><kbd>{hk("Ctrl+K")}</kbd></button>
            {projectFilter && <button className="filter-chip" title="清除项目筛选" onClick={() => setProjectFilter(null)}><FolderOpen size={12} />{basename(projectFilter)}<X size={12} /></button>}
            <div className="view-tabs" role="tablist" aria-label="视图">
              {/* ⛔ 「分组」（按时间）视图已于 09-25 按用户要求删除（原话：「分组可以删了」）。
                  历史偏好值在 part03 里统一回落到「项目」。 */}
              <button className={`view-tab ${viewTab === "projects" ? "active" : ""}`} onClick={() => setViewTab("projects")} title="按项目分组"><FolderOpen size={14} /><span>项目</span></button>
              {/* 分类视图（09-25 用户要求）：按**会话来源**归类 —— 主代理 / 专家团主理人 /
                  团队成员子任务 / 专家调度 / 子智能体调度 / 专家团调度（口径见 lib/thread-source.mjs） */}
              <button className={`view-tab ${viewTab === "source" ? "active" : ""}`} onClick={() => setViewTab("source")} title="按会话来源分类"><Layers size={14} /><span>分类</span></button>
              <div className="view-toolbar">
                <button className="view-toolbar-btn" title="刷新会话列表" onClick={() => { void refreshThreads().then(() => showToast("会话列表已刷新", "已重新读取全部会话")); }}><ListRestart size={14} /></button>
                <button className="view-toolbar-btn" title={sidebarAllCollapsed ? "全部展开" : "全部折叠"} onClick={toggleAllSidebarSections} disabled={viewTab === "source" ? !sourcedThreads.length : !projectGroups.length}>{sidebarAllCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}</button>
              </div>
            </div>
            <div className="thread-list">
              {loading ? Array.from({ length: 5 }).map((_, index) => <div className="thread-skeleton shimmer" key={index} />) : viewTab === "projects" ? (
                <div className="project-list">
                  {projectGroups.length ? projectGroups.map(([cwd, items]) => {
                    const expanded = expandedProjects.has(cwd);
                    return (
                      <div key={cwd} className={`project-item ${expanded ? "expanded" : "collapsed"} ${projectMenu === cwd ? "menu-open" : ""}`}>
                        <div className="project-item-head" onMouseLeave={() => setProjectMenu((current) => current === cwd ? null : current)}>
                          <button className="project-item-toggle" title={expanded ? "折叠项目" : "展开项目"} onClick={() => toggleProjectExpanded(cwd)}>
                            <ChevronDown size={12} className={`project-item-chevron ${expanded ? "open" : ""}`} />
                            <FolderOpen size={13} />
                            <strong>{basename(cwd)}</strong>
                            <em>{items.length}</em>
                          </button>
                          <button className="project-item-menu-btn" title="项目操作" aria-expanded={projectMenu === cwd} onClick={(event) => { event.stopPropagation(); setProjectMenu(projectMenu === cwd ? null : cwd); }}><MoreHorizontal size={14} /></button>
                          {projectMenu === cwd && <div className="project-menu">
                            <button onClick={() => { setProjectMenu(null); setProjectFilter(cwd); setMobileNav(false); }}><FolderOpen size={14} />只看该项目</button>
                            <button className="danger" onClick={() => { setProjectMenu(null); void deleteThreadsByCwd(cwd); }}><Trash2 size={14} />移除（删除全部对话）</button>
                          </div>}
                        </div>
                        {expanded && <div className="project-item-body">{renderDispatchedList(
                          [...items]
                            // 子会话从顶层剔除（它们缩进挂在发起调度的会话下面，见 renderDispatchedList）
                            .filter((entry) => !sourcedChildIds.has(entry.id))
                            .sort((a, b) => Number(pinnedThreads.includes(b.id)) - Number(pinnedThreads.includes(a.id)) || b.updatedAt - a.updatedAt),
                        )}</div>}
                      </div>
                    );
                  }) : <div className="empty-list">暂无项目</div>}
                </div>
              ) : (
                sourcedThreads.length ? <>{sourcedThreads.map((g) => (
                  <section className="conv-section" key={g.key}>
                    <button className="conv-section-label" title="折叠/展开分类" onClick={() => toggleSection(g.key)}>
                      <ChevronDown size={12} className={`conv-section-chevron ${collapsedSections.has(g.key) ? "" : "open"}`} />
                      <span>{g.label}</span><em>{g.items.length}</em>
                    </button>
                    {!collapsedSections.has(g.key) && <div className="conv-section-body">
                      {/* 顶层会话渲染后紧跟它**调度出去的会话**（缩进）—— 与项目视图共用同一实现。 */}
                      {renderDispatchedList(g.items)}
                    </div>}
                  </section>
                ))}</> : <div className="empty-list">{threads.length ? "当前筛选下暂无任务" : "暂无任务"}</div>
              )}
            </div>
            <div className="account-row">
              <button className="account-avatar" title="账户菜单" onClick={() => { setAccountMenuSub(null); setAccountMenuOpen(!accountMenuOpen); }}>{userAvatar?.type === "image" && userAvatar.value ? <img src={userAvatar.value} alt="头像" /> : userAvatar?.type === "emoji" && userAvatar.value ? <span className="account-avatar-emoji">{userAvatar.value}</span> : <span className="account-avatar-letter">{username.trim().charAt(0).toUpperCase() || "?"}</span>}</button>
              {accountEditing ? (
                <input ref={accountNameRef} className="account-name-input" aria-label="修改名称" maxLength={24} autoFocus onFocus={(event) => event.currentTarget.select()} value={accountDraft} onChange={(event) => setAccountDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveAccountName(); } if (event.key === "Escape") { event.preventDefault(); setAccountEditing(false); } }} onBlur={saveAccountName} />
              ) : (
                <button className="account-name" title="账户菜单" onClick={() => { setAccountMenuSub(null); setAccountMenuOpen(!accountMenuOpen); }}>{username}</button>
              )}
              {accountMenuOpen && (
                <div className="account-menu" role="menu" ref={accountMenuRef}>
                  {accountMenuSub === null && <>
                    <button className="account-menu-item" onClick={() => setAccountMenuSub("lang")}><Globe2 size={15} /><span>界面语言</span><ChevronRight size={14} className="account-menu-arrow" /></button>
                    <div className="account-menu-item account-menu-theme" role="menuitem">
                      <Sun size={15} /><span>界面主题</span>
                      <span className="theme-quick">
                        <button type="button" title="浅色" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={13} /></button>
                        <button type="button" title="深色" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={13} /></button>
                      </span>
                    </div>
                    <button className="account-menu-item" onClick={() => setAccountMenuSub("zoom")}><ZoomIn size={15} /><span>界面缩放</span><ChevronRight size={14} className="account-menu-arrow" /></button>
                    <button className="account-menu-item" onClick={() => setAccountMenuSub("update")}>
                      <RefreshCw size={15} />
                      <span>检查更新</span>
                      {updateInfo?.hasUpdate ? <span className="account-menu-dot" title={`v${updateInfo.version} 可用`} /> : null}
                      <ChevronRight size={14} className="account-menu-arrow" />
                    </button>
                    <div className="account-menu-sep" />
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setSettingsPage("usage"); setSettingsOpen(true); }}><CircleGauge size={15} /><span>使用统计</span></button>
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setSettingsPage("user"); setSettingsOpen(true); setMobileNav(false); }}><UserRound size={15} /><span>用户中心</span></button>
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); void window.codex.openExternal("https://www.jvszzp.ltd/feedback.html"); }}><MessageSquarePlus size={15} /><span>问题反馈</span><ExternalLink size={12} className="account-menu-arrow" /></button>
                    <div className="account-menu-sep" />
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); handleLogout(); }}><LogOut size={15} /><span>退出登录</span></button>
                  </>}
                  {accountMenuSub === "lang" && <>
                    <button className="account-menu-item account-menu-back" onClick={() => setAccountMenuSub(null)}><ChevronLeft size={14} /><span>界面语言</span></button>
                    <button className={`account-menu-item ${uiLang === "zh" ? "current" : ""}`} onClick={() => { setUiLang("zh"); setAccountMenuSub(null); }}><span>简体中文</span>{uiLang === "zh" && <Check size={14} />}</button>
                    <button className={`account-menu-item ${uiLang === "en" ? "current" : ""}`} onClick={() => { setUiLang("en"); setAccountMenuSub(null); showToast("英文界面即将上线", "当前版本先提供简体中文"); }}><span>English</span>{uiLang === "en" && <Check size={14} />}</button>
                  </>}
                  {accountMenuSub === "zoom" && <>
                    <button className="account-menu-item account-menu-back" onClick={() => setAccountMenuSub(null)}><ChevronLeft size={14} /><span>界面缩放</span></button>
                    {[0.8, 0.9, 1, 1.1, 1.25].map((factor) => (
                      <button key={factor} className={`account-menu-item ${uiZoom === factor ? "current" : ""}`} onClick={() => { setUiZoom(factor); setAccountMenuSub(null); }}>
                        <span>{Math.round(factor * 100)}%</span>{uiZoom === factor && <Check size={14} />}
                      </button>
                    ))}
                  </>}
                  {accountMenuSub === "update" && <>
                    <button className="account-menu-item account-menu-back" onClick={() => setAccountMenuSub(null)}><ChevronLeft size={14} /><span>检查更新</span></button>
                    <div className="account-menu-section">
                      <div className="account-menu-row"><span className="account-menu-label">当前版本</span><span className="account-menu-value mono">v{updateCurrentVersion || "—"}</span></div>
                      {/* 构建指纹（09-23）：回答「你正在跑的是哪一份产物」——原来只显示版本号，
                          改了源码没重启时用户与我都无法自证（09-23 真实事故）。两个值分别是构建期
                          注入的指纹与自身 URL 里的产物名，显示的就是正在执行的那份，不是磁盘现状。 */}
                      <div className="account-menu-row"><span className="account-menu-label">构建</span><span className="account-menu-value mono" title="构建期写进包体的指纹（YYYYMMDD-HHmm）">{buildStamp}</span></div>
                      <div className="account-menu-row"><span className="account-menu-label">产物</span><span className="account-menu-value mono" title="正在执行的渲染层 bundle（含内容 hash）">{bundleFile}</span></div>
                      <div className="account-menu-row"><span className="account-menu-label">更新地址</span><span className="account-menu-value">GitHub Releases</span></div>
                    </div>
                    <button className="account-menu-item" onClick={() => void copyBuildDiagnostics()}>
                      <ClipboardList size={15} /><span>复制诊断信息</span>
                    </button>
                    <button className="account-menu-item" onClick={() => void runUpdateCheck()} disabled={updateChecking}>
                      <RefreshCw size={15} className={updateChecking ? "spin" : ""} />
                      <span>{updateChecking ? "检查中…" : "检查更新"}</span>
                    </button>
                    {updateError ? <div className="account-menu-error">{updateError}</div> : null}
                    {updateInfo && !updateInfo.hasUpdate ? (
                      <div className="account-menu-success">
                        <CircleCheck size={14} /><span>已是最新版本</span>
                      </div>
                    ) : null}
                    {updateInfo?.hasUpdate ? <>
                      <div className="account-menu-sep" />
                      <div className="account-menu-section">
                        <div className="account-menu-row"><span className="account-menu-label">新版本</span><span className="account-menu-value mono">v{updateInfo.version}</span></div>
                        {updateInfo.size ? <div className="account-menu-row"><span className="account-menu-label">大小</span><span className="account-menu-value">{((updateInfo.size / 1024 / 1024) || 0).toFixed(1)} MB</span></div> : null}
                      </div>
                      {updateInfo.changelog ? <div className="account-menu-changelog">{updateInfo.changelog}</div> : null}
                      <button className="account-menu-item primary" onClick={() => void runUpdateDownload()} disabled={updateDownloading}>
                        <Download size={15} className={updateDownloading ? "pulse" : ""} />
                        <span>{updateDownloading ? (updateProgress > 0 ? `下载中 ${Math.round(updateProgress * 100)}%` : "下载中…") : "立即更新"}</span>
                      </button>
                    </> : null}
                    <div className="account-menu-sep" />
                    <button className="account-menu-item" title="打开发布中心反馈页（自动携带版本与系统信息）" onClick={openFeedbackPage}><MessageSquare size={15} /><span>遇到问题？去反馈</span><ExternalLink size={13} className="account-menu-arrow" /></button>
                  </>}
                </div>
              )}
              <button className="account-icon" title="移动端远程控制" onClick={() => { setMobileRemoteOpen(true); void window.codex.remoteStart().then((r) => setRemoteUrl(r.url)).catch(() => undefined); void window.codex.remoteStatus().then((s) => { setRemoteStatus(s.status); setRemoteDevices(s.devices); setRemoteUrl(s.url); }).catch(() => undefined); void window.codex.remoteQrcode().then((svg) => setRemoteQr(svg)).catch(() => undefined); void loadPairStates(); }}><Smartphone size={15} /></button>
              <button className="sidebar-settings" title="设置" onClick={() => { setSettingsPage("appearance"); setSettingsOpen(true); setMobileNav(false); }}><Settings2 size={16} /></button>
            </div>
          </aside>
  );
}
