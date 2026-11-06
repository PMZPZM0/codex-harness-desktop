/**
 * 团队模式 · 消息刻度尺 + 放大镜（11-06）
 *
 * 用户：「把消息刻度放着，跟对话框的那个消息刻度线功能一样，然后还有放大镜功能」。
 * 位置 = 消息流右缘与成员栏之间那根竖槽（红框处），与主对话右侧刻度线同位。
 *
 * 与主对话 `SessionTurn/01-message-ruler.tsx` 同口径的三件事：
 *   ① 每条**人发的**消息一个刻度（伙伴回复是产出，不是会话锚点）；
 *   ② 视口上沿 30% 落在哪条上，哪条就是 current（跟随滚动）；
 *   ③ hover 刻度弹出**可交互放大镜**：附近消息的真实时间 + 正文预览，点一行跳过去，
 *      面板内滚轮一次一格换高亮行（`passive:false` + preventDefault，⛔ 不让消息流跟着滚）。
 *
 * ⛔ 为什么不直接复用主对话组件：它吃 `Turn[]`（引擎回合模型）+ 压缩标记 + 声音/波浪，
 *   群消息是 `GroupMessageRow[]` 投影。硬套要改 530 行主链路或伪造 Turn，收益为负。
 *   板块内保留同样交互、同样类名（`.ruler-lens*`），另写群作用域样式。
 * ⛔ 只有 1 条人消息也要画刻度：以前 `marks.length < 2` 直接 return ⇒ 刻度槽全空（用户截图里那根空白竖条）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { GroupMessageRow } from "./01-team-types";
import { contentOffsetTop } from "../../components/scroll-utils";

/** 最多画多少刻度（多了会挤成一根柱，且群里没人会靠刻度翻 400 条）。 */
const MAX_TICKS = 40;
const SLOT = 10;
/** 放大镜：最多 9 行、每行 26px、上下各 4px 呼吸（与主对话 LENS_ROWS/LENS_ROW 同值）。 */
const LENS_ROWS = 9;
const LENS_ROW = 26;

type Mark = { key: string; itemId: string; at: number; label: string };

export function TeamRuler({ rows, scrollRef }: { rows: GroupMessageRow[]; scrollRef: RefObject<HTMLDivElement | null> }) {
  const marks = useMemo<Mark[]>(
    () => rows
      .filter((r) => r.authorKind === "human" && String(r.text ?? "").trim())
      .map((r) => ({
        key: r.key,
        itemId: r.itemId,
        at: r.at,
        label: `${new Date(r.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} ${String(r.text).replace(/\s+/g, " ").slice(0, 60)}`,
      }))
      .slice(-MAX_TICKS),
    [rows],
  );
  const [current, setCurrent] = useState("");
  const [lens, setLens] = useState<{ index: number; top: number } | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || marks.length < 1) return;
    let raf = 0;
    const update = () => {
      const nodes = Array.from(el.querySelectorAll<HTMLElement>("[data-item]"));
      const probe = el.scrollTop + el.clientHeight * 0.3;
      let cur = "";
      for (const node of nodes) {
        if (contentOffsetTop(node, el) <= probe) cur = node.dataset.item ?? cur;
        else break;
      }
      setCurrent(cur);
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
    };
    update();
    el.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [scrollRef, marks.length]);

  /* 放大镜里的滚轮：⛔ React 的 onWheel 是 passive，preventDefault 会被忽略，
     所以按主对话同款用 ref + useEffect 绑 `passive:false` 的原生监听。 */
  useEffect(() => {
    const node = panelRef.current;
    if (!node || !lens) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.deltaY > 0 ? 1 : -1;
      setLens((cur) => cur ? { ...cur, index: Math.max(0, Math.min(marks.length - 1, cur.index + step)) } : cur);
      setPick(null);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [lens, marks.length]);

  if (marks.length < 1) return null;

  const jump = (itemId: string) => {
    const el = scrollRef.current;
    if (!el) return;
    const node = el.querySelector<HTMLElement>(`[data-item="${CSS.escape(itemId)}"]`);
    /* ⛔ 目标可能还没进分页窗口（更早的消息没渲染）——那就明说，别装作跳过去了 */
    if (!node) return;
    node.scrollIntoView({ block: "center" });
  };

  const openLens = (index: number, clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLens({ index, top: Math.max(4, Math.min(clientY - rect.top - LENS_ROW / 2, Math.max(4, rect.height - 60))) });
    setPick(null);
  };

  /* 可见窗口整体夹住：⛔ 别让高亮行在边界处上下各空一半（主对话 11-01 实测修过的同型问题）。 */
  const active = lens ? Math.min(lens.index, marks.length - 1) : -1;
  const visible = Math.min(LENS_ROWS, marks.length);
  const start = Math.max(0, Math.min(active - Math.floor((visible - 1) / 2), marks.length - visible));
  const shown = lens ? marks.slice(start, start + visible) : [];
  const panelH = visible * LENS_ROW + 8;

  return (
    <div className="team-ruler" role="navigation" aria-label="消息定位" onMouseLeave={() => { setLens(null); setPick(null); }}>
      <div className="team-ruler__track" ref={trackRef}>
        {marks.map((m, i) => (
          <button
            key={m.key}
            type="button"
            className={`team-ruler__tick${m.itemId === current ? " is-current" : ""}${lens && active === i ? " is-lens" : ""}`}
            title={m.label}
            aria-label={`跳到 ${m.label}`}
            onMouseEnter={(e) => openLens(i, e.clientY)}
            onClick={() => jump(m.itemId)}
            style={{ height: 2, marginBottom: SLOT - 2 }}
          />
        ))}
        {lens && (
          <div
            className="ruler-lens"
            style={{ top: lens.top, height: panelH }}
            role="menu"
            aria-label="附近消息（可点击跳转、可滚动）"
            ref={panelRef}
          >
            {shown.map((m, offset) => {
              const i = start + offset;
              const focus = pick != null ? Math.min(pick, marks.length - 1) : active;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="menuitem"
                  title={m.label}
                  className={`ruler-lens-row${i === focus ? " is-active" : ""}`}
                  onMouseEnter={() => setPick(i)}
                  onClick={() => { jump(m.itemId); setLens(null); setPick(null); }}
                >
                  <span className="ruler-lens-text">{m.label.replace(/\s+/g, " ").trim()}</span>
                  <i className="ruler-lens-dash" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
