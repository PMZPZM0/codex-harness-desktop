/**
 * usePart02c1 —— usePart02c 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：会话切换与戳记 · 系统事件 · 欢迎目录 — 更新检查 · UI 语言与缩放 · 设置页
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { normalizeThemeId } from "../../../../../lib/themes";
import type { Model, PendingRequest, SettingsPage, SystemEvent, Thread, TreeEntry } from "../../../../app-view/types";
import type { Bag } from "../../bag-types";

export function usePart02c1(bag: Bag) {
  // ⛔ 旧的「内容变化就重置一个 2.6s 定时器去清空单条 notice」已删除（09-20）：
  //    现在每条通知自带独立倒计时（见 setNotice），这里再统一清空会把**别的会话**的通知一起干掉。
  useEffect(() => { void Promise.all([window.codex.listLocalSkills(), window.codex.listConnectors(), window.codex.listSubAgents(), window.codex.listConnectorTemplates(), window.codex.listExpertTeams()]).then(([skills, connectorList, agentList, templateList, teamList]) => { bag.setLocalSkills(skills); bag.setConnectors(connectorList); bag.setSubAgents(agentList); bag.setConnectorTemplates(templateList); bag.setExpertTeams(teamList); }).catch(() => undefined); }, []);

  // RPA 配方与任务清单：进入应用拉一次，设置页/清单面板共享这份数据
  useEffect(() => {
    void window.codex.listRpaRecipes().then(bag.setRpaRecipes).catch(() => undefined);
    void window.codex.listTasks().then(bag.setTaskList).catch(() => undefined);
  }, []);

  useEffect(() => window.codex.onConnectorOAuth((event) => {
    bag.setConnectorOAuth(event);
    if (event.phase === "authorized") {
      bag.setConnectorTemplateModal(null);
      bag.setConnectorTemplateValues({});
      bag.setNotice(event.message);
      void window.codex.listConnectors().then(bag.setConnectors).catch(() => undefined);
    }
  }), []);

  // 市场列表改为「进页才拉取」+ 搜索防抖（见 settingsContentReady 之后的门控效果）；
  // 原先这里挂载即全量请求 SkillHub/插件市场，启动与每个搜索按键都会打远端接口
  // 构建指纹（09-23）：**构建期注入**，显示的就是"正在跑的这一份"。
  // ⛔ 原实现是硬编码字面量 "20260831-1830"（09-23 已过期 23 天却无人发现）—— 那等于告诉用户
  //   一个假信息。现在由 vite.config.ts 的 define 写入，改不动、也不会滞后。
  const buildStamp = __BUILD_STAMP__;
bag.buildStamp = buildStamp as typeof bag.buildStamp;

  /** 正在执行的渲染层 bundle 文件名（形如 `index-t1J-NLl3.js`，含内容 hash）。
   *  与 buildStamp 互补：stamp 回答"什么时候构建的"，它回答"跑的是哪一份文件"。
   *  ⛔ 用 `import.meta.url` 取自己：这是**运行真相**，不是磁盘现状。
   *  开发态（vite dev）拿到的是 `/src/...` 路径 ⇒ 按「非 dist 产物」归一成 "dev"。 */
  const bundleFile = (() => {
    try {
      const path = new URL(import.meta.url).pathname;
      const name = path.split("/").pop() ?? "";
      return /^index-.+\.js$/.test(name) ? name : "dev";
    } catch { return "dev"; }
  })();
bag.bundleFile = bundleFile as typeof bag.bundleFile;

  const [lightbox, setLightbox] = useState<{ path: string; alt: string } | null>(null);
bag.lightbox = lightbox as typeof bag.lightbox; bag.setLightbox = setLightbox as typeof bag.setLightbox;

  /** 粘贴文本大窗口（预览 + 编辑），见 PastedTextEditor */
  const [pastedText, setPastedText] = useState<{ path: string; name: string } | null>(null);
bag.pastedText = pastedText as typeof bag.pastedText; bag.setPastedText = setPastedText as typeof bag.setPastedText;

  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
bag.systemEvents = systemEvents as typeof bag.systemEvents; bag.setSystemEvents = setSystemEvents as typeof bag.setSystemEvents;

  // 本回合 hook 注入徽标（静默）：完成回复时展示在 footer 末尾
  const [hookPulse, setHookPulse] = useState<{ count: number; hooks: { name: string; label?: string; done: boolean }[]; at: number }>({ count: 0, hooks: [], at: 0 });
