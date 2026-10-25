/**
 * boss-group-view —— 创世 boss 群的渲染层板块（10-24 立）。
 * ⛔ 域↔域只走 barrel：外部只许 `import { ... } from "../boss-group-view"`。
 *
 * ⛔ 10-25 用户令：**没有「群聊专属界面」**（原 BossGroupStage 覆盖层已删）。
 *    BOSS 会话 = 一个普通会话（`openThread(群.bossThreadId)`），正常时间线/输入框/消息渲染。
 *    本域只剩两块：顶栏群成员入口（BossGroupMembersButton）+ 右侧群动态面板（BossGroupPanel）。
 */
export { BossGroupPanel } from "./BossGroupPanel";
export { BossGroupMembersButton } from "./BossGroupMembersButton";
export { BossGroupHelpButton } from "./BossGroupHelpButton";
export { BossThreadIntro } from "./BossThreadIntro";
export { BossProjectDirDialog } from "./BossProjectDirDialog";
export { BOSS_ROLE_PROMPT, BOSS_ROLE_MARK, BOSS_ROLE_END } from "./boss-role";
/* 快捷键标签（**单一真相源**：侧栏行尾 kbd + BOSS 欢迎界面 + 快捷键清单共用） */
export { BOSS_SHORTCUT_LABEL, bossShortcutLabel } from "./boss-shortcut";
/* store 动作也走 barrel（域内唯一出口） */
export { autoOpenBossDirDialog, bossDirFor, closeBossDirDialog, consumeBossDirAutoOpen, getBossDirDialogState, openBossDirDialog, setBossDirChosen, subscribeBossDirDialog } from "./boss-dir-dialog-store.mjs";
export { bossPanelGroupFor, closeBossPanel, getBossPanelState, openBossPanel, setBossPanelGroup, subscribeBossPanel } from "./panel-store.mjs";
export {
  bossMemoryWorkspaceFor,
  ensureBossMemoryWorkspace,
  ensureBossSessionRegistered,
  getBossThreads,
  isBossSessionContext,
  removeBossSessionId,
  renameBossSessionId,
  setBossHomeThreadId,
  setBossPending,
  subscribeBossThreads,
} from "./boss-threads-store.mjs";
export type { BossThreadsState } from "./boss-threads-store.mjs";
export type { BossDirDialogState } from "./boss-dir-dialog-store.mjs";
