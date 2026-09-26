/**
 * 斜俯视房间与家具（team-office 域 09-26 v6「复刻 ai-office-react」）。
 *
 * 参考实现（PixiJS + Spine）的画面要素，按 SVG 复刻：
 *   · 房间 = 一个长方体从斜上方看 —— 后墙正对、两侧墙向内收、地板是后窄前宽的梯形
 *   · 极简浅色现代办公室：近白地板 / 灰白墙 / 纯白桌 / **深灰显示器背面** / 木柜 / 绿植
 *   · 靠墙家具（柜子、冰箱、吊架、画框、饮水机）+ 落地绿植
 * ⛔ 家具一律用「地面归一化坐标 (u,v) + 纵深缩放」定位（见 office-iso.ts）——
 *    早先那种「各画各的绝对坐标」会随布局改动集体漂移。
 * ⛔ 主轮廓描边照旧用 INK_W（粗描边是这个画风的底子）。
 */
import { OFC, INK_W } from "./office-palette";
import { ISO } from "./office-palette";
import { depthScale, floorPoint, FLOOR, SCENE_W, WALL_H, wallPoint, type FloorSpot } from "./office-iso";

/* ── 房间：地板 / 后墙 / 两侧墙 / 踢脚 / 天花板边缘 ── */
export function IsoRoom() {
  const { bl, br, fr, fl } = FLOOR;
  const p = (x: number, y: number) => `${x},${y}`;
  return (
    <g className="ofc-room">
      {/* 后墙 */}
      <rect x={bl[0]} y={bl[1] - WALL_H} width={br[0] - bl[0]} height={WALL_H} fill={ISO.wall} />
      {/* 左右侧墙（向内收的四边形） */}
      <polygon points={`${p(bl[0], bl[1] - WALL_H)} ${p(bl[0], bl[1])} ${p(fl[0], fl[1])} ${p(fl[0], fl[1] - WALL_H)}`} fill={ISO.wallSide} />
      <polygon points={`${p(br[0], br[1] - WALL_H)} ${p(br[0], br[1])} ${p(fr[0], fr[1])} ${p(fr[0], fr[1] - WALL_H)}`} fill={ISO.wallSide} />
      {/* 墙顶平面（天花板边缘，给房间"封顶"） */}
      <polygon points={`${p(bl[0], bl[1] - WALL_H)} ${p(br[0], br[1] - WALL_H)} ${p(br[0] + 42, br[1] - WALL_H - 26)} ${p(bl[0] - 42, bl[1] - WALL_H - 26)}`} fill={ISO.wallTop} />
      <polygon points={`${p(bl[0] - 42, bl[1] - WALL_H - 26)} ${p(fl[0] - 42, fl[1] - WALL_H - 40)} ${p(fr[0] + 42, fr[1] - WALL_H - 40)} ${p(br[0] + 42, br[1] - WALL_H - 26)}`} fill={ISO.ceiling} opacity="0.85" />
      {/* 天花板灯轨（两条斜线，参考实现顶部那几道结构线） */}
      <g stroke={ISO.baseboard} strokeWidth="3" opacity="0.75">
        <line x1={bl[0] - 34} y1={bl[1] - WALL_H - 18} x2={fl[0] - 34} y2={fl[1] - WALL_H - 32} />
        <line x1={br[0] + 34} y1={br[1] - WALL_H - 18} x2={fr[0] + 34} y2={fr[1] - WALL_H - 32} />
      </g>
      {/* 地板 */}
      <polygon points={`${p(bl[0], bl[1])} ${p(br[0], br[1])} ${p(fr[0], fr[1])} ${p(fl[0], fl[1])}`} fill={ISO.floor} />
      {/* 地板拼缝（顺着纵深方向，稀疏几道） */}
      <g stroke={ISO.floorTile} strokeWidth="2.6">
        {[0.24, 0.42, 0.58, 0.76].map((u) => {
          const a = floorPoint(u, 0);
          const b = floorPoint(u, 1);
          return <line key={u} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </g>
      {/* 踢脚线 */}
      <line x1={bl[0]} y1={bl[1]} x2={br[0]} y2={br[1]} stroke={ISO.baseboard} strokeWidth="5" />
      <line x1={bl[0]} y1={bl[1]} x2={fl[0]} y2={fl[1]} stroke={ISO.baseboard} strokeWidth="5" />
      <line x1={br[0]} y1={br[1]} x2={fr[0]} y2={fr[1]} stroke={ISO.baseboard} strokeWidth="5" />
      {/* 地板前沿（观众侧边缘，参考图里那条浅色地台边） */}
      <polygon points={`${p(fl[0], fl[1])} ${p(fr[0], fr[1])} ${p(fr[0] + 14, fr[1] + 16)} ${p(fl[0] - 14, fl[1] + 16)}`} fill={ISO.wallTop} stroke={ISO.baseboard} strokeWidth="3" />
    </g>
  );
}

/** 通用等距长方体（靠墙柜子/冰箱/矮柜都用它）。 */
export function IsoBox({ u0, v0, u1, v1, h, top, front, side }: {
  u0: number; v0: number; u1: number; v1: number; h: number;
  top: string; front: string; side?: string;
}) {
  const a = floorPoint(u0, v0);
  const b = floorPoint(u1, v0);
  const c = floorPoint(u1, v1);
  const d = floorPoint(u0, v1);
  const H = h * depthScale((v0 + v1) / 2);
  const f = (pt: FloorSpot, up = 0) => `${pt.x.toFixed(1)},${(pt.y - up).toFixed(1)}`;
  return (
    <g>
      {side && <polygon points={`${f(b)} ${f(c)} ${f(c, H)} ${f(b, H)}`} fill={side} stroke={ISO.ink} strokeWidth={INK_W} strokeLinejoin="round" />}
      <polygon points={`${f(d)} ${f(c)} ${f(c, H)} ${f(d, H)}`} fill={front} stroke={ISO.ink} strokeWidth={INK_W} strokeLinejoin="round" />
      <polygon points={`${f(a, H)} ${f(b, H)} ${f(c, H)} ${f(d, H)}`} fill={top} stroke={ISO.ink} strokeWidth={INK_W} strokeLinejoin="round" />
    </g>
  );
}

/** 绿植（落地）。 */
export function IsoPlant({ u, v, size = 1 }: { u: number; v: number; size?: number }) {
  const p = floorPoint(u, v);
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${p.scale * size})`} className="ofc-plant">
      <ellipse cx="0" cy="2" rx="26" ry="9" fill={ISO.shadow} opacity="0.13" />
      <path d="M -19 0 L 19 0 L 14 -30 L -14 -30 Z" fill={ISO.pot} stroke={ISO.ink} strokeWidth={INK_W} strokeLinejoin="round" />
      <g className="ofc-leaves">
        <path className="ofc-leaf lf1" d="M 0 -30 Q -16 -58 -34 -62 Q -18 -34 0 -30 Z" fill={ISO.plant} stroke={ISO.ink} strokeWidth="2.6" strokeLinejoin="round" />
        <path className="ofc-leaf lf2" d="M 0 -30 Q 16 -58 34 -62 Q 18 -34 0 -30 Z" fill={ISO.plantDark} stroke={ISO.ink} strokeWidth="2.6" strokeLinejoin="round" />
        <path className="ofc-leaf lf3" d="M 0 -30 Q -2 -66 2 -78 Q 12 -50 6 -30 Z" fill={ISO.plant} stroke={ISO.ink} strokeWidth="2.6" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** 靠墙木柜（顶上摆点小物）。 */
export function IsoCabinet({ u0, u1, v = 0.06, h = 74 }: { u0: number; u1: number; v?: number; h?: number }) {
  const a = floorPoint(u0, v);
  const b = floorPoint(u1, v);
  const H = h * depthScale(v);
  return (
    <g>
      <IsoBox u0={u0} v0={v} u1={u1} v1={v + 0.07} h={h} top={ISO.wood} front={ISO.woodDark} side={ISO.woodDark} />
      {/* 柜门缝 + 拉手 */}
      <g stroke={ISO.ink} strokeWidth="2.2" opacity="0.5">
        <line x1={a.x + 2} y1={a.y - H * 0.42} x2={b.x - 2} y2={b.y - H * 0.42} />
      </g>
      {[0.28, 0.72].map((t) => {
        const x = a.x + (b.x - a.x) * t;
        return <rect key={t} x={x - 9} y={a.y - H * 0.52} width="18" height="4" rx="2" fill={ISO.ink} opacity="0.45" />;
      })}
    </g>
  );
}

/** 立柱冰箱（参考图右侧那台）。 */
export function IsoFridge({ u, v = 0.06 }: { u: number; v?: number }) {
  return (
    <g>
      {/* ⛔ 别用近白色：会和后墙糊成一片，看着像"多了一块墙"（实测） */}
      <IsoBox u0={u - 0.045} v0={v} u1={u + 0.045} v1={v + 0.09} h={132} top="#dde2e8" front="#cbd2da" side="#b9c1ca" />
      <g stroke={ISO.ink} strokeWidth="2.2" opacity="0.45">
        <line x1={floorPoint(u - 0.045, v).x} y1={floorPoint(u, v).y - 92} x2={floorPoint(u + 0.045, v).x} y2={floorPoint(u, v).y - 92} />
      </g>
    </g>
  );
}

/** 墙上的吊架（参考图里后墙那两层开放格子）。 */
export function WallShelf({ u0, u1, up, rows = 2 }: { u0: number; u1: number; up: number; rows?: number }) {
  const a = wallPoint(u0, up);
  const b = wallPoint(u1, up);
  const w = b.x - a.x;
  return (
    <g>
      {Array.from({ length: rows }).map((_, r) => (
        <g key={r}>
          <rect x={a.x} y={a.y + r * 34} width={w} height="9" fill={ISO.wood} stroke={ISO.ink} strokeWidth="2.6" />
          {/* 架上小物 */}
          {[0.12, 0.34, 0.56, 0.78].map((t, i) => (
            <rect key={t} x={a.x + w * t} y={a.y + r * 34 - 16} width="15" height="16" rx="2.5"
              fill={[OFC.noteB, OFC.noteA, ISO.plant, OFC.noteC][(r + i) % 4]} stroke={ISO.ink} strokeWidth="2.2" />
          ))}
        </g>
      ))}
      {/* 侧板 */}
      <line x1={a.x} y1={a.y} x2={a.x} y2={a.y + (rows - 1) * 34 + 9} stroke={ISO.ink} strokeWidth="2.6" />
      <line x1={b.x} y1={b.y} x2={b.x} y2={b.y + (rows - 1) * 34 + 9} stroke={ISO.ink} strokeWidth="2.6" />
    </g>
  );
}

/** 后墙画框 / 白板（参考图里挂在墙上的那几块）。 */
export function WallBoard({ u, up, w = 118, h = 78, tint = OFC.paper, lines = 3 }: { u: number; up: number; w?: number; h?: number; tint?: string; lines?: number }) {
  const p = wallPoint(u, up);
  return (
    <g transform={`translate(${p.x - w / 2} ${p.y - h})`}>
      <rect x="-4" y="-4" width={w + 8} height={h + 8} rx="6" fill={ISO.ink} opacity="0.08" />
      <rect x="0" y="0" width={w} height={h} rx="5" fill={tint} stroke={ISO.ink} strokeWidth="2.8" />
      <g strokeLinecap="round">
        {Array.from({ length: lines }).map((_, i) => (
          <line key={i} x1="16" y1={22 + i * 17} x2={16 + (w - 40) * (1 - i * 0.18)} y2={22 + i * 17} stroke="#9fb4cc" strokeWidth="6" />
        ))}
      </g>
    </g>
  );
}

/** 饮水机（靠墙）。 */
export function IsoCooler({ u, v = 0.1 }: { u: number; v?: number }) {
  const p = floorPoint(u, v);
  const s = p.scale;
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${s})`}>
      <ellipse cx="0" cy="2" rx="26" ry="9" fill={ISO.shadow} opacity="0.13" />
      <rect x="-22" y="-58" width="44" height="58" rx="7" fill="#e6e8ec" stroke={ISO.ink} strokeWidth={INK_W / s} />
      <path d="M -15 -58 L 15 -58 L 11 -108 L -11 -108 Z" fill="#cfe6f7" stroke={ISO.ink} strokeWidth={INK_W / s} />
      <path className="ofc-steam" d="M 0 -104 q 4 -8 0 -16" fill="none" stroke={ISO.baseboard} strokeWidth="3" strokeLinecap="round" />
      <circle cx="12" cy="-30" r="5" fill={OFC.info} stroke={ISO.ink} strokeWidth="2.2" />
      <circle cx="12" cy="-14" r="5" fill={OFC.warn} stroke={ISO.ink} strokeWidth="2.2" />
    </g>
  );
}

