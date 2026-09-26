/**
 * 公司模式 · 虚拟办公室插画（09-26 v5「造型升级」）。
 *
 * ⛔ 历次教训（每次都是用户说「丑」之后复盘出来的）：
 *   v2 div 拼装 + 纯色块 = 「色块药丸」；
 *   v3 单张 SVG 插画（统一描边）站住了，但只有两个动作，人「死的」；
 *   v4 加了动画导演（活的），但造型被评「人物丑 + 场景也丑」；
 *   v5 去 GitHub 调研现成库（DiceBear / open-peeps / avataaars / notionists）后确认：
 *      ① 现成库全是半身或头像、SVG 扁平化无部件分组 ⇒ **不能直接用在工位上做部件动画**（人物只能自绘）；
 *      ② 但它们的造型规律可以照抄：**粗描边 + 大头 + 极简五官 + 饱和纯色**；
 *      ③ v4 场景的病根是「配色褪色 / 40 条墙纸噪音 / 没有层次」⇒ 本版逐条治
 *         （腰线分色、删墙纸、家具退后排 + 落地投影、描边统一 INK_W）。
 *
 * 三态语义（真实数据驱动，未变）：
 *   running=敲键盘+屏幕滚动+气泡 / idle=随机小动作 / never=空工位（虚化 + 熄屏 + 虚线标）
 * 另有「离开工位」两态（串门 visit / 跑腿 errand）——此时工位只剩椅子，人作为站姿小人在场景层走动。
 */
import { useEffect, useMemo, useState } from "react";
import { OFC, INK_W, workerLook } from "./office-palette";
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
/** 墙面腰线：上浅下深两段（v4 是一整片糊白，没有层次）。 */
const WALL_BELT = 226;
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
            <stop offset="0%" stopColor="#a9d8ff" />
            <stop offset="100%" stopColor="#e8f6ff" />
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

        {/* ── 房间：墙分上下两段（腰线做层次）+ 踢脚线 + 木地板 ──
            ⛔ v4 在这里铺了 40 条墙纸竖纹，属于纯噪音（一屏密密麻麻的竖线把家具全压住了），已删。 */}
        <rect x="0" y="0" width={VB_W} height={WALL_BELT} fill={OFC.wall} />
        <rect x="0" y={WALL_BELT} width={VB_W} height={FLOOR_TOP - WALL_BELT} fill={OFC.wallLower} />
        <rect x="0" y={WALL_BELT - 5} width={VB_W} height="5" fill={OFC.skirt} opacity="0.9" />
        <rect x="0" y={FLOOR_TOP - 13} width={VB_W} height="13" fill={OFC.skirt} />
        <rect x="0" y={FLOOR_TOP - 13} width={VB_W} height="13" fill="none" stroke={OFC.ink} strokeWidth="2.6" />
        <rect x="0" y={FLOOR_TOP} width={VB_W} height={vbH - FLOOR_TOP} fill={OFC.floorA} />
        <rect x="0" y={FLOOR_TOP} width={VB_W} height="4" fill={OFC.ink} opacity="0.1" />
        <FloorBoards top={FLOOR_TOP} height={vbH - FLOOR_TOP} width={VB_W} />
        {/* ⛔ 地毯高度跟着行数走：只写固定值会让第二行工位掉在地毯外 */}
        <Rug x={96} y={FLOOR_TOP + 8} w={768} h={Math.max(120, vbH - FLOOR_TOP - 24)} />

        {/* ── 靠墙家具先画（= 后排）：家具统一退到 y 200~310 这一带，
            工位在前排（y 370+），靠 y 序形成纵深，不需要额外的遮挡处理。 ── */}
        <WaterCooler x={16} y={214} />
        <Bookshelf x={872} y={200} />
        <Printer x={776} y={246} />
        <Plant x={112} y={FLOOR_TOP - 6} scale={1} />

        {/* ── 墙面装饰（挂在家具之上、白板窗之类的背景层）── */}
        <Clock x={92} y={80} />
        <Whiteboard x={170} y={34} />
        <Window x={624} y={34} />
        <PendantLight x={448} drop={50} />
        <PendantLight x={592} drop={44} />

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
    //    所以用定时器延迟改坐标（不用双 rAF：React 的自动批处理会把两次渲染并掉）。
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
      <circle className="ofc-handoff-burst" cx={from.x} cy={from.y} r="6" fill={tint} stroke={OFC.ink} strokeWidth="2.4" />
      <g transform={`translate(${to.x} ${to.y})`}>
        <circle className="ofc-handoff-pulse" cx="0" cy="0" r="10" fill="none" stroke={OFC.ok} strokeWidth="2.8" />
        <g className="ofc-handoff-alert" transform="translate(21 -19)">
          <circle cx="0" cy="0" r="10" fill={OFC.paper} stroke={OFC.ink} strokeWidth="2.4" />
          <text x="0" y="4" textAnchor="middle" className="ofc-handoff-alert-text">!</text>
        </g>
      </g>
      <g className="ofc-handoff-card">
        <g transform="translate(-15 -11)">
          <rect x="0" y="0" width="30" height="22" rx="3.4" fill={tint} stroke={OFC.ink} strokeWidth="2.4" />
          {handoff.kind === "task" && <path d="M 22 0 l 8 8 l -8 0 z" fill="#9fc6e4" stroke={OFC.ink} strokeWidth="2" strokeLinejoin="round" />}
          <line x1="5" y1="8" x2={handoff.kind === "task" ? 21 : 25} y2="8" stroke={OFC.ink} strokeWidth="2" strokeLinecap="round" opacity="0.65" />
          <line x1="5" y1="13" x2={handoff.kind === "chat" ? 16 : 20} y2="13" stroke={OFC.ink} strokeWidth="2" strokeLinecap="round" opacity="0.65" />
          {handoff.kind === "report" && <path d="M 5 17 l 4 3 l 5 -6" fill="none" stroke={OFC.ok} strokeWidth="2.2" strokeLinecap="round" />}
        </g>
        <animateMotion dur="1.5s" path={path} fill="freeze" calcMode="linear" />
      </g>
      <text className="ofc-handoff-label" x={to.x} y={to.y - 34} textAnchor="middle">{handoff.label}</text>
    </g>
  );
}

