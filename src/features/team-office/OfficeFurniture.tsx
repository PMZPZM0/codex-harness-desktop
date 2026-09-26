/**
 * 办公室家具与墙面装饰（team-office 域 09-26 v4）。
 *
 * 全部画在同一张 SVG 的同一坐标系里（viewBox 960 宽），家具之间不会各自漂移。
 * 动效全部挂 CSS 类（云漂 / 钟摆 / 水泡 / 纸张吐出 / 叶片摇 / 灯光呼吸），
 * 这里只负责形状与层级，⛔ 不写角度数值。
 */
import { OFC } from "./office-palette";

/* ── 窗：天空 + 云 + 城市剪影 ── */
export function Window({ x, y, w = 220, h = 120 }: { x: number; y: number; w?: number; h?: number }) {
  const glassH = h - 18;
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-window">
      <rect x="0" y="0" width={w} height={h} rx="10" fill={OFC.paper} stroke={OFC.ink} strokeWidth="3" />
      <rect x="9" y="9" width={w - 18} height={glassH} rx="6" fill="url(#ofc-sky)" />
      {/* 城市剪影 */}
      <g className="ofc-skyline" opacity="0.5">
        <rect x="16" y={glassH - 26} width="22" height="40" fill="#9fc6e4" />
        <rect x="42" y={glassH - 42} width="26" height="56" fill="#8fbbdd" />
        <rect x="72" y={glassH - 18} width="20" height="32" fill="#a9cde8" />
        <rect x={w - 96} y={glassH - 34} width="24" height="48" fill="#8fbbdd" />
        <rect x={w - 68} y={glassH - 22} width="30" height="36" fill="#9fc6e4" />
      </g>
      {/* 云（两条不同速度漂移） */}
      <g className="ofc-cloud">
        <ellipse cx={w * 0.28} cy={glassH * 0.3} rx="22" ry="10" fill="#fff" opacity="0.95" />
        <ellipse cx={w * 0.36} cy={glassH * 0.25} rx="14" ry="8" fill="#fff" opacity="0.95" />
      </g>
      <g className="ofc-cloud ofc-cloud-slow">
        <ellipse cx={w * 0.68} cy={glassH * 0.55} rx="17" ry="8" fill="#fff" opacity="0.85" />
      </g>
      {/* 窗棂 */}
      <line x1={w / 2} y1="9" x2={w / 2} y2={9 + glassH} stroke={OFC.paper} strokeWidth="6" />
      <line x1="9" y1={glassH / 2 + 9} x2={w - 9} y2={glassH / 2 + 9} stroke={OFC.paper} strokeWidth="6" />
      {/* 窗台 */}
      <rect x="-6" y={h - 4} width={w + 12} height="9" rx="4" fill={OFC.wallTop} stroke={OFC.ink} strokeWidth="2.4" />
      <g transform={`translate(${w - 34} ${h - 6})`}>
        <Pot scale={0.62} />
      </g>
    </g>
  );
}

/* ── 白板：手写线 + 便签 + 连线 ── */
export function Whiteboard({ x, y, w = 220, h = 122 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-whiteboard">
      <rect x="0" y="0" width={w} height={h} rx="8" fill={OFC.paper} stroke={OFC.ink} strokeWidth="3" />
      <g strokeLinecap="round" className="ofc-board-lines">
        <line className="ofc-board-line l1" x1="20" y1="26" x2="150" y2="26" stroke="#8fb7d6" strokeWidth="4" />
        <line className="ofc-board-line l2" x1="20" y1="42" x2="112" y2="42" stroke="#a9c9e2" strokeWidth="4" />
        <line className="ofc-board-line l3" x1="20" y1="58" x2="134" y2="58" stroke="#bcd6ea" strokeWidth="4" />
        {/* 手绘箭头（逐段画出来） */}
        <path className="ofc-board-line l4" d="M 152 44 q 22 2 30 16" fill="none" stroke={OFC.warn} strokeWidth="3" />
        <path className="ofc-board-line l5" d="M 176 62 l 6 -3 l -1 7 z" fill={OFC.warn} stroke="none" />
      </g>
      <g>
        <rect x="20" y="74" width="52" height="30" rx="4" fill={OFC.noteA} stroke={OFC.ink} strokeWidth="2" transform="rotate(-4 46 89)" />
        <rect x="80" y="78" width="52" height="30" rx="4" fill={OFC.noteB} stroke={OFC.ink} strokeWidth="2" transform="rotate(3 106 93)" />
        <rect x="142" y="72" width="50" height="34" rx="4" fill={OFC.noteC} stroke={OFC.ink} strokeWidth="2" transform="rotate(-2 167 89)" />
        <rect x="20" y="74" width="52" height="30" rx="4" fill="none" stroke={OFC.ink} strokeWidth="1.4" strokeDasharray="4 3" transform="rotate(-4 46 89)" className="ofc-board-pin" />
      </g>
    </g>
  );
}

