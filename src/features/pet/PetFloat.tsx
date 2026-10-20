/**
 * PetFloat —— 桌面宠物浮窗的**全部内容**（独立 BrowserWindow，`?pet=1` 进入）。
 *
 * 10-21 按 Qoder 桌宠改造（行为层，不动美术）：
 *   · 主进程把每个会话投影成活动（waiting/running/failed/review），这里只演最高优先级；
 *   · 悬停工具栏（打开主窗 / 收起展开任务横幅 / 隐藏）；
 *   · 手动拖动（指针捕获 + 主进程 setBounds）：左右拖 = 跑，竖向拖 = 跳；
 *   · 鼠标在宠物上时朝指针方向轻倾（v1 包没有 16 向帧，用 CSS 倾斜代替；v2 包后续接帧）。
 * ⛔ 仍不能在 `App()` 里条件 return —— `useHarnessApp()` 是 hook，条件调用违反 hook 规则。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, ListTodo, X } from "lucide-react";
import { PET_DEFAULT_COLUMNS, PET_DEFAULT_FRAME, PET_DEFAULT_ROWS, PET_FRAME_MS, PET_STATES, petAssetUrl, petFrameStyle, petRowOf, type PetStateId } from "./pet-format";

/** 空闲溜达的节奏：12~30s 一次，绕两圈（往右跑 → 往左跑）再回待机。 */
const WANDER_MIN_MS = 12_000;
const WANDER_MAX_MS = 30_000;
const WANDER_LEG_MS = 1_400;
/** 气泡停留时长（主进程给的是"当下一句"，过了就淡出，别一直挂着）。 */
const BUBBLE_MS = 4_000;
const GREETING_MS = 2_600;
const DRAG_THRESHOLD = 4;

type PetActivityItem = {
  threadId: string;
  title: string;
  status: string;
  detail: string;
  canStop: boolean;
};
type PetSignalLike = {
  state: PetStateId;
  phase?: PetStateId;
  bubble: string;
  busy: number;
  tool: string | null;
  activities?: PetActivityItem[];
  attention?: "" | "pending" | "error";
  activityCollapsed?: boolean;
  ts: number;
};

const EMPTY_SIGNAL: PetSignalLike = { state: "idle", bubble: "", busy: 0, tool: null, activities: [], attention: "", activityCollapsed: false, ts: 0 };

export type PetFloatProps = {
  /** 舞台高度占窗口高度的比例（默认 0.66：上留气泡位、下留落地余量） */
  stageRatio?: number;
};

