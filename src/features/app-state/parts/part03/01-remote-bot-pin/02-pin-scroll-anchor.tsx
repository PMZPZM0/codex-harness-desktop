/**
 * usePart03a2 —— usePart03a 按序切分出的第 2 段（纯搬迁、零改写）。
 * 域：机器人/远程通道 · 钉顶几何与滚动锚
 *
 * ⛔ 顺序即契约：段内含 hook 调用，React 靠**调用顺序**绑定 state ⇒ 组合根必须按文件名前缀顺序调用。
 * ⛔ 本段语句只引用「自己的局部声明」与 bag；跨段名字由组合根按入参转交。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import "@xterm/xterm/css/xterm.css";
import { contentOffsetTop, jumpToBottom, scrollToOffsetInstant } from "../../../../../components/scroll-utils";
import type { Bag } from "../../bag-types";

export function usePart03a2(bag: Bag) {
  /** 解除锚顶/贴底接管时的收尾：把锚顶留白归零，否则会残留一屏空白。 */
  const clearAnchorPad = useCallback(() => {
    const pad = bag.anchorSpacerRef.current;
    if (pad) pad.style.height = "0px";
    bag.anchorPadAppliedRef.current = null;
  }, []);
bag.clearAnchorPad = clearAnchorPad as typeof bag.clearAnchorPad;

  /** 内容底部（详见 `contentBottomOf`）：所有"滚到底 / 跟随到最新"的基准，**不含尾部留白**。
   *  用 `scrollHeight` 会把 compact / anchor-pad 留白算成内容 → "到底"= 滚进留白 →
   *  切回会话时用户消息被切在视口顶、下方一大片空白（09-12 用户截图实锤）。 */
  const compactSpacerRef = useRef<HTMLDivElement | null>(null);
bag.compactSpacerRef = compactSpacerRef as typeof bag.compactSpacerRef;

  /** 内容底部的滚动坐标（**不含**尾部留白）。留白高度一变（回合结束撤 compact、
   *  钉顶撑 anchor-pad）都不影响它，所以它才是稳定的"最新内容在哪"。
   *  算法 = `scrollHeight − Σ 留白高度`：两个留白都是**纯空白**元素，扣掉它们的总高度
   *  正好得到最后一个真实元素（回合 / 排队气泡 / 处理中行）的底边；不需要额外插哨兵节点，
   *  也就不必改 `.timeline` 的子元素顺序。 */
  const contentBottomOf = useCallback((el: HTMLElement) => {
    const blank = (bag.compactSpacerRef.current?.offsetHeight ?? 0) + (bag.anchorSpacerRef.current?.offsetHeight ?? 0);
    return el.scrollHeight - blank;
  }, []);
bag.contentBottomOf = contentBottomOf as typeof bag.contentBottomOf;

  /** 「最新内容」应有的 scrollTop：内容底部贴到视口底，再留 CONTENT_TAIL_GAP_PX 呼吸位。 */
  const contentTailTarget = useCallback((el: HTMLElement) => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, Math.min(bag.contentBottomOf(el) - el.clientHeight + bag.CONTENT_TAIL_GAP_PX, max));
  }, [bag.contentBottomOf]);
