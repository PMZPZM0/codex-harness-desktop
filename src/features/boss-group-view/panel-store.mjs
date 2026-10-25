/**
 * BOSS 群面板的全局开关（纯 store，零依赖 —— 同 function-menu/store 的路子）。
 *
 * 为什么不走 bag：面板是**全局浮层**（任何会话上都能开），挂 bag 要动 bag-types 与 part 结构；
 * 一个开/关 + 选中群 id 的状态用模块级 store 最省（真相源唯一，订阅用 useSyncExternalStore）。
 *
 * ⛔ 10-25 用户令：这里**不再有 stage**（群聊专属界面已整块删除，BOSS 会话 = 普通会话）。
 *    只剩「选中哪个群」与右侧群动态面板的开关。
 *
 * ⛔⛔ 10-25 用户令第二轮：**BOSS 会话可以创建多个、互不干扰** ⇒ 「选中哪个群」必须
 *    **按会话隔离**，不能是全局单值：
 *    原来只有一个 groupId（A 会话选了群 1，切到 B 会话仍显示群 1）⇒ 成员列表串项。
 *    ⇒ 改成 `groupIdByThread`：键 = 会话 id，值 = 该会话选中的群 id。
 *    ⛔ 键不存在 ⇒ 该会话没选过群 ⇒ 消费方回落到「本会话自己的群」（BossGroupMembersButton
 *       已按 bossThreadId 匹配），**不回落到别的会话的群**（那才是串项）。
 */
let state = { open: false, groupIdByThread: {} };
const listeners = new Set();

function emit() { for (const fn of listeners) fn(); }

/** 打开面板（可指定群；不传则沿用该会话上次选的）。 */
export function openBossPanel(groupId = "", threadId = "") {
  const key = String(threadId ?? "");
  const byThread = { ...state.groupIdByThread };
  if (key && groupId) byThread[key] = String(groupId);
  state = { ...state, open: true, groupIdByThread: byThread };
  emit();
}

/** 关闭面板（幂等：已关闭不重复广播）。 */
export function closeBossPanel() {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

/** 选中某个群（**按会话**记 —— 不同 BOSS 会话各选各的，互不影响）。 */
export function setBossPanelGroup(groupId, threadId = "") {
  const key = String(threadId ?? "");
  if (!key) return;              // 没有会话键 ⇒ 不记（避免落回全局单值）
  state = { ...state, groupIdByThread: { ...state.groupIdByThread, [key]: String(groupId ?? "") } };
  emit();
}

/** 取某会话选中的群 id（没有 ⇒ 空串）。 */
export function bossPanelGroupFor(threadId) {
  return state.groupIdByThread[String(threadId ?? "")] ?? "";
}

export function subscribeBossPanel(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getBossPanelState() {
  return state;
}
