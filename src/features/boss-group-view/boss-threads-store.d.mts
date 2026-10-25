export type BossThreadGroup = {
  id: string;
  name: string;
  bossThreadId?: string;
  memberThreadIds?: string[];
  memberCount?: number;
  taskCount?: number;
  paused?: boolean;
};
export type BossThreadsState = {
  groups: BossThreadGroup[];
  bossIds: string[];
  memberIds: string[];
  homeId: string;
  /** 所有 BOSS 会话的 id（⛔ 只作身份标记，不用于复用：每次新建都是全新会话） */
  sessionIds: string[];
  /** BOSS 会话自己的目录（<userData>/boss-home）：项目记忆/技能与任何项目隔离 */
  homeDir: string;
  pending: boolean;
  loaded: boolean;
};
export function setBossHomeThreadId(id: string): void;
/** 删除 BOSS 会话时把它从身份登记里摘掉 */
export function removeBossSessionId(id: string): void;
/** 会话重建时把身份登记从旧 id 换成新 id */
export function renameBossSessionId(previousId: string, nextId: string): void;
export function setBossPending(pending: boolean): void;
export function subscribeBossThreads(fn: () => void): () => void;
export function getBossThreads(): BossThreadsState;