bag.contentTailTarget = contentTailTarget as typeof bag.contentTailTarget;

  /** ★ 发送锚顶的唯一 owner：把「本次发送的那条用户消息」放到对话区顶部往下
   *  ANCHOR_TOP_OFFSET_PX 处，并让它一直待在那儿（位置由本函数 + update() 的
   *  增量跟随共同维持，二者不会互相抢：跟随只补增长量，gap 因此恒等于 54）。
   *
   *  为什么锚点取**真实 `.user-message` 元素**而不是 `#chat-anchor`（09-12 根因）：
   *  `#chat-anchor` 挂在回合列表**末尾**（在真实回合组之后），它的 top 并不等于用户
   *  消息的 top —— 一旦真实回合组里已经有内容，按它钉出来就是错的（实测连发第 2 条
   *  gap=418）。真实消息元素才是"那条消息"本身。
   *
   *  为什么要**实测校验**（`gapErr`）而不是只信一次计算：锚点会从乐观气泡换成真实消息、
   *  上游渲染时序也会变，任何一次算错的落点如果没人纠正就会一直错下去（这就是这一天
   *  反复出现"位置不对"的机制）。这里每次调用都量一次实际 gap，偏差 > 4px 才一次性
   *  修正；正常情况下偏差为 0，校验不触发，所以不会跟跟随打架。 */
  const pinSentMessage = useCallback((el: HTMLElement, threadId?: string | null) => {
    // 锚点 = 最后一个回合组里的真实用户消息（前提：这个回合是本次发送新建的，
    // 即不在发送前的回合基线里）；还没有真实消息时退回乐观气泡。
    const groups = el.querySelectorAll<HTMLElement>(".turn-group");   // 只在时间线子树里查（全文档查一次几万节点）
    const lastGroup = groups[groups.length - 1];
    const baseline = bag.optimisticBaselineRef.current;
    const lastId = lastGroup?.id?.startsWith("turn-") ? lastGroup.id.slice(5) : "";
    const isNewTurn = Boolean(lastId) && !(baseline.threadId && baseline.turnIds.has(lastId));
    let anchor: HTMLElement | null = null;
    // ⛔ 锚点必须是「**本次发送的那条真实消息**」，不能退回挂在时间线**末尾**的乐观气泡。
    // 为什么（用户实测：「我排队消息点立即发出去了，Codex发出来的消息还在我消息上面运行呢」）：
    // 「立即」走 `turn/steer`，引擎的后续输出是**追加进那个已有回合组**里的，而乐观气泡在
    // 所有回合组**之后** —— 钉住气泡就等于把视口钉在"回合内容的后面"，于是后续输出出现在
    // 气泡（= 用户消息）**上方**。取组内**最后一条** `.user-message` 才是刚发的那条：
    //   · 正常发送 → isNewTurn 为真，组里只有这一条，取最后一条 = 同一条；
    //   · steer    → 不是新回合，但组里有多条 user message，最后一条正是刚注入的这条。
    const userMessages = lastGroup ? [...lastGroup.querySelectorAll<HTMLElement>(".user-message")] : [];
    const lastUserMessage = userMessages[userMessages.length - 1] ?? null;
    // 取真实消息的三个条件（任一成立即可，互为兜底）：
    //  ① isNewTurn —— 正常发送：这个回合是本次新建的；
    //  ② userMessages.length > 1 —— steer 把消息补进已有回合（组里有多条）；
    //  ③ 气泡已经不在 —— 兜底：此时再退回 `#chat-anchor` 必然 `pin-miss`，视口会掉回贴底
    //     （实测「打断 + 新回合」路径：queue/start 已经建好新回合、thread 先更新，基线因此
    //      包含了它 → ① 判假；组里又只有一条 → ② 判假；气泡已被确认卸载 → 掉回贴底 gap=359）。
    const bubble = document.getElementById("chat-anchor");
    if (lastUserMessage && (isNewTurn || userMessages.length > 1 || !bubble)) anchor = lastUserMessage;
    if (!anchor) anchor = bubble;
    if (!anchor || !anchor.isConnected) { bag.dbg("pin-miss", { isNewTurn, users: userMessages.length }); return false; }
    const anchorH = anchor.getBoundingClientRect().height;
    // 用户消息自身超过一屏 → 钉顶没有意义（整条装不下），直接让用户看到回复
    if (anchorH > el.clientHeight) {
      bag.dbg("clear-anchor", { at: "long:msg", h: Math.round(anchorH), ch: el.clientHeight });
      bag.anchorTopRef.current = false;
      bag.clearAnchorPad();
      bag.stickToBottomRef.current = true;
      bag.selfScrollUntilRef.current = Date.now() + 80;
      scrollToOffsetInstant(el, bag.contentTailTarget(el));
      bag.pinnedScrollTopRef.current = el.scrollTop;
      return true;
    }
    // 留白固定给**一整屏**：保证「锚点滚到顶部」这个目标永远可达（不依赖锚点高度，
    // 也就不用随锚高反复改高度 → 没有新的 scrollHeight 突变源）。
    // ⛔ 09-14 三次尝试把它改成条件式（内容不满一屏就归零 / 只给最小量），全部被
    //    send-anchor 验收打回：① 按 scrollHeight 判 → 滚动容器被 clientHeight 托底，
    //    判定恒真 → 留白 0↔一屏振荡（maxUp=1250 / grew=-192）；② 按 offsetTop 判 →
    //    跨越一屏阈值那一刻留白 0→一屏，scrollMax 突增 622，钉顶一次性追跳 841px
    //    （阈值 60）；③ 按需给最小量 → 「钉在顶上」在数值上等于「贴底」，判据失效。
    //    结论：**钉顶（消息固定在顶部）与「短会话没有大空白」互斥**，见 09-14 会话记录。
    // ⛔ 09-15 撤销 sticky 后按用户反馈改成「**只补缺口**」（用户实测「留白时滚轮没贴底、
    //    还能往下滚 → 留多了」）。无脑撑满一屏（pad = clientHeight）会让滚动范围多出一屏。
    //    正解 = 只补足「锚点顶不到落点」缺的那部分：
    //      留白 = 视口高 − 落点偏移 − 锚点高 − 锚点下方残留内容高
    //    推导：`.timeline` 的 padding-bottom 为 0（09-23 起 —— 真机实测它本会被算进 scrollHeight、
    //    在贴底位置留出 28px 可见空白，见 02-sidebar-threads.css 的注释），
    //    故滚到底（scrollTop = maxScroll）时锚点视口偏移 = clientHeight − pad − 锚点以下内容高；
    //    令它 == ANCHOR_TOP_OFFSET_PX 即得上式 —— **滚到底就是落点，零多余可滚空间**。
    //    ⚠️ 只在 first 分支算一次：本函数每次 thread 更新都会调用，若每帧重算，流式期间
    //    pad 高度持续变化 = 新的 scrollHeight 突变源（会抖）。归零交给 clearAnchorPad。
    // ⛔ key 必须描述「**锚点元素是谁**」，而不是「这一轮是否新回合」（09-23 钉顶回归的根因）：
    //   新回合组已建、但真实用户消息还没渲染出来的那一帧，isNewTurn 已为真而 `lastUserMessage`
    //   还是 null ⇒ 锚点落到乐观气泡（实测打点 aCls:""）。旧写法此刻就把 key 领成 `turn-…`，
    //   等真实消息渲染出来时 key 没变 ⇒ `first` 恒假 ⇒ 永远不走 first 分支 ⇒ `anchorElRef`
    //   停在随即被卸载的气泡上，气泡一卸载钉顶就被释放（实测 gap=389 / hasAnchor=false /
    //   atBottom 接管；更早的提交上同路径因时序恰好走了 first 分支才没炸 —— 竞态被时序推移暴露）。
    //   现在锚点是气泡就老实用 "opt"：真实消息渲染出来那刻 key 变化 ⇒ 必然走 first ⇒ 交接完成。
    const key = isNewTurn && anchor !== bubble ? `turn-${lastId}` : "opt";
    const gapErr = (anchor.getBoundingClientRect().top - el.getBoundingClientRect().top) - bag.ANCHOR_TOP_OFFSET_PX;
    // 「刚切回自己这条会话」= 休眠钉顶的复活：必须**当first处理**（立即落位、解除超屏锁）。
    // 否则会走下面的延帧纠偏，而切回来这一帧的几何是"脏"的（留白刚重新撑起来、scrollTop
    // 还是上一会话的），中间那一帧足以让跟随先按 dist 把视口推到内容底部 —— 实测打点：
    // pin-fix{err:214} 与跟随抢同一帧，最后停在 gap=481（用户看到的就是"切回来钉顶没了"）。
    const returned = bag.pinDormantSeenRef.current;
    if (returned) { bag.pinDormantSeenRef.current = false; bag.pinGapLockedRef.current = null; }
    // ⛔ 09-18 用户实测「切换会话切回来，运行中的钉顶效果就没了，就掉下来了」——
    //   根因在**归属变化没被当成 first**：切走时 openThread 把留白归零（别的会话不该看到
    //   这条会话的留白），切回来必须**重新撑起来**，而重撑只发生在 first 分支里。
    //   原先只靠 `returned`（pinDormantSeen，由 [thread] 布局 effect 置位）记账，链条上任何
    //   一环没跑到就恢复不了。下面改用**归属变化**这个直接事实：现在属于本会话、而上次
    //   调用属于别的会话（或还没归属）⇒ 必然要重算留白并立即落位。
    // ⛔ 归属只能用**真实 id** 写入（不能用 threadRef.current —— 它是被动 effect 里更新的，
    //   布局 effect 期间还停留在上一个会话，会记错归属）。
    // ⛔ 09-18 用户实测「长内容发送时没有自动跟随、要手动滑到底部才触发」——根因也在这条：
    //   发送瞬间的乐观阶段 `optimisticInput` 那个 layout effect 传进来的 `thread?.id`
    //   还是 null（新建会话还没建出来 / state 未更新），于是归属被写成 null；而自动跟随的
    //   入口条件是 `pinThreadIdRef.current === myThreadId`（真实 id）⇒ 恒不相等 ⇒ 钉顶
    //   期间**一次都不跟随**，要等用户自己滚到底（那走的是 releaseToUser 解除钉顶）才恢复。
    //   修法：空值不许覆盖已有归属（`threadId || 旧值`）。
    const owner = threadId || bag.pinThreadIdRef.current || null;
    const ownerChanged = Boolean(owner) && bag.pinThreadIdRef.current !== owner;
    if (ownerChanged) bag.pinGapLockedRef.current = null;
    const first = bag.pinnedAnchorKeyRef.current !== key || returned || ownerChanged;
    bag.pinnedAnchorKeyRef.current = key;
    bag.pinThreadIdRef.current = owner;
    // ⛔ 基线**只在真正钉顶/修正时**刷新，位置已经对了就一个字都不要碰它。
    // 这是「自动跟随又没了」的根因（09-13 用户截图：消息钉在顶上，正文却一路流出
    // 输入框外、最新一行永远看不到）：本函数每次 thread 更新都会被调用，若每次都把
    // 基线刷成当前内容底部，update() 里的 `growth = 内容底部 − 基线` 永远 ≈ 0，
    // 攒不到 FOLLOW_STEP_PX(60) → 跟随一次都不触发。基线必须让增长量**累积**。
    // 首次落位**立即**执行（用户要的第一时间就在那个位置）；之后的复核若发现偏差，
    // 延到下一帧再量一次才改：本帧布局常常还在收敛（content-visibility 提交、
    // 代码高亮/字体完成），照当帧 gap 直接改 scrollTop 会过冲（实测 332 → −226 → −32
    // 三次来回）。下一帧仍偏才修，一次到位。
    if (first) {
      // ★ 留白 = 只补缺口（见上文推导）：过小则顶不到落点，过大则滚轮多出一截可滚空间。
      //   目标：**滚到底时锚点正好落在 ANCHOR_TOP_OFFSET_PX**。
      //   设 anchorTopScroll = 锚点顶在滚动坐标里的位置，scrollHeightNoPad = 当前
      //   scrollHeight 扣掉本留白（＝"没有留白时会怎样"）。滚到底时
      //     gap = anchorTopScroll − (scrollHeightNoPad + pad − clientHeight)
      //   令其 == 偏移量，解出 pad。padding / 兄弟留白 / 锚点高全部自动吸收。
      //   ⚠️ 后续收缩在 update() 里做（见 `shrinkAnchorPad`），这里只负责首帧落位。
      const pad = bag.anchorSpacerRef.current;
      if (pad) {
        const anchorTopScroll = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
        const scrollHeightNoPad = el.scrollHeight - pad.offsetHeight;
        const need = Math.max(0, Math.round(anchorTopScroll - scrollHeightNoPad + el.clientHeight - bag.ANCHOR_TOP_OFFSET_PX));
        const px = need + "px";
        if (pad.style.height !== px) pad.style.height = px;
        bag.anchorPadAppliedRef.current = need;
        bag.anchorElRef.current = anchor;
      }
      // ⚠️ 改完 pad 必须**重量一次** gapErr 再落位：pad 变化直接改变 scrollHeight，
      //    用改前的 gapErr 落位会偏（这是「留白改完位置反而不对」的坑）。
      const gapErrNow = (anchor.getBoundingClientRect().top - el.getBoundingClientRect().top) - bag.ANCHOR_TOP_OFFSET_PX;
      bag.anchorHeightBaselineRef.current = bag.contentBottomOf(el);
      bag.dbg("pin-apply", { key, gapErr: Math.round(gapErrNow), pad: pad ? pad.style.height : "-", top: Math.round(el.scrollTop), max: Math.round(el.scrollHeight - el.clientHeight), aCls: String(anchor.className || "").slice(0, 30) });
      bag.selfScrollUntilRef.current = Date.now() + 80;
      scrollToOffsetInstant(el, el.scrollTop + gapErrNow);
      bag.pinnedScrollTopRef.current = el.scrollTop;
      return true;
    }
    // ★ 交棒规则（09-13 定稿，修「来回拉扯」的真正来源）：
    //   「消息稳在 54px」与「最新一行永远可见」在回复长过视口时**必然矛盾**——
    //   跟随为了露出新内容要把视口往下推，钉顶为了让 gap 恒等于 54 又要把它拉回来，
    //   两个 owner 每 60px 打一轮（实测打点：follow-grow{+65} → pin-fix{−65} 循环），
    //   用户看到的就是抖。所以：内容一旦长出视口，**钉顶停止纠偏**、位置交给跟随，
    //   消息自然往上走 —— 这正是用户要的「agent 消息很丝滑往下流、自动跟随」。
    //   短回复（未超屏）时继续纠偏，消息就稳稳待在 54px。
    const overflow = bag.contentBottomOf(el) - el.scrollTop - el.clientHeight;
    if (overflow > 4) { bag.pinGapLockedRef.current = key; return true; }
    if (bag.pinGapLockedRef.current === key) return true;
    if (Math.abs(gapErr) <= 8) return true;
    bag.anchorHeightBaselineRef.current = bag.contentBottomOf(el);
    if (bag.pinFixRef.current) cancelAnimationFrame(bag.pinFixRef.current);
    bag.selfScrollUntilRef.current = Date.now() + 200;
    bag.pinFixRef.current = requestAnimationFrame(() => {
      bag.pinFixRef.current = 0;
      if (!bag.anchorTopRef.current) return;
      // ⛔ 交棒后再动手就是抢（09-23 深夜打点实锤）：这个 rAF 排队期间内容可能已长出视口
      //    （overflow>4 ⇒ 已把位置交给跟随并锁 gap），迟到的 pin-fix 再去拉锚点 =
      //    与 pad-shrink 逐帧互踹（实测 pad 一瞬间 111→147→111 来回翻）。
      //    锁在手上就立刻退出 —— 纠偏权已不属于钉顶。
      if (bag.pinGapLockedRef.current !== null && bag.pinGapLockedRef.current === bag.pinnedAnchorKeyRef.current) return;
      // ⚠️ 归属校验（09-13 审计）：这个 rAF 可以从上一个会话挂到下一次渲染才执行，
      // 而 `el` 是跨会话不重建的 .timeline、`#chat-anchor` 此时已是**新会话**渲染的元素 ——
      // 不校验就会在新会话第一帧莫名滚一下，还会把落点记账写成别的会话的值。
      if (bag.pinThreadIdRef.current !== (threadId ?? null)) return;
      const now = (anchor.isConnected ? anchor : document.getElementById("chat-anchor")) as HTMLElement | null;
      if (!now) return;
      const err = (now.getBoundingClientRect().top - el.getBoundingClientRect().top) - bag.ANCHOR_TOP_OFFSET_PX;
      if (Math.abs(err) <= 4) return;
      let want = el.scrollTop + err;
      const max = el.scrollHeight - el.clientHeight;
      if (want > max + 1) {
        // ⛔ 09-19 用户实测「钉顶也没有」的**真根因**（真机打点复现，缺口精确对上）：
        //   收缩公式隐含假设「锚点上方的布局不变」；一旦锚点上方的高度变了（过程卡折叠 /
        //   `content-visibility` 惰性布局提交 / 上一回合的卡片收起），公式就按**旧坐标**把留白
        //   算小，缺口恰好等于那次高度变化量（实测最后一次 `pin-fix err=122` 与缺口 122px 一致）。
        //   此时落点变成"滚不到的地方"：`scrollTop` 被 maxScroll 钳死，pin-fix 每次都滚到同一个
        //   被钳住的位置、err 一路变大（21 → 59 → 100 → 284），用户看到消息停在半屏
        //   （实测 97/136/158/289px，与用户截图里的 305px 同一成因）。
        //   反证（同一次注入、只摘掉本分支）：留白 0 → 0、落点 37 → 97px、`err=284` 反复钳死；
        //   带本分支：留白 0 → 590px、落点回到 36px。
        //   ⇒ 在**发现滚不到的这一刻**把缺口还给留白（纠偏的唯一 owner 仍是这里）：
        //     还回后 scrollHeight 同步增大同样的量 ⇒ maxScroll 正好等于 want ⇒ 落点立刻可达。
        const pad = bag.anchorSpacerRef.current;
        const applied = bag.anchorPadAppliedRef.current;
        if (pad && applied != null) {
          const restore = applied + (want - max);
          pad.style.height = restore + "px";
          bag.anchorPadAppliedRef.current = restore;
          const maxAfter = el.scrollHeight - el.clientHeight;
          bag.dbg("pad-restore", { err: Math.round(err), restore, max: Math.round(max), maxAfter: Math.round(maxAfter) });
          want = Math.min(want, maxAfter);
        }
      }
      bag.dbg("pin-fix", { key, err: Math.round(err), top: Math.round(el.scrollTop), want: Math.round(want) });
      scrollToOffsetInstant(el, want);
      bag.pinnedScrollTopRef.current = el.scrollTop;
    });
    return true;
  }, [bag.clearAnchorPad, bag.contentBottomOf, bag.contentTailTarget]);
