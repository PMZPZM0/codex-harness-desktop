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
  pending: boolean;
  loaded: boolean;
};
export function setBossHomeThreadId(id: string): void;
export function setBossPending(pending: boolean): void;
export function subscribeBossThreads(fn: () => void): () => void;
export function getBossThreads(): BossThreadsState;
