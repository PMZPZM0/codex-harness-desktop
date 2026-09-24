/**
 * usePart01b（09-22：part01 按序切分出来的第 2 段，纯搬迁、零改写）
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句**只引用自己的局部声明与 bag**（跨语句不靠裸名）—— 这是本次切分成立的前提：
 *    每个名字要么是本段刚声明的局部，要么走 bag（跨 part 用），要么由段末 return 交给组合根转交 App。
 *    改动后请重跑预检【92】与保真脚本（口径见 docs/archive/REFACTOR-PLAN-2026-09-21.md §10.2）。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { attachmentToken, fileToken, promptFilePaths, shouldSavePastedTextAsFile, splitAttachmentSegments, stripAttachmentTokens } from "../../../../lib/composer-attachments.mjs";
import { MarketPreviewState } from "../../../../lib/market-preview-state";
import { PluginInstallState } from "../../../../lib/plugin-install-state";
import type { Bag } from "../bag-types";

export function usePart01b(bag: Bag) {
  // WorkBuddy 式附件菜单子面板：本地文件/引用对话文件/专家（技能、连接器已有独立面板）
  const [attachSubmenu, setAttachSubmenu] = useState<"none" | "files" | "thread-files" | "experts" | "skills" | "connectors" | "favorites">("none");
bag.attachSubmenu = attachSubmenu as typeof bag.attachSubmenu; bag.setAttachSubmenu = setAttachSubmenu as typeof bag.setAttachSubmenu;


  const [threadFileQuery, setThreadFileQuery] = useState("");
bag.threadFileQuery = threadFileQuery as typeof bag.threadFileQuery; bag.setThreadFileQuery = setThreadFileQuery as typeof bag.setThreadFileQuery;


  const [expertQuery, setExpertQuery] = useState("");
bag.expertQuery = expertQuery as typeof bag.expertQuery; bag.setExpertQuery = setExpertQuery as typeof bag.setExpertQuery;


  // 子面板自适应方向（水平+垂直）：主菜单（宽 218px）右缘放不下 250px 子面板时向左翻转；
  // 主菜单下方放不下子面板高度时向上翻转（避免被窗口底边截断）
  const quickMenuRef = useRef<HTMLDivElement>(null);
bag.quickMenuRef = quickMenuRef as typeof bag.quickMenuRef;


  const quickMenuPanelRef = useRef<HTMLDivElement>(null);
bag.quickMenuPanelRef = quickMenuPanelRef as typeof bag.quickMenuPanelRef;


  const [quickMenuFlipUp, setQuickMenuFlipUp] = useState(false);
bag.quickMenuFlipUp = quickMenuFlipUp as typeof bag.quickMenuFlipUp; bag.setQuickMenuFlipUp = setQuickMenuFlipUp as typeof bag.setQuickMenuFlipUp;


  const [submenuFlip, setSubmenuFlip] = useState(false);
bag.submenuFlip = submenuFlip as typeof bag.submenuFlip; bag.setSubmenuFlip = setSubmenuFlip as typeof bag.setSubmenuFlip;


  const [submenuTop, setSubmenuTop] = useState(0);
bag.submenuTop = submenuTop as typeof bag.submenuTop; bag.setSubmenuTop = setSubmenuTop as typeof bag.setSubmenuTop;


  const [quickMenuViewport, setQuickMenuViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
bag.quickMenuViewport = quickMenuViewport as typeof bag.quickMenuViewport; bag.setQuickMenuViewport = setQuickMenuViewport as typeof bag.setQuickMenuViewport;


  useEffect(() => {
    if (!bag.attachmentMenuOpen) return;
    const update = () => bag.setQuickMenuViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [bag.attachmentMenuOpen]);


  useEffect(() => {
    if (!bag.attachmentMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && bag.quickMenuRef.current?.contains(target)) return;
      if (bag.submenuHoverTimer.current) window.clearTimeout(bag.submenuHoverTimer.current);
      if (bag.submenuCloseTimer.current) window.clearTimeout(bag.submenuCloseTimer.current);
      bag.setAttachSubmenu("none");
      bag.setAttachmentMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [bag.attachmentMenuOpen]);


  useLayoutEffect(() => {
    if (!bag.attachmentMenuOpen) { bag.setQuickMenuFlipUp(false); bag.setSubmenuFlip(false); bag.setSubmenuTop(0); return; }
    const buttonRect = bag.quickMenuRef.current?.getBoundingClientRect();
    if (!buttonRect) return;
    const menuHeight = bag.quickMenuPanelRef.current?.offsetHeight || 190;
    const flipMain = window.innerHeight - buttonRect.bottom < menuHeight + 8 && buttonRect.top > window.innerHeight - buttonRect.bottom;
    bag.setQuickMenuFlipUp(flipMain);
    if (bag.attachSubmenu === "none") { bag.setSubmenuFlip(false); bag.setSubmenuTop(0); return; }
    const menu = bag.quickMenuPanelRef.current;
    const panel = menu?.querySelector(`[data-submenu-panel="${bag.attachSubmenu}"]`) as HTMLElement | null;
    const item = menu?.querySelector('[data-submenu-open="true"]') as HTMLElement | null;
    if (!menu || !item) return;
    const menuRect = menu.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const panelWidth = panel?.offsetWidth || 250;
    const panelHeight = panel?.offsetHeight || (bag.attachSubmenu === "files" ? 46 : 320);
    bag.setSubmenuFlip(menuRect.right + 6 + panelWidth > window.innerWidth - 8 && menuRect.left >= panelWidth + 14);
    const desiredTop = itemRect.top - menuRect.top;
    const minTop = 8 - menuRect.top;
    const maxTop = window.innerHeight - 8 - menuRect.top - panelHeight;
    bag.setSubmenuTop(Math.round(Math.max(minTop, Math.min(desiredTop, maxTop))));
  }, [bag.attachmentMenuOpen, bag.attachSubmenu, bag.quickMenuFlipUp, bag.quickMenuViewport]);


  // WorkBuddy 同款 hover 交互：悬停菜单项 80ms 展开二级，移开 150ms 收起（悬浮在二级上不收）
  const submenuHoverTimer = useRef<number | null>(null);
bag.submenuHoverTimer = submenuHoverTimer as typeof bag.submenuHoverTimer;


  const submenuCloseTimer = useRef<number | null>(null);
bag.submenuCloseTimer = submenuCloseTimer as typeof bag.submenuCloseTimer;


  const scheduleSubmenu = (target: "files" | "thread-files" | "experts" | "skills" | "connectors" | "favorites") => {
    if (bag.submenuCloseTimer.current) { window.clearTimeout(bag.submenuCloseTimer.current); bag.submenuCloseTimer.current = null; }
    if (bag.submenuHoverTimer.current) window.clearTimeout(bag.submenuHoverTimer.current);
    bag.submenuHoverTimer.current = window.setTimeout(() => bag.setAttachSubmenu(target), 80);
  };
bag.scheduleSubmenu = scheduleSubmenu as typeof bag.scheduleSubmenu;


  const scheduleSubmenuClose = () => {
    if (bag.submenuHoverTimer.current) { window.clearTimeout(bag.submenuHoverTimer.current); bag.submenuHoverTimer.current = null; }
    if (bag.submenuCloseTimer.current) window.clearTimeout(bag.submenuCloseTimer.current);
    bag.submenuCloseTimer.current = window.setTimeout(() => bag.setAttachSubmenu("none"), 150);
  };
bag.scheduleSubmenuClose = scheduleSubmenuClose as typeof bag.scheduleSubmenuClose;


  // 悬停到二级面板上时取消关闭（WorkBuddy keep-open）
  useEffect(() => {
    if (!bag.attachmentMenuOpen || bag.attachSubmenu === "none") return;
    const pop = bag.quickMenuPanelRef.current;
    if (!pop) return;
    const onEnter = () => { if (bag.submenuCloseTimer.current) { window.clearTimeout(bag.submenuCloseTimer.current); bag.submenuCloseTimer.current = null; } };
    const panel = pop.querySelector(`[data-submenu-panel="${bag.attachSubmenu}"]`);
    panel?.addEventListener("mouseenter", onEnter);
    return () => panel?.removeEventListener("mouseenter", onEnter);
  }, [bag.attachmentMenuOpen, bag.attachSubmenu]);


  // +号按钮点击转动动画：每次点击重新触发（key 递增重建节点）
  const [plusSpinTick, setPlusSpinTick] = useState(0);
bag.plusSpinTick = plusSpinTick as typeof bag.plusSpinTick; bag.setPlusSpinTick = setPlusSpinTick as typeof bag.setPlusSpinTick;


  // 输入框提示词增强（WorkBuddy enhance 按钮复刻）：enhancing = 请求中可取消；backup = 增强成功后的原文（点按钮还原）
  const [enhanceBusy, setEnhanceBusy] = useState(false);
bag.enhanceBusy = enhanceBusy as typeof bag.enhanceBusy; bag.setEnhanceBusy = setEnhanceBusy as typeof bag.setEnhanceBusy;


  const enhanceBackupRef = useRef<string | null>(null);
bag.enhanceBackupRef = enhanceBackupRef as typeof bag.enhanceBackupRef;


  /** 增强请求的取消令牌（见 runPromptEnhance / cancelPromptEnhance）。 */
  const enhanceRunIdRef = useRef(0);