bag.hookPulse = hookPulse as typeof bag.hookPulse; bag.setHookPulse = setHookPulse as typeof bag.setHookPulse;

  // 欢迎页「项目地址」选择：null = 跟随全局项目地址（与右上角 📁 联动）；
  // 字符串 = 「无项目」模式的临时目录（每次选择都新建一个独立子目录）。
  // 仅欢迎页展示，发送首条消息（thread 有回合）后随欢迎态一起消失。
  const [welcomeScratchDir, setWelcomeScratchDir] = useState<string | null>(null);
bag.welcomeScratchDir = welcomeScratchDir as typeof bag.welcomeScratchDir; bag.setWelcomeScratchDir = setWelcomeScratchDir as typeof bag.setWelcomeScratchDir;

  const [welcomeCwdMenuOpen, setWelcomeCwdMenuOpen] = useState(false);
bag.welcomeCwdMenuOpen = welcomeCwdMenuOpen as typeof bag.welcomeCwdMenuOpen; bag.setWelcomeCwdMenuOpen = setWelcomeCwdMenuOpen as typeof bag.setWelcomeCwdMenuOpen;

  // 首次对话身份引导：null=档案未拉取，false=未引导（新会话注入引导指令+工具），
  // true=已完成（不再引导）。保存后立即置 true，本机后续所有新会话都不再出现。
  /** 身份引导状态：只认第一印象——**问过一次就不再问**（09-12 用户反馈
      「怎么每次新会话都强制引导呢，改成一次打招呼才需要引导，其他情况下直接开始干活」）。
      与旧的 `onboarded`（用户真的回答了并落盘）区分开：那个不改，新会话仍会反复引导。 */
  const [identityGreeted, setIdentityGreeted] = useState<boolean | null>(null);
bag.identityGreeted = identityGreeted as typeof bag.identityGreeted; bag.setIdentityGreeted = setIdentityGreeted as typeof bag.setIdentityGreeted;

  useEffect(() => {
    void window.codex.readPersonalization()
      .then((config) => bag.setIdentityGreeted(config.greeted === true || config.onboarded === true))
      .catch(() => bag.setIdentityGreeted(true)); // 读不到档案就按「已问候」处理：宁可不引导，也不打扰
  }, []);

  // 写代码模式（ponytail）开关状态：默认开启，与「常规」页的总闸联动
  const [ponytailOn, setPonytailOn] = useState(true);
bag.ponytailOn = ponytailOn as typeof bag.ponytailOn; bag.setPonytailOn = setPonytailOn as typeof bag.setPonytailOn;

  // 各渠道真实连接状态（微信/Telegram 网关是否在线）
  const [channelOnline, setChannelOnline] = useState<Record<string, boolean | undefined>>({ weixin: false, telegram: false, feishu: false, dingtalk: false, qq: false, "wecom-webhook": false });
bag.channelOnline = channelOnline as typeof bag.channelOnline; bag.setChannelOnline = setChannelOnline as typeof bag.setChannelOnline;

  useEffect(() => { void window.codex.channelsStatus?.().then(bag.setChannelOnline).catch(() => undefined); }, []);

  // 刚切换会话：首跳用瞬时滚动（auto），之后的流式跟随仍用平滑。
  // ⛔ 必须是「会话 id + 时间戳」而不是裸布尔（09-12 根因修复）：裸布尔的实测后果是
  // **下一次任意 thread 更新**都会把它消费掉 —— 打开会话时置位、若那次没有紧跟一次
  // thread 变更（缓存秒开/同一对象重提交流程），标志就一直挂着，直到发送消息触发的
  // 那次更新把它吃掉：于是「切会话瞬时定位」的分支在发送时执行 → 解除钉顶 + 留白归零
  // + 贴底 → 用户看到「发送后消息不在那个位置」「上下弹跳」。绑 id 后只有该会话自己的
  // 那次渲染能消费它，并且钉顶进行中一律不许被覆盖。
  const switchJumpRef = useRef<{ id: string; at: number } | null>(null);
bag.switchJumpRef = switchJumpRef as typeof bag.switchJumpRef;

  /** 切换瞬时定位是否仍然有效（绑定会话 id + 15s 过期，防陈旧标志永久阻塞向上续载） */
  const switchJumpPending = () => Boolean(bag.switchJumpRef.current && Date.now() - bag.switchJumpRef.current.at < 15000);
bag.switchJumpPending = switchJumpPending as typeof bag.switchJumpPending;

  // 会话消息缓存（复刻 WorkBuddy 切换体验）：打开过的会话缓存 thread，切回时秒开渲染，
  // 后台 thread/resume 刷新；有实质变化才替换，避免无感闪烁。
  const threadCacheRef = useRef(new Map<string, Thread>());