bag.pinSentMessage = pinSentMessage as typeof bag.pinSentMessage;

  /** 最近一次钉顶实际落到的 scrollTop。用于区分「程序滚动」与「用户滚到底」：
      锚顶时若锚点下方内容不足，scrollTop 会被浏览器钳到 maxScroll（= 贴底位置），
      这个「非用户意愿」的增大若被 update() 当成用户滚到底就会解除钉顶（09-12
      实测：连发第二/三条正是这样退回贴底）。 */
  const pinnedScrollTopRef = useRef(-1);
bag.pinnedScrollTopRef = pinnedScrollTopRef as typeof bag.pinnedScrollTopRef;

  /** 内容已长出视口后，这个锚点不再做 gap 纠偏（交棒给跟随，避免两个 owner 互拉）。 */
  const pinGapLockedRef = useRef<string | null>(null);
bag.pinGapLockedRef = pinGapLockedRef as typeof bag.pinGapLockedRef;

  /** 当前钉顶属于哪个会话：切走再切回**同一条**会话时要靠它决定"保留还是清掉"锚定状态。 */
  const pinThreadIdRef = useRef<string | null>(null);
bag.pinThreadIdRef = pinThreadIdRef as typeof bag.pinThreadIdRef;

  /** 钉顶曾经"休眠"过（切到了别的会话）—— 回来那一次必须**立即**落位，见 pinSentMessage。 */
  const pinDormantSeenRef = useRef(false);
