/**
 * BOSS 会话面板的全局开关（纯 store，零依赖 —— 同 function-menu/store 的路子）。
 *
 * 为什么不走 bag：面板是**全局浮层**（任何会话上都能开），挂 bag 要动 bag-types 与 part 结构；
 * 一个开/关 + 选中群 id 的状态用模块级 store 最省（真相源唯一，订阅用 useSyncExternalStore）。
 */

let state = { open: false, stage: false, groupId: "" };
const listeners = new Set();

function emit() { for (const fn of listeners) fn(); }

export function openBossPanel(groupId = "") {
  state = { ...state, open: true, groupId: String(groupId || state.groupId || "") };
  emit();
}

export function closeBossPanel() {
  state = { ...state, open: false };
  emit();
}

/* ── BOSS 专属界面（10-25 用户令：点 BOSS 会话要**切换主界面**，不是只弹侧边小面板）──
   stage = 主舞台整块渲染成群聊视图；groupId 与右侧面板共用一份。 */
export function openBossStage(groupId = "") {
  state = { ...state, stage: true, open: false, groupId: String(groupId || state.groupId || "") };
  emit();
}

export function closeBossStage() {
  state = { ...state, stage: false };
  emit();
}

export function setBossPanelGroup(groupId) {
  state = { ...state, groupId: String(groupId ?? "") };
  emit();
}

export function subscribeBossPanel(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getBossPanelState() {
  return state;
}

/** 供 TS 侧 useSyncExternalStore 的类型收口（.mjs 无类型，声明在 boss-panel-state.d.mts）。 */
