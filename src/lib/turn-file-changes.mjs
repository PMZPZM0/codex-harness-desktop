// 回合文件变更报告的渲染层仓库（模块级单例，不进 bag——同 stream.ts 的 buffered 前例）。
// 主进程广播两类 harness:event（都经 window.codex.onHarnessEvent 以裸 payload 递进来）：
//   · turn-file-changes      —— 回合收尾的最终汇报（「已更改 N 个文件」卡）
//   · turn-file-changes-live —— 运行中每 ~2.5s 的累计改动（「正在编辑文件」板块，实时 +N -M）
// ⛔ turnId 是**回合 id**（渲染层按 `turn.id` / DOM `#turn-<uuid>` 取报告），不是线程 id。
// ⛔ 收件通道 = `window.codex.onHarnessEvent`；不走 `window.addEventListener("message")`
//   （全仓没有任何地方向 window 派发带 channel 的 MessageEvent，10-06 实证是死信道）。
const reports = new Map();
const liveReports = new Map();
const listeners = new Set();

function notify(turnId) {
  for (const fn of listeners) { try { fn(turnId); } catch { /* 订阅者异常互不影响 */ } }
}

if (typeof window !== "undefined" && typeof window.codex?.onHarnessEvent === "function") {
  window.codex.onHarnessEvent((payload) => {
    const type = payload?.type;
    if (type !== "turn-file-changes" && type !== "turn-file-changes-live") return;
    const turnId = String(payload.turnId ?? "");
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (type === "turn-file-changes") {
      reports.set(turnId, files);
      liveReports.delete(turnId); // 最终报告落地 = 收尾，live 清场（避免两卡并存）
    } else if (files.length) {
      liveReports.set(turnId, files);
    } else {
      liveReports.delete(turnId);
    }
    notify(turnId);
  });
}

/** 某回合的宿主追踪文件变更**最终报告**（没有 = 空数组） */
export function getTurnFileChanges(turnId) {
  return reports.get(String(turnId ?? "")) ?? [];
}

/** 某回合**运行中**的实时累计改动（没有 = 空数组；回合收尾会被最终报告清场） */
export function getTurnLiveFileChanges(turnId) {
  return liveReports.get(String(turnId ?? "")) ?? [];
}

/** 两类事件任一到达都会通知（订阅方自己决定读哪个 getter） */
export function subscribeTurnFileChanges(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
