/**
 * 办公室家具与墙面装饰（team-office 域 09-26 v5「造型升级」）。
 *
 * v4 被评「场景也丑」，复盘出三条病根，这一版逐条治：
 *   ① **配色褪色**：墙/地/毯全是低饱和相近色 ⇒ v5 换成明确的主色与对比（见 office-palette）。
 *   ② **视觉噪音**：40 条墙纸竖纹 + 满架书脊 + 一地零碎小物 ⇒ 全部删掉/精简（留白比堆料好看）。
 *   ③ **没有层次**：所有元素一个明度、一个平面 ⇒ 加**落地投影**、给墙面做**腰线分色**、
 *      家具统一退到「后排」（y 210~310）、工位在前排（y 370+），形成纵深。
 * ⛔ 描边统一 INK_W（粗描边是卡通感的地基）；细节线才用 INK_W_THIN。
 * ⛔ 动效仍只挂 CSS 类（云漂 / 钟摆 / 水泡 / 吐纸 / 叶片摇 / 灯光呼吸），这里只管形状。
 */
import { OFC, INK_W, INK_W_THIN } from "./office-palette";

/** 落地投影（让家具"站在地上"而不是浮在地板贴图上）。 */
function GroundShadow({ cx, cy, rx, ry = 6 }: { cx: number; cy: number; rx: number; ry?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={OFC.shadow} opacity="0.14" />;
}

/* ── 窗：天空 + 太阳 + 云 + 城市剪影 ── */
export function Window({ x, y, w = 262, h = 140 }: { x: number; y: number; w?: number; h?: number }) {
  const gx = 11;
  const gw = w - gx * 2;
  const gh = h - gx * 2;
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-window">
      <rect x="0" y="0" width={w} height={h} rx="12" fill={OFC.paper} stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x={gx} y={gx} width={gw} height={gh} rx="7" fill="url(#ofc-sky)" />
      {/* 太阳 */}
      <circle cx={gw * 0.78} cy={gh * 0.26} r="15" fill="#ffe9a8" opacity="0.95" />
      {/* 城市剪影（4 块，远景一层就够，多了是噪音） */}
      <g className="ofc-skyline" opacity="0.42">
        <rect x={gx + 8} y={gx + gh - 34} width="30" height="42" fill="#a9cde8" />
        <rect x={gx + 44} y={gx + gh - 52} width="34" height="60" fill="#96c3e2" />
        <rect x={gx + 84} y={gx + gh - 26} width="26" height="34" fill="#a9cde8" />
        <rect x={w - gx - 76} y={gx + gh - 44} width="30" height="52" fill="#96c3e2" />
        <rect x={w - gx - 42} y={gx + gh - 30} width="34" height="38" fill="#a9cde8" />
      </g>
      {/* 云（两条不同速度漂移） */}
      <g className="ofc-cloud">
        <ellipse cx={gw * 0.3} cy={gh * 0.34} rx="23" ry="11" fill="#fff" opacity="0.95" />
        <ellipse cx={gw * 0.4} cy={gh * 0.27} rx="15" ry="9" fill="#fff" opacity="0.95" />
      </g>
      <g className="ofc-cloud ofc-cloud-slow">
        <ellipse cx={gw * 0.62} cy={gh * 0.62} rx="18" ry="8" fill="#fff" opacity="0.85" />
      </g>
      {/* 窗棂（一竖一横） */}
      <line x1={w / 2} y1={gx} x2={w / 2} y2={gx + gh} stroke={OFC.paper} strokeWidth="7" />
      <line x1={gx} y1={gh / 2 + gx} x2={w - gx} y2={gh / 2 + gx} stroke={OFC.paper} strokeWidth="7" />
      <line x1={w / 2} y1={gx} x2={w / 2} y2={gx + gh} stroke={OFC.ink} strokeWidth="2.4" opacity="0.35" />
      <line x1={gx} y1={gh / 2 + gx} x2={w - gx} y2={gh / 2 + gx} stroke={OFC.ink} strokeWidth="2.4" opacity="0.35" />
      {/* 窗台 */}
      <rect x="-8" y={h - 5} width={w + 16} height="11" rx="5" fill={OFC.ink} opacity="0.14" />
      <rect x="-8" y={h - 9} width={w + 16} height="10" rx="5" fill={OFC.metal} stroke={OFC.ink} strokeWidth="2.6" />
      <g transform={`translate(${w - 46} ${h - 4})`}>
        <Pot scale={0.66} />
      </g>
    </g>
  );
}

