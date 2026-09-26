/**
 * 公司模式 · 虚拟办公室（09-26 v6「复刻 ai-office-react」）。
 *
 * 用户看了 workbzw/ai-office-react（PixiJS + Spine 的 Q 版办公室）后要求「复刻过来」。
 * 作者的 README 明确写了「样式只是给你们参考的」「⛔ 注意素材版权问题」——
 * **素材不能搬**，所以这里复刻的是它的**画面语言与行为规则**，全部用我们自己的 SVG 画：
 *   ① 斜俯视房间（地板梯形 + 两面内收侧墙 + 后墙）—— 见 office-iso.ts
 *   ② 2 列 × 3 行工位阵列；工位构图 = **显示器最远（只见深灰背面）、桌子居中、人坐近侧**
 *   ③ 朝向规则：**工作中背对镜头**（在看显示器），空闲/走动才转正面
 *   ④ 每人头顶「当前动作 + 姓名 + 在线点」标签
 *   ⑤ 行为：串门拜访（走到同事工位旁并递一句话）、跑腿、派任务/交成果的飞行卡片
 *
 * ⛔ 动画仍由 office-director 每拍驱动（快照单源，右栏看板同源）；场景只负责画。
 * ⛔ 所有家具/工位/角色都走 office-iso 的 (u,v) 坐标 —— 不再各自用绝对坐标（会集体漂移）。
 */
import { useEffect, useMemo, useState } from "react";
import { OFC, ISO, workerLook } from "./office-palette";
import { handoffArc, type DirectorSnapshot, type OfficeHandoff, type OfficePose } from "./office-director";
import { SeatedWorker, WalkingWorker } from "./OfficeWorker";
import { deskSlots, floorPoint, SCENE_H, SCENE_W, type FloorSpot } from "./office-iso";
import {
  HANDOFF_LIFT, IsoBin, IsoCabinet, IsoCarton, IsoCeilingFan, IsoDeskBack, IsoDeskChair, IsoDeskFront,
  IsoFloorLamp, IsoLowTable, IsoPlant, IsoRoom, IsoRug, IsoShelfUnit, IsoSideTable,
  IsoSmallPlant, IsoWindow, SEAT_LIFT, TAG_LIFT,
} from "./OfficeFurniture";

export type OfficeMember = { id: string; name: string; profession: string; running: boolean; hasThread: boolean };
export type OfficeSceneProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  /** 姿势快照 —— ⛔ 由调用方（弹窗）持有的**唯一**导演产出，场景只负责画（右栏看板同源）。 */
  snapshot: DirectorSnapshot;
  onOpenThread?: (memberId: string) => void;
};

/** 跑腿目标点（归一化地面坐标）：左侧接水区 / 右侧书架前 / 右前过道。
 *  ⛔ u 别贴 0/1：地板收窄后，u<0.1 的目标点会落在房间外面（人会"走出去"）。 */
const ERRAND_SPOTS: Record<string, { u: number; v: number; facing: 1 | -1 }> = {
  water: { u: 0.13, v: 0.3, facing: 1 },
  shelf: { u: 0.86, v: 0.28, facing: -1 },
  printer: { u: 0.8, v: 0.24, facing: -1 },
};

const HANDOFF_TINT: Record<OfficeHandoff["kind"], string> = {
  task: "#dbeafe",
  report: "#d9f3e3",
  doc: "#fff0d0",
  chat: "#eee0fb",
};

type Slot = FloorSpot & { u: number; v: number } & {
  key: string;
  name: string;
  profession: string;
  running: boolean;
  hasThread: boolean;
  pose: OfficePose | null;
  isCeo: boolean;
  memberId: string | null;
};

