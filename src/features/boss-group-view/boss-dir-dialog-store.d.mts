export type BossDirDialogState = {
  open: boolean;
  /** 尚未建立会话时（新建流程）暂存的目录 */
  dir: string;
  /** 按会话 id 记的已选目录（指挥中枢可创建多个，各会话互不干扰） */
  dirByThread: Record<string, string>;
  pendingDir: string;
};
export function openBossDirDialog(): void;
export function closeBossDirDialog(): void;
export function setBossDirChosen(dir: string, threadId?: string): void;
/** 取某会话已选的目录（没有 ⇒ 空串） */
export function bossDirFor(threadId?: string): string;
export function getBossDirDialogState(): BossDirDialogState;
export function subscribeBossDirDialog(fn: () => void): () => void;