/* ── 一个完整工位：椅子 + 人 + 桌面 + 桌腿 + 桌上小物 + 显示器 + 名牌 ──
   `pose === null` 表示人暂时离开（串门/跑腿）——此时只留椅子，人由场景层的 Walker 画。 */
function Desk({ x, y, state, pose, look, name, profession, ceo = false, onClick }: {
  x: number; y: number;
  state: "ceo" | "running" | "idle" | "never";
  pose: OfficePose | null;
  look: ReturnType<typeof workerLook>;
  name: string;
  profession: string;
  ceo?: boolean;
  onClick?: () => void;
}) {
  const w = ceo ? 214 : 168;
  const scale = ceo ? 1.1 : 1;
  const dim = state === "never";
  const working = state === "running" || state === "ceo";
  return (
    <g
      transform={`translate(${x} ${y})`}
      className={`ofc-desk ofc-worker state-${state}${dim ? " is-empty" : ""}${onClick ? " is-clickable" : ""}`}
      onClick={onClick}
    >
      {/* 桌下投影（让人和桌子"落"在地毯上） */}
      <ellipse cx="0" cy={ceo ? 62 : 58} rx={w * 0.62} ry="11" fill={OFC.shadow} opacity={dim ? 0.06 : 0.13} />

      {/* 椅子（先画；人离开时它就是「空椅子」） */}
      <g transform={`translate(-22 ${-70 * scale}) scale(${scale})`} className="ofc-seat">
        <rect x="-26" y="34" width="52" height="36" rx="12" fill="#9fb0c2" stroke={OFC.ink} strokeWidth={INK_W} />
        <rect x="-28" y="63" width="56" height="13" rx="6.5" fill="#8ea0b4" stroke={OFC.ink} strokeWidth={INK_W} />
        <rect x="-4" y="76" width="8" height="16" rx="3" fill={OFC.metal} stroke={OFC.ink} strokeWidth="2.6" />
      </g>

      {/* 角色 */}
      {pose && (
        <g transform={`translate(-22 ${-70 * scale}) scale(${scale})`}>
          <SeatedWorker pose={pose} look={look} />
        </g>
      )}

      {/* 桌面 + 桌腿 */}
      <rect x={-w / 2} y="-10" width={w} height="15" rx="6" fill={OFC.woodLight} stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x={-w / 2 + 14} y="5" width="11" height="32" rx="3.5" fill={OFC.woodDark} stroke={OFC.ink} strokeWidth="2.8" />
      <rect x={w / 2 - 25} y="5" width="11" height="32" rx="3.5" fill={OFC.woodDark} stroke={OFC.ink} strokeWidth="2.8" />

      {/* 桌面小物：键盘 + 便签 + 杯子 */}
      <rect x="-68" y="-18" width="44" height="10" rx="3.4" fill="#e8eef5" stroke={OFC.ink} strokeWidth="2.4" />
      <g strokeWidth="1.6" stroke="#b9c6d6">
        <line x1="-62" y1="-13.4" x2="-62" y2="-12.4" />
        <line x1="-54" y1="-13.4" x2="-54" y2="-12.4" />
        <line x1="-46" y1="-13.4" x2="-46" y2="-12.4" />
      </g>
      {!dim && <rect className="ofc-sticky" x="-25" y="-20" width="19" height="13" rx="2.2" fill={OFC.noteA} stroke={OFC.ink} strokeWidth="2" transform="rotate(-7 -15 -13)" />}
      {/* 马克杯：杯身 + 把手 + 咖啡液面（⛔ 只画一个白方块会被看成一张纸 —— 放大截图实测） */}
      {!dim && (
        <g transform={`translate(${w / 2 - 52} -18)`}>
          <path d="M -8 -11 h 16 l -2.4 13 a 4 4 0 0 1 -4 3.2 h -3.2 a 4 4 0 0 1 -4 -3.2 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.4" />
          <path d="M 8 -7 q 6.4 4 0 8.6" fill="none" stroke={OFC.ink} strokeWidth="2.4" />
          <ellipse cx="0" cy="-11" rx="8" ry="3" fill="#c98a52" stroke={OFC.ink} strokeWidth="2" />
        </g>
      )}

      {/* 显示器（人右前方）—— ⛔ 偏移必须跟着工位宽度走：CEO 桌更宽（214 vs 168），
          写死偏移会让 CEO 的屏幕压在他自己脸上（v5 首版实测：与头重叠 17×35px）。 */}
      <g className="ofc-monitor" transform={`translate(${w / 2 - (ceo ? 86 : 70)} -64)`}>
        <rect x="2" y="33" width="28" height="8" rx="3.2" fill={OFC.metal} stroke={OFC.ink} strokeWidth="2.4" />
        {/* ⛔ 屏幕别比头还大：58×44 时比人物头（41 宽）还宽，放大后像一块招牌（已缩到 52×40） */}
        <rect x="-15" y="-33" width="52" height="40" rx="6" fill="#ffffff" stroke={OFC.ink} strokeWidth={INK_W} />
        <rect x="-10.5" y="-28.5" width="43" height="30" rx="3.4" fill={dim ? "#e7edf4" : working ? "url(#ofc-screen)" : OFC.screen} />
        {!dim && (
          <g className={`ofc-code${working ? " is-live" : ""}`} stroke={working ? OFC.codeInk : OFC.codeIdle} strokeWidth="2.2" strokeLinecap="round">
            <line className="ofc-code-line c1" x1="-6" y1="-21" x2="16" y2="-21" />
            <line className="ofc-code-line c2" x1="-6" y1="-14" x2="26" y2="-14" />
            <line className="ofc-code-line c3" x1="-6" y1="-7" x2="10" y2="-7" />
          </g>
        )}
        {!dim && <circle className={`ofc-desk-led${working ? " is-live" : ""}`} cx="34" cy="-26" r="2.4" fill={working ? OFC.ok : OFC.metalDark} />}
      </g>

      {/* 运行中气泡 */}
      {pose?.kind === "work" && working && (
        <g className="ofc-bubble" transform="translate(32 -148)">
          <rect x="-25" y="-18" width="52" height="27" rx="13.5" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.4" />
          <path d="M -10 9 l -4 9 l 11 -8 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.4" strokeLinejoin="round" />
          <circle className="ofc-dot" cx="-11" cy="-4" r="3.4" fill={OFC.ok} />
          <circle className="ofc-dot ofc-dot-2" cx="0" cy="-4" r="3.4" fill={OFC.ok} />
          <circle className="ofc-dot ofc-dot-3" cx="11" cy="-4" r="3.4" fill={OFC.ok} />
        </g>
      )}

      {/* 空工位标（真的没会话时才显示） */}
      {dim && (
        <g transform="translate(-22 -136)">
          <rect x="-44" y="-16" width="88" height="30" rx="15" fill="#ffffff" stroke="#b9c6d6" strokeWidth="2.2" strokeDasharray="5 4" />
          <text x="0" y="6" textAnchor="middle" className="ofc-vacant-text">空工位</text>
        </g>
      )}

      {/* CEO 徽章（v4 是头顶浮标，会和白板/吊灯抢墙面位置，改成贴在桌沿的小牌） */}
      {ceo && (
        <g transform="translate(0 40)">
          <rect x="-26" y="-11" width="52" height="22" rx="11" fill={OFC.warn} stroke={OFC.ink} strokeWidth="2.6" />
          <text x="0" y="4.4" textAnchor="middle" className="ofc-ceo-badge">CEO</text>
        </g>
      )}

      {/* 名牌 */}
      <text x="0" y="76" textAnchor="middle" className="ofc-plate-name">{name}</text>
      <text x="0" y="94" textAnchor="middle" className="ofc-plate-role">{profession}</text>
    </g>
  );
}
