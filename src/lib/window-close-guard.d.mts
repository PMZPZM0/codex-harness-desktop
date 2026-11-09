/** 窗口关闭守卫（见 window-close-guard.mjs） */
export function registerWindowCloseGuard(fn: (() => boolean) | null): () => void;
export function runWindowCloseGuard(): boolean;
