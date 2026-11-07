/**
 * 群聊板块 · 成员头像（11-06 用户：「都没有头像诶，我看专家都是有头像啊，，还有cli智能体」）
 *
 * ⛔ 之前群里全用**名字首字**当头像（一个圆圈里一个汉字）：专家、专家团、子智能体、CLI
 *   在后台都有自己的卡通头像，到了群里全部退化成首字母，人和人之间看不出是谁。
 * ⛔ 头像图案的判定**只能走 `agentAvatarKindOf`**（`src/lib/agent-avatars.mjs`，纯函数）：
 *   cli ⇒ 机器人图集、member ⇒ 专家图集、team ⇒ 团队图集；渲染交给 `AgentAvatar`。
 *   ⛔ 这里不复制那段 kind 映射，否则专家中心改了风格、群里还是老样子。
 * ⛔ 人类成员（群主「我」）没有智能体身份 ⇒ 保持首字圆圈，不硬套机器头像。
 */
import { AgentAvatar } from "../../components/AgentAvatar";
import { agentAvatarKindOf } from "../../lib/agent-avatars.mjs";

type MemberLike = {
  id: string;
  kind?: string;
  name?: string;
  targetKind?: string;
  targetKey?: string;
};

export function MemberAvatar({
  member,
  size = 26,
  className = "",
}: {
  member: MemberLike;
  size?: number;
  className?: string;
}) {
  const isHuman = (member?.kind ?? "bot") === "human";
  const base = `team-avatar${className ? ` ${className}` : ""}`;
  if (isHuman) {
    return (
      <span className={`${base} is-text`} style={{ width: size, height: size }} aria-hidden>
        {String(member.name ?? "?").slice(0, 1)}
      </span>
    );
  }
  return (
    <span className={base} aria-hidden>
      {/* seed 用 targetKey（= 后台那条目标的身份）：换名字也不会换成另一张脸 */}
      <AgentAvatar kind={agentAvatarKindOf(member?.targetKind)} seed={member?.targetKey || member?.id} size={size} />
    </span>
  );
}
