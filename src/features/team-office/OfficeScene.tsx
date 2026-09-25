/**
 * 公司模式 · 虚拟办公室插画（09-25 v3）。
 *
 * ⛔ v2 教训：div 拼装 + 纯色块 = 「色块药丸」，用户评「不好看」。插画感的三要素是
 *    ① **统一描边**（卡通感的关键，纯填充色块永远像占位图）
 *    ② 明暗/投影（人物与家具落地）
 *    ③ 统一坐标系（整间办公室一张 SVG，元素之间不会各自漂移）
 *    本文件即按此重写：场景 + 工位 + 角色全部在同一个 viewBox 里画。
 *
 * 状态语义：running=敲键盘+屏幕亮+气泡 / idle=闭眼+Zzz+咖啡 / never=空工位（虚化+熄屏+虚线标）
 */
import { useMemo } from "react";

export type OfficeMember = { id: string; name: string; profession: string; running: boolean; hasThread: boolean };
export type OfficeSceneProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  onOpenThread?: (memberId: string) => void;
};

/* ── 统一色板（柔和插画色） ── */
const C = {
  ink: "#2f3a4a",
  wall: "#eef3f9",
  wallShade: "#e2eaf4",
  skirt: "#cfd9e6",
  floorA: "#f3e9da",
  floorB: "#eadcc7",
  woodDark: "#c09a63",
  deskTop: "#e2c39a",
  screen: "#dfe9f5",
  screenOn: "#bfe3cf",
  metal: "#b9c4d1",
  paper: "#ffffff",
  skin: "#f6d3ad",
  hair: "#3a4657",
  shoe: "#39424f",
  noteA: "#ffe08a",
  noteB: "#a8d8f0",
  noteC: "#f7b3c0",
};

/** 员工配色（每人一个色相，柔和但有区分度）。 */
const WORKER_COLORS = ["#5b9bd5", "#7e7ce0", "#3fb6a8", "#e8875f", "#c96fb4", "#6bbf73", "#d8a13f", "#8a7fd6"];

const VB_W = 920;
const VB_H = 430;
const CEO_POS = { x: 460, y: 178 };
const DESK_ROW_Y = 306;
const DESK_STEP = 196;
const DESK_GAP = 96;

export function OfficeScene({ ceoName, ceoProfession, members, onOpenThread }: OfficeSceneProps) {
  const layout = useMemo(() => members.map((member, index) => {
    const row = Math.floor(index / 4);
    const inRow = index % 4;
    const count = Math.min(4, members.length - row * 4);
    const startX = VB_W / 2 - ((count - 1) * DESK_STEP) / 2;
    return { member, index, x: startX + inRow * DESK_STEP, y: DESK_ROW_Y + row * DESK_GAP };
  }), [members]);

  const rows = Math.max(1, Math.ceil(members.length / 4));
  const floorTop = 238;

  return (
    <div className="office-scene" style={{ "--office-rows": rows } as React.CSSProperties}>
      <svg className="office-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="虚拟办公室">
        <defs>
          <linearGradient id="ofc-window" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfe0ff" />
            <stop offset="100%" stopColor="#e8f5ff" />
          </linearGradient>
          <linearGradient id="ofc-screen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.screenOn} />
            <stop offset="100%" stopColor="#8fd0ac" />
          </linearGradient>
        </defs>

        {/* ── 房间：墙 / 踢脚线 / 木地板 ── */}
        <rect x="0" y="0" width={VB_W} height={floorTop} fill={C.wall} />
        <rect x="0" y="0" width={VB_W} height={floorTop} fill={C.wallShade} opacity="0.4" />
        <rect x="0" y={floorTop - 8} width={VB_W} height="8" fill={C.skirt} />
        <rect x="0" y={floorTop} width={VB_W} height={VB_H - floorTop} fill={C.floorA} />
        {Array.from({ length: 8 }).map((_, i) => (
          <rect key={i} x={((i * 148) % VB_W) - 50} y={floorTop + 12 + i * 24} width="190" height="2" rx="1" fill={C.floorB} opacity="0.85" />
        ))}

        {/* ── 墙面装饰 ── */}
        <Window x={60} y={34} />
        <Whiteboard x={VB_W / 2 - 100} y={26} />
        <Clock x={VB_W - 92} y={48} />

        {/* ── CEO 工位 ── */}
        <Desk
          x={CEO_POS.x}
          y={CEO_POS.y}
          ceo
          state="ceo"
          color="#e0983f"
          name={ceoName}
          profession={ceoProfession}
          label={`${ceoName} · CEO`}
        />

        {/* ── 员工工位 ── */}
        {layout.map(({ member, index, x, y }) => (
          <Desk
            key={member.id}
            x={x}
            y={y}
            state={member.running ? "running" : member.hasThread ? "idle" : "never"}
            color={WORKER_COLORS[index % WORKER_COLORS.length]}
            name={member.name || "员工"}
            profession={member.profession || "通用"}
            onClick={member.hasThread ? () => onOpenThread?.(member.id) : undefined}
          />
        ))}

        {members.length === 0 && (
          <text x={VB_W / 2} y={VB_H - 40} textAnchor="middle" className="office-empty-text">还没有员工 —— 到「专家 / 专家团」给 CEO 配几名成员</text>
        )}
      </svg>
    </div>
  );
}