bag.threadCacheRef = threadCacheRef as typeof bag.threadCacheRef;

  // 会话真实绑定的供应商登记表（resume 响应回带 modelProvider 时记录）。发送前据此判断
  // 「会话绑定的供应商 ≠ 当前激活供应商」→ 自动迁移，防止引擎全局 Key 换了而旧会话还
  // 向旧供应商发请求（401 无限重连）。不依赖 UI 下拉框（下拉可能已被切换动作改掉）。
  const threadProviderRef = useRef(new Map<string, string>());
bag.threadProviderRef = threadProviderRef as typeof bag.threadProviderRef;

  /** 401 自动迁移的防重集：每会话只自动迁一次（迁完引擎重连自然接上新绑定；失败循环时不再重复迁移）。 */
  const autoMigratedRef = useRef(new Set<string>());
bag.autoMigratedRef = autoMigratedRef as typeof bag.autoMigratedRef;

  // 无缓存切换时的恢复遮罩：盖住旧内容直到新会话渲染完成（不再让旧内容残留+跳顶）；
  // 缓存秒开也走遮罩——给"刚切过去就在最新消息位置"的视觉过渡，避免内容直接落底的突兀
  const [switchingThreadId, setSwitchingThreadId] = useState<string | null>(null);
bag.switchingThreadId = switchingThreadId as typeof bag.switchingThreadId; bag.setSwitchingThreadId = setSwitchingThreadId as typeof bag.setSwitchingThreadId;

  // 切换序号：快速连点时只让最新一次 resume 落地（旧响应丢弃，防止内容串台）
  const switchSeqRef = useRef(0);
bag.switchSeqRef = switchSeqRef as typeof bag.switchSeqRef;

  // 各会话最近一次完整 thread/resume 的时间：频繁来回切换时，30 秒内且无运行回合的会话
  // 跳过重复 resume（全量加载长会话是"频繁切换会卡"的主因；期间无事件流说明内容没变）
  const recentResumeAtRef = useRef(new Map<string, number>());
bag.recentResumeAtRef = recentResumeAtRef as typeof bag.recentResumeAtRef;

  // 分页游标：每个会话最近一次 turns/list 的 nextCursor，供「显示更早的消息」按需续拉
  const turnsCursorRef = useRef(new Map<string, string | null>());
bag.turnsCursorRef = turnsCursorRef as typeof bag.turnsCursorRef;

  // fade-out 动画控制：jumpToBottom settled 后等一帧再让遮罩淡出，避免内容继续增高
  // 时遮罩提前消失导致"切过去在中间"；markSettled 每次触发都重置 timer，保证只有最后
  // 一次稳定后才真正卸载
  const [switchingFading, setSwitchingFading] = useState(false);
bag.switchingFading = switchingFading as typeof bag.switchingFading; bag.setSwitchingFading = setSwitchingFading as typeof bag.setSwitchingFading;

  const fadeOutTimerRef = useRef<number | null>(null);
bag.fadeOutTimerRef = fadeOutTimerRef as typeof bag.fadeOutTimerRef;

  // 冷加载遮罩的硬超时句柄：jumpToBottom 长时间不 settled 时强制关遮罩（防全白卡死）
  const switchHardTimerRef = useRef<number | null>(null);
bag.switchHardTimerRef = switchHardTimerRef as typeof bag.switchHardTimerRef;

  useEffect(() => {
    const ro = bag.turnResizeObserverRef.current;
    const el = bag.scrollRef.current;
    if (!ro || !el) return;
    el.querySelectorAll(".turn-group").forEach((g) => ro.observe(g));
  }, [bag.thread]);

  useEffect(() => { void window.codex.ponytailModeGet?.().then((mode) => bag.setPonytailOn(mode !== "off")).catch(() => undefined); }, []);

  const [theme, setTheme] = useState(() => normalizeThemeId(localStorage.getItem("theme")));
bag.theme = theme as typeof bag.theme; bag.setTheme = setTheme as typeof bag.setTheme;

  // 账户菜单（点左下角头像/名字弹出）：界面语言 / 界面主题 / 界面缩放 / 使用统计 / 用户中心 / 退出登录
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
bag.accountMenuOpen = accountMenuOpen as typeof bag.accountMenuOpen; bag.setAccountMenuOpen = setAccountMenuOpen as typeof bag.setAccountMenuOpen;

  const [accountMenuSub, setAccountMenuSub] = useState<"lang" | "theme" | "zoom" | "update" | null>(null);
