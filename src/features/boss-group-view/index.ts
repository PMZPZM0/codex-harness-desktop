/**
 * boss-group-view —— 创世 boss 群聊形态的渲染层板块（10-24 立）。
 * ⛔ 域↔域只走 barrel：外部只许 `import { ... } from "../boss-group-view"`。
 */
export { BossGroupPanel } from "./BossGroupPanel";
export { BossGroupMembersButton } from "./BossGroupMembersButton";
export { BossGroupStage } from "./BossGroupStage";
/* store 动作也走 barrel（域内唯一出口） */
export { closeBossPanel, closeBossStage, getBossPanelState, openBossPanel, openBossStage, setBossPanelGroup, subscribeBossPanel } from "./panel-store.mjs";
