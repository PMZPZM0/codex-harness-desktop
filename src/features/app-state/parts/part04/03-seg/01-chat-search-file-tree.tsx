/**
 * usePart04c1 —— usePart04c 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：聊天搜索/文件树 · 内置浏览器/书签 · 队列调度 · 设置资源
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { isMacPlatform } from "../../../../../lib/is-mac-platform";
import { basename } from "../../../../../lib/basename";
import { openImageLightbox, registerImageLightbox, openPastedTextEditor, registerOpenPastedTextEditor, notifyToast, registerToast, requestClosePastedText, registerClosePastedText, resolveFilePath, registerResolveFilePath, lookupKnownFile, registerLookupKnownFile, notifyFileMissing, registerFileMissing } from "../../../../../lib/ui-channels";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";

export function usePart04c1(bag: Bag) {
  // 搜索结果消息高亮打标（DOM 级，随结果/当前项变化重打）
  // ⛔ 懒加载：命中的回合若还在渲染窗口之外（更早、未挂载的页），下面 locateMatchEl 拿不到元素
  //   ⇒ 本次跳过（不是漏标 —— 等它被渲染出来、本效果再次运行时补上）。
  useLayoutEffect(() => {
    const scroller = bag.scrollRef.current;
    if (scroller) scroller.querySelectorAll<HTMLElement>(".msg-search-hit, .msg-search-hit-current").forEach((n) => n.classList.remove("msg-search-hit", "msg-search-hit-current"));
    if (!scroller || !bag.chatSearchOpen || !bag.chatSearchResults.length) return;
    if (bag.chatSearchIndex >= bag.chatSearchResults.length) bag.setChatSearchIndex(0);
    bag.chatSearchResults.forEach((m, i) => {
      const el = locateMatchEl(scroller, m);
      if (!el) return;
      if (i === bag.chatSearchIndex) { el.classList.add("msg-search-hit", "msg-search-hit-current"); }
      else { el.classList.add("msg-search-hit"); }
    });
  }, [bag.chatSearchOpen, bag.chatSearchResults, bag.chatSearchIndex, bag.thread]);

  const chatSearchGo = useCallback((dir: 1 | -1) => {
    const scroller = bag.scrollRef.current;
    if (!scroller || !bag.chatSearchResults.length) return;
    const next = (bag.chatSearchIndex + dir + bag.chatSearchResults.length) % bag.chatSearchResults.length;
    bag.setChatSearchIndex(next);
    // ⛔ 懒加载：命中项若在更早、**尚未渲染**的页里，locateMatchEl 返回 null ⇒ 这句是静默无操作
    //   （「搜到但切不过去」就是它）。这是懒加载的既定行为，不是 bug；
    //   把更早的页加载出来（「显示更早的 N 条」/ 向上滚）后即可正常跳转。
    //   ⛔ 不要为此去改懒加载本身（用户明确要求不要动）。详见 part09/02-seg.tsx 的 jumpToHit 注释。
    locateMatchEl(scroller, bag.chatSearchResults[next])?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [bag.chatSearchResults, bag.chatSearchIndex]);
bag.chatSearchGo = chatSearchGo as typeof bag.chatSearchGo;

  const pushChatSearchHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    bag.setChatSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((entry) => entry !== trimmed)].slice(0, 10);
      try { localStorage.setItem("chat-search-history", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
bag.pushChatSearchHistory = pushChatSearchHistory as typeof bag.pushChatSearchHistory;

  const removeChatSearchHistory = useCallback((entry: string) => {
    bag.setChatSearchHistory((prev) => {
      const next = prev.filter((item) => item !== entry);
      try { localStorage.setItem("chat-search-history", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
bag.removeChatSearchHistory = removeChatSearchHistory as typeof bag.removeChatSearchHistory;

  const clearChatSearchHistory = useCallback(() => {
    bag.setChatSearchHistory([]);
    try { localStorage.removeItem("chat-search-history"); } catch { /* ignore */ }
  }, []);