/* ── 白板：三行要点 + 两张便签 + 一个对勾 ── */
export function Whiteboard({ x, y, w = 236, h = 124 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-whiteboard">
      <rect x="-5" y="-5" width={w + 10} height={h + 10} rx="11" fill={OFC.ink} opacity="0.1" />
      <rect x="0" y="0" width={w} height={h} rx="9" fill={OFC.paper} stroke={OFC.ink} strokeWidth={INK_W} />
      <g strokeLinecap="round" className="ofc-board-lines">
        <line className="ofc-board-line l1" x1="20" y1="30" x2="140" y2="30" stroke="#6fa8d6" strokeWidth="7" />
        <line className="ofc-board-line l2" x1="20" y1="50" x2="104" y2="50" stroke="#9fc6e4" strokeWidth="7" />
        <line className="ofc-board-line l3" x1="20" y1="70" x2="126" y2="70" stroke="#bcd6ea" strokeWidth="7" />
        <path className="ofc-board-line l4" d="M 158 44 q 26 3 34 20" fill="none" stroke={OFC.warn} strokeWidth="3.4" />
        <path className="ofc-board-line l5" d="M 186 70 l 7 -4 l -1 9 z" fill={OFC.warn} stroke="none" />
      </g>
      <rect x="162" y="18" width="56" height="26" rx="4" fill={OFC.noteA} stroke={OFC.ink} strokeWidth="2.4" transform="rotate(-3 190 31)" />
      <rect className="ofc-board-pin" x="162" y="18" width="56" height="26" rx="4" fill="none" stroke={OFC.ink} strokeWidth="1.8" strokeDasharray="5 4" transform="rotate(-3 190 31)" />
      <rect x="150" y="84" width="60" height="28" rx="4" fill={OFC.noteC} stroke={OFC.ink} strokeWidth="2.4" transform="rotate(2 180 98)" />
      <rect x="20" y="86" width="48" height="28" rx="4" fill={OFC.noteB} stroke={OFC.ink} strokeWidth="2.4" transform="rotate(-3 44 100)" />
    </g>
  );
}

/* ── 挂钟：秒针走 + 钟摆 ── */
export function Clock({ x, y, r = 30 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-clock">
      <line x1="0" y1={-r - 4} x2="0" y2={-r + 6} stroke={OFC.ink} strokeWidth="3" />
      <circle cx="0" cy="0" r={r} fill={OFC.paper} stroke={OFC.ink} strokeWidth={INK_W} />
      <circle cx="0" cy="0" r={r - 6} fill="#f6fafd" />
      {[0, 90, 180, 270].map((deg) => (
        <circle key={deg} cx="0" cy={-r + 10} r="1.9" fill={OFC.inkSoft} transform={`rotate(${deg})`} />
      ))}
      <line className="ofc-clock-minute" x1="0" y1="0" x2="0" y2={-r * 0.66} stroke={OFC.ink} strokeWidth="3" strokeLinecap="round" />
      <line className="ofc-clock-hand" x1="0" y1="0" x2={r * 0.52} y2={r * 0.16} stroke={OFC.warn} strokeWidth="3" strokeLinecap="round" />
      <circle cx="0" cy="0" r="3" fill={OFC.ink} />
      <g className="ofc-pendulum" transform={`translate(0 ${r + 2})`}>
        <line x1="0" y1="0" x2="0" y2="15" stroke={OFC.inkSoft} strokeWidth="2.6" />
        <circle cx="0" cy="19" r="6" fill={OFC.warn} stroke={OFC.ink} strokeWidth="2.4" />
      </g>
    </g>
  );
}

/* ── 吊灯：链条 + 灯罩 + 光锥 ── */
export function PendantLight({ x, y = 0, drop = 52 }: { x: number; y?: number; drop?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-lamp">
      <rect x="-16" y="-6" width="32" height="8" rx="4" fill={OFC.ink} opacity="0.18" />
      <line x1="0" y1="0" x2="0" y2={drop} stroke={OFC.inkSoft} strokeWidth="2.6" />
      <g className="ofc-lamp-swing" transform={`translate(0 ${drop})`}>
        <path d={`M -16 0 L 16 0 L 12 12 L -12 12 Z`} fill={OFC.inkSoft} stroke={OFC.ink} strokeWidth="2.4" strokeLinejoin="round" />
        <path d={`M -34 12 L 34 12 L 20 44 L -20 44 Z`} fill="#f6d99a" stroke={OFC.ink} strokeWidth={INK_W} strokeLinejoin="round" />
        <path d={`M -20 44 L 20 44 L 24 52 L -24 52 Z`} fill="#ffe6a8" stroke={OFC.ink} strokeWidth="2.6" strokeLinejoin="round" />
        <ellipse className="ofc-lamp-glow" cx="0" cy="50" rx="15" ry="6" fill="#ffe9a8" stroke={OFC.ink} strokeWidth="2.2" />
        <path className="ofc-lamp-cone" d="M -24 52 L 24 52 L 70 168 L -70 168 Z" fill="#ffe9a8" opacity="0.14" />
      </g>
    </g>
  );
}

