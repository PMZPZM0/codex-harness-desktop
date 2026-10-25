/**
 * BOSS 会话「项目地址对话框」的**全局开关**（纯 store，零依赖 —— 同 panel-store 的路子）。
 *
 * ⛔ 为什么它得是全局的（10-25 用户实测）：
 *   点「BOSS 会话」= **先切到 BOSS 欢迎界面**，**随后**才弹这个对话框。
 *   而这两个界面分属两个组件 —— 欢迎界面在 `01-timeline.tsx`（消息区），
 *   对话框由侧栏壳渲染 ⇒ 两边要能互相触发 ⇒ 需要一个跨组件的开关。
 *   ⛔ 不走 props 链：欢迎界面在 AppView 深处、侧栏壳是它的兄弟，props 要穿过 AppView 才连得上，
 *      纯属为了一个布尔量拉一条穿透链不划算（域间只经 barrel / store）。
 *
 * ⛔⛔ 10-25 用户令第二轮：**BOSS 会话可以创建多个、互不干扰** ⇒ 已选目录也**按会话隔离**：
 *   `dirByThread[会话id] = 目录`；会话还没建出来时暂存 `pendingDir`（新建流程只有一条）。
 *   ⛔ 否则 A 会话选了 /a、B 会话选了 /b，切回 A 会显示 /b（串项）。
 */
let state = { open: false, dir: "", dirByThread: {}, pendingDir: "" };
const listeners = new Set();

function emit() { for (const fn of listeners) fn(); }

/** 打开对话框（欢迎界面里的「选择项目地址」按钮、点侧栏 BOSS 会话都会调它）。 */
export function openBossDirDialog() {
  if (state.open) return;
  state = { ...state, open: true };
  emit();
}

/** 关闭对话框（选完 / 取消都走它）。 */
export function closeBossDirDialog() {
  if (!state.open) return;   // 幂等：没开就别广播
  state = { ...state, open: false };
  emit();
}

/**
 * 记录**已选定的项目地址**（按会话隔离；会话 id 为空 ⇒ 暂存 pendingDir）。
 * @param dir    选定的目录
 * @param threadId 归属的会话 id（空 = 还没建会话的新建流程）
 */
export function setBossDirChosen(dir, threadId = "") {
  const path = String(dir ?? "");
  const key = String(threadId ?? "");
  if (key) state = { ...state, dirByThread: { ...state.dirByThread, [key]: path } };
  else state = { ...state, pendingDir: path, dir: path };
  emit();
}

/** 取某会话已选的目录（没有 ⇒ 空串）。 */
export function bossDirFor(threadId) {
  const key = String(threadId ?? "");
  return key ? (state.dirByThread?.[key] ?? "") : (state.pendingDir ?? "");
}

/** 当前是否开着 + 已选地址（引用稳定 ⇒ 可直接喂 useSyncExternalStore）。 */
export function getBossDirDialogState() {
  return state;
}

export function subscribeBossDirDialog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
