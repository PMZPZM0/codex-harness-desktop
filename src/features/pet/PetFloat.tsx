/**
 * PetFloat —— 桌面宠物浮窗的**全部内容**（独立 BrowserWindow，`?pet=1` 进入）。
 *
 * 为什么在 main.tsx 就按 query 分流、而不是走进 `useHarnessApp`：
 *   浮窗只需要"当前宠物包 + 一个九态信号"，跑整套 app 状态（会话 / 引擎 / 调度器 …）
 *   等于在桌面上多养一份几百个 hook 的实例，纯浪费且会触发一堆无意义副作用。
 *   ⛔ 也不能在 App() 里条件 return —— `useHarnessApp()` 是 hook，条件调用违反 hook 规则。
 *
 * 数据来源两条：
 *   · 初始：`petSettingsGet()`（当前宠物包 + 设置）+ `petState()`（状态快照，推送可能早于本窗创建）
 *   · 增量：订阅 `pet:signal`（主进程归约九态后推送，见 electron/features/pet-state.ts）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PET_DEFAULT_COLUMNS, PET_DEFAULT_FRAME, PET_DEFAULT_ROWS, PET_FRAME_MS, PET_STATES, petAssetUrl, petFrameStyle, petRowOf, type PetStateId } from "./pet-format";

/** 空闲溜达的节奏：12~30s 一次，绕两圈（往右跑 → 往左跑）再回待机。 */
const WANDER_MIN_MS = 12_000;
const WANDER_MAX_MS = 30_000;
const WANDER_LEG_MS = 1_400;
/** 气泡停留时长（主进程给的是"当下一句"，过了就淡出，别一直挂着）。 */
const BUBBLE_MS = 4_000;

const EMPTY_SIGNAL = { state: "idle" as PetStateId, bubble: "", busy: 0, tool: null as string | null, ts: 0 };

export type PetFloatProps = {
  /** 舞台高度占窗口高度的比例（默认 0.66：上留气泡位、下留落地余量） */
  stageRatio?: number;
};