/* ── 挂钟：秒针走 + 钟摆 ── */
export function Clock({ x, y, r = 28 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-clock">
      <line x1="0" y1={-r} x2="0" y2={-r - 14} stroke={OFC.inkSoft} strokeWidth="3" />
      <circle cx="0" cy="0" r={r} fill={OFC.paper} stroke={OFC.ink} strokeWidth="3" />
      <circle cx="0" cy="0" r={r - 5} fill="#f7fafd" />
      {[0, 90, 180, 270].map((deg) => (
        <line key={deg} x1="0" y1={-r + 6} x2="0" y2={-r + 11} stroke={OFC.inkSoft} strokeWidth="2.4" transform={`rotate(${deg})`} />
      ))}
      <line x1="0" y1="0" x2="0" y2={-r * 0.5} stroke={OFC.ink} strokeWidth="3" strokeLinecap="round" />
      <line className="ofc-clock-minute" x1="0" y1="0" x2="0" y2={-r * 0.76} stroke={OFC.inkSoft} strokeWidth="2.4" strokeLinecap="round" />
      <line className="ofc-clock-hand" x1="0" y1="0" x2={r * 0.5} y2={r * 0.14} stroke={OFC.warn} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="0" cy="0" r="2.6" fill={OFC.ink} />
      {/* 钟摆 */}
      <g className="ofc-pendulum" transform={`translate(0 ${r + 10})`}>
        <line x1="0" y1="0" x2="0" y2="16" stroke={OFC.inkSoft} strokeWidth="2.2" />
        <circle cx="0" cy="20" r="5.4" fill={OFC.warn} stroke={OFC.ink} strokeWidth="2" />
      </g>
    </g>
  );
}

/* ── 吊灯：链条 + 灯罩 + 光锥 ── */
export function PendantLight({ x, y = 0, drop = 54 }: { x: number; y?: number; drop?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-lamp">
      <line x1="0" y1="0" x2="0" y2={drop} stroke={OFC.inkSoft} strokeWidth="2.4" />
      <g className="ofc-lamp-swing" transform={`translate(0 ${drop})`}>
        <path d={`M -30 0 L 30 0 L 18 26 L -18 26 Z`} fill="#f0e2c8" stroke={OFC.ink} strokeWidth="2.6" strokeLinejoin="round" />
        <path d={`M -18 26 L 18 26 L 22 32 L -22 32 Z`} fill="#f7dfa8" stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
        <ellipse className="ofc-lamp-glow" cx="0" cy="30" rx="13" ry="5" fill="#ffe9a8" />
        <path className="ofc-lamp-cone" d="M -22 32 L 22 32 L 62 128 L -62 128 Z" fill="#ffe9a8" opacity="0.13" />
      </g>
    </g>
  );
}

/* ── 书架 ── */
export function Bookshelf({ x, y, w = 84, h = 140 }: { x: number; y: number; w?: number; h?: number }) {
  const rows = 3;
  const rowH = (h - 8) / rows;
  const bookColors = [OFC.noteB, OFC.noteC, OFC.noteA, OFC.plant, OFC.info, OFC.warn];
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-shelf">
      <rect x="0" y="0" width={w} height={h} rx="5" fill="#e7d3b4" stroke={OFC.ink} strokeWidth="2.8" />
      {Array.from({ length: rows }).map((_, r) => (
        <g key={r}>
          <rect x="6" y={6 + r * rowH} width={w - 12} height={rowH - 9} rx="3" fill="#f6ecda" stroke={OFC.ink} strokeWidth="2" />
          {Array.from({ length: 5 }).map((__, b) => (
            <rect
              key={b}
              x={9 + b * 12}
              y={10 + r * rowH + (b % 2 ? 3 : 0)}
              width="9"
              height={rowH - 17 - (b % 2 ? 3 : 0)}
              rx="1.6"
              fill={bookColors[(r * 5 + b) % bookColors.length]}
              stroke={OFC.ink}
              strokeWidth="1.6"
            />
          ))}
        </g>
      ))}
      {rows >= 2 && <circle cx={w - 16} cy={h - 12} r="6" fill={OFC.plant} stroke={OFC.ink} strokeWidth="1.8" />}
    </g>
  );
}

/* ── 饮水机：水桶 + 气泡 + 接水 ── */
export function WaterCooler({ x, y, h = 92 }: { x: number; y: number; h?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-cooler">
      <rect x="0" y={h - 58} width="58" height="58" rx="7" fill="#e8eef5" stroke={OFC.ink} strokeWidth="2.6" />
      <rect x="9" y={h - 42} width="16" height="20" rx="4" fill="#d7e0ea" stroke={OFC.ink} strokeWidth="2" />
      <circle cx="43" cy={h - 30} r="6" fill={OFC.info} stroke={OFC.ink} strokeWidth="2" />
      <circle cx="43" cy={h - 14} r="6" fill={OFC.warn} stroke={OFC.ink} strokeWidth="2" />
      {/* 水桶 */}
      <path d={`M 8 ${h - 58} L 50 ${h - 58} L 44 ${h - 118} L 14 ${h - 118} Z`} fill="url(#ofc-water)" stroke={OFC.ink} strokeWidth="2.6" />
      <rect x="12" y={h - 122} width="34" height="8" rx="3" fill={OFC.waterDeep} stroke={OFC.ink} strokeWidth="2.2" />
      <g className="ofc-bubbles">
        <circle className="ofc-bubble-dot b1" cx="22" cy={h - 66} r="2.6" fill="#fff" opacity="0.9" />
        <circle className="ofc-bubble-dot b2" cx="34" cy={h - 70} r="2" fill="#fff" opacity="0.9" />
        <circle className="ofc-bubble-dot b3" cx="28" cy={h - 62} r="1.8" fill="#fff" opacity="0.9" />
      </g>
      {/* 龙头 */}
      <path d={`M 24 ${h - 52} l 0 12 l 8 0`} fill="none" stroke={OFC.metalDark} strokeWidth="3.4" strokeLinecap="round" />
    </g>
  );
}

