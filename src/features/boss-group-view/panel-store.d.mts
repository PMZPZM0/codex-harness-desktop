export type BossPanelState = { open: boolean; stage: boolean; groupId: string };
export function openBossPanel(groupId?: string): void;
export function closeBossPanel(): void;
export function setBossPanelGroup(groupId: string): void;
export function subscribeBossPanel(fn: () => void): () => void;
export function getBossPanelState(): BossPanelState;
export function openBossStage(groupId?: string): void;
export function closeBossStage(): void;
