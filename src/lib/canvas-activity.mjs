/**
 * 画布活动事件箱（11-26 用户令：「codex 调用画布工作流就绿灯自动展开，在这里同步展示」）。
 *
 * 为什么要有：模型调 `workflow_read / workflow_writeback` 时**主进程只广播事件**，
 * 而「开右栏 + 切到画布页 + 标签亮绿灯」全是渲染层的事；画布本身按需挂载，
 * 事件到达那一刻它可能还没渲染 ⇒ 不能只挂在画布组件里。
 *
 * 三类消费者：
 *  · AppView 的画布活动桥 —— 开右栏 + 切画布页 + 记一条活动；
 *  · 右栏标签条 —— 画布标签亮绿灯（模型正在跑这条工作流）；
 *  · 画布本体 —— 挂载时补上「挂载前到达的回填」，否则那一次写回白丢。
 *
 * ⛔ 这里只做「记录 + 通知」，不碰 board 状态、不碰 DOM。
 */
const LIGHT_MS = 9000;
let last = null;
const listeners = new Set();
/** 画布没挂载时收到的回填先排队（挂载后一次补上）；挂载着就直接由画布自己消费。 */
const pending = [];
const MAX_PENDING = 24;
let mounted = 0;

/** 记一条画布活动并通知订阅者。payload.type = activity（模型读/写画布）| writeback（回填节点）。 */
export function noteCanvasActivity(payload) {
  const entry = { at: Date.now(), ...payload };
  last = entry;
  if (entry.type === "writeback" && entry.nodeId && entry.updates && typeof entry.updates === "object" && mounted <= 0) {
    pending.push({ nodeId: String(entry.nodeId), updates: { ...entry.updates } });
    if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
  }
  for (const fn of [...listeners]) {
    try { fn(entry); } catch { /* 单个订阅方异常不影响其它 */ }
  }
}

/** 画布挂载/卸载（画布组件在 mount/unmount 里调；用于判断回填要不要排队）。 */
export function setCanvasMounted(on) {
  mounted += on ? 1 : -1;
  if (mounted < 0) mounted = 0;
}

/** 取走并清空挂载前排队的回填（画布首次挂载时消费）。 */
export function takePendingWritebacks() {
  const out = pending.slice();
  pending.length = 0;
  return out;
}

/** 最近一条画布活动（没有就 null）。 */
export function lastCanvasActivity() {
  return last;
}

/** 绿灯该亮多久（毫秒）—— 右栏标签条据此定时熄灭，与这里同一个口径。 */
export function canvasLightMs() {
  return LIGHT_MS;
}

/** 订阅；返回取消函数。 */
export function subscribeCanvasActivity(fn) {
  if (typeof fn !== "function") return () => undefined;
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
