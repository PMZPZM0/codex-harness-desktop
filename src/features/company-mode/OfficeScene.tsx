/**
 * 公司模式 · 虚拟办公室场景（09-25 v2，对齐 Marvis 马维斯的「拟人化办公室」）。
 *
 * ⛔ v1 的教训：做成了「方框节点 + 直角折线的组织架构图」—— 用户反馈「歪歪扭扭，跟 Marvis 差远了」。
 *    Marvis 的视觉本质是**一群有生命感的小角色在办公室里活动**：干活时在工位敲键盘，
 *    闲时打盹 / 喝咖啡。所以这里改成：办公室场景（墙 + 地板 + 工位家具）+ 每个员工一个
 *    SVG 小人（姿态与附加元素表达状态），动画全部 CSS 驱动。
 *
 * 状态语义：
 *   running（会话运行中）→ 坐在工位敲键盘（手臂摆动 + 身体前后小幅 + 屏幕发光 + 屏幕滚动条）
 *   idle（有会话但空闲）  → 靠在椅背上，头顶飘 Zzz / 偶尔端起咖啡
 *   never（没有会话）     → 空工位（椅子空着，显示器熄屏）
 */
import { useMemo } from "react";

export type OfficeMember = {
  id: string;
  name: string;
  profession: string;
  running: boolean;
  hasThread: boolean;
};

export type OfficeSceneProps = {
  ceoName: string;
  ceoProfession: string;
  members: OfficeMember[];
  onOpenThread?: (memberId: string) => void;
};

/** 每个员工一个色相偏移（同一主题下也有区分度）。 */
const HUE_STEP = 37;

function hueOf(index: number) {
  return (200 + index * HUE_STEP) % 360;
}

export function OfficeScene({ ceoName, ceoProfession, members, onOpenThread }: OfficeSceneProps) {
  const columns = Math.min(Math.max(members.length, 1), 4);
  const rows = Math.ceil(members.length / 4) || 1;
  const desks = useMemo(() => members.map((member, index) => ({ member, index })), [members]);

  return (
    <div className="office-scene" style={{ "--office-rows": rows } as React.CSSProperties}>
      {/* 后墙装饰：窗、白板、挂钟 —— 纯装饰，给场景「房间感」 */}
      <div className="office-wall">
        <div className="office-window">
          <span className="office-sky" />
          <span className="office-cloud cloud-a" />
          <span className="office-cloud cloud-b" />
        </div>
        <div className="office-whiteboard">
          <span className="office-board-line w70" />
          <span className="office-board-line w45" />
          <span className="office-board-line w60" />
        </div>
        <div className="office-clock"><span className="office-clock-hand" /></div>
        <div className="office-plant plant-left"><span /><span /><span /></div>
      </div>

      {/* 地板 */}
      <div className="office-floor">
        <span className="office-floor-line" />
      </div>

      {/* CEO 独立工位（居中偏上，桌子更大、带名牌） */}
      <div className="office-ceo">
        <div className="office-ceo-plate">{ceoName} · CEO</div>
        <div className="office-ceo-monitor" />
        <Worker variant="ceo" state="ceo" hue={38} />
        <div className="office-ceo-desk"><span className="office-ceo-desk-top" /></div>
        <div className="office-ceo-sub">{ceoProfession}</div>
      </div>

      {/* 员工工位区 */}
      <div className="office-desks" data-cols={columns}>
        {desks.map(({ member, index }) => (
          <div key={member.id} className={`office-desk ${member.running ? "is-working" : ""}${member.hasThread ? "" : " is-empty"}`}>
            <div className="office-desk-bubble">
              {member.running ? <span className="office-bubble-dots"><i /><i /><i /></span>
                : member.hasThread ? <span className="office-bubble-zzz">Zzz</span>
                  : <span className="office-bubble-off" title="该员工还没有会话" />}
            </div>
            <div className="office-monitor"><span className="office-screen" /><span className="office-monitor-stand" /></div>
            <Worker
              variant="staff"
              state={member.running ? "running" : member.hasThread ? "idle" : "never"}
              hue={hueOf(index)}
              onClick={member.hasThread ? () => onOpenThread?.(member.id) : undefined}
            />
            <div className="office-chair" />
            <div className="office-desk-panel"><span className="office-desk-top" /></div>
            <div className="office-name-plate">
              <strong>{member.name || "员工"}</strong>
              <em>{member.profession || "通用"}</em>
            </div>
          </div>
        ))}
      </div>

      {members.length === 0 && <p className="office-scene-empty">这家公司还没有员工 —— 到「专家 / 专家团」给 CEO 配几名成员。</p>}
    </div>
  );
}

