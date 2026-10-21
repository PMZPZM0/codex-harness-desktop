export type RightFileRequest = { path: string; at: number };
export function openRightFile(path: string): void;
export function getRightFile(): RightFileRequest | null;
export function subscribeRightFile(fn: (request: RightFileRequest) => void): () => void;