export function PetFloat({ stageRatio = 0.66 }: PetFloatProps) {
  const [pkg, setPkg] = useState<PetPackage | null>(null);
  const [signal, setSignal] = useState<PetSignalLike>(EMPTY_SIGNAL);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [greeting, setGreeting] = useState(true);
  const [hover, setHover] = useState(false);
  const [wander, setWander] = useState<PetStateId | null>(null);
  const [dragMotion, setDragMotion] = useState<PetStateId | null>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [renderedFrameHeight, setRenderedFrameHeight] = useState(0);
  const [frame, setFrame] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const missingRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
    lastScreenX: number;
    lastScreenY: number;
    dragging: boolean;
  } | null>(null);

  /* ── 初始加载：设置里的当前宠物包 + 状态快照补水 ── */
  useEffect(() => {
    let alive = true;
    try { document.title = "桌面宠物"; } catch { /* 忽略 */ }
    void window.codex.petSettingsGet()
      .then((status) => { if (alive) setPkg(status?.active ?? null); })
      .catch(() => undefined);
    void window.codex.petState()
      .then((state) => { if (alive && state?.signal) setSignal(state.signal as PetSignalLike); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /* ── 增量：主进程归约好的活动/状态 ── */
  useEffect(() => window.codex.onPetSignal((next) => {
    if (next && typeof next === "object") setSignal(next as PetSignalLike);
  }), []);

  useEffect(() => window.codex.onPetConfig((config) => {
    if (config && typeof config === "object") setPkg((config as PetStatus).active ?? null);
  }), []);

  /* ── 启动问候：只有 idle 时挥手 2.6s（Qoder 同款） ── */
  useEffect(() => {
    setGreeting(true);
    const timer = window.setTimeout(() => setGreeting(false), GREETING_MS);
    return () => window.clearTimeout(timer);
  }, []);

  /* ── 帧循环（按目标框实测高度换算，窗口缩放时自动跟随） ── */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setRenderedFrameHeight(Math.round(host.clientHeight * stageRatio));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [stageRatio]);

  useEffect(() => {
    const columns = pkg?.columns ?? PET_DEFAULT_COLUMNS;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (now - last < PET_FRAME_MS) return;
      last = now;
      setFrame((value) => (value + 1) % columns);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pkg?.columns]);

  /* ── 气泡：来了就显示，4 秒后淡出 ── */
  useEffect(() => {
    if (!signal.bubble) { setBubbleVisible(false); return; }
    setBubbleVisible(true);
    const timer = window.setTimeout(() => setBubbleVisible(false), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [signal.bubble, signal.ts]);

  /* ── 空闲随机小动作：只在 idle 时安排，一旦有正事立刻取消 ── */
  useEffect(() => {
    if (signal.state !== "idle" || greeting || dragMotion) { setWander(null); return; }
    let cancelled = false;
    const timers: number[] = [];
    const schedule = () => {
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        setWander("running-right");
        timers.push(window.setTimeout(() => { if (!cancelled) setWander("running-left"); }, WANDER_LEG_MS));
        timers.push(window.setTimeout(() => { if (!cancelled) { setWander(null); schedule(); } }, WANDER_LEG_MS * 2));
      }, WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS)));
    };
    schedule();
    return () => { cancelled = true; timers.forEach((t) => window.clearTimeout(t)); };
  }, [signal.state, greeting, dragMotion]);

  const effectiveState = dragMotion ?? wander ?? (greeting && signal.state === "idle" ? "waving" : signal.state);
  const geometry = useMemo(() => ({
    columns: pkg?.columns ?? PET_DEFAULT_COLUMNS,
    rows: pkg?.rows ?? PET_DEFAULT_ROWS,
    frameWidth: pkg?.frameWidth ?? PET_DEFAULT_FRAME.width,
    frameHeight: pkg?.frameHeight ?? PET_DEFAULT_FRAME.height,
  }), [pkg]);
  /* v2 包（11 行）第 9/10 行是 16 个看方向帧：鼠标在宠物上时直接切帧（Qoder 同款）。
     v1 包没有这两行，用下面 CSS 的轻微倾斜代替，绝不越界读行。 */
  const lookDirection = Math.round(((Math.atan2(look.x, -look.y) * 180 / Math.PI + 360) % 360) / 22.5) % 16;
  const showLookFrame = Boolean(
    pkg && pkg.rows >= 11 && !dragMotion && !greeting && Math.hypot(look.x, look.y) > 0.18,
  );
  const row = showLookFrame ? 9 + Math.floor(lookDirection / 8) : petRowOf(pkg?.states ?? PET_STATES, effectiveState);
  const style = petFrameStyle(geometry, row, showLookFrame ? lookDirection % 8 : frame, renderedFrameHeight || geometry.frameHeight);

  const openMain = useCallback(() => { void window.codex.petOpenMain().catch(() => undefined); }, []);
  const hidePet = useCallback(() => { void window.codex.petHide().catch(() => undefined); }, []);
  const toggleActivity = useCallback(() => { void window.codex.petActivityToggle().catch(() => undefined); }, []);
  const hasActivity = Boolean(signal.activities?.length);
  const attention = signal.attention ?? "";

  const updateLook = (clientX: number, clientY: number) => {
    const el = spriteRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const max = Math.max(1, Math.min(rect.width, rect.height) * 0.38);
    setLook({
      x: Math.max(-1, Math.min(1, dx / max)),
      y: Math.max(-1, Math.min(1, dy / max)),
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      lastScreenX: event.screenX,
      lastScreenY: event.screenY,
      dragging: false,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 合成事件可能不支持 */ }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    updateLook(event.clientX, event.clientY);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.screenX - drag.startScreenX;
    const dy = event.screenY - drag.startScreenY;
    if (!drag.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      drag.dragging = true;
      void window.codex.petDragStart({ screenX: drag.startScreenX, screenY: drag.startScreenY }).catch(() => undefined);
    }
    if (!drag.dragging) return;
    const stepX = event.screenX - drag.lastScreenX;
    const stepY = event.screenY - drag.lastScreenY;
    if (Math.abs(stepX) >= DRAG_THRESHOLD || Math.abs(stepY) >= DRAG_THRESHOLD) {
      drag.lastScreenX = event.screenX;
      drag.lastScreenY = event.screenY;
      if (Math.abs(stepX) >= Math.abs(stepY) && Math.abs(stepX) >= DRAG_THRESHOLD) {
        setDragMotion(stepX > 0 ? "running-right" : "running-left");
      } else if (Math.abs(stepY) >= DRAG_THRESHOLD) {
        setDragMotion("jumping");
      }
    }
    void window.codex.petDragMove({ screenX: event.screenX, screenY: event.screenY }).catch(() => undefined);
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragMotion(null);
    setLook({ x: 0, y: 0 });
    if (drag.dragging) void window.codex.petDragEnd().catch(() => undefined);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
  };

  /* ── 上报「宠物本体矩形」（透明窗穿透/可交互的唯一判据）──
     ⛔ 第一版把翻转挂在这里的 mousemove 上，而窗口整块是 app-region drag（非客户区不派发
     DOM mousemove）⇒ 宠物直接拖不动。现在改成手动拖动，但翻转判据仍由主进程轮询；
     这里只报矩形，hover 时把工具栏也算进可交互区。 */
  useEffect(() => {
    let raf = 0;
    const report = () => {
      raf = 0;
      const boxes = [spriteRef.current, missingRef.current, hover ? toolbarRef.current : null]
        .filter((el): el is HTMLDivElement => Boolean(el))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      if (!boxes.length) { void window.codex.petInteractiveRect(null).catch(() => undefined); return; }
      const x = Math.min(...boxes.map((r) => r.left));
      const y = Math.min(...boxes.map((r) => r.top));
      const right = Math.max(...boxes.map((r) => r.right));
      const bottom = Math.max(...boxes.map((r) => r.bottom));
      void window.codex.petInteractiveRect({ x, y, width: right - x, height: bottom - y }).catch(() => undefined);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(report); };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (spriteRef.current) observer.observe(spriteRef.current);
    if (missingRef.current) observer.observe(missingRef.current);
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
      void window.codex.petInteractiveRect(null).catch(() => undefined);
    };
  }, [pkg, renderedFrameHeight, hover]);

  return (
    <div
      className={`pet-float${hover ? " is-hover" : ""}${dragMotion ? " is-dragging" : ""}`}
      ref={hostRef}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { setHover(false); setLook({ x: 0, y: 0 }); }}
    >
      {signal.bubble && (
        <div className={`pet-bubble${bubbleVisible ? " is-visible" : ""}`} role="status" aria-live="polite">
          {signal.bubble}
          {signal.busy > 1 && <span className="pet-bubble-busy">×{signal.busy}</span>}
        </div>
      )}
      <div className="pet-stage" title={pkg ? `${pkg.name}${pkg.description ? ` · ${pkg.description}` : ""}` : "没有可用的宠物包"}>
        {pkg && pkg.spritesheet ? (
          <div
            className="pet-sprite"
            ref={spriteRef}
            style={{
              ...style,
              backgroundImage: `url("${petAssetUrl(pkg.spritesheet)}")`,
              transform: `translate(${look.x * 4}px, ${look.y * 2}px) rotate(${look.x * 1.2}deg)`,
            }}
            onDoubleClick={openMain}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <div
              className="pet-toolbar"
              ref={toolbarRef}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <button type="button" title="打开主界面" aria-label="打开主界面" onClick={openMain}><ExternalLink size={13} /></button>
              {hasActivity && (
                <button type="button" className={`${attention ? `attention-${attention}` : ""}`}
                  title={signal.activityCollapsed ? "展开任务横幅" : "收起任务横幅"}
                  aria-label={signal.activityCollapsed ? "展开任务横幅" : "收起任务横幅"}
                  onClick={toggleActivity}>
                  <ListTodo size={13} />
                  {attention && <span className={`pet-toolbar-dot ${attention}`} aria-hidden />}
                </button>
              )}
              <button type="button" title="隐藏宠物" aria-label="隐藏宠物" onClick={hidePet}><X size={13} /></button>
            </div>
          </div>
        ) : (
          <div className="pet-missing" ref={missingRef}>
            <span>没有可用的宠物包</span>
            <span>在「设置 → 桌面宠物」里查看目录或导入</span>
          </div>
        )}
      </div>
    </div>
  );
}
