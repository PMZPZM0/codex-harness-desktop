/**
 * usePart02c2 —— usePart02c 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：会话切换与戳记 · 系统事件 · 欢迎目录 — 更新检查 · UI 语言与缩放 · 设置页
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { HelpDialog, type HelpTopic } from "../../../../../components/HelpDialog";
import { readStoredCodexAvatar, storeCodexAvatar, setCodexIdentity, getCodexIdentity, subscribeCodexIdentity, CODEX_DEFAULT_NAME, type CodexAvatarSpec } from "../../../../../lib/codex-identity.mjs";
import { setWidgetDark, isWidgetDark } from "../../../../../lib/widget-dark";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";

export function usePart02c2(bag: Bag) {
  // 下载进度：主进程通过 updates:download-progress 推送
  useEffect(() => {
    const off = window.codex.updateOnProgress?.((percent: number) => bag.setUpdateProgress(percent));
    return () => { off?.(); };
  }, []);

  const runUpdateCheck = async () => {
    bag.setUpdateChecking(true);
    bag.setUpdateError("");
    try {
      const r = await window.codex.updateCheck?.();
      if (!r) throw new Error("IPC 不可用");
      if (!r.ok) throw new Error(r.error || "检查失败");
      bag.setUpdateInfo(r.info ?? null);
      bag.setUpdateCurrentVersion(r.currentVersion ?? "");
    } catch (err: any) {
      bag.setUpdateError(err?.message || String(err));
    } finally {
      bag.setUpdateChecking(false);
    }
  };
bag.runUpdateCheck = runUpdateCheck as typeof bag.runUpdateCheck;

  /** 下载安装包 → 自动打开安装程序；唤起失败则退化为打开所在文件夹 */
  const runUpdateDownload = async () => {
    if (!bag.updateInfo?.downloadUrl) return;
    bag.setUpdateDownloading(true);
    bag.setUpdateProgress(0);
    bag.setUpdateError("");
    try {
      const r = await window.codex.updateDownload?.({
        downloadUrl: bag.updateInfo.downloadUrl,
        filename: bag.updateInfo.filename || "codex-harness-update.bin",
      });
      if (!r?.ok) throw new Error(r?.error || "下载失败");
      const started = await window.codex.updateInstall?.(r.path!);
      if (!started?.ok) {
        void window.codex.updateReveal?.(r.path!);
        bag.showToast?.(`已下载 v${bag.updateInfo.version}，请手动安装`, "");
      } else {
        bag.setUpdateNotice(null);
        bag.showToast?.(`正在打开 v${bag.updateInfo.version} 安装程序`, "");
      }
    } catch (err: any) {
      bag.setUpdateError(err?.message || String(err));
    } finally {
      bag.setUpdateDownloading(false);
      bag.setUpdateProgress(0);
    }
  };
bag.runUpdateDownload = runUpdateDownload as typeof bag.runUpdateDownload;

  // 打开网站反馈页：带上当前版本与系统信息（管理员可据此复现）
  // 发布站 09-15 起不再分发安装包，只负责应用介绍与问题反馈——反馈页地址保持不变
  const openFeedbackPage = () => {
    const ua = navigator.userAgent;
    const os = /Windows NT 10/.test(ua) ? "Windows 10/11"
      : /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS"
      : /Linux/.test(ua) ? "Linux"
      : navigator.platform || "";
    const qs = new URLSearchParams();
    if (bag.updateCurrentVersion) qs.set("v", bag.updateCurrentVersion);
    if (os) qs.set("os", os);
    // 发布中心地址固定（应用介绍 + 问题反馈），用户无需配置
    const base = "https://www.jvszzp.ltd";
    const url = `${base}/feedback.html${qs.toString() ? `?${qs.toString()}` : ""}`;
    bag.setAccountMenuOpen(false);
    void window.codex.openExternal(url);
  };
bag.openFeedbackPage = openFeedbackPage as typeof bag.openFeedbackPage;

  const [uiLang, setUiLang] = useState(() => localStorage.getItem("ui-lang") ?? "zh");
