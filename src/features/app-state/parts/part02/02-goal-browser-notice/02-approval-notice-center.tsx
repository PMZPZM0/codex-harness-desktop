/**
 * usePart02b2 —— usePart02b 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：目标/复核/文件浏览 · 审批沙箱人格/通知中心
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { basename } from "../../../../../lib/basename";
import { DELEGATE_RAIL_LINGER_MS, IDENTITY_ONBOARD_INSTRUCTIONS, IDENTITY_ONBOARD_TOOL, MEMBER_LABELS, NOTICE_MAX, NOTICE_TTL_MS, QUICK_SITES } from "../../../../app-view/constants";
import type { Bag } from "../../bag-types";

export function usePart02b2(bag: Bag) {
  // 完全自主模式：所有新任务默认拥有完整本机访问与无需审批的执行权限。
  // 使用版本化迁移，覆盖此前 workspace-write 的历史偏好。
  const [approvalPolicy, setApprovalPolicy] = useState(() => {
    if (!localStorage.getItem("full-autonomy-default-v1")) {
      localStorage.setItem("full-autonomy-default-v1", "true");
      localStorage.setItem("default-sandbox", "danger-full-access");
      localStorage.setItem("default-approval", "never");
    }
    return "never";
  });
bag.approvalPolicy = approvalPolicy as typeof bag.approvalPolicy; bag.setApprovalPolicy = setApprovalPolicy as typeof bag.setApprovalPolicy;

  const [sandbox, setSandbox] = useState(() => {
    const saved = localStorage.getItem("default-sandbox");
    if (!localStorage.getItem("full-autonomy-default-v1")) {
      localStorage.setItem("full-autonomy-default-v1", "true");
      localStorage.setItem("default-sandbox", "danger-full-access");
      localStorage.setItem("default-approval", "never");
      return "danger-full-access";
    }
    return saved === "read-only" || saved === "workspace-write" || saved === "danger-full-access" ? saved : "danger-full-access";
  });
bag.sandbox = sandbox as typeof bag.sandbox; bag.setSandbox = setSandbox as typeof bag.setSandbox;

  const [personality, setPersonality] = useState(() => localStorage.getItem("default-personality") ?? "pragmatic");
bag.personality = personality as typeof bag.personality; bag.setPersonality = setPersonality as typeof bag.setPersonality;

  // ⛔ 通知是**多条队列**，不是单槽（09-20 用户：「会话窗口产生的弹窗相互污染，区分不出来哪个是哪个」）。
  //    旧实现是 `useState("")` 单条字符串 ⇒ 多会话并发来通知时后到的**直接顶掉**先到的，
  //    加上 2.6s 统一清空，用户永远只看得到最后一条。现在每条独立入队、独立倒计时。
  //    scope 决定弹窗**贴着哪 anchoring**：设置页产生的贴设置弹窗内居中，会话产生的贴对话区居中
  //    （09-20 用户：「设置页产生的弹窗在设置弹窗居中，对话框产生的弹窗在对话框区域居中」）。
  const [notices, setNotices] = useState<{ id: number; text: string; threadId?: string; scope: "settings" | "chat" }[]>([]);
bag.notices = notices as typeof bag.notices; bag.setNotices = setNotices as typeof bag.setNotices;

  // ── 通知中心（09-20 用户要求）：每条浮层通知同时落一份到中心，可按对话分组查看、
  //    单条/批量标记已读（已读灰显）与删除；未读数显示在顶栏通知图标徽标上。
  //    持久化到 localStorage（上限 200 条，防无限膨胀）。
  const [noticeCenter, setNoticeCenter] = useState<{ id: number; text: string; threadId?: string; scope: "settings" | "chat"; at: number; read: boolean }[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("notice-center-v1") ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.text === "string") : [];
    } catch { return []; }
  });
bag.noticeCenter = noticeCenter as typeof bag.noticeCenter; bag.setNoticeCenter = setNoticeCenter as typeof bag.setNoticeCenter;

  useEffect(() => {
    try { localStorage.setItem("notice-center-v1", JSON.stringify(bag.noticeCenter.slice(0, 200))); } catch { /* 隐私模式等：忽略 */ }
  }, [bag.noticeCenter]);

  const [noticeCenterOpen, setNoticeCenterOpen] = useState(false);
