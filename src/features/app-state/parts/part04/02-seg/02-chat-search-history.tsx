/**
 * usePart04b2 —— usePart04b 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：钩子事件回填/底部状态/resizeObserver — 聊天搜索与其历史
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant } from "../../../../../components/scroll-utils";
import { HIGHLIGHT_CACHE } from "../../../../../lib/highlight-cache";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
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
      if (remembered !== null) {
        bag.stickToBottomRef.current = false;
        scrollToOffsetInstant(el, Math.max(0, el.scrollHeight - el.clientHeight - remembered));
        bag.updateBottomStateRef.current?.();
        return;
      }
      bag.stickToBottomRef.current = true;
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

  useEffect(() => {
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