bag.enhanceRunIdRef = enhanceRunIdRef as typeof bag.enhanceRunIdRef;


  const [hasEnhanceBackup, setHasEnhanceBackup] = useState(false);
bag.hasEnhanceBackup = hasEnhanceBackup as typeof bag.hasEnhanceBackup; bag.setHasEnhanceBackup = setHasEnhanceBackup as typeof bag.setHasEnhanceBackup;


  /** 增强按钮的提示气泡（09-17 用户要求：「输入文字后在图标上方小气泡提醒，词库丰富、个性一点」）。
   *  ⛔ **09-20 用户改口径**：「增强弹出来频率太高了，一输入文字就出来了，降低一下频率」
   *     ⇒ 触发条件① 由「每次启动后第一次**输入**必弹」改为「第 1 次**成功发送**后弹一次」
   *     （打字期间完全不弹，见触发 effect 里的 `due`）。② 每 5 次 → 每 10 次；
   *     ③ 长输入门槛 50 → 120 字符；冷却 1 分钟 → 3 分钟；气泡停留 6s → 3s。
   *  ⛔ 展示时机必须挂在 enhanceAnchorVisible 上（= 气泡所依附的按钮真的渲染出来了）：
   *  发送后/回合运行中输入时按钮不渲染，此时展示等于用户永远看不到（实测踩到）。 */
  const [enhanceHint, setEnhanceHint] = useState<string | null>(null);