bag.accountMenuSub = accountMenuSub as typeof bag.accountMenuSub; bag.setAccountMenuSub = setAccountMenuSub as typeof bag.setAccountMenuSub;

  // 自更新：更新源固定 GitHub Releases（09-15 用户定稿：发布站不再分发安装包，网页源已删除）
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; version?: string; filename?: string; size?: number; sha256?: string; changelog?: string; mandatory?: boolean; downloadUrl?: string; reason?: string } | null>(null);
bag.updateInfo = updateInfo as typeof bag.updateInfo; bag.setUpdateInfo = setUpdateInfo as typeof bag.setUpdateInfo;

  const [updateCurrentVersion, setUpdateCurrentVersion] = useState<string>("");
bag.updateCurrentVersion = updateCurrentVersion as typeof bag.updateCurrentVersion; bag.setUpdateCurrentVersion = setUpdateCurrentVersion as typeof bag.setUpdateCurrentVersion;

  const [updateChecking, setUpdateChecking] = useState(false);
bag.updateChecking = updateChecking as typeof bag.updateChecking; bag.setUpdateChecking = setUpdateChecking as typeof bag.setUpdateChecking;

  const [updateError, setUpdateError] = useState<string>("");
bag.updateError = updateError as typeof bag.updateError; bag.setUpdateError = setUpdateError as typeof bag.setUpdateError;

  const [updateDownloading, setUpdateDownloading] = useState(false);
bag.updateDownloading = updateDownloading as typeof bag.updateDownloading; bag.setUpdateDownloading = setUpdateDownloading as typeof bag.setUpdateDownloading;

  const [updateProgress, setUpdateProgress] = useState(0);
bag.updateProgress = updateProgress as typeof bag.updateProgress; bag.setUpdateProgress = setUpdateProgress as typeof bag.setUpdateProgress;

  // 启动静默检查发现新版本 → 弹出的通知卡片（用户关掉后本次会话不再弹）
  const [updateNotice, setUpdateNotice] = useState<{ version?: string; changelog?: string; size?: number; mandatory?: boolean } | null>(null);
bag.updateNotice = updateNotice as typeof bag.updateNotice; bag.setUpdateNotice = setUpdateNotice as typeof bag.setUpdateNotice;

  const accountMenuRef = useRef<HTMLDivElement>(null);
bag.accountMenuRef = accountMenuRef as typeof bag.accountMenuRef;

  useEffect(() => {
    if (!bag.accountMenuOpen) return;
    const onDown = (event: globalThis.MouseEvent) => { if (!bag.accountMenuRef.current?.contains(event.target as Node)) bag.setAccountMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [bag.accountMenuOpen]);

  // 启动时静默检查一次：有新版本就弹通知卡片；无更新或出错一律不打扰
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await window.codex.updateCheck?.();
        if (cancelled || !r?.ok) return;
        bag.setUpdateInfo(r.info ?? null);
        bag.setUpdateCurrentVersion(r.currentVersion ?? "");
        if (r.info?.hasUpdate) {
          bag.setUpdateNotice({ version: r.info.version, changelog: r.info.changelog, size: r.info.size, mandatory: r.info.mandatory });
        }
      } catch (err) {
        // 静默：网络不通、发布站不可达都不打扰用户
        console.warn("[update] startup check failed:", err);
      }
    })();
    return () => { cancelled = true; };
    // 仅启动时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { buildStamp, bundleFile, lightbox, setLightbox, pastedText, setPastedText, systemEvents, setSystemEvents, hookPulse, setHookPulse, welcomeScratchDir, setWelcomeScratchDir, welcomeCwdMenuOpen, setWelcomeCwdMenuOpen, identityGreeted, setIdentityGreeted, ponytailOn, setPonytailOn, channelOnline, setChannelOnline, switchJumpRef, switchJumpPending, threadCacheRef, threadProviderRef, autoMigratedRef, switchingThreadId, setSwitchingThreadId, switchSeqRef, recentResumeAtRef, turnsCursorRef, switchingFading, setSwitchingFading, fadeOutTimerRef, switchHardTimerRef, theme, setTheme, accountMenuOpen, setAccountMenuOpen, accountMenuSub, setAccountMenuSub, updateInfo, setUpdateInfo, updateCurrentVersion, setUpdateCurrentVersion, updateChecking, setUpdateChecking, updateError, setUpdateError, updateDownloading, setUpdateDownloading, updateProgress, setUpdateProgress, updateNotice, setUpdateNotice, accountMenuRef };
}
