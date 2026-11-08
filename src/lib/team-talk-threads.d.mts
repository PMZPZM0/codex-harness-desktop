/** 群聊伙伴会话台账（渲染层单例 store）：线程 id → 群 / 成员 / 名字。 */

export type TeamTalkThreadInfo = {
  groupId: string;
  memberId: string;
  name: string;
};

export type TeamTalkThreadsState = {
  byId: Record<string, TeamTalkThreadInfo>;
  loaded: boolean;
};

export function subscribeTeamTalkThreads(fn: () => void): () => void;
export function getTeamTalkThreads(): TeamTalkThreadsState;
export function teamTalkThreadOf(threadId: string): TeamTalkThreadInfo | null;
