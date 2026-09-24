/**
 * handleEventRouter6 —— 01-seg 里那条事件总路由的第 6 个分支体（09-22 纯搬迁）。
 * ⛔ 语义等价要点：原体里的 `return` 是**从 onEvent 回调退出**；本函数把它改成 `return true`，
 *    调用处 `if (handleN(...)) return;` —— 提前退出的效果逐位保留（回调的返回值本来就被丢弃）。
 */
import "@xterm/xterm/css/xterm.css";
import type { Bag } from "../../bag-types";

export function handleEventRouter6(bag: Bag, params: any): boolean {
        // ⛔ 已结束的回合不得被迟到的 turn/started 重新点亮（否则收尾之后被置回「运行中」，
        //   而该回合的结束事件已消费完 ⇒ 停止键永久亮着——见跨会话区的同名判定与注释）。
        const postStartTurnId = String(params.turn?.id ?? params.turnId ?? "");
        if (postStartTurnId && bag.finishedTurnIdsRef.current.has(postStartTurnId)) {
          return true;   // 该回合已结束：不点亮、不登记，整条事件忽略
        }
        bag.setSending(true);
        bag.setActiveTurnId(params.turn.id);
        const startedAt = bag.runningStartedAtRef.current.get(params.threadId) ?? Date.now();
        bag.setWorkStartedAt(startedAt);
        bag.turnStartedAtRef.current.set(params.turn.id, Date.now());
        // 不在这里清乐观消息：turn/started 里的 userMessage 可能 content 为空，
        // 清了会导致「乐观气泡没了、服务端消息又没内容」的空窗，消息就「消失」了。
        // 清除完全交给渲染端 optimisticConfirmed 去重（thread.turns 出现同文本 userMessage 才隐藏）。
        // 这里绝不能主动清乐观消息：清早了而服务端 item 又因事件时序没合并进 turns，用户消息就「消失」了。
      
  return false;
}
