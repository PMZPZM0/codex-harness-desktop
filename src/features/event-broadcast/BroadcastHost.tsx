/**
 * 悬浮播报 · 宿主（图标 + 拖拽 + 吸附 + 播报气泡 + 历史面板）
 *
 * 用户令（10-31）全文见 `store.ts` 头部。本文件只管**位置与交互**：
 *   · 拖拽跟手（pointer capture，4px 阈值区分点击/拖动）
 *   · 松手吸附到最近的「对话区边框」（四边都行，`dock.ts` 算）
 *   · 吸附后记住「边 + 沿边比例」⇒ 侧栏拖动、左右栏开合、窗口缩放时**自动跟着新边框贴回去**
 *   · 播报气泡从图标内侧滑出，播完自动收纳成图标（未读角标）
 *
 * ⛔ 两套动画必须分开：
 *   · **位置**动画在 `.bc-anchor`（left/top 的 transition）—— 拖动时要 `transition: none` 才是跟手；
 *   · **缩放/回弹**动画在 `.bc-pod`（内层按钮）—— 若两者都写在同一个元素的 transform 上，
 *     拖动跟手的 `translate(-50%,-50%)` 会被回弹的 `scale()` 覆盖 ⇒ 图标瞬移。
 *     所以锚点用 `margin-left/top` 做中心对齐，不占用 transform。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Megaphone, Square, X } from "lucide-react";
import { getAnnounceStatus, requestAnnounceStop, subscribeAnnounceStatus } from "../../voice/announce-bus";
import { dismissBroadcast, getBroadcastSnapshot, pushBroadcast, setBroadcastOpen, subscribeBroadcast, BROADCAST_CHANNEL, type BroadcastPushDetail } from "./store";
import {
  DOCK_INSET,
  POD_SIZE,
  SNAP_THRESHOLD,
  clampIntoStage,
  edgeGapOf,
  measureStage,
  nearestEdgeOf,
  pointForDock,
  ratioForPoint,
  snapPoint,
  type DockEdge,
  type DockState,
  type StageRect,
} from "./dock";
import { BroadcastPanel } from "./BroadcastPanel";
import { kindMetaOf } from "./kinds";

const DOCK_KEY = "harness-broadcast-dock";
const EDGES: DockEdge[] = ["left", "right", "top", "bottom"];

function readDock(): DockState {
  /* ⛔ 10-31 用户令：「图标悬浮窗位置默认在**对话框左上角**」——
     即聊天区左边界顶端（贴左边 + ratio 0）。只在**没有存过位置**时生效；
     用户拖过之后一律按他自己拖的地方（localStorage 里的 edge/ratio/free）。 */
  try {
    const raw = localStorage.getItem(DOCK_KEY);
    const obj = JSON.parse(raw || "{}");
    /* 自由悬浮态：上次用户把它放在中间（没有贴边）⇒ 按像素恢复 */
    if (obj?.docked === false && Number.isFinite(obj?.free?.x) && Number.isFinite(obj?.free?.y)) {
      return { edge: "left", ratio: 0, docked: false, free: { x: Number(obj.free.x), y: Number(obj.free.y) } };
    }
    const edge = EDGES.includes(obj?.edge) ? (obj.edge as DockEdge) : "left";
    const ratio = Number(obj?.ratio);
    return { edge, ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0, docked: true };
  } catch {
    /* localStorage 不可用（隐私模式）⇒ 用默认位，功能不受影响 */
    return { edge: "left", ratio: 0, docked: true };
  }
}

