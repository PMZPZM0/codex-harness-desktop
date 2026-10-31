/**
 * 自动捕获（L4 每日日志 / L1.5 纪律 / L0 画像）的**归属闸**（10-31 立）。
 *
 * 背景（用户令：「检查一下会话跟调度会话会不会串记忆，深度查」）—— 实测确认**会串**，
 * 而且两个方向都串：
 *   ① 写：被调度的会话（专家 / 子智能体 / 团成员）的回合也被 `turn/completed` 捕获，
 *      以 `{workspace}` 为键写进**同一份** L4 日志与 L1.5 纪律文件。
 *      它们的「用户消息」根本不是用户说的话，而是宿主拼的 `[SYSTEM TASK · 调度会话] …` 壳
 *      （真机日志实证：`.codex-harness/memory/logs/2026-10-31.md` 里整段
 *      `- 需求：[SYSTEM TASK · 调度会话] === 用户需求 === 发起方交给你的任务…`）。
 *      副作用有三层：主会话下一轮注入「近期日志」时把**专家产出**当成自己的近况；
 *      L0 画像可能把合成提示词当"用户说过的话"抽成长期画像（全局生效，最脏）；
 *      将来蒸馏会把这些内容提炼进项目 L1。
 *   ② 读：`delegate-memory` 给被调度会话注入的常驻层里含 L2 近期日志 = 主会话的对话流水。
 *
 * 这里只治**写**（读那侧是"项目上下文"，属设计取舍，先不动）：
 * 非交互会话的回合**不进**共享记忆捕获。
 *
 * ⛔ 什么算非交互（判据按"这条会话是不是用户会点开对话的"来定）：
 *   · 内部会话（内省/蒸馏，`internalThreads`）—— 一直就不算；
 *   · 被调度会话（`delegateRegistry` 有记录 = 专家 / 子智能体 / 由调度建的团成员）；
 *   · 首条消息是 `[SYSTEM TASK · 调度会话|成员会话]` 壳的会话 —— 兜住"没进登记表就跑了"
 *     的成员线程（teams-ipc 的成员会话就是这样建的）。
 * ⛔ 团队会话（`[SYSTEM TASK · 团队会话]`）**不跳**：那是用户真正对话的专家团主会话，
 *   跳过就等于"跟团队聊的东西永远记不住"。
 * ⛔ BOSS 会话不在这里处理：它有自己的记忆目录（`bossMemoryWorkspace`），捕获照样要写。
 */

import { delegateRegistry, internalThreads } from "./runtime-refs";

/** 宿主拼的「系统任务壳」——出现即代表这条消息不是用户说的（渲染层也会折叠它）。 */
const NON_INTERACTIVE_SHELL = /^\s*\[SYSTEM TASK\s*·\s*(?:调度会话|成员会话)\]/;

export type CaptureScope = { skip: boolean; reason: "internal" | "delegated" | "system-task" | "interactive" };

/** 纯函数部分（守卫可单测）：这条用户消息是不是系统任务壳。 */
export function isNonInteractiveUserText(text: string): boolean {
  return NON_INTERACTIVE_SHELL.test(String(text ?? ""));
}

/**
 * 该会话的回合要不要进共享记忆捕获。
 * 失败一律「不跳」（宁可多记一条，也别把用户的真实会话记丢）。
 */
export async function captureScopeOf(threadId: string, userText: string): Promise<CaptureScope> {
  const id = String(threadId ?? "");
  if (!id) return { skip: false, reason: "interactive" };
  if (internalThreads.has(id)) return { skip: true, reason: "internal" };
  try {
    if (await delegateRegistry.infoOf(id)) return { skip: true, reason: "delegated" };
  } catch { /* 登记表读不到 ⇒ 落内容判据 */ }
  if (isNonInteractiveUserText(userText)) return { skip: true, reason: "system-task" };
  return { skip: false, reason: "interactive" };
}
