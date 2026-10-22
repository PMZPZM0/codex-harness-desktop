/**
 * 办公室 · 白色简洁工位板（2026-10-22 对照 Marvis workbench 重做）
 *
 * 参考图（用户提供）：纯白背景，白色 3D 办公桌 + 黑色显示器 + 白/灰办公椅 +
 * 黑猫成员（彩色围巾），名字标在显示器上方；左侧茶水间/跑步机/洗手间。
 *
 * 我们的做法：
 *   · 家具/设施 = **本仓生成的白底 3D 渲染图**（`assets/*.webp`，白底 + multiply 融进白板），
 *     ⛔ 不搬 Marvis 的美术资产；
 *   · 猫 = 3D 多角度渲染图（坐姿背对镜头 / 站姿正面；红围巾 hue-rotate 分色），状态跟真实运行阶段联动；
 *   · 一页 6 个工位（2 列 × 3 排，照参考图尺寸）；成员 >6 时分页（10 个工位 = 2 页），
 *     ⛔ 不是把 10 个压成小图标；
 *   · 每台显示器叠实时内容（状态色代码条 + 扫描线）；悬停出详情卡、点击进会话；
 *   · 缩放/平移沿用同一套舞台 transform（contain 基准 + 指针锚点）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import deskUrl from "./assets/desk.webp?inline";
import chairWhiteUrl from "./assets/chair-white.webp?inline";
import coffeeUrl from "./assets/coffee.webp?inline";
import treadmillUrl from "./assets/treadmill.webp?inline";
import toiletUrl from "./assets/toilet.webp?inline";
import catSeatedUrl from "./assets/cat-seated.webp?inline";
import catStandingUrl from "./assets/cat-standing.webp?inline";
import { CANVAS_H, CANVAS_W, TEAM_OFFICE_LIMIT, type OfficeMemberState } from "./office-format";
import { effectivePhase, eventWordZhOf, type RunPhase } from "./office-screen";
import type { OfficeActivityKind } from "./office-activity";

const WS_W = 470;
const WS_H = 430;
const DESK_TOP = 34;
const DESK_H = Math.round(WS_W * 830 / 1037); // 桌面图原始比例 1037×830
const DESK_COLS = [430, 960];
const DESK_ROWS = [40, 460, 880];
const PAGE_SIZE = 6;

/** 每个工位一只猫；3D 猫贴图是红围巾，用 hue-rotate 转出每个成员的颜色（黑色/白色不受影响）。 */
const SCARF_HUES = [0, 42, 265, 170, 105, 215, 28, 320, 155, 230];

type Status = {
  text: string;
  accent: string;
  level: "run" | "waiting" | "done" | "failed" | "idle";
};

export type OfficeEventState = {
  phase: RunPhase;
  sinceMs: number;
  durationMs: number;
  chars: number;
  runId: string;
  event: { kind: OfficeActivityKind; detail: string; elapsedMs: number } | null;
};

function statusOf(member: OfficeMemberState, st: OfficeEventState | null, now: number): Status {
  if (st) {
    const phase = effectivePhase(st.phase, st.sinceMs, now);
    if (phase === "failed") return { text: "失败", accent: "#d95745", level: "failed" };
    if (phase === "done") return { text: "已完成", accent: "#3f9e72", level: "done" };
    if (st.event) {
      const s = Math.floor(st.event.elapsedMs / 1000);
      const word = eventWordZhOf(st.event.kind) || "工作中";
      return { text: s >= 1 ? `${word} ${s}s` : word, accent: "#b58227", level: "run" };
    }
    if (phase === "waiting") return { text: "等待中", accent: "#b58227", level: "waiting" };
    if (phase === "thinking" || phase === "writing" || phase === "reporting") {
      const s = st.sinceMs ? Math.floor((now - st.sinceMs) / 1000) : 0;
      return { text: s >= 1 ? `运行中 ${s}s` : "运行中", accent: "#2f8f68", level: "run" };
    }
  }
  if (member.running) return { text: "运行中", accent: "#2f8f68", level: "run" };
  return { text: "待机", accent: "#8a919b", level: "idle" };
}

export type OfficeCanvasProps = {
  members: OfficeMemberState[];
  onOpenMember?: (memberId: string) => void;
  eventStateOf?: (memberId: string) => OfficeEventState | null;
  controlsRef?: RefObject<OfficeZoomControls | null>;
  onZoomChange?: (zoom: number) => void;
};

export type OfficeZoomControls = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

export const OFFICE_ZOOM_MIN = 1;
export const OFFICE_ZOOM_MAX = 4;
export const OFFICE_ZOOM_STEP = 1.25;