export function BroadcastHost({ threadId }: { threadId?: string }) {
  const snap = useSyncExternalStore(subscribeBroadcast, getBroadcastSnapshot, getBroadcastSnapshot);
  /* 语音播报的实时态：图标上给一个绿点 + 呼吸，面板里给当前句与停止出口（「统一播报」）。 */
  const [voice, setVoice] = useState(() => getAnnounceStatus());
  useEffect(() => subscribeAnnounceStatus(setVoice), []);
  const [stage, setStage] = useState<StageRect>(measureStage);
  const [dock, setDock] = useState<DockState>(readDock);
  /** 拖动过程中的自由坐标（null = 处于贴边态，位置由 dock 推出来） */
  const [free, setFree] = useState<{ x: number; y: number } | null>(null);
  const freeRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [bounce, setBounce] = useState(false);
  const bounceTimer = useRef(0);
  const dragRef = useRef<{ px: number; py: number; cx: number; cy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const movedRef = useRef(false);

  /* ── 布局跟随 ──────────────────────────────────────────────────────────
     覆盖三种会让「对话框边框」动起来的情况：窗口缩放、**侧栏拖动/折叠**、**左右栏开合**。
     ⛔ 不用 MutationObserver：流式输出时 DOM 每帧都在变，subtree 观察会被刷爆
       （本项目 10-29 踩过"观察器把主线程拖住"的坑）。250ms 轮询 + 变化才 setState，
       代价是 4 次 getBoundingClientRect，肉眼无感；页面隐藏时直接跳过。 */
  useEffect(() => {
    const remeasure = () => {
      setStage((prev) => {
        const next = measureStage();
        return prev.left === next.left && prev.right === next.right && prev.top === next.top && prev.bottom === next.bottom
          ? prev
          : next;
      });
    };
    /* 首帧 + 两帧后再测一次：挂载瞬间侧栏/输入框可能还没布局完，此时量到的是 0，
       ⛔ 若之后不再重测，图标会一直贴在视口左上角（"拖都拖不出来"的元凶之一）。 */
    remeasure();
    const raf1 = requestAnimationFrame(() => { remeasure(); });
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(remeasure));
    window.addEventListener("resize", remeasure);
    /* ⛔ 不能用 `document.hidden` 拦：窗口在后台/最小化时它恒为 true，
       那样 stage 会永远停在旧值（自动化里实测过）。这里是 4 次 getBoundingClientRect，
       250ms 一次的成本可以忽略。 */
    const timer = window.setInterval(remeasure, 250);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("resize", remeasure);
      window.clearInterval(timer);
      window.clearTimeout(bounceTimer.current);
    };
  }, []);

  /* 位置三态：拖动中（free）> 自由悬浮（dock.free）> 贴边（edge+ratio）。
     ⛔ 自由悬浮要 clamp 进聊天区：侧栏拖宽、右栏展开、窗口缩放之后它不能被挤到栏上或屏幕外。 */
  const point = useMemo(() => {
    if (free) return free;
    if (dock.docked) return pointForDock(dock, stage);
    return clampIntoStage(dock.free ?? pointForDock({ edge: "left", ratio: 0 }, stage), stage);
  }, [free, dock, stage]);

  /* 当前该按哪条边出横幅：贴边用吸附边，自由悬浮用最近边 */
  const activeEdge: DockEdge = dock.docked && !free ? dock.edge : nearestEdgeOf(point, stage);

  /* 外部推播报入口：任何模块/插件/自动化脚本派发 `harness:broadcast` 即可播一条。
     ⛔ 这是**唯一**的外部入口（不要再开 window 全局函数或第二个 Host）。 */
  useEffect(() => {
    const onPush = (event: Event) => {
      const detail = (event as CustomEvent<BroadcastPushDetail>).detail;
      if (!detail?.title) return;
      pushBroadcast({
        id: `ext:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
        kind: detail.kind ?? "system",
        title: String(detail.title),
        text: detail.text ? String(detail.text) : undefined,
        tone: detail.tone,
        threadId: detail.threadId,
        tags: Array.isArray(detail.tags) ? detail.tags : undefined,
      });
    };
    window.addEventListener(BROADCAST_CHANNEL, onPush);
    return () => window.removeEventListener(BROADCAST_CHANNEL, onPush);
  }, []);

  /* ── 拖拽 ──────────────────────────────────────────────────────────────
     分工同 VoiceCallFloat：pointer 只负责移动，动作交给 onClick —— 键盘 Enter/Space
     与自动化里的 el.click() 才能同样生效。 */
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    /* ⛔ 记的是「指针 → 图标中心」的**偏移量**，移动时用 `指针 + 偏移` 反推中心。
       不用增量累加、也不依赖任何 dock 状态 ⇒ 永远不会"一按下去就跳位"
       （自由悬浮态按下去跳回贴边位置，正是用户说的「拉都拉不出来」）。 */
    const current = freeRef.current ?? point;
    dragRef.current = {
      ox: current.x - event.clientX,
      oy: current.y - event.clientY,
      px: event.clientX,
      py: event.clientY,
      cx: current.x,
      cy: current.y,
      moved: false,
    };
    movedRef.current = false;
  }, [point]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      movedRef.current = true;
      setDragging(true);
    }
    const half = POD_SIZE / 2;
    /* 绝对定位：指针 + 起始偏移 ⇒ 图标跟着手指走，不做增量累加（累加会漂） */
    const next = {
      x: Math.max(half + 2, Math.min(window.innerWidth - half - 2, event.clientX + drag.ox)),
      y: Math.max(half + 2, Math.min(window.innerHeight - half - 2, event.clientY + drag.oy)),
    };
    freeRef.current = next;
    setFree(next);
  }, []);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag?.moved) return;
    const current = clampIntoStage(freeRef.current ?? point, stage);
    /* 磁吸：**靠近边框才吸**，中间松手就是自由悬浮（用户 10-31：「拉都拉不出来」）。 */
    if (edgeGapOf(current, stage) <= SNAP_THRESHOLD) {
      const target = snapPoint(current, stage);
      const ratio = ratioForPoint({ x: target.x, y: target.y }, target.edge, stage);
      setDock({ edge: target.edge, ratio, docked: true });
      try { localStorage.setItem(DOCK_KEY, JSON.stringify({ docked: true, edge: target.edge, ratio })); } catch { /* 存不进就只在本次会话生效 */ }
    } else {
      setDock({ edge: nearestEdgeOf(current, stage), ratio: 0, docked: false, free: current });
      try { localStorage.setItem(DOCK_KEY, JSON.stringify({ docked: false, free: current })); } catch { /* 同上 */ }
    }
    setFree(null);
    freeRef.current = null;
    /* 吸附回弹：短动画重播一次（class 切换驱动，不占用定位 transform） */
    setBounce(true);
    window.clearTimeout(bounceTimer.current);
    bounceTimer.current = window.setTimeout(() => setBounce(false), 400);
  }, [point, stage]);

  const onPodClick = useCallback(() => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    setBroadcastOpen(!snap.open);
  }, [snap.open]);

  if (!snap.history.length && !snap.announcing) return null;

  const half = POD_SIZE / 2;
  /* 气泡朝**聊天区内侧**滑出（贴左边就往右弹，贴右边就往左弹） */
  const bubble = (() => {
    /* 横幅宽度：占聊天区约 60%，上限 420 —— 太窄会退化成"小气泡"，太宽会像整块面板 */
    const W = 420;
    const width = Math.min(W, Math.max(240, Math.round((stage.right - stage.left) * 0.6)));
    if (activeEdge === "left") {
      return { left: point.x + half + 10, top: point.y - 30, width, origin: "left" as const };
    }
    if (activeEdge === "right") {
      return { left: point.x - half - 10 - width, top: point.y - 30, width, origin: "right" as const };
    }
    if (activeEdge === "top") {
      return { left: Math.max(stage.left + 8, Math.min(point.x - width / 2, stage.right - width - 8)), top: point.y + half + 10, width, origin: "top" as const };
    }
    return { left: Math.max(stage.left + 8, Math.min(point.x - width / 2, stage.right - width - 8)), top: point.y - half - 10 - 96, width, origin: "bottom" as const };
  })();

  const announcingMeta = snap.announcing ? kindMetaOf(snap.announcing.kind) : null;
  const AnnouncingIcon = announcingMeta?.icon;

  return (
    <>
      {/* 图标锚点：只负责位置（left/top 有 transition，拖动时关掉） */}
      <div
        className={`bc-anchor${dragging ? " is-dragging" : ""}`}
        data-edge={activeEdge}
        style={{
          left: Math.round(point.x),
          top: Math.round(point.y),
          marginLeft: -half,
          marginTop: -half,
          width: POD_SIZE,
          height: POD_SIZE,
        }}
      >
        <button
          type="button"
          data-edge={activeEdge}
          /* ⛔ 「融入边框」= 平时收成一个贴在边线内侧的把手（`.is-merged`），
             hover / 播报 / 面板打开 / 拖动时才展开成完整圆钮。状态全在这里判，
             CSS 只管两种形态长什么样 —— 不要用 JS 算尺寸。 */
          className={`bc-pod${dragging ? " is-dragging" : ""}${bounce ? " is-snap" : ""}${snap.announcing ? " is-announcing" : ""}${snap.paused ? " is-paused" : ""}${voice.active ? " is-voice" : ""}${dock.docked && !dragging && !snap.announcing && !snap.open ? " is-merged" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onClick={onPodClick}
          aria-label={`播报（${snap.history.length} 条${snap.unread ? `，${snap.unread} 条未读` : ""}）`}
          aria-expanded={snap.open}
          title={snap.open ? "收起播报列表" : "播报：点击查看历史，拖动可贴边"}
        >
          <span className="bc-glyph" aria-hidden>
            {/* ⛔ 动态化的三个消费点都在这一层（10-31 用户令：「图标要动态化，语音和群事件要不同的播放特效」）：
                ① 喇叭本体常驻微呼吸；
                ② 群事件播报 ⇒ 喇叭口向外扩散的三道声波（.bc-wave）；
                ③ 语音播报 ⇒ 喇叭下方的四根音量柱律动（.bc-eq，绿色）。
                两套动效互斥由 class 决定：语音优先（它在播真人声音，信息更即时）。 */}
            <Megaphone className="bc-pod-icon" size={19} strokeWidth={2} />
            <i className="bc-wave w1" /><i className="bc-wave w2" /><i className="bc-wave w3" />
            <i className="bc-eq e1" /><i className="bc-eq e2" /><i className="bc-eq e3" /><i className="bc-eq e4" />
          </span>
          {snap.unread > 0 && !snap.open ? <span className="bc-badge">{snap.unread > 9 ? "9+" : snap.unread}</span> : null}
          {snap.announcing || voice.active ? <span className="bc-pulse" aria-hidden /> : null}
        </button>
      </div>

      {/* 播报气泡：**两套特效**（10-31 用户令「播报语音效果和播报群事件效果，不同展示播放特效」）
          · 语音在播 ⇒ 语音气泡（音量柱 + 当前句 + 停止），优先级最高（真人声正在响，信息更即时）；
          · 否则 ⇒ 事件气泡（群事件/系统提示等，按 kind 取图标与色调）。
          两者都从**贴边内侧**滑出，播完由 store 自动收纳回图标。 */}
      {voice.active && !snap.open ? (
        <div
          className={`bc-bubble kind-voice is-${bubble.origin}`}
          style={{ left: Math.round(bubble.left), top: Math.round(bubble.top), width: bubble.width }}
          role="status"
          aria-live="polite"
        >
          <span className="bc-eq-bubble" aria-hidden>
            <i /><i /><i /><i />
          </span>
          <span className="bc-bubble-main">
            <span className="bc-bubble-kind">语音播报{voice.pending > 0 ? ` · 待播 ${voice.pending} 句` : ""}</span>
            <span className="bc-bubble-title">{String(voice.current ?? "").trim() || "正在播报…"}</span>
          </span>
          <button
            type="button"
            className="bc-bubble-close"
            title="立即停止播报"
            onClick={(event) => { event.stopPropagation(); requestAnnounceStop(); }}
          >
            <Square size={10} />
          </button>
        </div>
      ) : snap.announcing && !snap.open && announcingMeta && AnnouncingIcon ? (
        <div
          className={`bc-bubble kind-${snap.announcing.kind} is-${bubble.origin}`}
          style={{ left: Math.round(bubble.left), top: Math.round(bubble.top), width: bubble.width }}
          role="status"
          aria-live="polite"
        >
          <span className={`bc-bubble-icon tone-${snap.announcing.tone ?? announcingMeta.tone}`} aria-hidden>
            <AnnouncingIcon size={13} />
          </span>
          <span className="bc-bubble-main">
            <span className="bc-bubble-kind">{announcingMeta.label}</span>
            <span className="bc-bubble-title">{snap.announcing.title}</span>
            {snap.announcing.text ? <span className="bc-bubble-text">{snap.announcing.text}</span> : null}
          </span>
          <button
            type="button"
            className="bc-bubble-close"
            title="收起这条播报"
            onClick={(event) => {
              event.stopPropagation();
              dismissBroadcast();
            }}
          >
            <X size={11} />
          </button>
        </div>
      ) : null}

      {snap.open ? (
        <BroadcastPanel
          items={snap.history}
          edge={activeEdge}
          stage={stage}
          icon={point}
          paused={snap.paused}
        />
      ) : null}

      {/* threadId 目前不参与过滤（播报中心是全局的），保留形参给未来的「只看当前会话」开关 */}
      <span hidden data-broadcast-thread={threadId ?? ""} />
    </>
  );
}
