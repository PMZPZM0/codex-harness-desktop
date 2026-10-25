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
  /** 每个 BOSS 会话的**专属记忆目录**（threadId → memoryDir）：与普通会话完全拆开 */
  sessionMemoryDirs: Record<string, string>;
  pending: boolean;
  loaded: boolean;
};
export function setBossHomeThreadId(id: string): void;
/** 删除 BOSS 会话时把它从身份登记里摘掉 */
export function removeBossSessionId(id: string): void;
/** 会话重建时把身份登记从旧 id 换成新 id */
export function renameBossSessionId(previousId: string, nextId: string): void;
export function setBossPending(pending: boolean): void;
/**
 * 当前界面是不是「BOSS 会话上下文」（顶栏图标与时间线空态共用同一份判定）。
 * 三种入口都算：① 群里的 boss 线程 ② 已登记的 BOSS 会话 ③ 刚点「BOSS 会话」还没拿到 id。
 */
export function isBossSessionContext(state: BossThreadsState, threadId: string | undefined | null): boolean;
export function subscribeBossThreads(fn: () => void): () => void;
export function getBossThreads(): BossThreadsState;
/** 这个 BOSS 会话的专属记忆目录（空串 = 不是 BOSS 会话） */
export function bossMemoryWorkspaceFor(threadId: string): string;
/** 名单还没同步到时主动拉一次（返回专属记忆目录，空串 = 不是 BOSS 会话） */
export function ensureBossMemoryWorkspace(threadId: string): Promise<string>;
/** 确保主进程名单里有这个 BOSS 会话（幂等；⛔ 非 BOSS 会话返回 false） */
export function ensureBossSessionRegistered(threadId: string): Promise<boolean>;
