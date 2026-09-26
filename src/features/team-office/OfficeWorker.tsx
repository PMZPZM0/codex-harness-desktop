/**
 * 角色绘制（team-office 域 09-26 v5「造型升级」）。
 *
 * v4 人物被评「还是好丑」，去 GitHub 调研了现成库（DiceBear / open-peeps / avataaars /
 * notionists）后确认两件事：
 *   ⛔ 它们全是**半身或头像**（viewBox 704×704），且 DiceBear 输出的 SVG 是**扁平化**的
 *      （16~31 个元素、无部件分组）—— 拆不出可动画的手臂，没法用在工位上做
 *      「坐姿 + 打字 / 抬杯 / 伸懒腰」的部件动画。所以人物只能自绘，但造型可以照抄它们的规律：
 *   ✅ 造型规律 = **粗描边 + 大头 + 极简五官（点眼 + 短线嘴 + 眉毛）+ 饱和扁平色**。
 *      v4 的问题正是：描边 2.4 太细（像线稿没画完）、五官太碎（腮红/耳朵/领口/腰带堆叠）、
 *      头偏小、眼睛太小没神。
 *
 * 本版只改**造型**，不动结构：所有类名（.ofc-person / .ofc-arm / .ofc-hand / .ofc-head /
 * .ofc-body / .ofc-headwrap / .ofc-torso / …）与部件分组完全保留 ⇒ CSS 动画与守卫【168】不受影响。
 * 两套呈现互斥：坐姿（六种姿势）与站姿全身小人（串门 / 跑腿）。
 */
import { OFC, INK_W, INK_W_THIN, type WorkerLook } from "./office-palette";
import type { OfficePose } from "./office-director";

type SeatedProps = { pose: OfficePose; look: WorkerLook };

/** 共用的脸：大头 + 点眼（带高光）+ 眉毛 + 短线嘴，三种发型差异一眼可辨。 */
function Head({ look, pose, sleeping, awake }: { look: WorkerLook; pose: OfficePose; sleeping?: boolean; awake?: boolean }) {
  const { skin, hair, hairStyle, glasses } = look;
  return (
    <g className="ofc-head">
      <circle cx="0" cy="-7" r="20.5" fill={skin} stroke={OFC.ink} strokeWidth={INK_W} />
      <circle cx="-20" cy="-4" r="4.2" fill={skin} stroke={OFC.ink} strokeWidth="2.6" />
      {/* 头发：三种，造型差异刻意拉大（一屋子人不能像同一个人换了衣服） */}
      {hairStyle === 0 && (
        <path d="M -20.5 -12 Q 0 -38 20.5 -12 Q 9 -20 0 -18.5 Q -9 -20 -20.5 -12 Z" fill={hair} stroke={OFC.ink} strokeWidth={INK_W} strokeLinejoin="round" />
      )}
      {hairStyle === 1 && (
        <>
          {/* 中分：分缝直接画在整片头发里，⛔ 不再单挂两片鬓角 —— 那两片深色贴在脸颊两侧
              在放大图里像是「戴了耳机」（实测发现，已删）。 */}
          <path d="M -21 -9 Q -8 -41 21 -10 Q 16 -22 7 -22 Q 0 -13 -7 -22 Q -16 -22 -21 -9 Z" fill={hair} stroke={OFC.ink} strokeWidth={INK_W} strokeLinejoin="round" />
        </>
      )}
      {hairStyle === 2 && (
        <>
          <path d="M -20 -13 Q 0 -34 20 -13 Q 7 -20 0 -20 Q -7 -20 -20 -13 Z" fill={hair} stroke={OFC.ink} strokeWidth={INK_W} strokeLinejoin="round" />
          <circle cx="-2" cy="-34" r="12" fill={hair} stroke={OFC.ink} strokeWidth={INK_W} />
          <path d="M -11 -25 q 9.5 -7.5 19 0" fill="none" stroke={OFC.ink} strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}

      {/* 脸 */}
      {sleeping ? (
        <>
          <path d="M -12 -6 q 4 4 8 0" fill="none" stroke={OFC.ink} strokeWidth={INK_W_THIN} strokeLinecap="round" />
          <path d="M 4 -6 q 4 4 8 0" fill="none" stroke={OFC.ink} strokeWidth={INK_W_THIN} strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* 眉毛（给表情） */}
          <path d="M -12.5 -15.5 Q -8 -18.5 -3.6 -16.4" fill="none" stroke={OFC.ink} strokeWidth={INK_W_THIN} strokeLinecap="round" />
          <path d="M 3.6 -16.4 Q 8 -18.5 12.5 -15.5" fill="none" stroke={OFC.ink} strokeWidth={INK_W_THIN} strokeLinecap="round" />
          {/* 眼睛：大点 + 高光（可爱度的主要来源） */}
          <circle className="ofc-eye" cx="-7" cy="-6" r="3.1" fill={OFC.ink} />
          <circle className="ofc-eye" cx="7" cy="-6" r="3.1" fill={OFC.ink} />
          <circle cx="-6" cy="-7.3" r="1.05" fill="#ffffff" />
          <circle cx="8" cy="-7.3" r="1.05" fill="#ffffff" />
        </>
      )}
      {awake ? (
        <ellipse cx="0" cy="3.4" rx="4" ry="4.6" fill={OFC.ink} opacity="0.85" />
      ) : sleeping ? null : (
        <path d={pose.kind === "stretch" ? "M -4 2.4 q 4 4.4 8 0" : "M -3.6 3 q 3.6 3.2 7.2 0"} fill="none" stroke={OFC.ink} strokeWidth={INK_W_THIN} strokeLinecap="round" />
      )}
      {glasses && (
        <g fill="none" stroke={OFC.ink} strokeWidth="2.4" className="ofc-glasses">
          <rect x="-15" y="-12" width="13.6" height="11" rx="4.6" />
          <rect x="1.4" y="-12" width="13.6" height="11" rx="4.6" />
          <line x1="-1.4" y1="-7" x2="1.4" y2="-7" />
          <line x1="-15" y1="-8" x2="-20" y2="-7" />
          <line x1="15" y1="-8" x2="20" y2="-7" />
        </g>
      )}
    </g>
  );
}