export function PetFloat({ stageRatio = 0.66 }: PetFloatProps) {
  const [pkg, setPkg] = useState<PetPackage | null>(null);
  const [signal, setSignal] = useState(EMPTY_SIGNAL);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  /** 本地叠加的"空闲随机小动作"（主进程不管这件事：浮窗关着时不该有任何动画开销） */
  const [wander, setWander] = useState<PetStateId | null>(null);
  const [renderedFrameHeight, setRenderedFrameHeight] = useState(0);
  const [frame, setFrame] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);

  /* ── 初始加载：设置里"当前生效的宠物包" ── */
  useEffect(() => {
    let alive = true;
    // 窗口标题：任务管理器/调试端口里一眼能认出这是宠物浮窗（不是主窗口）
    try { document.title = "桌面宠物"; } catch { /* 忽略 */ }
    void window.codex.petSettingsGet()
      .then((status) => { if (alive) setPkg(status?.active ?? null); })
      .catch(() => undefined);
    // 状态快照补水：主进程推送可能发生在本窗口创建之前（首帧就错过）
    void window.codex.petState()
      .then((state) => { if (alive && state?.signal) setSignal(state.signal as typeof EMPTY_SIGNAL); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /* ── 增量：主进程归约好的九态 ── */
  useEffect(() => window.codex.onPetSignal((next) => {
    if (next && typeof next === "object") setSignal(next as typeof EMPTY_SIGNAL);
  }), []);

  /* ── 增量：配置变更（换宠物 / 导入后重扫）──
     ⛔ 没有这条，设置页换了宠物，已开着的浮窗仍画旧那只（它只在挂载时读一次设置）——
     「切了没反应、重开应用才变」就是这里缺推送（09-30 用户实测）。 */
  useEffect(() => window.codex.onPetConfig((config) => {
    if (config && typeof config === "object") setPkg((config as PetStatus).active ?? null);
  }), []);

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
      // ⛔ 窗口被最小化/隐藏时不推进帧（白烧 CPU；桌宠常驻，这条尤其要紧）
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
    if (signal.state !== "idle") { setWander(null); return; }
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
  }, [signal.state]);

  const effectiveState = wander ?? signal.state;
  const geometry = useMemo(() => ({
    columns: pkg?.columns ?? PET_DEFAULT_COLUMNS,
    rows: pkg?.rows ?? PET_DEFAULT_ROWS,
    frameWidth: pkg?.frameWidth ?? PET_DEFAULT_FRAME.width,
    frameHeight: pkg?.frameHeight ?? PET_DEFAULT_FRAME.height,
  }), [pkg]);
  const row = petRowOf(pkg?.states ?? PET_STATES, effectiveState);
  const style = petFrameStyle(geometry, row, frame, renderedFrameHeight || geometry.frameHeight);

  const stopDrag = useCallback((event: React.MouseEvent) => { event.stopPropagation(); }, []);

  /* ── 透明区域鼠标穿透（10-09 用户报「软件外面无法点」）────────────────────
     窗口是透明矩形：图集帧四周、气泡区、落地余量都是看不见的窗口实体，整块默认
     都吃鼠标（还是 drag 区）⇒ 压在底下的桌面图标 / 其它窗口点不到。主进程已默认
     整块穿透（setIgnoreMouseEvents(true, {forward:true})）—— forward 让页面在穿透
     状态下**仍收到 mousemove**，这里按「指针是否落在宠物本体上」动态翻转：
     本体上 = 关穿透（可拖可点），四周 = 穿透放行。
     ⛔ 命中判定用 elementFromPoint 取**最深处**元素再 closest —— pet-stage 铺满
        整窗，直接拿它判会把四周也算进去（等于白修）。
     ⛔ 精灵盒是**近似**命中（图集帧内可能有透明留白），不逐像素测 alpha ——
        逐像素要常驻 canvas 采样，成本与收益不成比例；盒子已经把挡桌面的范围
        从「整个窗口」缩到「宠物本体那一格」。 */
  useEffect(() => {
    let raf = 0;
    let current: boolean | null = null;
    const overPet = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el && el.closest(".pet-sprite, .pet-missing"));
    };
    const apply = (over: boolean) => {
      if (current === over) return;
      current = over;
      void window.codex.petIgnoreMouse(!over).catch(() => undefined);
    };
    const onMove = (event: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (document.hidden) return;
        apply(overPet(event.clientX, event.clientY));
      });
    };
    /* 光标离开窗口（透明态下页面可能收不到收尾的 mousemove）⇒ 必须回到穿透，
       否则「从本体直接移出窗口」会把整块窗留在可交互态，继续挡桌面。 */
    const onLeave = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      apply(false);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="pet-float" ref={hostRef}>
      {signal.bubble && (
        <div className={`pet-bubble${bubbleVisible ? " is-visible" : ""}`} role="status" aria-live="polite">
          {signal.bubble}
          {signal.busy > 1 && <span className="pet-bubble-busy">×{signal.busy}</span>}
        </div>
      )}
      {/* 宠物本体：整个区域可拖动（-webkit-app-region: drag 在 CSS 里） */}
      <div className="pet-stage" title={pkg ? `${pkg.name}${pkg.description ? ` · ${pkg.description}` : ""}` : "没有可用的宠物包"}>
        {pkg && pkg.spritesheet ? (
          <div
            className="pet-sprite"
            style={{
              ...style,
              backgroundImage: `url("${petAssetUrl(pkg.spritesheet)}")`,
            }}
            onMouseDown={stopDrag}
          />
        ) : (
          <div className="pet-missing">
            <span>没有可用的宠物包</span>
            <span>在「设置 → 桌面宠物」里查看目录或导入</span>
          </div>
        )}
      </div>
    </div>
  );
}
