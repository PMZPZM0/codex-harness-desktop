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
/* store 动作也走 barrel（域内唯一出口） */
export { closeBossPanel, getBossPanelState, openBossPanel, setBossPanelGroup, subscribeBossPanel } from "./panel-store.mjs";
export { getBossThreads, setBossHomeThreadId, setBossPending, subscribeBossThreads } from "./boss-threads-store.mjs";
