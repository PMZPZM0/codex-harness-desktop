/**
 * 智能体「工作证」小卡（10-31 用户令：「小卡片+预览模式就行，外面一张就简洁展示，
 * 身份证或者工作证一样」）。
 *
 * 一枚卡 = 头像 + 名字 + 一行身份/职责 + 可选状态字。点卡开**预览弹窗**（内容见各设置页）。
 * ⛔ 卡上不放元数据矩阵、不放动作按钮（那是预览里的活）—— 列表只负责"一眼认人"。
 * ⛔ 头像由 AgentAvatar 负责（专家人物 / 专家团合影 / 机器人三套风格）。
 */
import { ChevronRight } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import type { AgentAvatarKind } from "../lib/agent-avatars.mjs";

export function AgentBadge(props: {
  kind: AgentAvatarKind;
  seed: string;
  name: string;
  /** 名字后的小标签：主理人 / 已停用 / 内置… */
  tag?: string;
  /** 一行身份：职业 / 主理人+N 成员 / 自定义角色 */
  line: string;
  /** 领导/主理人头像金圈 */
  lead?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { kind, seed, name, tag, line, lead, disabled, onClick } = props;
  return (
    <button type="button" className={`agent-badge${disabled ? " is-off" : ""}`} onClick={onClick}>
      <AgentAvatar kind={kind} seed={seed} size={42} lead={lead} className="agent-badge-avatar" />
      <span className="agent-badge-copy">
        <strong>{name}{tag ? <em className="agent-badge-tag">{tag}</em> : null}</strong>
        <small>{line}</small>
      </span>
      <ChevronRight size={15} className="agent-badge-arrow" />
    </button>
  );
}