function Workstation({
  member, status, index, x, y, hovered, onEnter, onLeave, onOpen, now,
}: {
  member: OfficeMemberState;
  status: Status;
  index: number;
  x: number;
  y: number;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
  now: number;
}) {
  const hue = SCARF_HUES[index % SCARF_HUES.length];
  const seated = status.level === "run" || status.level === "idle";
  const dozing = status.level === "idle" && (Math.floor(now / 19000) + index) % 4 === 0;
  const bubble = status.level === "waiting" ? "…" : status.level === "done" ? "✓" : status.level === "failed" ? "!" : "";
  return (
    <div
      className={`office-agent ws${hovered ? " is-hover" : ""}`}
      style={{ left: x, top: y, width: WS_W, height: WS_H }}
      role="button"
      tabIndex={0}
      aria-label={`${member.name} · ${status.text}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(); }
      }}
    >
      <div className="ws-name">
        <strong>{member.name}</strong>
        <span className="ws-status" style={{ color: status.accent }}>
          <i style={{ background: status.accent }} />
          {status.text}
        </span>
      </div>
      <div className="ws-furniture">
        <div className="ws-desk-wrap" style={{ top: DESK_TOP, height: DESK_H }}>
          <img className="ws-desk-img" src={deskUrl} alt="" draggable={false} />
          <div
            className={`ws-screen tone-${status.level}`}
            style={{ ["--screen-accent" as string]: status.accent }}
          >
            <i /><i /><i /><i />
            <span className="ws-screen-scan" />
            {(status.level === "done" || status.level === "failed") && (
              <b className="ws-screen-mark">{status.level === "done" ? "✓" : "!"}</b>
            )}
          </div>
        </div>
        {seated && (
          <img
            className="ws-cat-img is-seated"
            src={catSeatedUrl}
            alt=""
            draggable={false}
            style={{ filter: `hue-rotate(${hue}deg) drop-shadow(0 8px 6px rgba(20,28,36,.14))` }}
          />
        )}
        {!seated && (
          <img
            className="ws-cat-img is-standing"
            src={catStandingUrl}
            alt=""
            draggable={false}
            style={{ filter: `hue-rotate(${hue}deg) drop-shadow(0 8px 6px rgba(20,28,36,.14))` }}
          />
        )}
        {dozing && <span className="ws-zzz">Zzz</span>}
        {bubble && <span className={`ws-bubble is-${status.level}`}>{bubble}</span>}
      </div>
      {hovered && (
        <div
          className="office-agent-card"
          style={{ left: WS_W / 2 - 143, top: y < 120 ? 8 : -96 }}
          onMouseDown={(ev) => ev.stopPropagation()}
        >
          <strong>{member.name}</strong>
          <span>{member.profession || "团队成员"}</span>
          <span style={{ color: status.accent, fontWeight: 600 }}>{status.text}</span>
          <button type="button" onClick={(ev) => { ev.stopPropagation(); onOpen(); }}>点击打开会话 ›</button>
        </div>
      )}
    </div>
  );
}

function EmptyWorkstation({ x, y }: { x: number; y: number }) {
  return (
    <div className="ws is-empty" style={{ left: x, top: y, width: WS_W, height: WS_H }} aria-hidden="true">
      <div className="ws-furniture">
        <div className="ws-desk-wrap" style={{ top: DESK_TOP, height: DESK_H }}>
          <img className="ws-desk-img" src={deskUrl} alt="" draggable={false} />
          <div className="ws-screen tone-idle"><i /><i /><i /><i /><span className="ws-screen-scan" /></div>
        </div>
        <img className="ws-chair-img" src={chairWhiteUrl} alt="" draggable={false} />
      </div>
    </div>
  );
}

function Facilities() {
  return (
    <>
      <section className="facility facility-coffee" style={{ left: 24, top: 70, width: 356 }}>
        <h4>茶水间</h4>
        <img src={coffeeUrl} alt="" draggable={false} />
      </section>
      <section className="facility facility-treadmill" style={{ left: 24, top: 390, width: 356 }}>
        <h4>放松一下</h4>
        <img src={treadmillUrl} alt="" draggable={false} />
      </section>
      <section className="facility facility-toilet" style={{ left: 64, top: 735, width: 240 }}>
        <h4>洗手间</h4>
        <img src={toiletUrl} alt="" draggable={false} />
      </section>
    </>
  );
}

export function OfficeCanvas({ members, onOpenMember, eventStateOf, controlsRef, onZoomChange }: OfficeCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ zoom: 1, cx: 0, cy: 0 });
  const fitRef = useRef(1);
  const openRef = useRef(onOpenMember);
  const eventRef = useRef(eventStateOf);
  const zoomCbRef = useRef(onZoomChange);
  openRef.current = onOpenMember;
  eventRef.current = eventStateOf;
  zoomCbRef.current = onZoomChange;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const rows = members.slice(0, TEAM_OFFICE_LIMIT);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const applyView = useCallback(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;
    const sw = wrap.clientWidth;
    const sh = wrap.clientHeight;
    if (sw <= 0 || sh <= 0) return;
    const fit = Math.min(sw / CANVAS_W, sh / CANVAS_H);
    fitRef.current = fit;
    const scale = fit * viewRef.current.zoom;
    const width = CANVAS_W * scale;
    const height = CANVAS_H * scale;
    const clamp = (c: number, size: number, span: number) =>
      size <= span ? span / 2 : Math.min(size / 2, Math.max(span - size / 2, c));
    viewRef.current.cx = clamp(viewRef.current.cx, width, sw);
    viewRef.current.cy = clamp(viewRef.current.cy, height, sh);
    stage.style.transform =
      `translate(${viewRef.current.cx - width / 2}px, ${viewRef.current.cy - height / 2}px) scale(${scale})`;
  }, []);

  const zoomAt = useCallback((nextZoom: number, ax: number, ay: number) => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;
    const sw = wrap.clientWidth;
    const sh = wrap.clientHeight;
    const fit = fitRef.current || Math.min(sw / CANVAS_W, sh / CANVAS_H);
    const z = Math.min(OFFICE_ZOOM_MAX, Math.max(OFFICE_ZOOM_MIN, nextZoom));
    const rect = stage.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const left = rect.left - wrapRect.left;
    const top = rect.top - wrapRect.top;
    const s0 = rect.width / CANVAS_W;
    if (s0 <= 0) return;
    const designX = (ax - left) / s0;
    const designY = (ay - top) / s0;
    const s1 = fit * z;
    const newLeft = ax - designX * s1;
    const newTop = ay - designY * s1;
    viewRef.current = {
      zoom: z,
      cx: newLeft + (CANVAS_W * s1) / 2,
      cy: newTop + (CANVAS_H * s1) / 2,
    };
    applyView();
    zoomCbRef.current?.(z);
  }, [applyView]);

  const resetView = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    viewRef.current = { zoom: 1, cx: wrap.clientWidth / 2, cy: wrap.clientHeight / 2 };
    applyView();
    zoomCbRef.current?.(1);
  }, [applyView]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    viewRef.current = { zoom: 1, cx: wrap.clientWidth / 2, cy: wrap.clientHeight / 2 };
    applyView();
    const ro = new ResizeObserver(() => applyView());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [applyView]);

  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      zoomIn: () => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        zoomAt(viewRef.current.zoom * OFFICE_ZOOM_STEP, wrap.clientWidth / 2, wrap.clientHeight / 2);
      },
      zoomOut: () => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        zoomAt(viewRef.current.zoom / OFFICE_ZOOM_STEP, wrap.clientWidth / 2, wrap.clientHeight / 2);
      },
      reset: resetView,
    };
    return () => { controlsRef.current = null; };
  }, [controlsRef, resetView, zoomAt]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = wrap.getBoundingClientRect();
      zoomAt(
        viewRef.current.zoom * (ev.deltaY < 0 ? OFFICE_ZOOM_STEP : 1 / OFFICE_ZOOM_STEP),
        ev.clientX - rect.left,
        ev.clientY - rect.top,
      );
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  return (
    <div ref={wrapRef} className="office-scene-wrap">
      <div ref={stageRef} className="office-scene-stage" style={{ width: CANVAS_W, height: CANVAS_H }}>
        <div className="office-board">
          <Facilities />
          {Array.from({ length: PAGE_SIZE }, (_, i) => {
            const x = DESK_COLS[i % 2];
            const y = DESK_ROWS[Math.floor(i / 2)];
            const member = pageRows[i];
            if (!member) return <EmptyWorkstation key={`empty-${page}-${i}`} x={x} y={y} />;
            const status = statusOf(member, eventRef.current?.(member.id) ?? null, now);
            return (
              <Workstation
                key={member.id}
                member={member}
                status={status}
                index={page * PAGE_SIZE + i}
                x={x}
                y={y}
                now={now}
                hovered={hoverId === member.id}
                onEnter={() => setHoverId(member.id)}
                onLeave={() => setHoverId((cur) => (cur === member.id ? null : cur))}
                onOpen={() => openRef.current?.(member.id)}
              />
            );
          })}
          {pageCount > 1 && (
            <div className="office-pager">
              <button
                type="button"
                aria-label="上一页"
                disabled={page === 0}
                onClick={() => { setPage((p) => Math.max(0, p - 1)); setHoverId(null); }}
              >‹</button>
              <span>第 {page + 1} / {pageCount} 页 · {rows.length} 人</span>
              <button
                type="button"
                aria-label="下一页"
                disabled={page === pageCount - 1}
                onClick={() => { setPage((p) => Math.min(pageCount - 1, p + 1)); setHoverId(null); }}
              >›</button>
            </div>
          )}
        </div>
      </div>
      <div className="office-scene-hint">点击工位进入会话 · 悬停查看状态 · 滚轮缩放 · 超过 6 人可分页</div>
    </div>
  );
}
