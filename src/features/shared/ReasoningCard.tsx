/**
 * 共享 ReasoningCard（09-26 抽取）：此前有**两份逐字相同的实现**——
 * `session-turn/SessionTurn/02-reasoning-card.tsx`（主时间线回合内）与
 * `session-queue/ItemView.tsx` 内的本地副本。09-26 的教训：给一份加修复、另一份没动，
 * 用户看到的永远是没修的那份（探针 fit 生效率 0/25 实锤）。
 * ⛔ 从现在起思考卡只有一个真相源；改动必须落在这里，两处调用点只许 import。
 *
 * 呈现形态（09-26 用户定稿，三轮迭代收敛）：
 *  · 流内**永远只有一行芯片**（直播「深度思考中 ›」/ 完成「已深度思考（用时）›」）；
 *  · 正文一律走 **portal 浮窗**：与输入框同宽同列、锚在芯片下方（空间不够自动翻到
 *    芯片上方）、正文约 4 行（96px）内部滚动——不占消息流布局，工具卡不再被撑出视口；
 *  · **macOS 窗口缩放特效**：浮窗从芯片位置放大放出（spawn）、完成时缩回芯片消失
 *    （suck，forwarded 停在消失帧再卸载）——transform-origin 钉在芯片所在的左上角；
 *  · 直播时自动展开并贴底跟随；done 态点芯片 = 弹窗预览（从头读，不自动跟）；
 *    接管/恢复语义与外层时间线一致（滚轮接管、滚回距底 ≤8px 恢复）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDuration } from "../../lib/format-duration";
import { Brain, ChevronDown } from "lucide-react";
import { ThreadItem } from "../../lib/thread-item";
import { reasoningTextOf } from "../../lib/reasoning-text-of";
import { reasoningDuration } from "../../lib/reasoning-duration";
import { bufferedReasoningRevealStarts } from "../../lib/buffered-reasoning-reveal-starts";
import { revealReasoningProgress } from "../../lib/reveal-reasoning-progress";
import { revealStepForReasoning } from "../../lib/reveal-step-for-reasoning";
import { useCardOpen } from "../../components/CardShell";

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
  // 吸入动画挂起态（声明在追字 effect 之前：它的依赖数组要引用）
  const [exiting, setExiting] = useState(false);
  const displayedRef = useRef(displayed);
  useEffect(() => { displayedRef.current = displayed; }, [displayed]);
  // ⛔ 吸入动画期间（exiting）**冻结追字**：完成瞬间剩余全文会被一次性灌进浮窗 + 定时器
  //    每 16ms setDisplayed，与 suck 动画同帧抢主线程 = 用户报的「展开后卡顿一下」。
  //    冻结到动画播完（exiting 转 false 本 effect 重跑），再走下面的放全文分支——
  //    那时浮窗已卸载，setDisplayed 只重渲染流内芯片，零成本。
  useEffect(() => {
    if (exiting) return;
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
  }, [item.id, text, revealing, running, exiting]);
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
  /* ── 浮窗挂载态：直播自动展开；done 态点芯片 = 弹窗预览（open 驱动）。
     卸载走**吸入特效**：popupOpen 转 false 的那一次先挂 .sucking 停 240ms 再卸——
     ⛔ 不能直接卸载：macOS 缩回特效需要元素活着播完 forwards 帧。 */
  const popupOpen = open && Boolean(displayed);
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (popupOpen) { prevOpenRef.current = true; setExiting(false); return; }
    if (prevOpenRef.current && Boolean(displayed)) {
      prevOpenRef.current = false;
      setExiting(true);
      const t = setTimeout(() => setExiting(false), 240);
      return () => clearTimeout(t);
    }
  }, [popupOpen, displayed]);
  const reasoningBodyPointerMounted = (popupOpen || exiting) && Boolean(displayed);
  const headRef = useRef<HTMLButtonElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  /* ── 浮窗定位：与输入框**同宽同列**（跟输入框一样长）；垂直方向**按空间自适应**
     （09-26 用户定稿「位置不是固定每次都在下方」）：下方够就贴芯片下方 4px；
     下方不够（芯片贴近输入框——最常见）放芯片上方；两侧都不够取**空间大**的一侧
     并钳进边界。每帧跟随（rAF 循环）：流式追字、外层滚动、窗口变化都重新选边。 */
  const positionFloat = useCallback(() => {
    const panel = floatRef.current;
    const chip = headRef.current;
    if (!panel || !chip || !chip.isConnected) return;
    const comp = document.querySelector(".composer");
    const compR = comp ? comp.getBoundingClientRect() : null;
    const chipR = chip.getBoundingClientRect();
    const width = compR ? Math.round(compR.width) : Math.min(820, window.innerWidth - 46);
    const left = compR ? Math.round(compR.left) : Math.round((window.innerWidth - width) / 2);
    const compTop = compR ? compR.top : window.innerHeight;
    panel.style.width = width + "px";
    panel.style.left = left + "px";
    const ph = panel.offsetHeight || 140;
    const spaceBelow = compTop - 8 - chipR.bottom;
    const spaceAbove = chipR.top - 8;
    let top;
    if (spaceBelow >= ph) top = chipR.bottom + 4;
    else if (spaceAbove >= ph) top = chipR.top - 6 - ph;
    else if (spaceAbove >= spaceBelow) top = Math.max(8, chipR.top - 6 - ph);
    else top = Math.min(chipR.bottom + 4, compTop - 8 - ph);
    panel.style.top = Math.round(top) + "px";
  }, []);
  useEffect(() => {
    if (!reasoningBodyPointerMounted) return;
    let raf = 0;
    const loop = () => { positionFloat(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reasoningBodyPointerMounted, positionFloat]);
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
    // ⛔ 浮窗 ↔ 卸载切换时 bodyRef 换元素，必须重绑，否则跟随监听丢失。
  }, [reasoningBodyPointerMounted]);
  // 直播跟随：每 tick 把卡内滚动贴到最新一行（done 预览不跟——从头读）。
  useEffect(() => {
    if (!running || manualOpen === false) return;
    if (!reasoningFollowRef.current) return;
    const raf = requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (el && reasoningFollowRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [displayed, running, manualOpen]);
  // 没现场出现过且无内容的（历史加载的空占位）才不渲染；现场出现过的保留标题行常驻
  if (!text && !running && !seenLiveRef.current && !turnActive) return null;
  const head = running
    ? <span className="reasoning-head shimmer-text"><Brain size={13} className="reasoning-pulse" />深度思考中</span>
    : <span className="reasoning-head"><Brain size={13} />已深度思考{durationMs ? `（用时 ${formatDuration(durationMs)}）` : ""}</span>;
  return (
    <div className={`reasoning-card ${running ? "live" : "done"} ${open ? "open" : "collapsed"}`}>
      <button type="button" className="reasoning-head-btn" ref={headRef} onClick={toggle}>
        {head}<ChevronDown size={13} className="reasoning-caret" />
      </button>
      {reasoningBodyPointerMounted && createPortal(
        <div
          className={`reasoning-float ${exiting ? "sucking" : ""}`} ref={floatRef} role="complementary" aria-label="深度思考"
          onClick={(event) => {
            // ⛔ 09-26 用户定稿「整个留白地方做成可以折叠收纳的按键」：点浮窗**空白处/头部**
            //    即收起；正文区例外（点正文是选字/滚动，不能误收）。
            if ((event.target as HTMLElement).closest(".reasoning-body")) return;
            toggle();
          }}
        >
          {/* ⛔ 浮窗头不放「深度思考中」文字——流内芯片已经写着，重复两遍很傻；只留收起箭头（主题蓝） */}
          <button type="button" className="reasoning-float-head" onClick={toggle} title="收起（点流内芯片可再展开）">
            <ChevronDown size={13} className="reasoning-caret" />
          </button>
          <div className="reasoning-body-wrap">
            <div className="reasoning-body" ref={bodyRef}>{displayed}{revealing ? <span className="reasoning-stream-cursor" aria-hidden /> : null}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
