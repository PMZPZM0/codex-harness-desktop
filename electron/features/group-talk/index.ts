/** 工作伙伴 · 群聊独立通道（对外只暴露这四个入口；实现分成会话 / 工具 / 投递三块）。 */
export { ensureTalkThread, lookupGroupThread, forgetGroupThreads, runTalkTurn, talkKey } from "./01-channel";
export type { TalkMember } from "./01-channel";
export { buildGroupTalkTools, attachGroupTalkEvents, setGroupTalkHooks, handleGroupTalkToolCall } from "./02-tools";
export type { GroupTalkHooks } from "./02-tools";
export { runGroupTalk, buildTalkInput } from "./03-talk";
export type { GroupTalkOptions, GroupTalkResult } from "./03-talk";
