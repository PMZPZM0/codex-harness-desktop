export type BossPanelState = { open: boolean; /** 按会话 id 记的「选中的群」（不同指挥中枢互不干扰） */ groupIdByThread: Record<string, string> };
export function openBossPanel(groupId?: string, threadId?: string): void;
export function closeBossPanel(): void;
export function setBossPanelGroup(groupId: string, threadId?: string): void;
/** 取某会话选中的群 id（没有 ⇒ 空串） */
export function bossPanelGroupFor(threadId?: string): string;
export function subscribeBossPanel(fn: () => void): () => void;
export function getBossPanelState(): BossPanelState;
