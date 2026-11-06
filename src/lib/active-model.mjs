/**
 * 当前生效模型 · 渲染层单一真相源（11-06）
 *
 * 用户：「模型也是死的，一点联动性都没有」「跟随模型配置界面，还是旧的」。
 * 群聊是独立板块、⛔ 不摸全局 bag，但「跟随全局」必须跟的正是**主对话模型选择器那一刻
 * 选中的模型**（bag.modelId）。由 AppView 在 modelId 变化时写入这里，群聊订阅即可实时联动。
 *
 * ⛔ 存的是**裸模型名**（custom:<provider>:<model> 去掉前缀），因为 runDelegatedTask
 *    直接把它下发给 turn/start.model，复合串引擎不认（10-team-composer.tsx 同款约束）。
 */
let state = { id: "", name: "" };
const listeners = new Set();

/** id = modelId（复合串），name = 裸模型名。值没变就不通知，避免无谓重渲染。 */
export function setActiveModel(id, name) {
  const next = { id: String(id ?? ""), name: String(name ?? "").trim() };
  if (next.id === state.id && next.name === state.name) return;
  state = next;
  for (const fn of listeners) { try { fn(); } catch { /* noop */ } }
}

/** 稳定引用：只在 setActiveModel 真变化时才换对象，可直接当 useSyncExternalStore 的快照。 */
export function getActiveModel() { return state; }

export function subscribeActiveModel(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
