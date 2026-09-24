/**
 * SessionTurn —— 保留未分出的部分（09-22 结构改造）。
 * ⛔ 顺序即契约（若含 hook / 副作用注册，调用顺序 == 原文件顺序）⇒ 只能按文件名前缀顺序 import。
 */
import { Turn } from "../../lib/turn";
export { MessageRuler, MemoMessageRuler } from "./SessionTurn/01-message-ruler";
export type { RulerMark } from "./SessionTurn/01-message-ruler";
export { ReasoningCard } from "./SessionTurn/02-reasoning-card";
export { TurnView, MemoTurnView, MemoUserMessageView } from "./SessionTurn/03-turn-view";
export { UserMessageEditor, MessageAttachChip } from "./SessionTurn/04-message-chips";

const workItemTypes = new Set(["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch", "collabAgentToolCall", "subAgentActivity", "imageGeneration"]);

export function isTaskTurn(turn: Turn) {
  return turn.items.some((item) => workItemTypes.has(item.type));
}
