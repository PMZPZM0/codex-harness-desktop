export type TurnHistoryStub = { id: string; startedAt: number };
export type TurnHistorySnapshot = {
  stubs: TurnHistoryStub[];
  estimate: number;
  windowTail: number;
  complete: boolean;
  fetching: boolean;
};
export declare function subscribeTurnHistory(listener: () => void): () => void;
export declare function turnHistoryVersion(): number;
export declare function turnHistoryFor(threadId: string | null | undefined): TurnHistorySnapshot;
export declare function turnHeightEstimateFor(threadId: string | null | undefined): number;
export declare function turnWindowTailFor(threadId: string | null | undefined): number;
export declare function setTurnWindowTail(threadId: string | null | undefined, tail: number): void;
export declare function setTurnHeightEstimate(threadId: string | null | undefined, estimate: number): void;
export declare function resetTurnHistory(threadId: string | null | undefined): void;
export declare function primeTurnHistory(
  threadId: string | null | undefined,
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  options?: { limit?: number; maxPages?: number },
): Promise<void>;
