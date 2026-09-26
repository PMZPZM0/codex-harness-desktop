/**
 * 角色绘制（team-office 域 09-26 v4）。
 *
 * 两套呈现互斥：
 *   · SeatedWorker —— 坐在工位上（work / coffee / stretch / phone / doze / note）
 *   · WalkingWorker —— 站着的全身小人（visit 串门 / errand 跑腿），在场景层按地面坐标走动
 *   ⛔ 「起身离开」时工位只剩椅子（椅子由 Desk 画）——人走了椅子还在，这是常识，
 *      所以椅子**不跟人一起位移**（早期版本人和椅子一起飘，一眼假）。
 *
 * 姿势靠根节点的 `pose-<kind>` 类切换，CSS 负责各姿势的手臂/躯干姿态；
 * 本文件只保证「每个姿势该有的部件都在」，不写具体角度（角度全在 20-team-office.css）。
 */
import { OFC, type WorkerLook } from "./office-palette";
import type { OfficePose } from "./office-director";

type SeatedProps = { pose: OfficePose; look: WorkerLook };

/** 共用的脸（三种发型 + 可选眼镜 + 表情随姿势变）。 */
function Head({ look, pose, sleeping, awake }: { look: WorkerLook; pose: OfficePose; sleeping?: boolean; awake?: boolean }) {
  const { skin, hair, hairStyle, glasses } = look;
  return (
    <g className="ofc-head">
      <circle cx="0" cy="-7" r="17.5" fill={skin} stroke={OFC.ink} strokeWidth="2.6" />
      {/* 耳朵 */}
      <circle cx="-16" cy="-5" r="3.4" fill={skin} stroke={OFC.ink} strokeWidth="2" />
      {/* 头发：三种（⛔ 差别要一眼看出来，否则一屋子人像同一个人换了衣服） */}
      {hairStyle === 0 && (
        <path d="M -17.5 -11 Q 0 -32 17.5 -11 Q 8 -19 0 -17.5 Q -8 -19 -17.5 -11 Z" fill={hair} stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
      )}
      {hairStyle === 1 && (
        <>
          {/* 中分长鬓角：两侧垂到脸颊 */}
          <path d="M -18 -9 Q -5 -35 18 -9 Q 15 -19 7 -20 Q 0 -13 -5 -19 Q -13 -20 -18 -9 Z" fill={hair} stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M -18 -8 Q -21 2 -17 8 Q -13 1 -15 -6 Z" fill={hair} stroke={OFC.ink} strokeWidth="2" strokeLinejoin="round" />
          <path d="M 18 -8 Q 21 2 17 8 Q 13 1 15 -6 Z" fill={hair} stroke={OFC.ink} strokeWidth="2" strokeLinejoin="round" />
        </>
      )}
      {hairStyle === 2 && (
        <>
          {/* 高丸子头 */}
          <path d="M -17 -12 Q 0 -30 17 -12 Q 6 -18 0 -18 Q -6 -18 -17 -12 Z" fill={hair} stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="-2" cy="-30" r="10.5" fill={hair} stroke={OFC.ink} strokeWidth="2.2" />
          <path d="M -10 -22 q 8 -6 16 0" fill="none" stroke={OFC.ink} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {/* 脸 */}
      {sleeping ? (
        <>
          <path d="M -11 -5 q 3.6 3.4 7.2 0" fill="none" stroke={OFC.ink} strokeWidth="2" strokeLinecap="round" />
          <path d="M 3.4 -5 q 3.6 3.4 7.2 0" fill="none" stroke={OFC.ink} strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="-6.6" cy="-7" r="2.1" fill={OFC.ink} className="ofc-eye" />
          <circle cx="6.6" cy="-7" r="2.1" fill={OFC.ink} className="ofc-eye" />
          <circle cx="-11" cy="-1.5" r="2.6" fill="#f3a6a0" opacity="0.5" />
          <circle cx="11" cy="-1.5" r="2.6" fill="#f3a6a0" opacity="0.5" />
        </>
      )}
      {awake ? (
        <ellipse cx="0" cy="2" rx="3.6" ry="4" fill={OFC.ink} opacity="0.85" />
      ) : sleeping ? null : (
        <path d={pose.kind === "stretch" ? "M -3.4 1.6 q 3.4 4 6.8 0" : "M -3 1 q 3 2.6 6 0"} fill="none" stroke={OFC.ink} strokeWidth="1.8" strokeLinecap="round" />
      )}
      {glasses && (
        <g fill="none" stroke={OFC.ink} strokeWidth="1.8" className="ofc-glasses">
          <rect x="-13.4" y="-11.4" width="12.6" height="9.4" rx="3.4" />
          <rect x="0.8" y="-11.4" width="12.6" height="9.4" rx="3.4" />
          <line x1="-0.8" y1="-7" x2="0.8" y2="-7" />
          <line x1="-13.4" y1="-8" x2="-17.5" y2="-7" />
          <line x1="13.4" y1="-8" x2="17.5" y2="-7" />
        </g>
      )}
    </g>
  );
}

/** 躯干（含领口 / 领带 / 腰带），`tone` 决定明暗。 */
function Torso({ look, ceo }: { look: WorkerLook; ceo?: boolean }) {
  return (
    <g className="ofc-torso">
      <rect x="-20" y="12" width="40" height="48" rx="15" fill={look.cloth} stroke={OFC.ink} strokeWidth="2.6" />
      {look.collar && (
        <path d="M -9 13 L 0 22 L 9 13" fill="none" stroke={OFC.ink} strokeWidth="2" strokeLinejoin="round" />
      )}
      {ceo && <path d="M -5 20 l 5 6 l -5 15 l -5 -15 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2" strokeLinejoin="round" />}
      <line x1="-17" y1="46" x2="17" y2="46" stroke={OFC.ink} strokeWidth="1.8" opacity="0.5" />
    </g>
  );
}

/** 坐在工位上的角色。 */
export function SeatedWorker({ pose, look }: SeatedProps) {
  const sleeping = pose.kind === "doze";
  const moving = pose.kind === "stretch";
  return (
    <g className={`ofc-person ofc-person--seated pose-${pose.kind} v${pose.variant % 3}`}>
      <ellipse cx="0" cy="80" rx="36" ry="8" fill="#63707f" opacity="0.16" />
      {/* 腿（侧面朝向右侧：大腿 + 小腿 + 皮鞋） */}
      <rect x="-8" y="58" width="32" height="13" rx="6.5" fill="#4d5d72" stroke={OFC.ink} strokeWidth="2.4" />
      <rect x="15" y="65" width="13" height="26" rx="6.5" fill="#4d5d72" stroke={OFC.ink} strokeWidth="2.4" />
      <ellipse cx="26" cy="91" rx="13" ry="6.5" fill="#39424f" stroke={OFC.ink} strokeWidth="2.4" />
      <g className="ofc-body">
        <Torso look={look} />
        {/* 手臂整体成组（rect + 手一起转）—— ⛔ 手必须是手臂的子元素，
            否则抬手臂时手留在原地（早期版本一眼穿帮）。 */}
        {/* 后手臂（先画 = 在躯干后面） */}
        <g className="ofc-arm ofc-arm-back">
          <rect x="-26" y="16" width="11" height="31" rx="5.5" fill={look.cloth} stroke={OFC.ink} strokeWidth="2.4" />
          <circle className="ofc-hand" cx="-20.5" cy="47" r="5.4" fill={look.skin} stroke={OFC.ink} strokeWidth="2.2" />
        </g>
        {/* 前手臂 */}
        <g className="ofc-arm ofc-arm-front">
          <rect x="15" y="16" width="11" height="31" rx="5.5" fill={look.cloth} stroke={OFC.ink} strokeWidth="2.4" />
          <circle className="ofc-hand" cx="20.5" cy="47" r="5.4" fill={look.skin} stroke={OFC.ink} strokeWidth="2.2" />
        </g>
      </g>
      <g className="ofc-headwrap">
        <Head look={look} pose={pose} sleeping={sleeping} awake={moving} />
      </g>

      {/* ── 姿势附加物 ── */}
      {sleeping && (
        <g className="ofc-zzz-group">
          <text className="ofc-zzz" x="18" y="-28" fontSize="16" fontWeight="700" fill="#8fa0b4" stroke="none">Z</text>
          <text className="ofc-zzz ofc-zzz-2" x="30" y="-42" fontSize="12" fontWeight="700" fill="#8fa0b4" stroke="none">z</text>
        </g>
      )}
      {pose.kind === "coffee" && (
        <g className="ofc-mug" transform="translate(24 26)">
          <rect x="-7" y="-9" width="14" height="14" rx="3" fill="#ffffff" stroke={OFC.ink} strokeWidth="2" />
          <path d="M 7 -6 q 6 4 0 9" fill="none" stroke={OFC.ink} strokeWidth="2" />
          <path className="ofc-steam" d="M -3 -12 q 3 -5 0 -9" fill="none" stroke="#c3ccd8" strokeWidth="2" strokeLinecap="round" />
          <path className="ofc-steam ofc-steam-2" d="M 3 -12 q 3 -5 0 -9" fill="none" stroke="#c3ccd8" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {pose.kind === "phone" && (
        <g className="ofc-phone" transform="translate(20 30)">
          <rect x="-7" y="-11" width="14" height="22" rx="3.4" fill="#39424f" stroke={OFC.ink} strokeWidth="2" />
          <rect x="-4.4" y="-8" width="8.8" height="16" rx="2" fill="#bfe0ff" opacity="0.9" />
        </g>
      )}
      {pose.kind === "note" && (
        <g className="ofc-note" transform="translate(-2 32)">
          <rect x="-16" y="-11" width="32" height="22" rx="3" fill={OFC.paper} stroke={OFC.ink} strokeWidth="2" transform="rotate(-6)" />
          <line x1="-11" y1="-5" x2="6" y2="-5" stroke="#9fb0c2" strokeWidth="2" strokeLinecap="round" transform="rotate(-6)" />
          <line x1="-11" y1="1" x2="9" y2="1" stroke="#9fb0c2" strokeWidth="2" strokeLinecap="round" transform="rotate(-6)" />
        </g>
      )}
      {pose.kind === "stretch" && (
        <g className="ofc-sweat" transform="translate(20 -26)">
          <path d="M 0 0 q 4 5 0 8 q -4 -3 0 -8 z" fill={OFC.info} opacity="0.75" />
        </g>
      )}
    </g>
  );
}

/** 站着的全身小人（串门 / 跑腿）。`dx/dy` 给出目标位移，CSS transition 负责走过去。 */
export function WalkingWorker({ look, carrying, facing, label }: {
  look: WorkerLook;
  carrying?: boolean;
  /** 1 = 朝右，-1 = 朝左 */
  facing: 1 | -1;
  label?: string;
}) {
  return (
    <g className="ofc-walker">
      <g className={`ofc-walker-inner${carrying ? " is-carrying" : ""}`} transform={`scale(${facing} 1)`}>
        <ellipse cx="0" cy="96" rx="19" ry="5.5" fill="#63707f" opacity="0.2" />
        <g className="ofc-walk-legs">
          <rect x="-9" y="58" width="8.6" height="34" rx="4.3" fill="#4d5d72" stroke={OFC.ink} strokeWidth="2.4" />
          <rect x="1.4" y="58" width="8.6" height="34" rx="4.3" fill="#5a6a80" stroke={OFC.ink} strokeWidth="2.4" />
          <ellipse cx="-4.6" cy="93" rx="8" ry="4.4" fill="#39424f" stroke={OFC.ink} strokeWidth="2.2" />
          <ellipse cx="5.8" cy="93" rx="8" ry="4.4" fill="#39424f" stroke={OFC.ink} strokeWidth="2.2" />
        </g>
        <g transform="translate(0 -6)">
          <Torso look={look} />
          <g className="ofc-arm ofc-arm-back">
            <rect x="-26" y="16" width="11" height="31" rx="5.5" fill={look.cloth} stroke={OFC.ink} strokeWidth="2.4" />
            <circle className="ofc-hand" cx="-20.5" cy="47" r="5.4" fill={look.skin} stroke={OFC.ink} strokeWidth="2.2" />
          </g>
          <g className="ofc-arm ofc-arm-front">
            <rect x="15" y="16" width="11" height="31" rx="5.5" fill={look.cloth} stroke={OFC.ink} strokeWidth="2.4" />
            <circle className="ofc-hand" cx="20.5" cy="47" r="5.4" fill={look.skin} stroke={OFC.ink} strokeWidth="2.2" />
          </g>
          {carrying && (
            <g className="ofc-carry" transform="translate(20 46)">
              <rect x="-11" y="-13" width="22" height="17" rx="2.6" fill={OFC.paper} stroke={OFC.ink} strokeWidth="2" transform="rotate(-8)" />
              <line x1="-7" y1="-7" x2="6" y2="-7" stroke="#9fb0c2" strokeWidth="2" strokeLinecap="round" transform="rotate(-8)" />
              <line x1="-7" y1="-2" x2="3" y2="-2" stroke="#b9c6d6" strokeWidth="2" strokeLinecap="round" transform="rotate(-8)" />
            </g>
          )}
          <Head look={look} pose={{ kind: "work", hold: 0, label: "", variant: 0 }} />
        </g>
      </g>
      {label && (
        <g className="ofc-walker-tag" transform="translate(0 -46)">
          <rect x="-34" y="-13" width="68" height="24" rx="12" fill="#ffffff" stroke={OFC.ink} strokeWidth="2" opacity="0.96" />
          <path d="M -5 11 l 5 7 l 6 -7 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2" strokeLinejoin="round" />
          <text x="0" y="4" textAnchor="middle" className="ofc-walker-tag-text">{label}</text>
        </g>
      )}
    </g>
  );
}