bag.noticeCenterOpen = noticeCenterOpen as typeof bag.noticeCenterOpen; bag.setNoticeCenterOpen = setNoticeCenterOpen as typeof bag.setNoticeCenterOpen;

  const noticeCenterBtnRef = useRef<HTMLButtonElement | null>(null);
bag.noticeCenterBtnRef = noticeCenterBtnRef as typeof bag.noticeCenterBtnRef;

  const [noticeChecked, setNoticeChecked] = useState<Set<number>>(new Set());
bag.noticeChecked = noticeChecked as typeof bag.noticeChecked; bag.setNoticeChecked = setNoticeChecked as typeof bag.setNoticeChecked;

  const noticeCenterUnread = bag.noticeCenter.filter((entry) => !entry.read).length;
bag.noticeCenterUnread = noticeCenterUnread as typeof bag.noticeCenterUnread;

  const noticeSeqRef = useRef(0);
bag.noticeSeqRef = noticeSeqRef as typeof bag.noticeSeqRef;

  const noticeTimersRef = useRef<Map<number, number>>(new Map());
bag.noticeTimersRef = noticeTimersRef as typeof bag.noticeTimersRef;

  // 设置弹窗开关的 ref 镜像：setNotice 是稳定引用（见下），闭包里读 ref 才能拿到最新开关状态
  const settingsOpenRef = useRef(false);
bag.settingsOpenRef = settingsOpenRef as typeof bag.settingsOpenRef;

  // 窗口尺寸变化时强制重算一次锚点位置（通知生存期只有 2.6s，这里不需要精细的 ResizeObserver）
  const [noticeAnchorTick, setNoticeAnchorTick] = useState(0);