bag.enhanceHint = enhanceHint as typeof bag.enhanceHint; bag.setEnhanceHint = setEnhanceHint as typeof bag.setEnhanceHint;


  const enhanceHintTimerRef = useRef<number | null>(null);
bag.enhanceHintTimerRef = enhanceHintTimerRef as typeof bag.enhanceHintTimerRef;


  const lastEnhanceHintRef = useRef<string | undefined>(undefined);
bag.lastEnhanceHintRef = lastEnhanceHintRef as typeof bag.lastEnhanceHintRef;


  /** 条件② 发送计数（内存计数，重启归零；定位是"偶尔提醒"，不做持久化）。
   *  第 1 次命中即条件① 的"首次发送后提醒"，之后每 10 次一次。 */
  const enhanceSendCountRef = useRef(0);
bag.enhanceSendCountRef = enhanceSendCountRef as typeof bag.enhanceSendCountRef;


  /** 条件② 待弹（周期到了）。 */
  const enhanceHintAfterSendRef = useRef(false);
bag.enhanceHintAfterSendRef = enhanceHintAfterSendRef as typeof bag.enhanceHintAfterSendRef;


  /** 条件③ 本次"编辑会话"内长输入是否已触发（输入清空时重置，所以写第二条长需求还能提醒）。 */
  const enhanceLongFiredRef = useRef(false);
bag.enhanceLongFiredRef = enhanceLongFiredRef as typeof bag.enhanceLongFiredRef;


  /** 冷却时间戳：条件叠加时防止连弹（首次不受限，因为初值为 0）。 */
  const enhanceHintFiredAtRef = useRef(0);
bag.enhanceHintFiredAtRef = enhanceHintFiredAtRef as typeof bag.enhanceHintFiredAtRef;


  // 文件附件（09-18 改造）：**不再有独立状态** —— 文件只以 `[文件:path]` 占位符存在于
  // 输入框文本里（与图片的 [图片:path] 同一套机制），需要时现算。
  // 这样"输入框里看到的 chip"与"发送出去的附件"天然一致，不会出现状态与文本不同步。
  const attachedFiles = useMemo(() => promptFilePaths(bag.prompt), [bag.prompt]);
