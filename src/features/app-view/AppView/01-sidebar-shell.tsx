/**
 * AppViewSidebarShell —— AppView 的 JSX 第 1 段（09-22 从 AppView.tsx 分出，纯搬迁）。
 * ⛔ 收一个 `app`（类型 HarnessAppApi = hook 的返回类型）并按需解构 ⇒ 类型不落快照。
 */
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BossProjectDirDialog, autoOpenBossDirDialog, bossShortcutLabel, closeBossDirDialog, getBossDirDialogState, getBossThreads, setBossDirChosen, setBossHomeThreadId, setBossPending, subscribeBossDirDialog, subscribeBossThreads } from "../../boss-group-view";
import { FunctionMenu, FunctionMenuEditorHost, FunctionMenuTourHost, maybeShowFunctionMenuTour, setFunctionMenuActionHandler, useFunctionMenuConfig } from "../../function-menu";
import { hk } from "../../../lib/hk";
import { isMacPlatform } from "../../../lib/is-mac-platform";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
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
  Heart,
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
  Settings,
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
  MessageCirclePlus,
  Video,
  Bell,
  CheckCheck,
} from "lucide-react";
import { basename } from "../../../lib/basename";
import { copyTextToClipboard } from "../../../lib/clipboard";
import { runVisualSwitch, themeLabelOf } from "../../../lib/visual-switch";
import { refreshWithReceipt } from "../../../lib/refresh-receipt.mjs";
import { UpdateProgressBar } from "../../../components/UpdateProgressBar";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";
// 10-04 阶段 5 渲染层插槽：插件往界面挂内容的唯一入口（未注册时渲染 null ⇒ DOM 不变）。
import { Slot } from "../../../runtime/registry";
import { NewbieGuide } from "../../newbie-guide";
import { SidebarGuideModal, type SidebarGuideKey, type SidebarGuideTarget } from "./SidebarGuideModal";
import { LoginManagerModal, type LoginManagerTarget } from "./LoginManagerModal";
import { NewProjectDialog } from "./NewProjectDialog";
import { UpdateReadyToast } from "./UpdateReadyToast";
import { CloseConfirmDialog } from "../../../components/CloseConfirmDialog";
import { FileTrustDialog } from "../../../components/FileTrustDialog";

