/**
 * SessionTurn 的「message-ruler」部分（09-22 从同目录 SessionTurn.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Turn } from "../../../lib/turn";
import { Fragment, useEffect, useMemo, memo, useState, useRef } from "react";
import { useRefObject } from "../../../lib/use-ref-object";
import { itemText } from "../../../lib/item-text";
import { parseUserRefs, userDisplayText } from "../../../lib/user-refs";
import { playWheelTick } from "../../../lib/wheel-tick.mjs";
import { isHiddenNoticeBlock } from "../../../lib/visible-group-blocks.mjs";
import { contentOffsetTop } from "../../../components/scroll-utils";
const RULER_PAGE = 5;
/** 单槽高度：2px 线 + 上下 6px 命中区 = 14px（与 CSS 同口径；悬停/容量估算都用它） */
const RULER_SLOT = 14;

/* ── 放大镜（10-31 用户：「刻度线放上去能不能做出这种放大镜效果，找起来更快」）──────────
   ⛔ 不是把刻度整体做大（那只是变粗），而是**指针附近的一小段被放大、往外散开**：
      · 刻度本身：以指针为中心做鱼眼位移（14px 槽 → 中心约 25px），越远越回到原位；
      · 右侧镜头面板：把这段真实消息预览按 26px 一行列出来，行跟着指针滑（=「里面滚动」）。
   两者同一套物理：中心放大率 = 1 + LENS_SPREAD ⇒ 14px 槽在中心变成 ≈ 25px，与 LENS_ROW(26) 对齐。
   ⛔ σ 决定「放大镜口径」：36px ≈ 中心 ±2.5 格，再远就回到原间距（口径太大整根尺子都在抖）。 */
const LENS_ROW = 26;              // 面板行高（= 放大后的一格间距）
const LENS_ROWS = 9;              // 面板可见行数
const LENS_H = LENS_ROW * LENS_ROWS;
const LENS_REACH = 9;             // 面板上下各多渲染几行：给滑动进出的余量（多出来的会被裁掉）
const LENS_SPREAD = 0.85;         // 中心放大率 - 1
const LENS_SIGMA = 36;            // 高斯口径（px）

/** 鱼眼位移：d = 元素基准中心到指针的距离 ⇒ 位移 d·SPREAD·e^(-d²/2σ²)。
 *  ⛔ 必须用这份「连续放大映射」而不是 sign(d)·A·falloff(d)：后者在 d=0 处符号翻转，
 *    正上/正下两根刻度会在指针处**瞬跳**一个 A（看起来像抖了一下）。本式在 d=0 处恒为 0 且单调
 *    （f'(d) 最小值 ≈0.55 > 0，两根刻度永远不会交叉）。 */
const fanDy = (base: number, pointerY: number) => {
  const d = base - pointerY;
  return d * LENS_SPREAD * Math.exp(-(d * d) / (2 * LENS_SIGMA * LENS_SIGMA));
};

export type RulerMark = { id: string; turnId: string; itemId: string; type: "user" | "agent"; label: string };

/** 刻度数 = 有内容的消息数（一条消息一个刻度），窗口固定 50 条，随滚动位置滑动 */

const RULER_MAX = 50;