bag.attachedFiles = attachedFiles as typeof bag.attachedFiles;


  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
bag.skillMenuOpen = skillMenuOpen as typeof bag.skillMenuOpen; bag.setSkillMenuOpen = setSkillMenuOpen as typeof bag.setSkillMenuOpen;


  const [skillQuery, setSkillQuery] = useState("");
bag.skillQuery = skillQuery as typeof bag.skillQuery; bag.setSkillQuery = setSkillQuery as typeof bag.setSkillQuery;

  /* 收藏架子菜单的搜索词（与技能/连接器子菜单同款：搜索态由 app 层持有，
     菜单关闭再打开不会"上次搜的词还在"以外的意外） */
  const [favoriteQuery, setFavoriteQuery] = useState("");
bag.favoriteQuery = favoriteQuery as typeof bag.favoriteQuery; bag.setFavoriteQuery = setFavoriteQuery as typeof bag.setFavoriteQuery;


  const [selectedSkills, setSelectedSkills] = useState<{ name: string; description: string }[]>([]);
bag.selectedSkills = selectedSkills as typeof bag.selectedSkills; bag.setSelectedSkills = setSelectedSkills as typeof bag.setSelectedSkills;


  const [localSkills, setLocalSkills] = useState<LocalSkillEntry[]>([]);
bag.localSkills = localSkills as typeof bag.localSkills; bag.setLocalSkills = setLocalSkills as typeof bag.setLocalSkills;


  const [marketSkills, setMarketSkills] = useState<MarketSkillEntry[]>([]);
bag.marketSkills = marketSkills as typeof bag.marketSkills; bag.setMarketSkills = setMarketSkills as typeof bag.setMarketSkills;


  const [marketLoading, setMarketLoading] = useState(false);
bag.marketLoading = marketLoading as typeof bag.marketLoading; bag.setMarketLoading = setMarketLoading as typeof bag.setMarketLoading;


  const [marketTotal, setMarketTotal] = useState(0);
bag.marketTotal = marketTotal as typeof bag.marketTotal; bag.setMarketTotal = setMarketTotal as typeof bag.setMarketTotal;


  const [marketPage, setMarketPage] = useState(1);
bag.marketPage = marketPage as typeof bag.marketPage; bag.setMarketPage = setMarketPage as typeof bag.setMarketPage;


  const [marketPageSize] = useState(18);
bag.marketPageSize = marketPageSize as typeof bag.marketPageSize;


  const [installingMarketSkill, setInstallingMarketSkill] = useState<string | null>(null);
bag.installingMarketSkill = installingMarketSkill as typeof bag.installingMarketSkill; bag.setInstallingMarketSkill = setInstallingMarketSkill as typeof bag.setInstallingMarketSkill;


  // 插件市场（codex-marketplace.com）状态
  const [pluginInstall, setPluginInstall] = useState<PluginInstallState | null>(null);
bag.pluginInstall = pluginInstall as typeof bag.pluginInstall; bag.setPluginInstall = setPluginInstall as typeof bag.setPluginInstall;


  const [pluginMarketItems, setPluginMarketItems] = useState<PluginMarketEntry[]>([]);
bag.pluginMarketItems = pluginMarketItems as typeof bag.pluginMarketItems; bag.setPluginMarketItems = setPluginMarketItems as typeof bag.setPluginMarketItems;


  const [pluginMarketLoading, setPluginMarketLoading] = useState(false);
bag.pluginMarketLoading = pluginMarketLoading as typeof bag.pluginMarketLoading; bag.setPluginMarketLoading = setPluginMarketLoading as typeof bag.setPluginMarketLoading;


  const [pluginMarketTotal, setPluginMarketTotal] = useState(0);
bag.pluginMarketTotal = pluginMarketTotal as typeof bag.pluginMarketTotal; bag.setPluginMarketTotal = setPluginMarketTotal as typeof bag.setPluginMarketTotal;


  const [pluginMarketPage, setPluginMarketPage] = useState(1);
bag.pluginMarketPage = pluginMarketPage as typeof bag.pluginMarketPage; bag.setPluginMarketPage = setPluginMarketPage as typeof bag.setPluginMarketPage;


  const [pluginMarketPageSize] = useState(18);
bag.pluginMarketPageSize = pluginMarketPageSize as typeof bag.pluginMarketPageSize;


  const [installingMarketPlugin, setInstallingMarketPlugin] = useState<string | null>(null);