export function OfficeScene({ ceoName, ceoProfession, members, snapshot, onOpenThread }: OfficeSceneProps) {
  /** 工位阵列 = CEO 位 + 成员位（复刻参考实现：主管也占一个工位，不单独搭台）。 */
  const slots = useMemo<Slot[]>(() => {
    const total = members.length + 1;
    const geo = deskSlots(total);
    const out: Slot[] = [];
    const ceoPose = snapshot.ceo;
    out.push({
      ...geo[0],
      key: "ceo",
      name: ceoName || "CEO",
      profession: ceoProfession || "统筹",
      running: members.some((m) => m.running),
      hasThread: true,
      pose: ceoPose,
      isCeo: true,
      memberId: null,
    });
    members.forEach((member, i) => {
      const g = geo[i + 1];
      if (!g) return;
      out.push({
        ...g,
        key: member.id,
        name: member.name || "员工",
        profession: member.profession || "通用",
        running: member.running,
        hasThread: member.hasThread,
        pose: member.hasThread ? snapshot.poses[i] ?? null : null,
        isCeo: false,
        memberId: member.id,
      });
    });
    return out;
  }, [members, snapshot, ceoName, ceoProfession]);

  /** 交接卡片的起落点 = 该工位人物头顶。 */
  const headOf = (index: number): { x: number; y: number } => {
    const slot = slots[index + 1];
    if (index < 0) return slots[0] ? { x: slots[0].x, y: slots[0].y - HANDOFF_LIFT * slots[0].scale } : { x: SCENE_W / 2, y: 200 };
    return slot ? { x: slot.x, y: slot.y - HANDOFF_LIFT * slot.scale } : { x: SCENE_W / 2, y: 200 };
  };

  return (
    <div className="office-scene" style={{ "--office-rows": 1 } as React.CSSProperties}>
      <svg className="office-svg" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="虚拟办公室">
        <defs>
          <linearGradient id="ofc-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cfe4f5" />
            <stop offset="100%" stopColor="#eef5fb" />
          </linearGradient>
        </defs>

        <IsoRoom />

        {/* ── 后墙：窗户（素材件）。
            ⛔ 这里**不再混用粗描边 SVG 家具**（墙架/挂钟/白板/饮水机/打印机已删）：
               手绘粗描边与 Kenney 的 3D 渲染件放同一屏，一眼就是"两种画风拼的"（实测）。 */}
        <IsoWindow u={0.3} up={92} k={0.56} />
        <IsoWindow u={0.7} up={92} k={0.56} />

        {/* ── 地毯（先画，被家具与人压住）── */}
        <IsoRug u={0.5} v={0.5} k={0.66} />

        {/* ── 靠墙家具与角落陈设（全部 Kenney 素材，画风统一）──
            ⛔ u 别贴 0/1：地板收窄后，u<0.1 的家具会有一半掉到地板外面（实测）。 */}
        <IsoCabinet u={0.26} v={0.05} />
        <IsoCabinet u={0.74} v={0.05} />
        <IsoShelfUnit u={0.88} v={0.07} />
        <IsoSideTable u={0.5} v={0.07} />
        <IsoPlant u={0.1} v={0.2} />
        <IsoPlant u={0.9} v={0.24} />
        <IsoFloorLamp u={0.11} v={0.6} />
        <IsoLowTable u={0.13} v={0.36} />
        <IsoSideTable u={0.87} v={0.48} />
        <IsoCarton u={0.88} v={0.74} />
        <IsoBin u={0.17} v={0.8} />
        <IsoSmallPlant u={0.35} v={0.94} variant={1} />
        <IsoSmallPlant u={0.65} v={0.94} variant={2} />
        <IsoCeilingFan x={SCENE_W / 2} y={104} k={0.9} />

        {/* ── 工位（后排先画 ⇒ 前排自然盖住后排，形成纵深）── */}
        {slots.map((slot) => {
          const state: "running" | "idle" | "never" = slot.running ? "running" : slot.hasThread ? "idle" : "never";
          const away = slot.pose?.kind === "visit" || slot.pose?.kind === "errand";
          // ⛔ 朝向规则（复刻参考实现）：工作中背对镜头看显示器；空闲/走动转正面。
          const back = slot.running && slot.pose?.kind === "work";
          return (
            <g
              key={slot.key}
              className={`ofc-desk ofc-worker state-${state}${slot.hasThread ? "" : " is-empty"}${slot.memberId ? " is-clickable" : ""}`}
              onClick={slot.memberId && slot.hasThread ? () => onOpenThread?.(slot.memberId as string) : undefined}
            >
              {state === "never" && <NeverMark spot={slot} />}
              {/* ⛔ v7 图层顺序（复刻参考实现的工位构图）：**显示器（最远）→ 椅子 → 人 → 桌子（最近）**。
                  人夹在中间，桌子才会**遮住人的下半身** = 「坐在桌后」；早先是「家具先画、人后画」，
                  人浮在桌子上方 ⇒ 看着像站在桌前而不是坐在桌后（v6 的观感问题）。 */}
              <IsoDeskBack u={slot.u} v={slot.v} />
              <IsoDeskChair u={slot.u} v={slot.v} />
              {/* 人物上抬量见 SEAT_LIFT（与 SPRITE_K 联动，OfficeFurniture 里有实测记录）。 */}
              {slot.pose && !away && (
                <g transform={`translate(${slot.x} ${slot.y - SEAT_LIFT * slot.scale}) scale(${slot.scale})`}>
                  <SeatedWorker pose={slot.pose} look={workerLook(slot.isCeo ? members.length + 3 : members.findIndex((m) => m.id === slot.memberId), slot.isCeo ? 1 : 0)} view={back ? "back" : "front"} />
                </g>
              )}
              <IsoDeskFront u={slot.u} v={slot.v} />
              <StatusTag x={slot.x} y={slot.y - TAG_LIFT * slot.scale} name={slot.name} activity={slot.pose?.label ?? ""} running={slot.running} dim={state === "never"} />
            </g>
          );
        })}

        {/* ── 走动中的员工（串门 / 跑腿）── */}
        {slots.map((slot, si) => {
          const pose = slot.pose;
          if (!pose || slot.isCeo) return null;
          const memberIndex = si - 1;
          const from = { x: slot.x, y: slot.y + 14 * slot.scale };
          if (pose.kind === "visit") {
            const host = slots[(pose.visitIndex ?? -1) + 1];
            const to = host ? { x: host.x - 74 * host.scale, y: host.y + 26 * host.scale, facing: 1 as const } : { x: slot.x, y: slot.y, facing: 1 as const };
            return <Walker key={`w-${slot.key}`} from={from} to={to} look={workerLook(memberIndex)} carrying label="拜访" />;
          }
          if (pose.kind === "errand" && pose.spot) {
            const target = ERRAND_SPOTS[pose.spot];
            if (!target) return null;
            const p = floorPoint(target.u, target.v);
            return <Walker key={`w-${slot.key}`} from={from} to={{ x: p.x, y: p.y + 10, facing: target.facing }} look={workerLook(memberIndex)} />;
          }
          return null;
        })}

        {/* ── 交接飞行层（最上层）── */}
        <g className="ofc-handoffs">
          {snapshot.handoffs.map((handoff) => (
            <HandoffCard key={handoff.id} handoff={handoff} from={headOf(handoff.from)} to={headOf(handoff.to)} />
          ))}
        </g>

        {members.length === 0 && (
          <text x={SCENE_W / 2} y={SCENE_H - 40} textAnchor="middle" className="office-empty-text">还没有员工 —— 到「专家 / 专家团」给 CEO 配几名成员</text>
        )}
      </svg>
    </div>
  );
}

