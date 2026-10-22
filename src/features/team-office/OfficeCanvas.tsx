/**
 * 办公室场景 · 交互式场景层（2026-10-22 重做）
 *
 * 用户方向：**不再用代码画卡通风人物/房间**，改成参考图那种高质感 3D 办公室场景，
 * 场景里的人物是**可点击的热点**（类似安居客漫游里点家具/房间看详情）：
 *   · 底图 = 生成好的 1792×960 办公室场景（含桌椅/显示器/人物/窗景），静态绘制；
 *   · 每个成员在场景里有固定锚点（人物/椅子）+ 状态屏矩形；
 *   · 实时叠加：人物热点呼吸环、姓名/状态标签、状态屏底部的实时 HUD + 扫描线；
 *   · hover 展示详情卡，点击人物/标签直接进入该成员的会话；
 *   · 缩放 / 平移 / 命中与之前的 view 逻辑一致。
 *
 * ⛔ 人物位置来自场景图（固定），不再跑走位模拟；状态仍由宿主 props + 事件面实时驱动。
 */
import { useEffect, useRef, type RefObject } from "react";
// ⛔ ?inline：场景图 226KB 超过 Vite 64KB 阈值，拆成独立文件在构建版 file:// 下会 404
//    （10-05 办公室白屏事故同型）。内联成 data: URI，代价是 bundle 大一点，换来打包版必定能显示。
import bgUrl from "./assets/office-bg.webp?inline";
import { CANVAS_H, CANVAS_W, type OfficeMemberState } from "./office-format";
import { effectivePhase, eventWordZhOf, type RunPhase } from "./office-screen";
import type { OfficeActivityKind } from "./office-activity";

/** 场景图里的 10 个工位（坐标是 1792×960 底图坐标）。 */
type Anchor = {
  /** 人物/椅子的热点中心 */
  x: number;
  y: number;
  /** 状态屏矩形（实时 HUD/扫描线画在这里） */
  screen: { x: number; y: number; w: number; h: number };
  /** 姓名标签相对人物的纵向偏移 */
  tagDy: number;
};

const ANCHORS: Anchor[] = [
  // 前排
  { x: 168, y: 465, screen: { x: 214, y: 388, w: 158, h: 100 }, tagDy: 112 },
  { x: 392, y: 588, screen: { x: 432, y: 542, w: 160, h: 102 }, tagDy: 112 },
  { x: 632, y: 660, screen: { x: 700, y: 598, w: 168, h: 106 }, tagDy: 112 },
  // 中排
  { x: 452, y: 280, screen: { x: 505, y: 246, w: 150, h: 92 }, tagDy: 108 },
  { x: 632, y: 388, screen: { x: 700, y: 354, w: 160, h: 100 }, tagDy: 108 },
  { x: 882, y: 468, screen: { x: 932, y: 430, w: 160, h: 100 }, tagDy: 108 },
  { x: 1092, y: 558, screen: { x: 1140, y: 506, w: 168, h: 104 }, tagDy: 108 },
  // 右/后排
  { x: 1360, y: 648, screen: { x: 1420, y: 596, w: 168, h: 104 }, tagDy: 108 },
  { x: 1082, y: 280, screen: { x: 1130, y: 246, w: 150, h: 92 }, tagDy: 108 },
  { x: 1322, y: 380, screen: { x: 1370, y: 336, w: 150, h: 92 }, tagDy: 108 },
];

type Status = {
  text: string;
  accent: string;
  level: "run" | "done" | "failed" | "idle";
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
    if (phase === "failed") return { text: "失败", accent: "#e0705f", level: "failed" };
    if (phase === "done") return { text: "已完成", accent: "#6ed49a", level: "done" };
    if (st.event) {
      const s = Math.floor(st.event.elapsedMs / 1000);
      const word = eventWordZhOf(st.event.kind) || "工作中";
      return { text: s >= 1 ? `${word} ${s}s` : word, accent: "#e8c76a", level: "run" };
    }
    if (phase === "thinking" || phase === "waiting" || phase === "writing" || phase === "reporting") {
      const s = st.sinceMs ? Math.floor((now - st.sinceMs) / 1000) : 0;
      return { text: s >= 1 ? `运行中 ${s}s` : "运行中", accent: "#7fd6a8", level: "run" };
    }
  }
  if (member.running) return { text: "运行中", accent: "#7fd6a8", level: "run" };
  return { text: "待机", accent: "#8fb4c9", level: "idle" };
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

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 每个热点的标签位置（人物下方；超出画布时上移）。 */
function tagPosition(a: Anchor): { x: number; y: number } {
  return { x: a.x, y: Math.min(CANVAS_H - 44, a.y + a.tagDy) };
}