/** 拟人化小人（SVG）：几何圆头 + 圆角身体 + 四肢，姿态与附加元素表达状态。 */
function Worker({ variant, state, hue, onClick }: { variant: "ceo" | "staff"; state: "ceo" | "running" | "idle" | "never"; hue: number; onClick?: () => void }) {
  const scale = variant === "ceo" ? 1.12 : 1;
  const color = `hsl(${hue} 62% 52%)`;
  const dark = `hsl(${hue} 62% 38%)`;
  const working = state === "running" || state === "ceo"; // CEO 也在办公桌前忙（视觉上更有人气）
  return (
    <div
      className={`office-worker state-${state}${onClick ? " is-clickable" : ""}`}
      style={{ "--worker-color": color, "--worker-dark": dark, "--wk-scale": String(scale) } as React.CSSProperties}
      onClick={onClick}
      title={onClick ? "点击进入该员工会话" : undefined}
    >
      <svg viewBox="0 0 60 84" width="60" height="84" aria-hidden="true">
        {/* 椅子靠背（坐着的人身后） */}
        <rect className="wk-chair-back" x="19" y="34" width="22" height="26" rx="7" />
        {/* 腿（坐着：大腿水平 + 小腿垂直） */}
        <rect className="wk-thigh" x="24" y="56" width="16" height="8" rx="4" />
        <rect className={`wk-shin ${working ? "is-typing" : ""}`} x="33" y="61" width="7" height="14" rx="3.5" />
        <rect className="wk-shoe" x="31" y="72" width="11" height="5" rx="2.5" />
        {/* 身体 */}
        <rect className="wk-body" x="21" y="30" width="22" height="28" rx="9" />
        {/* 手臂：敲键盘时摆动（CSS 驱动 transform-origin 在肩部） */}
        <rect className={`wk-arm wk-arm-front ${working ? "is-typing" : ""}`} x="39" y="34" width="7" height="18" rx="3.5" />
        <rect className={`wk-arm wk-arm-back ${working ? "is-typing-alt" : ""}`} x="17" y="34" width="7" height="18" rx="3.5" />
        {/* 头 */}
        <circle className="wk-head" cx="32" cy="21" r="10" />
        {/* 头发（区分角色，用深色系） */}
        <path className="wk-hair" d="M 22 18 Q 32 6 42 18 Q 36 13 32 14 Q 27 13 22 18 Z" />
        {/* 领带（CEO 专属） */}
        {variant === "ceo" && <path className="wk-tie" d="M 32 32 l 3.4 4 l -3.4 9 l -3.4 -9 z" />}
        {/* 睡着时闭眼；工作时专注眼 */}
        {state === "idle" ? (
          <>
            <path className="wk-eye-closed" d="M 27 21 q 2 1.6 4 0" />
            <path className="wk-eye-closed" d="M 33 21 q 2 1.6 4 0" />
          </>
        ) : state === "never" ? null : (
          <>
            <circle className="wk-eye" cx="29" cy="20" r="1.5" />
            <circle className="wk-eye" cx="35" cy="20" r="1.5" />
          </>
        )}
      </svg>
      {/* 空闲：咖啡杯（CSS 里做「端起」的浮动） */}
      {state === "idle" && <span className="office-coffee">☕</span>}
      {/* 空工位：没人 */}
      {state === "never" && <span className="office-vacant">空工位</span>}
    </div>
  );
}