/** 打印机（靠墙落地）。 */
export function IsoPrinter({ u, v = 0.1 }: { u: number; v?: number }) {
  const p = floorPoint(u, v);
  const s = p.scale;
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${s})`} className="ofc-printer">
      <ellipse cx="0" cy="2" rx="32" ry="10" fill={ISO.shadow} opacity="0.13" />
      <rect x="-30" y="-52" width="60" height="52" rx="7" fill="#e9ebef" stroke={ISO.ink} strokeWidth={INK_W / s} />
      <rect x="-22" y="-72" width="44" height="22" rx="5" fill="#f2f4f7" stroke={ISO.ink} strokeWidth="2.6" />
      <rect x="-16" y="-30" width="32" height="9" rx="3" fill={ISO.baseboard} stroke={ISO.ink} strokeWidth="2.2" />
      <circle className="ofc-printer-led" cx="20" cy="-44" r="3.2" fill={OFC.ok} stroke={ISO.ink} strokeWidth="1.8" />
      <g className="ofc-print-sheet">
        <rect x="-13" y="-24" width="26" height="18" rx="2" fill={OFC.paper} stroke={ISO.ink} strokeWidth="2" />
      </g>
    </g>
  );
}

/** 后墙挂钟。 */
export function WallClock({ u = 0.09, up = 96 }: { u?: number; up?: number }) {
  const p = wallPoint(u, up);
  return (
    <g transform={`translate(${p.x} ${p.y})`}>
      <circle cx="0" cy="0" r="24" fill={OFC.paper} stroke={ISO.ink} strokeWidth="3" />
      <circle className="ofc-clock-hand" cx="0" cy="0" r="2" fill={ISO.ink} stroke="none" />
      <line className="ofc-clock-minute" x1="0" y1="0" x2="0" y2="-15" stroke={ISO.ink} strokeWidth="2.6" strokeLinecap="round" />
      <line className="ofc-clock-hand" x1="0" y1="0" x2="11" y2="3" stroke={OFC.warn} strokeWidth="2.6" strokeLinecap="round" />
    </g>
  );
}

/* ── 工位：白桌 + 深灰显示器（背面朝观众）+ 椅子 ──
   ⛔ 构图对齐参考实现：**显示器在最远（贴在桌后）、桌子居中、人坐在桌子近侧（背对观众）**。
   角色本体由 OfficeScene 画在 (u,v) 上（同一坐标），这里只出家具。 */
export function IsoDeskSet({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  const s = p.scale;
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${s})`} className="ofc-desk-furn">
      {/* 桌前地面阴影 */}
      <ellipse cx="0" cy="-6" rx="62" ry="20" fill={ISO.shadow} opacity="0.09" />
      {/* 桌子（白色台面 + 前沿厚度 + 两条腿） */}
      <rect x="-64" y="-72" width="128" height="17" rx="4" fill={ISO.deskTop} stroke={ISO.ink} strokeWidth={INK_W / s} />
      <rect x="-64" y="-55" width="128" height="7" rx="3" fill={ISO.deskEdge} stroke={ISO.ink} strokeWidth="2.4" />
      <rect x="-56" y="-48" width="9" height="46" rx="3" fill={ISO.deskLeg} stroke={ISO.ink} strokeWidth="2.4" />
      <rect x="47" y="-48" width="9" height="46" rx="3" fill={ISO.deskLeg} stroke={ISO.ink} strokeWidth="2.4" />
      {/* 显示器：观众看到的是背面（深灰）—— 参考实现的观感。
          ⛔ 必须**偏到人的侧面**（x +38）：居中的话会正好盖住坐在桌前那个人的头。 */}
      <g transform="translate(38 0)">
        <rect x="-25" y="-134" width="50" height="52" rx="5" fill={ISO.monitorBack} stroke={ISO.ink} strokeWidth={INK_W / s} />
        <rect x="-19" y="-128" width="38" height="40" rx="3" fill={ISO.monitor} opacity="0.75" />
        <rect x="-6" y="-82" width="12" height="8" fill={ISO.monitorStand} stroke={ISO.ink} strokeWidth="2.2" />
        <rect x="-14" y="-75" width="28" height="6" rx="3" fill={ISO.monitorStand} stroke={ISO.ink} strokeWidth="2.2" />
      </g>
      {/* 桌上小物 */}
      <rect x="-56" y="-80" width="26" height="9" rx="3" fill="#eef1f5" stroke={ISO.ink} strokeWidth="2.2" />
      <g transform="translate(46 -82)">
        <rect x="-6" y="-12" width="12" height="13" rx="2.6" fill={OFC.paper} stroke={ISO.ink} strokeWidth="2.2" />
        <path d="M 6 -9 q 5 3.4 0 7.6" fill="none" stroke={ISO.ink} strokeWidth="2.2" />
      </g>
      {/* 椅子（人在其前方，会挡住大半） */}
      <g>
        <ellipse cx="0" cy="16" rx="26" ry="9" fill={ISO.chairDark} stroke={ISO.ink} strokeWidth="2.4" />
        <rect x="-24" y="-10" width="48" height="30" rx="9" fill={ISO.chair} stroke={ISO.ink} strokeWidth={INK_W / s} />
        <rect x="-3" y="24" width="7" height="14" rx="3" fill={ISO.chairDark} stroke={ISO.ink} strokeWidth="2.2" />
      </g>
    </g>
  );
}

/** 房间尺寸导出（供 Scene 设 viewBox）。 */
export const ROOM_BOX = { w: SCENE_W, h: 640 };