/** 躯干：宽肩圆角 + 简洁领口（v4 的领带/腰带叠太多细节，已删）。 */
function Torso({ look, ceo }: { look: WorkerLook; ceo?: boolean }) {
  return (
    <g className="ofc-torso">
      <rect x="-21" y="12" width="42" height="50" rx="16" fill={look.cloth} stroke={OFC.ink} strokeWidth={INK_W} />
      {look.collar && <path d="M -10 13 L 0 23 L 10 13" fill="none" stroke={OFC.ink} strokeWidth="2.4" strokeLinejoin="round" />}
      {ceo && (
        <>
          <path d="M -5.5 21 l 5.5 6.5 l -5.5 16 l -5.5 -16 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M -9.5 15 l 4 6 l 11 0 l 4 -6 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.2" strokeLinejoin="round" opacity="0.9" />
        </>
      )}
    </g>
  );
}

/** 坐在工位上的角色（六种姿势；手臂与手是**同一个 g**，抬手时手跟着走）。 */
export function SeatedWorker({ pose, look }: SeatedProps) {
  const sleeping = pose.kind === "doze";
  const moving = pose.kind === "stretch";
  return (
    <g className={`ofc-person ofc-person--seated pose-${pose.kind} v${pose.variant % 3}`}>
      <ellipse cx="0" cy="82" rx="38" ry="8.5" fill="#63707f" opacity="0.16" />
      {/* 腿（侧面朝右：大腿 + 小腿 + 皮鞋） */}
      <rect x="-8" y="58" width="34" height="14" rx="7" fill="#4d5d72" stroke={OFC.ink} strokeWidth={INK_W} />
      <rect x="16" y="66" width="14" height="27" rx="7" fill="#4d5d72" stroke={OFC.ink} strokeWidth={INK_W} />
      <ellipse cx="28" cy="94" rx="14" ry="7" fill="#39424f" stroke={OFC.ink} strokeWidth={INK_W} />
      <g className="ofc-body">
        <Torso look={look} />
        {/* ⛔ 手必须是手臂的子元素，否则抬手臂时手留在原地（一眼穿帮） */}
        {/* ⛔ 手臂必须落在躯干**外侧**（只搭 3px 在肩上）：v5 首版手臂压在躯干两侧且同色，
            放大后看着像「背带裤的两根背带」。 */}
        <g className="ofc-arm ofc-arm-back">
          <rect x="-30" y="15" width="11" height="31" rx="5.5" fill={look.cloth} stroke={OFC.ink} strokeWidth={INK_W} />
          <circle className="ofc-hand" cx="-24.5" cy="48" r="6.2" fill={look.skin} stroke={OFC.ink} strokeWidth={INK_W} />
        </g>
        <g className="ofc-arm ofc-arm-front">
          <rect x="19" y="15" width="11" height="31" rx="5.5" fill={look.cloth} stroke={OFC.ink} strokeWidth={INK_W} />
          <circle className="ofc-hand" cx="24.5" cy="48" r="6.2" fill={look.skin} stroke={OFC.ink} strokeWidth={INK_W} />
        </g>
      </g>
      <g className="ofc-headwrap">
        <Head look={look} pose={pose} sleeping={sleeping} awake={moving} />
      </g>

      {/* ── 姿势附加物 ── */}
      {sleeping && (
        <g className="ofc-zzz-group">
          <text className="ofc-zzz" x="22" y="-32" fontSize="17" fontWeight="700" fill="#8fa0b4" stroke="none">Z</text>
          <text className="ofc-zzz ofc-zzz-2" x="35" y="-47" fontSize="13" fontWeight="700" fill="#8fa0b4" stroke="none">z</text>
        </g>
      )}
      {pose.kind === "coffee" && (
        <g className="ofc-mug" transform="translate(24 28)">
          <rect x="-7.5" y="-9.5" width="15" height="15" rx="3.4" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.6" />
          <path d="M 7.5 -6.5 q 6.5 4.5 0 10" fill="none" stroke={OFC.ink} strokeWidth="2.4" />
          <path className="ofc-steam" d="M -3.2 -13 q 3.2 -5.4 0 -9.6" fill="none" stroke="#c3ccd8" strokeWidth="2.2" strokeLinecap="round" />
          <path className="ofc-steam ofc-steam-2" d="M 3.2 -13 q 3.2 -5.4 0 -9.6" fill="none" stroke="#c3ccd8" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}
      {pose.kind === "phone" && (
        <g className="ofc-phone" transform="translate(21 32)">
          <rect x="-7.5" y="-12" width="15" height="24" rx="3.8" fill="#39424f" stroke={OFC.ink} strokeWidth="2.4" />
          <rect x="-4.8" y="-8.6" width="9.6" height="17.2" rx="2.2" fill="#bfe0ff" opacity="0.92" />
        </g>
      )}
      {pose.kind === "note" && (
        <g className="ofc-note" transform="translate(-2 33)">
          <rect x="-17" y="-12" width="34" height="24" rx="3.4" fill={OFC.paper} stroke={OFC.ink} strokeWidth="2.4" transform="rotate(-6)" />
          <line x1="-12" y1="-5.5" x2="6" y2="-5.5" stroke="#9fb0c2" strokeWidth="2.2" strokeLinecap="round" transform="rotate(-6)" />
          <line x1="-12" y1="1" x2="9.5" y2="1" stroke="#9fb0c2" strokeWidth="2.2" strokeLinecap="round" transform="rotate(-6)" />
        </g>
      )}
      {pose.kind === "stretch" && (
        <g className="ofc-sweat" transform="translate(23 -29)">
          <path d="M 0 0 q 4.4 5.5 0 9 q -4.4 -3.5 0 -9 z" fill={OFC.info} opacity="0.78" />
        </g>
      )}
    </g>
  );
}

/** 站着的全身小人（串门 / 跑腿）。位移在父级 `.ofc-walker-slot` 上，这里只管造型。 */
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
        <ellipse cx="0" cy="99" rx="21" ry="6" fill="#63707f" opacity="0.2" />
        <g className="ofc-walk-legs">
          <rect x="-10" y="60" width="9.6" height="35" rx="4.8" fill="#4d5d72" stroke={OFC.ink} strokeWidth={INK_W} />
          <rect x="1.6" y="60" width="9.6" height="35" rx="4.8" fill="#5a6a80" stroke={OFC.ink} strokeWidth={INK_W} />
          <ellipse cx="-5.4" cy="96" rx="8.6" ry="4.8" fill="#39424f" stroke={OFC.ink} strokeWidth="2.6" />
          <ellipse cx="6.4" cy="96" rx="8.6" ry="4.8" fill="#39424f" stroke={OFC.ink} strokeWidth="2.6" />
        </g>
        <g transform="translate(0 -6)">
          <Torso look={look} />
          <g className="ofc-arm ofc-arm-back">
            <rect x="-27" y="16" width="12" height="32" rx="6" fill={look.cloth} stroke={OFC.ink} strokeWidth={INK_W} />
            <circle className="ofc-hand" cx="-21" cy="49" r="6.2" fill={look.skin} stroke={OFC.ink} strokeWidth={INK_W} />
          </g>
          <g className="ofc-arm ofc-arm-front">
            <rect x="15" y="16" width="12" height="32" rx="6" fill={look.cloth} stroke={OFC.ink} strokeWidth={INK_W} />
            <circle className="ofc-hand" cx="21" cy="49" r="6.2" fill={look.skin} stroke={OFC.ink} strokeWidth={INK_W} />
          </g>
          {carrying && (
            <g className="ofc-carry" transform="translate(21 48)">
              <rect x="-12" y="-14" width="24" height="18" rx="2.8" fill={OFC.paper} stroke={OFC.ink} strokeWidth="2.4" transform="rotate(-8)" />
              <line x1="-8" y1="-7.5" x2="6.5" y2="-7.5" stroke="#9fb0c2" strokeWidth="2.2" strokeLinecap="round" transform="rotate(-8)" />
              <line x1="-8" y1="-2" x2="3" y2="-2" stroke="#b9c6d6" strokeWidth="2.2" strokeLinecap="round" transform="rotate(-8)" />
            </g>
          )}
          <Head look={look} pose={{ kind: "work", hold: 0, label: "", variant: 0 }} />
        </g>
      </g>
      {label && (
        <g className="ofc-walker-tag" transform="translate(0 -50)">
          <rect x="-34" y="-13" width="68" height="25" rx="12.5" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.4" opacity="0.97" />
          <path d="M -5 12 l 5 7 l 6 -7 z" fill="#ffffff" stroke={OFC.ink} strokeWidth="2.4" strokeLinejoin="round" />
          <text x="0" y="4" textAnchor="middle" className="ofc-walker-tag-text">{label}</text>
        </g>
      )}
    </g>
  );
}
