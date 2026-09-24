/**
 * ExpertsTeams —— **barrel**：全部声明已按域分到同目录 ExpertsTeams/（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import "./ExpertsTeams/01-modals";
import "./ExpertsTeams/02-rails";
import "./ExpertsTeams/03-popups";
import "./ExpertsTeams/04-avatar-anchor";

export { SubAgentEditorModal, ExpertTeamEditorModal } from "./ExpertsTeams/01-modals";
export { TeamMemberRail, TeamMemberHistory, DelegatedRail } from "./ExpertsTeams/02-rails";
export { TeamRunPopup, DelegatedRunPopup } from "./ExpertsTeams/03-popups";
export { useAvatarAnchor } from "./ExpertsTeams/04-avatar-anchor";
