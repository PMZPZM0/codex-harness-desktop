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
  /** 所有指挥中枢的 id（⛔ 只作身份标记，不用于复用：每次新建都是全新会话） */
  sessionIds: string[];
  /** 指挥中枢自己的目录（<userData>/boss-home）：项目记忆/技能与任何项目隔离 */
  homeDir: string;
  /** 每个指挥中枢的**专属记忆目录**（threadId → memoryDir）：与普通会话完全拆开 */
  sessionMemoryDirs: Record<string, string>;
  pending: boolean;
  loaded: boolean;
};
export function setBossHomeThreadId(id: string): void;
/** 删除指挥中枢时把它从身份登记里摘掉 */
export function removeBossSessionId(id: string): void;
/** 会话重建时把身份登记从旧 id 换成新 id */
export function renameBossSessionId(previousId: string, nextId: string): void;
export function setBossPending(pending: boolean): void;
/**
 * 当前界面是不是「指挥中枢上下文」（顶栏图标与时间线空态共用同一份判定）。
 * 三种入口都算：① 群里的 boss 线程 ② 已登记的指挥中枢 ③ 刚点「指挥中枢」还没拿到 id。
 */
export function isBossSessionContext(state: BossThreadsState, threadId: string | undefined | null): boolean;
export function subscribeBossThreads(fn: () => void): () => void;
export function getBossThreads(): BossThreadsState;
/** 这个指挥中枢的专属记忆目录（空串 = 不是指挥中枢） */
export function bossMemoryWorkspaceFor(threadId: string): string;
/** 名单还没同步到时主动拉一次（返回专属记忆目录，空串 = 不是指挥中枢） */
export function ensureBossMemoryWorkspace(threadId: string): Promise<string>;
/** 确保主进程名单里有这个指挥中枢（幂等；⛔ 非指挥中枢返回 false） */
export function ensureBossSessionRegistered(threadId: string): Promise<boolean>;
