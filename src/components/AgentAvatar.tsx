/**
 * 智能体卡通头像（展示件，纯 CSS 切图）。
 *
 * 用法：`<AgentAvatar kind="expert" seed={member.id || member.name} size={36} />`
 * ⛔ 只做渲染：选哪张图集 / 哪一格由 `src/lib/agent-avatars.mjs` 的纯函数决定（可离线真跑）。
 * ⛔ 图片是 `public/avatars/` 的静态包内资源，URL 必须走 `avatarAsset()`（BASE_URL）：
 *   打包后 index.html 是 file://，写死 `/avatars/...` 会解析到盘符根目录。
 */
import { avatarAsset } from "../lib/avatar-presets";
import { AGENT_AVATAR_COLS, pickAgentAvatar, type AgentAvatarKind } from "../lib/agent-avatars.mjs";

export function AgentAvatar(props: {
  kind: AgentAvatarKind;
  /** 稳定标识：成员 id / 团队 id / 子智能体 id（缺省回落名字）。 */
  seed: string;
  size?: number;
  className?: string;
  /** 主理人 / 领队在头像外加一圈金色描边。 */
  lead?: boolean;
}) {
  const { kind, seed, size = 36, className, lead } = props;
  const pick = pickAgentAvatar(kind, seed);
  return (
    <span
      aria-hidden="true"
      className={`agent-avatar agent-avatar-${kind}${lead ? " is-lead" : ""}${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        // 圆角随尺寸走（18px 的小头像 / 40px 的卡片头像都协调）；写在行内，
        // 免得被各页原有的 50% / 9px 规则按加载顺序压掉。
        borderRadius: Math.max(5, Math.round(size * 0.3)),
        backgroundImage: `url("${avatarAsset(pick.file)}")`,
        backgroundSize: `${AGENT_AVATAR_COLS * 100}% ${AGENT_AVATAR_COLS * 100}%`,
        backgroundPosition: `${pick.x}% ${pick.y}%`,
      }}
    />
  );
}