bag.noticeAnchorTick = noticeAnchorTick as typeof bag.noticeAnchorTick; bag.setNoticeAnchorTick = setNoticeAnchorTick as typeof bag.setNoticeAnchorTick;

  useEffect(() => {
    const onResize = () => bag.setNoticeAnchorTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const dismissNotice = useCallback((id: number) => {
    const timer = bag.noticeTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      bag.noticeTimersRef.current.delete(id);
    }
    bag.setNotices((current) => current.filter((entry) => entry.id !== id));
  }, []);
bag.dismissNotice = dismissNotice as typeof bag.dismissNotice;

  // ⛔ 这个函数**故意沿用 useState setter 的名字**：既有几百处 `setNotice(text)` 调用不用改一行。
  //    语义变化只有一点：它现在是「推一条」而不是「覆盖」；传空串仍 = 清空全部
  //    （关闭按钮、发送前清场这类写法保持不变）。
  //    ⛔ 必须 useCallback 保持引用稳定：它被当 `onNotice` 传给子组件、并出现在子组件 15 处
  //    effect 依赖里（VoiceSettingsSection 等）——普通函数每次 render 换引用会让那些 effect
  //    全部重跑（反复拉取/重挂监听）。旧实现是 useState setter（天然稳定），不能在这里退化。
  const setNotice = useCallback((text: string, threadId?: string) => {
    if (!text) {
      for (const timer of bag.noticeTimersRef.current.values()) window.clearTimeout(timer);
      bag.noticeTimersRef.current.clear();
      bag.setNotices([]);
      bag.setNoticeCenter((current) => current.map((entry) => ({ ...entry, read: true })));
      return;
    }
    const id = (bag.noticeSeqRef.current += 1);
    // 归属判定：带 threadId 的一定是会话的事 ⇒ 贴对话区；不带 threadId 且设置弹窗开着 ⇒ 贴设置弹窗。
    // ⛔ 判定必须发生在**入队时**（弹窗开关状态会变，渲染时再判会串组）。
    const scope: "settings" | "chat" = threadId ? "chat" : (bag.settingsOpenRef.current ? "settings" : "chat");
    // 收纳规则（09-20 用户两次反馈后定稿）：中心**只收「别的会话」产生的通知**——
    // 那才是"不在看的对话框"里可能漏掉的消息。设置里的操作提示（保存成功之类）和
    // 对话框的即时反馈（"已复制"等）都是当下操作直接引起的、无会话归属，看得到 ⇒ 不收纳
    // （此前"非当前会话才不收"的口径把这些也收了进去，用户点名纠正）。
    const belongsToOtherThread = Boolean(threadId && threadId !== bag.threadRef.current?.id);
    if (belongsToOtherThread) {
      bag.setNoticeCenter((current) => [{ id, text, threadId, scope, at: Date.now(), read: false }, ...current].slice(0, 200));
    }
    // ⛔ 「不准跨对话框展示」（09-20）：设置弹窗开着时，会话来源的通知**不再弹浮层**
    //    （否则会横跨盖在设置弹窗上面）——静默进通知中心，靠顶栏徽标提醒。
    if (scope === "chat" && bag.settingsOpenRef.current) return;
    // 上限：多会话同时刷屏时只留最近几条，避免糊满一屏
    bag.setNotices((current) => [...current, { id, text, threadId, scope }].slice(-NOTICE_MAX));
    bag.noticeTimersRef.current.set(id, window.setTimeout(() => bag.dismissNotice(id), NOTICE_TTL_MS));
  }, [bag.dismissNotice]);
bag.setNotice = setNotice as typeof bag.setNotice;

  // 卸载时收掉所有挂着的定时器（否则回调会打到已卸载组件上）
  useEffect(() => () => {
    for (const timer of bag.noticeTimersRef.current.values()) window.clearTimeout(timer);
    bag.noticeTimersRef.current.clear();
  }, []);

  // 上下文压缩进度/结果（短暂 toast，不进系统事件流，避免之前那种常驻 timeline 卡片）
  const [compactToast, setCompactToast] = useState<{ state: "running" | "success" | "error"; message?: string; threadId: string } | null>(null);
bag.compactToast = compactToast as typeof bag.compactToast; bag.setCompactToast = setCompactToast as typeof bag.setCompactToast;

  // 信息面板弹窗：/queue /skills /mcp 等查询命令的输出改为居中弹窗展示（不再插入消息流灰色横幅）
  const [infoModal, setInfoModal] = useState<{ title: string; body: string; markdown?: boolean } | null>(null);
bag.infoModal = infoModal as typeof bag.infoModal; bag.setInfoModal = setInfoModal as typeof bag.setInfoModal;

  // 项目树高亮：openFile 后标出当前打开的文件，让用户看到「点了哪个」
  const [highlightedFilePath, setHighlightedFilePath] = useState<string | null>(null);
bag.highlightedFilePath = highlightedFilePath as typeof bag.highlightedFilePath; bag.setHighlightedFilePath = setHighlightedFilePath as typeof bag.setHighlightedFilePath;

  // 高亮变化时：项目树里对应条目滚到视口内（用 data-tree-path 精确锁定）
  useEffect(() => {
    if (!bag.highlightedFilePath) return;
    const target = bag.highlightedFilePath.replace(/\\/g, "/");
    const escape = (s: string) => s.replace(/"/g, '\\"');
    const candidates = [
      `[data-tree-path="${escape(target)}"]`,
      `[data-tree-path$="/${escape(basename(bag.highlightedFilePath))}"]`,
    ];
    const el = candidates.map((sel) => document.querySelector(sel)).find((node): node is HTMLElement => Boolean(node));
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [bag.highlightedFilePath, bag.treeEntries, bag.treePath]);
  return { approvalPolicy, setApprovalPolicy, sandbox, setSandbox, personality, setPersonality, notices, setNotices, noticeCenter, setNoticeCenter, noticeCenterOpen, setNoticeCenterOpen, noticeCenterBtnRef, noticeChecked, setNoticeChecked, noticeCenterUnread, noticeSeqRef, noticeTimersRef, settingsOpenRef, noticeAnchorTick, setNoticeAnchorTick, dismissNotice, setNotice, compactToast, setCompactToast, infoModal, setInfoModal, highlightedFilePath, setHighlightedFilePath };
}