export function MessageRuler({ turns, onJump, scrollRef, containerRef, compactionTurnId, compactionAtEnd }: { turns: Turn[]; onJump: (id: string) => void; scrollRef: useRefObject; containerRef: useRefObject; /** 压缩线所在回合（green 标记画在该回合用户消息的刻度之前；空串 = 无压缩线） */ compactionTurnId?: string; /** 压缩发生在最后一回合**之后**（手动压缩的空回合被过滤掉）⇒ 绿段画在最后一个刻度之后 */ compactionAtEnd?: boolean }) {
  /* 放大镜状态：index = 指针下的刻度，cy = 指针在**内容坐标**里的位置（刻度中心同坐标系），
     top / rowY = 面板在轨道里的落点与「当前行」在面板内的纵向位置（面板贴边时会被钳制，
     所以 rowY 不能恒等于面板半高）。⛔ 每次 mousemove 都会更新 cy（鱼眼位移要用连续值，
     只给 index 的话刻度会在两格之间"跳"）。 */
  const [lens, setLens] = useState<{ index: number; cy: number; top: number; rowY: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  /* ⛔⛔ 10-26 二次事故：lastHoverRef 一度声明在下方 `if (…) return null` **之后** ⇒
     提前 return 的渲染少调一个 hook ⇒ React #310 渲染层整页崩溃（用户截图实锤）。
     hook 必须全部落在组件顶部 hooks 区 —— 提前 return 的组件里加 hook，只许加在这里。 */
  const lastHoverRef = useRef<number | null>(null);
  /* 波浪**只在滚轮滚动时**出现（10-24 用户：「默认不触发波浪效果，只有滚轮滚动的时候才触发」
     「现在不滚动也触发，看着不太舒服」）。hover 是显式交互，仍然以鼠标位置为准。 */
  const [wheelWave, setWheelWave] = useState(false);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const [containerNarrow, setContainerNarrow] = useState(false);
  // 容器宽度不足时（如右侧面板打开后 timeline-wrap 被压窄）自动隐藏刻度尺，避免侵入消息内容
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const check = () => {
      // 720px 是消息区可接受的最小宽度：低于此值时刻度尺会让 agent 气泡可读性变差
      setContainerNarrow(container.clientWidth < 720);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
  const allMarks = useMemo<RulerMark[]>(() => {
    const result: RulerMark[] = [];
    for (const turn of turns) {
      for (const item of turn.items) {
        // 刻度只对应用户消息，agent 消息不参与
        if (item.type !== "userMessage") continue;
        if (!itemText(item).trim()) continue;
        // 团队/成员会话首条 SYSTEM TASK 段不展示给用户（与气泡/复制/编辑一致）
        const raw = itemText(item);
        const label = userDisplayText(raw);
        /* ⛔⛔ 10-26 用户：「中枢会话刻度线要对应消息和群里展示的事件，不要对应那些不展示的」
           ⇒ 判据不是"文本长得像刷屏"，而是**与群汇报卡同一份可见性**：
             群事件里有能展示的块才出刻度；全是已废弃刷屏通知 ⇒ 界面根本不渲染它 ⇒ 也不该占刻度。
           ⛔ 别再拿整段文本去套正则 —— 一条群事件可能混着"能显示的结论"和"该隐藏的通知"。
           ⛔⛔ 10-26 审查补：判据必须与气泡/位置**同源**，即 parseUserRefs 剥掉注入段之后的
             `groupEvents`。原先这里读的是**原文**（visibleGroupBlocks 直接传 raw）——注入的记忆 /
             引用记录里若有一行**以** `[群事件]` 开头，这条普通消息就被算成群广播：块被全部过滤时
             它的刻度直接消失（气泡照常显示）。与用户报的「倒反天罡」是同一类错：判在原文上。 */
        const groupBlocks = raw.includes("[群事件]") ? parseUserRefs(raw).groupEvents : undefined;
        if (groupBlocks && groupBlocks.every(isHiddenNoticeBlock)) continue;
        result.push({ id: `${turn.id}-${item.id}`, turnId: turn.id, itemId: item.id, type: "user", label: label || "（仅系统任务段）" });
      }
    }
    return result;
  }, [turns]);

  const currentIndex = useMemo(() => {
    if (!currentItemId) return allMarks.length - 1;
    const idx = allMarks.findIndex((m) => m.itemId === currentItemId);
    return idx < 0 ? allMarks.length - 1 : idx;
  }, [allMarks, currentItemId]);

  // 刻度尺独立滚轮：悬停刻度尺时滚轮滑动选区的窗口起点（不滚对话内容）；
  // 滚动对话内容或跳转时偏移自动归零，回到跟随模式
  const [windowOffset, setWindowOffset] = useState(0);
  // 只在「阅读位置（currentIndex）」变化时把选区滑回跟随模式：加载新页（allMarks 变多）
  // 不该把刻度选区拽回最新——用户往上滚看历史时，新加载的页要出现在他正看的那一段。
  useEffect(() => { setWindowOffset(0); }, [currentIndex]);

  // 可视容量：轨道高度能容纳多少刻度就显示多少（动态测量，**固定槽高**）；
  // 超出的用独立滚轮滑窗口、窗口起点跟滚动位置走（09-18 用户改口径：「跟着懒加载来 /
  // 滚动渲染刻度线」——不再把已加载的全部挤上尺子：那是 09-14 的口径，页数一多
  // 全部压缩塞进来成一根密集柱，且与当前视口毫无对应关系）。
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  /** 固定槽高 = 线 2px + 2×pad(4) + gap(4) = 14px。⛔ 不再按刻度总数反解压缩 pad —— 那正是
   *  「往上滚过就一直透出」的来源。09-15 的教训保留：高度为 0（媒体查询 display:none）时
   *  不上报，否则 pad/容量被污染成 0；依赖必须含 containerNarrow（组件卸载重建后要重绑观察）。 */
  useEffect(() => {
    if (!scrollable) return;
    const measure = () => {
      const track = trackRef.current;
      if (!track) return;
      const h = track.clientHeight;
      if (!h) return; // 不可见时不上报（否则容量被写成 0，恢复可见后刻度挤成一团）
      setVisibleCount(Math.max(4, Math.floor(h / 14)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    return () => observer.disconnect();
  }, [scrollable, containerNarrow]);

  // 窗口容量封顶（RULER_MAX）：轨道再高，一屏最多 50 个刻度——「已加载页数再多也不会
  // 全量透出」，超出部分靠滚动/滚轮滑窗口看到。
  const windowSize = Math.min(Math.max(4, visibleCount), RULER_MAX);
  const marks = useMemo(() => {
    if (allMarks.length <= windowSize) return allMarks;
    let start = Math.max(0, Math.min(currentIndex + windowOffset, allMarks.length - windowSize));
    let end = start + windowSize;
    if (end > allMarks.length) {
      end = allMarks.length;
      start = end - windowSize;
    }
    return allMarks.slice(start, end);
  }, [allMarks, currentIndex, windowOffset, windowSize]);

  const latestId = allMarks.length ? allMarks[allMarks.length - 1].id : null;

  // ⛔ 滚轮监听在挂载时只绑一次（下面的 wheelBound 守卫），闭包里直接读 state 变量会
  // 永远停在首帧值（stale closure）——allMarks/windowSize/currentIndex/windowOffset 一律
  // 经这个 ref 取当前渲染的最新值；滑窗要靠 currentIndex 做钳制，读到旧值就会越界滑。
  const wheelCtxRef = useRef({ allMarks, windowSize, currentIndex, windowOffset });
  wheelCtxRef.current = { allMarks, windowSize, currentIndex, windowOffset };

  /* 声音反馈（10-26 用户：「触发波浪效果没有声音反馈」）——
     原来的咔哒声只挂在**刻度尺自身**的滚轮上（滑选区），滚动消息触发的波浪是静音的。
     现在改成「阅读位置跨过一条消息就咔哒一声」：一格里最多一声，快速连滚不会糊成噪音
     （playWheelTick 内部另有 30ms 节流）；方向跟随本次滚轮方向，与刻度尺自身滚轮同一套音色。 */
  const waveRef = useRef(false);
  const waveDirRef = useRef(1);
  const prevMarkRef = useRef<string | null>(null);

  // 滚动联动：视口上沿 30% 处落在哪条消息上，就高亮对应刻度
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => {
      // 内容不满一屏（如单条消息）时没有滚动意义，刻度尺随之隐藏
      setScrollable(scroller.scrollHeight - scroller.clientHeight > 80);
      // 只扫描用户消息（刻度只对应用户消息），视口上沿 30% 处落在哪条用户消息上就高亮对应刻度
      const elements = Array.from(scroller.querySelectorAll<HTMLElement>('[data-ruler-mark="user"]'));
      if (!elements.length) { setCurrentItemId(null); return; }
      const probe = scroller.scrollTop + scroller.clientHeight * 0.3;
      let current: string | null = null;
      for (const el of elements) {
        /* ⛔ 不能用 el.offsetTop：用户消息的 offsetParent 是 .turn-group（position:relative），
           量到的是回合内部偏移（几乎恒 0）⇒ 当前刻度永远落在最后一条消息上。
           用内容坐标（含顶部历史占位区）才能跟着视口真实滚动位置走。 */
        if (contentOffsetTop(el, scroller) <= probe) current = el.dataset.itemId ?? current;
        else break;
      }
      setCurrentItemId(current);
      /* ⛔ 只在「滚轮滚动期间」且**跨过了一条消息**时响一声；静止、程序化滚动、跳转都不出声。 */
      /* ⛔ 独立通道（scroll）：与 hover / 刻度尺自身滚轮互不吞声音 */
      if (waveRef.current && current && current !== prevMarkRef.current) {
        playWheelTick(waveDirRef.current, { channel: "scroll", minGapMs: 28 });
      }
      prevMarkRef.current = current;
    };
    update();
    // rAF 节流：scroll/resize 高频触发，直接跑 update 会读 offsetTop/scrollTop 强制同步布局
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
    };
    /* 波浪开关：只有真实滚轮输入才点亮（程序化滚动、贴底跟随、点击跳转都不算）。
       最后一次滚轮后 600ms 自动收起 —— 用户要的是「滚动时才有波浪」，不是常驻呼吸。 */
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      waveRef.current = true;
      waveDirRef.current = event.deltaY > 0 ? 1 : -1;
      setWheelWave(true);
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { waveRef.current = false; setWheelWave(false); }, 600);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (wheelTimer) clearTimeout(wheelTimer);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("wheel", onWheel);
    };
    // 依赖里绝不能放 turns：流式出字每帧都换引用，会重建监听器 + ResizeObserver，
    // 并每帧强制同步布局 —— 这是长回复越往后越卡的主要来源之一。
    // 元素在 update 内部实时查询 DOM，只需在刻度数量变化时重建监听。
  }, [scrollRef, allMarks.length]);
  // 没有用户消息、内容不满一屏、或容器太窄（右侧面板打开压窄 timeline）时自动隐藏刻度尺。
  // 专家/专家团会话常常只有一条任务消息 + 超长执行输出，内容早就可滚了，
  // 若仍要求 ≥2 条用户消息，这类窗口永远没有刻度线 —— 放宽为 ≥1 条即可定位回任务消息。
  if (allMarks.length < 1 || !scrollable || containerNarrow) return null;
  /* 当前阅读位置在**渲染出来的这一段刻度**里的下标。自动波浪以它为中心：
     往上/往下滚动 → currentItemId 变化 → 波浪跟着走（CSS transition 把相邻刻度
     的长度变化错峰，形成用户要的“波浪”；hover 时以鼠标位置为准）。 */
  /* ⛔⛔ 10-26 用户：「从上往下有声音，从下往上没声音」——实测三个方向的声音全排出来了
     （分方向埋点 8/8/8），根因是 **playWheelTick(-1) 恒传 -1 ⇒ 两个方向都是同一个 2300Hz 高音**：
     往下划是"第一次听到"（有声音感），划回去音调一模一样 + 快速扫回被节流压密 ⇒
     听觉适应后感知成"没声音"。棘轮滚轮本来就有方向音（上滑高/下滑低），悬停却恒定。
     ⇒ 悬停补方向音：往下划低音 / 往上划高音（与棘轮同一套方向语义）。
     ⛔ 判定上一格必须用 lastHoverRef（声明在组件顶部 hooks 区，⛔ 不能在这里 useRef ——
        上面有提前 return，条件 hook = React #310）；hoverIndex 是渲染闭包的旧值，快速划动时方向必算错。 */
  const hoverAt = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const total = marks.length;
    if (!total) return;
    /* ⛔⛔ 10-26 用户：「声音触发有延迟，延迟还挺高」——
       原来是**每根刻度读一次 getBoundingClientRect**（12~50 次强制同步布局/mousemove）⇒
       主线程被拖住，声音排到后面才发。
       轨道是 `justify-content: center` + 每槽固定 14px ⇒ 直接算，**一次 rect 读都不需要每个元素**。 */
    const rect = track.getBoundingClientRect();
    const startY = rect.top + Math.max(0, (rect.height - total * RULER_SLOT) / 2);
    /* 内容在轨道里的居中留白：放大镜的「镜头」也活在同一个内容坐标系里 */
    const pad = startY - rect.top;
    let best = Math.floor((clientY - startY) / RULER_SLOT);
    if (best < 0) best = 0;
    if (best >= total) best = total - 1;
    const prev = lastHoverRef.current;
    if (best !== prev) {
      lastHoverRef.current = best;
      setHoverIndex(best);
      /* 往上划（best 变小）= 看更早 = 高音；往下划 = 低音 —— 方向立即可辨。
         24ms（原 45ms）：快速扫回时出声密度翻倍，「划回去没声音」的密度问题一并解决。 */
      playWheelTick(prev == null || best > prev ? 1 : -1, { channel: "hover", minGapMs: 24 });
    }
    /* 放大镜：锚点 = 指针下那根刻度的中心（轨道坐标）⇒ 面板以它为纵向中心，
       贴到轨道上下边时**只钳面板框**、不钳锚点（否则高亮行会离开指针，看着像串了行）。 */
    const anchor = best * RULER_SLOT + RULER_SLOT / 2 + pad;
    const top = Math.min(Math.max(anchor - LENS_H / 2, 4), Math.max(4, rect.height - LENS_H - 4));
    /* ⛔ rowY 是行的**顶边**：要让高亮行的中线落在锚点上，必须再减半个行高
       （漏了这 13px，字会比指针下那根刻度低半行，看着像串行）。 */
    setLens({ index: best, cy: clientY - startY, top, rowY: anchor - top - LENS_ROW / 2 });
  };

  const currentPos = currentItemId ? marks.findIndex((m) => m.itemId === currentItemId) : -1;
  /* 绿段也占一个 14px 槽 ⇒ 它之后的刻度槽位要 +1（否则放大镜的口径会整体错一格）。 */
  const compactionIndex = compactionTurnId ? marks.findIndex((m) => m.turnId === compactionTurnId) : -1;
  const slotOf = (index: number) => index + (compactionIndex >= 0 && index >= compactionIndex ? 1 : 0);
  /** 刻度（按**槽位**而非下标）的鱼眼位移；|dy|<0.2px 视作原位，不发内联样式（少一半 diff） */
  const fanStyleOf = (slot: number) => {
    if (!lens) return undefined;
    const dy = fanDy(slot * RULER_SLOT + RULER_SLOT / 2, lens.cy);
    return Math.abs(dy) < 0.2 ? undefined : { translate: `0 ${dy.toFixed(1)}px` };
  };
  return (
    <div className="message-ruler" role="navigation" aria-label="消息定位">
      <div
        className="ruler-track"
        ref={(node) => {
          trackRef.current = node;
          // 独立滚轮：悬停刻度尺时滚轮只滑刻度选区（原生非 passive 监听才能 preventDefault），
          // 不滚动对话内容
          if (!node || node.dataset.wheelBound) return;
          node.dataset.wheelBound = "1";
          node.addEventListener("wheel", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const ctxNow = wheelCtxRef.current;
            if (ctxNow.allMarks.length <= ctxNow.windowSize) return;
            const direction = event.deltaY > 0 ? 1 : -1;
            const maxOffset = ctxNow.allMarks.length - ctxNow.windowSize - ctxNow.currentIndex;
            // 滚轮一次滑**一页**（与消息懒加载的每页 TURNS_PAGE 个用户消息对齐，
            // 用户 09-14：「滚轮也要同步最新每页」）。
            const next = Math.max(-ctxNow.currentIndex, Math.min(maxOffset, ctxNow.windowOffset + direction * RULER_PAGE));
            // 到顶/到底窗口不动 → 静默（自然的边界反馈）；真移动 → 滑一声棘轮咔哒（09-19 用户要求的声音反馈）
            if (next === ctxNow.windowOffset) return;
            setWindowOffset(next);
            playWheelTick(direction, { channel: "ruler", minGapMs: 30 });
          }, { passive: false });
        }}
        onMouseMove={(event) => hoverAt(event.clientY)}
        onMouseLeave={() => { lastHoverRef.current = null; setHoverIndex(null); setLens(null); }}
      >
        {marks.map((mark, index) => {
          /* ⛔ 10-18 用户：「刻度线里面如那两个中间产生压缩线，就在那两个中间产生一个绿色线」——
             段位固定 14px（2+8 padding+4 gap），与刻度槽同高 ⇒ 不破坏 visibleCount = h/14 的容量计算。 */
          const compactionHere = Boolean(compactionTurnId) && mark.turnId === compactionTurnId;
          /* 波浪中心：hover 优先；否则只在**滚轮滚动期间**跟当前阅读位置
             （视口 30% 处的那条用户消息）。静止时 activeIndex = null ⇒ 全部回到普通长度。 */
          const activeIndex = hoverIndex != null ? hoverIndex : (wheelWave && currentPos >= 0 ? currentPos : null);
          const dist = activeIndex == null ? 99 : Math.abs(index - activeIndex);
          const wave = dist === 0 ? " wave-0" : dist === 1 ? " wave-1" : dist === 2 ? " wave-2" : "";
          return (
            <Fragment key={mark.id}>
              {compactionHere && <button
                type="button"
                className={`ruler-compaction${wave}`}
                style={fanStyleOf(slotOf(index))}
                title="上下文已压缩（点击跳到该回合）"
                aria-label="上下文已压缩，点击跳到该回合"
                data-turn-id={mark.turnId}
                onClick={() => onJump(mark.turnId)}
              />}
              <button
              className={`ruler-tick ${mark.type} ${mark.id === latestId ? "latest" : ""} ${mark.itemId === currentItemId ? "current" : ""}${wave}`}
              style={fanStyleOf(slotOf(index))}
              onClick={() => onJump(mark.turnId)}
              aria-label={mark.label}
              data-turn-id={mark.turnId}
              data-item-id={mark.itemId}
              />
            </Fragment>
          );
        })}
        {compactionAtEnd && (() => {
          /* 末尾绿段也参与波浪：以最后一根刻度为邻（它是“之后”的那条线）。 */
          const endIndex = marks.length - 1;
          const activeIndex = hoverIndex != null ? hoverIndex : (wheelWave && currentPos >= 0 ? currentPos : null);
          const dist = activeIndex == null || endIndex < 0 ? 99 : Math.abs(endIndex - activeIndex);
          const endWave = dist === 0 ? " wave-0" : dist === 1 ? " wave-1" : dist === 2 ? " wave-2" : "";
          return (
            <button
              type="button"
              className={`ruler-compaction${endWave}`}
              title="上下文已压缩（刚发生在最后一条消息之后，点击跳到最新回合）"
              aria-label="上下文已压缩，点击跳到最新回合"
              data-turn-id={allMarks[allMarks.length - 1]?.turnId ?? ""}
              onClick={() => { const last = allMarks[allMarks.length - 1]; if (last) onJump(last.turnId); }}
              style={fanStyleOf(marks.length + (compactionIndex >= 0 ? 1 : 0))}
            />
          );
        })()}
        {/* ── 放大镜镜头（10-31）：指针附近那一段刻度被放大成 26px 一行，右侧竖列出真实消息预览。
            行的纵向位置 = rowY + (i - index) × LENS_ROW ⇒ 指针下移一格时整列往上滑一行（=「里面滚动」）。
            ⛔ 面板只做展示（pointer-events: none）：鼠标始终留在 30px 刻度轨上，靠轨道的 mousemove 驱动，
               一旦让面板吃指针，滑进面板就会触发轨道的 mouseleave（镜头当场消失）。 */}
        {lens && marks.length > 0 && (
          <div className="ruler-lens" style={{ top: lens.top }} aria-hidden="true">
            {(() => {
              /* ⛔ active 必须夹住：滚轮滑窗口 / 刻度变少时 marks 会换一批，
                 lens.index 是上一次 mousemove 留下的旧下标，越界就是 marks[i] undefined ⇒ 整页崩。 */
              const active = Math.min(lens.index, marks.length - 1);
              const rows: number[] = [];
              const from = Math.max(0, active - LENS_REACH);
              const to = Math.min(marks.length - 1, active + LENS_REACH);
              for (let i = from; i <= to; i++) rows.push(i);
              return rows.map((i) => {
                const dist = Math.abs(i - active);
                return (
                  <div
                    key={marks[i].id}
                    className={`ruler-lens-row${dist === 0 ? " is-active" : ""}`}
                    style={{
                      translate: `0 ${(lens.rowY + (i - active) * LENS_ROW).toFixed(1)}px`,
                      opacity: Math.max(0.08, 1 - dist * 0.16),
                    }}
                  >
                    <span className="ruler-lens-text">{marks[i].label.replace(/\s+/g, " ").trim()}</span>
                    <i className="ruler-lens-dash" />
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function userMarksKey(turns: Turn[]) {
  let key = "";
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.type !== "userMessage") continue;
      const text = String(itemText(item) ?? "").trim();
      if (text) key += `${turn.id}|${item.id}|${text.length}|${text.slice(0, 32)};`;
    }
  }
  return key;
}

export const MemoMessageRuler = memo(MessageRuler, (prev, next) =>
  prev.scrollRef === next.scrollRef
  && prev.onJump === next.onJump
  && (prev.turns === next.turns || userMarksKey(prev.turns) === userMarksKey(next.turns))
  && prev.compactionTurnId === next.compactionTurnId
  && prev.compactionAtEnd === next.compactionAtEnd,
);
