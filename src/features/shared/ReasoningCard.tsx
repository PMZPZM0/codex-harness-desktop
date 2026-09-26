/**
 * 共享 ReasoningCard（09-26 抽取）：此前有**两份逐字相同的实现**——
 * `session-turn/SessionTurn/02-reasoning-card.tsx`（主时间线回合内）与
 * `session-queue/ItemView.tsx` 内的本地副本。09-26 的教训：给一份加「自适应展开 +
 * 滚轮门」修复、另一份没动，用户看到的永远是没修的那份（探针 fit 生效率 0/25 实锤）。
 * ⛔ 从现在起思考卡只有一个真相源；改动必须落在这里，两处调用点只许 import。
 *
 * 今天落进来的两个行为（都先在 ItemView 版实现并验证过）：
 * ① 自适应展开：正文 max-height 由静态 260px 改为按「卡顶到 .timeline 裁剪边」的剩余
 *    空间动态收（clamp 96..260），空间不足时靠卡内滚动展示尾部——思考板块不再溢出窗口底。
 * ② 卡内接管只认「真有内部滚动条」的滚轮/触摸：外层时间线滚动时 wheel 冒泡到卡体，
 *    旧写法无条件置 follow=false 会把卡内跟随**永久**误杀（09-26 用户报「卡内不跟最新」）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "../../lib/format-duration";
import { Brain, ChevronDown } from "lucide-react";
import { ThreadItem } from "../../lib/thread-item";
import { reasoningTextOf } from "../../lib/reasoning-text-of";
import { reasoningDuration } from "../../lib/reasoning-duration";
import { bufferedReasoningRevealStarts } from "../../lib/buffered-reasoning-reveal-starts";
import { revealReasoningProgress } from "../../lib/reveal-reasoning-progress";
import { revealStepForReasoning } from "../../lib/reveal-step-for-reasoning";
import { useCardOpen } from "../../components/CardShell";
import { Fold } from "./Fold";

export function ReasoningCard({ item, turnActive }: { item: ThreadItem; turnActive?: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // 思考卡一旦「现场出现过」（本会话流式期间渲染过），完成后永不整体消失：
  // 部分模型/中转不回 reasoning 摘要 delta，text 一直为空——旧行为在回合结束时
  // `!text && !running` 直接 return null，表现就是「深度思考板块自动消失了」。
  const seenLiveRef = useRef(false);
  const text = reasoningTextOf(item);
  const durationMs = item.durationMs ?? reasoningDuration.get(String(item.id));
  // 必须看当前 reasoning item 自己的状态，不能只看整轮 turnActive：后续工具仍在
  // 执行时，前一块已 completed 的思考也会带着 turnActive=true，旧逻辑因此永远不收起。
  const itemRunning = item.status === "inProgress" || item.status === "running";
  const running = Boolean(turnActive) && (itemRunning || (!item.status && !durationMs));
  // 深度思考可能由上游整包交付。首次挂载就是大段正文时先露出短前缀，随后快速追字；
  // 历史会话（turnActive=false 且没有 buffered 标记）保持直接展示，不重播动画。
  const initialReveal = useMemo(() => {
    const marked = bufferedReasoningRevealStarts.get(String(item.id));
    if (marked != null && text.startsWith(marked)) return marked;
    const progressed = revealReasoningProgress.get(String(item.id));
    // 单调下限（09-12 用户「切换一下就重复播放一次」）：进度表里只要有记录，就**取它**，
    // 不再要求 `text.startsWith(progressed)`——思考正文在 resume/流式合并后可能不是严格
    // 前缀（末尾被修订），旧条件一旦不成立就掉回下面的 `slice(0,10)` 分支 =
    // **整段思考从头重播**。位置只许前进，这是唯一正确的语义。
    if (progressed != null) return text.slice(0, Math.min(progressed.length, text.length));
    if (turnActive && text.length >= 24) return text.slice(0, Math.min(10, text.length));
    return text;
  }, [item.id]);
  const [displayed, setDisplayed] = useState(initialReveal);
  const [revealing, setRevealing] = useState(() => initialReveal.length < text.length);
  const displayedRef = useRef(displayed);
  useEffect(() => { displayedRef.current = displayed; }, [displayed]);
  useEffect(() => {
    const markedStart = bufferedReasoningRevealStarts.get(String(item.id));
    let start = displayedRef.current;
    if (markedStart != null && text.startsWith(markedStart) && start.length < markedStart.length) {
      start = markedStart;
      displayedRef.current = start;
      setDisplayed(start);
    }
    // 进度表对齐：跨卸载重建后从上次播放进度续追，不从头重播（同 revealProgressStore）。
    // 同样**不要求** startsWith：位置只能前进（见上面 initialReveal 的说明）。
    const progressed = revealReasoningProgress.get(String(item.id));
    if (progressed != null && start.length < progressed.length) {
      start = text.slice(0, Math.min(progressed.length, text.length));
      displayedRef.current = start;
      setDisplayed(start);
    }
    // 内容发生修订、缩短或不再是原文本的追加时不能追字，直接同步，避免错字残留。
    if (!text.startsWith(start)) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      bufferedReasoningRevealStarts.delete(String(item.id));
      return;
    }
    // 思考结束（running 已 false）：剩余追字缓冲立即放完并结束揭示。
    // 用户要求「内容输出完就自动折叠，不停留」——不能让慢速追字拖到正文都出来后
    // 思考卡还挂着展开（09-05 反馈：思考还没加载完正文就出来了）。
    if (!running && revealing) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      bufferedReasoningRevealStarts.delete(String(item.id));
      return;
    }
    const remaining = text.length - start.length;
    if (remaining <= 0) {
      setRevealing(false);
      bufferedReasoningRevealStarts.delete(String(item.id));
      return;
    }
    // active（思考运行中）：内容只要在追加就平滑续字——小增量也逐字流出，
    // 形成与正文一致的 WorkBuddy 式连续出字节奏；完成态/整包交付也追完不瞬现。
    const shouldReveal = revealing || running || markedStart != null;
    if (!shouldReveal) {
      displayedRef.current = text;
      setDisplayed(text);
      setRevealing(false);
      return;
    }
    setRevealing(true);
    // 思考正文速率自适应（revealStepForReasoning；09-12 已提到与主正文同级，
    // 用户原话「思考出字怎么这么慢，拉快一点」——不要再调慢回去）。
    const step = Math.max(1, Math.min(revealStepForReasoning(remaining), Math.ceil(remaining / 3)));
    let end = start.length;
    const timer = window.setInterval(() => {
      end = Math.min(text.length, end + step);
      const next = text.slice(0, end);
      displayedRef.current = next;
      revealReasoningProgress.set(String(item.id), next);
      setDisplayed(next);
      window.dispatchEvent(new Event("codex:packet-reveal"));
      if (end >= text.length) {
        window.clearInterval(timer);
        bufferedReasoningRevealStarts.delete(String(item.id));
        // 进度保留全文：回合未结束前切会话回来 active 仍 true，删了会二次重播
        setRevealing(false);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [item.id, text, revealing, running]);
  // 自动延迟可见与用户手动展开必须分开：自动行为不能写进 manualOpen，
  // 否则会被误认为“用户主动展开”，导致第一块思考永久保持打开。
  const { open, toggle, manualOpen } = useCardOpen(Boolean(running) || revealing);
  // 思考输出完即自动折叠（running/revealing 双双转 false 时 useCardOpen 自动收起），
  // 不做「完成后保持展开凑满最短可见时长」的停留——09-05 用户反馈停留体验不好。
  // 思考结束瞬间的剩余缓冲由上面揭示 effect 立即放完，不会闪断。
  // 回合运行期间只要该 reasoning item 已进入事件流，就先保留它的标题节点；
  // 某些中转会先发 completed/started，再稍后补正文 delta，不能把后续思考误当空占位丢掉。
  useEffect(() => { if (running || turnActive) seenLiveRef.current = true; }, [running, turnActive]);
  // 新一块思考开始直播时重置跟随：上一块被用户接管过（reasoningFollowRef=false）不该
  // 殃及下一块——每块思考开始时用户都在看最新内容，默认应该跟。
  useEffect(() => { if (running) reasoningFollowRef.current = true; }, [running]);
  // 思考进行中：新内容到达时自动贴底滚动。
  // ⛔ 用户接管判定必须挂在真实用户输入上，不能用「距底>40 就不跟」（09-13 用户反馈
  // 「思考内容不自动跟随」真根因）：思考正文经常整段大块交付、追字步长大，一帧内
  // dist 直接跳过 40px，旧判据把它当成「用户上滚」→ 从此永远不再跟随。
  // 与外层时间线同一哲学：滚轮/触摸/按住滚动条拖动 = 接管；滚回距底 ≤8px = 重新跟随。
  const reasoningFollowRef = useRef(true);
  const reasoningBodyPointerDownRef = useRef(false);
  const reasoningBodyMounted = Boolean(displayed);
  /* ── 09-26 自适应展开：思考卡落在视口下方时，静态 max-height:260px 会让卡体
     溢出时间线裁剪边（用户截图：思考板块被窗口底切掉），而钉顶期视口不跟随
     ⇒ 最新思考永远看不见。修法 = 按卡顶到时间线裁剪边（.timeline 容器底）的
     剩余空间动态收 max-height，正文靠已有的卡内滚动展示尾部；空间充裕时上限
     仍是 260px（行为不变）。⛔ 量的是**滚动容器底**而不是 window——裁剪发生在
     .timeline 的 client 区，composer 在容器外不算可用空间。 */
  const fitReasoningBody = useCallback((el: HTMLDivElement | null) => {
    if (!el || !el.isConnected) return;
    const scroller = el.closest(".timeline");
    const limit = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    const available = Math.round(limit - el.getBoundingClientRect().top - 12);
    const cap = Math.max(96, Math.min(260, available));
    if (el.style.maxHeight !== cap + "px") el.style.maxHeight = cap + "px";
  }, []);
  const fitResizeHandler = useCallback(() => fitReasoningBody(bodyRef.current), [fitReasoningBody]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const dist = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    // ⛔ 09-26 用户报「思考板块里面的内容没有自动跟随最新」：滚轮在卡上滚**外层**时间线时，
    //    wheel 事件会冒泡到卡体 —— 旧写法无条件置 follow=false，外层翻两页就把卡内跟随
    //    **永久**杀死（正文不滚动就再没有 scroll 事件来恢复它）。
    //    修法 = 只在卡体**真的有内部滚动条**（内容溢出）时才认接管：卡内容装得下时
    //    滚轮必然是给外层的，不许误伤。接管后恢复语义不变（滚回距底 ≤8px = 重新跟）。
    const onWheel = () => { if (el.scrollHeight > el.clientHeight + 1) reasoningFollowRef.current = false; };
    const onTouchMove = () => { if (el.scrollHeight > el.clientHeight + 1) reasoningFollowRef.current = false; };
    const onScroll = () => {
      if (dist() <= 8) reasoningFollowRef.current = true;
      else if (reasoningBodyPointerDownRef.current) reasoningFollowRef.current = false;
    };
    const onPointerDown = () => { reasoningBodyPointerDownRef.current = true; };
    const onPointerUp = () => { reasoningBodyPointerDownRef.current = false; };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // 监听器只在正文元素首次挂载时装一次（displayed 从空到有）；逐字追字期间不重装。
  }, [reasoningBodyMounted]);
  useEffect(() => {
    if (!running || manualOpen === false) return;
    if (!reasoningFollowRef.current) return;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current;
      // ⛔ 先收高度再贴底：顺序反了 scrollTop 会按旧 max 钳住，尾部差一行。
      if (el && reasoningFollowRef.current) { fitReasoningBody(el); el.scrollTop = el.scrollHeight; }
    });
    return () => cancelAnimationFrame(raf);
  }, [displayed, running, manualOpen, fitReasoningBody]);
  // 展开态与内容变化都重算（不抢滚动——滚动仍由上面的跟随 effect 独占）：
  // displayed 逐字追字期间每 16ms 一跳，正好覆盖「上方内容增长把卡片顶低」的位移。
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => fitReasoningBody(bodyRef.current));
    return () => cancelAnimationFrame(raf);
  }, [open, displayed, fitReasoningBody]);
  // 手动展开/窗口尺寸变化同样要重算（done 卡没有追字 tick，只有这里能兜住）。
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", fitResizeHandler);
    return () => window.removeEventListener("resize", fitResizeHandler);
  }, [open, fitResizeHandler]);
  // 没现场出现过且无内容的（历史加载的空占位）才不渲染；现场出现过的保留标题行常驻
  if (!text && !running && !seenLiveRef.current && !turnActive) return null;
  const head = running
    ? <span className="reasoning-head shimmer-text"><Brain size={13} className="reasoning-pulse" />深度思考中</span>
    : <span className="reasoning-head"><Brain size={13} />已深度思考{durationMs ? `（用时 ${formatDuration(durationMs)}）` : ""}</span>;
  return (
    <div className={`reasoning-card ${running ? "live" : "done"} ${open ? "open" : "collapsed"}`}>
      <button type="button" className="reasoning-head-btn" onClick={toggle}>
        {head}<ChevronDown size={13} className="reasoning-caret" />
      </button>
      {displayed && <Fold open={open}><div className="reasoning-body-wrap"><div className="reasoning-body" ref={bodyRef}>{displayed}{revealing ? <span className="reasoning-stream-cursor" aria-hidden /> : null}</div></div></Fold>}
    </div>
  );
}
