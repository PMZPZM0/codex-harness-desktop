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
  /** BOSS 会话自己的目录（<userData>/boss-home）：项目记忆/技能与任何项目隔离 */
  homeDir: string;
  pending: boolean;
  loaded: boolean;
};
export function setBossHomeThreadId(id: string): void;
export function setBossPending(pending: boolean): void;
export function subscribeBossThreads(fn: () => void): () => void;
export function getBossThreads(): BossThreadsState;
