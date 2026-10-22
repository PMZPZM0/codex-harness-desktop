/**
 * 办公室 · 白色简洁动画场景（2026-10-22 重做，对照腾讯 Marvis workbench）
 *
 * 用户否掉了"一张静态 3D 照片"，要求按 Marvis 逆向出**一模一样的白色简洁办公室**：
 * 纯白背景、白色办公桌 + 黑色显示器 + 白色椅子 + 黑猫成员（彩色围巾），
 * 名字标在显示器上方。我们沿用 Marvis 的**布局与状态机**，但桌子/椅子/猫全部用
 * DOM + SVG 自己画（不搬它的美术资产）：
 *   · 10 个工位（2 列 × 5 排），左侧是茶水间 / 跑步机 / 休息区；
 *   · 黑猫按真实状态换姿态：运行 = 背对镜头坐着敲键盘，等待 = 站着等你，
 *     完成 = 站着比 ✓，失败 = 站着报错，待机 = 背对镜头安静坐着（尾巴会动）；
 *   · 每台显示器都有实时内容（状态色 + 代码条 + 扫描线），缩放/平移沿用同一套舞台；
 *   · 悬停出详情卡、点击进入成员会话。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CANVAS_H, CANVAS_W, TEAM_OFFICE_LIMIT, type OfficeMemberState } from "./office-format";
import { effectivePhase, eventWordZhOf, type RunPhase } from "./office-screen";
import type { OfficeActivityKind } from "./office-activity";

const WS_W = 480;
const WS_H = 230;
const DESK_COLS = [450, 1000];
const DESK_ROWS = [60, 300, 540, 780, 1020];

/** 每个工位一只猫；围巾颜色用来区分成员（Marvis 同款做法）。 */
const SCARVES = [
  "#e8553f", "#e2b23c", "#7b61c9", "#35b8b1", "#5fae66",
  "#4a7bd0", "#e08a3c", "#cf6fa5", "#3f8f8a", "#5c6673",
];

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

/* ── 家具：全部白底浅灰描边 + 柔和投影（Marvis 同款“白上白”），不描黑边。 ── */

function OfficeChair({ occupied }: { occupied: boolean }) {
  return (
    <svg className={`ws-chair${occupied ? " is-occupied" : ""}`} viewBox="0 0 140 116" aria-hidden="true">
      <path className="chair-back" d="M42 12C42 5 47 1 54 1h32c7 0 12 4 12 11v48c0 7-5 12-12 12H54c-7 0-12-5-12-12z" />
      <rect className="chair-seat" x="38" y="60" width="64" height="17" rx="8.5" />
      <rect className="chair-stem" x="66" y="76" width="8" height="20" rx="4" />
      <path className="chair-base" d="M70 96 38 107M70 96l32 11M70 96 52 110M70 96l18 14" />
      <circle className="chair-wheel" cx="36" cy="108" r="3.6" />
      <circle className="chair-wheel" cx="104" cy="108" r="3.6" />
      <circle className="chair-wheel" cx="52" cy="111" r="3.6" />
      <circle className="chair-wheel" cx="88" cy="111" r="3.6" />
    </svg>
  );
}

function SeatedCat({ scarf, level }: { scarf: string; level: Status["level"] }) {
  return (
    <svg className={`ws-cat is-seated is-${level}`} viewBox="0 0 120 120" aria-hidden="true">
      <path className="cat-tail" d="M95 96c17 4 22-8 17-17" fill="none" stroke="#111214" strokeWidth="7" strokeLinecap="round" />
      <path className="cat-body" d="M28 114c-3-24 7-42 32-44 25 2 35 20 32 44z" fill="#111214" />
      <path className="cat-head" d="M35 68 31 30l20 11c5-3 13-3 18 0l20-11-4 38z" fill="#111214" />
      <rect className="cat-scarf" x="37" y="72" width="46" height="13" rx="6.5" fill={scarf} />
      <path className="cat-scarf-tail" d="M74 82l12 23-16-5z" fill={scarf} />
      <g className="cat-arm cat-arm-l"><rect x="24" y="82" width="10" height="22" rx="5" fill="#111214" /></g>
      <g className="cat-arm cat-arm-r"><rect x="86" y="82" width="10" height="22" rx="5" fill="#111214" /></g>
    </svg>
  );
}

