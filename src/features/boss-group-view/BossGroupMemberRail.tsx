/**
 * 指挥中枢会话的**右侧群成员轨**（10-26 用户令）。
 *
 * ⛔⛔ 用户原话：
 *   「成员我记得专家团不是有那个右边轨道成员头像吗，那个的最好反馈成员是不是在干活的提醒，
 *     中枢会话右边轨道上可以放这些头像，不限制梳理，展示 6 个，多了就滚动展示，
 *     工作中的，优先展示在轨道头像上面，亮着头像和光圈反馈，联动性做好一点，
 *     成员和轨道头像显示的状态，联动起来」
 *
 * ── 落点 ─────────────────────────────────────────────────────────────────
 * · 外观**复用**专家团那条轨的样式体系（`.team-rail` / `.team-rail-node` / `.team-rail-ring`）
 *   —— ⛔ 不另写一套：两处各写一份的话图标/光圈很快会漂开（10-05 用户正是为此报的）。
 * · 数据来自**共享 store**（`group-members-store`）⇒ 与顶栏「群成员」面板**同一份快照**
 *   ⇒ 面板说"正在做"、轨道也说"正在做"（用户要的"联动"）。
 *
 * ── 规则 ─────────────────────────────────────────────────────────────────
 * · **工作中（busy）排最前**（用户原话「工作中的，优先展示在轨道头像上面」）。
 * · **最多展示 6 个**，多了**可滚动**（不是分页、不是省略号）。
 * · 工作中：头像亮起（放大 + 高亮边）+ **呼吸光圈**；其余按原顺序。
 */
import { useMemo, useRef } from "react";
import { AVATAR_GRADIENTS, avatarToneOf } from "../../lib/entity-avatar";
import type { GroupMemberLive } from "./group-members-store";

/** 轨道最多同时展示几个（超出走滚动）。 */
export const BOSS_RAIL_MAX = 6;

export function BossGroupMemberRail({ members, onOpen }: {
  members: GroupMemberLive[];
  onOpen?: (memberId: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  /** 工作中排最前，其余保持原顺序（稳定排序：同状态内按原索引）。 */
  const ordered = useMemo(() => {
    const live = members.filter((m) => m.status !== "removed");
    return live
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const aw = a.m.status === "busy" ? 0 : 1;
        const bw = b.m.status === "busy" ? 0 : 1;
        return aw !== bw ? aw - bw : a.i - b.i;
      })
      .map((x) => x.m);
  }, [members]);

  if (!ordered.length) return null;
  const overflow = ordered.length > BOSS_RAIL_MAX;

  return (
    <aside className="team-rail boss-member-rail" aria-label="群成员">
      <div className="team-rail-track boss-member-rail-track" ref={trackRef}>
        <i className="team-rail-line" aria-hidden />
        {ordered.map((m) => {
          const busy = m.status === "busy";
          const state = busy ? "running" : m.status === "reviewing" ? "done" : "idle";
          const stateHint = busy ? "正在干活" : m.status === "reviewing" ? "交活待审" : m.status === "locked" ? "被锁" : "空闲";
          return (
            <button
              key={m.id}
              type="button"
              data-member-id={m.id}
              className={`team-rail-node is-${state}`}
              title={`${m.name}（${m.role}）· ${stateHint}${overflow ? "" : ""}｜点击查看成员`}
              onClick={() => onOpen?.(m.id)}
            >
              <span className="team-rail-avatar" style={{ background: AVATAR_GRADIENTS[avatarToneOf(m.id || m.name)] }}>
                {String(m.name || "?").slice(0, 1)}
              </span>
              {/* ⛔ 工作中：呼吸光圈（与专家团轨同一套样式，不是另画一个）。 */}
              {busy ? <i className="team-rail-ring" aria-hidden /> : null}
              <span className="team-rail-name">{m.name}</span>
            </button>
          );
        })}
      </div>
      {overflow ? (
        <div className="boss-member-rail-more" aria-hidden>
          <span className="boss-member-rail-more-count">+{ordered.length - BOSS_RAIL_MAX}</span>
        </div>
      ) : null}
    </aside>
  );
}
