export type BossDirDialogState = {
  open: boolean;
  /** 尚未建立会话时（新建流程）暂存的目录 */
  dir: string;
  autoOpen: boolean;
  /** 按会话 id 记的已选目录（BOSS 会话可创建多个，各会话互不干扰） */
  dirByThread: Record<string, string>;
  pendingDir: string;
};
export function openBossDirDialog(): void;
/** 「进欢迎界面后自动弹出对话框」标记（由欢迎界面消费） */
export function autoOpenBossDirDialog(): void;
export function consumeBossDirAutoOpen(): boolean;
export function closeBossDirDialog(): void;
export function setBossDirChosen(dir: string, threadId?: string): void;
/** 取某会话已选的目录（没有 ⇒ 空串） */
export function bossDirFor(threadId?: string): string;
export function getBossDirDialogState(): BossDirDialogState;
export function subscribeBossDirDialog(fn: () => void): () => void;