bag.uiLang = uiLang as typeof bag.uiLang; bag.setUiLang = setUiLang as typeof bag.setUiLang;

  // ⛔ mac 适配（09-16）：把平台写进 <html data-os>，styles.css 用 [data-os="darwin"] 分叉
  // 窗口控制键让位（右上 145px 是 Windows WCO 专属预留，mac 上是纯空白）。
  // data-motion="force"（默认）：无视 macOS 系统级「减少动态效果」——styles.css 里所有
  // prefers-reduced-motion 静音块都加了 html:not([data-motion="force"]) 前缀，用户实测
  // mac 上动画全静止就是系统这个开关命中了全局 `*` 块。以后要做「跟随系统」再摘属性。
  useEffect(() => {
    const p = (window as any).codex?.platform
      || (navigator.platform?.toLowerCase().includes("mac") ? "darwin" : "win32");
    document.documentElement.dataset.os = p;
    document.documentElement.dataset.motion = "force";
  }, []);

  const [uiZoom, setUiZoom] = useState(() => Number(localStorage.getItem("ui-zoom") ?? "1"));
bag.uiZoom = uiZoom as typeof bag.uiZoom; bag.setUiZoom = setUiZoom as typeof bag.setUiZoom;

  useEffect(() => { document.documentElement.dataset.uiLang = bag.uiLang; localStorage.setItem("ui-lang", bag.uiLang); }, [bag.uiLang]);

  useEffect(() => { (document.body.style as any).zoom = String(bag.uiZoom); localStorage.setItem("ui-zoom", String(bag.uiZoom)); }, [bag.uiZoom]);

  // 让模块级 widget 卡片跟随主题（widget iframe 背景/文字色）
  useEffect(() => { setWidgetDark(bag.theme === "dark"); return () => { setWidgetDark(false); }; }, [bag.theme]);

  const [uiFont, setUiFont] = useState(() => localStorage.getItem("ui-font") ?? "default");
bag.uiFont = uiFont as typeof bag.uiFont; bag.setUiFont = setUiFont as typeof bag.setUiFont;

  useEffect(() => {
    document.documentElement.dataset.uiFont = bag.uiFont;
  }, [bag.uiFont]);

  const [settingsOpen, setSettingsOpen] = useState(false);
bag.settingsOpen = settingsOpen as typeof bag.settingsOpen; bag.setSettingsOpen = setSettingsOpen as typeof bag.setSettingsOpen;

  // 专家团办公室预览（09-25）：从「专家 / 专家团」页各团队卡片进入，无独立菜单入口
  // （用户 09-25：「公司模式菜单没啥用、不方便」⇒ 收成专家团专属预览）
  const [companyPreviewTeamId, setCompanyPreviewTeamId] = useState<string | null>(null);
bag.companyPreviewTeamId = companyPreviewTeamId as typeof bag.companyPreviewTeamId; bag.setCompanyPreviewTeamId = setCompanyPreviewTeamId as typeof bag.setCompanyPreviewTeamId;

  // 通知归属判定用的镜像（09-20）：setNotice 是 useCallback 稳定引用，闭包读 ref 拿最新开关状态
  bag.settingsOpenRef.current = bag.settingsOpen;

  // 未配置的 PPtoken 推荐卡可被用户「禁用」（仅置灰，不写引擎存储；配置真实密钥后走 setProviderEnabled）
  // ⛔ 推荐卡（PPtoken 赞助位）**默认不启用**（09-19 用户：「首次安装启动、没配置供应商的时候，
  //   默认不要启用任何供应商，要不然会跟新配置的供应商同时启用」）。
  //   只有用户**显式点开过**（localStorage 存 "0"）才保持启用；没有记录 = 首次安装 = 关。
  //   ⚠️ 旧实现是 `=== "1"`（没记录=启用），于是全新安装第一眼就是一个"未配置密钥却已启用"的卡。
  const [pptokenCardOff, setPptokenCardOff] = useState(() => localStorage.getItem("pptoken-card-off") !== "0");