function StandingCat({ scarf, level }: { scarf: string; level: Status["level"] }) {
  const failed = level === "failed";
  return (
    <svg className={`ws-cat is-standing is-${level}`} viewBox="0 0 110 142" aria-hidden="true">
      <path className="cat-tail" d="M25 96C7 100 5 84 12 77" fill="none" stroke="#111214" strokeWidth="6.5" strokeLinecap="round" />
      <ellipse className="cat-body" cx="55" cy="100" rx="27" ry="34" fill="#111214" />
      <rect x="40" y="124" width="12" height="15" rx="6" fill="#111214" />
      <rect x="58" y="124" width="12" height="15" rx="6" fill="#111214" />
      <path className="cat-head" d="M27 72 23 28l20 12c5-3 19-3 24 0l20-12-4 44z" fill="#111214" />
      {failed ? (
        <g className="cat-eyes-failed" stroke="#fff" strokeWidth="3.2" strokeLinecap="round">
          <path d="M39 51l10 10M49 51 39 61" />
          <path d="M61 51l10 10M71 51 61 61" />
        </g>
      ) : (
        <g className="cat-eyes">
          <ellipse cx="44" cy="54" rx="7.4" ry="8.8" fill="#fff" />
          <ellipse cx="66" cy="54" rx="7.4" ry="8.8" fill="#fff" />
          <circle cx="45" cy="55" r="3.4" fill="#111214" />
          <circle cx="67" cy="55" r="3.4" fill="#111214" />
        </g>
      )}
      <rect className="cat-scarf" x="35" y="72" width="40" height="12" rx="6" fill={scarf} />
      <path className="cat-scarf-tail" d="M65 82l10 21-14-5z" fill={scarf} />
      <g className="cat-arm cat-arm-l"><rect x="24" y="88" width="10" height="24" rx="5" fill="#111214" /></g>
      <g className="cat-arm cat-arm-r"><rect x="76" y="86" width="10" height="26" rx="5" fill="#111214" /></g>
    </svg>
  );
}

