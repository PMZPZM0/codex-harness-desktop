/** 群聊伙伴会话台账（渲染层单例 store）：线程 id → 群 / 成员 / 名字。 */

export type TeamTalkThreadInfo = {
  groupId: string;
  memberId: string;
  name: string;
  /** 群内自定义头像（`preset:<id>` / `data:image/...`；空串 = 默认） */
  avatar: string;
  /** 成员类型（human / bot），决定头像走用户中心还是智能体图集 */
  kind: string;
  targetKind: string;
  targetKey: string;
  groupName: string;
};

export type TeamTalkThreadsState = {
  byId: Record<string, TeamTalkThreadInfo>;
  loaded: boolean;
};

export function subscribeTeamTalkThreads(fn: () => void): () => void;
export function getTeamTalkThreads(): TeamTalkThreadsState;
export function teamTalkThreadOf(threadId: string): TeamTalkThreadInfo | null;
export function teamTalkIdentityOf(threadId: string): {
  id: string;
  name: string;
  avatar: string;
  kind: string;
  targetKind: string;
  targetKey: string;
} | null;