/* ── 书架：两层搁板 + 一排书 + 顶上一盆 ── */
export function Bookshelf({ x, y, w = 80, h = 116 }: { x: number; y: number; w?: number; h?: number }) {
  const rows = 2;
  const rowH = (h - 12) / rows;
  const books = [OFC.noteB, OFC.noteC, OFC.noteA, OFC.plant, OFC.info];
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-shelf">
      <GroundShadow cx={w / 2} cy={h + 5} rx={w * 0.56} />
      <rect x="0" y="0" width={w} height={h} rx="6" fill={OFC.woodLight} stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x="0" y="0" width={w} height="9" rx="4" fill={OFC.wood} stroke={OFC.ink} strokeWidth="2.6" />
      {Array.from({ length: rows }).map((_, r) => {
        const top = 12 + r * rowH;
        return (
          <g key={r}>
            <rect x="7" y={top} width={w - 14} height={rowH - 10} rx="3" fill="#fbf6ea" stroke={OFC.ink} strokeWidth="2.4" />
            {Array.from({ length: 4 }).map((__, b) => (
              <rect
                key={b}
                x={11 + b * 15}
                y={top + 4}
                width="11"
                height={rowH - 20}
                rx="2"
                fill={books[(r * 4 + b) % books.length]}
                stroke={OFC.ink}
                strokeWidth="2"
              />
            ))}
          </g>
        );
      })}
      <g transform={`translate(${w - 8} -2)`}>
        <Pot scale={0.56} />
      </g>
    </g>
  );
}

/* ── 饮水机：水桶 + 水泡 + 龙头 + 一只杯 ── */
export function WaterCooler({ x, y, h = 96 }: { x: number; y: number; h?: number }) {
  const bw = 60;
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-cooler">
      <GroundShadow cx={bw / 2} cy={h + 5} rx={bw * 0.55} />
      <rect x="0" y={h - 62} width={bw} height="62" rx="8" fill={OFC.metal} stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x="9" y={h - 44} width="18" height="22" rx="4" fill="#e7edf4" stroke={OFC.ink} strokeWidth="2.4" />
      <circle cx="44" cy={h - 32} r="6.4" fill={OFC.info} stroke={OFC.ink} strokeWidth="2.4" />
      <circle cx="44" cy={h - 15} r="6.4" fill={OFC.warn} stroke={OFC.ink} strokeWidth="2.4" />
      <path d={`M 8 ${h - 62} L 52 ${h - 62} L 45 ${h - 128} L 15 ${h - 128} Z`} fill="url(#ofc-water)" stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x="13" y={h - 133} width="34" height="9" rx="4" fill={OFC.waterDeep} stroke={OFC.ink} strokeWidth="2.6" />
      <g className="ofc-bubbles">
        <circle className="ofc-bubble-dot b1" cx="24" cy={h - 72} r="2.8" fill="#fff" opacity="0.9" />
        <circle className="ofc-bubble-dot b2" cx="36" cy={h - 76} r="2.2" fill="#fff" opacity="0.9" />
        <circle className="ofc-bubble-dot b3" cx="30" cy={h - 66} r="2" fill="#fff" opacity="0.9" />
      </g>
      <path d={`M 26 ${h - 56} l 0 13 l 9 0`} fill="none" stroke={OFC.ink} strokeWidth="4" strokeLinecap="round" />
      <path d={`M 40 ${h - 28} h 13 l -2 12 h -9 z`} fill={OFC.paper} stroke={OFC.ink} strokeWidth="2.4" />
    </g>
  );
}

