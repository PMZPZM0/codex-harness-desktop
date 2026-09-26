/**
 * usePart04b1 —— usePart04b 按序切分出的第 1 段（纯搬迁、零改写）。
 * 域：钩子事件回填/底部状态/resizeObserver — 聊天搜索与其历史
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant } from "../../../../../components/scroll-utils";
import { admitThreadRuntimeRef, applyThreadEvent, armSendAnimationClaim, builtinCommandCatalog, collectKnownPaths, collectMessageTexts, createInlineAttachmentChip, groupThreadsByTime, hydrateTurnUserMessage, isDeltaMethod, jumpToTurn, loadThreadEffort, loadThreadModel, loadThreadPermissions, loadThreadRuntime, loadThreadRuntimeRaw, locateMatchEl, matchSkillCatalog, mergeLongerStreams, mergeTurn, modelName, normSkillName, ownRuntimeWrites, parseTeamMemberTitle, pickRunPhrase, pickRunPhraseExact, pluginDisplayName, prettifyHookLabel, reasoningStart, resolveThreadModel, resumeThreadWithTurns, sandboxMode, sandboxPolicy, saveThreadEffort, saveThreadModel, saveThreadPermissions, saveThreadRuntime, shortSkillName, skillZhNote, slashCommands, subAgentTools, threadApprovalOf, threadContentChanged, threadSandboxOf, threadStreamMethods, timeAgo, usageCounterSnapshot, writeThreadRuntimeMirror } from "../../../../app-view/helpers";
import type { Bag } from "../../bag-types";

export function usePart04b1(bag: Bag) {
  // Hook 注入反馈：静默记录到回合徽标（不产生系统卡），最新回复 footer 末尾展示小钩子图标
  function addHookEvent(running: boolean, hookName: string) {
    // label 供展示（事件中文名+序号）；配对仍用原始 hookName（含路径，保证 started/completed 对上）
    const label = prettifyHookLabel(hookName);
    bag.setHookPulse((current) => ({
      count: running ? current.count + 1 : current.count,
      hooks: current.hooks.some((entry) => entry.name === hookName)
        ? current.hooks.map((entry) => entry.name === hookName ? { name: hookName, label, done: !running } : entry)
        : [...current.hooks, { name: hookName, label, done: !running }],
      at: Date.now(),
    }));
  }
bag.addHookEvent = addHookEvent as typeof bag.addHookEvent;

  useEffect(() => { bag.threadRef.current = bag.thread; }, [bag.thread]);

  // 自定义命令展开后的待发送文本：runSlashCommand 命中 .md 模板后放入，send() 直接消费
  const pendingCommandTextRef = useRef<string | null>(null);
bag.pendingCommandTextRef = pendingCommandTextRef as typeof bag.pendingCommandTextRef;

  // 回到底部按钮：内容可滚动且当前视口距底部超过一屏的 25% 时出现
  // 缓存 update，供「内容变化」时直接调用而不必重建监听器
  const updateBottomStateRef = useRef<() => void>(() => {});
bag.updateBottomStateRef = updateBottomStateRef as typeof bag.updateBottomStateRef;

  // ⛔ 全白第二根因（09-15 截图3：滚到底后整片白）：冷加载时 content-visibility 的回合段
  // 初始 0 高，滚到底 = 视口停在「空白扩展区」；随后各段回填真实高度，内容全在视口上方。
  // ResizeObserver 必须盯**各回合组**（盯 .timeline 自身无效——scrollHeight 变化不触发它）：
  // 回填时组盒子高度突变会触发 RO，贴底模式下把视口拉回新的内容底部。钉顶模式不干预。
  const turnResizeObserverRef = useRef<ResizeObserver | null>(null);
bag.turnResizeObserverRef = turnResizeObserverRef as typeof bag.turnResizeObserverRef;

  /** 上一次 update() 结束时记下的「内容底部 / 视口位置 / 当时是否贴底」。
   *  唯一用途：识别**内容变矮**（折叠/收起）并在变矮前确实贴底时把视口跟着上移
   *  —— 否则折叠会在下方撑出一片空白且不会自动消失（用户 09-23 实报，详见 update 里注释）。
   *  只在本 hook 内部使用，不进 bag（不是跨段共享状态）。 */
  const lastBottomRef = useRef<{ cb: number; top: number; atBottom: boolean } | null>(null);