function Workstation({
  member, status, index, x, y, hovered, onEnter, onLeave, onOpen,
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
}) {
  const scarf = SCARVES[index % SCARVES.length];
  const seated = status.level === "run" || status.level === "idle";
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
        <span className="ws-floor-shadow" />
        <span className="ws-desk-leg is-left" />
        <span className="ws-desk-leg is-right" />
        <span className="ws-pedestal" />
        <span className="ws-desk-top" />
        <span className="ws-desk-edge" />
        <span className="ws-pc"><i /><i /><i /></span>
        <div className="ws-monitor">
          <div className={`ws-screen tone-${status.level}`} style={{ ["--screen-accent" as string]: status.accent }}>
            <i /><i /><i /><i />
            <span className="ws-screen-scan" />
            {(status.level === "done" || status.level === "failed") && (
              <b className="ws-screen-mark">{status.level === "done" ? "✓" : "!"}</b>
            )}
          </div>
          <span className="ws-monitor-neck" />
          <span className="ws-monitor-base" />
        </div>
        <span className="ws-keyboard"><i /><i /><i /><i /></span>
        <OfficeChair occupied={seated} />
        {seated ? <SeatedCat scarf={scarf} level={status.level} /> : <StandingCat scarf={scarf} level={status.level} />}
        {bubble && <span className={`ws-bubble is-${status.level}`}>{bubble}</span>}
      </div>
      {hovered && (
        <div
          className="office-agent-card"
          style={{ left: WS_W / 2 - 143, top: y < 120 ? 4 : -86 }}
          onMouseDown={(ev) => ev.stopPropagation()}
        >
          <strong>{member.name}</strong>
          <span>{member.profession || "团队成员"}</span>
          <span style={{ color: status.accent, fontWeight: 600 }}>{status.text}</span>
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
          >
            点击打开会话 ›
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyWorkstation({ x, y }: { x: number; y: number }) {
  return (
    <div className="ws is-empty" style={{ left: x, top: y, width: WS_W, height: WS_H }} aria-hidden="true">
      <div className="ws-furniture">
        <span className="ws-floor-shadow" />
        <span className="ws-desk-leg is-left" />
        <span className="ws-desk-leg is-right" />
        <span className="ws-pedestal" />
        <span className="ws-desk-top" />
        <span className="ws-desk-edge" />
        <span className="ws-pc"><i /><i /><i /></span>
        <div className="ws-monitor">
          <div className="ws-screen tone-idle"><i /><i /><i /><i /><span className="ws-screen-scan" /></div>
          <span className="ws-monitor-neck" />
          <span className="ws-monitor-base" />
        </div>
        <span className="ws-keyboard"><i /><i /><i /><i /></span>
        <OfficeChair occupied={false} />
      </div>
    </div>
  );
}

/* ── 左侧功能区：茶水间 / 跑步机 / 休息区（对应 Marvis 办公室的生活设施） ── */
function Facilities() {
  return (
    <>
      <section className="facility facility-coffee" style={{ left: 50, top: 60, width: 350, height: 250 }}>
        <h4>茶水间</h4>
        <div className="coffee-counter">
          <span className="coffee-panel">COFFEE</span>
          <span className="coffee-machine"><i /><b /></span>
          <span className="coffee-cups"><i /><i /><i /></span>
          <span className="coffee-kettle" />
        </div>
      </section>
      <section className="facility facility-treadmill" style={{ left: 50, top: 350, width: 350, height: 250 }}>
        <h4>放松一下</h4>
        <div className="treadmill">
          <span className="treadmill-belt"><i /><i /><i /></span>
          <span className="treadmill-rail is-left" />
          <span className="treadmill-rail is-right" />
          <span className="treadmill-console" />
        </div>
      </section>
      <section className="facility facility-lounge" style={{ left: 50, top: 650, width: 350, height: 320 }}>
        <h4>休息区</h4>
        <div className="lounge-sofa">
          <span className="sofa-back" />
          <span className="sofa-seat" />
          <span className="sofa-arm is-left" />
          <span className="sofa-arm is-right" />
          <span className="sofa-cushion is-a" />
          <span className="sofa-cushion is-b" />
        </div>
        <div className="lounge-plant"><i /><i /><i /><i /><i /><span /></div>
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

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

  const rows = members.slice(0, TEAM_OFFICE_LIMIT);

  return (
    <div ref={wrapRef} className="office-scene-wrap">
      <div ref={stageRef} className="office-scene-stage" style={{ width: CANVAS_W, height: CANVAS_H }}>
        <div className="office-board">
          <Facilities />
          {Array.from({ length: TEAM_OFFICE_LIMIT }, (_, i) => {
            const x = DESK_COLS[i % 2];
            const y = DESK_ROWS[Math.floor(i / 2)];
            const member = rows[i];
            if (!member) return <EmptyWorkstation key={`empty-${i}`} x={x} y={y} />;
            const status = statusOf(member, eventRef.current?.(member.id) ?? null, now);
            return (
              <Workstation
                key={member.id}
                member={member}
                status={status}
                index={i}
                x={x}
                y={y}
                hovered={hoverId === member.id}
                onEnter={() => setHoverId(member.id)}
                onLeave={() => setHoverId((cur) => (cur === member.id ? null : cur))}
                onOpen={() => openRef.current?.(member.id)}
              />
            );
          })}
        </div>
      </div>
      <div className="office-scene-hint">点击工位进入会话 · 悬停查看状态 · 滚轮缩放</div>
    </div>
  );
}
