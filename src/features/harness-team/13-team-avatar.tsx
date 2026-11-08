/**
 * 群聊板块 · 成员头像（11-06 用户：「都没有头像诶，我看专家都是有头像啊，，还有cli智能体」）
 *
 * ⛔ 之前群里全用**名字首字**当头像（一个圆圈里一个汉字）：专家、专家团、子智能体、CLI
 *   在后台都有自己的卡通头像，到了群里全部退化成首字母，人和人之间看不出是谁。
 * ⛔ 头像图案的判定**只能走 `agentAvatarKindOf`**（`src/lib/agent-avatars.mjs`，纯函数）：
 *   cli ⇒ 机器人图集、member ⇒ 专家图集、team ⇒ 团队图集；渲染交给 `AgentAvatar`。
 *   ⛔ 这里不复制那段 kind 映射，否则专家中心改了风格、群里还是老样子。
 * ⛔⛔ 11-07 用户令「用户头像还有名字同步出来」：人类成员（群主）**不能**再退回首字圆圈 ——
 *   主对话里用户是**真头像**（`components/UserAvatar`：上传的图 / 选的表情 / 兜底首字），
 *   到了群里却是灰圆圈里一个「我」，和名字并排看就是「我 我」两个同样的字（真机截图）。
 *   ⇒ 人类一律走 `UserAvatar`（同一个组件、同一个身份 store），名字由调用方取 `useUserName()`。
 */
import { AgentAvatar } from "../../components/AgentAvatar";
import { UserAvatar } from "../../components/UserAvatar";
import { AGENT_AVATAR_COLS, agentAvatarKindOf } from "../../lib/agent-avatars.mjs";
import { avatarAsset, teamAvatarPresetOf, USER_AVATAR_PRESETS } from "../../lib/avatar-presets";

type MemberLike = {
  id: string;
  kind?: string;
  name?: string;
  targetKind?: string;
  targetKey?: string;
  /** 群内自定义头像（11-07）：`preset:<id>` 或 `data:image/...`；空 = 跟随默认 */
  avatar?: string;
};

/** 内置头像（复用用户中心那 8 张，`public/avatars/`）：⛔ 不另开一套图、也不自己拼路径
 *  （`avatarAsset` 才是 BASE_URL 的唯一口径 —— 打包后写死 `/avatars/...` 会解析到盘符根目录）。 */
export function avatarPresetSrc(presetId: string): string {
  const preset = USER_AVATAR_PRESETS.find((p) => p.id === presetId);
  return preset ? avatarAsset(preset.file) : "";
}

/** 智能体面孔预设（图集切片）：返回文件名 + 背景位置；不是这类预设 ⇒ null。 */
export function avatarPresetFace(presetId: string): { file: string; x: number; y: number } | null {
  const preset = teamAvatarPresetOf(presetId);
  return preset && "face" in preset ? preset.face : null;
}

/** 自定义头像 → 可直接用的 img src（没有自定义 ⇒ 空串；智能体面孔走背景切片，不在这里）。 */
export function memberAvatarSrc(avatar?: string): string {
  const v = String(avatar ?? "").trim();
  if (!v) return "";
  if (v.startsWith("preset:")) {
    const id = v.slice("preset:".length);
    return teamAvatarPresetOf(id) ? "" : avatarPresetSrc(id);
  }
  if (/^data:image\//i.test(v)) return v;
  return "";
}

/** 成员头像：按成员信息取图并叠状态环，尺寸可调。 */
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
  /* ⛔⛔ 11-07 用户：「用户的头像，不要串了那些头像」—— 人类成员（群主/用户）**永远**用用户中心
     那一份 `UserAvatar`，不读群内智能体头像覆盖；智能体头像只作用于 bot。 */
  if (isHuman) {
    /* 只认用户中心那一套（USER presets / 群内选过的同款）：agent 预设在这里取不到 src ⇒ 回落 UserAvatar，
       ⛔ 智能体面孔不会画到用户身上。 */
    const custom = memberAvatarSrc(member?.avatar);
    return (
      <span className={`${base} is-user`} style={{ width: size, height: size }} aria-hidden>
        {custom
          ? <img className="team-avatar__custom" src={custom} alt="" style={{ width: size, height: size }} />
          : <UserAvatar size={size} />}
      </span>
    );
  }
  const rawAvatar = String(member?.avatar ?? "").trim();
  const face = rawAvatar.startsWith("preset:") ? avatarPresetFace(rawAvatar.slice("preset:".length)) : null;
  if (face) {
    /* 智能体面孔（图集切片）：与 AgentAvatar 同口径（300% 背景 + 0/50/100 定位）。 */
    return (
      <span className={base} style={{ width: size, height: size }} aria-hidden>
        <span
          className="team-avatar__custom team-avatar__face"
          style={{
            width: size,
            height: size,
            backgroundImage: `url("${avatarAsset(face.file)}")`,
            backgroundSize: `${AGENT_AVATAR_COLS * 100}% ${AGENT_AVATAR_COLS * 100}%`,
            backgroundPosition: `${face.x}% ${face.y}%`,
          }}
        />
      </span>
    );
  }
  const custom = memberAvatarSrc(member?.avatar);
  if (custom) {
    return (
      <span className={base} style={{ width: size, height: size }} aria-hidden>
        <img className="team-avatar__custom" src={custom} alt="" style={{ width: size, height: size }} />
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
