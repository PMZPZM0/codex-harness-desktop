/**
 * usePart04b2 —— usePart04b 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：钩子事件回填/底部状态/resizeObserver — 聊天搜索与其历史
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant, setScrollUserDetached } from "../../../../../components/scroll-utils";
import { turnWindowTailFor } from "../../../../../lib/turn-history.mjs";
import { HIGHLIGHT_CACHE } from "../../../../../lib/highlight-cache";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart04b2(bag: Bag) {
  // ⛔ 09-18 删掉了一个「thread?.id 一变就清留白」的 useEffect —— 它是「切回来钉顶掉下来」的
  //   直接原因：`pinSentMessage` 跑在 **useLayoutEffect** 里（按真实消息元素重算留白并落位），
  //   而 React 的顺序是「所有 useLayoutEffect 先跑、之后才跑 useEffect」⇒ 那边刚把留白撑起来，
  //   这个 passive effect 紧接着就把它清成 0，于是锚点在几何上再也滚不到落点（36px），
  //   视口掉到内容底部 = 用户看到的「切回来钉顶没了」。
  //   切会话真正需要清留白的时机是 **openThread 里**（切走那一刻，见那里注释）：那时 thread
  //   还没换，清完之后的布局 effect 会按 ownerChanged 判定重新撑起来，顺序天然正确。
  //   这里原先的注释说「否则切走再切回会在底部留一大段空白」—— 那个前提（留白常年撑满一屏）
  //   在 09-15 改成「只补缺口」后已不成立：滚到底就等于落点，本来就没有多余可滚空间。

  /** 语法高亮缓存的读数口（与 __switchPerfStats 同款，纯诊断、不参与业务）：
   *  验收靠它确认「二次切同一会话」确实命中了缓存而不是碰巧快了。 */
  useEffect(() => {
    const w = window as any;
    w.__hlCacheStats = () => HIGHLIGHT_CACHE.stats();
    return () => { try { delete w.__hlCacheStats; } catch { /* ignore */ } };
  }, []);

  // 会话切换耗时诊断（09-12 压测用）：openThread 落笔 switchStartRef，这里在 **DOM 已提交**
  // 之后结算一次——这才是用户真正感知的「点一下到看见内容」的时间。
  // 写进 window.__adbg（e2e 场景会 dump），不参与任何业务逻辑。
  // 09-14 扩充：带上 mode(cached/fresh) 与回合数，并提供 window.__switchPerfStats() 算分位数，
  // 供 accept switch-perf 场景直接断言「命中缓存的切换」与「冷加载」两条曲线。
  useLayoutEffect(() => {
    if (!bag.thread?.id || !bag.switchStartRef.current) return;
    const ms = Math.round(performance.now() - bag.switchStartRef.current);
    bag.switchStartRef.current = 0;
    try {
      const w = window as any;
      if (!w.__adbg) w.__adbg = [];
      w.__adbg.push({ r: "thread-switch", id: String(bag.thread.id).slice(0, 8), ms, mode: bag.switchModeRef.current, turns: bag.switchTurnsRef.current });
      if (w.__adbg.length > 400) w.__adbg.splice(0, w.__adbg.length - 400);
    } catch { /* 诊断失败不影响功能 */ }
    bag.switchModeRef.current = "fresh";
  }, [bag.thread?.id]);

  /** accept switch-perf 场景的读数口：把 __adbg 里的 thread-switch 记录算成分位数，
   *  并按 cached / fresh 分组——否则「命中缓存秒开」与「冷加载」两拨数据混在一个 P95 里，
   *  优化了哪一拨根本看不出来（09-14）。纯诊断，不参与业务。 */
  useEffect(() => {
    const w = window as any;
    w.__switchPerfStats = () => {
      const rows = (w.__adbg ?? []).filter((x: any) => x.r === "thread-switch");
      const pct = (arr: number[], p: number) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);
      const group = (mode: "cached" | "fresh" | null) => {
        const arr = rows.filter((r: any) => (mode ? r.mode === mode : true)).map((r: any) => r.ms);
        return { n: arr.length, p50: pct(arr, 0.5), p95: pct(arr, 0.95), max: arr.length ? Math.max(...arr) : null };
      };
      return { all: group(null), cached: group("cached"), fresh: group("fresh") };
    };
    return () => { try { delete (window as any).__switchPerfStats; } catch { /* ignore */ } };
  }, []);

  // 多会话性能（09-12 P1）：把「当前正在查看哪个会话」上报主进程，主进程据此只把
  // 该会话的高频事件（各种 delta / item 全文 / outputDelta）转发给渲染层——
  // 后台会话的流式事件不再白白序列化跨进程、到了再被丢掉（N 会话 = N 倍无用开销）。
  // ⛔ 09-20 修「两个会话窗口一起跑，正在看的会话只显示正在回复、过程不出内容」：
  //   主进程只信 **30s 内**的上报（ACTIVE_THREAD_FRESH_MS），而这里原来**只在会话 id 变化时**
  //   上报一次 —— 停留超过 30s 就被判成「不知道这个窗口在看什么」，该会话的 item/delta 被裁掉
  //   （引擎侧事件照发，rollout 有据；渲染层收不到 ⇒ 只剩余运行指示）。
  //   现在补两条：15s 心跳 + 窗口重新获得焦点时立刻补报（切窗口不改会话，也需要刷新新鲜度）。
  useEffect(() => {
    const report = () => { void window.codex.setActiveThread?.(bag.threadRef.current?.id ?? null).catch(() => undefined); };
    report();
    const timer = window.setInterval(report, 15_000);
    window.addEventListener("focus", report);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", report); };
  }, [bag.thread?.id]);

  // 流式出字时 scrollHeight 在涨，但既不触发 resize 也不触发 scroll，
  // 必须主动刷一次，否则「回到底部」按钮的出现时机是错的。
  useEffect(() => { bag.updateBottomStateRef.current(); }, [bag.thread]);

  // 流式跟随：thread 变化（agent 追加/更新 item）时，若用户仍在底部则滚到底。
  // 必须用 behavior:"auto"：CSS 里 .timeline 是 scroll-behavior:smooth，
  // 直接赋 scrollTop 会走平滑动画，动画中途的滚动事件会误判"用户离开底部"。
  useLayoutEffect(() => {
    const el = bag.scrollRef.current;
    if (!el) return;
    // 刚切换会话：瞬时定位到最新消息并开启跟随（用户预期：切过去就在最新消息）。
    // 必须瞬时：.timeline 的 CSS scroll-behavior:smooth 会让 scrollTo 走平滑动画，
    // 表现为"从上往下滚动"，且动画目标基于发起时的 scrollHeight，内容随后增高会停在半路。
    // 这里消费后立即重置，之后的流式更新走常规 stick 跟随（smooth 跟手）。
    // 切会话瞬时定位**只对刚打开的那个会话、且当前没有钉顶**时生效。
    // 见 switchJumpRef 声明处：裸布尔会被后续任意更新消费，把发送钉顶掀掉。
    // 切会话瞬时定位**只对刚打开的那个会话**生效（裸布尔会被后续任意更新消费，
    // 见 switchJumpRef 声明处）。这里**不再**附加 `!anchorTopRef.current`：
    // 锚定状态的清零已经归 openThread 管（见那里的注释），在这里再挡一下只会让
    // "定位 + 清留白"被整段跳过 —— 实测后果就是切回来 pad 残留一整屏、定位错乱。
    // ★ 唯一 owner：把本次发送的用户消息钉在顶部（自带几何校验，见 pinSentMessage）。
    // **必须排在"切会话瞬时定位"之前**：切回自己那条仍被钉着的会话时，位置要由钉顶
    // 恢复，而不是被贴底逻辑掀掉（用户实测：「切换会话，钉顶没了」）。
    // pinSentMessage 返回 false（锚点不在当前渲染窗口里）才继续往下走贴底逻辑。
    // `pinDormant` = 钉顶属于**别的**会话（切走期间的休眠态）：此时它既不生效，
    // 也不能被下面的贴底分支销毁 —— 否则切回来就恢复不了了。
    // ⛔ 09-18 用户实测「长内容发送时没有自动跟随、要手动滑到底部才触发」的真根因就在这一行：
    //   归属先是 **null**（乐观气泡阶段 `thread?.id` 还是空，pinSentMessage 拿不到真实 id），
    //   而这里把「归属=null（还不知道属于谁）」误判成「属于**别的**会话」⇒ pinDormant 为真
    //   ⇒ 下面那行**跳过 pinSentMessage** ⇒ 归属永远补不上（真实 id 再也没机会写入）
    //   ⇒ update() 里自动跟随的入口 `pinThreadIdRef.current === myThreadId` 恒不成立
    //   ⇒ 整个回复期间一次都不跟随（实测打点：top 恒为 0、内容底部停在视口外 34px）。
    //   修法：**归属未知不算休眠**，只有"已知归属且确实不是本会话"才是休眠。
    const pinOwnerUnknown = bag.anchorTopRef.current && bag.pinThreadIdRef.current === null;
    const pinDormant = bag.anchorTopRef.current && !pinOwnerUnknown && bag.pinThreadIdRef.current !== bag.thread?.id;
    if (pinDormant) bag.pinDormantSeenRef.current = true;   // 记下"休眠过"，回来时立即落位
    if (bag.anchorTopRef.current && !pinDormant && bag.pinSentMessage(el, bag.thread?.id)) return;
    if (bag.switchJumpRef.current && bag.switchJumpRef.current.id === bag.thread?.id && bag.switchJumpPending()) {
      bag.switchJumpRef.current = null;
      bag.dbg("clear-anchor", { at: "switch-jump" });
      // 切到**别的**会话 = 全新定位（贴底看最新）。休眠中的钉顶不属于这里，不能顺手清掉。
      if (!pinDormant) {
        bag.anchorTopRef.current = false;
        bag.pinnedAnchorKeyRef.current = null;
        bag.pinGapLockedRef.current = null;
      }
      bag.clearAnchorPad();   // 锚顶留白不能串到另一条会话（切回来时钉顶会重新撑起来）
      // ★ 09-14：切回**命中过缓存**的会话且用户当时在读历史 → 还原距底偏移，不贴底。
      //   recallScrollOffset 取一次即消费；没有记忆（一直贴底/首次打开）才走下面的贴底。
      const remembered = bag.recallScrollOffset(bag.thread?.id ?? "");
      bag.dbg("scroll-memo", { id: bag.thread?.id ?? "", remembered, top: Math.round(el.scrollTop), tail: turnWindowTailFor(bag.thread?.id ?? "") });
      if (remembered !== null) {
        /* ⛔ 切回“上次在读历史”的会话：把全局自动跳底闸门也关上。只置 stick=false
           挡不住 openThread 末尾那次 rAF jumpToBottom —— 长会话会跳到文档底，
           而滑动窗口把最新回合折进底部占位区 ⇒ 落在一片空白里。 */
        setScrollUserDetached(true);
        bag.stickToBottomRef.current = false;
        /* ⛔ 切回时第一帧拿到的 scrollHeight 可能还是**上一个会话/顶部占位区尚未挂上**的几何：
           单次 scrollTo 之后占位区才长出来，通用 spacer-follow 会把视口再推到底部占位区
           （用户实测「停在中间，切走再切回，对话框空白」）。这里按「距底偏移」连续校准
           20 帧：顶部/底部占位区晚一帧出现，目标会同步跟着长，视口始终留在同一段内容上。 */
        const restoreThreadId = bag.thread?.id ?? "";
        let restoreFrames = 0;
        const restore = () => {
          if ((bag.thread?.id ?? "") !== restoreThreadId) return;
          bag.selfScrollUntilRef.current = Date.now() + 120;
          scrollToOffsetInstant(el, Math.max(0, el.scrollHeight - el.clientHeight - remembered));
          bag.updateBottomStateRef.current?.();
          restoreFrames += 1;
          if (restoreFrames < 20) requestAnimationFrame(restore);
        };
        restore();
        return;
      }
      /* ⛔ 滑动窗口不在尾部（用户上次在读历史）⇒ 这次重新打开绝不能再开贴底：
         resume 会再发一次 thread 更新（新的 switchJump），此时阅读位置 memo 已被
         第一次消费掉；若这里把 stick 置真，ResizeObserver/height-follow 会把
         视口拉到 contentTailTarget（长会话 = 底部占位区的一片空白）。 */
      if (turnWindowTailFor(bag.thread?.id ?? "") > 0) {
        bag.dbg("switch-jump-keep", { id: bag.thread?.id ?? "", tail: turnWindowTailFor(bag.thread?.id ?? ""), top: Math.round(el.scrollTop) });
        bag.stickToBottomRef.current = false;
        return;
      }
      bag.stickToBottomRef.current = true;
      bag.dbg("switch-jump-bottom", { id: bag.thread?.id ?? "", top: Math.round(el.scrollTop) });
      jumpToBottom(el, undefined, bag.contentTailTarget);
      return;
    }
    if (!bag.stickToBottomRef.current) return;
    bag.selfScrollUntilRef.current = Date.now() + 80;
    bag.dbg("stick-jump", { from: Math.round(el.scrollTop), to: Math.round(bag.contentTailTarget(el)) });
    // 贴底跟随必须瞬时：.timeline 的 CSS scroll-behavior:smooth 会让
    // behavior:"auto" 也走平滑动画，动画与下一次内容增长互相 retarget = 抖动
    scrollToOffsetInstant(el, bag.contentTailTarget(el));
  }, [bag.thread]);

  // 锚顶滚动：乐观气泡挂载后把这条新消息顶到对话区顶部（WorkBuddy 观感）。
  // 必须瞬时（scrollToOffsetInstant）：.timeline 的 CSS scroll-behavior:smooth 会让
  // scrollTo({behavior:"auto"}) 也走平滑动画，动画中途与流式跟随互相打架。
  useLayoutEffect(() => {
    if (!bag.optimisticInput || !bag.anchorTopRef.current) return;
    const el = bag.scrollRef.current;
    if (!el) return;
    // 乐观气泡刚挂上就先钉一次（此时真实回合可能还没建出来）；之后每次 thread 更新
    // 都由 [thread] 布局 effect 调同一个 pinSentMessage 复核并纠正。
    bag.pinSentMessage(el, bag.thread?.id);
  }, [bag.optimisticInput, bag.pinSentMessage]);

  /* ⛔ 10-31：必须 **useLayoutEffect**，不能退回 useEffect ——
     明暗切场用 View Transitions（`lib/visual-switch.ts` 的涟漪路径）在 `apply()` 返回后**立刻**
     拍新快照；调用方用 `flushSync` 刷新 React，但被动 effect（useEffect）不在 flushSync 里同步跑，
     `dataset.theme` 会晚一拍 ⇒ 两张快照一模一样，动画等于没有。布局 effect 在 commit 阶段同步执行。 */
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = bag.theme;
    localStorage.setItem("theme", bag.theme);
    // 同步窗口外观：深色模式下标题栏 overlay 与背景跟随主题（不再残留浅色外框）
    void window.codex.themeApply(bag.theme).catch(() => undefined);
  }, [bag.theme]);

  useEffect(() => {
    localStorage.setItem("right-panel-open", String(bag.rightOpen));
  }, [bag.rightOpen]);

  const [chatSearchOpen, setChatSearchOpen] = useState(false);