bag.clearChatSearchHistory = clearChatSearchHistory as typeof bag.clearChatSearchHistory;

  useEffect(() => { void window.codex.getUsername().then(bag.setUsername).catch(() => undefined); }, []);

  useEffect(() => {
    registerImageLightbox((path: string, alt: string) => bag.setLightbox({ path, alt }));
    // 粘贴文本 chip 的大窗口预览/编辑（与图片灯箱同款的模块级开关：chip 是原生 DOM，
    // 拿不到 React 上下文）
    registerOpenPastedTextEditor((path: string, name: string) => bag.setPastedText({ path, name }));
    registerToast((title: string, text?: string) => bag.showToast(title, text));
    return () => { registerImageLightbox(null); registerOpenPastedTextEditor(null); registerToast(null); };
  }, []);

  useEffect(() => {
    // 让模块级组件（InlineFileCards 缩略图等）能解析相对/裸路径 → 绝对路径
    registerResolveFilePath((path: string) => {
      if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("~/") || path.startsWith("http")) return path;
      if (!bag.workspace) return path;
      const sep = bag.workspace.includes("\\") ? "\\" : "/";
      return `${bag.workspace.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
    });
    return () => { registerResolveFilePath(null); };
  }, [bag.workspace]);

  // 会话路径台账缓存：thread 引用不变就复用，变化才重建（裸文件名 → 会话中出现过的绝对路径）
  const knownFilesRef = useRef<{ src: typeof bag.thread | null; map: Map<string, string> }>({ src: null, map: new Map() });
bag.knownFilesRef = knownFilesRef as typeof bag.knownFilesRef;

  useEffect(() => {
    registerLookupKnownFile((name: string) => {
      const key = name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
      if (!key) return null;
      if (bag.knownFilesRef.current.src !== bag.thread) {
        const map = new Map<string, string>();
        collectKnownPaths(bag.thread, map);
        bag.knownFilesRef.current = { src: bag.thread, map };
      }
      return bag.knownFilesRef.current.map.get(key) ?? null;
    });
    registerFileMissing((message: string) => bag.showToast("未找到文件", message));
    return () => { registerLookupKnownFile(null); registerFileMissing(null); };
  });

  useEffect(() => { void window.codex.getUserData().then(bag.setUserDataPath).catch(() => undefined); }, []);

  useEffect(() => { if (bag.activeBotId && bag.botChannelPick) void window.codex.remoteQrcode(bag.activeBotId).then((svg) => bag.setBotQr(svg)).catch(() => undefined); else bag.setBotQr(""); }, [bag.activeBotId, bag.botChannelPick]);

  useEffect(() => { if (localStorage.getItem("keep-awake") === "true") void window.codex.setAwake(true); }, []);

  useEffect(() => {
    // 手机设备上线：自动新建一个会话窗（新任务）
    const offDevice = window.codex.onRemoteDevice((device) => {
      bag.startNewThread();
      bag.setRemoteDevices((current) => current.some((d) => d.id === device.id) ? current : [...current, { id: device.id, name: device.name, connectedAt: Date.now() }]);
      bag.showToast("远程设备已连接", `${device.name} 已接入`);
    });
    // 手机指令：写入输入框并自动发送到当前会话（斜杠指令直接执行）
    const offCommand = window.codex.onRemoteCommand(({ command }) => {
      const text = String(command ?? "").trim();
      if (!text) return;
      if (text.startsWith("/")) { void bag.runSlashCommand(text); return; }
      bag.setPrompt(text);
      setTimeout(() => { (document.querySelector("form.composer") as HTMLFormElement | null)?.requestSubmit(); }, 120);
    });
    return () => { offDevice(); offCommand(); };
  }, []);

  // 手机提交了正确的 6 位配对码 → 这里收到挂起请求，弹审批卡等用户点「允许/拒绝」
  // 09-13：机器人管理面板里也有配对卡了——若用户正开着它，请求直接在面板里审批，
  // 不再叠弹「手机远控」面板（两层弹窗很割裂）。
  useEffect(() => { bag.botManagerOpenRef.current = bag.botManagerOpen; }, [bag.botManagerOpen]);

  useEffect(() => {
    const offPair = window.codex.onRemotePairRequest((request) => {
      bag.setPairPending((current) => current.some((r) => r.rid === request.rid) ? current : [...current, request]);
      // 审批只能在「手机远控」面板里做，而用户此刻大概率没开着它 —— 请求一到就把
      // 面板顶到前台并刷新状态，否则请求会在 2 分钟后静默超时（等于"手机连不上"）。
      if (!bag.botManagerOpenRef.current) bag.setMobileRemoteOpen(true);
      void bag.loadPairStates();
      bag.showToast("手机请求连接", `${request.name}：请${bag.botManagerOpenRef.current ? "在本面板" : "在弹出的面板"}点允许或拒绝`);
    });
    // Bot Channel（微信/QQ/飞书/钉钉/Telegram）聊天里发来 6 位授权码 → 同一张审批卡（rid 以 bp- 开头）
    const offBotPair = window.codex.onBotPairRequest((request) => {
      bag.setPairPending((current) => current.some((r) => r.rid === request.rid) ? current : [...current, { rid: request.rid, name: request.name, createdAt: Date.now() }]);
      if (!bag.botManagerOpenRef.current) bag.setMobileRemoteOpen(true);
      void bag.loadPairStates();
      bag.showToast("机器人请求配对", `${request.name}：请${bag.botManagerOpenRef.current ? "在本面板" : "在弹出的面板"}点允许或拒绝`);
    });
    return () => { offPair(); offBotPair(); };
  }, []);

  useEffect(() => {
    if (bag.showLogin) return;
    function onKey(event: globalThis.KeyboardEvent) {
      // mac 的「命令键」是 ⌘（metaKey），Windows/Linux 才是 Ctrl —— 平台分叉判断（见 isMacPlatform 注释：
      // 旧版写死 `!event.ctrlKey || event.metaKey`，mac 上所有快捷键都被这里 return 掉了）。
      const mac = isMacPlatform();
      const mod = mac ? event.metaKey : event.ctrlKey;
      const otherMod = mac ? event.ctrlKey : event.metaKey;
      if (!mod || event.altKey || otherMod) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey) {
        if (key === "f") { event.preventDefault(); bag.setChatSearchOpen(true); queueMicrotask(() => bag.chatSearchRef.current?.focus()); }
        else if (key === "n") { event.preventDefault(); bag.startNewThread(); }
        else if (key === "p") { event.preventDefault(); bag.setPaletteOpen(true); bag.setPaletteQuery(""); bag.setPaletteTab("all"); }
        else if (key === "s") { event.preventDefault(); bag.setSettingsPage("general"); bag.setSettingsOpen(true); }
        else if (key === "/") { event.preventDefault(); bag.composerInputRef.current?.focus(); }
        return;
      }
      if (key === "n") { event.preventDefault(); bag.startNewThread(); }
      else if (key === "k") { event.preventDefault(); bag.setPaletteOpen(true); bag.setPaletteQuery(""); bag.setPaletteTab("all"); }
      else if (key === "o") { event.preventDefault(); void bag.chooseWorkspace(); }
      else if (key === "b") { event.preventDefault(); bag.setRightOpen((current) => !current); }
      else if (key === "j") { event.preventDefault(); bag.setRightOpen(true); bag.openPanelTab("terminal", bag.workspace ? basename(bag.workspace) : "终端"); }
      else if (key === ",") { event.preventDefault(); bag.setSettingsPage("general"); bag.setSettingsOpen(true); }
      else if (key === "l") { event.preventDefault(); bag.composerInputRef.current?.focus(); }
      else if (key === "p") { event.preventDefault(); bag.setPaletteOpen(true); bag.setPaletteQuery(""); bag.setPaletteTab("all"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bag.showLogin]);

  // 全局 ESC：从最上层弹窗开始关闭；焦点在输入控件里时先退出焦点，再按同一栈关弹窗
  // （否则问答卡/输入弹窗聚焦时按 ESC 会被这里吞掉，转而关掉底下的设置弹窗）。
  useEffect(() => {
    if (bag.showLogin) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tag))) {
        if (target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio" && target.type !== "button") target.blur();
      }
      const closers: Array<() => boolean> = [
        () => { if (bag.skillInstall && (bag.skillInstall.failed || bag.skillInstall.current >= 7)) { bag.setSkillInstall(null); return true; } return false; },
        () => { if (bag.skillRemove && (bag.skillRemove.failed || bag.skillRemove.current > 5)) { bag.setSkillRemove(null); return true; } return false; },
        () => { if (bag.agentAsk) { bag.agentAsk.resolve(""); bag.setAgentAsk(null); return true; } return false; },
        () => { if (bag.appConfirm) { bag.appConfirm.resolve(false); bag.setAppConfirm(null); return true; } return false; },
        () => { if (bag.appPrompt) { bag.appPrompt.resolve(null); bag.setAppPrompt(null); return true; } return false; },
        () => { if (bag.searchPreview) { bag.setSearchPreview(null); return true; } return false; },
        () => { if (bag.memoryPreview) { bag.setMemoryPreview(null); return true; } return false; },
        () => { if (bag.filePreview) { bag.setFilePreview(null); return true; } return false; },
        () => { if (bag.lightbox) { bag.setLightbox(null); return true; } return false; },
        // 粘贴文本大窗口：走统一管线（本组件自己也监听 Esc 会变成两条链各关一次）。
        // 它需要"关窗前先保存"，所以回调走模块级 requestClosePastedText（组件内挂载时注册）。
        () => { if (bag.pastedText) { requestClosePastedText(); return true; } return false; },
        () => { if (bag.modelEditor) { bag.setModelEditor(null); return true; } return false; },
        () => { if (bag.connectorEditorOpen) { bag.setConnectorEditorOpen(false); return true; } return false; },
        () => { if (bag.connectorTemplateModal) { bag.setConnectorTemplateModal(null); return true; } return false; },
        () => { if (bag.commandEditor) { bag.setCommandEditor(null); return true; } return false; },
        () => { if (bag.subAgentEditorOpen) { bag.setSubAgentEditorOpen(false); return true; } return false; },
        () => { if (bag.expertTeamEditorOpen) { bag.setExpertTeamEditorOpen(false); return true; } return false; },
        () => { if (bag.goalsOpen) { bag.setGoalsOpen(false); return true; } return false; },
        () => { if (bag.memoryConfigOpen) { bag.setMemoryConfigOpen(false); return true; } return false; },
        () => { if (bag.memoryCenterOpen) { bag.setMemoryCenterOpen(false); return true; } return false; },
        () => { if (bag.infoModal) { bag.setInfoModal(null); return true; } return false; },
        () => { if (bag.autoFormVisible) { bag.setAutoFormVisible(false); return true; } return false; },
        () => { if (bag.reviewReport) { bag.setReviewReport(""); return true; } return false; },
        () => { if (bag.settingsOpen) { bag.setSettingsOpen(false); return true; } return false; },
        () => { if (bag.shortcutsOpen) { bag.setShortcutsOpen(false); return true; } return false; },
        () => { if (bag.paletteOpen) { bag.setPaletteOpen(false); return true; } return false; },
        () => { if (bag.skillMenuOpen) { bag.setSkillMenuOpen(false); return true; } return false; },
        () => { if (bag.connectorMenuOpen) { bag.setConnectorMenuOpen(false); return true; } return false; },
        () => { if (bag.attachmentMenuOpen) { bag.setAttachmentMenuOpen(false); return true; } return false; },
        () => { if (bag.contextOpen) { bag.setContextOpen(false); return true; } return false; },
        () => { if (bag.switcherOpen) { bag.setSwitcherOpen(false); return true; } return false; },
        () => { if (bag.mobileNav) { bag.setMobileNav(false); return true; } return false; },
        () => { if (bag.chatSearchOpen) { bag.setChatSearchOpen(false); return true; } return false; },
        () => { if (bag.browserMenuOpen) { bag.setBrowserMenuOpen(false); return true; } return false; },
        () => { if (bag.sidebarFlyout) { bag.setSidebarFlyout(false); return true; } return false; },
        () => { if (bag.taskMenuOpen) { bag.setTaskMenuOpen(false); return true; } return false; },
        () => { if (bag.botManagerOpen) { bag.setBotManagerOpen(false); return true; } return false; },
        () => { if (bag.mobileRemoteOpen) { bag.setMobileRemoteOpen(false); return true; } return false; },
        () => { if (bag.ctxMenuOpen) { bag.setCtxMenuOpen(false); return true; } return false; },
        () => { if (bag.accountMenuOpen) { bag.setAccountMenuOpen(false); return true; } return false; },
      ];
      for (const close of closers) if (close()) { event.preventDefault(); return; }
      if (bag.rightOpen) { bag.setRightOpen(false); event.preventDefault(); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bag.showLogin, bag.skillInstall, bag.skillRemove, bag.agentAsk, bag.appConfirm, bag.appPrompt, bag.memoryPreview, bag.searchPreview, bag.filePreview, bag.lightbox, bag.pastedText, bag.modelEditor, bag.connectorEditorOpen, bag.connectorTemplateModal, bag.commandEditor, bag.subAgentEditorOpen, bag.expertTeamEditorOpen, bag.goalsOpen, bag.memoryCenterOpen, bag.memoryConfigOpen, bag.infoModal, bag.reviewReport, bag.settingsOpen, bag.shortcutsOpen, bag.paletteOpen, bag.skillMenuOpen, bag.connectorMenuOpen, bag.attachmentMenuOpen, bag.contextOpen, bag.switcherOpen, bag.mobileNav, bag.sidebarFlyout, bag.autoFormVisible, bag.taskMenuOpen, bag.botManagerOpen, bag.mobileRemoteOpen, bag.ctxMenuOpen, bag.accountMenuOpen, bag.rightOpen]);

  // （原 App 层每秒 nowTick 定时器已移除：无读取点，纯重渲染开销，见 nowTick 处注释。）

  async function refreshThreads() {
    // 主侧栏只展示未归档会话；归档记录由「设置 → 归档管理」单独查看、恢复或删除。
    bag.setThreadsLoading(true);
    try {
      const result = await window.codex.request("thread/list", { limit: 80, sortKey: "updated_at", sortDirection: "desc", archived: false });
      // 用户显式改过的项目地址 / 会话名覆盖引擎值（引擎回包的 cwd 是创建时那个；name 会被
      // 「第一条用户消息」顶掉，见 nameOverrides 处注释）—— 两处都要贴，否则一次刷新就回退
      const list = (result.data ?? []).map((entry: Thread) => bag.withNameOverride(bag.withCwdOverride(entry)));
      bag.setThreads(list);
      // 启动耗时测量（09-17）：首屏会话列表到达 = 界面第一次有真实内容，splash 可以退场
      const boot = (window as unknown as { __boot?: Record<string, number> }).__boot;
      if (boot && boot.firstData === undefined) boot.firstData = performance.now();
      bag.threadsRef.current = list;
    } finally {
      bag.setThreadsLoading(false);
      bag.setBootReady(true);
    }
  }
bag.refreshThreads = refreshThreads as typeof bag.refreshThreads;

  // 后台会话（渠道机器人/手机端等在主进程创建的线程）不进当前会话事件流，
  // 侧栏列表无从感知其出现与更新 → turn/started|completed 时防抖刷新一次。
  const sidebarRefreshTimerRef = useRef<number | null>(null);
bag.sidebarRefreshTimerRef = sidebarRefreshTimerRef as typeof bag.sidebarRefreshTimerRef;

  function scheduleSidebarRefresh() {
    if (bag.sidebarRefreshTimerRef.current != null) return;
    bag.sidebarRefreshTimerRef.current = window.setTimeout(() => { bag.sidebarRefreshTimerRef.current = null; void bag.refreshThreads(); }, 600);
  }
bag.scheduleSidebarRefresh = scheduleSidebarRefresh as typeof bag.scheduleSidebarRefresh;

  async function refreshQueue(threadId: string) {
    try {
      const result = await window.codex.request("thread/queue/list", { threadId, limit: 100 });
      if (bag.threadRef.current?.id === threadId) bag.setQueue(result.data ?? []);
    } catch { /* 空会话/无 rollout 的线程没有消息队列，静默跳过 */ }
  }
bag.refreshQueue = refreshQueue as typeof bag.refreshQueue;

  /** 惰性加载某目录子项进缓存（不改变树 root 与当前视图） */
  async function fetchChildren(path: string) {
    if (!path) return;
    if (bag.treeChildren[path]) return;
    try {
      const result = await window.codex.request("fs/readDirectory", { path });
      const entries = (result.entries ?? []).sort((a: TreeEntry, b: TreeEntry) => Number(b.isDirectory) - Number(a.isDirectory) || a.fileName.localeCompare(b.fileName));
      bag.setTreeChildren((current) => ({ ...current, [path]: entries }));
    } catch (error: any) {
      bag.setTreeChildren((current) => ({ ...current, [path]: [] }));
      bag.setNotice(`读取项目树失败：${error.message}`);
    }
  }
bag.fetchChildren = fetchChildren as typeof bag.fetchChildren;

  /** 展开/收起目录（首次展开时惰性加载子项） */
  function toggleTreeDir(dir: string) {
    bag.setTreeExpanded((current) => {
      const next = new Set(current);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
    void bag.fetchChildren(dir);
  }
bag.toggleTreeDir = toggleTreeDir as typeof bag.toggleTreeDir;

  /** 切换树的根目录（root 层；兼容 tree-location 显示与文件搜索） */
  async function loadTree(path: string) {
    if (!path) return;
    bag.setTreeLoading(true);
    try {
      const result = await window.codex.request("fs/readDirectory", { path });
      const entries = (result.entries ?? []).sort((a: TreeEntry, b: TreeEntry) => Number(b.isDirectory) - Number(a.isDirectory) || a.fileName.localeCompare(b.fileName));
      bag.setTreePath(path);
      bag.setTreeEntries(entries);
      bag.setTreeChildren((current) => ({ ...current, [path]: entries }));
    } catch (error: any) {
      bag.setNotice(`读取项目树失败：${error.message}`);
    } finally {
      bag.setTreeLoading(false);
    }
  }
bag.loadTree = loadTree as typeof bag.loadTree;

  function describeCloakEvent(event: { event?: string; message?: string; url?: string; title?: string }) {
    switch (event.event) {
      case "boot": return "助手进程已启动，等待首次打开";
      case "launching": return "指纹浏览器启动中…（首次会下载/加载内核，稍慢）";
      case "ready": return "CloakBrowser 已就绪";
      case "opened": return `已打开：${event.title ? `${event.title} — ` : ""}${event.url ?? ""}`;
      case "nav-error": return `页面导航失败：${event.message}`;
      case "error": return `错误：${event.message}`;
      case "closed": return "指纹浏览器窗口已关闭";
      case "exit": return "助手进程已退出";
      default: return "";
    }
  }
bag.describeCloakEvent = describeCloakEvent as typeof bag.describeCloakEvent;

  async function openInCloak(url: string) {
    bag.setCloakPage(url);
    bag.setCloakStatus("正在提交给 CloakBrowser…");
    try {
      const result = await window.codex.openInCloakBrowser(url);
      if (!result.ok) {
        bag.setNotice(`CloakBrowser 打开失败：${result.detail}（可切换回内置视图）`);
        bag.setCloakStatus(`提交失败：${result.detail}`);
        return;
      }
      bag.setCloakStatus("已提交，等待窗口响应…");
    } catch (error: any) {
      bag.setNotice(`CloakBrowser 打开失败：${error.message}`);
      bag.setCloakStatus(`提交失败：${error.message}`);
      return;
    }
    window.setTimeout(() => {
      void window.codex.cloakBrowserStatus().then((status) => {
        const text = bag.describeCloakEvent(status);
        if (text) bag.setCloakStatus(text);
      });
    }, 5000);
  }
bag.openInCloak = openInCloak as typeof bag.openInCloak;
  return { chatSearchGo, pushChatSearchHistory, removeChatSearchHistory, clearChatSearchHistory, knownFilesRef, refreshThreads, sidebarRefreshTimerRef, scheduleSidebarRefresh, refreshQueue, fetchChildren, toggleTreeDir, loadTree, describeCloakEvent, openInCloak };
}