/** 头顶标签：当前动作 + 姓名 + 在线点（复刻参考实现最有辨识度的元素）。 */
function StatusTag({ x, y, name, activity, running, dim }: { x: number; y: number; name: string; activity: string; running: boolean; dim: boolean }) {
  const task = activity || (dim ? "未开工" : running ? "处理中" : "待命");
  return (
    <g className="ofc-status-tag" transform={`translate(${x} ${y})`} opacity={dim ? 0.55 : 1}>
      <rect x="-62" y="-8" width="124" height="36" rx="11" fill="#ffffff" stroke={ISO.ink} strokeWidth="2.4" opacity="0.97" />
      <text x="0" y="7" textAnchor="middle" className="ofc-tag-task">{task}</text>
      <circle cx="-34" cy="20" r="3.6" fill={running ? OFC.ok : "#b4b7ba"} />
      <text x="-26" y="24" className="ofc-tag-name">{name}</text>
    </g>
  );
}

/** 空工位标（真的没有会话时才显示）。 */
function NeverMark({ spot }: { spot: FloorSpot }) {
  return (
    <g transform={`translate(${spot.x} ${spot.y - 96 * spot.scale})`}>
      <rect x="-42" y="-15" width="84" height="30" rx="15" fill="#ffffff" stroke="#b9c6d6" strokeWidth="2.2" strokeDasharray="5 4" opacity="0.9" />
      <text x="0" y="6" textAnchor="middle" className="ofc-vacant-text">空工位</text>
    </g>
  );
}

/** 一个走动中的小人：起点 → 目标点（CSS transition 走过去，走就位后原地待命）。 */
function Walker({ from, to, look, carrying, label, scale = 0.88 }: {
  from: { x: number; y: number };
  to: { x: number; y: number; facing: 1 | -1 };
  look: ReturnType<typeof workerLook>;
  carrying?: boolean;
  label?: string;
  scale?: number;
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
      {/* ⛔ 走动人要跟着地面缩放：不缩的话他会比坐着的人大一整圈（v6 首版实测）。 */}
      <g transform={`scale(${scale})`}>
        <WalkingWorker look={look} carrying={carrying} facing={to.facing} label={label} />
      </g>
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