/* ── 窗户 ── */
function Window({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0" y="0" width="168" height="112" rx="10" fill={C.paper} stroke={C.ink} strokeWidth="3" />
      <rect x="9" y="9" width="150" height="94" rx="6" fill="url(#ofc-window)" />
      <g className="ofc-cloud">
        <ellipse cx="52" cy="40" rx="20" ry="10" fill="#fff" opacity="0.95" />
        <ellipse cx="68" cy="36" rx="14" ry="8" fill="#fff" opacity="0.95" />
      </g>
      <g className="ofc-cloud ofc-cloud-slow">
        <ellipse cx="112" cy="70" rx="16" ry="8" fill="#fff" opacity="0.85" />
      </g>
      <line x1="84" y1="9" x2="84" y2="103" stroke={C.paper} strokeWidth="6" />
      <line x1="9" y1="56" x2="159" y2="56" stroke={C.paper} strokeWidth="6" />
    </g>
  );
}

/* ── 白板 ── */
function Whiteboard({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0" y="0" width="200" height="118" rx="8" fill={C.paper} stroke={C.ink} strokeWidth="3" />
      <line x1="18" y1="28" x2="146" y2="28" stroke="#8fb7d6" strokeWidth="4" strokeLinecap="round" />
      <line x1="18" y1="44" x2="112" y2="44" stroke="#a9c9e2" strokeWidth="4" strokeLinecap="round" />
      <line x1="18" y1="60" x2="130" y2="60" stroke="#bcd6ea" strokeWidth="4" strokeLinecap="round" />
      <rect x="18" y="78" width="48" height="26" rx="4" fill={C.noteA} stroke={C.ink} strokeWidth="2" transform="rotate(-4 42 91)" />
      <rect x="76" y="82" width="48" height="26" rx="4" fill={C.noteB} stroke={C.ink} strokeWidth="2" transform="rotate(3 100 95)" />
      <rect x="138" y="76" width="46" height="30" rx="4" fill={C.noteC} stroke={C.ink} strokeWidth="2" transform="rotate(-2 161 91)" />
    </g>
  );
}

/* ── 挂钟 ── */
function Clock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="0" cy="0" r="30" fill={C.paper} stroke={C.ink} strokeWidth="3" />
      <circle cx="0" cy="0" r="24" fill="#f7fafd" />
      <line x1="0" y1="0" x2="0" y2="-14" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
      <line className="ofc-clock-hand" x1="0" y1="0" x2="9" y2="3" stroke="#e8875f" strokeWidth="3" strokeLinecap="round" />
      <circle cx="0" cy="0" r="2.6" fill={C.ink} />
    </g>
  );
}