bag.pinDormantSeenRef = pinDormantSeenRef as typeof bag.pinDormantSeenRef;

  /** 落点复核修正的 rAF id（延一帧去抖，见 pinSentMessage）。 */
  const pinFixRef = useRef(0);
bag.pinFixRef = pinFixRef as typeof bag.pinFixRef;

  /** 已经钉过的锚点标识（`turn:<id>` / `opt:<id>`）。**只钉一次**：同一个锚点后续的
      thread 更新只刷新基线，滚动完全交给 update() 里的增量跟随。
      为什么必须有这个（09-12 用户反馈「钉顶和最新跟随来回拉扯、上下弹跳」）：
      此前钉顶 effect 在**每次**流式更新都按绝对坐标重新钉回去（= 往上滚），而
      update() 又按增长量往下推（= 往下滚）—— 两个 owner 反方向抢，就有了弹跳。 */
  const pinnedAnchorKeyRef = useRef<string | null>(null);
bag.pinnedAnchorKeyRef = pinnedAnchorKeyRef as typeof bag.pinnedAnchorKeyRef;

  /** 钉顶过渡动画的 rAF id（同一个锚点只播一次入场动画；新动画开始前先取消旧的）。 */
  const anchorGlideRef = useRef(0);
bag.anchorGlideRef = anchorGlideRef as typeof bag.anchorGlideRef;

  /** 钉顶入场：短距离用 ~180ms easeOut 滑过去（用户要的「丝滑过渡」），长距离直接瞬移
      （切会话/首次定位）。**只用于钉顶落位这一次**，流式跟随永远瞬时——
      跟随若带动画，动画中途内容继续增高会互相 retarget，就是历史上那个抖动。 */
  const glideTo = useCallback((el: HTMLElement, target: number) => {
    const from = el.scrollTop;
    const delta = target - from;
    if (bag.anchorGlideRef.current) cancelAnimationFrame(bag.anchorGlideRef.current);
    if (!Number.isFinite(delta) || Math.abs(delta) < 2 || Math.abs(delta) > 240) {
      el.scrollTop = target;
      bag.anchorGlideRef.current = 0;
      return;
    }
    const t0 = performance.now();
    const DURATION = 180;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      el.scrollTop = from + delta * eased;
      bag.anchorGlideRef.current = p < 1 ? requestAnimationFrame(step) : 0;
    };
    bag.anchorGlideRef.current = requestAnimationFrame(step);
  }, []);
bag.glideTo = glideTo as typeof bag.glideTo;

  const [workStartedAt, setWorkStartedAt] = useState<number | null>(null);
bag.workStartedAt = workStartedAt as typeof bag.workStartedAt; bag.setWorkStartedAt = setWorkStartedAt as typeof bag.setWorkStartedAt;
  return { clearAnchorPad, compactSpacerRef, contentBottomOf, contentTailTarget, pinSentMessage, pinnedScrollTopRef, pinGapLockedRef, pinThreadIdRef, pinDormantSeenRef, pinFixRef, pinnedAnchorKeyRef, anchorGlideRef, glideTo, workStartedAt, setWorkStartedAt };
}
