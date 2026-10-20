/** 回合文件审阅 · 渲染层单例类型（基座）。 */
export type TurnReviewFile = {
  path: string;
  added: number;
  deleted: number;
  diff: string;
  deletedFile: boolean;
  newFile: boolean;
};
export type TurnReviewState = {
  turnId: string;
  files: TurnReviewFile[];
  selectedPath: string;
  at: number;
};
export type TurnReviewEvent = TurnReviewState & { reason: "open" | "prime" | "select" | "clear" };

export declare function setTurnReview(next: {
  turnId?: string;
  files?: Array<Partial<TurnReviewFile>>;
  selectedPath?: string;
} | null): void;
export declare function primeTurnReview(next: {
  turnId?: string;
  files?: Array<Partial<TurnReviewFile>>;
  selectedPath?: string;
} | null): void;
export declare function clearTurnReview(): void;
export declare function selectTurnReviewFile(path: string): void;
export declare function getTurnReview(): TurnReviewState | null;
export declare function subscribeTurnReview(fn: (event: TurnReviewEvent | null) => void): () => void;