/* ── 打印机：吐纸 + 指示灯 ── */
export function Printer({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ofc-furn ofc-printer">
      <GroundShadow cx={38} cy={69} rx={42} />
      <rect x="0" y="20" width="76" height="48" rx="7" fill={OFC.metal} stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x="9" y="0" width="58" height="24" rx="5" fill="#eef3f9" stroke={OFC.ink} strokeWidth="2.8" />
      <rect x="19" y="37" width="38" height="9" rx="3" fill={OFC.ink} opacity="0.22" />
      <rect x="19" y="20" width="38" height="9" rx="3" fill={OFC.inkSoft} stroke={OFC.ink} strokeWidth="2.2" />
      <circle className="ofc-printer-led" cx="62" cy="32" r="3.6" fill={OFC.ok} stroke={OFC.ink} strokeWidth="2" />
      <g className="ofc-print-sheet">
        <rect x="24" y="22" width="28" height="20" rx="2.5" fill={OFC.paper} stroke={OFC.ink} strokeWidth="2.2" />
        <line x1="29" y1="29" x2="47" y2="29" stroke="#b9c6d6" strokeWidth={INK_W_THIN} strokeLinecap="round" />
        <line x1="29" y1="34" x2="43" y2="34" stroke="#ccd6e2" strokeWidth={INK_W_THIN} strokeLinecap="round" />
      </g>
    </g>
  );
}

/* ── 盆栽（窗台小盆复用 Pot）── */
export function Plant({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} className="ofc-furn ofc-plant">
      <GroundShadow cx={0} cy={33} rx={23} />
      <path d="M -20 0 L 20 0 L 14 32 L -14 32 Z" fill={OFC.pot} stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x="-23" y="-7" width="46" height="11" rx="5" fill="#e8a469" stroke={OFC.ink} strokeWidth={INK_W} />
      <g className="ofc-leaves">
        <path className="ofc-leaf lf1" d="M 0 -7 Q -7 -38 -25 -45 Q -13 -18 0 -7 Z" fill={OFC.plant} stroke={OFC.ink} strokeWidth="2.8" strokeLinejoin="round" />
        <path className="ofc-leaf lf2" d="M 0 -7 Q 9 -40 27 -47 Q 13 -18 0 -7 Z" fill={OFC.plantDeep} stroke={OFC.ink} strokeWidth="2.8" strokeLinejoin="round" />
        <path className="ofc-leaf lf3" d="M 0 -7 Q 0 -44 2 -58 Q 9 -33 5 -7 Z" fill={OFC.plant} stroke={OFC.ink} strokeWidth="2.8" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** 窗台/书架上的小盆。 */
function Pot({ scale = 0.6 }: { scale?: number }) {
  return (
    <g transform={`scale(${scale})`}>
      <path d="M -15 0 L 15 0 L 10 24 L -10 24 Z" fill={OFC.pot} stroke={OFC.ink} strokeWidth="4" />
      <rect x="-17" y="-6" width="34" height="9" rx="4" fill="#e8a469" stroke={OFC.ink} strokeWidth="4" />
      <g className="ofc-leaves">
        <path className="ofc-leaf lf1" d="M 0 -6 Q -6 -30 -20 -36 Q -10 -14 0 -6 Z" fill={OFC.plant} stroke={OFC.ink} strokeWidth="4" strokeLinejoin="round" />
        <path className="ofc-leaf lf2" d="M 0 -6 Q 7 -32 21 -37 Q 11 -14 0 -6 Z" fill={OFC.plantDeep} stroke={OFC.ink} strokeWidth="4" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/* ── 地毯 ── */
export function Rug({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g className="ofc-furn ofc-rug">
      <rect x={x} y={y} width={w} height={h} rx="30" fill={OFC.rug} stroke={OFC.rugEdge} strokeWidth="3.4" />
      <rect x={x + 16} y={y + 14} width={w - 32} height={h - 28} rx="20" fill="none" stroke={OFC.rugEdge} strokeWidth="2.6" strokeDasharray="10 8" opacity="0.8" />
    </g>
  );
}

/** 地板木纹（宽板，稀疏几道就够了 —— v4 的密纹是噪音）。 */
export function FloorBoards({ top, height, width }: { top: number; height: number; width: number }) {
  const count = Math.max(2, Math.round(height / 46));
  return (
    <g className="ofc-furn ofc-floor">
      {Array.from({ length: count }).map((_, i) => (
        <rect key={i} x={((i * 210) % width) - 70} y={top + 26 + i * 46} width="260" height="3.4" rx="1.7" fill={OFC.floorB} opacity="0.85" />
      ))}
    </g>
  );
}
