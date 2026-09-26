/**
 * 公司模式 · 虚拟办公室插画（09-26 v4「活起来」）。
 *
 * ⛔ 历次教训：
 *   v2 div 拼装 + 纯色块 = 「色块药丸」，被评「不好看」；
 *   v3 单张 SVG 插画（统一描边）站住了，但只有「打字 / 打盹」两个动作，人被评「死的」。
 *   v4 在 v3 的形状基础上加**时间维度**：由 office-director 每拍给每人一个姿势，
 *      再叠加「员工之间交接」的飞行卡片 —— 办公室这才算活。
 *
 * 三态语义（真实数据驱动，未变）：
 *   running=敲键盘+屏幕滚动+气泡 / idle=随机小动作（喝咖啡、伸懒腰、看手机、打盹、翻资料）
 *   / never=空工位（虚化 + 熄屏 + 虚线标）
 * 另有两种「离开工位」（串门 visit / 跑腿 errand）——此时工位只剩椅子，人作为站姿小人在场景层走动。
 *
 * 数据面零新增：姿势由真实 running/hasThread 派生，交接由状态迁移触发（见 office-director.ts）。
 */
import { useEffect, useMemo, useState } from "react";
import { OFC, workerLook } from "./office-palette";
import { handoffArc, type DirectorSnapshot, type OfficeHandoff, type OfficePose } from "./office-director";
import { SeatedWorker, WalkingWorker } from "./OfficeWorker";
import { Bookshelf, Clock, FloorBoards, PendantLight, Plant, Printer, Rug, WaterCooler, Whiteboard, Window } from "./OfficeFurniture";

export type OfficeMember = { id: string; name: string; profession: string; running: boolean; hasThread: boolean };
export type OfficeSceneProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  /** 姿势快照 —— ⛔ 由调用方（弹窗）持有的**唯一**导演产出，场景只负责画（右栏看板同源）。 */
  snapshot: DirectorSnapshot;
  onOpenThread?: (memberId: string) => void;
};

const VB_W = 960;
const FLOOR_TOP = 300;
const CEO_POS = { x: 480, y: 236 };
const DESK_ROW_Y = 380;
const DESK_STEP = 196;
const DESK_GAP = 118;
/** 跑腿目标点（地面坐标，脚底位置）。 */
const ERRAND_POINTS: Record<string, { x: number; y: number; facing: 1 | -1 }> = {
  water: { x: 60, y: 334, facing: 1 },
  shelf: { x: 838, y: 330, facing: -1 },
  printer: { x: 828, y: 344, facing: -1 },
};

const HANDOFF_TINT: Record<OfficeHandoff["kind"], string> = {
  task: "#dbeafe",
  report: "#d9f3e3",
  doc: "#fff0d0",
  chat: "#eee0fb",
};