bag.pptokenCardOff = pptokenCardOff as typeof bag.pptokenCardOff; bag.setPptokenCardOff = setPptokenCardOff as typeof bag.setPptokenCardOff;

  useEffect(() => { try { localStorage.setItem("pptoken-card-off", bag.pptokenCardOff ? "1" : "0"); } catch { /* ignore */ } }, [bag.pptokenCardOff]);

  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
bag.settingsPage = settingsPage as typeof bag.settingsPage; bag.setSettingsPage = setSettingsPage as typeof bag.setSettingsPage;

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
bag.shortcutsOpen = shortcutsOpen as typeof bag.shortcutsOpen; bag.setShortcutsOpen = setShortcutsOpen as typeof bag.setShortcutsOpen;

  /** 设置页「使用帮助」弹窗（09-17 用户要求：模型/插件/技能/MCP/专家团/语音/开发工具都要有）。
   *  null = 不显示；`overview` 是设置总览（标题栏那枚按钮），其余由各页标题旁的 ? 写入（HelpTopic）。 */
  const [helpKey, setHelpKey] = useState<HelpTopic | null>(null);
bag.helpKey = helpKey as typeof bag.helpKey; bag.setHelpKey = setHelpKey as typeof bag.setHelpKey;

  /** 归档后提示浮层（09-17）：token 用于重置倒计时，name 是刚归档的会话名。 */
  const [archiveToast, setArchiveToast] = useState<{ name: string; token: number } | null>(null);
bag.archiveToast = archiveToast as typeof bag.archiveToast; bag.setArchiveToast = setArchiveToast as typeof bag.setArchiveToast;

  /** 模型配置引导（09-17 用户要求）：只在**没有生效模型**时弹，配好后永不再弹。
   *  scope 是本次启动（关掉后本次不再弹；重启仍未配置则再提示一次）。 */
  const [showModelGuide, setShowModelGuide] = useState(false);
bag.showModelGuide = showModelGuide as typeof bag.showModelGuide; bag.setShowModelGuide = setShowModelGuide as typeof bag.setShowModelGuide;

  /** 引导弹窗里「一键配好」的忙碌/错误态（就地反馈，不再只给一句全局 notice） */
  const [quickSetupBusy, setQuickSetupBusy] = useState(false);
bag.quickSetupBusy = quickSetupBusy as typeof bag.quickSetupBusy; bag.setQuickSetupBusy = setQuickSetupBusy as typeof bag.setQuickSetupBusy;

  const [quickSetupError, setQuickSetupError] = useState("");
bag.quickSetupError = quickSetupError as typeof bag.quickSetupError; bag.setQuickSetupError = setQuickSetupError as typeof bag.setQuickSetupError;

  /** 引导弹窗里「中转站账户登录」的忙碌/错误态（与 Key 路径各一份，互不干扰） */
  const [relaySetupBusy, setRelaySetupBusy] = useState(false);
bag.relaySetupBusy = relaySetupBusy as typeof bag.relaySetupBusy; bag.setRelaySetupBusy = setRelaySetupBusy as typeof bag.setRelaySetupBusy;

  const [relaySetupError, setRelaySetupError] = useState("");
bag.relaySetupError = relaySetupError as typeof bag.relaySetupError; bag.setRelaySetupError = setRelaySetupError as typeof bag.setRelaySetupError;

  const modelGuideDoneRef = useRef(false);
bag.modelGuideDoneRef = modelGuideDoneRef as typeof bag.modelGuideDoneRef;

  /** 首次启动「环境体检」（09-17 用户：「新用户不知道该装什么，不装 Codex 啥也干不了」）。
   *  必备 4 项（模型 / 工作区 / Git / ripgrep）缺任一项就弹；装了或用户关掉都算本次完事。 */
  const [envCheckOpen, setEnvCheckOpen] = useState(false);
bag.envCheckOpen = envCheckOpen as typeof bag.envCheckOpen; bag.setEnvCheckOpen = setEnvCheckOpen as typeof bag.setEnvCheckOpen;

  const [envInstalling, setEnvInstalling] = useState(false);
