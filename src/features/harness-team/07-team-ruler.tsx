/**
 * 团队模式 · 消息刻度尺（11-06，用户：「还有刻度线那些那些」）
 *
 * 主对话右侧那根刻度线（`SessionTurn/01-message-ruler.tsx`）的**板块内轻量版**：
 *   · 每条**人发的**消息一个刻度（伙伴的回复是产出，不是会话锚点 —— 与主对话口径一致）；
 *   · 视口上沿 30% 处落在哪条上，哪条就是 current（跟随滚动）；
 *   · 点刻度 = 滚到那条消息（`data-item` 已在群视图的 article 上，锚点复用）。
 *
 * ⛔ 为什么不直接复用 MessageRuler：它吃的是 `Turn[]`（引擎回合模型）+ 压缩标记 + 放大镜/声音，
 *   群消息是 `GroupMessageRow[]` 投影。硬套要么改 530 行的主链路组件，要么在群侧伪造 Turn。
 *   板块内自己画一根（60 行）更安全，也符合「新功能独立板块」的纪律。
 * ⛔ 不做放大镜/波浪/声音：那三样是为"长会话里找一条"设计的，群里几十条消息，刻度本身够用。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { GroupMessageRow } from "./01-team-types";
import { contentOffsetTop } from "../../components/scroll-utils";

/** 最多画多少刻度（多了会挤成一根柱，且群里没人会靠刻度翻 400 条）。 */
const MAX_TICKS = 40;
const SLOT = 10;

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
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || marks.length < 2) return;
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

  if (marks.length < 2) return null;

  const jump = (itemId: string) => {
    const el = scrollRef.current;
    if (!el) return;
    const node = el.querySelector<HTMLElement>(`[data-item="${CSS.escape(itemId)}"]`);
    /* ⛔ 目标可能还没进分页窗口（更早的消息没渲染）——那就明说，别装作跳过去了 */
    if (!node) return;
    node.scrollIntoView({ block: "center" });
  };

  return (
    <div className="team-ruler" role="navigation" aria-label="消息定位">
      <div className="team-ruler__track" ref={trackRef}>
        {marks.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`team-ruler__tick${m.itemId === current ? " is-current" : ""}`}
            title={m.label}
            aria-label={`跳到 ${m.label}`}
            onClick={() => jump(m.itemId)}
            style={{ height: 2, marginBottom: SLOT - 2 }}
          />
        ))}
      </div>
    </div>
  );
}
