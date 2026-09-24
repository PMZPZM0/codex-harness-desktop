/**
 * SessionTurn 的「reasoning-card」部分（09-22 从同目录 SessionTurn.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { useEffect, useMemo, memo, useState, useRef } from "react";
import { formatDuration } from "../../../lib/format-duration";
import { CircleStop, AlertTriangle, FileText, Brain, ChevronDown } from "lucide-react";
import { ThreadItem } from "../../../lib/thread-item";
import { reasoningTextOf } from "../../../lib/reasoning-text-of";
import { reasoningDuration } from "../../../lib/reasoning-duration";
import { bufferedReasoningRevealStarts } from "../../../lib/buffered-reasoning-reveal-starts";
import { revealReasoningProgress } from "../../../lib/reveal-reasoning-progress";
import { revealStepForReasoning } from "../../../lib/reveal-step-for-reasoning";
import { useCardOpen } from "../../../components/CardShell";
import { Fold } from "../../shared/Fold";
/**
 * 大包文本快速揭示（WorkBuddy 式连续出字）。
 *  active=true（流式运行中）：内容只要在追加就持续逐字揭示——不要求大跳才追，
 *    小增量也平滑续写，形成「文字持续流出的打字机感」。
 *  active=false（历史加载/已完成）：直接展示全文，不重播动画。
 *  markerStore 用于完成事件一次性交付正文的场景（快进到标记点再续追）。
 *  速率按剩余量自适应：尾段逐字精雕（打字感），长文自动提速不拖沓。
 */

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
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const dist = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const onWheel = () => { reasoningFollowRef.current = false; };
    const onTouchMove = () => { reasoningFollowRef.current = false; };
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
      <button type="button" className="reasoning-head-btn" onClick={toggle}>
        {head}<ChevronDown size={13} className="reasoning-caret" />
      </button>
      {displayed && <Fold open={open}><div className="reasoning-body-wrap"><div className="reasoning-body" ref={bodyRef}>{displayed}{revealing ? <span className="reasoning-stream-cursor" aria-hidden /> : null}</div></div></Fold>}
    </div>
  );
}
