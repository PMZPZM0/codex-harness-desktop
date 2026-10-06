// 回合文件变更报告的渲染层仓库（模块级单例，不进 bag——同 stream.ts 的 buffered 前例）。
// 主进程广播 harness:event {type:"turn-file-changes", turnId, files}；本模块收下并供汇总卡读取。
// ⛔ 收件通道 = `window.codex.onHarnessEvent`（preload 把 ipc `harness:event` 以**裸 payload** 递进来）。
//   ⛔ 不走 `window.addEventListener("message")`：全仓没有任何地方向 window 派发带 channel 的
//   MessageEvent（10-06 实证，旧写法是死信道——卡一直空白的根因之一）。
// ⛔ turnId 是**回合 id**（渲染层按 `turn.id` / DOM `#turn-<uuid>` 取报告），不是线程 id。
const reports = new Map();
const listeners = new Set();

if (typeof window !== "undefined" && typeof window.codex?.onHarnessEvent === "function") {
  window.codex.onHarnessEvent((payload) => {
    if (payload?.type !== "turn-file-changes") return;
    const turnId = String(payload.turnId ?? "");
    reports.set(turnId, Array.isArray(payload.files) ? payload.files : []);
    for (const fn of listeners) { try { fn(turnId); } catch { /* 订阅者异常互不影响 */ } }
  });
}

/** 某回合的宿主追踪文件变更（没有 = 空数组） */
export function getTurnFileChanges(turnId) {
  return reports.get(String(turnId ?? "")) ?? [];
}

export function subscribeTurnFileChanges(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
