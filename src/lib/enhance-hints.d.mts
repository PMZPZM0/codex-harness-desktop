/** 增强提示气泡词库（src/lib/enhance-hints.mjs）的类型声明。
 *  `.mjs` 没有声明文件时 tsc 会报 TS7016 导致构建失败（09-17 踩过）。 */
export const ENHANCE_HINTS: string[];
export function pickEnhanceHint(previous?: string): string;
export const HINT_COOLDOWN_MS: number;
export function shouldShowHintThisRun(): boolean;
export function markHintShownThisRun(): void;
export function shouldShowHintAfterSends(sendCount: number): boolean;
export function isLongPrompt(text: string): boolean;
export const HINT_AUTO_HIDE_MS: number;
