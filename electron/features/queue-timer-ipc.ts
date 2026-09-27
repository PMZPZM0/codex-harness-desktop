/**
 * queue-timer-ipc（2026-09-28 新增）：排队消息**定时发送**的主进程定时器。
 *
 * 为什么定时器在主进程：主窗口最小化/被遮挡时渲染层 setTimeout 会被 Chromium 节流
 * （hidden → 1Hz，深度节流 1/min），分钟级定时可能严重迟到；主进程 timer 不受节流。
 * 渲染层（part04c2）收到 `queue-timer:due` 后执行真正的启动（复用「立即」的落点语义：
 * 空闲 → thread/queue/start；忙 → reorder 队头交给既有的回合结束 auto-start）。
 *
 * 生命周期：应用退出 ⇒ 引擎队列清空 + 本 Map 清空 ⇒ 定时一并失效 —— 与排队消息自身的
 * 生命周期一致（排队消息也在引擎内存里），因此不需要持久化。窗口 reload 不杀主进程 ⇒
 * Map 仍在；渲染层恢复时用 `queue-timer:set` 幂等覆盖即可。
 *
 * 到点只广播、不直接调引擎：启动动作涉及 steer/钉顶/429 兜底/toast，全在渲染层
 * startQueued 一族里；引擎事件流（queue/changed、turn/started）会照常推给 UI。
 */
import { ipcMain } from "electron";
import { broadcastToAll } from "./window-bus";

type QueueTimerEntry = { threadId: string; runAt: number; timer: ReturnType<typeof setTimeout> | null };
const timers = new Map<string, QueueTimerEntry>();

function clearTimer(id: string) {
  const entry = timers.get(id);
  if (!entry) return;
  if (entry.timer != null) clearTimeout(entry.timer);
  timers.delete(id);
}

ipcMain.handle("queue-timer:set", (_event, input: { threadId: string; queuedSubmissionId: string; runAt: number }) => {
  const threadId = String(input?.threadId ?? "");
  const id = String(input?.queuedSubmissionId ?? "");
  const runAt = Number(input?.runAt ?? 0);
  if (!threadId || !id || !Number.isFinite(runAt)) return { ok: false, scheduled: false };
  clearTimer(id);
  const delay = Math.max(0, runAt - Date.now());
  // 已过期（恢复场景）也照样触发一次 due：由渲染层判断这条还在不在队列里
  const timer = setTimeout(() => {
    timers.delete(id);
    broadcastToAll("queue-timer:due", { threadId, queuedSubmissionId: id });
  }, delay);
  timers.set(id, { threadId, runAt, timer });
  return { ok: true, scheduled: true };
});

ipcMain.handle("queue-timer:cancel", (_event, input: { queuedSubmissionId: string }) => {
  clearTimer(String(input?.queuedSubmissionId ?? ""));
  return { ok: true };
});