export function OfficeScene({ ceoName, ceoProfession, members, snapshot, onOpenThread }: OfficeSceneProps) {
  const layout = useMemo(() => members.map((member, index) => {
    const row = Math.floor(index / 4);
    const inRow = index % 4;
    const count = Math.min(4, members.length - row * 4);
    const startX = VB_W / 2 - ((count - 1) * DESK_STEP) / 2;
    return { member, index, x: startX + inRow * DESK_STEP, y: DESK_ROW_Y + row * DESK_GAP, row };
  }), [members]);

  const rows = Math.max(1, Math.ceil(members.length / 4));
  const vbH = rows === 1 ? 478 : 478 + (rows - 1) * DESK_GAP;

  /** 工位 i 的「头顶」绝对坐标（交接卡片起落点）。 */
  const headOf = (index: number): { x: number; y: number } => {
    if (index < 0) return { x: CEO_POS.x, y: CEO_POS.y - 168 };
    const slot = layout[index];
    return slot ? { x: slot.x, y: slot.y - 150 } : { x: CEO_POS.x, y: CEO_POS.y - 168 };
  };

  return (
    <div className="office-scene" style={{ "--office-rows": rows } as React.CSSProperties}>
      <svg className="office-svg" viewBox={`0 0 ${VB_W} ${vbH}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="虚拟办公室">
        <defs>
          <linearGradient id="ofc-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfe0ff" />
            <stop offset="100%" stopColor="#eaf6ff" />
          </linearGradient>
          <linearGradient id="ofc-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e3f2ff" />
            <stop offset="100%" stopColor={OFC.waterDeep} />
          </linearGradient>
          <linearGradient id="ofc-screen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={OFC.screenOn} />
            <stop offset="100%" stopColor={OFC.screenOnDeep} />
          </linearGradient>
        </defs>

        {/* ── 房间 ── */}
        <rect x="0" y="0" width={VB_W} height={FLOOR_TOP} fill={OFC.wall} />
        <rect x="0" y="0" width={VB_W} height={FLOOR_TOP} fill={OFC.wallTop} opacity="0.35" />
        {Array.from({ length: 40 }).map((_, i) => (
          <rect key={i} x={i * 24} y="0" width="10" height={FLOOR_TOP - 10} fill={OFC.wallStripe} opacity="0.55" />
        ))}
        <rect x="0" y={FLOOR_TOP - 9} width={VB_W} height="9" fill={OFC.skirt} />
        <rect x="0" y={FLOOR_TOP - 9} width={VB_W} height="2.4" fill={OFC.ink} opacity="0.18" />
        <rect x="0" y={FLOOR_TOP} width={VB_W} height={vbH - FLOOR_TOP} fill={OFC.floorA} />
        <FloorBoards top={FLOOR_TOP} height={vbH - FLOOR_TOP} width={VB_W} />
        {/* ⛔ 地毯高度跟着行数走：只写固定值会让第二行工位掉在地毯外 */}
        <Rug x={96} y={FLOOR_TOP + 8} w={768} h={Math.max(120, vbH - FLOOR_TOP - 24)} />

        {/* ── 墙面装饰 ── */}
        <Clock x={58} y={76} />
        <Whiteboard x={118} y={28} />
        <Window x={646} y={30} />
        <PendantLight x={364} drop={52} />
        <PendantLight x={612} drop={46} />

        {/* ── 靠墙家具（地上）── */}
        <WaterCooler x={18} y={208} />
        <Bookshelf x={872} y={168} />
        <Printer x={790} y={250} />
        <Plant x={368} y={FLOOR_TOP - 4} scale={1} />
        <Plant x={740} y={FLOOR_TOP - 2} scale={0.86} />

        {/* ── CEO 工位 ── */}
        <Desk
          x={CEO_POS.x}
          y={CEO_POS.y}
          state="ceo"
          pose={snapshot.ceo}
          look={workerLook(members.length + 3, 1)}
          ceo
          name={ceoName}
          profession={ceoProfession}
          label={`${ceoName} · CEO`}
        />

        {/* ── 员工工位 ── */}
        {layout.map(({ member, index, x, y }) => {
          const pose = snapshot.poses[index];
          const away = pose?.kind === "visit" || pose?.kind === "errand";
          const state: "running" | "idle" | "never" = member.running ? "running" : member.hasThread ? "idle" : "never";
          return (
            <Desk
              key={member.id}
              x={x}
              y={y}
              state={state}
              pose={away ? null : pose}
              look={workerLook(index)}
              name={member.name || "员工"}
              profession={member.profession || "通用"}
              onClick={member.hasThread ? () => onOpenThread?.(member.id) : undefined}
            />
          );
        })}

        {/* ── 走动中的员工（串门 / 跑腿）── */}
        {layout.map(({ member, index, x, y }) => {
          const pose = snapshot.poses[index];
          if (!pose) return null;
          if (pose.kind === "visit") {
            const host = layout[pose.visitIndex ?? -1];
            const target = host ? { x: host.x - 100, y: host.y + 22, facing: 1 as const } : { x: x - 22, y: y, facing: 1 as const };
            return <Walker key={member.id} from={{ x: x - 22, y: y + 17 }} to={target} look={workerLook(index)} carrying label="递资料" />;
          }
          if (pose.kind === "errand" && pose.spot) {
            const target = ERRAND_POINTS[pose.spot];
            if (!target) return null;
            return <Walker key={member.id} from={{ x: x - 22, y: y + 17 }} to={target} look={workerLook(index)} />;
          }
          return null;
        })}

        {/* ── 交接飞行层（最上层，压在所有人之上）── */}
        <g className="ofc-handoffs">
          {snapshot.handoffs.map((handoff) => (
            <HandoffCard key={handoff.id} handoff={handoff} from={headOf(handoff.from)} to={headOf(handoff.to)} />
          ))}
        </g>

        {members.length === 0 && (
          <text x={VB_W / 2} y={vbH - 42} textAnchor="middle" className="office-empty-text">还没有员工 —— 到「专家 / 专家团」给 CEO 配几名成员</text>
        )}
      </svg>
    </div>
  );
}

/** 一个走动中的小人：起点 → 目标点（CSS transition 走过去，走就位后原地待命）。 */
function Walker({ from, to, look, carrying, label }: {
  from: { x: number; y: number };
  to: { x: number; y: number; facing: 1 | -1 };
  look: ReturnType<typeof workerLook>;
  carrying?: boolean;
  label?: string;
}) {
  const [at, setAt] = useState(from);
  useEffect(() => {
    // ⛔ 挂载即到位 = 没有走路过程（人凭空出现在终点）。必须让「起点」先过一次 paint，
    //    所以用定时器延迟改坐标（不用双 rAF：React 的自动批处理会把两次渲染并掉，
    //    实测在无 GPU 的环境里更不稳）。
    const id = window.setTimeout(() => setAt({ x: to.x, y: to.y }), 220);
    return () => window.clearTimeout(id);
  }, [to.x, to.y]);
  return (
    // ⛔ 位移走 CSS transform + transition（写 SVG transform 属性是瞬时的，人会「闪现」过去）
    <g className="ofc-walker-slot" style={{ "--wk-x": `${at.x}px`, "--wk-y": `${at.y}px` } as React.CSSProperties}>
      <WalkingWorker look={look} carrying={carrying} facing={to.facing} label={label} />
    </g>
  );
}

/** 交接卡片：沿弧线飞到对方头顶，落点脉冲 + 接收者惊叹号。 */
function HandoffCard({ handoff, from, to }: { handoff: OfficeHandoff; from: { x: number; y: number }; to: { x: number; y: number } }) {
  const path = handoffArc(from, to);
  const tint = HANDOFF_TINT[handoff.kind];
  return (
    <g className={`ofc-handoff ofc-handoff--${handoff.kind}`}>
      {/* 起点：起飞尘点 */}
      <circle className="ofc-handoff-burst" cx={from.x} cy={from.y} r="6" fill={tint} stroke={OFC.ink} strokeWidth="2" />
      {/* 落点脉冲（延迟到飞行结束时刻）*/}
      <g transform={`translate(${to.x} ${to.y})`}>
        <circle className="ofc-handoff-pulse" cx="0" cy="0" r="10" fill="none" stroke={OFC.ok} strokeWidth="2.6" />
        <g className="ofc-handoff-alert" transform="translate(20 -18)">
          <circle cx="0" cy="0" r="9.5" fill={OFC.paper} stroke={OFC.ink} strokeWidth="2" />
          <text x="0" y="4" textAnchor="middle" className="ofc-handoff-alert-text">!</text>
        </g>
      </g>
      {/* 卡片本体 */}
      <g className="ofc-handoff-card">
        <g transform="translate(-15 -11)">
          <rect x="0" y="0" width="30" height="22" rx="3.4" fill={tint} stroke={OFC.ink} strokeWidth="2.2" />
          {handoff.kind === "task" && <path d="M 22 0 l 8 8 l -8 0 z" fill="#9fc6e4" stroke={OFC.ink} strokeWidth="1.8" strokeLinejoin="round" />}
          <line x1="5" y1="8" x2={handoff.kind === "task" ? 21 : 25} y2="8" stroke={OFC.ink} strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
          <line x1="5" y1="13" x2={handoff.kind === "chat" ? 16 : 20} y2="13" stroke={OFC.ink} strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
          {handoff.kind === "report" && <path d="M 5 17 l 4 3 l 5 -6" fill="none" stroke={OFC.ok} strokeWidth="2" strokeLinecap="round" />}
        </g>
        <animateMotion dur="1.5s" path={path} fill="freeze" calcMode="linear" />
      </g>
      <text className="ofc-handoff-label" x={to.x} y={to.y - 34} textAnchor="middle">{handoff.label}</text>
    </g>
  );
}

/* ── 一个完整工位：椅子 + 人 + 桌面 + 桌腿 + 桌上小物 + 显示器 + 名牌 ──
   `pose === null` 表示人暂时离开（串门/跑腿）——此时只留椅子，人由场景层的 Walker 画。 */
function Desk({ x, y, state, pose, look, name, profession, label, ceo = false, onClick }: {
  x: number; y: number;
  state: "ceo" | "running" | "idle" | "never";
  pose: OfficePose | null;
  look: ReturnType<typeof workerLook>;
  name: string;
  profession: string;
  label?: string;
  ceo?: boolean;
  onClick?: () => void;
}) {
  const w = ceo ? 212 : 168;
  const scale = ceo ? 1.1 : 1;
  const dim = state === "never";
  const working = state === "running" || state === "ceo";
  return (
    <g
      transform={`translate(${x} ${y})`}
      className={`ofc-desk ofc-worker state-${state}${dim ? " is-empty" : ""}${onClick ? " is-clickable" : ""}`}
      onClick={onClick}
    >
      {label && (
        <g transform="translate(0 -196)">
          <rect x="-78" y="-16" width="156" height="32" rx="16" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.4" />
          <rect x="-72" y="-11" width="10" height="22" rx="5" fill={OFC.warn} opacity="0.85" />
          <text x="6" y="6" textAnchor="middle" className="ofc-ceo-plate">{label}</text>
        </g>
      )}

      {/* 椅子（先画；人离开时它就是「空椅子」） */}
      <g transform={`translate(-22 ${-70 * scale}) scale(${scale})`} className="ofc-seat">
        <rect x="-25" y="36" width="50" height="34" rx="11" fill="#9fb0c2" stroke={OFC.ink} strokeWidth="2.4" />
        <rect x="-27" y="64" width="54" height="12" rx="6" fill="#8ea0b4" stroke={OFC.ink} strokeWidth="2.4" />
        <rect x="-4" y="76" width="8" height="16" rx="3" fill={OFC.metal} stroke={OFC.ink} strokeWidth="2.2" />
      </g>

      {/* 角色 */}
      {pose && (
        <g transform={`translate(-22 ${-70 * scale}) scale(${scale})`}>
          <SeatedWorker pose={pose} look={look} />
        </g>
      )}

      {/* 桌面 + 桌腿 */}
      <rect x={-w / 2} y="-10" width={w} height="14" rx="5" fill={OFC.woodLight} stroke={OFC.ink} strokeWidth="2.6" />
      <rect x={-w / 2 + 14} y="4" width="10" height="32" rx="3" fill={OFC.woodDark} stroke={OFC.ink} strokeWidth="2.2" />
      <rect x={w / 2 - 24} y="4" width="10" height="32" rx="3" fill={OFC.woodDark} stroke={OFC.ink} strokeWidth="2.2" />

      {/* 桌面小物：键盘 + 杯 + 便签 */}
      <rect x="-68" y="-17" width="42" height="9" rx="3" fill="#e8eef5" stroke={OFC.ink} strokeWidth="2" />
      <g className="ofc-desk-key" strokeWidth="1.4" stroke="#b9c6d6">
        <line x1="-62" y1="-13" x2="-62" y2="-12" />
        <line x1="-54" y1="-13" x2="-54" y2="-12" />
        <line x1="-46" y1="-13" x2="-46" y2="-12" />
      </g>
      {!dim && <rect className="ofc-sticky" x="-24" y="-19" width="18" height="12" rx="2" fill={OFC.noteA} stroke={OFC.ink} strokeWidth="1.6" transform="rotate(-7 -15 -13)" />}
      {!dim && <path d={`M ${w / 2 - 44} -32 h 15 v 13 a 4 4 0 0 1 -4 4 h -7 a 4 4 0 0 1 -4 -4 z`} fill="#ffffff" stroke={OFC.ink} strokeWidth="2" />}

      {/* 显示器（人右前方） */}
      <g transform={`translate(${w / 2 - 74} -64)`}>
        <rect x="4" y="36" width="30" height="8" rx="3" fill={OFC.metal} stroke={OFC.ink} strokeWidth="2" />
        <rect x="-14" y="-32" width="56" height="42" rx="5" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.6" />
        <rect x="-9" y="-27" width="46" height="32" rx="3" fill={dim ? "#e7edf4" : working ? "url(#ofc-screen)" : OFC.screen} />
        {!dim && (
          <g className={`ofc-code${working ? " is-live" : ""}`} stroke={working ? OFC.codeInk : OFC.codeIdle} strokeWidth="2" strokeLinecap="round">
            <line className="ofc-code-line c1" x1="-4" y1="-20" x2="18" y2="-20" />
            <line className="ofc-code-line c2" x1="-4" y1="-13" x2="28" y2="-13" />
            <line className="ofc-code-line c3" x1="-4" y1="-6" x2="12" y2="-6" />
          </g>
        )}
        {!dim && <circle className={`ofc-desk-led${working ? " is-live" : ""}`} cx="38" cy="-26" r="2.4" fill={working ? OFC.ok : OFC.metalDark} />}
      </g>

      {/* 运行中气泡 */}
      {pose?.kind === "work" && working && (
        <g className="ofc-bubble" transform="translate(30 -140)">
          <rect x="-24" y="-17" width="50" height="26" rx="13" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.2" />
          <path d="M -10 9 l -4 9 l 11 -8 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
          <circle className="ofc-dot" cx="-11" cy="-4" r="3.2" fill={OFC.ok} />
          <circle className="ofc-dot ofc-dot-2" cx="0" cy="-4" r="3.2" fill={OFC.ok} />
          <circle className="ofc-dot ofc-dot-3" cx="11" cy="-4" r="3.2" fill={OFC.ok} />
        </g>
      )}

      {/* 空工位标（真的没会话时才显示） */}
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