/** #rrggbb → rgba(...)（状态强调色统一从这里出）。 */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function OfficeCanvas({ members, onOpenMember, eventStateOf, controlsRef, onZoomChange }: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const membersRef = useRef(members);
  const openRef = useRef(onOpenMember);
  const eventRef = useRef(eventStateOf);
  const onZoomRef = useRef(onZoomChange);
  const hoverRef = useRef<string | null>(null);
  membersRef.current = members;
  openRef.current = onOpenMember;
  eventRef.current = eventStateOf;
  onZoomRef.current = onZoomChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let disposed = false;
    let ro: ResizeObserver | null = null;

    /* 视图 = contain 基准 + 用户缩放/平移。⛔ 不用 object-fit（命中会整体偏移）。 */
    type OfficeView = { zoom: number; cx: number; cy: number };
    let view: OfficeView = { zoom: OFFICE_ZOOM_MIN, cx: 0, cy: 0 };

    const stageSize = () => {
      const stage = canvas.parentElement;
      return { sw: stage?.clientWidth ?? 0, sh: stage?.clientHeight ?? 0 };
    };
    const baseSize = (sw: number, sh: number) => {
      if (sw <= 0 || sh <= 0) return { bw: CANVAS_W, bh: CANVAS_H };
      const s = Math.min(sw / CANVAS_W, sh / CANVAS_H);
      return { bw: CANVAS_W * s, bh: CANVAS_H * s };
    };
    const clampAxis = (c: number, size: number, span: number) =>
      size <= span ? span / 2 : Math.min(size / 2, Math.max(span - size / 2, c));
    const applyView = () => {
      const { sw, sh } = stageSize();
      const { bw, bh } = baseSize(sw, sh);
      const w = bw * view.zoom;
      const h = bh * view.zoom;
      view.cx = clampAxis(view.cx, w, sw);
      view.cy = clampAxis(view.cy, h, sh);
      canvas.style.width = `${Math.round(w)}px`;
      canvas.style.height = `${Math.round(h)}px`;
      canvas.style.transform =
        `translate(${Math.round(view.cx - w / 2)}px, ${Math.round(view.cy - h / 2)}px)`;
    };
    const zoomAt = (nextZoom: number, ax: number, ay: number) => {
      const { sw, sh } = stageSize();
      const { bw, bh } = baseSize(sw, sh);
      const z = Math.min(OFFICE_ZOOM_MAX, Math.max(OFFICE_ZOOM_MIN, nextZoom));
      const w0 = bw * view.zoom, h0 = bh * view.zoom;
      const w1 = bw * z, h1 = bh * z;
      const fx = w0 > 0 ? (ax - (view.cx - w0 / 2)) / w0 : 0.5;
      const fy = h0 > 0 ? (ay - (view.cy - h0 / 2)) / h0 : 0.5;
      view = { zoom: z, cx: ax + w1 * (0.5 - fx), cy: ay + h1 * (0.5 - fy) };
      applyView();
      onZoomRef.current?.(view.zoom);
    };
    const zoomTo = (z: number) => {
      const { sw, sh } = stageSize();
      zoomAt(z, sw / 2, sh / 2);
    };
    const resetView = () => {
      const { sw, sh } = stageSize();
      view = { zoom: OFFICE_ZOOM_MIN, cx: sw / 2, cy: sh / 2 };
      applyView();
      onZoomRef.current?.(view.zoom);
    };
    applyView();

    void (async () => {
      const bg = await loadImage(bgUrl);
      if (disposed) return;
      resetView();
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => applyView());
        if (canvas.parentElement) ro.observe(canvas.parentElement);
      }

      const draw = (now: number) => {
        const t = now / 1000;
        const nowMs = Date.now();
        ctx.imageSmoothingEnabled = true;
        if (bg) ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);
        else {
          ctx.fillStyle = "#dfe5e8";
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        const list = membersRef.current.slice(0, ANCHORS.length);
        const hoverId = hoverRef.current;
        let hoverAnchor: Anchor | null = null;
        let hoverMember: OfficeMemberState | null = null;
        let hoverStatus: Status | null = null;

        for (let i = 0; i < list.length; i += 1) {
          const m = list[i];
          const a = ANCHORS[i];
          if (!a) continue;
          const st = eventRef.current?.(m.id) ?? null;
          const status = statusOf(m, st, nowMs);
          const isHover = hoverId === m.id;
          if (isHover) {
            hoverAnchor = a;
            hoverMember = m;
            hoverStatus = status;
          }

          /* ── 状态屏：不覆盖场景里的仪表盘，只用细线与扫描线表达“在运行” ── */
          const s = a.screen;
          ctx.fillStyle = hexToRgba(status.accent, 0.72);
          ctx.fillRect(s.x, s.y, s.w, 2);
          const blink = status.level === "run" ? 0.5 + 0.5 * Math.sin(t * 3.4 + i) : 0.35;
          ctx.beginPath();
          ctx.arc(s.x + s.w - 8, s.y + 8, 3, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(status.accent, blink);
          ctx.fill();
          if (status.level === "run") {
            const ly = s.y + ((t * 0.12 + i * 0.17) % 1) * s.h;
            const grad = ctx.createLinearGradient(0, ly - 8, 0, ly + 8);
            grad.addColorStop(0, "rgba(127,214,168,0)");
            grad.addColorStop(0.5, "rgba(127,214,168,0.16)");
            grad.addColorStop(1, "rgba(127,214,168,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(s.x, ly - 8, s.w, 16);
          }

          /* ── 人物热点：肩上一个小圆标 + 扩散脉冲（类似场景漫游的可点热点） ── */
          const hx = a.x;
          const hy = a.y + 42;
          const wave = (t * 0.55 + i * 0.11) % 1;
          ctx.save();
          // 向外扩散的脉冲圈（提示“这里可以点”）
          ctx.beginPath();
          ctx.ellipse(hx, hy, 9 + wave * 17, 4 + wave * 7, 0, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(status.accent, (1 - wave) * 0.42);
          ctx.lineWidth = 1.6;
          ctx.stroke();
          // 柔和底光
          ctx.beginPath();
          ctx.ellipse(hx, hy, isHover ? 17 : 11, isHover ? 8 : 5.5, 0, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(status.accent, isHover ? 0.25 : 0.13);
          ctx.fill();
          // 主圆标（白边，保证在照片上可辨）
          ctx.beginPath();
          ctx.arc(hx, hy, isHover ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = status.accent;
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 2;
          ctx.stroke();
          // 中心小点（运行中闪烁）
          const core = status.level === "run" ? 0.55 + 0.45 * Math.sin(t * 5 + i) : 0.9;
          ctx.beginPath();
          ctx.arc(hx, hy, isHover ? 2.6 : 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${core.toFixed(2)})`;
          ctx.fill();
          ctx.restore();
        }

        /* ── 悬停详情卡（场景漫游式“点进去看”提示；不常驻，避免挡场景） ── */
        if (hoverAnchor && hoverMember && hoverStatus) {
          const cw = 238;
          const ch = 104;
          const right = hoverAnchor.x < CANVAS_W - cw - 70;
          const cx = right ? hoverAnchor.x + 48 : hoverAnchor.x - cw - 48;
          const cy = Math.min(CANVAS_H - ch - 10, Math.max(10, hoverAnchor.y - 66));
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.42)";
          ctx.shadowBlur = 18;
          ctx.shadowOffsetY = 6;
          ctx.beginPath();
          ctx.roundRect(cx, cy, cw, ch, 12);
          ctx.fillStyle = "rgba(248,250,251,0.98)";
          ctx.fill();
          ctx.restore();
          ctx.beginPath();
          ctx.roundRect(cx, cy, cw, ch, 12);
          ctx.strokeStyle = "rgba(32,48,58,0.22)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
          // 指向人物的小三角
          ctx.beginPath();
          if (right) {
            ctx.moveTo(cx, cy + 46);
            ctx.lineTo(cx - 9, cy + 53);
            ctx.lineTo(cx, cy + 60);
          } else {
            ctx.moveTo(cx + cw, cy + 46);
            ctx.lineTo(cx + cw + 9, cy + 53);
            ctx.lineTo(cx + cw, cy + 60);
          }
          ctx.closePath();
          ctx.fillStyle = "rgba(248,250,251,0.98)";
          ctx.fill();
          ctx.fillStyle = "#1c2a33";
          ctx.textAlign = "left";
          ctx.font = "600 17px ui-sans-serif, system-ui";
          ctx.fillText(hoverMember.name, cx + 16, cy + 28);
          ctx.font = "12px ui-sans-serif, system-ui";
          ctx.fillStyle = "#5d7380";
          ctx.fillText(hoverMember.profession || "团队成员", cx + 16, cy + 48);
          ctx.fillStyle = hoverStatus.accent;
          ctx.font = "600 13px ui-sans-serif, system-ui";
          ctx.fillText(hoverStatus.text, cx + 16, cy + 70);
          ctx.fillStyle = "#3f8f7d";
          ctx.font = "600 12px ui-sans-serif, system-ui";
          ctx.fillText("点击打开会话  ›", cx + 16, cy + 92);
        }

        /* ── 左下角操作提示 ── */
        ctx.save();
        ctx.font = "13px ui-sans-serif, system-ui";
        const hint = "点击人物进入会话 · 悬停查看状态";
        const hw = ctx.measureText(hint).width + 28;
        const hx = 18;
        const hy = CANVAS_H - 44;
        ctx.beginPath();
        ctx.roundRect(hx, hy, hw, 28, 9);
        ctx.fillStyle = "rgba(10,17,23,0.62)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx + 14, hy + 14, 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(127,214,168,0.9)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = "rgba(240,246,250,0.9)";
        ctx.fillText(hint, hx + 24, hy + 18);
        ctx.restore();

        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      const hitTest = (clientX: number, clientY: number): { id: string } | null => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const sx = ((clientX - rect.left) / rect.width) * CANVAS_W;
        const sy = ((clientY - rect.top) / rect.height) * CANVAS_H;
        let best: { d: number; id: string } | null = null;
        const list = membersRef.current.slice(0, ANCHORS.length);
        for (let i = 0; i < list.length; i += 1) {
          const a = ANCHORS[i];
          const m = list[i];
          if (!a) continue;
          const tag = tagPosition(a);
          const dPerson = Math.hypot(a.x - sx, a.y + 55 - sy);
          const dTag = Math.hypot(tag.x - sx, tag.y + 14 - sy);
          const d = Math.min(dPerson, dTag);
          if (d < 62 && (!best || d < best.d)) best = { d, id: m.id };
        }
        return best;
      };
      const onClick = (ev: MouseEvent) => {
        const hit = hitTest(ev.clientX, ev.clientY);
        if (hit) openRef.current?.(hit.id);
      };
      const onMove = (ev: MouseEvent) => {
        const hit = hitTest(ev.clientX, ev.clientY);
        const id = hit?.id ?? null;
        if (hoverRef.current !== id) {
          hoverRef.current = id;
          canvas.style.cursor = id ? "pointer" : "default";
        }
      };
      const onLeave = () => {
        if (hoverRef.current !== null) {
          hoverRef.current = null;
          canvas.style.cursor = "default";
        }
      };
      const onWheel = (ev: WheelEvent) => {
        const stage = canvas.parentElement;
        if (!stage) return;
        ev.preventDefault();
        const rect = stage.getBoundingClientRect();
        const ax = ev.clientX - rect.left;
        const ay = ev.clientY - rect.top;
        zoomAt(view.zoom * (ev.deltaY < 0 ? OFFICE_ZOOM_STEP : 1 / OFFICE_ZOOM_STEP), ax, ay);
      };
      canvas.addEventListener("click", onClick);
      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseleave", onLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });

      if (controlsRef) {
        controlsRef.current = {
          zoomIn: () => zoomTo(view.zoom * OFFICE_ZOOM_STEP),
          zoomOut: () => zoomTo(view.zoom / OFFICE_ZOOM_STEP),
          reset: resetView,
        };
      }
    })().catch(() => undefined);

    return () => {
      disposed = true;
      if (controlsRef) controlsRef.current = null;
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="office-pixel-canvas" />;
}