/* ── 一个完整工位：名牌 + 角色 + 桌面 + 桌腿 + 桌面小物 + 显示器 + 状态气泡 ── */
function Desk({ x, y, state, color, name, profession, label, ceo = false, onClick }: {
  x: number; y: number; state: "ceo" | "running" | "idle" | "never"; color: string; name: string; profession: string; label?: string; ceo?: boolean; onClick?: () => void;
}) {
  const w = ceo ? 212 : 168;
  const scale = ceo ? 1.1 : 1;
  const dim = state === "never";
  const working = state === "running" || state === "ceo";
  return (
    <g transform={`translate(${x} ${y})`} className={`ofc-desk${dim ? " is-empty" : ""}${onClick ? " is-clickable" : ""}`} onClick={onClick}>
      {/* CEO 名牌（工位上方浮标） */}
      {label && (
        <g transform="translate(0 -218)">
          <rect x="-78" y="-16" width="156" height="32" rx="16" fill="#ffffff" stroke={C.ink} strokeWidth="2.4" />
          <text x="0" y="6" textAnchor="middle" className="ofc-ceo-plate">{label}</text>
        </g>
      )}

      {/* 角色（先画：桌面稍后覆盖其下半身 ⇒ 坐在桌后） */}
      <g transform={`translate(-22 ${-70 * scale}) scale(${scale})`} className={`ofc-worker state-${state}`}>
        <ellipse cx="0" cy="78" rx="36" ry="8" fill="#63707f" opacity={dim ? 0.08 : 0.16} />
        {/* 椅子 */}
        <rect x="-25" y="36" width="50" height="34" rx="11" fill="#9fb0c2" stroke={C.ink} strokeWidth="2.4" />
        <rect x="-27" y="64" width="54" height="12" rx="6" fill="#8ea0b4" stroke={C.ink} strokeWidth="2.4" />
        <rect x="-4" y="76" width="8" height="16" rx="3" fill={C.metal} stroke={C.ink} strokeWidth="2.2" />
        {/* 腿 */}
        <rect x="-8" y="58" width="32" height="13" rx="6.5" fill="#4d5d72" stroke={C.ink} strokeWidth="2.4" />
        <rect x="15" y="65" width="13" height="26" rx="6.5" fill="#4d5d72" stroke={C.ink} strokeWidth="2.4" />
        <ellipse cx="26" cy="91" rx="13" ry="6.5" fill={C.shoe} stroke={C.ink} strokeWidth="2.4" />
        {/* 躯干 */}
        <rect x="-20" y="12" width="40" height="48" rx="15" fill={color} stroke={C.ink} strokeWidth="2.6" />
        {ceo && <path d="M -5 20 l 5 6 l -5 15 l -5 -15 z" fill="#ffffff" stroke={C.ink} strokeWidth="2" />}
        {/* 手臂 */}
        <rect className={`ofc-arm ofc-arm-back ${working ? "is-typing" : ""}`} x="-26" y="16" width="11" height="31" rx="5.5" fill={color} stroke={C.ink} strokeWidth="2.4" />
        <rect className={`ofc-arm ofc-arm-front ${working ? "is-typing-alt" : ""}`} x="15" y="16" width="11" height="31" rx="5.5" fill={color} stroke={C.ink} strokeWidth="2.4" />
        {/* 头 */}
        <circle cx="0" cy="-7" r="17.5" fill={C.skin} stroke={C.ink} strokeWidth="2.6" />
        <path d="M -17.5 -11 Q 0 -31 17.5 -11 Q 8 -18 0 -17 Q -8 -18 -17.5 -11 Z" fill={C.hair} stroke={C.ink} strokeWidth="2.2" strokeLinejoin="round" />
        {state === "idle" ? (
          <>
            <path d="M -10 -5 q 3.4 3 6.8 0" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
            <path d="M 3.2 -5 q 3.4 3 6.8 0" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
          </>
        ) : dim ? null : (
          <>
            <circle cx="-6.6" cy="-7" r="2" fill={C.ink} />
            <circle cx="6.6" cy="-7" r="2" fill={C.ink} />
            <path d="M -3 1 q 3 2.4 6 0" fill="none" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
        {/* 状态附加物 */}
        {state === "idle" && <text className="ofc-zzz" x="18" y="-28" fontSize="16" fontWeight="700" fill="#8fa0b4" stroke="none">Z</text>}
        {state === "idle" && <text className="ofc-zzz ofc-zzz-2" x="30" y="-42" fontSize="12" fontWeight="700" fill="#8fa0b4" stroke="none">z</text>}
        {state === "idle" && (
          <g className="ofc-coffee" transform="translate(24 28)">
            <rect x="-6.5" y="-8" width="13" height="13" rx="3" fill="#ffffff" stroke={C.ink} strokeWidth="2" />
            <path d="M 6.5 -5 q 5.5 3.5 0 8" fill="none" stroke={C.ink} strokeWidth="2" />
          </g>
        )}
      </g>

      {/* 桌面 + 桌腿 */}
      <rect x={-w / 2} y="-10" width={w} height="14" rx="5" fill={C.deskTop} stroke={C.ink} strokeWidth="2.6" />
      <rect x={-w / 2 + 14} y="4" width="10" height="32" rx="3" fill={C.woodDark} stroke={C.ink} strokeWidth="2.2" />
      <rect x={w / 2 - 24} y="4" width="10" height="32" rx="3" fill={C.woodDark} stroke={C.ink} strokeWidth="2.2" />

      {/* 桌面小物：键盘 + 杯子 */}
      <rect x="-68" y="-17" width="42" height="9" rx="3" fill="#e8eef5" stroke={C.ink} strokeWidth="2" />
      {!dim && <path d={`M ${w / 2 - 44} -32 h 15 v 13 a 4 4 0 0 1 -4 4 h -7 a 4 4 0 0 1 -4 -4 z`} fill="#ffffff" stroke={C.ink} strokeWidth="2" />}

      {/* 显示器（人右前方） */}
      <g transform={`translate(${w / 2 - 74} -64)`}>
        <rect x="4" y="36" width="30" height="8" rx="3" fill={C.metal} stroke={C.ink} strokeWidth="2" />
        <rect x="-14" y="-32" width="56" height="42" rx="5" fill="#ffffff" stroke={C.ink} strokeWidth="2.6" />
        <rect x="-9" y="-27" width="46" height="32" rx="3" fill={dim ? "#e7edf4" : working ? "url(#ofc-screen)" : C.screen} />
        {!dim && (
          <g className={`ofc-code${working ? " is-live" : ""}`} stroke={working ? "#2f7a53" : "#93a5b8"} strokeWidth="2" strokeLinecap="round">
            <line x1="-4" y1="-20" x2="18" y2="-20" />
            <line x1="-4" y1="-13" x2="28" y2="-13" />
            <line x1="-4" y1="-6" x2="12" y2="-6" />
          </g>
        )}
      </g>

      {/* 运行中气泡 */}
      {working && (
        <g className="ofc-bubble" transform="translate(30 -140)">
          <rect x="-24" y="-17" width="50" height="26" rx="13" fill="#ffffff" stroke={C.ink} strokeWidth="2.2" />
          <path d="M -10 9 l -4 9 l 11 -8 z" fill="#ffffff" stroke={C.ink} strokeWidth="2.2" strokeLinejoin="round" />
          <circle className="ofc-dot" cx="-11" cy="-4" r="3.2" fill="#4aa96c" />
          <circle className="ofc-dot ofc-dot-2" cx="0" cy="-4" r="3.2" fill="#4aa96c" />
          <circle className="ofc-dot ofc-dot-3" cx="11" cy="-4" r="3.2" fill="#4aa96c" />
        </g>
      )}

      {/* 空工位标 */}
      {dim && (
        <g transform="translate(-22 -132)">
          <rect x="-42" y="-15" width="84" height="28" rx="14" fill="#ffffff" stroke="#b9c6d6" strokeWidth="2" strokeDasharray="5 4" />
          <text x="0" y="6" textAnchor="middle" className="ofc-vacant-text">空工位</text>
        </g>
      )}

      {/* 名牌 */}
      <text x="0" y="62" textAnchor="middle" className="ofc-plate-name">{name}</text>
      <text x="0" y="80" textAnchor="middle" className="ofc-plate-role">{profession}</text>
    </g>
  );
}