bag.chatSearchOpen = chatSearchOpen as typeof bag.chatSearchOpen; bag.setChatSearchOpen = setChatSearchOpen as typeof bag.setChatSearchOpen;

  /* ⛔ 缩到最窄档（≤640px）时顶栏 🔍 会被 CSS 隐藏（10-11 用户令「这一排图标按窗口大小自适应隐藏，
     搜索也一起收」）⇒ 必须**同时逻辑关掉状态**：只藏按钮而面板还开着，用户就再也点不掉它
     （与 `.ctx-menu` 同款死角，守卫【250】钉的那条范式）。 */
  useEffect(() => {
    const NARROW = window.matchMedia("(width<=640px)");
    if (NARROW.matches) { setChatSearchOpen(false); return; }
    const onChange = (event: MediaQueryListEvent) => { if (event.matches) setChatSearchOpen(false); };
    NARROW.addEventListener("change", onChange);
    return () => NARROW.removeEventListener("change", onChange);
  }, [chatSearchOpen]);

  const [chatSearchQuery, setChatSearchQuery] = useState("");
bag.chatSearchQuery = chatSearchQuery as typeof bag.chatSearchQuery; bag.setChatSearchQuery = setChatSearchQuery as typeof bag.setChatSearchQuery;

  const [chatSearchIndex, setChatSearchIndex] = useState(0);