export function AppViewSidebarShell({ app, onOpenSettings }: { app: HarnessAppApi; onOpenSettings?: (page: string) => void }) {
  /* ── BOSS 会话 = **一个普通会话**（10-25 用户令，推翻覆盖层）──────────────────
     用户原话：「一个正常对话框不会做嘛，新建一个会话，常驻成 BOSS 会话，不就好了嘛」。
     ⇒ 点按钮就是 `openThread(群.bossThreadId)`：正常时间线、正常输入框、正常消息渲染，
        不再有任何覆盖层/专属界面。
     ⇒ 「选中效果」是**派生量**（当前会话 id 命中某个群的 boss 线程），⛔ 不再用 store 的
        stage 布尔值 —— 那个布尔值和真实会话状态会对不上（用户实测：切走了按钮还亮着）。
     ⇒ 还没建群时用 localStorage 里的 `homeId` 当锚点：**同一个 BOSS 会话一直走**，
        ⛔ 不每点一次就多一个「未命名任务」（用户 10-25 第二点）。 */
  const bossThreads = useSyncExternalStore(subscribeBossThreads, getBossThreads);
  /* 10-25 用户令：新建 BOSS 会话时弹**应用内**对话框选项目地址（两个选项），
     ⛔ 不用系统 messageBox、⛔ 不用 toast 内联提示。
     ⛔ 开关走**全局 store**（boss-dir-dialog-store）：点侧栏「BOSS 会话」先落进 BOSS 欢迎界面，
        弹窗由欢迎界面里的「选择项目地址并开始」按钮叫出来 ⇒ 两处要能开同一个弹窗。 */
  const bossDirState = useSyncExternalStore(subscribeBossDirDialog, getBossDirDialogState);
  const bossDirOpen = bossDirState.open;
  const [bossDirBusy, setBossDirBusy] = useState(false);

  /* 新建 BOSS 会话的项目地址对话框（应用内模态，两个选项）
     ⛔ 10-25 用户实测：「点 BOSS 会话」应**先落进 BOSS 欢迎界面**，再由界面上的
        「选择项目地址并开始」叫出这个对话框 ⇒ 选地址这个动作不再由侧栏按钮直接触发。
     ⛔ 这里**不再调 startNewThread()**：进入欢迎界面时已经起过一个新的空会话了，
        再调一次会把用户刚在欢迎界面上打的提示词清掉（saveDraft + setPrompt("")）。 */
  const onBossProjectDir = async (choice: "pick" | "auto" | "cancel") => {
    if (choice === "cancel") { closeBossDirDialog(); return; }
    setBossDirBusy(true);
    try {
      let dir = "";
      if (choice === "pick") {
        const picked = await window.codex.chooseDirectory();
        if (!picked) return;                       // 在系统目录选择器里取消 ⇒ 对话框继续开着，让他重选
        dir = String(picked);
      } else {
        dir = String(await window.codex.createBossProjectDir());
      }
      /* ⛔⛔⛔ **不写全局 workspace**（10-25 用户实测：「下面已经自动选了别的会话的项目地址，
         你这还有别的」「每次 BOSS 会话都不要自动选择旧的会话项目地址」）：
         BOSS 的目录是**它自己会话的 cwd**，写进全局 workspace 会让：
           ① 普通会话的顶栏/项目地址芯片显示成 BOSS 的目录（串项）；
           ② 下一个新会话继承 BOSS 的目录。
         ⇒ 这里只把目录记到 BOSS 会话自己的登记表（setBossDirChosen），
            发首条消息建会话时由 createEmptyThread 用它当 cwd（见 part08/01-seg.tsx）。 */
      closeBossDirDialog();
      /* ⛔ 目录**按会话**记（10-25 用户令：BOSS 会话可创建多个，互不干扰）——
         会话还没建出来（thread id 未分配）⇒ 暂存 pendingDir，会话建成后再按 id 落位。 */
      setBossDirChosen(dir, currentThreadId);
      setBossPending(true);                        // 空态继续显示 BOSS 引导卡
      bossHomePending.current = true;              // 这个新会话登记为 BOSS 会话（拿到 id 后）
    } catch { /* 目录没选成：对话框继续开着 */ }
    finally { setBossDirBusy(false); }
  };
  const currentThreadId = app.thread?.id ?? "";
  /* ⛔⛔ 10-25 用户令：「我选中下面已建的 BOSS 会话时候，上面那个 BOSS 会话选项不要亮」
     —— 顶部这个按钮是**动作**（新建一条 BOSS 会话），不是**状态**（我在不在 BOSS 会话里）。
     把「当前会话是 BOSS」映射成按钮高亮/`aria-pressed`，等于给它挂了个跟它自己用途无关的状态：
     选下面任意一条老 BOSS 会话，上面就跟着亮（前几轮已为此返工过一次），用户这次要求彻底去掉。
     ⇒ 按钮恒为普通态；当前会话的身份只由**会话列表里的选中行**表达。
     ⛔ 别再引入任何 `bossOn` 之类的派生高亮。 */
  /* 点「BOSS 会话」新建的那个会话，等它拿到 id 后记成 home（首条消息发出后引擎才分配）。 */
  const bossHomePending = useRef(false);
  useEffect(() => {
    if (bossHomePending.current && currentThreadId) {
      setBossHomeThreadId(currentThreadId);
      bossHomePending.current = false;
    }
  }, [currentThreadId]);
  const {
    setWorkspace,
    workspaceRef,
    chooseWorkspace,
    accountDraft,
    accountEditing,
    accountMenuOpen,
    accountMenuRef,
    accountMenuSub,
    accountNameRef,
    collapsedSections,
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
    setDramaCanvasOpen,
    setUiSketchOpen,
    setMobileRemoteOpen,
    setPaletteOpen,
    setPaletteQuery,
    setPaletteTab,
    setProjectMenu,
    unregisterKnownProject,
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
    // ⛔ 10-12 更新就绪弹窗（需求 3）：与设置页无关，独立挂在左下角。
    updateReady,
    updateReadyVersion,
    updateRestarting,
    dismissUpdateReady,
    restartAndInstall,
    userAvatar,
    username,
    viewTab,
  } = app;

  /* 分类视图已撤（10-25）：旧偏好 "source" 落到 projects（⛔ 副作用走 effect，不写在 JSX 里）。 */
  useEffect(() => { if (viewTab === "source") setViewTab("projects"); }, [viewTab]);

  // ⛔ 10-21 用户要求：侧栏能力入口按用途分行（前端 UI / 技能插件 MCP / 智能体 / 人格记忆知识库），
  //   点击弹窗看教程；纯局部 UI 状态，不跨组件共享、不进 bag。
  const [guideKey, setGuideKey] = useState<SidebarGuideKey | null>(null);
  /* 登录管理（10-21 用户要求）：三处账户一处直达，纯局部弹窗状态。 */
  const [loginMgrOpen, setLoginMgrOpen] = useState(false);
  /* 新手教程（10-21 侧栏重排）：入口挪进底部导航组 ⇒ 打开状态提到这里（受控交给 NewbieGuide）。 */
  const [newbieOpen, setNewbieOpen] = useState(false);
  /* 底部入口组折叠（10-22 用户要求：「用户名那一排上方加折叠/展开」）。
     ⛔ 只是**本组自己的显隐**：账户行压在侧栏最后一条、位置由贴底决定 ⇒ 折叠后它 0 位移。
     ⛔ 折叠态要跨重启保留（用户把入口都收起来就不会想每次重开）⇒ localStorage，与 `sidebar-collapsed` 同口径。 */
  const [optionsCollapsed, setOptionsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("sidebar-options-collapsed") !== "false"; } catch { return true; }
  });
  /* 启动回灌：主进程 app-settings.json 保存过折叠态就以它为准（强杀进程也不丢）。 */
  useEffect(() => {
    try {
      void window.codex?.readAppSettings?.().then((settings) => {
        if (typeof settings?.sidebarOptionsCollapsed === "boolean") {
          setOptionsCollapsed(settings.sidebarOptionsCollapsed);
          try { localStorage.setItem("sidebar-options-collapsed", String(settings.sidebarOptionsCollapsed)); } catch { /* 隐私模式 */ }
        }
      }).catch(() => undefined);
    } catch { /* 桥不可用时沿用 localStorage */ }
  }, []);
  const toggleOptions = () => {
    const next = !optionsCollapsed;
    setOptionsCollapsed(next);
    try { localStorage.setItem("sidebar-options-collapsed", String(next)); } catch { /* 隐私模式写不进属正常，别拦切换 */ }
    try { void window.codex?.saveAppSettings?.({ sidebarOptionsCollapsed: next })?.catch(() => undefined); } catch { /* 桥不可用 */ }
  };
  /* BOSS 会话按钮（历史与实测依据收在 scripts/guards/22-boss-groups.mjs，此处只留行为契约）：
     ① **先跳到 BOSS 欢迎界面，再弹项目地址对话框**（10-25 用户实测：「点 BOSS 会话，先出来
        这个弹窗，不会跳转到 BOSS 欢迎界面，再跳这个弹窗」⇒ 顺序反了）——
        先建一个空的 BOSS 会话（pending=true ⇒ 时间线渲染 BossThreadIntro 欢迎界面），
        再由欢迎界面（已渲染出来）弹地址对话框（走 boss-dir-dialog-store 的自动弹出标记）。
     ② ⛔⛔ **在已有 BOSS 会话里再点也必须能建**（10-25 用户实测第二轮：「这种情况我点不了上面
        BOSS 会话选项，切不到 BOSS 会话界面，没修好啊」截图就是「当前在 BOSS 会话哈喽里」）——
        原来这里第一行是 `if (bossOn) return;`，等于**当前是 BOSS 会话就点不动**（按钮变死按钮）。
        行为对齐「新建任务」：每点一次 = 一条全新的 BOSS 会话（可无限建、各自独立）。
     ③ 唯一不重复建的情形：**已经停在待发消息的 BOSS 欢迎界面**（pending 且还没有 thread id）
        ⇒ 再点不重置，免得把用户刚打的提示词清掉、并重复弹对话框。 */
  const openBossSession = () => {
    if (bossThreads.pending && !currentThreadId) return;
    /* ① 先落进 BOSS 欢迎界面：置 pending（空态渲染欢迎界面）+ 起一个全新会话。
       ⛔ 会话是在**选定项目地址之后**才真正建（引擎发首条消息时才分配 id），
          这里只把界面切过去 —— 用户先看到 BOSS 欢迎界面。 */
    setBossPending(true);
    bossHomePending.current = true;              // 这个新会话登记为 BOSS 会话（拿到 id 后）
    startNewThread();                            // ⛔ 每次都是全新会话
    /* ② 再弹项目地址对话框：⛔ 用「自动弹出」标记 ⇒ 由**欢迎界面**消费后再弹，
          保证用户先看到欢迎界面（直接 open 会让弹窗盖住它 ⇒ 顺序反了）。 */
    autoOpenBossDirDialog();
  };
  /* 10-25 用户：BOSS 会话快捷键（Win/Linux = Ctrl+M；mac 的 Cmd+M 是系统最小化，沿用 Cmd+Shift+B）。
     ⛔ 键位**单一真相源**在 boss-group-view/boss-shortcut.ts（侧栏 kbd 徽标、欢迎界面、快捷键清单共用）。 */
  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (event: KeyboardEvent) => {
      const mod = mac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || (mac ? event.ctrlKey : event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (mac) {
        if (!event.shiftKey || key !== "b") return;
      } else if (event.shiftKey || key !== "m") return;
      event.preventDefault();
      openBossSession();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bossThreads.pending, currentThreadId]);

  /* 10-25：新建项目弹窗（ZCode 式三选一）。选完目录后与 chooseWorkspace 同款落地：
     workspace 三处同步（state/ref/localStorage）—— 不只改 state，侧栏项目分组才认。 */
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  /* 10-25 用户：项目名可改（只影响侧栏显示，不动磁盘目录）；存 localStorage。 */
  const [projectNames, setProjectNames] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("project-name-overrides-v1") || "{}") as Record<string, string>; } catch { return {}; }
  });
  const projectNameOf = (cwd: string) => (projectNames[cwd] ?? "").trim() || basename(cwd);
  const renameProject = (cwd: string, name: string) => {
    const next = { ...projectNames };
    const trimmed = name.trim();
    if (trimmed) next[cwd] = trimmed; else delete next[cwd];
    setProjectNames(next);
    try { localStorage.setItem("project-name-overrides-v1", JSON.stringify(next)); } catch { /* 隐私模式 */ }
  };
  const applyNewProject = (dir: string) => {
    setNewProjectOpen(false);
    setWorkspace(dir);
    workspaceRef.current = dir;
    try { localStorage.setItem("workspace", dir); } catch { /* 隐私模式 */ }
  };

  /* 10-25：项目行的「+」= 在该项目下开新会话。先切 workspace（三处同步：state/ref/localStorage，
     与 chooseWorkspace 同口径），再 startNewThread —— 新会话首条消息的 cwd 取 workspace。 */
  const bagSetWorkspaceForProject = (cwd: string) => {
    setWorkspace(cwd);
    workspaceRef.current = cwd;
    try { localStorage.setItem("workspace", cwd); } catch { /* 隐私模式 */ }
    startNewThread();
  };

  /* 拓展功能（10-24 立，10-25 更名；原「功能入口」）：可配置排序 / 更多分组 / 两种展示位置（上下移动），动作经总线回到侧栏壳。 */
  const functionMenu = useFunctionMenuConfig();
  useEffect(() => {
    setFunctionMenuActionHandler((id) => {
      if (id === "schedule") { setSettingsPage("schedule"); setSettingsOpen(true); setMobileNav(false); return; }
      if (id === "login") { setLoginMgrOpen(true); return; }
      if (id === "newbie") { setNewbieOpen(true); return; }
      if (id === "team") { setGuideKey("agents"); return; }
      setGuideKey(id);
    });
    return () => setFunctionMenuActionHandler(null);
  }, [setSettingsPage, setSettingsOpen, setMobileNav]);

  /** 同一套入口组渲染在「新会话 / 搜索任务」下面或「侧栏底部」；两处都支持展开/折叠，
      折叠态共用一个持久值（本地记录），高度过渡由 `.sidebar-options-body` 的 grid 动画完成。 */
  const renderOptionsGroup = (menuLocation: "top" | "bottom") => (
    <div className={`sidebar-options ${menuLocation === "top" ? "sidebar-options-top" : ""}`}>
      {/* 新建 BOSS 会话：项目地址对话框（应用内模态；⛔ 不用系统弹窗 / 内联 toast） */}
      <BossProjectDirDialog open={bossDirOpen} busy={bossDirBusy} onChoose={(choice) => void onBossProjectDir(choice)} />
      <button
        type="button"
        className="sidebar-options-toggle"
        aria-expanded={!optionsCollapsed}
        aria-controls="sidebar-options-body"
        title={optionsCollapsed ? "展开功能入口" : "收起功能入口"}
        onMouseEnter={(event) => maybeShowFunctionMenuTour(menuLocation, event.currentTarget)}
        onClick={toggleOptions}
      >
        <LayoutGrid size={15} className="ic-violet" />
        <span>功能入口</span>
        <ChevronDown size={13} className={`sidebar-options-chevron ${optionsCollapsed ? "" : "open"}`} />
      </button>
      <div className={`sidebar-options-body ${optionsCollapsed ? "is-collapsed" : ""}`}>
        <div className="sidebar-nav sidebar-nav-bottom" id="sidebar-options-body" role="group" aria-label="功能入口" aria-hidden={optionsCollapsed}>
          <FunctionMenu location={menuLocation} />
        </div>
      </div>
    </div>
  );

  /** 能力卡片本身就是跳转入口：侧栏统一把 target 翻译成设置页 / 画布。 */
  const navigateGuideTarget = (target: SidebarGuideTarget) => {
    switch (target) {
      case "component-library": setSettingsPage("component-library"); setSettingsOpen(true); setMobileNav(false); break;
      case "ui-sketch": setUiSketchOpen(true); setMobileNav(false); break;
      case "drama-canvas": setDramaCanvasOpen(true); setMobileNav(false); break;
      case "skills": setSettingsPage("skills"); setSettingsOpen(true); setMobileNav(false); break;
      case "plugins": setSettingsPage("plugins"); setSettingsOpen(true); setMobileNav(false); break;
      case "mcp": setSettingsPage("mcp"); setSettingsOpen(true); setMobileNav(false); break;
      /* ⛔ 10-21：专家 / 专家团 / 子智能体直接进各自内页，不再落到 agentteam 外层再点一次
         （用户截图：点完卡片还停在「智能体团队」/「专家中心」的入口层）。 */
      case "expert-center": setSettingsPage("expert-center"); setSettingsOpen(true); setMobileNav(false); break;
      case "teams": setSettingsPage("teams"); setSettingsOpen(true); setMobileNav(false); break;
      case "agents": setSettingsPage("agents"); setSettingsOpen(true); setMobileNav(false); break;
      case "soul-market": setSettingsPage("soul-market"); setSettingsOpen(true); setMobileNav(false); break;
      case "memory": setSettingsPage("memory"); setSettingsOpen(true); setMobileNav(false); break;
      case "knowledge-base": setSettingsPage("knowledge-base"); setSettingsOpen(true); setMobileNav(false); break;
    }
  };

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
            {/* 10-04 扩展面：**走会话行自带的 extras.actions 插入点**（02-thread-attention-rows
                里 {extras?.actions} 就在行内部）—— 不另插兄弟节点，那样内容会落到行外面。
                ⛔ 只对单会话行给（专家团簇与调度子会话由 renderClusterRow /
                dispatch-children 自己管）。
                ⛔⛔ variant 必须传 **undefined** 而不是 "lead"：该参数会走
                `variant === "lead" ? leadBadge` 分支 ⇒ 给**每一行**都加上 lead 徽章
                （02-thread-attention-rows:213）—— 那是行为变更，不是加个插槽。
                ⛔ 传 threadId 是必需的：行级插槽必须知道自己在哪一行。*/}
            {renderThreadRow(entry, undefined, { actions: <Slot id="sidebar.thread-row-actions" props={{ threadId: entry.id, thread: entry }} /> })}
            {childrenAfter(entry.id)}
          </div>
        ))}
      </>
    );
  };

  return (
    <>
    {!popoutThreadId ? (
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""} ${sidebarFlyout ? "flyout-open" : ""}`} onMouseEnter={() => sidebarCollapsed && setSidebarFlyout(true)} onMouseLeave={() => sidebarCollapsed && setSidebarFlyout(false)}>        <div className="brand-row">
              <button className={`brand-mark sidebar-toggle ${sidebarCollapsed ? "is-collapsed" : "is-expanded"}`} aria-label={narrow ? "Codex Harness" : sidebarCollapsed ? "展开侧栏" : "收起侧栏"} title={narrow ? "Codex Harness" : sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={() => { if (narrow) return; const next = !sidebarCollapsed; setSidebarCollapsed(next); localStorage.setItem("sidebar-collapsed", String(next)); }}>
                <img className="ch-logo ch-logo-img" src={`${import.meta.env.BASE_URL}icon.png`} alt="" aria-hidden="true" />
                <span className="sidebar-toggle-arrow"><ArrowLeft size={13} strokeWidth={2.4} /></span>
              </button>
              {!sidebarCollapsed && <div><strong className="brand-name">Codex Harness</strong></div>}
            </div>
            <div className="sidebar-tabs" role="navigation" aria-label="导航">
              <div className="sidebar-quick">
                <button className="sidebar-tab sidebar-quick-btn" title={`新建任务（${hk("Ctrl+N")}）`} onClick={() => { setBossPending(false); startNewThread(); }}>
                  <MessageCirclePlus size={16} strokeWidth={2} className="ic-blue" /><span>新建任务</span><kbd className="quick-kbd">{hk("Ctrl+N")}</kbd>
                </button>
                <button
                  className="sidebar-tab sidebar-quick-btn sidebar-quick-boss ic-amber"
                  title={`新建 BOSS 会话（${bossShortcutLabel()}）：选项目地址后进 BOSS 欢迎界面；可建多个，互不干扰`}
                  onClick={() => openBossSession()}
                >
                  <Crown size={15} /><span>BOSS 会话</span><kbd className="quick-kbd">{bossShortcutLabel()}</kbd>
                </button>
                {/* 10-25 用户令：拓展功能（技能 · 插件 · MCP）从折叠组拉出来常驻在这里；
                    搜索任务只在下方视图行的 🔍 里。动作与折叠组原入口同一总线（教程弹窗）。 */}
                <button className="sidebar-tab sidebar-quick-btn sidebar-quick-search ic-pink" title="技能 · 插件 · MCP：查看教程与入口" onClick={() => setGuideKey("extensions")}>
                  <Zap size={15} className="ic-pink" /><span>拓展功能</span>
                </button>
              </div>
            </div>
            {functionMenu.location === "top" && renderOptionsGroup("top")}
            {guideKey && <SidebarGuideModal guideKey={guideKey} onNavigate={navigateGuideTarget} onClose={() => setGuideKey(null)} />}
            <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} onCreate={applyNewProject} />
            {/* 直达：关弹窗 + 直接开对应设置页（⛔ 不再经「设置 → 账户与模型」多一层） */}
            {loginMgrOpen && (
              <LoginManagerModal
                onNavigate={(page: LoginManagerTarget) => {
                  setSettingsPage(page);
                  setSettingsOpen(true);
                  setMobileNav(false);
                  setLoginMgrOpen(false);
                }}
                onClose={() => setLoginMgrOpen(false)}
              />
            )}
            {/* 10-25 用户令（对照其图二）：视图行 = 「项目」tab + 「任务」tab + 刷新 + 🔍搜索任务
                + 筛选（展开/折叠全部）+ 新建项目。
                ⛔ 刷新会话列表按钮是用户点名要保留的（重排时曾被挤掉，守卫【11u】钉着动作名）。
                ⛔ 分类视图（09-25）入口撤下：本地存过 "source" 的旧偏好由 useEffect 一次性回落 projects，
                口径与渲染仍保留在 lib/thread-source.mjs（守卫【156】仍在用其数据）。 */}
            <div className="view-tabs" role="toolbar" aria-label="会话视图工具">
              <button className={`view-tab ${viewTab === "projects" ? "active" : ""}`} onClick={() => setViewTab("projects")} title="按项目分组查看"><FolderOpen size={14} className="ic-amber" /><span>项目</span></button>
              <button className={`view-tab ${viewTab === "tasks" ? "active" : ""}`} onClick={() => setViewTab("tasks")} title="平铺全部任务（不分组）"><ListChecks size={14} className="ic-blue" /><span>任务</span></button>
              <div className="view-toolbar">
                <button className="view-toolbar-btn ic-blue" title="刷新会话列表" onClick={() => void refreshWithReceipt((text: string) => showToast(text), "刷新会话列表", refreshThreads)}><ListRestart size={14} /></button>
                <button className="view-toolbar-btn ic-cyan" title="搜索任务" onClick={() => { setPaletteOpen(true); setPaletteQuery(""); setPaletteTab("all"); }}><Search size={14} /></button>
                <button className="view-toolbar-btn ic-violet" title={sidebarAllCollapsed ? "展开全部项目" : "折叠全部项目"} onClick={toggleAllSidebarSections} disabled={!projectGroups.length}>{sidebarAllCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}</button>
                <button className="view-toolbar-btn ic-green" title="新建项目（选择 / 创建 / 输入路径）" onClick={() => setNewProjectOpen(true)}><FolderPlus size={14} /></button>
              </div>
            </div>
            {/* 10-04 渲染层插槽：侧栏顶部（在会话列表之上）。插件放这里 = 常驻可见的入口
        （筛选器 / 快速操作 / 状态指示）。挂在 thread-list 里的话会随会话滚动，位置不固定。 */}
            <Slot id="sidebar.top" props={{ onOpenSettings }} loader={() => import("../../settings-devtools/DomainsPanel")} />
{/* 10-04 第 7 个插槽位：**侧栏中部**（工具条下方、会话列表之上，紧随 sidebar.top）。
                与 sidebar.top 的分工：那个是「应用级入口」（状态提醒类，一眼要看到），
                这个是「侧栏的一部分」（筛选器 / 视图内操作）—— 两个位置视觉相邻但语义不同，
                分开放是为了插件能按自己的性质选，不必都挤在同一个位置。
                ⛔ DOM 顺序是**契约的一部分**（守卫【268】钉死已登记插槽位不许被删），
                   所以只允许追加在既有插槽之后，不许插到既有按钮之间。*/}
            <Slot id="sidebar.middle" props={{ onOpenSettings }} loader={() => import("../../settings-devtools/DomainsPanel")} />
            <div className="thread-list">
              {loading ? Array.from({ length: 5 }).map((_, index) => <div className="thread-skeleton shimmer" key={index} />) : viewTab === "tasks" ? (
                /* 10-25 用户令：「项目选项旁边加一个任务选项」= 平铺全部会话（置顶优先、按最近活动排；
                   与项目视图共用 renderDispatchedList 同一渲染器）。 */
                <>{renderDispatchedList([...listThreads].sort((a, b) => Number(pinnedThreads.includes(b.id)) - Number(pinnedThreads.includes(a.id)) || b.updatedAt - a.updatedAt))}</>
              ) : viewTab === "projects" ? (
                <div className="project-list">
                  {projectGroups.length ? projectGroups.map(([cwd, items]) => {
                    const expanded = expandedProjects.has(cwd);
                    return (
                      <div key={cwd} className={`project-item ${expanded ? "expanded" : "collapsed"} ${projectMenu === cwd ? "menu-open" : ""} ${items.length ? "" : "is-empty"}`}>
                        <div className="project-item-head" onMouseLeave={() => setProjectMenu((current) => current === cwd ? null : current)}>
                          <button className="project-item-toggle" title={expanded ? "折叠项目" : "展开项目"} onClick={() => toggleProjectExpanded(cwd)}>
                            <ChevronDown size={12} className={`project-item-chevron ${expanded ? "open" : ""}`} />
                            {/* 色相只给文件夹；箭头保持中性（它是展开/折叠的**状态**指示，染色会跟文件夹抢注意力） */}
                            <FolderOpen size={13} className="ic-amber" />
                            <strong>{projectNameOf(cwd)}</strong>
                          </button>
                          {/* 10-25 用户令（对照 ZCode）：项目行加「新建会话」图标（··· 之前）——
                              点击 = 切 workspace 到该项目 → 开新会话（首条消息发出时 cwd 落到该项目）。 */}
                          <button className="project-item-new-btn" title={"在 " + projectNameOf(cwd) + " 新建任务"} onClick={(event) => { event.stopPropagation(); event.currentTarget.blur(); bagSetWorkspaceForProject(cwd); }}><MessageCirclePlus size={13} /></button>
                          <button className="project-item-menu-btn" title="项目操作" aria-expanded={projectMenu === cwd} onClick={(event) => { event.stopPropagation(); setProjectMenu(projectMenu === cwd ? null : cwd); }}><MoreHorizontal size={14} /></button>
                          {projectMenu === cwd && <div className="project-menu">
                            <button onClick={() => { setProjectMenu(null); void app.openAppPrompt("修改项目名称", projectNameOf(cwd)).then((next) => { if (next != null) renameProject(cwd, next); }); }}><PenLine size={14} />编辑项目名称</button>
                            <button onClick={() => { setProjectMenu(null); void window.codex.shellReveal(cwd).catch(() => undefined); }}><FolderOpen size={14} />打开项目文件</button>
                            <button className="danger" onClick={() => { setProjectMenu(null); unregisterKnownProject(cwd); void deleteThreadsByCwd(cwd); }}><Trash2 size={14} />删除项目（含全部会话）</button>
                          </div>}
                        </div>
                        {expanded && <div className="project-item-body">{items.length ? renderDispatchedList(
                          [...items]
                            // 子会话从顶层剔除（它们缩进挂在发起调度的会话下面，见 renderDispatchedList）
                            .filter((entry) => !sourcedChildIds.has(entry.id))
                            .sort((a, b) => Number(pinnedThreads.includes(b.id)) - Number(pinnedThreads.includes(a.id)) || b.updatedAt - a.updatedAt),
                        ) : <div className="empty-list">暂无任务</div>}</div>}
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
            {/* 10-04 第 10 个插槽位：**侧栏底部**（会话列表之下、拓展功能组（bottom 位置）/账户行之上的常驻位）。
                用户指定的位置（截图里红框处）。语义 =「贴在侧栏下沿的常驻入口」——
                刚好是 sidebar.top（最上沿）的镜像，插件想"一直在但不抢顶部"就挂这里。
                ⛔ 位置在 thread-list **之外**、account-row **之上**：插进thread-list 会
                随会话滚动（位置不固定），插到 account-row 里会与账户/设置按钮抢位。
                ⚠️ 这里空间紧（下面紧邻可折叠的入口组 + 固定 42px 的账户行），**插槽内容宜少不宜多**
                —— 一个统计数字、一个开关那种；别往这里塞长列表。 */}
            <Slot id="sidebar.bottom" props={{ onOpenSettings }} loader={() => import("../../settings-devtools/DomainsPanel")} />
            {/* ── 底部入口组（10-22 用户要求：加折叠/展开；用户名行压在最底、折叠时 0 位移）──────────
                顺序 = [折叠头] → 自动化 → 前端开发 → 拓展 → 团队 → 个性化&记忆 → 登录管理 → 新手教程，
                最后一条才是账户行（用户名 + 手机/设置）。
                ⛔ 名字是用户逐条指定的（不再强求 4 字）；全称仍留在 title 与弹窗标题里。
                ⛔ 折叠**只收本组**（入口 `hidden` + 本组 `flex:none`）⇒ 空出来的高度被 `.thread-list`
                   （flex:1 1 0）吃掉；⛔ 别给账户行加占位/补白、⛔ 别把它挪进本组 —— 它是贴底的锚，
                   位置只由「侧栏最后一条」决定，与展开/折叠无关。 */}
            {functionMenu.location === "bottom" && renderOptionsGroup("bottom")}
            <FunctionMenuTourHost />
            <FunctionMenuEditorHost />
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
                    <button className="account-menu-item" onClick={() => setAccountMenuSub("lang")}><Globe2 size={15} className="ic-cyan" /><span>界面语言</span><ChevronRight size={14} className="account-menu-arrow" /></button>
                    <div className="account-menu-item account-menu-theme" role="menuitem">
                      <Sun size={15} className="ic-pink" /><span>界面主题</span>
                      <span className="theme-quick">
                        {/* 10-07：与设置页主题卡同一条切换链（过渡 + 完成后回执）——见 lib/visual-switch */}
                        <button type="button" title="浅色" className={theme === "light" ? "active" : ""} onClick={() => runVisualSwitch("主题", themeLabelOf("light"), () => setTheme("light"), showToast)}><Sun size={13} /></button>
                        <button type="button" title="深色" className={theme === "dark" ? "active" : ""} onClick={() => runVisualSwitch("主题", themeLabelOf("dark"), () => setTheme("dark"), showToast)}><Moon size={13} /></button>
                      </span>
                    </div>
                    <button className="account-menu-item" onClick={() => setAccountMenuSub("zoom")}><ZoomIn size={15} className="ic-violet" /><span>界面缩放</span><ChevronRight size={14} className="account-menu-arrow" /></button>
                    <button className="account-menu-item" onClick={() => setAccountMenuSub("update")}>
                      <RefreshCw size={15} className="ic-green" />
                      <span>检查更新</span>
                      {updateInfo?.hasUpdate ? <span className="account-menu-dot" title={`v${updateInfo.version} 可用`} /> : null}
                      <ChevronRight size={14} className="account-menu-arrow" />
                    </button>
                    <div className="account-menu-sep" />
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setSettingsPage("usage"); setSettingsOpen(true); }}><CircleGauge size={15} className="ic-blue" /><span>使用统计</span></button>
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setSettingsPage("user"); setSettingsOpen(true); setMobileNav(false); }}><UserRound size={15} className="ic-blue" /><span>用户中心</span></button>
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); void window.codex.openExternal("https://dl.ppz123.asia/feedback.html"); }}><MessageSquarePlus size={15} className="ic-amber" /><span>问题反馈</span><ExternalLink size={12} className="account-menu-arrow" /></button>
                    <div className="account-menu-sep" />
                    <button className="account-menu-item" onClick={() => { setAccountMenuOpen(false); handleLogout(); }}><LogOut size={15} /><span>退出登录</span></button>
                  </>}
                  {accountMenuSub === "lang" && <>
                    <button className="account-menu-item account-menu-back" onClick={() => setAccountMenuSub(null)}><ChevronLeft size={14} /><span>界面语言</span></button>
                    {/* 10-07 审计补漏：English 那项早有回执（"英文界面即将上线"），
                        「简体中文」却一直静默 —— 同类操作两种待遇。补上同一条 showToast。 */}
                    <button className={`account-menu-item ${uiLang === "zh" ? "current" : ""}`} onClick={() => { setUiLang("zh"); setAccountMenuSub(null); showToast("界面语言已切换", "简体中文"); }}><span>简体中文</span>{uiLang === "zh" && <Check size={14} />}</button>
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
                      <UpdateProgressBar active={updateChecking} indeterminate />
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
                        <UpdateProgressBar active={updateDownloading} progress={updateProgress} indeterminate={updateProgress <= 0} />
                      </button>
                    </> : null}
                    <div className="account-menu-sep" />
                    <button className="account-menu-item" title="打开发布中心反馈页（自动携带版本与系统信息）" onClick={openFeedbackPage}><MessageSquare size={15} /><span>遇到问题？去反馈</span><ExternalLink size={13} className="account-menu-arrow" /></button>
                  </>}
                </div>
              )}
              <button className="account-icon ic-cyan" title="移动端远程控制" onClick={() => { setMobileRemoteOpen(true); void window.codex.remoteStart().then((r) => setRemoteUrl(r.url)).catch(() => undefined); void window.codex.remoteStatus().then((s) => { setRemoteStatus(s.status); setRemoteDevices(s.devices); setRemoteUrl(s.url); }).catch(() => undefined); void window.codex.remoteQrcode().then((svg) => setRemoteQr(svg)).catch(() => undefined); void loadPairStates(); }}><Smartphone size={15} /></button>
              <button className="sidebar-settings ic-blue" title="设置" onClick={() => { setSettingsPage("appearance"); setSettingsOpen(true); setMobileNav(false); }}><Settings size={16} /></button>
            </div>
            {/* 受控：传 open ⇒ NewbieGuide 不再画自己那行入口（否则底部会出现两个「新手」） */}
            <NewbieGuide open={newbieOpen} onOpenChange={setNewbieOpen} onOpenSettings={onOpenSettings} />
          </aside>
    ) : null}
    {/* ⛔ 10-12 更新就绪弹窗（需求 3）：挂在 sidebar 之外、Fragment 之内 ——
        它自己 portal 到 body（输入框那层带 transform，不 portal 会被定位成"跟着输入框跑"）。 */}
    {updateReady ? (
      <UpdateReadyToast
        version={updateReadyVersion}
        restarting={updateRestarting}
        onCancel={dismissUpdateReady}
        onRestartInstall={() => void restartAndInstall()}
      />
    ) : null}
    {/* ⛔ 10-13 关闭确认弹窗（应用内卡片，替代原生系统框）：自包含组件（自己订阅
        close-confirm:ask / 自己回包），主进程关窗守卫 preventDefault 后推事件到这里。 */}
    <CloseConfirmDialog />
    {/* 工作区外文件预览的授权确认（10-18，应用内模态；⛔ 不用系统弹窗） */}
    <FileTrustDialog />
    </>
  );
}
