/**
 * BOSS 会话面板的全局开关（纯 store，零依赖 —— 同 function-menu/store 的路子）。
 *
 * 为什么不走 bag：面板是**全局浮层**（任何会话上都能开），挂 bag 要动 bag-types 与 part 结构；
 * 一个开/关 + 选中群 id 的状态用模块级 store 最省（真相源唯一，订阅用 useSyncExternalStore）。
 */

let state = { open: false, groupId: "" };
const listeners = new Set();

function emit() { for (const fn of listeners) fn(); }

export function openBossPanel(groupId = "") {
  state = { open: true, groupId: String(groupId || state.groupId || "") };
  emit();
}

export function closeBossPanel() {
  state = { ...state, open: false };
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