bag.chatSearchIndex = chatSearchIndex as typeof bag.chatSearchIndex; bag.setChatSearchIndex = setChatSearchIndex as typeof bag.setChatSearchIndex;

  const [chatSearchHistoryOpen, setChatSearchHistoryOpen] = useState(false);
bag.chatSearchHistoryOpen = chatSearchHistoryOpen as typeof bag.chatSearchHistoryOpen; bag.setChatSearchHistoryOpen = setChatSearchHistoryOpen as typeof bag.setChatSearchHistoryOpen;

  const [chatSearchHistory, setChatSearchHistory] = useState<string[]>(() => {
    try { const raw = localStorage.getItem("chat-search-history"); return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
  });
bag.chatSearchHistory = chatSearchHistory as typeof bag.chatSearchHistory; bag.setChatSearchHistory = setChatSearchHistory as typeof bag.setChatSearchHistory;

  const chatSearchRef = useRef<HTMLInputElement>(null);
bag.chatSearchRef = chatSearchRef as typeof bag.chatSearchRef;

  const chatSearchHistoryRef = useRef<HTMLDivElement>(null);
bag.chatSearchHistoryRef = chatSearchHistoryRef as typeof bag.chatSearchHistoryRef;

  const chatSearchResults = useMemo(() => {
    if (!bag.chatSearchOpen || !bag.chatSearchQuery.trim()) return [] as { turnId: string; itemId: string; type: string; text: string }[];
    const q = bag.chatSearchQuery.trim().toLowerCase();
    return collectMessageTexts(bag.thread).filter((m) => m.text.toLowerCase().includes(q));
  }, [bag.chatSearchOpen, bag.chatSearchQuery, bag.thread]);
bag.chatSearchResults = chatSearchResults as typeof bag.chatSearchResults;
  return { chatSearchOpen, setChatSearchOpen, chatSearchQuery, setChatSearchQuery, chatSearchIndex, setChatSearchIndex, chatSearchHistoryOpen, setChatSearchHistoryOpen, chatSearchHistory, setChatSearchHistory, chatSearchRef, chatSearchHistoryRef, chatSearchResults };
}