bag.lastBottomRef = lastBottomRef as typeof bag.lastBottomRef;

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = bag.scrollRef.current;
      if (!el || bag.anchorTopRef.current || !bag.stickToBottomRef.current) return;
      el.scrollTop = bag.contentTailTarget(el);
    });
    bag.turnResizeObserverRef.current = ro;
    return () => { ro.disconnect(); bag.turnResizeObserverRef.current = null; };
  }, [bag.scrollRef, bag.contentTailTarget]);

  /** 「用户接管视口」的统一入口（由 update effect 里的 `releaseToUser` 注入）。
   *  给 JSX 侧用：任何要打断钉顶/跟随的按钮都必须走它，**不许直接写 anchorTopRef** ——
   *  直接写会漏掉 pinGapLocked / pinFix / pinThreadId / pinDormantSeen 的复位，
   *  留下"半死"的锚定状态（09-13 审计发现「回到底部」按钮就是这么写的）。 */
  const releaseToUserRef = useRef<(why: string) => void>(() => {});
bag.releaseToUserRef = releaseToUserRef as typeof bag.releaseToUserRef;

  useEffect(() => {
    const scroller = bag.scrollRef.current;
    if (!scroller) return;
    let lastTop = scroller.scrollTop; // 供 update 识别「指针拖拽期间的位置变化」
    let pointerDown = false;
    // 本 effect 与 [thread?.id, scrollRef] 绑定，所以这里捕获的就是"当前显示的会话"：
    // 钉顶休眠在别的会话上时，跟随/贴底都按普通模式走（见 update 里的 gate）。
    const myThreadId = bag.thread?.id ?? null;
    /** 最近一次打字机揭示（codex:packet-reveal）的时刻。⛔ 09-23 深夜实锤（真机回合打点）：
     *  过程段自动折叠是 ~240ms 的 grid-rows 过渡动画，动画**每帧**都让内容变矮一点 ——
     *  若 pin-shrink-follow 在流式期间逐帧追这个收缩，会和正在增长的内容互抢视口：
     *  实测一次回合里视口被拖上去两轮（top 2461→2270、2684→2472）、再被流式推回来
     *  （gap 137→44→-110→-520）—— 用户看到的「一会在上、一会在下」就是它。
     *  ⇒ 折叠收缩若发生在流式期间（1.2s 内有揭示）**不追**：文字马上会把缺口长回来，
     *    追了必抖；只有流式已停（>1.2s 无揭示）的折叠才一次性贴合（保留 09-23「折叠后
     *    缝隙要消」的诉求 —— 那种场景 transitionend 会触发 update，这里照样接得住）。 */
    let lastRevealAt = 0;
    /** 用户接管视口：钉顶与贴底一起让位，并撤掉锚顶留白。
     *  **只能被真实用户输入调用**（滚轮/触摸/键盘翻页/指针拖拽）——这是设计上的唯一解除信号。 */
    const releaseToUser = (why: string) => {
      bag.dbg("release:" + why, { top: Math.round(scroller.scrollTop), was: bag.anchorTopRef.current ? "pin" : bag.stickToBottomRef.current ? "stick" : "none" });
      if (!bag.anchorTopRef.current && !bag.stickToBottomRef.current) return;
      bag.stickToBottomRef.current = false;
      bag.anchorTopRef.current = false;
      bag.pinnedScrollTopRef.current = -1;
      bag.clearAnchorPad();
    };
    // ⚠️ 距底一律按**内容底部**算（不含尾部留白）：若用 scrollHeight，钉顶/跟随把视口停在
    // 内容底部时 dist 仍等于留白高度（compact 64px）→「到底了」判定永远不成立，
    // 贴底跟随再也开不回来（09-12：切换会话后跟随失效就是这么来的）。
    const contentBottom = () => bag.contentBottomOf(scroller);
    /** ★ 锚定留白收缩（09-15）：内容越长，留白越小，**只减不增**。
     *  为什么需要：首帧算出的留白是「让锚点能落到 36px」所需的量；agent 回复长起来后，
     *  内容本身就撑出了可滚空间 —— 此时若留白不变，底部就会多出一大段空白，
     *  用户「怎么滚都没到真底」（实测反馈）。收缩后：留白只补"还不够滚"的缺口，
     *  滚到底 = 内容底部贴住视口底 = **真底**，下方只剩 .timeline 自己的 padding。
     *  为什么只减不增：内容只会变长（收缩方向单一），回增就等于制造新的 scrollHeight
     *  突变源（与 content-visibility 那个闪烁同类）。
     *  收缩目标与首帧同一公式：pad 使「滚到底时 gap == ANCHOR_TOP_OFFSET_PX」成立。 */
    const shrinkAnchorPad = () => {
      const pad = bag.anchorSpacerRef.current;
      const anchorEl = bag.anchorElRef.current;
      const applied = bag.anchorPadAppliedRef.current;
      if (!pad || !anchorEl || applied == null) return;
      if (!anchorEl.isConnected) return;
      const anchorTopScroll = anchorEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const scrollHeightNoPad = scroller.scrollHeight - pad.offsetHeight;
      const need = Math.max(0, Math.round(anchorTopScroll - scrollHeightNoPad + scroller.clientHeight - bag.ANCHOR_TOP_OFFSET_PX));
      if (need >= applied) return;              // 只减不增
      const px = need + "px";
      if (pad.style.height !== px) pad.style.height = px;
      bag.anchorPadAppliedRef.current = need;
      // ⛔ 09-19 诊断打点：留白被"收缩过头"时 pin 的纠偏必然被 maxScroll 钳死
      //    （真机实测：收缩后 pad 只剩 8px、消息停在 289px、pin-fix err 一路涨到 253）。
      //    这行把公式的**全部输入**落进 __adbg，下次再出现直接看数字，不用猜：
      //    `off`（pad 实际渲染高度）与 `applied`（我们以为的高度）不一致 = 公式被读偏。
      bag.dbg("pad-shrink", {
        need, applied, off: pad.offsetHeight, style: pad.style.height,
        sh: scroller.scrollHeight, ch: scroller.clientHeight, max: Math.round(scroller.scrollHeight - scroller.clientHeight),
        ast: Math.round(anchorTopScroll), top: Math.round(scroller.scrollTop),
        aCls: String(anchorEl.className || "").slice(0, 30),
      });
      // 留白变小会改变 scrollHeight → 重新量一次钉顶落点，保证 gap 仍等于 36。
      // 注意：必须走 selfScrollUntil 抑制窗，否则这次程序滚动会被当成"用户滚动"。
      const gapErr = (anchorEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - bag.ANCHOR_TOP_OFFSET_PX;
      if (Math.abs(gapErr) > 1) {
        bag.selfScrollUntilRef.current = Date.now() + 80;
        scrollToOffsetInstant(scroller, scroller.scrollTop + gapErr);
        bag.pinnedScrollTopRef.current = scroller.scrollTop;
      }
    };
    const update = () => {
      shrinkAnchorPad();
      const cb = contentBottom();
      const prevBottom = lastBottomRef.current;
      try {
        const dist = cb - scroller.scrollTop - scroller.clientHeight;
      // ── 钉顶期间的自动跟随：**一条规则 + 一个步长**（09-13 定稿，09-15 调门槛）──
      //   规则：「内容超出视口多少，就把视口往下补多少」——
      //     · 没超出（短回复）→ 一动不动，消息稳在落点；
      //     · 接近/超出视口底 → 补到最新一行贴着视口底 = 自动跟随。
      //   同一时刻只有一条成立，所以**结构上不可能**出现"跟随往下推、钉顶往回拉"的互拉。
      //   ⛔ 门槛（09-15 用户口径「长消息没到输入框上面两行就不要触发跟随」）：
      //   原实现是 `dist > 48`（要**超出**底部 48px 才跟）→ 最新一行先被挡住两行才追，
      //   表现为"触发晚了"。现在改为 `dist > -48`：**距底还有两行（48px）就开始跟**，
      //   让最新一行始终不被输入框附近遮住。
      //   步长仍是 48px：打字机末行逐字重排，逐帧跟随会让视口每帧都动（09-13 实测
      //   「长消息换行跟自动跟随在抢」）；攒够约两行再整体跟一次，两次之间视口完全静止。
      const FOLLOW_STEP_PX = 48;
      // 只在自己这条会话上跟随：钉顶可能正"休眠"在另一条会话上（切走又没切回来），
      // 那种情况下这里必须走常规贴底逻辑，不能拿别人的锚定模式去动当前视口。
      // ⛔ 归属**未知**（null）要按"属于自己"处理：anchorTopRef 只在本会话发送时被置真，
      //   所以 null 只可能出现在"刚发送、真实回合 id 还没回来"这一小段。若把它当外人，
      //   自动跟随会在整段回复里不启动（09-18 实测：top 恒 0、内容底部停在视口外）。
      const pinMine = bag.anchorTopRef.current && (bag.pinThreadIdRef.current === null || bag.pinThreadIdRef.current === myThreadId);
      /** 相对上次 update，内容底部**变矮**了多少（> 0 = 变矮）。
       *  折叠思考卡 / 收起工具卡 / 过程块合并都会让内容一次性变矮。 */
      const shrankBy = prevBottom ? prevBottom.cb - cb : 0;
      if (pinMine) {
        // ⛔ 09-26 用户定稿：**交棒之前**（钉顶期）跟随/贴合只看**正文**（bodyBottomOf，扣除
        //    展开中的思考卡）—— 思考板块把内容撑满一屏**不许**取消钉顶（思考卡有自己的
        //    内部滚动）；正文满一屏才交棒给跟随。
        const bodyDist = bag.bodyBottomOf(scroller) - scroller.scrollTop - scroller.clientHeight;
        // ⛔ 09-26 用户截图：**交棒之后**（锚点消息早已滚出视口、跟随接管）新思考卡必须跟 ——
        //    此时钉顶稳定已无意义，判据回到**全量** dist。不分相位的代价两头翻车：
        //    要么思考在跟随期不跟（本轮截图：新思考卡被窗口底裁掉），要么思考在钉顶期
        //    取消钉顶（上午的事故）。交棒信号 = gap 锁（pinSentMessage 在正文超屏时落锁）。
        const handedOver = bag.pinGapLockedRef.current !== null && bag.pinGapLockedRef.current === bag.pinnedAnchorKeyRef.current;
        const followDist = handedOver ? dist : bodyDist;
        /** ★ 钉顶期间「内容变矮」也要立刻贴合（09-23 用户报「思考板块折叠后，缝隙也跟着效果」）。
         *  为什么单独加这条：下面那条跟随**只往下补**（`scrollTop + dist`，步长 48 是为打字机
         *  逐字重排的抖动设计的），永远不会把视口**拉上来** —— 于是回合运行中折叠思考卡后，
         *  内容底部上方就留一条缝，而且再也不会自己消掉。
         *  收缩方向没有抖动风险（内容是一次性变矮，不是逐帧增长），所以立即贴合；
         *  增长方向仍走原来的 48px 步长逻辑，一个字都不改。
         *  ⛔ 交棒前只在**正文**超出一屏时接手（09-26 同上）：正文不足一屏时钉顶要把锚点放在
         *     54px，那是钉顶的职责 —— 思考折叠后内容缩回一屏内，这里让位，pin-fix 自然把消息
         *     拉回落点（那不是「钉顶丢了」，恰恰是用户要的稳定）；交棒后看全量。
         *  ⛔⛔ 流式期间**不追**（09-23 深夜打点实锤的「上下翻转」根因）：折叠动画的每一帧
         *     都算一次「变矮」，逐帧追 = 与流式增长互抢视口。1.2s 内有揭示就跳过 ——
         *     缺口由随后的文字增长自动填平；流式停了才贴合（见 lastRevealAt 注释）。 */
        if (prevBottom && shrankBy > 1 && followDist > 0 && Date.now() - lastRevealAt > 1200) {
          const want = bag.contentTailTarget(scroller);
          if (Math.abs(want - scroller.scrollTop) > 1) {
            bag.selfScrollUntilRef.current = Date.now() + 80;
            scrollToOffsetInstant(scroller, want);
            bag.pinnedScrollTopRef.current = scroller.scrollTop;
            bag.dbg("pin-shrink-follow", { from: Math.round(prevBottom.cb), to: Math.round(cb), top: Math.round(scroller.scrollTop) });
          }
          lastTop = scroller.scrollTop;
          return;
        }
        if (followDist > -FOLLOW_STEP_PX) {
          // 目标：把「内容底部」补到视口底（dist 归 0），而不是把内容整体推上去。
          // dist ≤ 0（还有余量）时不动，避免短回复也被推。
          if (followDist > 0) {
            bag.selfScrollUntilRef.current = Date.now() + 80;
            scrollToOffsetInstant(scroller, scroller.scrollTop + followDist);
            bag.pinnedScrollTopRef.current = scroller.scrollTop;
          }
          lastTop = scroller.scrollTop;
          return;
        }
      }
      /** ★ 内容**高度变了**、而用户正跟着底部 ⇒ 把内容底部重新贴回视口底（09-23）。
       *  修的用户原话：「思考会把底部撑出来这么空白，他折叠之后，这个没有自动消失」。
       *
       *  为什么必须有这一条：非钉顶路径下，update() 对「内容高度变化」**什么都不做** ——
       *  它只按 `dist` 往下补，而折叠/展开后的 dist 是个固定的残留值，谁也不会去消它。
       *  原本指望 `.turn-group` 上的 ResizeObserver 兜住（见上方 observer），实测**靠不住**：
       *  视口外的回合被 `content-visibility: auto` 跳过（内部变化根本不做布局 ⇒ 不触发 RO），
       *  观察名单也可能没覆盖到新出现的回合组。真机实测（完成态、折叠一张视口内的思考卡）：
       *  折叠后 scrollHeight 3188 / scrollTop 2197 / max 2589 ⇒ 可视空白 **280px**，
       *  且因为 `dist > 25% 视口` 紧接着把 stick 关掉，此后再无自动恢复，手动滚一下才回来。
       *
       *  判据 = 「内容底部相对上次 update 变了」+「用户正跟着底部（stick）」：
       *   · 高度变化 ⇒ 布局真的动了（滚动本身不会让 cb 变，它只改 scrollTop）；
       *   · stick ⇒ 用户没有主动离开底部（往上滚/触摸/翻页会经 releaseToUser 置假），
       *     所以他期望"最新内容继续贴住输入框上方"，这正是折叠前的位置关系。
       *  ⛔ 只在**非钉顶**时接手（钉顶有自己的步长跟随，见上一条），避免两个 owner 互拉。
       *  ⛔ 不引入任何"用户意图"启发式（09-12 已证那套不可靠，勿加回来）。 */
      else if (prevBottom && Math.abs(cb - prevBottom.cb) > 1 && bag.stickToBottomRef.current) {
        const want = bag.contentTailTarget(scroller);
        if (Math.abs(want - scroller.scrollTop) > 1) {
          bag.selfScrollUntilRef.current = Date.now() + 80;
          scrollToOffsetInstant(scroller, want);
          bag.pinnedScrollTopRef.current = scroller.scrollTop;
          bag.dbg("height-follow", { from: Math.round(prevBottom.cb), to: Math.round(cb), top: Math.round(scroller.scrollTop) });
        }
        lastTop = scroller.scrollTop;
        return;
      }
      // 程序滚动的抑制窗内：只刷新基线，不做方向判定（否则自己的钉顶/贴底
      // 会被当成用户滚动，误解除钉顶——09-12 调试探针实锤）
      if (Date.now() < bag.selfScrollUntilRef.current) { lastTop = scroller.scrollTop; return; }
      // ⛔ 09-26：钉顶期间这颗旗必须为假 —— 「回到底部」按钮的 onClick 会 releaseToUser
      //    （解除钉顶），若按全量 dist 置真，思考流式撑长内容就会把按钮顶出来 = 思考
      //    从侧门取消了钉顶。钉顶期视口归钉顶 owner 管（旧代码 dist > -48 提前 return
      //    走不到这里，效果等同；bodyBottomOf 改判据后这里变为可达，必须显式挡住）。
      bag.setAwayFromBottom(!bag.anchorTopRef.current && dist > scroller.clientHeight * 0.25);
      // 迟滞：距底 ≤4px 重新开启跟随；>25% 视口才关闭。中间地带保持原状，
      // 避免流式内容增高时 stick 反复翻转（此前 smooth 滚动动画的中间滚动事件
      // 会误关跟随，导致"消息发了不显示、停止后才出现"）。
      // ⚠️ 钉顶进行中不许把 stick 置真（09-13 审计）：(anchor=true, stick=true) 会同时成立，
      // 而不同消费者对这对标志的解释不一致（有的看 `stick && !anchor`、有的只看 stick）
      // → 同一状态在不同路径行为不同 = "有时跳有时不跳"，调阈值救不了。
      if (dist <= 4 && !bag.anchorTopRef.current) bag.stickToBottomRef.current = true;
      else if (dist > scroller.clientHeight * 0.25) bag.stickToBottomRef.current = false;
      // ⛔ 这里**不再**用「scrollTop 方向」猜用户意图（09-12 拆除，勿加回来）。
      // 那套启发式的实测结局：钉顶落点与记录值差 13px（浏览器 clamp / 内容重排造成，
      // 不是用户操作）→ byUs 判定失败 → 紧接着流式内容长高让 scrollTop 增大 → 被当成
      // 「用户滚到底」→ 钉顶自杀、留白归零、视口掉回内容底部。用户看到的就是
      // 「发送后消息不在那个位置」「上下弹跳」。判据本身不可靠，任何阈值都救不了。
      // 现在只有**真实用户输入**（滚轮 / 触摸 / 拖拽 / 键盘翻页）能解除，见下方监听器。
      // 拖拽/框选（指针按下期间产生的滚动）也算用户操作：
      if (pointerDown && Math.abs(scroller.scrollTop - lastTop) > 2) releaseToUser("drag");
      lastTop = scroller.scrollTop;
      } finally {
        // 记账供下一次 update 判断「内容高度是否变过」（见上方 height-follow）。
        // 用 finally 是因为 update 有多处提前 return，漏记一处下次判据就失真。
        const now = contentBottom();
        lastBottomRef.current = { cb: now, top: scroller.scrollTop, atBottom: now - scroller.scrollTop - scroller.clientHeight <= 4 };
      }
    };
    // ── 唯一 owner 的解除信号：真实用户输入 ──
    // 为什么必须按输入事件判而不是按 scroll 事件判：流式内容增长、浏览器 clamp、
    // content-visibility 重排都会让 scrollTop 自己动，从 scroll 事件里无法区分
    // 「用户滚的」和「内容/浏览器弄的」。输入事件没有这个问题。
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) releaseToUser("wheel-up");
    };
    const onTouchMove = () => releaseToUser("touch");
    const onKeyDown = (event: Event) => {
      const key = (event as unknown as { key?: string }).key ?? "";
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(key)) releaseToUser("key");
    };
    const onPointerDown = () => { pointerDown = true; };
    const onPointerUp = () => { pointerDown = false; };
    bag.updateBottomStateRef.current = update;
    bag.releaseToUserRef.current = releaseToUser;
    // rAF 节流：scroll 事件密集时 update 会读 scrollHeight/scrollTop 强制同步布局
    let raf = 0;
    const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; update(); }); };
    update();
    // 绑定只跟会话走：若依赖 thread，流式出字每帧都会销毁重建 ResizeObserver + 监听器，
    // 长回复下纯粹是白烧帧预算。内容变化走下方独立的 effect 调用 update。
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    /* ★ 折叠/展开的高度过渡结束时重算一次底部状态（09-23）。
       为什么需要它：折叠块（`.wb-fold-content`）的高度是 **grid-template-rows 过渡**，
       而折叠会让内容**变矮** ⇒ 需要 update() 跟着把视口上移（见 update 里的 shrink-follow）。
       实测 `.turn-group` 上的 ResizeObserver 并不能可靠覆盖这一刻：视口外的回合被
       `content-visibility: auto` 跳过（内部变化不触发布局），观察列表也可能没覆盖到
       新出现的回合组 ⇒ 折叠后一次 update 都不跑，空白就一直留着。
       这里只认 `grid-template-rows`（折叠/展开的专属属性），其它过渡（hover、透明度、
       transform…）不理会，避免无谓的强制同步布局。 */
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === "grid-template-rows") schedule();
    };
    scroller.addEventListener("transitionend", onTransitionEnd);
    scroller.addEventListener("wheel", onWheel, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    scroller.addEventListener("keydown", onKeyDown);
    const onPacketReveal = () => requestAnimationFrame(() => {
      lastRevealAt = Date.now();
      update();
      // 钉顶模式下绝不抢滚动条：打字机揭示每帧都触发这里，若此时还贴底跟随，
      // 两个滚动驱动互相拉扯 = 出字来回闪（09-12 调试探针实锤）
      if (bag.stickToBottomRef.current && !bag.anchorTopRef.current) {
        // 瞬时贴底（behavior:"auto" 会被 .timeline 的 CSS smooth 变成动画，与下次
        // 揭示互相 retarget = 出字闪烁）；钉顶模式下 stick=false 不会进这里
        bag.selfScrollUntilRef.current = Date.now() + 80;
        scroller.style.scrollBehavior = "auto";
        scroller.scrollTop = bag.contentTailTarget(scroller);
        scroller.style.scrollBehavior = "";
      }
    });
    window.addEventListener("codex:packet-reveal", onPacketReveal);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("transitionend", onTransitionEnd);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      scroller.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("codex:packet-reveal", onPacketReveal);
    };
  }, [bag.thread?.id, bag.scrollRef]);
  return { addHookEvent, pendingCommandTextRef, updateBottomStateRef, turnResizeObserverRef, releaseToUserRef };
}
