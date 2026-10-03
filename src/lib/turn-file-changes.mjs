// 回合文件变更报告的渲染层仓库（模块级单例，不进 bag——同 stream.ts 的 buffered 前例）。
// 主进程广播 harness:event {type:"turn-file-changes", turnId, files}；本模块收下并供汇总卡读取。
const reports = new Map();
const listeners = new Set();

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.channel !== "harness:event") return;
    const payload = data.event;
    if (payload?.type !== "turn-file-changes") return;
    reports.set(String(payload.turnId ?? ""), Array.isArray(payload.files) ? payload.files : []);
    for (const fn of listeners) { try { fn(String(payload.turnId ?? "")); } catch { /* 订阅者异常互不影响 */ } }
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