/* ── 打印机：吐纸 ── */
export function Printer({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-printer">
      <rect x="0" y="18" width="76" height="46" rx="6" fill="#dfe6ee" stroke={OFC.ink} strokeWidth="2.6" />
      <rect x="10" y="0" width="56" height="22" rx="4" fill="#eef3f9" stroke={OFC.ink} strokeWidth="2.4" />
      <rect x="20" y="34" width="36" height="8" rx="2.4" fill="#b9c6d6" stroke={OFC.ink} strokeWidth="2" />
      <circle className="ofc-printer-led" cx="64" cy="30" r="3.4" fill={OFC.ok} stroke={OFC.ink} strokeWidth="1.6" />
      {/* 正在吐出的纸 */}
      <g className="ofc-print-sheet">
        <rect x="24" y="20" width="28" height="20" rx="2" fill={OFC.paper} stroke={OFC.ink} strokeWidth="1.8" />
        <line x1="29" y1="27" x2="47" y2="27" stroke="#b9c6d6" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="29" y1="32" x2="43" y2="32" stroke="#ccd6e2" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </g>
  );
}

/* ── 盆栽（schale = 缩放，窗台小盆复用）── */
export function Plant({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} className="ofc-furn ofc-plant">
      <path d="M -18 0 L 18 0 L 13 30 L -13 30 Z" fill={OFC.pot} stroke={OFC.ink} strokeWidth="2.4" />
      <rect x="-20" y="-6" width="40" height="9" rx="4" fill="#e8a469" stroke={OFC.ink} strokeWidth="2.4" />
      <g className="ofc-leaves">
        <path className="ofc-leaf lf1" d="M 0 -6 Q -6 -34 -22 -40 Q -12 -16 0 -6 Z" fill={OFC.plant} stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
        <path className="ofc-leaf lf2" d="M 0 -6 Q 8 -36 24 -42 Q 12 -16 0 -6 Z" fill={OFC.plantDeep} stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
        <path className="ofc-leaf lf3" d="M 0 -6 Q 0 -40 2 -52 Q 8 -30 4 -6 Z" fill={OFC.plant} stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** 窗台小盆（无独立动画组，复用 Plant 的缩略版）。 */
function Pot({ scale = 0.6 }: { scale?: number }) {
  return (
    <g transform={`scale(${scale})`}>
      <path d="M -13 0 L 13 0 L 9 22 L -9 22 Z" fill={OFC.pot} stroke={OFC.ink} strokeWidth="2.6" />
      <rect x="-15" y="-5" width="30" height="8" rx="3.6" fill="#e8a469" stroke={OFC.ink} strokeWidth="2.6" />
      <g className="ofc-leaves">
        <path className="ofc-leaf lf1" d="M 0 -5 Q -5 -26 -17 -31 Q -9 -12 0 -5 Z" fill={OFC.plant} stroke={OFC.ink} strokeWidth="3" strokeLinejoin="round" />
        <path className="ofc-leaf lf2" d="M 0 -5 Q 6 -28 18 -32 Q 9 -12 0 -5 Z" fill={OFC.plantDeep} stroke={OFC.ink} strokeWidth="3" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/* ── 地毯 ── */
export function Rug({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g className="ofc-furn ofc-rug">
      <rect x={x} y={y} width={w} height={h} rx="26" fill={OFC.rug} stroke={OFC.rugEdge} strokeWidth="3" />
      <rect x={x + 14} y={y + 12} width={w - 28} height={h - 24} rx="18" fill="none" stroke={OFC.rugEdge} strokeWidth="2" strokeDasharray="9 7" opacity="0.75" />
    </g>
  );
}

/** 地板木纹条（横向，间距固定）。 */
export function FloorBoards({ top, height, width }: { top: number; height: number; width: number }) {
  const count = Math.max(3, Math.round(height / 26));
  return (
    <g className="ofc-furn ofc-floor" opacity="0.9">
      {Array.from({ length: count }).map((_, i) => (
        <rect key={i} x={((i * 148) % width) - 60} y={top + 14 + i * 26} width="200" height="2" rx="1" fill={OFC.floorB} />
      ))}
    </g>
  );
}