bag.envInstalling = envInstalling as typeof bag.envInstalling; bag.setEnvInstalling = setEnvInstalling as typeof bag.setEnvInstalling;

  const envCheckDoneRef = useRef(false);
bag.envCheckDoneRef = envCheckDoneRef as typeof bag.envCheckDoneRef;

  /** Codex 的身份（名字+头像）：订阅外部 store，改设置时消息头会立刻跟着变。 */
  const codexIdentity = useSyncExternalStore(subscribeCodexIdentity, getCodexIdentity, getCodexIdentity);
bag.codexIdentity = codexIdentity as typeof bag.codexIdentity;

  const [toolsStatus, setToolsStatus] = useState<{ id: string; name: string; scope: "computer" | "browser"; version: string; installed: boolean; binaryReady: boolean; detail: string; command: string }[]>([]);
bag.toolsStatus = toolsStatus as typeof bag.toolsStatus; bag.setToolsStatus = setToolsStatus as typeof bag.setToolsStatus;

  const refreshToolsStatus = () => { window.codex.toolStatus().then(bag.setToolsStatus).catch(() => bag.setToolsStatus([])); };
bag.refreshToolsStatus = refreshToolsStatus as typeof bag.refreshToolsStatus;

  const [devRuntimes, setDevRuntimes] = useState<DevRuntimeEntry[]>([]);
bag.devRuntimes = devRuntimes as typeof bag.devRuntimes; bag.setDevRuntimes = setDevRuntimes as typeof bag.setDevRuntimes;

  const [runtimeInstalling, setRuntimeInstalling] = useState<string | null>(null);
bag.runtimeInstalling = runtimeInstalling as typeof bag.runtimeInstalling; bag.setRuntimeInstalling = setRuntimeInstalling as typeof bag.setRuntimeInstalling;

  const [runtimeProgress, setRuntimeProgress] = useState<Record<string, string>>({});
bag.runtimeProgress = runtimeProgress as typeof bag.runtimeProgress; bag.setRuntimeProgress = setRuntimeProgress as typeof bag.setRuntimeProgress;

  // 安装进度条（09-19 用户：「不要弹窗，全部进度条展示吧，这样可视化进度，方便新手」）：
  // 主进程把安装脚本的结构化行（`@@PROGRESS n` / `@@STAGE 阶段`）解析成独立事件下发，
  // 这里分别记住——文字说明「在做什么」，百分比驱动进度条。
  const [runtimePercent, setRuntimePercent] = useState<Record<string, number>>({});
bag.runtimePercent = runtimePercent as typeof bag.runtimePercent; bag.setRuntimePercent = setRuntimePercent as typeof bag.setRuntimePercent;

  const [runtimeStage, setRuntimeStage] = useState<Record<string, string>>({});
bag.runtimeStage = runtimeStage as typeof bag.runtimeStage; bag.setRuntimeStage = setRuntimeStage as typeof bag.setRuntimeStage;
  return { runUpdateCheck, runUpdateDownload, openFeedbackPage, uiLang, setUiLang, uiZoom, setUiZoom, uiFont, setUiFont, settingsOpen, setSettingsOpen, companyPreviewTeamId, setCompanyPreviewTeamId, pptokenCardOff, setPptokenCardOff, settingsPage, setSettingsPage, shortcutsOpen, setShortcutsOpen, helpKey, setHelpKey, archiveToast, setArchiveToast, showModelGuide, setShowModelGuide, quickSetupBusy, setQuickSetupBusy, quickSetupError, setQuickSetupError, relaySetupBusy, setRelaySetupBusy, relaySetupError, setRelaySetupError, modelGuideDoneRef, envCheckOpen, setEnvCheckOpen, envInstalling, setEnvInstalling, envCheckDoneRef, codexIdentity, toolsStatus, setToolsStatus, refreshToolsStatus, devRuntimes, setDevRuntimes, runtimeInstalling, setRuntimeInstalling, runtimeProgress, setRuntimeProgress, runtimePercent, setRuntimePercent, runtimeStage, setRuntimeStage };
}
