/**
 * turn-end —— 引擎「回合结束」事件的**全集**（唯一真相源）。
 *
 * ⛔⛔ 引擎按结束原因分别投递四类事件：completed / aborted / failed / interrupted。
 * 任何「等回合结束 / 收尾回合」的逻辑都必须认**全这四类** —— 枚举漏一类，那种结束形态
 * 的回合就**永不收尾**。本月（10-10 前后）同型缺陷先后抓到 **7 处**：
 *   渲染层 PollBridge（漏 3 类）· waitForTurnCompletion（漏 interrupted）· scheduler 等待器
 *   （漏 interrupted + turnId 取错字段）· channel-bot（漏 3 类，飞书用户收不到回复）·
 *   bot-stream（漏 3 类，微信流式气泡永远停在「进行中」—— 用户反馈截图正是它）·
 *   im-inbound ×3（漏 3 类，兜底监听器永不摘除）。
 * ⇒ 新代码一律 `isTurnEndMethod()`；⛔ 不要再手写事件名数组。
 * （渲染层不可 import 本文件 —— electron/ 与 src/ 互不引用，PollBridge 里有同款常量，
 *   守卫【11f/11z】会比对两侧同源。）
 */
export const TURN_END_METHODS = ["turn/completed", "turn/aborted", "turn/failed", "turn/interrupted"] as const;

export function isTurnEndMethod(method: string): boolean {
  return (TURN_END_METHODS as readonly string[]).includes(method);
}

/** 回合的**宽容 id 取法**：turn 类事件的 id 在 `params.turn.id`，item 类在 `params.turnId`，
 *  还有引擎版本差异 ⇒ 三处兜底（与 boot.ts / channel-bot.ts 的既有口径同源）。 */
export function turnIdOf(params: any): string {
  return String(params?.turn?.id ?? params?.turnId ?? params?.id ?? "");
}
