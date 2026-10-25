/**
 * BOSS 会话面板的全局开关（纯 store，零依赖 —— 同 function-menu/store 的路子）。
 *
 * 为什么不走 bag：面板是**全局浮层**（任何会话上都能开），挂 bag 要动 bag-types 与 part 结构；
 * 一个开/关 + 选中群 id 的状态用模块级 store 最省（真相源唯一，订阅用 useSyncExternalStore）。
 */

/* `enterThreadId` = 进入 BOSS 界面那一刻打开的会话 id（10-25 修「切会话后主舞台空白」）：
   ⛔ 这个值**必须存在 store 里**，不能放组件的 useRef —— 主舞台一旦被卸载重挂 ref 就归零，
   于是"进入时看到的会话"被当成新基线 ⇒ 永远判不出用户已经切走 ⇒ 主舞台一直 hidden（空白）。 */
let state = { open: false, stage: false, groupId: "", enterThreadId: "" };
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
export function openBossStage(groupId = "", threadId = "") {
  state = {
    ...state,
    stage: true,
    open: false,
    groupId: String(groupId || state.groupId || ""),
    enterThreadId: String(threadId || ""),
  };
  emit();
}

export function closeBossStage() {
  /* 幂等：openThread / 新会话 / 点其它会话 会重复调用；已关闭时不再广播（省一次全量重渲染）。 */
  if (!state.stage) return;
  state = { ...state, stage: false, enterThreadId: "" };
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
