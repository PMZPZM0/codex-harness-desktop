/**
 * 记忆后端状态变化的**广播**（10-20）。
 *
 * ⛔ 为什么需要：后端是**跨页面**的状态 ——
 *   · 云账号页点「获取 / 刷新记忆凭据」后，开通状态变了；
 *   · 记忆页切了后端，别处（工具面 / 首页统计 / 记忆中心卡片）还在用旧值。
 *   各页面各自轮询会漏、也会白打网络 ⇒ 主进程在**变化点**广播一次，界面订阅后重新读一次状态。
 *
 * ⛔ 只广播、不做判定：payload 就是 `memoryBackendStatus()` 的原始快照，
 *   避免"事件里一套值、IPC 里另一套值"的双口径。
 */
import { sendToWindow } from "./window-bus";
import { memoryBackendStatus } from "../memory-backend";

/** 广播当前记忆后端 + 云端开通状态。⛔ 失败静默：界面拿不到推送会自己刷新，不能反过来弄坏切换。 */
export function notifyMemoryBackendChanged(): void {
  try {
    sendToWindow("memory:backend-changed", memoryBackendStatus());
  } catch {
    /* 窗口已销毁 / 主进程早期：忽略 */
  }
}
