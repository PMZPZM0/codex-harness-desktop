/**
 * SessionTurn 的「message-ruler」部分（09-22 从同目录 SessionTurn.tsx 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import { Turn } from "../../../lib/turn";
import { useEffect, useMemo, memo, useState, useRef } from "react";
import { useRefObject } from "../../../lib/use-ref-object";
import { itemText } from "../../../lib/item-text";
import { userDisplayText } from "../../../lib/user-refs";
import { playWheelTick } from "../../../lib/wheel-tick.mjs";
const RULER_PAGE = 5;

export type RulerMark = { id: string; turnId: string; itemId: string; type: "user" | "agent"; label: string };

/** 刻度数 = 有内容的消息数（一条消息一个刻度），窗口固定 50 条，随滚动位置滑动 */

const RULER_MAX = 50;

export function MessageRuler({ turns, onJump, scrollRef, containerRef }: { turns: Turn[]; onJump: (id: string) => void; scrollRef: useRefObject; containerRef: useRefObject }) {
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
        const label = userDisplayText(itemText(item));
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
        if (el.offsetTop <= probe) current = el.dataset.itemId ?? current;
        else break;
      }
      setCurrentItemId(current);
    };
    update();
    // rAF 节流：scroll/resize 高频触发，直接跑 update 会读 offsetTop/scrollTop 强制同步布局
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
    };
    // 依赖里绝不能放 turns：流式出字每帧都换引用，会重建监听器 + ResizeObserver，
    // 并每帧强制同步布局 —— 这是长回复越往后越卡的主要来源之一。
    // 元素在 update 内部实时查询 DOM，只需在刻度数量变化时重建监听。
  }, [scrollRef, allMarks.length]);
  // 没有用户消息、内容不满一屏、或容器太窄（右侧面板打开压窄 timeline）时自动隐藏刻度尺。
  // 专家/专家团会话常常只有一条任务消息 + 超长执行输出，内容早就可滚了，
  // 若仍要求 ≥2 条用户消息，这类窗口永远没有刻度线 —— 放宽为 ≥1 条即可定位回任务消息。
  if (allMarks.length < 1 || !scrollable || containerNarrow) return null;
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
            playWheelTick(direction);
          }, { passive: false });
        }}
        onMouseLeave={() => { setHoverIndex(null); setTip(null); }}
      >
        {marks.map((mark, index) => {
          // 波浪效果：hover 刻度最长，上下邻刻度按距离衰减（1.4x、0.9x、0.7x），
          // 且向对话框一侧（右侧）伸长；配合错峰 transition 产生丝滑波浪
          const dist = hoverIndex == null ? 99 : Math.abs(index - hoverIndex);
          const wave = dist === 0 ? " wave-0" : dist === 1 ? " wave-1" : dist === 2 ? " wave-2" : "";
          return (
            <button
              key={mark.id}
              className={`ruler-tick ${mark.type} ${mark.id === latestId ? "latest" : ""} ${mark.itemId === currentItemId ? "current" : ""}${wave}`}
              onMouseEnter={(event) => { setHoverIndex(index); setTip({ text: mark.label, top: event.currentTarget.offsetTop + event.currentTarget.offsetHeight / 2 }); }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onJump(mark.turnId)}
              aria-label={mark.label}
            />
          );
        })}
        {tip && <div className="ruler-tip" style={{ top: tip.top }}>{tip.text}</div>}
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
  && (prev.turns === next.turns || userMarksKey(prev.turns) === userMarksKey(next.turns)),
);
