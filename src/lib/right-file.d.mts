export type RightFileRequest = { path: string; at: number };
export function openRightFile(path: string): void;
export function getRightFile(): RightFileRequest | null;
export function subscribeRightFile(fn: (request: RightFileRequest) => void): () => void;
/** 注册路径解析器（补绝对路径 + 不存在就回落）；广播前统一跑一次，传 null 注销。 */
export function registerRightFileResolver(fn: ((path: string) => Promise<string> | string) | null): void;