bag.installingMarketPlugin = installingMarketPlugin as typeof bag.installingMarketPlugin; bag.setInstallingMarketPlugin = setInstallingMarketPlugin as typeof bag.setInstallingMarketPlugin;


  const [pluginMarketCategory, setPluginMarketCategory] = useState("全部");
bag.pluginMarketCategory = pluginMarketCategory as typeof bag.pluginMarketCategory; bag.setPluginMarketCategory = setPluginMarketCategory as typeof bag.setPluginMarketCategory;


  const [pluginMarketSearch, setPluginMarketSearch] = useState("");
bag.pluginMarketSearch = pluginMarketSearch as typeof bag.pluginMarketSearch; bag.setPluginMarketSearch = setPluginMarketSearch as typeof bag.setPluginMarketSearch;


  // SkillHub MCP 市场筛选
  const [mcpMarketCategory, setMcpMarketCategory] = useState("全部");
bag.mcpMarketCategory = mcpMarketCategory as typeof bag.mcpMarketCategory; bag.setMcpMarketCategory = setMcpMarketCategory as typeof bag.setMcpMarketCategory;


  const [mcpMarketSearch, setMcpMarketSearch] = useState("");
bag.mcpMarketSearch = mcpMarketSearch as typeof bag.mcpMarketSearch; bag.setMcpMarketSearch = setMcpMarketSearch as typeof bag.setMcpMarketSearch;


  const [marketPreview, setMarketPreview] = useState<MarketPreviewState | null>(null);
bag.marketPreview = marketPreview as typeof bag.marketPreview; bag.setMarketPreview = setMarketPreview as typeof bag.setMarketPreview;


  // 内置浏览器「外部打开」请求：文件预览等处发起，seq 区分同一 URL 的连续打开
  const [browserOpenReq, setBrowserOpenReq] = useState<{ url: string; seq: number } | null>(null);
bag.browserOpenReq = browserOpenReq as typeof bag.browserOpenReq; bag.setBrowserOpenReq = setBrowserOpenReq as typeof bag.setBrowserOpenReq;


  const openInBrowserPane = useCallback((url: string) => {
    bag.setRightOpen(true);
    bag.setRightTab("browser");
    bag.setBrowserOpenReq({ url, seq: Date.now() });
  }, []);
bag.openInBrowserPane = openInBrowserPane as typeof bag.openInBrowserPane;
  return { attachSubmenu, setAttachSubmenu, favoriteQuery, setFavoriteQuery, threadFileQuery, setThreadFileQuery, expertQuery, setExpertQuery, quickMenuRef, quickMenuPanelRef, quickMenuFlipUp, setQuickMenuFlipUp, submenuFlip, setSubmenuFlip, submenuTop, setSubmenuTop, quickMenuViewport, setQuickMenuViewport, submenuHoverTimer, submenuCloseTimer, scheduleSubmenu, scheduleSubmenuClose, plusSpinTick, setPlusSpinTick, enhanceBusy, setEnhanceBusy, enhanceBackupRef, enhanceRunIdRef, hasEnhanceBackup, setHasEnhanceBackup, enhanceHint, setEnhanceHint, enhanceHintTimerRef, lastEnhanceHintRef, enhanceSendCountRef, enhanceHintAfterSendRef, enhanceLongFiredRef, enhanceHintFiredAtRef, attachedFiles, skillMenuOpen, setSkillMenuOpen, skillQuery, setSkillQuery, selectedSkills, setSelectedSkills, localSkills, setLocalSkills, marketSkills, setMarketSkills, marketLoading, setMarketLoading, marketTotal, setMarketTotal, marketPage, setMarketPage, marketPageSize, installingMarketSkill, setInstallingMarketSkill, pluginInstall, setPluginInstall, pluginMarketItems, setPluginMarketItems, pluginMarketLoading, setPluginMarketLoading, pluginMarketTotal, setPluginMarketTotal, pluginMarketPage, setPluginMarketPage, pluginMarketPageSize, installingMarketPlugin, setInstallingMarketPlugin, pluginMarketCategory, setPluginMarketCategory, pluginMarketSearch, setPluginMarketSearch, mcpMarketCategory, setMcpMarketCategory, mcpMarketSearch, setMcpMarketSearch, marketPreview, setMarketPreview, browserOpenReq, setBrowserOpenReq, openInBrowserPane };
}
