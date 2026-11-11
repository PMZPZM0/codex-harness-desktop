/** 工作伙伴 · 群聊独立通道（对外只暴露这四个入口；实现分成会话 / 工具 / 投递三块）。 */
export { ensureTalkThread, peekTalkThread, queueTalkDelivery, lookupGroupThread, listTalkThreads, forgetTalkThreads, renameTalkMember, adoptTalkThreadAlias, runTalkTurn, talkKey, onTalkLedgerChanged } from "./01-channel";
export type { TalkMember } from "./01-channel";
export { buildGroupTalkTools, attachGroupTalkEvents, setGroupTalkHooks, handleGroupTalkToolCall } from "./02-tools";
export type { GroupTalkHooks } from "./02-tools";
export { buildTalkInput, groupHistoryBlock, TALK_HISTORY_LIMIT } from "./03-talk";
export type { GroupTalkOptions, TalkHistoryRow } from "./03-talk";
export { planTalkCli, runTalkCliDirect, killTalkCliRuns } from "./04-cli";
/* 11-10：代码层硬约束（独立板块，规则表可拓展；⛔ 不加看门狗） */
export { evaluateMemberOutput } from "./05-guardrails";
export type { TalkCliPlan } from "./04-cli";
